'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {AuthService}=require('../server/auth-service'),{configuration}=require('../server/config');
const config=configuration({SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture'});
function setup(failedRevocation=false){
 let used=false;const calls=[];const user={id:'fictional-recovery-A',email:'fictional@example.invalid',email_confirmed_at:'2026-10-12'};
 const client={auth:{
  async verifyOtp(body){calls.push('verifyOtp');assert.equal(body.type,'recovery');if(used)return {data:null,error:{status:400}};used=true;return {data:{user,session:{user,access_token:'fixture',expires_at:9999999999}},error:null};},
  async getUser(){return {data:{user},error:null};},
  async updateUser(){calls.push('updateUser');return {data:{user},error:null};},
  async signOut(options){calls.push('signOut:'+options.scope);return {error:failedRevocation?{status:500}:null};}
 },async rpc(name){assert.equal(name,'has_account_access');return {data:true,error:null};}};
 const store={async rotate(res,old,auth,extra){calls.push('rotate');this.recovery={id:'fictional-recovery-session',auth,storage:{},...extra};},async invalidateUser(id){calls.push('invalidate:'+id);},async remove(id){calls.push('remove:'+id);},setCookie(res,id,age){calls.push('clear-cookie:'+age);}};
 return {auth:new AuthService(config,store,()=>client),store,calls};
}
test('Conta fictícia: link oficial de recuperação não abre finanças, é consumido uma vez e troca senha encerrando sessões',async()=>{
 const {auth,store,calls}=setup(),body={type:'recovery',tokenHash:'a'.repeat(64)};
 assert.equal((await auth.confirm({}, {storage:{}},body)).redirect,'/nova-senha');
 await assert.rejects(auth.private(store.recovery),e=>e.status===403);
 await assert.rejects(auth.confirm({}, {storage:{}},body),e=>e.status===400);
 await assert.rejects(auth.reset({},store.recovery,{password:'short',confirmPassword:'short'}),e=>e.status===400);
 const password='frase-exclusiva-da-conta-ficticia';
 assert.equal((await auth.reset({},store.recovery,{password,confirmPassword:password})).redirect,'/login?notice=password-updated');
 assert.ok(calls.includes('signOut:global'));assert.ok(calls.includes('invalidate:fictional-recovery-A'));assert.ok(!calls.includes('invalidate:fictional-recovery-B'));assert.ok(calls.includes('clear-cookie:0'));
});
test('Falha de revogação no Supabase não informa recuperação concluída; sessão local é encerrada',async()=>{
 const {auth,store,calls}=setup(true);await auth.confirm({}, {storage:{}},{type:'recovery',tokenHash:'b'.repeat(64)});
 const password='frase-exclusiva-da-conta-ficticia';
 await assert.rejects(auth.reset({},store.recovery,{password,confirmPassword:password}),e=>e.status===503&&e.message.includes('senha foi atualizada'));
 assert.ok(calls.includes('invalidate:fictional-recovery-A'));assert.ok(calls.includes('remove:fictional-recovery-session'));assert.ok(calls.includes('clear-cookie:0'));
});
test('Tokens implícitos são verificados no provedor e vinculados à mesma conta e sessão antes da recuperação',async()=>{
 const token=(id)=>'fixture.'+Buffer.from(JSON.stringify({session_id:id})).toString('base64url')+'.fixture';
 const user={id:'fictional-A',email_confirmed_at:'2026-10-12'},old=token('session-A'),fresh=token('session-A');
 let rotated=0,otherUser=false,otherSession=false,allowed=true;
 const client={auth:{async getUser(){return {data:{user},error:null};},async refreshSession(){return {data:{user:otherUser?{id:'fictional-B'}:user,session:{user,access_token:otherSession?token('session-B'):fresh}},error:null};}},async rpc(){return {data:allowed,error:null};}};
 const auth=new AuthService(config,{async rotate(res,session,provider,extra){rotated++;assert.ok(extra.recovery>Date.now());}},()=>client);
 const req={socket:{remoteAddress:'fictional-test'}},body={type:'recovery',accessToken:old,refreshToken:'ficticio12345'};
 assert.equal((await auth.recoverySession(req,{}, {},body)).redirect,'/nova-senha');assert.equal(rotated,1);
 otherUser=true;await assert.rejects(auth.recoverySession(req,{}, {},body),e=>e.status===400);otherUser=false;
 otherSession=true;await assert.rejects(auth.recoverySession(req,{}, {},body),e=>e.status===400);otherSession=false;
 allowed=false;await assert.rejects(auth.recoverySession(req,{}, {},body),e=>e.status===403);
 await assert.rejects(auth.recoverySession(req,{}, {},{type:'recovery'}),e=>e.status===400);assert.equal(rotated,1);
});
