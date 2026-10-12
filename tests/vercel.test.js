'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{Readable}=require('node:stream');
const {BlobPreconditionFailedError}=require('@vercel/blob');
const {VercelBlobs}=require('../server/vercel-blob-adapter'),{BlobSessionStore}=require('../server/blob-session-store'),{configuration}=require('../server/config'),{createVercelHandler}=require('../server/vercel-handler');
class FakeVercelSDK {
 constructor(){this.data=new Map();this.version=0;this.BlobPreconditionFailedError=BlobPreconditionFailedError;}
 async get(key,options){assert.equal(options.access,'private');assert.equal(options.useCache,false);const row=this.data.get(key);return row?{statusCode:200,stream:new Response(row.body).body,blob:{etag:row.etag}}:null;}
 async put(key,body,options){assert.equal(options.access,'private');assert.equal(options.addRandomSuffix,false);const old=this.data.get(key);if(options.ifMatch&&options.ifMatch!==old?.etag)throw new BlobPreconditionFailedError();if(!options.allowOverwrite&&old)throw Error('Already exists');const etag='version-'+(++this.version);this.data.set(key,{body,etag});return {etag};}
 async del(key){this.data.delete(key);}
 async list({prefix}){return {blobs:[...this.data.keys()].filter(k=>k.startsWith(prefix)).map(pathname=>({pathname})),hasMore:false};}
}
const env=()=>({APP_ENV:'development',APP_ORIGIN:'https://fixture.vercel.app',SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture',SESSION_SECRET:crypto.randomBytes(32).toString('base64')});
test('Revogação Blob é idempotente e não restaura sessão removida',async()=>{
 const sdk=new FakeVercelSDK(),config=configuration({...env(),NODE_ENV:'development'}),store=new BlobSessionStore(config,new VercelBlobs(sdk,'testes'));
 const session=await store.rotate(response(),null,{user:{id:'fixture'}});await store.remove(session.id);await store.remove(session.id);assert.equal(await store.read(session.id),null);
});
test('Falha transitória na liberação do lock é repetida somente pelo próprio dono',async()=>{
 const sdk=new FakeVercelSDK(),put=sdk.put.bind(sdk);let failed=false;
 sdk.put=async(key,body,options)=>{if(!failed&&key.includes('/locks/')&&JSON.parse(JSON.parse(body).data).owner===''){failed=true;throw new BlobPreconditionFailedError();}return put(key,body,options);};
 const config=configuration({...env(),NODE_ENV:'development'}),store=new BlobSessionStore(config,new VercelBlobs(sdk,'testes'));
 await store.locked('fixture',async()=>{});assert.equal(failed,true);await store.locked('fixture',async()=>{});
});
test('Troca do dono do lock não suprime uma recusa de autenticação',async()=>{
 const sdk=new FakeVercelSDK(),put=sdk.put.bind(sdk);
 sdk.put=async(key,body,options)=>{if(key.includes('/locks/')&&JSON.parse(JSON.parse(body).data).owner===''){sdk.data.set(key,{body:JSON.stringify({data:JSON.stringify({owner:'another-worker',until:Date.now()+90000}),metadata:{}}),etag:'another-version'});throw new BlobPreconditionFailedError();}return put(key,body,options);};
 const config=configuration({...env(),NODE_ENV:'development'}),store=new BlobSessionStore(config,new VercelBlobs(sdk,'testes'));
 await assert.rejects(store.locked('fixture',async()=>{throw Object.assign(Error('Autenticação recusada'),{status:401});}),e=>e.status===401);
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
 await blobs.set('sessions/expired','expired',{metadata:{expires:1}});await a.prune();assert.equal(await blobs.get('sessions/expired'),null);assert.ok([...sdk.data.keys()].some(k=>k.includes('/locks/')));assert.ok([...sdk.data.keys()].some(k=>k.includes('/epochs/')));
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
 const next=await call(make(),'/api/auth/session',{headers:{cookie:login.headers['set-cookie'].split(';')[0]}});assert.equal(JSON.parse(next.body).user.id,user.id);
 const bad=new FakeVercelSDK();bad.put=async()=>{throw Error('PRIVATE-PROVIDER-DETAIL');};const fail=await call(createVercelHandler({env:values,sdkFactory:async()=>bad}),'/api/auth/session');assert.equal(fail.status,503);assert.equal(fail.headers['set-cookie'],undefined);assert.ok(!fail.body.includes('PRIVATE-PROVIDER-DETAIL'));
});
