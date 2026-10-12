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
  async limited(req,route,maximum=20){if(this.store.rateLimit){guard(await this.store.rateLimit(req.socket.remoteAddress,route,maximum),429,"Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.");return;}const key=req.socket.remoteAddress+'|'+route,now=Date.now();for(const[k,v]of this.rates)if(now>v.until)this.rates.delete(k);const item=this.rates.get(key)||{count:0,until:now+600000};item.count++;this.rates.set(key,item);guard(item.count<=maximum,429,'Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.');}
  async verified(session){
    guard(session?.auth,401,'Entre novamente para continuar.');
    if(session.recovery&&session.recovery<=Date.now()){await this.store.remove(session.id);throw new ApiError(401,'O prazo de recuperação expirou. Solicite um novo link.');}
    this.ready();const client=this.client(session);
    if((session.auth.expires_at||0)*1000<Date.now()+30000){const {data,error}=await client.auth.refreshSession({refresh_token:session.auth.refresh_token});if(error||!data.session){await this.store.remove(session.id);throw new ApiError(401,'Sua sessão expirou. Entre novamente.');}session.auth=data.session;await this.store.write(session);}
    const {data,error}=await client.auth.getUser(session.auth.access_token);
    if(error){if(error.status>=500||error.name==='AuthRetryableFetchError')throw new ApiError(503,'Não consegui verificar sua sessão agora. Tente novamente.');await this.store.remove(session.id);throw new ApiError(401,'Sua sessão expirou. Entre novamente.');}
    guard(data.user?.id&&data.user.email_confirmed_at&&!data.user.is_anonymous,401,'Confirme seu e-mail e entre novamente para continuar.');
    const access=await client.rpc('has_account_access');
    guard(!access.error,503,'Não consegui verificar a autorização da conta. Tente novamente.');
    if(access.data!==true){await this.store.remove(session.id);throw new ApiError(401,'O acesso desta conta não está disponível. Entre em contato com o responsável.');}
    return {client,user:data.user};
  }
  async consent(client){const {data,error}=await client.from('legal_acceptances').select('terms_version,privacy_version').eq('terms_version',this.config.termsVersion).eq('privacy_version',this.config.privacyVersion).limit(1);if(error)throw new ApiError(503,'A configuração do banco ainda precisa ser concluída.');return !!data?.length;}
  async private(session){const result=await this.verified(session);guard(!session.recovery,403,'Conclua a recuperação de senha antes de acessar o aplicativo.');guard(!this.config.production||this.config.legalReady,403,'Os documentos aguardam conclusão e liberação.');guard(await this.consent(result.client),403,'Leia e aceite os documentos para acessar seus registros.');return result;}
  publicConfig(){const c=this.config;return {configured:c.configured,signupAllowed:c.signupAllowed,minimumPasswordLength:c.minPassword,termsPath:c.termsPath,privacyPath:c.privacyPath,termsVersion:c.termsVersion,privacyVersion:c.privacyVersion,legalDraft:!c.legalReady,development:!c.production};}
  password(input){guard(typeof input==='string'&&input.length>=this.config.minPassword&&input.length<=128,400,`Use uma senha com ${this.config.minPassword} a 128 caracteres. Uma frase longa e exclusiva funciona bem.`);}
  email(input){guard(typeof input==='string'&&input.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input),400,'Informe um e-mail válido.');return input.trim().toLowerCase();}
  async login(req,res,session,body){
    this.ready();await this.limited(req,'login');const email=this.email(body.email);guard(typeof body.password==='string'&&body.password.length<=128,400,'Informe sua senha.');
    const client=this.client(session),{data,error}=await client.auth.signInWithPassword({email,password:body.password});
    guard(!error&&data.session&&data.user?.email_confirmed_at,401,'Não foi possível entrar. Confira e-mail e senha e se o e-mail foi confirmado.');
    await this.store.rotate(res,session,data.session);return {redirect:'/app'};
  }
  async signup(req,res,session,body){
    guard(this.config.signupAllowed,403,'O cadastro aguarda a revisão e publicação dos documentos.');this.ready();await this.limited(req,'signup',10);
    const email=this.email(body.email);this.password(body.password);guard(body.password===body.confirmPassword,400,'As senhas precisam ser iguais.');
    guard(body.accepted===true,400,'Leia e aceite os Termos de Uso e a Política de Privacidade.');guard(typeof body.name==='string'&&body.name.trim().length>=2&&body.name.trim().length<=100,400,'Informe seu nome (2 a 100 caracteres).');
    const client=this.client(session),{data,error}=await client.auth.signUp({email,password:body.password,options:{data:{name:body.name.trim()}}});
    if(error){delete session.storage?.['fa-server-auth'];await this.store.write(session);
      if(['over_request_rate_limit','over_email_send_rate_limit'].includes(error.code))throw new ApiError(429,'Muitas tentativas. Aguarde antes de tentar novamente.');
      if(error.status>=500||error.name==='AuthRetryableFetchError')throw new ApiError(503,'O cadastro não respondeu. Tente novamente.');
      throw new ApiError(400,'Não consegui criar a conta. Confira os dados e as regras de senha. Se já tem uma conta, entre com sua senha.');
    }
    guard(data?.session&&data.user?.email_confirmed_at,503,'O acesso imediato ainda não está configurado no Supabase. Se a conta já foi criada, entre após o ajuste do responsável.');
    const access=await client.rpc('has_account_access');guard(!access.error&&access.data===true,503,'A conta foi criada, mas a configuração do acesso ainda precisa ser concluída.');
    const acceptance=await client.rpc('accept_legal_documents',{p_terms:this.config.termsVersion,p_privacy:this.config.privacyVersion});
    await this.store.rotate(res,session,data.session);
    return {redirect:acceptance.error?'/aceitar-documentos':'/app'};
  }
  captureEmailFlow(session,before,type,email){
    // SDK pinned in lockfile: retain the new per-flow verifier, never a client flow ID.
    const key=Object.keys(session.storage).find(k=>!before.has(k)&&/^fa-server-auth-flow-[a-zA-Z0-9_-]+-code-verifier$/.test(k));
    if(key)session.emailFlow={type,email,flowId:key.slice('fa-server-auth-flow-'.length,-'-code-verifier'.length),until:Date.now()+3600000};
  }
  async forgot(req,session,body){this.ready();guard(this.config.recoveryEnabled,503,'A recuperação por e-mail ainda não foi validada. Procure o responsável pela contratação.');await this.limited(req,'forgot');const email=this.email(body.email),client=this.client(session),before=new Set(Object.keys(session.storage));const {error}=await client.auth.resetPasswordForEmail(email,{redirectTo:this.config.origin+'/auth/confirm'});delete session.emailFlow;if(!error)this.captureEmailFlow(session,before,'recovery',email);await this.store.write(session);return {message:'Se este e-mail puder receber uma recuperação, enviaremos as instruções. Confira também a pasta de spam.'};}
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
    if(type==='recovery'){await this.store.rotate(res,session,data.session,{recovery:Date.now()+900000});return {redirect:'/nova-senha'};}
    await client.auth.signOut({scope:'local'});await this.store.remove(session.id);this.store.setCookie(res,'',0);return {redirect:'/login?notice=confirmed'};
  }
  async reset(res,session,body){
    const {client,user}=await this.verified(session);guard(session.recovery>Date.now(),403,'Solicite um novo link de recuperação.');this.password(body.password);guard(body.password===body.confirmPassword,400,'As senhas precisam ser iguais.');
    const {error}=await client.auth.updateUser({password:body.password});guard(!error,400,'Não consegui alterar a senha. Confira as regras do provedor e tente novamente.');
    try{await client.auth.signOut({scope:'global'});}catch{/* All BFF sessions are invalidated locally regardless. */}
    await this.store.invalidateUser(user.id);await this.store.remove(session.id);this.store.setCookie(res,'',0);return {redirect:'/login?notice=password-updated'};
  }
  async accept(session,body){guard(!this.config.production||this.config.legalReady,403,'Os documentos aguardam liberação.');const {client}=await this.verified(session);guard(!session.recovery,403,'Defina sua senha antes de continuar.');guard(body.accepted===true,400,'Confirme a leitura e o aceite dos documentos.');const {error}=await client.rpc('accept_legal_documents',{p_terms:this.config.termsVersion,p_privacy:this.config.privacyVersion});guard(!error,503,'Não consegui registrar o aceite. Confira a configuração do banco.');return {redirect:'/app'};}
  async logout(res,session){try{if(session?.auth&&this.config.configured){const client=this.client(session);await client.auth.signOut({scope:'local'});}}catch{/* Local BFF session must still end if the provider is unreachable. */}finally{try{await this.store.remove(session?.id);}finally{this.store.setCookie(res,'',0);}}return {redirect:'/login'};}
  async ledger(session,context){const {client}=context||await this.private(session);const {data,error}=await client.rpc('get_my_ledger');guard(!error,503,'Não consegui carregar os registros. Confira o banco e tente novamente.');return data;}
  async changes(session,body,context){const {client}=context||await this.private(session);guard(Number.isSafeInteger(body.revision)&&body.revision>=0,400,'Versão do histórico inválida.');let additions;try{additions=validateBatch(body.additions||[]);}catch{throw new ApiError(400,'Os lançamentos contêm campos inválidos. Nenhum dado foi alterado.');}guard(Array.isArray(body.removeIds)&&body.removeIds.length<=10000&&body.removeIds.every(id=>typeof id==='string'&&id.length<=120),400,'Identificadores inválidos.');const {data,error}=await client.rpc('apply_ledger_changes',{p_additions:additions,p_remove_ids:body.removeIds,p_expected_revision:body.revision});if(error){if(error.code==='40001')throw new ApiError(409,'O histórico mudou. Recarregue antes de salvar.');if(['23505','23514','22023'].includes(error.code))throw new ApiError(409,'O registro conflita com uma compra existente ou tem campos inválidos. Nenhum dado foi alterado.');throw new ApiError(503,'Não consegui salvar no banco. Nenhum sucesso foi confirmado. Tente novamente.');}return data;}
}
module.exports={AuthService,ApiError,guard,constantEqual};
