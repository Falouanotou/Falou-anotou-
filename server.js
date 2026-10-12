'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {configuration}=require('./server/config'),{SessionStore}=require('./server/session-store'),{AuthService,ApiError,guard}=require('./server/auth-service'),pages=require('./server/pages');
function readJson(req,maximum=16384){return new Promise((resolve,reject)=>{if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||'')){reject(new ApiError(415,'Use uma solicitação JSON.'));req.resume();return;}let size=0,chunks=[],failed=false;req.on('data',chunk=>{size+=chunk.length;if(size>maximum){if(!failed)reject(new ApiError(413,'Arquivo/solicitação acima do limite.'));failed=true;chunks=[];}else if(!failed)chunks.push(chunk);});req.on('end',()=>{if(failed)return;try{const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!body||typeof body!=='object'||Array.isArray(body))throw Error();resolve(body);}catch{reject(new ApiError(400,'Solicitação inválida.'));}});req.on('error',reject);});}
function createHandler(config=configuration(),options={}){
  const store=options.store||new SessionStore(config),auth=options.auth||new AuthService(config,store);
  const files={'/styles.css':'styles.css','/auth.css':'auth.css','/auth.js':'auth.js','/account-api.js':'account-api.js','/app.js':'app.js','/finance-query.js':'finance-query.js','/receipt-parser.js':'receipt-parser.js','/receipt-ui.js':'receipt-ui.js','/sw.js':'sw.js','/icon.svg':'icon.svg','/manifest.webmanifest':'manifest.webmanifest'};
  const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json; charset=utf-8'};
  const json=(res,status,body)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(body));};
  const html=(res,body,status=200)=>{res.writeHead(status,{'Content-Type':'text/html; charset=utf-8'});res.end(body);};
  const redirect=(res,where)=>{res.writeHead(303,{Location:where});res.end();};
  const handler=async(req,res)=>{
    res.setHeader('Cache-Control','private, no-store');res.setHeader('Pragma','no-cache');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' https://cdn.jsdelivr.net 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' blob: data:; connect-src 'self' https://cdn.jsdelivr.net https://tessdata.projectnaptha.com; worker-src 'self' blob: https://cdn.jsdelivr.net; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'");
    if(config.secure)res.setHeader('Strict-Transport-Security','max-age=31536000');
    let url;
    try{
      guard(req.headers.host===config.host,421,'Use o endereço configurado do aplicativo.');url=new URL(req.url,config.origin);
      const route=url.pathname;guard(url.origin===config.origin,400,'Endereço de solicitação inválido.');guard(['GET','HEAD','POST'].includes(req.method),405,'Método não permitido.');
      if(route.startsWith('/api/'))guard(req.headers['sec-fetch-site']!=='cross-site',403,'Solicitação externa não permitida.');
      if(req.method==='GET'||req.method==='HEAD'){
        if(files[route]){const body=fs.readFileSync(path.join(config.root,files[route]));res.writeHead(200,{'Content-Type':mime[path.extname(files[route])]});res.end(req.method==='HEAD'?undefined:body);return;}
        if(route===config.termsPath||route===config.privacyPath){html(res,pages.legalPage(route===config.termsPath?'terms':'privacy',config));return;}
        const modes={'/login':'login','/cadastro':'signup','/recuperar-senha':'forgot','/auth/confirm':'confirm'};
        if(modes[route]){html(res,pages.authPage(modes[route],config));return;}
      }
      const existingId=store.cookie(req);
      // Finish the distributed lock release before flushing the HTTP response.
      // Serverless workers may stop after res.end(), abandoning awaited cleanup.
      let pendingResponse;
      const lockedResponse={setHeader:(name,value)=>res.setHeader(name,value),writeHead(status,headers={}){pendingResponse={status,headers};},end(body){if(!pendingResponse)throw Error('Resposta sem status.');pendingResponse.body=body;}};
      await store.locked(existingId||'anonymous-'+req.socket.remoteAddress,async()=>{
        const res=lockedResponse;
        let session=await store.read(existingId);
        if(route==='/api/auth/session'&&req.method==='GET'){
          if(!session){await auth.limited(req,'anonymous',120);session=await store.anonymous(res);}
          let user=null,needsConsent=false,recovery=false;
          if(session.auth){try{const verified=await auth.verified(session);user={id:verified.user.id,email:verified.user.email};recovery=!!session.recovery;needsConsent=!recovery&&!await auth.consent(verified.client);}catch(error){if(error.status===401||error.status===403){await store.remove(session.id);session=await store.anonymous(res);}else throw error;}}
          json(res,200,{csrf:session.csrf,user,needsConsent,recovery,config:auth.publicConfig()});return;
        }
        if(['/','/index.html','/app','/conta','/aceitar-documentos','/nova-senha'].includes(route)&&req.method==='GET'){
          try{
            if(route==='/nova-senha'){await auth.verified(session);guard(session.recovery>Date.now(),403,'Link de recuperação necessário.');html(res,pages.authPage('reset',config));return;}
            if(route==='/aceitar-documentos'){await auth.verified(session);guard(!session.recovery,403,'Conclua a recuperação.');html(res,pages.authPage('consent',config));return;}
            await auth.private(session);
            if(route==='/'||route==='/index.html'){redirect(res,'/app');return;}
            if(route==='/conta'){html(res,pages.accountPage(config));return;}
            html(res,fs.readFileSync(path.join(config.root,'index.html'),'utf8'));return;
          }catch(error){
            if(error.status===401){store.setCookie(res,'',0);redirect(res,'/login');return;}
            if(error.status===403){redirect(res,route==='/nova-senha'?'/recuperar-senha':session?.recovery?'/nova-senha':'/aceitar-documentos');return;}
            throw error;
          }
        }
        if(route.startsWith('/api/')){
          if(req.method==='POST')auth.csrf(req,session);
          let privateContext; if(route==='/api/ledger'||route==='/api/ledger/changes'||route.startsWith('/api/account')){privateContext=await auth.private(session);guard(req.headers['x-account-context']===privateContext.user.id,401,'A conta mudou em outra guia. Entre novamente.');}
          if(route==='/api/ledger'&&req.method==='GET'){json(res,200,await auth.ledger(session,privateContext));return;}
          if(route==='/api/ledger/changes'&&req.method==='POST'){json(res,200,await auth.changes(session,await readJson(req,16*1024*1024),privateContext));return;}
          if(route==='/api/account'&&req.method==='GET'){
            const {client,user}=privateContext;const results=await Promise.all([client.from('profiles').select('display_name').eq('user_id',user.id).single(),client.from('user_settings').select('read_aloud').eq('user_id',user.id).single(),client.from('custom_categories').select('name').order('name'),client.rpc('has_premium_access')]);
            guard(results.every(x=>!x.error),503,'Não consegui carregar as configurações da conta.');json(res,200,{email:user.email,name:results[0].data.display_name,readAloud:results[1].data.read_aloud,categories:results[2].data.map(x=>x.name),premium:results[3].data===true,legal:auth.publicConfig()});return;
          }
          if(route==='/api/account'&&req.method==='POST'){
            const {client,user}=privateContext,body=await readJson(req);guard((body.name===undefined||typeof body.name==='string'&&body.name.trim().length>=2&&body.name.trim().length<=100)&&typeof body.readAloud==='boolean'&&Object.keys(body).every(k=>['name','readAloud'].includes(k)),400,'Preferências inválidas.');
            const {error}=await client.rpc('update_my_preferences',{p_name:body.name===undefined?null:body.name.trim(),p_read_aloud:body.readAloud});guard(!error,503,'Não consegui salvar suas preferências.');json(res,200,{message:'Preferências salvas.'});return;
          }
          if(route==='/api/account/category'&&req.method==='POST'){
            const {client}=privateContext,body=await readJson(req);guard(typeof body.name==='string'&&body.name.trim().length>0&&body.name.trim().length<=60&&Object.keys(body).length===1,400,'Categoria inválida.');const {error}=await client.from('custom_categories').insert({name:body.name.trim()});guard(!error,409,'Essa categoria já existe ou não pôde ser criada.');json(res,200,{message:'Categoria adicionada.'});return;
          }
          const actions={'/api/auth/login':()=>auth.login(req,res,session,body),'/api/auth/signup':()=>auth.signup(req,res,session,body),'/api/auth/forgot':()=>auth.forgot(req,session,body),'/api/auth/confirm':()=>auth.confirm(res,session,body),'/api/auth/reset':()=>auth.reset(res,session,body),'/api/auth/accept':()=>auth.accept(session,body),'/api/auth/logout':()=>auth.logout(res,session)};
          let body;
          if(actions[route]&&req.method==='POST'){body=await readJson(req);json(res,200,await actions[route]());return;}
        }
        throw new ApiError(404,'Página não encontrada.');
      });
      if(pendingResponse){res.writeHead(pendingResponse.status,pendingResponse.headers);res.end(pendingResponse.body);}
    }catch(error){
      if(error.status>=500&&/^((session|blob)_[a-zA-Z_]+)$/.test(error.safeCode||''))console.error(JSON.stringify({event:'session_failure',code:error.safeCode}));
      if(res.headersSent){res.end();return;}
      const status=error.status||500,message=error.status?error.message:status===400?'Confira os dados informados.':'Não consegui concluir a solicitação.';
      if(url?.pathname.startsWith('/api/'))json(res,status,{error:message});
      else html(res,pages.authPage('login',config),status);
    }
  };
  return handler;
}
function createServer(config=configuration(),options={}){
  const store=options.store||new SessionStore(config);
  const server=http.createServer(createHandler(config,{...options,store}));
  const pruning=setInterval(()=>{try{store.prune();}catch{/* Keep request handling independent of cleanup. */}},900000);pruning.unref();server.on('close',()=>clearInterval(pruning));
  server.requestTimeout=30000;server.headersTimeout=10000;return server;
}
if(require.main===module){try{const config=configuration();const server=createServer(config);server.on('error',error=>{console.error(error.code==='EADDRINUSE'?'Porta ocupada. Encerre a instância anterior desta aplicação.':error.code||'Falha ao iniciar');process.exitCode=1;});server.listen(config.port,'127.0.0.1',()=>console.log(`Falou, Anotou! em ${config.origin}\nSupabase: ${config.configured?'configurado':'pendente — login real desabilitado'}\nPublicação não realizada. Mantenha este processo ativo para testes locais.`));}catch(error){console.error(error.message);process.exitCode=1;}}
module.exports={createServer,createHandler,readJson};
