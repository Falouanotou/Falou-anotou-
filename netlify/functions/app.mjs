import {getStore} from '@netlify/blobs';
import adapter from '../../server/netlify-adapter.js';
export default async function(request,context){
 try{
  const blobs=getStore({name:`falou-anotou-${adapter.namespace(process.env)}`,consistency:'strong'});
  return await adapter.respond(request,context,{root:process.cwd(),blobs});
 }catch{return new Response('Configuração do servidor pendente.',{status:503,headers:{'Cache-Control':'no-store'}});}
}
export const config={path:'/*',preferStatic:true,rateLimit:{windowLimit:120,windowSize:60,aggregateBy:['ip'],action:'rate_limit'}};
