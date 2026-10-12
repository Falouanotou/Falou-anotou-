import {getStore} from '@netlify/blobs';
import configModule from '../../server/config.js';
import sessionModule from '../../server/blob-session-store.js';
import adapter from '../../server/netlify-adapter.js';
const {configuration}=configModule;
const {BlobSessionStore}=sessionModule;
export default async function(){
 const origin=process.env.APP_ORIGIN;if(!origin)return new Response('Configure APP_ORIGIN.',{status:503});
 const settings=configuration({...process.env,NODE_ENV:process.env.APP_ENV||'production',APP_ORIGIN:origin});
 const store=new BlobSessionStore(settings,getStore({name:`falou-anotou-${adapter.namespace(process.env)}`,consistency:'strong'}));
 await store.prune();return new Response(null,{status:204});
}
export const config={schedule:'17 4 * * *'};
