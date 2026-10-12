begin;
create function public.update_my_preferences(p_name text,p_read_aloud boolean) returns void
language plpgsql security definer set search_path='' as $$
declare uid uuid:=app_private.financial_user();
begin
  if uid is null then raise exception 'authentication and consent required' using errcode='42501'; end if;
  if p_read_aloud is null or (p_name is not null and length(trim(p_name)) not between 2 and 100) then raise exception 'invalid preferences' using errcode='22023'; end if;
  if p_name is not null then update public.profiles set display_name=trim(p_name) where user_id=uid; end if;
  update public.user_settings set read_aloud=p_read_aloud where user_id=uid;
end;
$$;
revoke all on function public.update_my_preferences(text,boolean) from public,anon;
grant execute on function public.update_my_preferences(text,boolean) to authenticated;
commit;
