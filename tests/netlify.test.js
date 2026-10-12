'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),path=require('node:path');
const {BlobSessionStore}=require('../server/blob-session-store'),{respond}=require('../server/netlify-adapter');
const {configuration}=require('../server/config');
class FakeBlobs{
 constructor(){this.data=new Map();this.version=0;}
 async get(key){return this.data.get(key)?.data??null;}
 async getWithMetadata(key,options={}){const item=this.data.get(key);return item?{...structuredClone(item),data:options.type==='json'?JSON.parse(item.data):item.data}:null;}
 async set(key,data,options={}){const old=this.data.get(key);if(options.onlyIfNew&&old||options.onlyIfMatch&&old?.etag!==options.onlyIfMatch)return {modified:false};const etag='v'+(++this.version);this.data.set(key,{data,etag,metadata:options.metadata||{}});return {modified:true,etag};}
 async setJSON(key,data,options){return this.set(key,JSON.stringify(data),options);}
 async delete(key){this.data.delete(key);}
 async *list({prefix}){yield {blobs:[...this.data.keys()].filter(key=>key.startsWith(prefix)).map(key=>({key}))};}
}
const env=()=>({APP_ENV:'development',APP_ORIGIN:'https://fixture.netlify.app',SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture',SESSION_SECRET:crypto.randomBytes(32).toString('base64')});
const config=values=>configuration({...values,NODE_ENV:'development'});
const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;}});
test('Blobs: duas instâncias compartilham sessão criptografada e cookie seguro; gravação antiga não ressuscita logout',async()=>{
 const settings=config(env()),blobs=new FakeBlobs(),a=new BlobSessionStore(settings,blobs),b=new BlobSessionStore(settings,blobs),res=response();
 const session=await a.anonymous(res);assert.match(res.headers['Set-Cookie'],/HttpOnly.*Secure/);assert.match(res.headers['Set-Cookie'],/^__Host-fa-session=/);
 session.storage.verifier='SECRET-FIXTURE';await a.write(session);assert.ok(!JSON.stringify([...blobs.data]).includes('SECRET-FIXTURE'));assert.ok(![...blobs.data.keys()].some(k=>k.includes(session.id)));
 const copy=await b.read(session.id);assert.equal(copy.storage.verifier,'SECRET-FIXTURE');await a.remove(session.id);await assert.rejects(b.write(copy));assert.equal(await b.read(session.id),null);
});
test('Blobs: locks condicionais serializam workers; revogação por usuário afeta só as sessões dessa conta',async()=>{
 const settings=config(env()),blobs=new FakeBlobs(),a=new BlobSessionStore(settings,blobs),b=new BlobSessionStore(settings,blobs);let running=0,maximum=0;
 await Promise.all([a,b].map(store=>store.locked('same-session',async()=>{running++;maximum=Math.max(maximum,running);await new Promise(r=>setTimeout(r,20));running--;})));assert.equal(maximum,1);
 const A=await a.rotate(response(),null,{user:{id:'user-a'},access_token:'fixture-token'}),B=await b.rotate(response(),null,{user:{id:'user-b'},access_token:'fixture-token'});
 await b.invalidateUser('user-a');assert.equal(await a.read(A.id),null);assert.ok(await b.read(B.id));
});
test('Blobs: rate limit é compartilhado e limpeza preserva epochs e locks',async()=>{
 const settings=config(env()),blobs=new FakeBlobs(),a=new BlobSessionStore(settings,blobs),b=new BlobSessionStore(settings,blobs);
 assert.equal(await a.rateLimit('IP-fixture','login',2),true);assert.equal(await b.rateLimit('IP-fixture','login',2),true);assert.equal(await a.rateLimit('IP-fixture','login',2),false);
 await blobs.set('sessions/expired','expired',{metadata:{expires:1}});await blobs.set('locks/retain','lock',{metadata:{expires:1}});await blobs.set('epochs/retain','epoch');await a.prune();assert.equal(await blobs.get('sessions/expired'),null);assert.equal(await blobs.get('locks/retain'),'lock');assert.equal(await blobs.get('epochs/retain'),'epoch');
});
test('Function: ambiente pronto serve páginas públicas, bloqueia privados, origens externas, segredos e falta de configuração',async()=>{
 const values=env(),blobs=new FakeBlobs(),options={env:values,root:path.resolve(__dirname,'..'),blobs},context={ip:'fixture-ip',site:{url:values.APP_ORIGIN}};
 const request=(route,extra={})=>new Request(values.APP_ORIGIN+route,extra);
 assert.equal((await respond(request('/login'),context,options)).status,200);
 let result=await respond(request('/api/auth/session'),context,options);assert.equal(result.status,200);const cookie=result.headers.get('set-cookie').split(';')[0],session=await result.json();assert.equal(session.user,null);assert.equal(session.config.configured,true);
 result=await respond(request('/api/auth/login',{method:'POST',headers:{cookie,'content-type':'application/json',origin:'https://foreign.invalid'},body:'{}'}),context,options);assert.equal(result.status,403);
 assert.equal((await respond(request('/api/ledger'),context,options)).status,401);
 assert.equal((await respond(request('/app'),context,options)).status,303);
 assert.equal((await respond(request('/.env'),context,options)).status,404);
 assert.equal((await respond(new Request('https://foreign.invalid/login'),context,options)).status,421);
 assert.equal((await respond(request('/login'),context,{...options,env:{}})).status,503);
});
module.exports={FakeBlobs};
test('Function: login persiste entre workers; gravação no armazenamento indisponível falha sem cookie (provedor fixture)',async()=>{
 const values=env(),blobs=new FakeBlobs(),context={ip:'fixture-ip',site:{url:values.APP_ORIGIN}},user={id:'fixture-user',email:'fixture@example.invalid',email_confirmed_at:'2026-10-12'};
 const clientFactory=()=>({auth:{async signInWithPassword(){return {data:{user,session:{user,access_token:'fixture-token',refresh_token:'fixture-refresh',expires_at:9999999999}},error:null};},async getUser(){return {data:{user},error:null};}},from(){return {select(){return this;},eq(){return this;},async limit(){return {data:[{}],error:null};}};}});
 const options={env:values,root:path.resolve(__dirname,'..'),blobs,clientFactory};
 const init=await respond(new Request(values.APP_ORIGIN+'/api/auth/session'),context,options),state=await init.json(),oldCookie=init.headers.get('set-cookie').split(';')[0];
 const login=await respond(new Request(values.APP_ORIGIN+'/api/auth/login',{method:'POST',headers:{cookie:oldCookie,origin:values.APP_ORIGIN,'content-type':'application/json','x-csrf-token':state.csrf},body:JSON.stringify({email:user.email,password:'fictional-long-password'})}),context,options);
 assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];assert.notEqual(cookie,oldCookie);
 const next=await respond(new Request(values.APP_ORIGIN+'/api/auth/session',{headers:{cookie}}),context,options),current=await next.json();assert.equal(next.status,200);assert.equal(current.user.id,user.id);assert.notEqual(current.csrf,state.csrf);
 const badBlobs=new FakeBlobs();badBlobs.set=async()=>{throw Error('Fixture outage');};
 const failed=await respond(new Request(values.APP_ORIGIN+'/api/auth/session'),context,{...options,blobs:badBlobs});assert.equal(failed.status,503);assert.equal(failed.headers.get('set-cookie'),null);
});
