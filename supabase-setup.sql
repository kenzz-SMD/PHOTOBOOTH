-- ============================================================
-- Timeless Strips - cloud sync + admin login setup
-- Supabase dashboard -> SQL Editor -> paste this whole file -> Run
-- (safe to run again)
-- ============================================================

-- 1) Table that holds template / strip records (images live in Storage)
create table if not exists public.ts_items (
  lib        text    not null,
  id         text    not null,
  kind       text    not null check (kind in ('template','strip')),
  data       jsonb   not null default '{}'::jsonb,
  deleted    boolean not null default false,
  updated_at bigint  not null,
  primary key (lib, id)
);
create index if not exists ts_items_lib_updated on public.ts_items (lib, updated_at);
alter table public.ts_items enable row level security;

-- 2) Who is an admin? Add your admin login email(s) here.
create table if not exists public.ts_admins (email text primary key);
alter table public.ts_admins enable row level security;     -- no policies: nobody can read/edit it from the app

-- >>> CHANGE THIS to the email of the admin user you create in Authentication -> Users <<<
insert into public.ts_admins (email) values ('beryangii@shaun.com') on conflict do nothing;

create or replace function public.ts_is_admin() returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.ts_admins
                 where lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;
grant execute on function public.ts_is_admin() to anon, authenticated;

-- 3) Row policies: everyone reads; only admins write TEMPLATES; guests may write their own STRIPS
drop policy if exists "ts read"   on public.ts_items;
drop policy if exists "ts insert" on public.ts_items;
drop policy if exists "ts update" on public.ts_items;
create policy "ts read"   on public.ts_items for select to anon, authenticated using (true);
create policy "ts insert" on public.ts_items for insert to anon, authenticated
  with check (kind = 'strip' or public.ts_is_admin());
create policy "ts update" on public.ts_items for update to anon, authenticated
  using (kind = 'strip' or public.ts_is_admin())
  with check (kind = 'strip' or public.ts_is_admin());

-- 4) Public storage bucket for the images (same rule: only admins write template images)
insert into storage.buckets (id, name, public)
values ('timeless-strips', 'timeless-strips', true)
on conflict (id) do update set public = true;

drop policy if exists "ts files insert" on storage.objects;
drop policy if exists "ts files update" on storage.objects;
drop policy if exists "ts files read"   on storage.objects;
create policy "ts files read" on storage.objects for select to anon, authenticated
  using (bucket_id = 'timeless-strips');
create policy "ts files insert" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'timeless-strips'
              and (name ~ '^[^/]+/strip/[^/]+$' or public.ts_is_admin()));
create policy "ts files update" on storage.objects for update to anon, authenticated
  using (bucket_id = 'timeless-strips'
         and (name ~ '^[^/]+/strip/[^/]+$' or public.ts_is_admin()))
  with check (bucket_id = 'timeless-strips'
         and (name ~ '^[^/]+/strip/[^/]+$' or public.ts_is_admin()));

-- 5) Real-time: push row changes to every connected device instantly
do $$ begin
  alter publication supabase_realtime add table public.ts_items;
exception when duplicate_object then null;
end $$;