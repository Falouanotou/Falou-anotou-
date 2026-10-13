'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{Readable}=require('node:stream');
const {BlobPreconditionFailedError,BlobNotFoundError}=require('@vercel/blob');
const {VercelBlobs}=require('../server/vercel-blob-adapter'),{BlobSessionStore}=require('../server/blob-session-store'),{configuration}=require('../server/config'),{createVercelHandler}=require('../server/vercel-handler');
const {AuthService}=require('../server/auth-service');
class FakeVercelSDK {
 constructor(){this.data=new Map();this.version=0;this.counts={put:0,get:0,head:0,del:0,list:0};this.BlobPreconditionFailedError=BlobPreconditionFailedError;this.BlobNotFoundError=BlobNotFoundError;}
 async head(key){this.counts.head++;const row=this.data.get(key);if(!row)throw new BlobNotFoundError();return {etag:row.etag};}
 async get(key,options){this.counts.get++;assert.equal(options.access,'private');assert.equal(options.useCache,false);const row=this.data.get(key);return row?{statusCode:200,stream:new Response(row.body).body,blob:{etag:row.etag}}:null;}
 async put(key,body,options){this.counts.put++;assert.equal(options.access,'private');assert.equal(options.addRandomSuffix,false);const old=this.data.get(key);if(options.ifMatch&&options.ifMatch!==old?.etag)throw new BlobPreconditionFailedError();if(!options.allowOverwrite&&old)throw Error('Already exists');const etag='version-'+(++this.version);this.data.set(key,{body,etag});return {etag};}
 async del(key,options={}){this.counts.del++;if(key.includes('/locks/'))assert.ok(options.ifMatch,'Lock deletion must always be conditional.');const old=this.data.get(key);if(options.ifMatch&&options.ifMatch!==old?.etag)throw new BlobPreconditionFailedError();this.data.delete(key);}
 async list({prefix}){return {blobs:[...this.data.keys()].filter(k=>k.startsWith(prefix)).map(pathname=>({pathname})),hasMore:false};}
}
const env=()=>({APP_ENV:'development',APP_ORIGIN:'https://fixture.vercel.app',SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture',SESSION_SECRET:crypto.randomBytes(32).toString('base64')});
test('Sessão usa ETag da API de escrita mesmo se a representação de download divergir',async()=>{
 const sdk=new FakeVercelSDK(),get=sdk.get.bind(sdk);sdk.get=async(key,options)=>{const result=await get(key,options);if(result&&key.includes('/sessions/'))result.blob.etag='W/'+result.blob.etag;return result;};
 const config=configuration({...env(),NODE_ENV:'development'}),store=new BlobSessionStore(config,new VercelBlobs(sdk,'testes'));
 const session=await store.rotate(response(),null,{user:{id:'fixture'},access_token:'x'.repeat(4000)});const copy=await store.read(session.id);copy.storage.updated=true;await store.write(copy);await store.remove(copy.id);assert.equal(await store.read(copy.id),null);
});
test('Mudança entre metadados e corpo obriga nova leitura antes de usar o ETag',async()=>{
 const sdk=new FakeVercelSDK(),blobs=new VercelBlobs(sdk,'testes');await blobs.set('sessions/fixture','original');let changed=false;const get=sdk.get.bind(sdk);
 sdk.get=async(key,options)=>{const result=await get(key,options);if(!changed){changed=true;await blobs.set('sessions/fixture','updated');}return result;};
 const read=await blobs.getWithMetadata('sessions/fixture');assert.equal(read.data,'updated');assert.equal(read.etag,(await sdk.head('falou-anotou/testes/sessions/fixture')).etag);
});
test('Revogação Blob é idempotente e não restaura sessão removida',async()=>{
 const sdk=new FakeVercelSDK(),config=configuration({...env(),NODE_ENV:'development'}),store=new BlobSessionStore(config,new VercelBlobs(sdk,'testes'));
 const session=await store.rotate(response(),null,{user:{id:'fixture'}});await store.remove(session.id);await store.remove(session.id);assert.equal(await store.read(session.id),null);
});
test('Falha transitória na liberação condicional é repetida somente pelo próprio dono',async()=>{
 const sdk=new FakeVercelSDK(),del=sdk.del.bind(sdk);let failed=false;
 sdk.del=async(key,options)=>{if(!failed&&key.includes('/locks/')){failed=true;throw new BlobPreconditionFailedError();}return del(key,options);};
 const config=configuration({...env(),NODE_ENV:'development'}),store=new BlobSessionStore(config,new VercelBlobs(sdk,'testes'));
 await store.locked('fixture',async()=>{});assert.equal(failed,true);await store.locked('fixture',async()=>{});
});
test('Worker antigo não exclui lock recém-adquirido por outro worker',async()=>{
 const sdk=new FakeVercelSDK(),config=configuration({...env(),NODE_ENV:'development'}),blobs=new VercelBlobs(sdk,'testes'),a=new BlobSessionStore(config,blobs),b=new BlobSessionStore(config,new VercelBlobs(sdk,'testes'));
 let enterA,releaseA,enterB,releaseB;const insideA=new Promise(r=>enterA=r),gateA=new Promise(r=>releaseA=r),insideB=new Promise(r=>enterB=r),gateB=new Promise(r=>releaseB=r);
 const lockKey='locks/'+a.digest('same-session');
 const pa=a.locked('same-session',async()=>{const current=await a.blobs.getWithMetadata(lockKey,{type:'json'});await a.blobs.setJSON(lockKey,{...current.data,until:Date.now()-1},{onlyIfMatch:current.etag});enterA();await gateA;});await insideA;
 const pb=b.locked('same-session',async()=>{enterB();await gateB;});await insideB;
 const key='falou-anotou/testes/'+lockKey,ownedByB=JSON.parse(JSON.parse(sdk.data.get(key).body).data).owner;
 releaseA();await pa;assert.equal(JSON.parse(JSON.parse(sdk.data.get(key).body).data).owner,ownedByB);
 releaseB();await pb;assert.equal(sdk.data.has(key),false);
});
test('Lock nunca é excluído sem ETag e falha de operação preserva erro original',async()=>{
 const sdk=new FakeVercelSDK(),config=configuration({...env(),NODE_ENV:'development'}),store=new BlobSessionStore(config,new VercelBlobs(sdk,'testes'));
 await assert.rejects(store.locked('fixture',async()=>{throw Object.assign(Error('Autenticação recusada'),{status:401});}),e=>e.status===401);
 assert.equal(sdk.counts.del,1);assert.ok([...sdk.data.keys()].every(key=>!key.includes('/locks/')));
});
test('Liberação usa delete condicional e reduz um put faturável por lock',async()=>{
 const sdk=new FakeVercelSDK(),config=configuration({...env(),NODE_ENV:'development'}),store=new BlobSessionStore(config,new VercelBlobs(sdk,'testes'));
 await store.locked('measured-fixture',async()=>{});assert.deepEqual(sdk.counts,{put:1,get:1,head:0,del:1,list:0});
});
test('Lock ocupado expira com segurança sem excluir o lock do proprietário atual',async()=>{
 const sdk=new FakeVercelSDK(),config=configuration({...env(),NODE_ENV:'development'}),store=new BlobSessionStore(config,new VercelBlobs(sdk,'testes')),id='busy-fixture',key='locks/'+store.digest(id);
 await store.blobs.setJSON(key,{owner:'active-owner',until:Date.now()+90000},{onlyIfNew:true});
 const realNow=Date.now,realTimeout=global.setTimeout;let now=Date.now();Date.now=()=>now+=1000;global.setTimeout=callback=>{callback();return 0;};
 try{await assert.rejects(store.locked(id,async()=>{}),e=>e.status===503&&e.safeCode==='session_lock_timeout');}
 finally{Date.now=realNow;global.setTimeout=realTimeout;}
 assert.equal(JSON.parse(JSON.parse(sdk.data.get('falou-anotou/testes/'+key).body).data).owner,'active-owner');assert.equal(sdk.counts.del,0);
});
const response=()=>({headers:{},status:200,headersSent:false,setHeader(k,v){this.headers[k.toLowerCase()]=v;},writeHead(status,headers={}){this.status=status;for(const[k,v]of Object.entries(headers))this.setHeader(k,v);this.headersSent=true;},end(body){this.body=body?Buffer.from(body).toString():'';}});
test('Resposta só termina depois da liberação do lock distribuído',async()=>{
 const res=response(),config=configuration({...env(),NODE_ENV:'development'});let released=false;
 const store={cookie(){return null;},async read(){return null;},async anonymous(){return {csrf:'fixture',storage:{}};},async locked(id,operation){await operation();assert.equal(res.headersSent,false);released=true;}};
 const auth={async limited(){},publicConfig(){return {development:true};}};
 await require('../server').createHandler(config,{store,auth})({method:'GET',url:'/api/auth/session',headers:{host:config.host},socket:{remoteAddress:'fixture'}},res);
 assert.equal(released,true);assert.equal(res.status,200);assert.equal(res.headersSent,true);assert.equal(JSON.parse(res.body).csrf,'fixture');
});
test('Vercel privado: leituras sem cache, CAS e sessão criptografada entre workers',async()=>{
 const sdk=new FakeVercelSDK(),settings=configuration({...env(),NODE_ENV:'development'}),a=new BlobSessionStore(settings,new VercelBlobs(sdk,'testes')),b=new BlobSessionStore(settings,new VercelBlobs(sdk,'testes'));
 const res=response(),s=await a.anonymous(res);s.storage.secret='PRIVATE-FIXTURE';await a.write(s);assert.ok(!JSON.stringify([...sdk.data]).includes('PRIVATE-FIXTURE'));assert.match(res.headers['set-cookie'],/^__Host-fa-session=.*HttpOnly.*Secure/);
 const copy=await b.read(s.id);assert.equal(copy.storage.secret,'PRIVATE-FIXTURE');await a.remove(s.id);await assert.rejects(b.write(copy));assert.equal(await b.read(s.id),null);
});
test('Vercel privado: leases entre workers, revogação por conta, limites e limpeza',async()=>{
 const sdk=new FakeVercelSDK(),settings=configuration({...env(),NODE_ENV:'development'}),blobs=new VercelBlobs(sdk,'testes'),a=new BlobSessionStore(settings,blobs),b=new BlobSessionStore(settings,new VercelBlobs(sdk,'testes'));let running=0,peak=0;
 await Promise.all([a,b].map(s=>s.locked('session',async()=>{running++;peak=Math.max(peak,running);await new Promise(r=>setTimeout(r,10));running--;})));assert.equal(peak,1);
 const A=await a.rotate(response(),null,{user:{id:'a'}}),B=await b.rotate(response(),null,{user:{id:'b'}});await b.invalidateUser('a');assert.equal(await a.read(A.id),null);assert.ok(await b.read(B.id));
 assert.equal(await a.rateLimit('ip','login',1),true);assert.equal(await b.rateLimit('ip','login',1),false);
 await blobs.set('sessions/expired','expired',{metadata:{expires:1}});await a.prune();assert.equal(await blobs.get('sessions/expired'),null);assert.ok(![...sdk.data.keys()].some(k=>k.includes('/locks/')));assert.ok([...sdk.data.keys()].some(k=>k.includes('/epochs/')));
});
test('Logout em Blob revoga a sessão e mantém o cookie encerrado',async()=>{
 const sdk=new FakeVercelSDK(),config=configuration({...env(),NODE_ENV:'development'}),store=new BlobSessionStore(config,new VercelBlobs(sdk,'testes')),user={id:'logout-fixture'};
 const session=await store.rotate(response(),null,{user,access_token:'fixture-access',refresh_token:'fixture-refresh',expires_at:9999999999});let scope;
 const auth=new AuthService(config,store,()=>({auth:{async signOut(options){scope=options.scope;return{error:null};}}})),res=response();
 assert.equal((await auth.logout(res,session)).redirect,'/login');assert.equal(scope,'local');assert.equal(res.headers['set-cookie'].includes('Max-Age=0'),true);assert.equal(await store.read(session.id),null);
});
test('Troca de senha invalida sessões Blob antigas da mesma conta sem afetar outras contas',async()=>{
 const sdk=new FakeVercelSDK(),config=configuration({...env(),NODE_ENV:'development'}),store=new BlobSessionStore(config,new VercelBlobs(sdk,'testes'));
 const oldA=await store.rotate(response(),null,{user:{id:'recovery-fixture'},access_token:'old-a'}),oldA2=await store.rotate(response(),null,{user:{id:'recovery-fixture'},access_token:'old-b'}),other=await store.rotate(response(),null,{user:{id:'other-fixture'},access_token:'other'});
 await store.invalidateUser('recovery-fixture');assert.equal(await store.read(oldA.id),null);assert.equal(await store.read(oldA2.id),null);assert.equal((await store.read(other.id)).auth.access_token,'other');
});
test('Renovação do token persiste a nova sessão cifrada no Blob',async()=>{
 const sdk=new FakeVercelSDK(),config=configuration({...env(),NODE_ENV:'development'}),store=new BlobSessionStore(config,new VercelBlobs(sdk,'testes')),user={id:'refresh-fixture',email_confirmed_at:'2026-10-13'};
 const session=await store.rotate(response(),null,{user,access_token:'old-access',refresh_token:'old-refresh',expires_at:1});let refreshed=false;
 const factory=()=>({auth:{async refreshSession({refresh_token}){assert.equal(refresh_token,'old-refresh');refreshed=true;return{data:{session:{user,access_token:'new-access',refresh_token:'new-refresh',expires_at:9999999999}},error:null};},async getUser(token){assert.equal(token,'new-access');return{data:{user},error:null};}},async rpc(name){assert.equal(name,'has_account_access');return{data:true,error:null};}});
 const auth=new AuthService(config,store,factory);await auth.verified(session);const persisted=await store.read(session.id);assert.equal(refreshed,true);assert.equal(persisted.auth.access_token,'new-access');assert.ok(!sdk.data.get('falou-anotou/testes/sessions/'+store.digest(session.id)).body.includes('new-access'));
});
async function call(handler,url,options={}){const req=Readable.from([]);req.method=options.method||'GET';req.url=url;req.headers={host:'fixture.vercel.app','x-vercel-forwarded-for':'fixture-ip',...options.headers};if(options.body!==undefined)req.body=options.body;const res=response();await handler(req,res);return res;}
test('Vercel HTTP: rotas públicas, privacidade, origem, limite e falha de configuração',async()=>{
 const values=env(),sdk=new FakeVercelSDK(),handler=createVercelHandler({env:values,sdkFactory:async()=>sdk});
 assert.equal((await call(handler,'/login')).status,200);assert.equal((await call(handler,'/termos-de-uso')).status,200);
 assert.equal((await call(handler,'/.env')).status,404);assert.equal((await call(handler,'/server/config.js')).status,404);assert.equal((await call(handler,'/api/ledger')).status,401);assert.equal((await call(handler,'/app')).status,303);
 assert.equal((await call(handler,'/login',{headers:{host:'foreign.invalid'}})).status,421);
 assert.equal((await call(handler,'/api/auth/login',{method:'POST',body:'x'.repeat(4*1024*1024+1)})).status,413);
 assert.equal((await call(createVercelHandler({env:{}}),'/login')).status,503);
});
test('Vercel HTTP: login fixture persiste entre invocações; falha de storage não cria cookie',async()=>{
 const values=env(),sdk=new FakeVercelSDK(),user={id:'fixture-user',email:'fixture@example.invalid',email_confirmed_at:'2026-10-12'};
 const clientFactory=()=>({async rpc(){return {data:true,error:null};},auth:{async signInWithPassword(){return {data:{user,session:{user,access_token:'fixture-token',refresh_token:'fixture-refresh',expires_at:9999999999}},error:null};},async getUser(){return {data:{user},error:null};}},from(){return {select(){return this;},eq(){return this;},async limit(){return {data:[{}],error:null};}};}});
 const make=()=>createVercelHandler({env:values,sdkFactory:async()=>sdk,clientFactory});const init=await call(make(),'/api/auth/session'),state=JSON.parse(init.body),cookie=init.headers['set-cookie'].split(';')[0];
 const foreign=await call(make(),'/api/auth/login',{method:'POST',headers:{cookie,origin:'https://foreign.invalid','content-type':'application/json','x-csrf-token':state.csrf},body:{email:user.email,password:'fictional-long-password'}});assert.equal(foreign.status,403);
 const login=await call(make(),'/api/auth/login',{method:'POST',headers:{cookie,origin:values.APP_ORIGIN,'content-type':'application/json','x-csrf-token':state.csrf},body:{email:user.email,password:'fictional-long-password'}});assert.equal(login.status,200);
 const authCookie=login.headers['set-cookie'].split(';')[0],next=await call(make(),'/api/auth/session',{headers:{cookie:authCookie}});assert.equal(JSON.parse(next.body).user.id,user.id);
 const beforeLogout={...sdk.counts},logout=await call(make(),'/api/auth/logout',{method:'POST',headers:{cookie:authCookie,origin:values.APP_ORIGIN,'content-type':'application/json','x-csrf-token':JSON.parse(next.body).csrf},body:{}});
 assert.equal(logout.status,200);assert.match(logout.headers['set-cookie'],/Max-Age=0/);assert.deepEqual(Object.fromEntries(Object.keys(beforeLogout).map(k=>[k,sdk.counts[k]-beforeLogout[k]])),{put:2,get:3,head:2,del:1,list:0});
 const store=new BlobSessionStore(configuration({...values,NODE_ENV:'development'}),new VercelBlobs(sdk,'homologacao'));assert.equal(await store.read(authCookie.split('=')[1]),null);
 const bad=new FakeVercelSDK();bad.put=async()=>{throw Error('PRIVATE-PROVIDER-DETAIL');};const fail=await call(createVercelHandler({env:values,sdkFactory:async()=>bad}),'/api/auth/session');assert.equal(fail.status,503);assert.equal(fail.headers['set-cookie'],undefined);assert.ok(!fail.body.includes('PRIVATE-PROVIDER-DETAIL'));
});
