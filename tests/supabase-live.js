'use strict';
// Real provider test: requires two existing, email-confirmed, disposable accounts.
// It does not auto-create users, send mail, simulate Google, or use service_role.
const {createClient}=require('@supabase/supabase-js'),assert=require('node:assert/strict');
const {validateEntry}=require('../server/ledger-schema');
const required=['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','TEST_USER_A_EMAIL','TEST_USER_A_PASSWORD','TEST_USER_B_EMAIL','TEST_USER_B_PASSWORD'];
if(required.some(k=>!process.env[k])){console.log('PENDENTE: integração real não executada. Configure Supabase e duas contas de teste com e-mail confirmado.');process.exit(0);}
if(process.env.NODE_ENV==='production')throw Error('Use somente um projeto de desenvolvimento com dados fictícios.');
const make=()=>createClient(process.env.SUPABASE_URL,process.env.SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
(async()=>{
 const a=make(),b=make(),anonymous=make();let id;
 try{
  const A=await a.auth.signInWithPassword({email:process.env.TEST_USER_A_EMAIL,password:process.env.TEST_USER_A_PASSWORD}),B=await b.auth.signInWithPassword({email:process.env.TEST_USER_B_EMAIL,password:process.env.TEST_USER_B_PASSWORD});assert.equal(A.error,null);assert.equal(B.error,null);assert.notEqual(A.data.user.id,B.data.user.id);assert.ok(A.data.user.email_confirmed_at&&B.data.user.email_confirmed_at);
  const terms=process.env.TERMS_VERSION||'minuta-2026-10-12',privacy=process.env.PRIVACY_VERSION||'minuta-2026-10-12';for(const client of [a,b])assert.equal((await client.rpc('accept_legal_documents',{p_terms:terms,p_privacy:privacy})).error,null);
  const before=await a.rpc('get_my_ledger');assert.equal(before.error,null);id='live-test-'+crypto.randomUUID();const entry=validateEntry({id,type:'expense',date:new Date().toISOString().slice(0,10),amount:1,merchant:'FICTÍCIO — teste de isolamento'});const added=await a.rpc('apply_ledger_changes',{p_additions:[entry],p_remove_ids:[],p_expected_revision:before.data.revision});assert.equal(added.error,null);
  const rows=await b.from('ledger_entries').select('id').eq('user_id',A.data.user.id);assert.equal(rows.error,null);assert.equal(rows.data.length,0);const denied=await b.from('entitlements').update({premium_enabled:true}).eq('user_id',B.data.user.id);assert.ok(denied.error);assert.ok((await anonymous.rpc('get_my_ledger')).error);
  console.log('OK real Supabase: login por senha de A/B confirmados, persistência, RLS cruzada, anônimo e escrita premium bloqueados.');
 }finally{
  if(id){const ledger=await a.rpc('get_my_ledger');if(!ledger.error)await a.rpc('apply_ledger_changes',{p_additions:[],p_remove_ids:[id],p_expected_revision:ledger.data.revision});}
  await a.auth.signOut({scope:'local'});await b.auth.signOut({scope:'local'});
 }
})().catch(error=>{console.error('Falha no teste real:',error.message);process.exitCode=1;});
