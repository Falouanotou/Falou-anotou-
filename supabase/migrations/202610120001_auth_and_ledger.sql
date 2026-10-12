begin;
create schema if not exists app_private;
revoke all on schema app_private from public, anon;
grant usage on schema app_private to authenticated, supabase_auth_admin;

create table app_private.security_policy (
  singleton boolean primary key default true check(singleton),
  environment text not null default 'production' check(environment in ('development','production')),
  legal_ready boolean not null default false,
  terms_version text not null default 'minuta-2026-10-12',
  privacy_version text not null default 'minuta-2026-10-12'
);
insert into app_private.security_policy(singleton) values(true);
revoke all on app_private.security_policy from public, anon, authenticated;

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '' check(length(display_name)<=100),
  created_at timestamptz not null default now()
);
create table public.legal_acceptances (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  terms_version text not null,
  privacy_version text not null,
  accepted_at timestamptz not null default now(),
  primary key(user_id,terms_version,privacy_version)
);
create table public.user_settings (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  read_aloud boolean not null default false,
  locale text not null default 'pt-BR' check(locale='pt-BR')
);
create table public.custom_categories (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check(length(trim(name)) between 1 and 60),
  primary key(user_id,name)
);
create table public.merchants (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check(length(trim(name)) between 1 and 100),
  primary key(user_id,name)
);
create table public.ledger_versions (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  revision bigint not null default 0 check(revision>=0)
);

create function app_private.verified_user() returns uuid language sql stable security definer set search_path='' as $$
  select id from auth.users where id=(select auth.uid()) and email_confirmed_at is not null and coalesce(is_anonymous,false)=false and deleted_at is null;
$$;
revoke all on function app_private.verified_user() from public, anon;
grant execute on function app_private.verified_user() to authenticated;
create function app_private.financial_user() returns uuid language sql stable security definer set search_path='' as $$
  select app_private.verified_user() where
    exists(select 1 from app_private.security_policy p where (p.environment='development' or p.legal_ready)
      and exists(select 1 from public.legal_acceptances a where a.user_id=app_private.verified_user() and a.terms_version=p.terms_version and a.privacy_version=p.privacy_version));
$$;
revoke all on function app_private.financial_user() from public, anon;
grant execute on function app_private.financial_user() to authenticated;

create function app_private.valid_ledger(p jsonb) returns boolean language plpgsql immutable set search_path='' as $$
declare i jsonb; d date;
begin
  if jsonb_typeof(p) is distinct from 'object' or p ?| array['user_id','owner_id','password','access_token','refresh_token','subscription','premium'] then return false; end if;
  if exists(select 1 from jsonb_object_keys(p) k where k not in ('id','type','amount','date','merchant','description','category','createdAt','demo','source','items','receiptId','discount','surcharge')) then return false; end if;
  if not (p ?& array['id','type','amount','date','category','items','createdAt','source']) then return false; end if;
  if jsonb_typeof(p->'id') is distinct from 'string' or jsonb_typeof(p->'type') is distinct from 'string' or jsonb_typeof(p->'date') is distinct from 'string' or jsonb_typeof(p->'category') is distinct from 'string' or jsonb_typeof(p->'createdAt') is distinct from 'string' or jsonb_typeof(p->'source') is distinct from 'string' then return false; end if;
  if p->>'type' not in ('expense','income') or length(p->>'id') not between 1 and 120 or p->>'id' !~ '^[a-zA-Z0-9_.:-]+$' then return false; end if;
  if jsonb_typeof(p->'amount')<>'number' or (p->>'amount')::numeric<0.01 or (p->>'amount')::numeric>=1000000000 then return false; end if;
  if (p->>'amount')::numeric*100<>trunc((p->>'amount')::numeric*100) or length(p->>'createdAt')>40 then return false; end if;
  if p->>'date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return false; end if;
  d:=(p->>'date')::date;
  if extract(year from d) not between 1900 and 2100 then return false; end if;
  if length(p->>'merchant')>100 or length(p->>'description')>200 or length(p->>'category') not between 1 and 60 then return false; end if;
  if coalesce(p->>'receiptId','')<>'' and p->>'receiptId' !~ '^[0-9]{44}$' then return false; end if;
  if p->>'source' not in ('manual','receipt') or jsonb_typeof(p->'items')<>'array' or jsonb_array_length(p->'items')>80 then return false; end if;
  if (p->>'discount')::numeric<0 or (p->>'surcharge')::numeric<0 then return false; end if;
  for i in select value from jsonb_array_elements(p->'items') loop
    if jsonb_typeof(i) is distinct from 'object' or not(i ?& array['name','total']) or jsonb_typeof(i->'name') is distinct from 'string' or length(trim(i->>'name')) not between 1 and 95 or jsonb_typeof(i->'total') is distinct from 'number' or (i->>'total')::numeric<=0 or (i->>'total')::numeric>=1000000000 then return false; end if;
    if (i->>'total')::numeric*100<>trunc((i->>'total')::numeric*100) then return false; end if;
    if i->>'quantity' is not null and ((i->>'quantity')::numeric<=0 or (i->>'quantity')::numeric>10000) then return false; end if;
    if coalesce(i->>'unit','') not in ('','UN','KG','L','CX','PCT','PC','FD') or (i->>'unitPrice')::numeric<0 then return false; end if;
  end loop;
  return true;
exception when others then return false;
end;
$$;
revoke all on function app_private.valid_ledger(jsonb) from public, anon;
grant execute on function app_private.valid_ledger(jsonb) to authenticated;
create table public.ledger_entries (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id text not null,
  payload jsonb not null check(app_private.valid_ledger(payload)),
  receipt_id text generated always as (nullif(payload->>'receiptId','')) stored,
  created_at timestamptz not null default now(),
  primary key(user_id,id),
  check(id=payload->>'id'),
  unique(user_id,receipt_id)
);
create table public.receipt_items (
  user_id uuid not null,
  entry_id text not null,
  position integer not null check(position between 1 and 80),
  name text not null,
  quantity numeric null,
  total numeric(12,2) not null check(total>0),
  unit text not null default '',
  unit_price numeric null,
  primary key(user_id,entry_id,position),
  foreign key(user_id,entry_id) references public.ledger_entries(user_id,id) on delete cascade
);
create table public.entitlements (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'free' check(plan in ('free','trial','subscription','lifetime')),
  premium_enabled boolean not null default false,
  access_until timestamptz null,
  updated_at timestamptz not null default now()
);
comment on table public.entitlements is 'Somente backend administrativo confiável ou futuro webhook validado pode alterar. Sem cobranças implementadas.';

create function app_private.new_profile() returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.profiles(user_id,display_name) values(new.id,left(coalesce(new.raw_user_meta_data->>'name',new.raw_user_meta_data->>'full_name',''),100)) on conflict do nothing;
  insert into public.user_settings(user_id) values(new.id) on conflict do nothing;
  insert into public.ledger_versions(user_id) values(new.id) on conflict do nothing;
  insert into public.entitlements(user_id) values(new.id) on conflict do nothing;
  return new;
end;
$$;
revoke all on function app_private.new_profile() from public, anon, authenticated;
create trigger on_auth_user_created after insert on auth.users for each row execute function app_private.new_profile();
insert into public.profiles(user_id,display_name) select id,left(coalesce(raw_user_meta_data->>'name',raw_user_meta_data->>'full_name',''),100) from auth.users on conflict do nothing;
insert into public.user_settings(user_id) select id from auth.users on conflict do nothing;
insert into public.ledger_versions(user_id) select id from auth.users on conflict do nothing;
insert into public.entitlements(user_id) select id from auth.users on conflict do nothing;

-- Anonymous receives no data privilege. Policies are mandatory, including direct REST calls.
alter table public.profiles enable row level security;
alter table public.legal_acceptances enable row level security;
alter table public.user_settings enable row level security;
alter table public.custom_categories enable row level security;
alter table public.merchants enable row level security;
alter table public.ledger_versions enable row level security;
alter table public.ledger_entries enable row level security;
alter table public.receipt_items enable row level security;
alter table public.entitlements enable row level security;
revoke all on public.profiles,public.legal_acceptances,public.user_settings,public.custom_categories,public.merchants,public.ledger_versions,public.ledger_entries,public.receipt_items,public.entitlements from anon,public,authenticated;
grant select on public.profiles,public.legal_acceptances,public.user_settings,public.custom_categories,public.merchants,public.ledger_versions,public.ledger_entries,public.receipt_items,public.entitlements to authenticated;
grant update(display_name) on public.profiles to authenticated;
grant update(read_aloud) on public.user_settings to authenticated;
grant insert on public.custom_categories to authenticated;
create policy profile_read on public.profiles for select to authenticated using(user_id=(select app_private.verified_user()));
create policy profile_update on public.profiles for update to authenticated using(user_id=(select app_private.verified_user())) with check(user_id=(select app_private.verified_user()));
create policy legal_read on public.legal_acceptances for select to authenticated using(user_id=(select app_private.verified_user()));
create policy settings_read on public.user_settings for select to authenticated using(user_id=(select app_private.verified_user()));
create policy settings_update on public.user_settings for update to authenticated using(user_id=(select app_private.verified_user())) with check(user_id=(select app_private.verified_user()));
create policy categories_read on public.custom_categories for select to authenticated using(user_id=(select app_private.financial_user()));
create policy categories_insert on public.custom_categories for insert to authenticated with check(user_id=(select app_private.financial_user()));
create policy merchants_read on public.merchants for select to authenticated using(user_id=(select app_private.financial_user()));
create policy revision_read on public.ledger_versions for select to authenticated using(user_id=(select app_private.financial_user()));
create policy ledger_read on public.ledger_entries for select to authenticated using(user_id=(select app_private.financial_user()));
create policy items_read on public.receipt_items for select to authenticated using(user_id=(select app_private.financial_user()));
create policy entitlements_read on public.entitlements for select to authenticated using(user_id=(select app_private.verified_user()));

create function public.accept_legal_documents(p_terms text,p_privacy text) returns void language plpgsql security definer set search_path='' as $$
declare uid uuid:=app_private.verified_user(); p app_private.security_policy;
begin
  select * into p from app_private.security_policy where singleton;
  if uid is null or p_terms<>p.terms_version or p_privacy<>p.privacy_version or (p.environment='production' and not p.legal_ready) then raise exception 'legal documents unavailable' using errcode='42501'; end if;
  insert into public.legal_acceptances(user_id,terms_version,privacy_version) values(uid,p_terms,p_privacy) on conflict do nothing;
end;
$$;
create function public.get_my_ledger() returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=app_private.financial_user(); result jsonb;
begin
  if uid is null then raise exception 'authentication and consent required' using errcode='42501'; end if;
  select jsonb_build_object('revision',(select revision from public.ledger_versions where user_id=uid),'entries',coalesce(jsonb_agg(payload order by created_at,id),'[]'::jsonb)) into result from public.ledger_entries where user_id=uid;
  return result;
end;
$$;
create function public.apply_ledger_changes(p_additions jsonb,p_remove_ids text[],p_expected_revision bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=app_private.financial_user(); rev bigint; e jsonb; old jsonb; i jsonb; n integer; added integer:=0; skipped integer:=0;
begin
  if uid is null then raise exception 'authentication and consent required' using errcode='42501'; end if;
  if jsonb_typeof(p_additions)<>'array' or jsonb_array_length(p_additions)>10000 or coalesce(array_length(p_remove_ids,1),0)>10000 then raise exception 'invalid batch' using errcode='22023'; end if;
  select revision into rev from public.ledger_versions where user_id=uid for update;
  if rev is distinct from p_expected_revision then raise exception 'revision conflict' using errcode='40001'; end if;
  delete from public.ledger_entries where user_id=uid and id=any(p_remove_ids);
  for e in select value from jsonb_array_elements(p_additions) loop
    if not app_private.valid_ledger(e) then raise exception 'invalid entry' using errcode='22023'; end if;
    select payload into old from public.ledger_entries where user_id=uid and id=e->>'id';
    if old is not null then
      if old<>e then raise exception 'conflicting entry' using errcode='23505'; end if;
      skipped:=skipped+1;continue;
    end if;
    if nullif(e->>'receiptId','') is not null and exists(select 1 from public.ledger_entries where user_id=uid and receipt_id=e->>'receiptId') then raise exception 'duplicate receipt' using errcode='23505'; end if;
    insert into public.ledger_entries(user_id,id,payload) values(uid,e->>'id',e);
    n:=0;
    for i in select value from jsonb_array_elements(e->'items') loop
      n:=n+1;insert into public.receipt_items(user_id,entry_id,position,name,quantity,total,unit,unit_price) values(uid,e->>'id',n,i->>'name',(i->>'quantity')::numeric,(i->>'total')::numeric,coalesce(i->>'unit',''),(i->>'unitPrice')::numeric);
    end loop;
    if length(trim(coalesce(e->>'merchant','')))>0 then insert into public.merchants(user_id,name) values(uid,e->>'merchant') on conflict do nothing; end if;
    added:=added+1;
  end loop;
  update public.ledger_versions set revision=revision+1 where user_id=uid;
  return public.get_my_ledger()||jsonb_build_object('added',added,'skipped',skipped);
end;
$$;
revoke all on function public.accept_legal_documents(text,text),public.get_my_ledger(),public.apply_ledger_changes(jsonb,text[],bigint) from public,anon;
grant execute on function public.accept_legal_documents(text,text),public.get_my_ledger(),public.apply_ledger_changes(jsonb,text[],bigint) to authenticated;

-- Configure this as the Supabase Before User Created hook before any production rollout.
create function public.before_user_created(event jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare p app_private.security_policy;
begin
  select * into p from app_private.security_policy where singleton;
  if p.environment='production' and not p.legal_ready then return jsonb_build_object('error',jsonb_build_object('http_code',403,'message','O cadastro público ainda não está disponível.')); end if;
  return '{}'::jsonb;
end;
$$;
revoke all on function public.before_user_created(jsonb) from public,anon,authenticated;
grant execute on function public.before_user_created(jsonb) to supabase_auth_admin;
commit;
