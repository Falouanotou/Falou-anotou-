'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {configuration}=require('../server/config'),{AuthService}=require('../server/auth-service'),{VercelBlobs}=require('../server/vercel-blob-adapter'),{BlobSessionStore}=require('../server/blob-session-store');
const {BlobPreconditionFailedError,BlobNotFoundError}=require('@vercel/blob');
class MemoryBlobSDK{
 constructor(){this.data=new Map();this.version=0;this.BlobPreconditionFailedError=BlobPreconditionFailedError;this.BlobNotFoundError=BlobNotFoundError;}
 async head(key){const item=this.data.get(key);if(!item)throw new BlobNotFoundError();return {etag:item.etag};}
 async get(key){const item=this.data.get(key);return item?{statusCode:200,stream:new Response(item.body).body,blob:{etag:item.etag}}:null;}
 async put(key,body,options){const item=this.data.get(key);if(options.ifMatch&&options.ifMatch!==item?.etag)throw new BlobPreconditionFailedError();if(!options.allowOverwrite&&item)throw Error('exists');const etag='fixture-'+(++this.version);this.data.set(key,{body,etag});return {etag};}
 async del(key,options={}){const item=this.data.get(key);if(options.ifMatch&&options.ifMatch!==item?.etag)throw new BlobPreconditionFailedError();this.data.delete(key);return {deleted:true};}
 async list({prefix}){return {blobs:[...this.data.keys()].filter(k=>k.startsWith(prefix)).map(pathname=>({pathname})),hasMore:false};}
}
const config=configuration({NODE_ENV:'production',APP_ORIGIN:'https://fixture.vercel.app',SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture',SESSION_SECRET:crypto.randomBytes(32).toString('base64'),PASSWORD_RECOVERY_ENABLED:'true'});
const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;}});
function setup(){const sdk=new MemoryBlobSDK(),makeStore=()=>new BlobSessionStore(config,new VercelBlobs(sdk,'testes'));return {sdk,makeStore};}
function factoryFor({email='fictional@example.invalid',exchangeError=false}={}){let codeUsed=false,flowCount=0;const factory=(url,key,options)=>({auth:{async resetPasswordForEmail(){const flowId='fixture-flow-'+String(++flowCount).padStart(8,'0');options.auth.storage.setItem(`fa-server-auth-flow-${flowId}-code-verifier`,`verifier-${flowId}`);return {data:{},error:null};},async exchangeCodeForSession(code,{flowId}){assert.equal(code,'fictional-one-time-code');assert.equal(options.auth.storage.getItem(`fa-server-auth-flow-${flowId}-code-verifier`),`verifier-${flowId}`);if(codeUsed||exchangeError)return {data:null,error:{status:400,code:'invalid_grant'}};codeUsed=true;const user={id:'fixture-user',email,email_confirmed_at:'2026-10-13T12:00:00Z'};return {data:{user,session:{user,access_token:'fixture-access',refresh_token:'fixture-refresh',expires_at:9999999999}},error:null};},async signOut(){return {error:null};}}});return factory;}
const confirmError=async(auth,session,body={code:'fictional-one-time-code'})=>assert.rejects(auth.confirm(response(),session,body),error=>error.status===400&&/^recovery_/.test(error.safeCode||''));

test('PKCE: pedido captura o verificador e outra instância recupera contexto e conclui recuperação',async()=>{
 const {sdk,makeStore}=setup(),a=makeStore(),initialResponse=response(),session=await a.anonymous(initialResponse),cookie=initialResponse.headers['Set-Cookie'];
 const authA=new AuthService(config,a,factoryFor());await authA.forgot({socket:{remoteAddress:'fixture'}},session,{email:'fictional@example.invalid'});
 assert.match(cookie,/HttpOnly; SameSite=Lax; Max-Age=3600; Secure/);
 const persisted=JSON.stringify([...sdk.data.values()].map(x=>x.body));assert.equal(persisted.includes('verifier-fixture-flow-00000001'),false);
 const b=makeStore(),loaded=await b.read(session.id);assert.equal(loaded.emailFlow.type,'recovery');assert.equal(loaded.emailFlow.email,'fictional@example.invalid');assert.ok(loaded.storage[`fa-server-auth-flow-${loaded.emailFlow.flowId}-code-verifier`]);
 const authB=new AuthService(config,b,factoryFor()),redirect=await authB.confirm(response(),loaded,{code:'fictional-one-time-code',flowId:loaded.emailFlow.flowId});assert.equal(redirect.redirect,'/nova-senha');
 assert.equal(await b.read(session.id),null);
});
test('PKCE: ausência de contexto, verificador, expiração e flowId incompatível têm códigos internos distintos',async()=>{
 const {makeStore}=setup(),store=makeStore(),auth=new AuthService(config,store,factoryFor()),empty={storage:{}};
 await assert.rejects(auth.confirm(response(),empty,{code:'fictional-one-time-code'}),e=>e.safeCode==='recovery_flow_missing');
 const base={storage:{},emailFlow:{type:'recovery',email:'fictional@example.invalid',flowId:'fixture-flow',until:Date.now()+60000}};
 await confirmError(auth,base);await assert.rejects(auth.confirm(response(),base,{code:'fictional-one-time-code'}),e=>e.safeCode==='recovery_verifier_missing');
 const expired={...base,emailFlow:{...base.emailFlow,until:Date.now()-1},storage:{'fa-server-auth-flow-fixture-flow-code-verifier':'fixture'}};
 await assert.rejects(auth.confirm(response(),expired,{code:'fictional-one-time-code'}),e=>e.safeCode==='recovery_flow_expired');
 const incompatible={...base,storage:{'fa-server-auth-flow-fixture-flow-code-verifier':'fixture'}};
 await assert.rejects(auth.confirm(response(),incompatible,{code:'fictional-one-time-code',flowId:'another-flow'}),e=>e.safeCode==='recovery_context_incompatible');
});
test('PKCE: código usado/recusado não é trocado novamente e não revela erro do provedor',async()=>{
 const {makeStore}=setup(),store=makeStore(),auth=new AuthService(config,store,factoryFor({exchangeError:true})),session={storage:{'fa-server-auth-flow-fixture-flow-code-verifier':'verifier-fixture-flow'},emailFlow:{type:'recovery',email:'fictional@example.invalid',flowId:'fixture-flow',until:Date.now()+60000}};
 await assert.rejects(auth.confirm(response(),session,{code:'fictional-one-time-code'}),error=>error.status===400&&error.safeCode==='recovery_link_invalid_or_used'&&!error.message.includes('invalid_grant'));
});
test('PKCE: dois cookies anônimos mantêm verificadores e sessões independentes',async()=>{
 const {makeStore}=setup(),store=makeStore(),r1=response(),r2=response(),a=await store.anonymous(r1),b=await store.anonymous(r2),auth=new AuthService(config,store,factoryFor());
 await Promise.all([store.locked(a.id,async()=>auth.forgot({socket:{remoteAddress:'fixture'}},await store.read(a.id),{email:'a@example.invalid'})),store.locked(b.id,async()=>auth.forgot({socket:{remoteAddress:'fixture'}},await store.read(b.id),{email:'b@example.invalid'}))]);
 const readA=await store.read(a.id),readB=await store.read(b.id);assert.notEqual(readA.emailFlow.flowId,readB.emailFlow.flowId);assert.equal(readA.emailFlow.email,'a@example.invalid');assert.equal(readB.emailFlow.email,'b@example.invalid');
});
test('PKCE: pedidos concorrentes no mesmo cookie serializam atualizações sem perder verificador',async()=>{
 const {makeStore}=setup(),store=makeStore(),session=await store.anonymous(response()),auth=new AuthService(config,store,factoryFor());
 const send=email=>store.locked(session.id,async()=>auth.forgot({socket:{remoteAddress:'fixture'}},await store.read(session.id),{email}));
 await Promise.all([send('first@example.invalid'),send('second@example.invalid')]);
 const saved=await store.read(session.id);assert.equal(saved.emailFlow.email,'second@example.invalid');assert.ok(saved.storage['fa-server-auth-flow-fixture-flow-00000001-code-verifier']);assert.ok(saved.storage['fa-server-auth-flow-fixture-flow-00000002-code-verifier']);
});
test('PKCE: captura ausente falha fechado sem alterar resposta enumerável',async()=>{
 const {makeStore}=setup(),store=makeStore(),session=await store.anonymous(response()),auth=new AuthService(config,store,()=>({auth:{async resetPasswordForEmail(){return {error:null};}}}));
 await assert.rejects(auth.forgot({socket:{remoteAddress:'fixture'}},session,{email:'fictional@example.invalid'}),error=>error.safeCode==='recovery_verifier_missing');
 assert.equal((await store.read(session.id)).emailFlow,undefined);
});
test('PKCE: cookie ausente ou alterado não valida CSRF de outra sessão',async()=>{
 const {makeStore}=setup(),store=makeStore(),first=await store.anonymous(response()),second=await store.anonymous(response()),auth=new AuthService(config,store,factoryFor());
 assert.throws(()=>auth.csrf({headers:{origin:config.origin,'x-csrf-token':first.csrf}},null),error=>error.status===403);
 assert.throws(()=>auth.csrf({headers:{origin:config.origin,'x-csrf-token':second.csrf}},first),error=>error.status===403);
});
