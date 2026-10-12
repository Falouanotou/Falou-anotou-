'use strict';
// Adapt the existing encrypted session store to PRIVATE Vercel Blob.
// All reads bypass CDN cache; conditional writes retain worker coordination.
class VercelBlobs {
 constructor(sdk, namespace) {
  if (!/^[a-z][a-z0-9-]{0,47}$/.test(namespace)) throw Error('Namespace inválido.');
  this.sdk=sdk;this.prefix='falou-anotou/'+namespace+'/';
 }
 async getWithMetadata(key,options={}) {
  const result=await this.sdk.get(this.prefix+key,{access:'private',useCache:false});
  if(!result)return null;
  if(result.statusCode!==200||!result.stream||!result.blob.etag)throw Error('Leitura incompleta.');
  const envelope=JSON.parse(await new Response(result.stream).text());
  if(typeof envelope.data!=='string')throw Error('Objeto inválido.');
  return {data:options.type==='json'?JSON.parse(envelope.data):envelope.data,metadata:envelope.metadata||{},etag:result.blob.etag};
 }
 async get(key,options={}) {return (await this.getWithMetadata(key,options))?.data??null;}
 async set(key,data,options={}) {
  try {
   const result=await this.sdk.put(this.prefix+key,JSON.stringify({data,metadata:options.metadata||{}}),{
    access:'private',addRandomSuffix:false,allowOverwrite:!options.onlyIfNew,
    ...(options.onlyIfMatch?{ifMatch:options.onlyIfMatch}:{}),contentType:'application/json',cacheControlMaxAge:60
   });
   if(!result.etag)throw Error('Gravação incompleta.');
   return {modified:true,etag:result.etag};
  }catch(error){
   if(error instanceof this.sdk.BlobPreconditionFailedError)return {modified:false};
   // An existing-object failure is a conflict only after an uncached read
   // verifies it. Storage outages must never be treated as successful writes.
   if(options.onlyIfNew&&await this.getWithMetadata(key))return {modified:false};
   throw error;
  }
 }
 async setJSON(key,data,options) {return this.set(key,JSON.stringify(data),options);}
 async delete(key) {await this.sdk.del(this.prefix+key);}
 async *list({prefix=''}) {
  let cursor;
  do {
   const page=await this.sdk.list({prefix:this.prefix+prefix,limit:1000,...(cursor?{cursor}:{})});
   yield {blobs:page.blobs.map(blob=>({key:blob.pathname.slice(this.prefix.length)}))};
   cursor=page.hasMore?page.cursor:undefined;
  }while(cursor);
 }
}
module.exports={VercelBlobs};
