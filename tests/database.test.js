'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite'),{validateEntry}=require('../server/ledger-schema');
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',U='33333333-3333-4333-8333-333333333333';
test('Migrações e isolamento executados em PostgreSQL embutido, com identidades de teste',async()=>{
  const db=new PGlite();
  try{
    await db.exec(`create role anon;create role authenticated;create role supabase_auth_admin;create schema auth;create schema storage;
      create table auth.users(id uuid primary key,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}',is_anonymous boolean default false,deleted_at timestamptz,banned_until timestamptz);
      create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id) on delete cascade,not_after timestamptz);
      create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('session_id',current_setting('request.jwt.claim.sub',true))$$;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key,bucket_id text,name text,owner_id text);
      alter table storage.objects enable row level security;grant usage on schema storage to authenticated;grant select,insert,update,delete on storage.objects to authenticated;
      create function storage.foldername(name text) returns text[] language sql immutable as $$select (string_to_array(name,'/'))[1:greatest(array_length(string_to_array(name,'/'),1)-1,0)]$$;
      insert into auth.users(id,email_confirmed_at,raw_user_meta_data) values('${A}',now(),'{}'),('${B}',now(),'{}'),('${U}',null,'{}');`);
    await db.exec(`insert into auth.sessions(id,user_id) select id,id from auth.users;`);
    const migrations=path.join(__dirname,'..','supabase','migrations');for(const file of fs.readdirSync(migrations).sort())await db.exec(fs.readFileSync(path.join(migrations,file),'utf8'));
    assert.equal((await db.query('select count(*)::integer n from public.profiles')).rows[0].n,3);
    // Secure default: production signup gate is closed, including direct Auth hooks.
    assert.equal((await db.query(`select public.before_user_created('{}') result`)).rows[0].result.error.http_code,403);
    await db.exec(`update app_private.security_policy set environment='development';`);
    assert.deepEqual((await db.query(`select public.before_user_created('{}') result`)).rows[0].result,{});
    const as=async id=>db.exec(`reset role;set role authenticated;select set_config('request.jwt.claim.sub','${id}',false);`);
    await as(U);await assert.rejects(db.query(`select public.get_my_ledger()`));await assert.rejects(db.query(`select public.accept_legal_documents('minuta-2026-10-12','minuta-2026-10-12')`));
    await as(A);await assert.rejects(db.query('select public.get_my_ledger()'));await db.query(`select public.accept_legal_documents('minuta-2026-10-12','minuta-2026-10-12')`);
    const entry=validateEntry({id:'legacy-one',type:'expense',amount:20,date:'2026-10-11',merchant:'Mercado Fictício',category:'Supermercado',discount:2,items:[{name:'Leite',quantity:2,total:14,unit:'UN',unitPrice:7},{name:'Arroz',quantity:1,total:8,unit:'UN'}]});
    let result=(await db.query('select public.apply_ledger_changes($1::jsonb,$2::text[],$3::bigint) result',[JSON.stringify([entry]),[],0])).rows[0].result;assert.equal(result.added,1);assert.equal(result.entries.length,1);assert.equal(result.entries[0].amount,20);assert.equal((await db.query('select count(*)::integer n from public.receipt_items')).rows[0].n,2);
    result=(await db.query('select public.apply_ledger_changes($1::jsonb,$2::text[],$3::bigint) result',[JSON.stringify([entry]),[],1])).rows[0].result;assert.equal(result.added,0);assert.equal(result.skipped,1);
    await assert.rejects(db.query('select public.apply_ledger_changes($1::jsonb,$2::text[],$3::bigint)',[JSON.stringify([{...entry,amount:999}]),[],2]));
    const second={...entry,id:'must-rollback',receiptId:''};
    await assert.rejects(db.query('select public.apply_ledger_changes($1::jsonb,$2::text[],$3::bigint)',[JSON.stringify([second,{...entry,id:'invalid',user_id:B}]),['legacy-one'],2]));
    assert.equal((await db.query('select public.get_my_ledger() data')).rows[0].data.entries[0].id,'legacy-one');
    await assert.rejects(db.query('select public.apply_ledger_changes($1::jsonb,$2::text[],$3::bigint)',[JSON.stringify([]),[],0]));
    await assert.rejects(db.query(`update public.entitlements set premium_enabled=true where user_id='${A}'`));
    assert.equal((await db.query('select public.has_premium_access() allowed')).rows[0].allowed,false);
    await db.query(`insert into public.custom_categories(name) values('Teste pessoal')`);
    await db.query(`select public.update_my_preferences('Nome fictício',true)`);
    assert.equal((await db.query('select display_name from public.profiles')).rows[0].display_name,'Nome fictício');
    assert.equal((await db.query('select read_aloud from public.user_settings')).rows[0].read_aloud,true);
    await db.query(`insert into storage.objects(id,bucket_id,name,owner_id) values('44444444-4444-4444-8444-444444444444','receipt-private','${A}/nota.png','${A}')`);
    await assert.rejects(db.query(`insert into storage.objects(id,bucket_id,name,owner_id) values('55555555-5555-4555-8555-555555555555','receipt-private','${B}/nota.png','${B}')`));
    await as(B);await db.query(`select public.accept_legal_documents('minuta-2026-10-12','minuta-2026-10-12')`);
    for(const table of ['ledger_entries','receipt_items','merchants','custom_categories','storage.objects']){const qualified=table.includes('.')?table:'public.'+table;assert.equal((await db.query(`select count(*)::integer n from ${qualified}`)).rows[0].n,0,table+' isolada');}
    assert.equal((await db.query('select public.get_my_ledger() data')).rows[0].data.entries.length,0);
    await db.query(`select public.apply_ledger_changes('[]'::jsonb,array['legacy-one'],0)`);
    await assert.rejects(db.query(`insert into public.ledger_entries(user_id,id,payload) values('${A}','x','{}')`));
    await assert.rejects(db.query(`update public.profiles set user_id='${A}' where user_id='${B}'`));
    await db.exec(`reset role;update auth.users set banned_until=now()+interval '1 day' where id='${A}';`);await as(A);assert.equal((await db.query('select public.has_account_access() allowed')).rows[0].allowed,false);await assert.rejects(db.query('select public.get_my_ledger()'));await as(B);assert.equal((await db.query('select public.has_account_access() allowed')).rows[0].allowed,true);
    await db.exec(`reset role;update auth.users set banned_until=null where id='${A}';delete from auth.sessions where user_id='${A}';`);await as(A);assert.equal((await db.query('select public.has_account_access() allowed')).rows[0].allowed,false);
    await db.exec(`reset role;insert into auth.sessions(id,user_id) values('${A}','${A}');`);
    await as(A);assert.equal((await db.query('select public.get_my_ledger() data')).rows[0].data.entries.length,1);
    await db.exec('reset role');const snapshot=await db.dumpDataDir();await as(A);
    await db.query(`select public.apply_ledger_changes('[]'::jsonb,array['legacy-one'],2)`);assert.equal((await db.query('select count(*)::integer n from public.receipt_items')).rows[0].n,0);
    await db.exec(`reset role;set role anon;select set_config('request.jwt.claim.sub','',false);`);await assert.rejects(db.query('select * from public.ledger_entries'));await assert.rejects(db.query('select public.get_my_ledger()'));
    await db.exec(`reset role;update app_private.security_policy set environment='production',legal_ready=false;`);await as(A);await assert.rejects(db.query('select public.get_my_ledger()'));
    await db.exec(`reset role;delete from auth.users where id='${A}';`);
    for(const table of ['profiles','legal_acceptances','user_settings','custom_categories','merchants','ledger_versions','ledger_entries','receipt_items','entitlements'])assert.equal((await db.query(`select count(*)::integer n from public.${table} where user_id='${A}'`)).rows[0].n,0);
    assert.equal((await db.query(`select count(*)::integer n from auth.users where id='${B}'`)).rows[0].n,1);
    const restored=new PGlite({loadDataDir:snapshot});
    try{assert.equal((await restored.query(`select count(*)::integer n from public.ledger_entries where user_id='${A}'`)).rows[0].n,1);await restored.exec(`set role authenticated;select set_config('request.jwt.claim.sub','${B}',false);`);assert.equal((await restored.query('select public.get_my_ledger() data')).rows[0].data.entries.length,0);}finally{await restored.close();}
  }finally{await db.close();}
});
