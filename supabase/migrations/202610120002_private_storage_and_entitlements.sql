begin;
-- Prepared for future private files. The current app DOES NOT upload receipt images.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('receipt-private','receipt-private',false,16777216,array['image/jpeg','image/png','image/webp']) on conflict(id) do nothing;
create policy receipt_private_read on storage.objects for select to authenticated
using(bucket_id='receipt-private' and (storage.foldername(name))[1]=(select app_private.financial_user())::text and owner_id=(select auth.uid())::text);
create policy receipt_private_insert on storage.objects for insert to authenticated
with check(bucket_id='receipt-private' and (storage.foldername(name))[1]=(select app_private.financial_user())::text and owner_id=(select auth.uid())::text);
create policy receipt_private_update on storage.objects for update to authenticated
using(bucket_id='receipt-private' and (storage.foldername(name))[1]=(select app_private.financial_user())::text and owner_id=(select auth.uid())::text)
with check(bucket_id='receipt-private' and (storage.foldername(name))[1]=(select app_private.financial_user())::text and owner_id=(select auth.uid())::text);
create policy receipt_private_delete on storage.objects for delete to authenticated
using(bucket_id='receipt-private' and (storage.foldername(name))[1]=(select app_private.financial_user())::text and owner_id=(select auth.uid())::text);
create function public.has_premium_access() returns boolean language sql stable security invoker set search_path='' as $$
  select coalesce((select premium_enabled and plan<>'free' and (plan='lifetime' or access_until>now()) from public.entitlements where user_id=(select auth.uid())),false);
$$;
revoke all on function public.has_premium_access() from public,anon;
grant execute on function public.has_premium_access() to authenticated;
commit;
