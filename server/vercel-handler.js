'use strict';
const path=require('node:path'),{Readable}=require('node:stream');
const {configuration}=require('./config'),{createHandler}=require('../server');
const {BlobSessionStore}=require('./blob-session-store'),{VercelBlobs}=require('./vercel-blob-adapter');
function createVercelHandler({env=process.env,root=path.resolve(__dirname,'..'),sdkFactory=()=>import('@vercel/blob'),clientFactory}={}) {
 return async function(req,res){
  try {
   if(!env.APP_ORIGIN)throw Error('Origem pendente.');
   const config=configuration({...env,NODE_ENV:env.APP_ENV||'production'},root);
   if(!config.secure||!config.configured)throw Error('Configuração pendente.');
   const sdk=await sdkFactory();
   const store=new BlobSessionStore(config,new VercelBlobs(sdk,env.SESSION_NAMESPACE||'homologacao'));
   // Vercel overwrites this header with the actual visitor address.
   const ip=req.headers['x-vercel-forwarded-for'];if(typeof ip!=='string'||!ip.trim())throw Error('IP indisponível.');
   const maximum=4*1024*1024;let buffer;
   if(req.body!==undefined)buffer=typeof req.body==='string'?Buffer.from(req.body):Buffer.isBuffer(req.body)?req.body:Buffer.from(JSON.stringify(req.body));
   else {const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>maximum)break;chunks.push(Buffer.from(chunk));}buffer=size>maximum?null:Buffer.concat(chunks);}
   if(!buffer||buffer.length>maximum){res.writeHead(413);res.end('Solicitação acima do limite.');return;}
   const request=Readable.from(buffer.length?[buffer]:[]);request.method=req.method;request.url=req.url;request.headers=req.headers;request.socket={remoteAddress:ip.split(',')[0].trim()};
   const options={store};if(clientFactory){const {AuthService}=require('./auth-service');options.auth=new AuthService(config,store,clientFactory);}
   await createHandler(config,options)(request,res);
  }catch{
   if(res.headersSent){res.end();return;}
   res.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
   res.end(JSON.stringify({error:'Serviço temporariamente indisponível. Verifique a configuração do servidor.'}));
  }
 };
}
module.exports={createVercelHandler};
