-- ============================================================
-- Timeless Strips - cloud sync + admin login setup
-- Supabase dashboard -> SQL Editor -> paste this whole file -> Run
-- (safe to run again)
-- ============================================================

-- 1) Table that holds template / strip records (images live in Storage)
create table if not exists public.ts_items (
  lib        text    not null,
  id         text    not null,
  kind       text    not null check (kind in ('template','strip','category')),
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

-- 5b) Template categories: allow the 'category' record kind.
--     (Writes stay admin-only: the policies above only let guests write 'strip' rows.)
do $$
declare c text;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.ts_items'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) ilike '%kind%' loop
    execute format('alter table public.ts_items drop constraint %I', c);
  end loop;
  alter table public.ts_items
    add constraint ts_items_kind_check check (kind in ('template','strip','category'));
end $$;

-- ============================================================
-- 6) DEVICE TRACKING (live counter, device list, usage analytics)
--    Guests only WRITE their own anonymous record; only admins can READ it.
-- ============================================================
create table if not exists public.ts_devices (
  lib        text   not null,
  id         text   not null,                 -- random id made by the browser
  type       text,                            -- mobile / tablet / desktop
  browser    text,
  os         text,
  role       text   default 'guest',          -- guest / admin
  first_seen bigint not null default (extract(epoch from now()) * 1000)::bigint,
  last_seen  bigint not null,
  primary key (lib, id)
);
create index if not exists ts_devices_seen on public.ts_devices (lib, last_seen);
alter table public.ts_devices enable row level security;

drop policy if exists "dev insert" on public.ts_devices;
drop policy if exists "dev update" on public.ts_devices;
drop policy if exists "dev read"   on public.ts_devices;
drop policy if exists "dev delete" on public.ts_devices;
create policy "dev insert" on public.ts_devices for insert to anon, authenticated with check (true);
create policy "dev update" on public.ts_devices for update to anon, authenticated using (true) with check (true);
create policy "dev read"   on public.ts_devices for select to authenticated using (public.ts_is_admin());
create policy "dev delete" on public.ts_devices for delete to authenticated using (public.ts_is_admin());

-- one row per device per 5-minute bucket it was active (bucket = epoch ms / 300000)
create table if not exists public.ts_device_activity (
  lib    text   not null,
  id     text   not null,
  bucket bigint not null,
  primary key (lib, id, bucket)
);
create index if not exists ts_activity_bucket on public.ts_device_activity (lib, bucket);
alter table public.ts_device_activity enable row level security;

drop policy if exists "act insert" on public.ts_device_activity;
drop policy if exists "act read"   on public.ts_device_activity;
drop policy if exists "act delete" on public.ts_device_activity;
create policy "act insert" on public.ts_device_activity for insert to anon, authenticated with check (true);
create policy "act read"   on public.ts_device_activity for select to authenticated using (public.ts_is_admin());
create policy "act delete" on public.ts_device_activity for delete to authenticated using (public.ts_is_admin());

-- Graph data: for each time slot -> peak devices at once (5-min resolution) + unique devices.
-- Admin devices are left out, so these numbers match the "guests" counter on the dashboard.
create or replace function public.ts_activity_stats(p_lib text, p_since bigint, p_step bigint)
returns table(slot bigint, peak int, uniq int)
language sql security definer stable set search_path = public as $$
  select (x.bucket * 300000 / p_step) as slot,
         max(x.cnt)::int              as peak,
         count(distinct x.id)::int    as uniq
  from (select a.bucket, a.id, count(*) over (partition by a.bucket) as cnt
        from public.ts_device_activity a
        left join public.ts_devices d on d.lib = a.lib and d.id = a.id
        where a.lib = p_lib and a.bucket >= p_since / 300000
          and coalesce(d.role, 'guest') <> 'admin') x
  where public.ts_is_admin()
  group by 1 order by 1;
$$;

-- Totals for a period (guests only)
create or replace function public.ts_activity_summary(p_lib text, p_since bigint)
returns table(peak int, uniq int)
language sql security definer stable set search_path = public as $$
  select coalesce(max(x.cnt), 0)::int, count(distinct x.id)::int
  from (select a.bucket, a.id, count(*) over (partition by a.bucket) as cnt
        from public.ts_device_activity a
        left join public.ts_devices d on d.lib = a.lib and d.id = a.id
        where a.lib = p_lib and a.bucket >= p_since / 300000
          and coalesce(d.role, 'guest') <> 'admin') x
  where public.ts_is_admin();
$$;

-- Housekeeping: delete tracking data older than p_before (ms since epoch)
create or replace function public.ts_cleanup(p_lib text, p_before bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.ts_is_admin() then return; end if;
  delete from public.ts_device_activity where lib = p_lib and bucket < p_before / 300000;
  delete from public.ts_devices where lib = p_lib and last_seen < p_before;
end $$;

grant execute on function public.ts_activity_stats(text, bigint, bigint) to authenticated;
grant execute on function public.ts_activity_summary(text, bigint) to authenticated;
grant execute on function public.ts_cleanup(text, bigint) to authenticated;