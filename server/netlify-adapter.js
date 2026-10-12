'use strict';
const {Readable}=require('node:stream'),{configuration}=require('./config'),{createHandler}=require('../server');
const {BlobSessionStore}=require('./blob-session-store');
const {AuthService}=require('./auth-service');
function namespace(env){const value=env.SESSION_NAMESPACE||(env.APP_ENV==='development'?'homologacao':'producao');if(!/^[a-z][a-z0-9-]{0,47}$/.test(value))throw Error('SESSION_NAMESPACE inválido.');return value;}
function netlifyConfiguration(env,context,root){
 const origin=env.APP_ORIGIN||context.site?.url;if(!origin)throw Error('Configure APP_ORIGIN com a URL HTTPS do site.');
 const config=configuration({...env,NODE_ENV:env.APP_ENV||'production',APP_ORIGIN:origin},root);
 if(!config.secure||!config.configured)throw Error('Configure HTTPS e Supabase antes de executar na Netlify.');
 return config;
}
async function respond(request,context,{env=process.env,root,blobs,auth,clientFactory}={}){
 try{
  const config=netlifyConfiguration(env,context,root),url=new URL(request.url);
  if(url.origin!==config.origin)return new Response('Use o endereço configurado do aplicativo.',{status:421});
  if(!context.ip)throw Error('IP de origem não disponível no contexto Netlify.');
  const length=Number(request.headers.get('content-length')||0);if(length>4*1024*1024)return new Response('Solicitação acima do limite de 4 MB.',{status:413});
  const buffer=Buffer.from(await request.arrayBuffer());if(buffer.length>4*1024*1024)return new Response('Solicitação acima do limite de 4 MB.',{status:413});
  const req=Readable.from(buffer.length?[buffer]:[]);req.method=request.method;req.url=url.pathname+url.search;req.headers=Object.fromEntries(request.headers);req.headers.host=url.host;req.socket={remoteAddress:context.ip};
  const headers=new Headers(),chunks=[];let status=200,ended=false;
  const res={headersSent:false,setHeader(k,v){headers.set(k,String(v));},writeHead(code,extra={}){status=code;for(const[k,v]of Object.entries(extra))headers.set(k,String(v));this.headersSent=true;},end(value){if(value)chunks.push(Buffer.from(value));ended=true;}};
  const store=new BlobSessionStore(config,blobs);await createHandler(config,{store,...(auth?{auth}:clientFactory?{auth:new AuthService(config,store,clientFactory)}:{} )})(req,res);
  if(!ended)throw Error('Resposta incompleta.');return new Response(request.method==='HEAD'?null:Buffer.concat(chunks),{status,headers});
 }catch{
  // Never expose environment values, tokens or vendor exception details.
  return new Response(JSON.stringify({error:'Serviço temporariamente indisponível. Verifique a configuração do servidor.'}),{status:503,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
 }
}
module.exports={respond,namespace,netlifyConfiguration};
