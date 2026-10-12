'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
class SessionStore{
  constructor(config){
    this.dir=config.runtime;this.days=config.sessionDays;this.secure=config.secure;this.cookieName=config.secure?'__Host-fa-session':'fa-dev-session';
    fs.mkdirSync(this.dir,{recursive:true,mode:0o700});
    if(config.secret){this.key=Buffer.from(config.secret,'base64');if(this.key.length!==32)throw Error('SESSION_SECRET deve ter 32 bytes em base64.');}
    else {if(config.production)throw Error('SESSION_SECRET obrigatória em produção.');const file=path.join(this.dir,'development.key');if(!fs.existsSync(file))fs.writeFileSync(file,crypto.randomBytes(32),{mode:0o600,flag:'wx'});this.key=fs.readFileSync(file);}
    this.locks=new Map();this.prune();
  }
  seal(data){const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',this.key,iv);const body=Buffer.concat([cipher.update(JSON.stringify(data),'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),body]).toString('base64url');}
  unseal(value){const data=Buffer.from(value,'base64url');if(data.length<29)throw Error('Invalid sealed data');const cipher=crypto.createDecipheriv('aes-256-gcm',this.key,data.subarray(0,12));cipher.setAuthTag(data.subarray(12,28));return JSON.parse(Buffer.concat([cipher.update(data.subarray(28)),cipher.final()]).toString('utf8'));}
  cookie(req){const v=String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(this.cookieName+'='))?.slice(this.cookieName.length+1);return v&&/^[a-f0-9]{64}$/.test(v)?v:null;}
  setCookie(res,id,seconds){const cookie=`${this.cookieName}=${id||''}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${this.secure?'; Secure':''}`;res.setHeader('Set-Cookie',cookie);}
  filename(id){if(!/^[a-f0-9]{64}$/.test(id))throw Error('Invalid session identifier');return path.join(this.dir,id+'.session');}
  read(id){if(!id)return null;try{const data=this.unseal(fs.readFileSync(this.filename(id),'utf8'));if(data.id!==id||data.expires<=Date.now()){this.remove(id);return null;}return data;}catch{return null;}}
  write(data){const file=this.filename(data.id),temp=file+'.tmp-'+crypto.randomBytes(6).toString('hex');fs.writeFileSync(temp,this.seal(data),{mode:0o600,flag:'wx'});fs.renameSync(temp,file);}
  remove(id){if(id)fs.rmSync(this.filename(id),{force:true});}
  invalidateUser(userId){for(const file of fs.readdirSync(this.dir)){if(!/^[a-f0-9]{64}\.session$/.test(file))continue;const id=file.slice(0,-8),session=this.read(id);if(session?.auth?.user?.id===userId)this.remove(id);}}
  anonymous(res){const data={id:crypto.randomBytes(32).toString('hex'),csrf:crypto.randomBytes(32).toString('hex'),created:Date.now(),expires:Date.now()+3600000,storage:{}};this.write(data);this.setCookie(res,data.id,3600);return data;}
  rotate(res,old,auth,extra={}){const data={id:crypto.randomBytes(32).toString('hex'),csrf:crypto.randomBytes(32).toString('hex'),created:Date.now(),expires:Date.now()+this.days*86400000,storage:{},auth,...extra};this.write(data);this.remove(old?.id);this.setCookie(res,data.id,this.days*86400);return data;}
  async locked(id,operation){const previous=this.locks.get(id)||Promise.resolve();let release;const current=new Promise(r=>{release=r;});this.locks.set(id,current);await previous;try{return await operation();}finally{release();if(this.locks.get(id)===current)this.locks.delete(id);}}
  prune(){for(const file of fs.readdirSync(this.dir)){if(!/^[a-f0-9]{64}\.session$/.test(file))continue;try{const data=this.unseal(fs.readFileSync(path.join(this.dir,file),'utf8'));if(data.expires<=Date.now())fs.rmSync(path.join(this.dir,file));}catch{fs.rmSync(path.join(this.dir,file));}}}
}
module.exports={SessionStore};
