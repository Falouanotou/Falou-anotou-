'use strict';
// Read-only diagnostics. Never fetch financial rows or print keys/tokens.
const fs=require('node:fs'),path=require('node:path');
const {configuration}=require('../server/config');
const config=configuration();
if(!config.configured)throw Error('Configure SUPABASE_URL e SUPABASE_PUBLISHABLE_KEY no ambiente local.');
async function probe(route,accept){
  const response=await fetch(config.url+route,{headers:{apikey:config.key,...(accept?{Accept:accept}:{})},signal:AbortSignal.timeout(15000)});
  let body;try{body=await response.json();}catch{body=null;}
  return {status:response.status,body};
}
(async()=>{
  const health=await probe('/auth/v1/health');
  const settings=await probe('/auth/v1/settings');
  const schema=await probe('/rest/v1/','application/openapi+json');
  const tables={};
  for(const table of ['profiles','legal_acceptances','user_settings','custom_categories','merchants','ledger_versions','ledger_entries','receipt_items','entitlements']){
    // limit=0 ensures no customer rows are returned. [] does not prove RLS.
    const result=await probe(`/rest/v1/${table}?select=*&limit=0`);
    tables[table]={status:result.status,errorCode:result.body?.code||null};
  }
  const result={checkedAt:new Date().toISOString(),projectHost:new URL(config.url).hostname,
    healthStatus:health.status,settingsStatus:settings.status,
    auth:settings.status===200?{emailEnabled:settings.body?.external?.email===true,googleEnabled:settings.body?.external?.google===true,signupDisabled:settings.body?.disable_signup===true,emailAutoConfirm:settings.body?.mailer_autoconfirm===true}:null,
    openApiStatus:schema.status,exposedPaths:schema.status===200?Object.keys(schema.body?.paths||{}):[],tables,
    limits:'Metadata and zero-row queries only. No real login, user creation, financial writes, RLS guarantee or administrative configuration inspection.'};
  const output=path.resolve(__dirname,'..','..','supabase-connection-check.json');
  fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result,null,2));
})().catch(error=>{console.error('Diagnóstico interrompido:',error.message);process.exitCode=1;});
