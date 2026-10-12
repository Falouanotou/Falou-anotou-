'use strict';
const {createClient}=require('@supabase/supabase-js');
const crypto=require('node:crypto');
const {validateBatch}=require('./ledger-schema');
class ApiError extends Error{constructor(status,message){super(message);this.status=status;}}
const guard=(condition,status,message)=>{if(!condition)throw new ApiError(status,message);};
const constantEqual=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&crypto.timingSafeEqual(Buffer.from(a),Buffer.from(b));
class AuthService{
  constructor(config,store,clientFactory=createClient){this.config=config;this.store=store;this.clientFactory=clientFactory;this.rates=new Map();}
  ready(){guard(this.config.configured,503,'A autenticação ainda precisa ser configurada. Nenhuma conta ou login foi simulado.');}
  client(session){
    this.ready();const storage=session.storage||(session.storage={});
    if(session.auth)storage['fa-server-auth']=JSON.stringify(session.auth);
    return this.clientFactory(this.config.url,this.config.key,{auth:{storageKey:'fa-server-auth',flowType:'pkce',persistSession:true,autoRefreshToken:false,detectSessionInUrl:false,storage:{getItem:key=>storage[key]??null,setItem:(key,value)=>{storage[key]=value;},removeItem:key=>{delete storage[key];}}},global:{fetch:(url,options={})=>fetch(url,{...options,signal:options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)})}});
  }
  csrf(req,session){guard(session&&req.headers.origin===this.config.origin&&constantEqual(req.headers['x-csrf-token'],session.csrf),403,'A solicitação não pôde ser validada. Recarregue a página.');}
  limited(req,route,maximum=20){const key=req.socket.remoteAddress+'|'+route,now=Date.now();for(const[k,v]of this.rates)if(now>v.until)this.rates.delete(k);const item=this.rates.get(key)||{count:0,until:now+600000};item.count++;this.rates.set(key,item);guard(item.count<=maximum,429,'Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.');}
  async verified(session){
    guard(session?.auth,401,'Entre novamente para continuar.');
    if(session.recovery&&session.recovery<=Date.now()){this.store.remove(session.id);throw new ApiError(401,'O prazo de recuperação expirou. Solicite um novo link.');}
    this.ready();const client=this.client(session);
    if((session.auth.expires_at||0)*1000<Date.now()+30000){const {data,error}=await client.auth.refreshSession({refresh_token:session.auth.refresh_token});if(error||!data.session){this.store.remove(session.id);throw new ApiError(401,'Sua sessão expirou. Entre novamente.');}session.auth=data.session;this.store.write(session);}
    const {data,error}=await client.auth.getUser(session.auth.access_token);
    if(error){if(error.status>=500||error.name==='AuthRetryableFetchError')throw new ApiError(503,'Não consegui verificar sua sessão agora. Tente novamente.');this.store.remove(session.id);throw new ApiError(401,'Sua sessão expirou. Entre novamente.');}
    guard(data.user?.id&&data.user.email_confirmed_at&&!data.user.is_anonymous,401,'Confirme seu e-mail e entre novamente para continuar.');
    return {client,user:data.user};
  }
  async consent(client){const {data,error}=await client.from('legal_acceptances').select('terms_version,privacy_version').eq('terms_version',this.config.termsVersion).eq('privacy_version',this.config.privacyVersion).limit(1);if(error)throw new ApiError(503,'A configuração do banco ainda precisa ser concluída.');return !!data?.length;}
  async private(session){const result=await this.verified(session);guard(!session.recovery,403,'Conclua a recuperação de senha antes de acessar o aplicativo.');guard(!this.config.production||this.config.legalReady,403,'Os documentos aguardam conclusão e liberação.');guard(await this.consent(result.client),403,'Leia e aceite os documentos para acessar seus registros.');return result;}
  publicConfig(){const c=this.config;return {configured:c.configured,signupAllowed:c.signupAllowed,googleEnabled:c.google,minimumPasswordLength:c.minPassword,termsPath:c.termsPath,privacyPath:c.privacyPath,termsVersion:c.termsVersion,privacyVersion:c.privacyVersion,legalDraft:!c.legalReady,development:!c.production};}
  password(input){guard(typeof input==='string'&&input.length>=this.config.minPassword&&input.length<=128,400,`Use uma senha com ${this.config.minPassword} a 128 caracteres. Uma frase longa e exclusiva funciona bem.`);}
  email(input){guard(typeof input==='string'&&input.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input),400,'Informe um e-mail válido.');return input.trim().toLowerCase();}
  async login(req,res,session,body){
    this.ready();this.limited(req,'login');const email=this.email(body.email);guard(typeof body.password==='string'&&body.password.length<=128,400,'Informe sua senha.');
    const client=this.client(session),{data,error}=await client.auth.signInWithPassword({email,password:body.password});
    guard(!error&&data.session&&data.user?.email_confirmed_at,401,'Não foi possível entrar. Confira e-mail e senha e se o e-mail foi confirmado.');
    this.store.rotate(res,session,data.session);return {redirect:'/app'};
  }
  async signup(req,session,body){
    guard(this.config.signupAllowed,403,'O cadastro público aguarda a conclusão dos documentos.');this.ready();this.limited(req,'signup');
    const email=this.email(body.email);this.password(body.password);guard(body.password===body.confirmPassword,400,'As senhas precisam ser iguais.');
    guard(body.accepted===true,400,'Leia e aceite os Termos de Uso e a Política de Privacidade.');guard(typeof body.name==='string'&&body.name.trim().length>=2&&body.name.trim().length<=100,400,'Informe seu nome (2 a 100 caracteres).');
    const client=this.client(session),before=new Set(Object.keys(session.storage)),{data,error}=await client.auth.signUp({email,password:body.password,options:{emailRedirectTo:this.config.origin+'/auth/confirm',data:{name:body.name.trim()}}});
    delete session.emailFlow;
    if(!error&&!data?.session)this.captureEmailFlow(session,before,'email',email);
    // Never admit an automatically confirmed account when provider configuration is wrong.
    if(data?.session)await client.auth.signOut({scope:'local'});
    delete session.storage?.['fa-server-auth'];this.store.write(session);
    if(error&&['weak_password','password_too_short'].includes(error.code))throw new ApiError(400,'A senha não atende às regras do provedor. Use uma frase mais longa e exclusiva.');
    if(error&&['over_request_rate_limit','over_email_send_rate_limit'].includes(error.code))throw new ApiError(429,'Aguarde antes de solicitar outro e-mail.');
    if(error&&(error.status>=500||error.name==='AuthRetryableFetchError'))throw new ApiError(503,'O serviço de cadastro não respondeu. Tente novamente.');
    return {message:'Se o cadastro puder ser concluído, você receberá um e-mail de confirmação. Depois, entre e confirme os documentos na sua conta.'};
  }
  captureEmailFlow(session,before,type,email){
    // SDK pinned in lockfile: retain the new per-flow verifier, never a client flow ID.
    const key=Object.keys(session.storage).find(k=>!before.has(k)&&/^fa-server-auth-flow-[a-zA-Z0-9_-]+-code-verifier$/.test(k));
    if(key)session.emailFlow={type,email,flowId:key.slice('fa-server-auth-flow-'.length,-'-code-verifier'.length),until:Date.now()+3600000};
  }
  async forgot(req,session,body){this.ready();this.limited(req,'forgot');const email=this.email(body.email),client=this.client(session),before=new Set(Object.keys(session.storage));const {error}=await client.auth.resetPasswordForEmail(email,{redirectTo:this.config.origin+'/auth/confirm'});delete session.emailFlow;if(!error)this.captureEmailFlow(session,before,'recovery',email);this.store.write(session);return {message:'Se este e-mail puder receber uma recuperação, enviaremos as instruções. Confira também a pasta de spam.'};}
  async google(req,session,body){
    guard(this.config.signupAllowed,403,'O login com Google aguarda a liberação dos documentos.');this.ready();guard(this.config.google,503,'O login com Google ainda precisa ser configurado.');this.limited(req,'google');
    session.oauth={until:Date.now()+600000};
    const client=this.client(session),{data,error}=await client.auth.signInWithOAuth({provider:'google',options:{redirectTo:this.config.origin+'/auth/callback',skipBrowserRedirect:true,queryParams:{prompt:'select_account'}}});
    guard(!error&&data.url,503,'Não consegui iniciar o login com Google.');session.oauth.flowId=data.flowId||null;this.store.write(session);const url=new URL(data.url);guard(url.origin===new URL(this.config.url).origin,503,'Destino OAuth inválido.');return {url:data.url};
  }
  async callback(res,session,url){
    this.ready();guard(session?.oauth&&session.oauth.until>Date.now(),400,'O login foi cancelado ou expirou. Tente novamente.');
    const flowId=session.oauth.flowId;
    if(flowId)guard((!url.searchParams.has('sb_flow_id')||constantEqual(url.searchParams.get('sb_flow_id'),flowId))&&session.storage?.[`fa-server-auth-flow-${flowId}-code-verifier`],400,'O fluxo de login não pertence a esta sessão.');
    else guard(session.storage?.['fa-server-auth-code-verifier'],400,'O verificador de login não foi encontrado.');
    const code=url.searchParams.get('code');guard(code&&!url.searchParams.get('error'),400,'O login com Google foi cancelado.');
    const client=this.client(session);delete session.oauth;this.store.write(session);
    const {data,error}=await client.auth.exchangeCodeForSession(code,flowId?{flowId}:undefined);guard(!error&&data.session&&data.user?.email_confirmed_at,400,'Não consegui concluir o login. Tente novamente.');
    this.store.rotate(res,session,data.session);return '/app';
  }
  async confirm(res,session,body){
    this.ready();const client=this.client(session);let result,type;
    if(body.code){
      const flow=session.emailFlow;
      guard(flow&&flow.until>Date.now()&&session.storage?.[`fa-server-auth-flow-${flow.flowId}-code-verifier`],400,'Abra o link no mesmo navegador em que fez a solicitação. Se o prazo venceu, solicite outro link.');
      guard(typeof body.code==='string'&&body.code.length<=2048&&!/\s/.test(body.code)&&(!body.flowId||constantEqual(body.flowId,flow.flowId)),400,'Link de confirmação inválido.');
      type=flow.type;
      result=await client.auth.exchangeCodeForSession(body.code,{flowId:flow.flowId});
      guard(!result.error&&result.data?.user?.email?.toLowerCase()===flow.email,400,'O link expirou, já foi utilizado ou não corresponde a esta solicitação.');
      delete session.emailFlow;
    }else{
      guard(['email','recovery'].includes(body.type)&&typeof body.tokenHash==='string'&&/^[a-f0-9]{32,128}$/i.test(body.tokenHash),400,'Link de confirmação inválido.');
      type=body.type;result=await client.auth.verifyOtp({type,token_hash:body.tokenHash});
    }
    const {data,error}=result;guard(!error&&data.session&&data.user?.email_confirmed_at,400,'O link expirou ou já foi utilizado. Solicite outro.');
    if(type==='recovery'){this.store.rotate(res,session,data.session,{recovery:Date.now()+900000});return {redirect:'/nova-senha'};}
    await client.auth.signOut({scope:'local'});this.store.remove(session.id);this.store.setCookie(res,'',0);return {redirect:'/login?notice=confirmed'};
  }
  async reset(res,session,body){
    const {client,user}=await this.verified(session);guard(session.recovery>Date.now(),403,'Solicite um novo link de recuperação.');this.password(body.password);guard(body.password===body.confirmPassword,400,'As senhas precisam ser iguais.');
    const {error}=await client.auth.updateUser({password:body.password});guard(!error,400,'Não consegui alterar a senha. Confira as regras do provedor e tente novamente.');
    try{await client.auth.signOut({scope:'global'});}catch{/* All BFF sessions are invalidated locally regardless. */}
    this.store.invalidateUser(user.id);this.store.remove(session.id);this.store.setCookie(res,'',0);return {redirect:'/login?notice=password-updated'};
  }
  async accept(session,body){guard(this.config.signupAllowed,403,'Os documentos aguardam liberação.');const {client}=await this.verified(session);guard(body.accepted===true,400,'Confirme a leitura e o aceite dos documentos.');const {error}=await client.rpc('accept_legal_documents',{p_terms:this.config.termsVersion,p_privacy:this.config.privacyVersion});guard(!error,503,'Não consegui registrar o aceite. Confira a configuração do banco.');return {redirect:'/app'};}
  async logout(res,session){try{if(session?.auth&&this.config.configured){const client=this.client(session);await client.auth.signOut({scope:'local'});}}catch{/* Local BFF session must still end if the provider is unreachable. */}finally{this.store.remove(session?.id);this.store.setCookie(res,'',0);}return {redirect:'/login'};}
  async ledger(session,context){const {client}=context||await this.private(session);const {data,error}=await client.rpc('get_my_ledger');guard(!error,503,'Não consegui carregar os registros. Confira o banco e tente novamente.');return data;}
  async changes(session,body,context){const {client}=context||await this.private(session);guard(Number.isSafeInteger(body.revision)&&body.revision>=0,400,'Versão do histórico inválida.');const additions=validateBatch(body.additions||[]);guard(Array.isArray(body.removeIds)&&body.removeIds.length<=10000&&body.removeIds.every(id=>typeof id==='string'&&id.length<=120),400,'Identificadores inválidos.');const {data,error}=await client.rpc('apply_ledger_changes',{p_additions:additions,p_remove_ids:body.removeIds,p_expected_revision:body.revision});if(error){if(error.code==='40001')throw new ApiError(409,'O histórico mudou. Recarregue antes de salvar.');if(['23505','23514','22023'].includes(error.code))throw new ApiError(409,'O registro conflita com uma compra existente ou tem campos inválidos. Nenhum dado foi alterado.');throw new ApiError(503,'Não consegui salvar no banco. Nenhum sucesso foi confirmado. Tente novamente.');}return data;}
}
module.exports={AuthService,ApiError,guard,constantEqual};
