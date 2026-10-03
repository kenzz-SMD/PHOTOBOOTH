-- ============================================================
-- Timeless Strips - cloud sync setup
-- Supabase dashboard -> SQL Editor -> paste this whole file -> Run (once)
-- ============================================================

-- 1) Table that holds template / strip records (images live in Storage)
create table if not exists public.ts_items (
  lib        text    not null,           -- library code shared by your devices
  id         text    not null,
  kind       text    not null check (kind in ('template','strip')),
  data       jsonb   not null default '{}'::jsonb,
  deleted    boolean not null default false,
  updated_at bigint  not null,           -- ms since epoch (last write wins)
  primary key (lib, id)
);
create index if not exists ts_items_lib_updated on public.ts_items (lib, updated_at);

alter table public.ts_items enable row level security;

drop policy if exists "ts read"   on public.ts_items;
drop policy if exists "ts insert" on public.ts_items;
drop policy if exists "ts update" on public.ts_items;
create policy "ts read"   on public.ts_items for select to anon using (true);
create policy "ts insert" on public.ts_items for insert to anon with check (true);
create policy "ts update" on public.ts_items for update to anon using (true) with check (true);

-- 2) Public storage bucket for the images
insert into storage.buckets (id, name, public)
values ('timeless-strips', 'timeless-strips', true)
on conflict (id) do update set public = true;

drop policy if exists "ts files insert" on storage.objects;
drop policy if exists "ts files update" on storage.objects;
drop policy if exists "ts files read"   on storage.objects;
create policy "ts files insert" on storage.objects for insert to anon
  with check (bucket_id = 'timeless-strips');
create policy "ts files update" on storage.objects for update to anon
  using (bucket_id = 'timeless-strips') with check (bucket_id = 'timeless-strips');
create policy "ts files read"   on storage.objects for select to anon
  using (bucket_id = 'timeless-strips');

-- NOTE: the anon key is visible to anyone who opens the site, so treat the library
-- code like a password: pick a long random one and don't share it publicly.