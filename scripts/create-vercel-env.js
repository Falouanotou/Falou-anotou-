'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const file=path.resolve(__dirname,'../.env.vercel');
if(fs.existsSync(file)){console.log('.env.vercel existente preservado.');process.exit(0);}
const url=process.env.SUPABASE_URL||'',key=process.env.SUPABASE_PUBLISHABLE_KEY||process.env.SUPABASE_ANON_KEY||'';
if(!url||!key||key.startsWith('sb_secret_'))throw Error('Configure Supabase com chave pública.');
const data=['# PRIVADO: somente variáveis de servidor Vercel; nunca Git ou arquivos públicos.','APP_ENV=development','SESSION_NAMESPACE=homologacao-vercel','APP_ORIGIN=','SUPABASE_URL='+url,'SUPABASE_PUBLISHABLE_KEY='+key,'SESSION_SECRET='+crypto.randomBytes(32).toString('base64'),'SESSION_DAYS=30','PASSWORD_MIN_LENGTH=15','GOOGLE_AUTH_ENABLED=false','LEGAL_APPROVED=false','LEGAL_PUBLISHED=false','TERMS_VERSION=minuta-2026-10-12','PRIVACY_VERSION=minuta-2026-10-12',''];
fs.writeFileSync(file,data.join('\n'),{mode:0o600,flag:'wx'});
console.log('.env.vercel gerado com novo segredo exclusivo. Valores privados omitidos.');
