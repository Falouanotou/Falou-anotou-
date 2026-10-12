begin;
-- Ban/deletion and revoked provider sessions take effect even for unexpired JWTs.
create or replace function app_private.verified_user() returns uuid
language sql stable security definer set search_path='' as $$
  select u.id from auth.users u
  where u.id=(select auth.uid()) and u.email_confirmed_at is not null
    and not coalesce(u.is_anonymous,false) and u.deleted_at is null
    and (u.banned_until is null or u.banned_until<=now())
    and exists(select 1 from auth.sessions s where s.user_id=u.id
      and s.id::text=(select auth.jwt()->>'session_id')
      and (s.not_after is null or s.not_after>now()));
$$;
revoke all on function app_private.verified_user() from public,anon;
grant execute on function app_private.verified_user() to authenticated;
create function public.has_account_access() returns boolean
language sql stable security invoker set search_path='' as $$
 select app_private.verified_user() is not null;
$$;
revoke all on function public.has_account_access() from public,anon;
grant execute on function public.has_account_access() to authenticated;
alter table app_private.security_policy enable row level security;
commit;
