-- Diagnóstico somente leitura. Não consulta registros de clientes ou segredos.
-- Execute no SQL Editor do projeto hlkxgjjspmdrwpkbqwuf, caso o MCP
-- administrativo ainda não esteja disponível. Não é uma migração.
begin read only;

select n.nspname as schema_name, c.relname as table_name,
       c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname in ('public','app_private') and c.relkind in ('r','p')
order by 1,2;

select table_schema,table_name,column_name,data_type,is_nullable
from information_schema.columns
where table_schema in ('public','app_private')
order by table_schema,table_name,ordinal_position;

select schemaname,tablename,policyname,roles,cmd,qual,with_check
from pg_policies
where schemaname in ('public','app_private','storage')
order by schemaname,tablename,policyname;

select routine_schema,routine_name,security_type
from information_schema.routines
where routine_schema in ('public','app_private')
order by routine_schema,routine_name;

select table_schema,table_name,grantee,privilege_type
from information_schema.table_privileges
where table_schema in ('public','app_private')
  and grantee in ('anon','authenticated','PUBLIC')
order by table_schema,table_name,grantee,privilege_type;

select n.nspname as schema_name,c.relname as table_name,t.tgname as trigger_name
from pg_trigger t join pg_class c on c.oid=t.tgrelid
join pg_namespace n on n.oid=c.relnamespace
where not t.tgisinternal and n.nspname in ('public','auth','app_private')
order by 1,2,3;

rollback;
