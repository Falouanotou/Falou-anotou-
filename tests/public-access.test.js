'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {configuration}=require('../server/config'),{AuthService}=require('../server/auth-service'),pages=require('../server/pages'),{createVercelHandler}=require('../server/vercel-handler');
const config=()=>configuration({SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture'});
test('Cadastro direto e Google ausente; documentos incompletos bloqueiam produção',async()=>{
 const c=config();assert.equal(c.signupAllowed,true);assert.ok(pages.authPage('login',c).includes('/cadastro'));assert.ok(!pages.authPage('login',c).includes('googleButton'));assert.ok(pages.authPage('signup',c).includes('authName'));
 const prod=configuration({NODE_ENV:'production',APP_ORIGIN:'https://fixture.example.invalid',SUPABASE_URL:c.url,SUPABASE_PUBLISHABLE_KEY:c.key});
 assert.equal(prod.signupAllowed,false);await assert.rejects(new AuthService(prod,{}).signup({}, {}, {}, {}),e=>e.status===403);
 assert.equal(typeof AuthService.prototype.google,'undefined');assert.equal(typeof AuthService.prototype.callback,'undefined');
});
test('Cadastro recebe sessão do provedor fixture, registra aceite e entra imediatamente; não envia e-mail',async()=>{
 let rotated,signupInput;const calls=[];
 const user={id:'fictional-A',email:'a@example.invalid',email_confirmed_at:'2026-10-12'};
 const provider={auth:{async signUp(input){signupInput=input;return {data:{user,session:{user,access_token:'fixture'}},error:null};}},async rpc(name){calls.push(name);return {data:true,error:null};}};
 const auth=new AuthService(config(),{async rotate(res,old,session){rotated=session;}},()=>provider);
 const body={name:'Fictício',email:user.email,password:'fictional-long-password',confirmPassword:'fictional-long-password',accepted:true};
 assert.equal((await auth.signup({socket:{remoteAddress:'fixture'}},{},{storage:{}},body)).redirect,'/app');assert.equal(rotated.user.id,user.id);assert.deepEqual(calls,['has_account_access','accept_legal_documents']);assert.deepEqual(signupInput.options,{data:{name:body.name}});
});
test('Cadastro sem sessão não simula acesso; erros e senha inválida não criam cookie',async()=>{
 let writes=0,rotations=0;const store={async write(){writes++;},async rotate(){rotations++;}};
 const body={name:'Fictício',email:'a@example.invalid',password:'fictional-long-password',confirmPassword:'fictional-long-password',accepted:true};
 const request={socket:{remoteAddress:'fixture'}};
 const auth=new AuthService(config(),store,()=>({auth:{async signUp(){return {data:{user:{id:'fixture'},session:null},error:null};}}}));
 await assert.rejects(auth.signup(request,{},{storage:{}},body),e=>e.status===503);assert.equal(rotations,0);
 await assert.rejects(auth.signup(request,{},{storage:{}},{...body,password:'short'}),e=>e.status===400);
 const failed=new AuthService(config(),store,()=>({auth:{async signUp(){return {data:null,error:{status:400,code:'user_already_exists'}};}}}));
 await assert.rejects(failed.signup(request,{},{storage:{}},body),e=>e.status===400);assert.equal(rotations,0);assert.equal(writes,1);
});
test('Aceite independente de cadastro público; suspensão encerra a sessão da própria conta',async()=>{
 let enabled=true,removed;const user={id:'fixture-A',email_confirmed_at:'2026-10-12'};
 const auth=new AuthService(config(),{async remove(id){removed=id;}},()=>({auth:{async getUser(){return {data:{user},error:null};}},async rpc(name){return {data:name==='has_account_access'?enabled:null,error:null};}}));
 const session={id:'fixture-session',auth:{expires_at:9999999999}};
 assert.equal((await auth.accept(session,{accepted:true})).redirect,'/app');enabled=false;
 await assert.rejects(auth.verified(session),e=>e.status===401);assert.equal(removed,session.id);
});
test('Falhas Vercel geram somente status e duração, sem URL, tokens ou dados financeiros',async()=>{
 const lines=[],original=console.error;console.error=s=>lines.push(s);
 try{const res=new EventEmitter();res.writeHead=status=>{res.statusCode=status;};res.end=()=>res.emit('finish');
 await createVercelHandler({env:{}})({url:'/auth/confirm?token_hash=SECRET&valor=123',headers:{}},res);
 assert.equal(lines.length,1);assert.deepEqual(Object.keys(JSON.parse(lines[0])).sort(),['duration_ms','event','status']);assert.equal(JSON.parse(lines[0]).status,503);assert.ok(!lines[0].includes('SECRET'));
 }finally{console.error=original;}
});
