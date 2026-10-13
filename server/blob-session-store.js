'use strict';
const crypto=require('node:crypto');
const {SessionStore}=require('./session-store');
const unavailable=(safeCode='session_storage_unavailable')=>Object.assign(Error('A sessão está ocupada ou o armazenamento não respondeu. Tente novamente.'),{status:503,safeCode});
class BlobSessionStore{
 constructor(config,blobs){
  this.key=Buffer.from(config.secret||'','base64');if(this.key.length!==32)throw Error('Armazenamento de sessão exige SESSION_SECRET base64 de 32 bytes.');
  this.days=config.sessionDays;this.secure=config.secure;if(!this.secure)throw Error('Armazenamento de sessão exige HTTPS.');
  this.cookieName='__Host-fa-session';this.blobs={};
  for(const method of ['get','getWithMetadata','set','setJSON','delete'])this.blobs[method]=async(...args)=>{try{return await blobs[method](...args);}catch{throw unavailable('blob_'+method+'_failed');}};
  this.blobs.list=async function*(options){try{yield* blobs.list(options);}catch{throw unavailable();}};
  this.etags=new Map();this.revoked=new Set();this.lease=null;
 }
 seal(data){return SessionStore.prototype.seal.call(this,data);}
 unseal(value){return SessionStore.prototype.unseal.call(this,value);}
 cookie(req){return SessionStore.prototype.cookie.call(this,req);}
 setCookie(res,id,seconds){return SessionStore.prototype.setCookie.call(this,res,id,seconds);}
 digest(value){return crypto.createHmac('sha256',this.key).update(value).digest('hex');}
 sessionKey(id){if(!/^[a-f0-9]{64}$/.test(id))throw Error('Identificador de sessão inválido.');return 'sessions/'+this.digest(id);}
 async epoch(userId){return await this.blobs.get('epochs/'+this.digest(userId),{type:'text',consistency:'strong'})||'0';}
 assertLease(){if(this.lease&&this.lease.until<=Date.now())throw unavailable('session_lease_expired');}
 async read(id){
  if(!id)return null;const key=this.sessionKey(id),entry=await this.blobs.getWithMetadata(key,{type:'text',consistency:'strong'});if(!entry)return null;
  this.etags.set(id,entry.etag);let data;try{data=this.unseal(entry.data);}catch{return null;}
  if(data.revoked||data.id!==id||data.expires<=Date.now()){this.revoked.add(id);return null;}
  if(data.auth?.user?.id&&data.userEpoch!==await this.epoch(data.auth.user.id)){this.revoked.add(id);return null;}
  return data;
 }
 async write(data){
  this.assertLease();if(this.revoked.has(data.id))throw unavailable();
  if(data.auth?.user?.id&&data.userEpoch!==await this.epoch(data.auth.user.id))throw Object.assign(Error('Entre novamente para continuar.'),{status:401});
  const etag=this.etags.get(data.id),result=await this.blobs.set(this.sessionKey(data.id),this.seal(data),{metadata:{expires:data.expires},...(etag?{onlyIfMatch:etag}:{onlyIfNew:true})});
  if(!result.modified||!result.etag)throw unavailable('session_write_conflict');this.etags.set(data.id,result.etag);
 }
 async remove(id){
  if(!id||this.revoked.has(id))return;this.assertLease();let etag=this.etags.get(id);
  if(!etag){const current=await this.blobs.getWithMetadata(this.sessionKey(id),{type:'text',consistency:'strong'});if(!current)return;etag=current.etag;}
  const expires=Date.now()+86400000,result=await this.blobs.set(this.sessionKey(id),this.seal({id,revoked:true,expires}),{onlyIfMatch:etag,metadata:{expires}});
  if(!result.modified)throw unavailable('session_revoke_conflict');this.etags.set(id,result.etag);this.revoked.add(id);
 }
 async anonymous(res){const data={id:crypto.randomBytes(32).toString('hex'),csrf:crypto.randomBytes(32).toString('hex'),created:Date.now(),expires:Date.now()+3600000,storage:{}};await this.write(data);this.setCookie(res,data.id,3600);return data;}
 async rotate(res,old,auth,extra={}){
  const data={id:crypto.randomBytes(32).toString('hex'),csrf:crypto.randomBytes(32).toString('hex'),created:Date.now(),expires:Date.now()+this.days*86400000,storage:{},auth,...extra};
  if(auth?.user?.id)data.userEpoch=await this.epoch(auth.user.id);
  await this.write(data);await this.remove(old?.id);this.setCookie(res,data.id,this.days*86400);return data;
 }
 async invalidateUser(userId){this.assertLease();const result=await this.blobs.set('epochs/'+this.digest(userId),crypto.randomBytes(32).toString('hex'));if(!result.modified)throw unavailable();}
 async locked(id,operation){
  const key='locks/'+this.digest(id),owner=crypto.randomBytes(16).toString('hex'),deadline=Date.now()+8000;let lease;
  do{
   const current=await this.blobs.getWithMetadata(key,{type:'json',consistency:'strong'});
   if(!current||current.data.until<=Date.now()){
    const until=Date.now()+90000,result=await this.blobs.setJSON(key,{owner,until},{metadata:{expires:until+86400000},...(current?{onlyIfMatch:current.etag}:{onlyIfNew:true})});
    if(result.modified){lease={etag:result.etag,until};break;}
   }
   await new Promise(resolve=>setTimeout(resolve,100));
  }while(Date.now()<deadline);
  if(!lease)throw unavailable('session_lock_timeout');this.lease=lease;
  try{return await operation();}finally{
   this.lease=null;
   // Delete only the exact lock version acquired by this worker. An expired
   // lease may already belong to another worker, so a mismatched ETag is safe.
   let etag=lease.etag,released=false;
   for(let attempt=0;attempt<2&&!released;attempt++){
    try{released=(await this.blobs.delete(key,{ifMatch:etag})).deleted;if(released)break;}catch{/* Retry only while we still own this bounded lease. */}
    try{const current=await this.blobs.getWithMetadata(key,{type:'json',consistency:'strong'});if(!current||current.data.owner!==owner){released=true;break;}etag=current.etag;}catch{break;}
   }
   if(!released)console.error(JSON.stringify({event:'session_failure',code:'session_lock_release_failed'}));
  }
 }
 async rateLimit(ip,route,maximum){
  const now=Date.now(),bucket=Math.floor(now/600000),key='rates/'+this.digest(ip+'|'+route+'|'+bucket);
  for(let attempt=0;attempt<8;attempt++){
   const current=await this.blobs.getWithMetadata(key,{type:'json',consistency:'strong'}),count=(current?.data.count||0)+1;
   if(count>maximum)return false;
   const result=await this.blobs.setJSON(key,{count},{metadata:{expires:(bucket+2)*600000},...(current?{onlyIfMatch:current.etag}:{onlyIfNew:true})});
   if(result.modified)return true;
  }
  throw unavailable();
 }
 async prune(){
  // Revocation epochs are deliberately retained; deleting them could restore old sessions.
  // Do not delete lock objects: unconditional deletion could race a new lease.
  for(const prefix of ['sessions/','rates/']){
   for await(const page of this.blobs.list({prefix,paginate:true}))for(const blob of page.blobs){
    const item=await this.blobs.getWithMetadata(blob.key,{type:'text',consistency:'strong'});
    if(item?.metadata?.expires&&item.metadata.expires<Date.now())await this.blobs.delete(blob.key);
   }
  }
 }
}
module.exports={BlobSessionStore};
