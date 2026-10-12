'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const file=path.resolve(__dirname,'../.env.netlify');
if(fs.existsSync(file)){console.log('.env.netlify já existe. Preservado para não invalidar sessões por trocar o segredo.');process.exit(0);}
const url=process.env.SUPABASE_URL||'',key=process.env.SUPABASE_PUBLISHABLE_KEY||process.env.SUPABASE_ANON_KEY||'';
if(!url||!key||key.startsWith('sb_secret_'))throw Error('Configure URL e chave pública Supabase no .env local antes de gerar.');
const data=['# PRIVADO: importar nas variáveis Netlify. NUNCA enviar para o diretório público ou Git.','APP_ENV=development','SESSION_NAMESPACE=homologacao','APP_ORIGIN=','SUPABASE_URL='+url,'SUPABASE_PUBLISHABLE_KEY='+key,'SESSION_SECRET='+crypto.randomBytes(32).toString('base64'),'SESSION_DAYS=30','PASSWORD_MIN_LENGTH=15','GOOGLE_AUTH_ENABLED=false','LEGAL_APPROVED=false','LEGAL_PUBLISHED=false','TERMS_VERSION=minuta-2026-10-12','PRIVACY_VERSION=minuta-2026-10-12',''];
fs.writeFileSync(file,data.join('\n'),{mode:0o600,flag:'wx'});
console.log('.env.netlify privado gerado. Preencha APP_ORIGIN com a URL HTTPS real do site e importe somente nas variáveis de Functions. Valores não exibidos.');
