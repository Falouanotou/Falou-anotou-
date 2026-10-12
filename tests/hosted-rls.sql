-- Run only in the named development project after installing migrations.
-- Real PostgreSQL/RLS checks with synthetic identities, NOT real Auth logins.
-- All fixture rows and changes are rolled back. No emails or files are sent.
begin;
select set_config('test.falou.a',gen_random_uuid()::text,true);
select set_config('test.falou.b',gen_random_uuid()::text,true);
insert into auth.users(id,email,email_confirmed_at,is_anonymous)
values(current_setting('test.falou.a')::uuid,'test-a-'||current_setting('test.falou.a')||'@example.invalid',now(),false),
      (current_setting('test.falou.b')::uuid,'test-b-'||current_setting('test.falou.b')||'@example.invalid',now(),false);

set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.falou.a'),'role','authenticated')::text,true);
select set_config('request.jwt.claim.sub',current_setting('test.falou.a'),true);
select public.accept_legal_documents('minuta-2026-10-12','minuta-2026-10-12');
do $$
declare result jsonb; entry jsonb;
begin
 entry:=jsonb_build_object('id','hosted-rls-fixture','type','expense','amount',1,'date','2026-10-12','category','Teste fictício','createdAt','2026-10-12T12:00:00.000Z','source','receipt','merchant','ESTABELECIMENTO FICTÍCIO','receiptId',repeat('1',44),'items',jsonb_build_array(jsonb_build_object('name','PRODUTO FICTÍCIO','total',1,'quantity',1,'unit','UN')));
 result:=public.apply_ledger_changes(jsonb_build_array(entry),array[]::text[],0);
 if result->>'revision'<>'1' or jsonb_array_length(result->'entries')<>1 then raise exception 'Own ledger persistence failed'; end if;
 if (select count(*) from public.receipt_items)<>1 then raise exception 'Receipt item persistence failed'; end if;
 begin
  perform public.apply_ledger_changes('[]'::jsonb,array[]::text[],0);
  raise exception 'Stale revision accepted';
 exception when serialization_failure then null;
 end;
end $$;

select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.falou.b'),'role','authenticated')::text,true);
select set_config('request.jwt.claim.sub',current_setting('test.falou.b'),true);
select public.accept_legal_documents('minuta-2026-10-12','minuta-2026-10-12');
do $$
declare affected integer;
begin
 if (select count(*) from public.ledger_entries)<>0 or (select count(*) from public.receipt_items)<>0 then raise exception 'Cross-account financial data visible'; end if;
 if (select count(*) from public.profiles where user_id=current_setting('test.falou.a')::uuid)<>0 then raise exception 'Cross-account profile visible'; end if;
 update public.profiles set display_name='FORBIDDEN' where user_id=current_setting('test.falou.a')::uuid;
 get diagnostics affected=row_count;
 if affected<>0 then raise exception 'Cross-account profile updated'; end if;
 begin
  update public.entitlements set premium_enabled=true where user_id=current_setting('test.falou.b')::uuid;
  raise exception 'Client premium mutation allowed';
 exception when insufficient_privilege then null;
 end;
 begin
  delete from public.ledger_entries;
  raise exception 'Direct financial mutation allowed';
 exception when insufficient_privilege then null;
 end;
 if jsonb_array_length(public.get_my_ledger()->'entries')<>0 then raise exception 'Cross-account RPC data visible'; end if;
end $$;

set local role anon;
do $$
begin
 begin perform public.get_my_ledger();raise exception 'Anonymous RPC allowed';exception when insufficient_privilege then null;end;
 begin perform user_id from public.profiles;raise exception 'Anonymous profile access allowed';exception when insufficient_privilege then null;end;
end $$;
rollback;
select 'PASS: hosted SQL fixtures; own persistence/items, revision conflict, cross-account read/write, premium/direct writes and anonymous access; all fixtures rolled back. NOT a real Auth or file-upload test.' as verification;
