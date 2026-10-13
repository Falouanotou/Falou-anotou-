'use strict';
const path=require('node:path');
function configuration(env=process.env,root=path.resolve(__dirname,'..')){
  const production=env.NODE_ENV==='production',port=Number(env.PORT||8080),origin=new URL(env.APP_ORIGIN||`http://localhost:${port}`);
  if(!Number.isInteger(port)||port<1024||port>65535)throw Error('PORT inválida.');
  if(origin.pathname!=='/'||origin.search||origin.hash||origin.username||origin.password)throw Error('APP_ORIGIN deve conter somente protocolo, host e porta.');
  if(production&&origin.protocol!=='https:')throw Error('Produção exige APP_ORIGIN HTTPS.');
  if(!production&&origin.protocol!=='https:'&&!['localhost','127.0.0.1','[::1]'].includes(origin.hostname))throw Error('HTTP de desenvolvimento é permitido apenas em loopback.');
  const url=env.SUPABASE_URL||'',key=env.SUPABASE_PUBLISHABLE_KEY||env.SUPABASE_ANON_KEY||'';
  if(!!url!==!!key)throw Error('Informe SUPABASE_URL e a chave pública juntas.');
  if(url){const u=new URL(url);if(u.protocol!=='https:'&&!(u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname)&&!production))throw Error('Supabase exige HTTPS fora do desenvolvimento local.');if(u.pathname!=='/'||u.search||u.hash||u.username)throw Error('SUPABASE_URL inválida.');}
  if(key.startsWith('sb_secret_'))throw Error('Chave secreta não permitida: use publishable/anon.');
  if(key.split('.').length===3){try{if(JSON.parse(Buffer.from(key.split('.')[1],'base64url')).role!=='anon')throw Error('role');}catch{throw Error('JWT do Supabase deve ser anon; service_role não é permitida.');}}
  if(production&&(!url||!key))throw Error('Configure Supabase antes de iniciar em produção.');
  const legalPath=value=>{if(!/^\/[a-z0-9/-]+$/.test(value)||value.startsWith('//')||['/app','/login','/cadastro','/recuperar-senha','/nova-senha'].includes(value)||value.startsWith('/api/')||value.startsWith('/auth/'))throw Error('Caminho jurídico inválido.');return value;};
  const termsPath=legalPath(env.TERMS_PATH||'/termos-de-uso'),privacyPath=legalPath(env.PRIVACY_PATH||'/politica-de-privacidade');
  if(termsPath===privacyPath)throw Error('Termos e privacidade exigem rotas diferentes.');
  const termsVersion=env.TERMS_VERSION||'minuta-2026-10-12',privacyVersion=env.PRIVACY_VERSION||'minuta-2026-10-12';
  const email=(env.PRIVACY_CONTACT_EMAIL||'Linomaia.ib@gmail.com').trim(),whatsapp=(env.SUPPORT_WHATSAPP||'5588921615825').trim();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||/[<>"'?#]/.test(email))throw Error('E-mail de atendimento inválido.');
  if(!/^55\d{10,11}$/.test(whatsapp))throw Error('SUPPORT_WHATSAPP deve conter 55, DDD e número, somente dígitos.');
  const contacts={email,whatsapp,whatsappUrl:'https://wa.me/'+whatsapp,whatsappLabel:whatsapp.replace(/^55(\d{2})(\d{4,5})(\d{4})$/,'($1) $2-$3'),supportHours:'Segunda a sexta-feira, das 8h às 18h, horário de Brasília.',initialResponse:'Até 2 dias úteis.'};
  const company={name:env.COMPANY_NAME||'',document:env.COMPANY_DOCUMENT||'',address:env.COMPANY_ADDRESS||'',email:contacts.email};
  const legalReady=env.LEGAL_APPROVED==='true'&&env.LEGAL_PUBLISHED==='true'&&Object.values(company).every(v=>v.trim())&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(company.email)&&![termsVersion,privacyVersion].some(v=>/minuta|draft/i.test(v));
  // Legal drafts allow fictional tests, never commercial admission.
  const signupAllowed=!production||legalReady;
  const minPassword=Number(env.PASSWORD_MIN_LENGTH||15),sessionDays=Number(env.SESSION_DAYS||30);
  if(!Number.isInteger(minPassword)||minPassword<15||minPassword>128||!Number.isInteger(sessionDays)||sessionDays<1||sessionDays>30)throw Error('Limites de senha/sessão inválidos.');
  return {root,port,origin:origin.origin,host:origin.host,secure:origin.protocol==='https:',production,url,key,configured:!!url&&!!key,minPassword,sessionDays,recoveryEnabled:env.PASSWORD_RECOVERY_ENABLED==='true',termsPath,privacyPath,termsVersion,privacyVersion,company,contacts,legalReady,signupAllowed,secret:env.SESSION_SECRET||'',runtime:env.AUTH_RUNTIME_DIR||path.join(root,'.runtime')};
}
module.exports={configuration};
