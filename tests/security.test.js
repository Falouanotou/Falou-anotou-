'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {configuration}=require('../server/config'),{SessionStore}=require('../server/session-store'),{AuthService}=require('../server/auth-service'),{createServer}=require('../server'),{validateEntry}=require('../server/ledger-schema');
function setup(extra={}){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'falou-auth-test-'));const config=configuration({...extra,AUTH_RUNTIME_DIR:dir},path.resolve(__dirname,'..'));return {dir,config,store:new SessionStore(config)};}
const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;}});
test('SDK oficial gera challenge PKCE e guarda o flow ID no servidor, sem abrir um login',async()=>{
  const s=setup({SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture',GOOGLE_AUTH_ENABLED:'true'});
  try{const session=s.store.anonymous(response()),auth=new AuthService(s.config,s.store),result=await auth.google({socket:{remoteAddress:'test'}},session,{}),url=new URL(result.url),callback=new URL(url.searchParams.get('redirect_to'));
    assert.ok(url.searchParams.get('code_challenge'));assert.equal(url.searchParams.get('code_challenge_method'),'s256');assert.equal(callback.pathname,'/auth/callback');assert.equal(callback.search,'');assert.ok(session.oauth.flowId);assert.ok(s.store.read(session.id).storage[`fa-server-auth-flow-${session.oauth.flowId}-code-verifier`]);
    await assert.rejects(auth.callback(response(),session,new URL(s.config.origin+'/auth/callback?code=test&sb_flow_id=wrong')),error=>error.status===400);
  }finally{cleanup(s.dir);}
});
function cleanup(dir){const root=path.resolve(os.tmpdir());if(!path.resolve(dir).startsWith(root+path.sep+'falou-auth-test-'))throw Error('Diretório temporário de teste inesperado.');fs.rmSync(dir,{recursive:true,force:true});}
test('SDK oficial preserva verificadores distintos para e-mail padrão e recuperação (HTTP fixture)',async()=>{
 const s=setup({SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture'});
 try{
  const {createClient}=require('@supabase/supabase-js');const requests=[];
  const factory=(url,key,options)=>createClient(url,key,{...options,global:{fetch:async(url,init)=>{requests.push({url:String(url),body:JSON.parse(init.body)});return Response.json(String(url).includes('/signup')?{id:'fictional-id',email:'fixture@example.invalid',identities:[]}:{},{status:200});}}});
  const auth=new AuthService(s.config,s.store,factory),session=s.store.anonymous(response()),req={socket:{remoteAddress:'test'}};
  await auth.signup(req,session,{email:'fixture@example.invalid',name:'Fictício',password:'long-fixture-password',confirmPassword:'long-fixture-password',accepted:true});
  assert.equal(session.emailFlow.type,'email');const first=session.emailFlow.flowId;assert.ok(session.storage[`fa-server-auth-flow-${first}-code-verifier`]);
  await auth.forgot(req,session,{email:'fixture@example.invalid'});assert.equal(session.emailFlow.type,'recovery');assert.notEqual(session.emailFlow.flowId,first);
  assert.equal(s.store.read(session.id).emailFlow.flowId,session.emailFlow.flowId);
  for(const request of requests){assert.equal(new URL(request.url).searchParams.get('redirect_to'),s.config.origin+'/auth/confirm');assert.equal(request.body.code_challenge_method,'s256');assert.ok(request.body.code_challenge);}
 }finally{cleanup(s.dir);}
});
test('Confirmação padrão exige cookie/flow e não aceita elevar cadastro a recuperação pelo cliente',async()=>{
 const s=setup({SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture'});
 try{
  let calls=0;const factory=()=>({auth:{async exchangeCodeForSession(code,options){calls++;assert.equal(options.flowId,'fixture-flow');return {data:{session:{access_token:'fixture',user:{id:'fixture-user'}},user:{email:'fixture@example.invalid',email_confirmed_at:'2026-10-12'}},error:null};},async signOut(){return {error:null};}}});
  const auth=new AuthService(s.config,s.store,factory),fresh=()=>{const session=s.store.anonymous(response());session.emailFlow={flowId:'fixture-flow',type:'email',email:'fixture@example.invalid',until:Date.now()+60000};session.storage['fa-server-auth-flow-fixture-flow-code-verifier']='fixture-verifier';return session;};
  const missing=s.store.anonymous(response());await assert.rejects(auth.confirm(response(),missing,{code:'fixture-code'}),error=>error.status===400);
  const wrong=fresh();await assert.rejects(auth.confirm(response(),wrong,{code:'fixture-code',flowId:'foreign-flow'}),error=>error.status===400);assert.equal(calls,0);
  const signup=fresh();assert.equal((await auth.confirm(response(),signup,{code:'fixture-code',type:'recovery'})).redirect,'/login?notice=confirmed');assert.equal(s.store.read(signup.id),null);
  const recovery=fresh();recovery.emailFlow.type='recovery';const res=response();assert.equal((await auth.confirm(res,recovery,{code:'fixture-code',type:'email'})).redirect,'/nova-senha');
  const id=res.headers['Set-Cookie'].split(';')[0].split('=')[1];assert.ok(s.store.read(id).recovery>Date.now());assert.equal(s.store.read(recovery.id),null);
 }finally{cleanup(s.dir);}
});
test('Configuração falha fechada e não aceita segredo administrativo',()=>{assert.throws(()=>configuration({NODE_ENV:'production',APP_ORIGIN:'http://localhost:8080'}));assert.throws(()=>configuration({SUPABASE_URL:'https://test.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_secret_forbidden'}));assert.throws(()=>configuration({TERMS_PATH:'/app'}));assert.throws(()=>configuration({TERMS_PATH:'//external'}));const c=configuration({NODE_ENV:'production',APP_ORIGIN:'https://app.example.invalid',SUPABASE_URL:'https://test.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test',SESSION_SECRET:crypto.randomBytes(32).toString('base64')});assert.equal(c.signupAllowed,false);assert.equal(c.legalReady,false);});
test('Cookie opaco HttpOnly, tokens criptografados, rotação e persistência',()=>{const s=setup();try{const res=response(),anon=s.store.anonymous(res),token='TEST-TOKEN-ONLY';assert.match(res.headers['Set-Cookie'],/HttpOnly; SameSite=Lax/);const logged=s.store.rotate(res,anon,{access_token:token,refresh_token:'TEST-REFRESH'});assert.equal(s.store.read(anon.id),null);assert.equal(s.store.read(logged.id).auth.access_token,token);assert.ok(!fs.readFileSync(s.store.filename(logged.id),'utf8').includes(token));const again=new SessionStore(s.config);assert.equal(again.read(logged.id).auth.access_token,token);assert.equal(again.read('a'.repeat(64)),null);assert.throws(()=>s.store.filename('../file'));const text=fs.readFileSync(s.store.filename(logged.id),'utf8');fs.writeFileSync(s.store.filename(logged.id),text.substring(0,20)+'X'+text.substring(21));assert.equal(s.store.read(logged.id),null);}finally{cleanup(s.dir);}});
test('Origem e CSRF são obrigatórios',()=>{const s=setup();try{const auth=new AuthService(s.config,s.store),anon=s.store.anonymous(response());assert.throws(()=>auth.csrf({headers:{origin:'https://attacker.invalid','x-csrf-token':anon.csrf}},anon));assert.throws(()=>auth.csrf({headers:{origin:s.config.origin,'x-csrf-token':'wrong'}},anon));assert.doesNotThrow(()=>auth.csrf({headers:{origin:s.config.origin,'x-csrf-token':anon.csrf}},anon));}finally{cleanup(s.dir);}});
test('Dados rejeitam owner/premium e IDs legados sem id são estáveis',()=>{const old={type:'expense',amount:35,date:'2026-10-11',merchant:'Padaria'};assert.equal(validateEntry(old).id,validateEntry(old).id);assert.throws(()=>validateEntry({...old,user_id:'other'}));assert.throws(()=>validateEntry({...old,premium:true}));assert.throws(()=>validateEntry({...old,date:'2026-02-31'}));assert.throws(()=>validateEntry({...old,items:[{name:'X',quantity:-1,total:1}]}));});
test('Sem Supabase: login não é simulado, dados/rotas são bloqueados e minutas são públicas',async()=>{const port=18984,s=setup({PORT:String(port),APP_ORIGIN:'http://localhost:'+port}),server=createServer(s.config,{store:s.store});await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));try{let r=await fetch(s.config.origin+'/app',{redirect:'manual'});assert.equal(r.status,303);assert.equal(r.headers.get('location'),'/login');r=await fetch(s.config.origin+'/api/ledger');assert.equal(r.status,401);for(const route of ['/termos-de-uso','/politica-de-privacidade']){r=await fetch(s.config.origin+route);assert.equal(r.status,200);assert.ok((await r.text()).includes('MINUTA'));}for(const route of ['/.env','/.runtime/development.key','/server/auth-service.js','/supabase/migrations/202610120001_auth_and_ledger.sql'])assert.equal((await fetch(s.config.origin+route)).status,404);
const start=await fetch(s.config.origin+'/api/auth/session'),cookie=start.headers.get('set-cookie').split(';')[0],state=await start.json();assert.equal(state.user,null);assert.equal(state.config.configured,false);r=await fetch(s.config.origin+'/api/auth/login',{method:'POST',headers:{Cookie:cookie,Origin:s.config.origin,'Content-Type':'application/json','X-CSRF-Token':state.csrf},body:JSON.stringify({email:'fictional@example.invalid',password:'only-fixture-password'})});assert.equal(r.status,503);assert.match(await r.text(),/Nenhuma conta ou login foi simulado/);r=await fetch(s.config.origin+'/api/auth/login',{method:'POST',headers:{Cookie:cookie,Origin:'https://attacker.invalid','Content-Type':'application/json'},body:'{}'});assert.equal(r.status,403);assert.match(start.headers.get('cache-control'),/no-store/);assert.ok(!cookie.includes('token'));}finally{await new Promise(resolve=>server.close(resolve));cleanup(s.dir);}});
test('Contrato oficial de voz/auth: recuperação não enumera e OAuth usa PKCE com callback fixo (provedor stub apenas neste teste)',async()=>{
const s=setup({SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture',GOOGLE_AUTH_ENABLED:'true'});try{let options,captured;const factory=(url,key,opts)=>{options=opts;return {auth:{async resetPasswordForEmail(email){return {error:email.startsWith('missing')?{status:400}:null};},async signInWithOAuth(input){captured=input;opts.auth.storage.setItem('fa-server-auth-code-verifier','only-test-verifier');return {data:{url:'https://fixture.supabase.co/auth/v1/authorize?provider=google'},error:null};}}};};const auth=new AuthService(s.config,s.store,factory),session=s.store.anonymous(response()),req={socket:{remoteAddress:'test'}};const first=await auth.forgot(req,session,{email:'present@example.invalid'}),second=await auth.forgot(req,session,{email:'missing@example.invalid'});assert.deepEqual(first,second);await auth.google(req,session,{});assert.equal(options.auth.flowType,'pkce');assert.equal(options.auth.autoRefreshToken,false);assert.equal(captured.options.redirectTo,s.config.origin+'/auth/callback');assert.equal(captured.provider,'google');assert.equal(captured.options.skipBrowserRedirect,true);}finally{cleanup(s.dir);}});

test('Sessão expirada invalidada e logout termina mesmo com falha do fornecedor (stub de unidade)',async()=>{
 const s=setup({SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture'});
 try{
  const session=s.store.rotate(response(),null,{access_token:'fixture-access',refresh_token:'fixture-refresh',expires_at:1});
  const factory=()=>({auth:{async refreshSession(){return {data:{session:null},error:{status:401}};},async signOut(){throw Error('Falha de teste');}}});
  const auth=new AuthService(s.config,s.store,factory);await assert.rejects(auth.verified(session),error=>error.status===401);assert.equal(s.store.read(session.id),null);
  const another=s.store.rotate(response(),null,{access_token:'fixture-access',refresh_token:'fixture-refresh',expires_at:9999999999});const out=response();assert.equal((await auth.logout(out,another)).redirect,'/login');assert.equal(s.store.read(another.id),null);assert.match(out.headers['Set-Cookie'],/Max-Age=0/);
 }finally{cleanup(s.dir);}
});


test('Recuperação vencida não entra em loop e invalida somente a própria identidade',async()=>{
 const s=setup({SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture'});
 try{
  const a=s.store.rotate(response(),null,{user:{id:'fixture-a'},access_token:'fixture',refresh_token:'fixture',expires_at:9999999999},{recovery:1});
  const other=s.store.rotate(response(),null,{user:{id:'fixture-b'},access_token:'fixture',refresh_token:'fixture',expires_at:9999999999});
  const auth=new AuthService(s.config,s.store,()=>{throw Error('O teste de prazo não deveria chamar o provedor.');});
  await assert.rejects(auth.verified(a),error=>error.status===401);assert.equal(s.store.read(a.id),null);assert.ok(s.store.read(other.id));
  const again=s.store.rotate(response(),null,{user:{id:'fixture-a'},access_token:'fixture',refresh_token:'fixture',expires_at:9999999999});s.store.invalidateUser('fixture-a');assert.equal(s.store.read(again.id),null);assert.ok(s.store.read(other.id));
 }finally{cleanup(s.dir);}
});
