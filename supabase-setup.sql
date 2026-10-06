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

-- ============================================================
-- 7) PAID SAVES (server-authoritative limits, approvals and sales)
--    Re-running this file is safe. Payment stays free until enabled.
-- ============================================================
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.ts_pay_settings (
  lib text primary key,
  enabled boolean not null default false,
  free_saves integer not null default 3 check (free_saves >= 0),
  gif_paid boolean not null default true,
  strip_paid boolean not null default false,
  gif_price numeric(10,2) not null default 20 check (gif_price >= 0),
  strip_price numeric(10,2) not null default 20 check (strip_price >= 0),
  payment_qr_url text,
  payment_qr_label text,
  payment_link text,
  updated_at bigint not null default (extract(epoch from now()) * 1000)::bigint
);
alter table public.ts_pay_settings add column if not exists payment_qr_url text;
alter table public.ts_pay_settings add column if not exists payment_qr_label text;
alter table public.ts_pay_settings add column if not exists payment_link text;
alter table public.ts_pay_settings enable row level security;
drop policy if exists "pay settings read" on public.ts_pay_settings;
drop policy if exists "pay settings admin write" on public.ts_pay_settings;
create policy "pay settings read" on public.ts_pay_settings for select to anon, authenticated using (true);
create policy "pay settings admin write" on public.ts_pay_settings for all to authenticated
  using (public.ts_is_admin()) with check (public.ts_is_admin());

create table if not exists public.ts_pay_events (
  lib text not null,
  id text not null,
  name text not null,
  charge_mode text not null default 'inherit' check (charge_mode in ('inherit','free','paid')),
  free_saves integer check (free_saves is null or free_saves >= 0),
  gif_paid boolean,
  strip_paid boolean,
  gif_price numeric(10,2) check (gif_price is null or gif_price >= 0),
  strip_price numeric(10,2) check (strip_price is null or strip_price >= 0),
  created_at bigint not null default (extract(epoch from now()) * 1000)::bigint,
  primary key (lib, id)
);
alter table public.ts_pay_events enable row level security;
drop policy if exists "pay events read" on public.ts_pay_events;
drop policy if exists "pay events admin write" on public.ts_pay_events;
create policy "pay events read" on public.ts_pay_events for select to anon, authenticated using (true);
create policy "pay events admin write" on public.ts_pay_events for all to authenticated
  using (public.ts_is_admin()) with check (public.ts_is_admin());

create table if not exists public.ts_pay_bundles (
  lib text not null,
  id text not null,
  event_id text,
  name text not null,
  media_type text not null check (media_type in ('gif','strip')),
  quantity integer not null check (quantity > 0),
  price numeric(10,2) not null check (price >= 0),
  active boolean not null default true,
  primary key (lib, id)
);
alter table public.ts_pay_bundles enable row level security;
drop policy if exists "pay bundles read" on public.ts_pay_bundles;
drop policy if exists "pay bundles admin write" on public.ts_pay_bundles;
create policy "pay bundles read" on public.ts_pay_bundles for select to anon, authenticated using (true);
create policy "pay bundles admin write" on public.ts_pay_bundles for all to authenticated
  using (public.ts_is_admin()) with check (public.ts_is_admin());

create table if not exists public.ts_pay_usage (
  lib text not null,
  event_id text not null,
  device_id text not null,
  free_saves integer not null default 0 check (free_saves >= 0),
  updated_at bigint not null default (extract(epoch from now()) * 1000)::bigint,
  primary key (lib, event_id, device_id)
);
alter table public.ts_pay_usage enable row level security;
drop policy if exists "pay usage admin read" on public.ts_pay_usage;
create policy "pay usage admin read" on public.ts_pay_usage for select to authenticated using (public.ts_is_admin());

create table if not exists public.ts_pay_sales (
  id uuid primary key default gen_random_uuid(),
  lib text not null,
  event_id text,
  event_name text not null default 'No event',
  device_id text,
  media_type text not null check (media_type in ('gif','strip')),
  quantity integer not null check (quantity >= 0),
  gif_quantity integer not null default 0 check (gif_quantity >= 0),
  plan_id text,
  product_name text not null default '',
  payment_id text,
  test_mode boolean not null default false,
  amount numeric(10,2) not null check (amount >= 0),
  payment_method text not null check (payment_method in ('cashier_pin','counter_voucher','paymongo_test','paymongo_gcash')),
  description text not null default '',
  created_at bigint not null default (extract(epoch from now()) * 1000)::bigint
);
alter table public.ts_pay_sales drop constraint if exists ts_pay_sales_quantity_check;
alter table public.ts_pay_sales drop constraint if exists ts_pay_sales_quantity_nonnegative;
alter table public.ts_pay_sales add constraint ts_pay_sales_quantity_nonnegative check (quantity >= 0);
alter table public.ts_pay_sales add column if not exists gif_quantity integer not null default 0 check (gif_quantity >= 0);
alter table public.ts_pay_sales add column if not exists plan_id text;
alter table public.ts_pay_sales add column if not exists product_name text not null default '';
alter table public.ts_pay_sales add column if not exists payment_id text;
alter table public.ts_pay_sales add column if not exists test_mode boolean not null default false;
alter table public.ts_pay_sales drop constraint if exists ts_pay_sales_payment_method_check;
alter table public.ts_pay_sales add constraint ts_pay_sales_payment_method_check
  check (payment_method in ('cashier_pin','counter_voucher','paymongo_test','paymongo_gcash'));
create index if not exists ts_pay_sales_lib_date on public.ts_pay_sales (lib, created_at);
create index if not exists ts_pay_sales_lib_event on public.ts_pay_sales (lib, event_id, created_at);
alter table public.ts_pay_sales enable row level security;
drop policy if exists "pay sales admin read" on public.ts_pay_sales;
create policy "pay sales admin read" on public.ts_pay_sales for select to authenticated using (public.ts_is_admin());

create table if not exists public.ts_pay_vouchers (
  lib text not null,
  code_hash text not null,
  event_id text,
  media_type text not null check (media_type in ('gif','strip')),
  units_remaining integer not null check (units_remaining >= 0),
  units_total integer not null check (units_total > 0),
  created_at bigint not null default (extract(epoch from now()) * 1000)::bigint,
  primary key (lib, code_hash)
);
alter table public.ts_pay_vouchers enable row level security;

create table if not exists public.ts_pay_staff_pin (
  lib text primary key,
  pin_hash text not null,
  updated_at bigint not null default (extract(epoch from now()) * 1000)::bigint
);
alter table public.ts_pay_staff_pin enable row level security;

create table if not exists public.ts_pay_pin_attempts (
  lib text not null,
  device_id text not null,
  failures integer not null default 0,
  window_started bigint not null,
  locked_until bigint not null default 0,
  primary key (lib, device_id)
);
alter table public.ts_pay_pin_attempts enable row level security;

create table if not exists public.ts_pay_credits (
  id uuid primary key default gen_random_uuid(),
  lib text not null,
  event_id text not null,
  device_id text not null,
  media_type text not null check (media_type in ('gif','strip')),
  remaining integer not null check (remaining >= 0),
  created_at bigint not null default (extract(epoch from now()) * 1000)::bigint
);
create index if not exists ts_pay_credits_lookup on public.ts_pay_credits (lib, event_id, device_id, media_type, remaining);
alter table public.ts_pay_credits enable row level security;

create table if not exists public.ts_pay_orders (
  id text primary key,
  lib text not null,
  event_id text,
  event_name text not null,
  device_id text not null,
  media_type text not null check (media_type in ('gif','strip')),
  bundle_id text,
  plan_id text,
  product_name text not null default '',
  quantity integer not null check (quantity > 0),
  gif_quantity integer not null default 0 check (gif_quantity >= 0),
  access_days integer not null default 0 check (access_days >= 0),
  amount numeric(10,2) not null check (amount > 0),
  currency text not null default 'PHP' check (currency = 'PHP'),
  status text not null default 'pending' check (status in ('pending','paid','failed','expired')),
  last_payment_status text not null default 'pending' check (last_payment_status in ('pending','failed','paid')),
  reference_number text not null unique,
  checkout_session_id text unique,
  payment_id text,
  test_mode boolean not null default true,
  created_at bigint not null default (extract(epoch from now()) * 1000)::bigint,
  paid_at bigint
);
alter table public.ts_pay_orders add column if not exists plan_id text;
alter table public.ts_pay_orders add column if not exists product_name text not null default '';
alter table public.ts_pay_orders add column if not exists gif_quantity integer not null default 0 check (gif_quantity >= 0);
alter table public.ts_pay_orders add column if not exists access_days integer not null default 0 check (access_days >= 0);
alter table public.ts_pay_orders add column if not exists last_payment_status text not null default 'pending'
  check (last_payment_status in ('pending','failed','paid'));
create index if not exists ts_pay_orders_device_status on public.ts_pay_orders (lib, device_id, status, created_at);
create table if not exists public.ts_pay_memberships (
  lib text not null,
  event_id text not null,
  device_id text not null,
  access_until bigint not null,
  updated_at bigint not null default (extract(epoch from now()) * 1000)::bigint,
  primary key (lib, event_id, device_id)
);
create index if not exists ts_pay_memberships_lookup
  on public.ts_pay_memberships (lib, event_id, device_id, access_until);
alter table public.ts_pay_memberships enable row level security;
drop policy if exists "pay memberships admin read" on public.ts_pay_memberships;
create policy "pay memberships admin read" on public.ts_pay_memberships
  for select to authenticated using (public.ts_is_admin());
alter table public.ts_pay_orders enable row level security;
drop policy if exists "pay orders admin read" on public.ts_pay_orders;
create policy "pay orders admin read" on public.ts_pay_orders for select to authenticated
  using (public.ts_is_admin());
revoke all on public.ts_pay_orders from anon, authenticated;
grant select on public.ts_pay_orders to authenticated;
grant all on public.ts_pay_orders to service_role;

create table if not exists public.ts_pay_save_claims (
  lib text not null,
  device_id text not null,
  request_id text not null,
  result jsonb not null,
  created_at bigint not null default (extract(epoch from now()) * 1000)::bigint,
  primary key (lib, device_id, request_id)
);
alter table public.ts_pay_save_claims enable row level security;
revoke all on public.ts_pay_save_claims from anon, authenticated;
grant all on public.ts_pay_save_claims to service_role;

do $$
declare c text;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.ts_pay_sales'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) ilike '%payment_method%' loop
    execute format('alter table public.ts_pay_sales drop constraint %I', c);
  end loop;
  alter table public.ts_pay_sales
    add constraint ts_pay_sales_method_check
    check (payment_method in ('cashier_pin','counter_voucher','paymongo_gcash','paymongo_test'));
end $$;

create or replace function public.ts_pay_set_pin(p_lib text, p_pin text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.ts_is_admin() then raise exception 'Admin access required'; end if;
  if p_pin !~ '^[0-9]{4,8}$' then raise exception 'PIN must be 4 to 8 digits'; end if;
  insert into public.ts_pay_staff_pin(lib, pin_hash)
  values (p_lib, extensions.crypt(p_pin, extensions.gen_salt('bf')))
  on conflict (lib) do update set pin_hash = excluded.pin_hash,
    updated_at = (extract(epoch from now()) * 1000)::bigint;
end $$;
grant execute on function public.ts_pay_set_pin(text,text) to authenticated;

create or replace function public.ts_pay_reset_device(p_lib text, p_event_id text, p_device_id text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.ts_is_admin() then raise exception 'Admin access required'; end if;
  delete from public.ts_pay_usage
   where lib = p_lib and event_id = coalesce(nullif(p_event_id, ''), 'default') and device_id = p_device_id;
end $$;
grant execute on function public.ts_pay_reset_device(text,text,text) to authenticated;

create or replace function public.ts_pay_issue_voucher(
  p_lib text, p_code_hash text, p_event_id text, p_media_type text,
  p_quantity integer, p_amount numeric
) returns void language plpgsql security definer set search_path = public as $$
declare v_event_name text := 'No event';
begin
  if not public.ts_is_admin() then raise exception 'Admin access required'; end if;
  if p_media_type not in ('gif','strip') or p_quantity < 1 or p_amount < 0 then
    raise exception 'Invalid voucher details';
  end if;
  if p_code_hash !~ '^[0-9a-f]{64}$' then raise exception 'Invalid voucher code'; end if;
  if p_event_id is not null then
    select name into v_event_name from public.ts_pay_events where lib = p_lib and id = p_event_id;
    if not found then raise exception 'Event not found'; end if;
  end if;
  insert into public.ts_pay_vouchers(lib, code_hash, event_id, media_type, units_remaining, units_total)
  values (p_lib, p_code_hash, nullif(p_event_id, ''), p_media_type, p_quantity, p_quantity);
  insert into public.ts_pay_sales(lib, event_id, event_name, media_type, quantity, amount, payment_method, description)
  values (p_lib, nullif(p_event_id, ''), v_event_name, p_media_type, p_quantity, p_amount, 'counter_voucher', 'Counter voucher issued');
end $$;
grant execute on function public.ts_pay_issue_voucher(text,text,text,text,integer,numeric) to authenticated;

create or replace function public.ts_pay_status(
  p_lib text, p_event_id text, p_device_id text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_event text := coalesce(nullif(p_event_id, ''), 'default');
  v_enabled boolean := false;
  v_charge_mode text := 'inherit';
  v_free integer := 3;
  v_used integer := 0;
  v_gif_paid boolean := false;
  v_strip_paid boolean := false;
  v_gif_price numeric(10,2) := 0;
  v_strip_price numeric(10,2) := 0;
  v_pass_until bigint := 0;
begin
  select enabled, free_saves, gif_paid, strip_paid, gif_price, strip_price
    into v_enabled, v_free, v_gif_paid, v_strip_paid, v_gif_price, v_strip_price
    from public.ts_pay_settings where lib = p_lib;
  if not found then
    v_enabled := false; v_free := 3; v_gif_paid := false; v_strip_paid := false;
    v_gif_price := 0; v_strip_price := 0;
  end if;
  if exists (select 1 from public.ts_pay_events where lib = p_lib and id = v_event) then
    select charge_mode, coalesce(free_saves, v_free),
           coalesce(gif_paid, v_gif_paid), coalesce(strip_paid, v_strip_paid),
           coalesce(gif_price, v_gif_price), coalesce(strip_price, v_strip_price)
      into v_charge_mode, v_free, v_gif_paid, v_strip_paid, v_gif_price, v_strip_price
      from public.ts_pay_events where lib = p_lib and id = v_event;
  end if;
  if not v_enabled or v_charge_mode = 'free' then v_gif_paid := false; v_strip_paid := false; end if;
  select free_saves into v_used from public.ts_pay_usage
   where lib = p_lib and event_id = v_event and device_id = p_device_id;
  v_used := coalesce(v_used, 0);
  select max(access_until) into v_pass_until from public.ts_pay_memberships
   where lib = p_lib and event_id in (v_event, 'default') and device_id = p_device_id;
  return jsonb_build_object(
    'event_id', nullif(p_event_id, ''), 'enabled', v_enabled,
    'free_remaining', greatest(v_free - v_used, 0), 'free_total', greatest(v_free, 0),
    'gif_paid', v_gif_paid, 'strip_paid', v_strip_paid,
    'monthly_pass_until', coalesce(v_pass_until, 0),
    'monthly_pass_active', coalesce(v_pass_until, 0) > (extract(epoch from now()) * 1000)::bigint,
    'gif_price', v_gif_price, 'strip_price', v_strip_price
  );
end $$;
grant execute on function public.ts_pay_status(text,text,text) to anon, authenticated;

create or replace function public.ts_pay_consume_save(
  p_lib text, p_event_id text, p_device_id text, p_media_type text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_event text := coalesce(nullif(p_event_id, ''), 'default');
  v_enabled boolean := false;
  v_charge_mode text := 'inherit';
  v_free integer := 3;
  v_used integer := 0;
  v_gif_paid boolean := false;
  v_strip_paid boolean := false;
  v_gif_price numeric(10,2) := 0;
  v_strip_price numeric(10,2) := 0;
  v_paid boolean := false;
  v_price numeric(10,2) := 0;
  v_pass_until bigint := 0;
  v_item record;
  v_now bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  if p_media_type not in ('gif','strip') or p_device_id is null or length(p_device_id) > 100 then
    raise exception 'Invalid save request';
  end if;
  select enabled, free_saves, gif_paid, strip_paid, gif_price, strip_price
    into v_enabled, v_free, v_gif_paid, v_strip_paid, v_gif_price, v_strip_price
    from public.ts_pay_settings where lib = p_lib;
  if not found then
    v_enabled := false; v_free := 3; v_gif_paid := false; v_strip_paid := false;
    v_gif_price := 0; v_strip_price := 0;
  end if;
  v_paid := case when p_media_type = 'gif' then v_gif_paid else v_strip_paid end;
  v_price := case when p_media_type = 'gif' then v_gif_price else v_strip_price end;
  if exists (select 1 from public.ts_pay_events where lib = p_lib and id = v_event) then
    select charge_mode, coalesce(free_saves, v_free),
           coalesce(case when p_media_type = 'gif' then gif_paid else strip_paid end, v_paid),
           coalesce(case when p_media_type = 'gif' then gif_price else strip_price end, v_price)
      into v_charge_mode, v_free, v_paid, v_price
      from public.ts_pay_events where lib = p_lib and id = v_event;
  end if;
  select max(access_until) into v_pass_until from public.ts_pay_memberships
   where lib = p_lib and event_id in (v_event, 'default') and device_id = p_device_id;
  if coalesce(v_pass_until, 0) > v_now then
    return jsonb_build_object('allowed', true, 'reason', 'monthly_pass',
      'free_remaining', greatest(v_free, 0), 'free_total', greatest(v_free, 0),
      'access_until', v_pass_until);
  end if;
  v_paid := v_enabled and v_paid and v_charge_mode <> 'free';
  if not v_paid then
    return jsonb_build_object('allowed', true, 'reason', 'free', 'free_remaining', greatest(v_free, 0), 'free_total', greatest(v_free, 0));
  end if;

  update public.ts_pay_credits set remaining = remaining - 1
   where id = (
     select id from public.ts_pay_credits
      where lib = p_lib and event_id = v_event and device_id = p_device_id
        and media_type = p_media_type and remaining > 0
      order by created_at, id limit 1 for update
   ) returning * into v_item;
  if found then
    return jsonb_build_object('allowed', true, 'reason', 'paid', 'free_remaining', greatest(v_free, 0), 'free_total', greatest(v_free, 0));
  end if;

  insert into public.ts_pay_usage(lib, event_id, device_id, free_saves)
  values (p_lib, v_event, p_device_id, 0) on conflict do nothing;
  update public.ts_pay_usage set free_saves = free_saves + 1, updated_at = v_now
   where lib = p_lib and event_id = v_event and device_id = p_device_id and free_saves < v_free
   returning free_saves into v_used;
  if found then
    return jsonb_build_object('allowed', true, 'reason', 'free', 'free_remaining', greatest(v_free - v_used, 0), 'free_total', greatest(v_free, 0));
  end if;

  return jsonb_build_object('allowed', false, 'reason', 'payment_required',
    'free_remaining', 0, 'free_total', greatest(v_free, 0), 'price', v_price);
end $$;
grant execute on function public.ts_pay_consume_save(text,text,text,text) to anon, authenticated;

create or replace function public.ts_pay_purchase_save(
  p_lib text, p_event_id text, p_device_id text, p_media_type text,
  p_voucher text default null, p_staff_pin text default null, p_bundle_id text default null
) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_event text := coalesce(nullif(p_event_id, ''), 'default');
  v_enabled boolean := false;
  v_charge_mode text := 'inherit';
  v_gif_paid boolean := false;
  v_strip_paid boolean := false;
  v_gif_price numeric(10,2) := 0;
  v_strip_price numeric(10,2) := 0;
  v_paid boolean := false;
  v_price numeric(10,2) := 0;
  v_free integer := 3;
  v_event_name text := 'No event';
  v_pin_hash text;
  v_voucher record;
  v_bundle record;
  v_attempt record;
  v_units integer := 1;
  v_amount numeric(10,2);
  v_now bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  if p_media_type not in ('gif','strip') or p_device_id is null or length(p_device_id) > 100 then
    raise exception 'Invalid save request';
  end if;
  select enabled, free_saves,
         gif_paid, strip_paid, gif_price, strip_price
    into v_enabled, v_free, v_gif_paid, v_strip_paid, v_gif_price, v_strip_price
    from public.ts_pay_settings where lib = p_lib;
  if not found then raise exception 'Payment settings are not configured'; end if;
  v_paid := case when p_media_type = 'gif' then v_gif_paid else v_strip_paid end;
  v_price := case when p_media_type = 'gif' then v_gif_price else v_strip_price end;
  if exists (select 1 from public.ts_pay_events where lib = p_lib and id = v_event) then
    select charge_mode, coalesce(free_saves, v_free),
           coalesce(case when p_media_type = 'gif' then gif_paid else strip_paid end, v_paid),
           coalesce(case when p_media_type = 'gif' then gif_price else strip_price end, v_price),
           name into v_charge_mode, v_free, v_paid, v_price, v_event_name
      from public.ts_pay_events where lib = p_lib and id = v_event;
  end if;
  v_paid := v_enabled and v_paid and v_charge_mode <> 'free';
  if not v_paid then raise exception 'This save is free; refresh and try again'; end if;

  if nullif(p_voucher, '') is not null then
    select * into v_voucher from public.ts_pay_vouchers
     where lib = p_lib
       and code_hash = encode(extensions.digest(upper(trim(p_voucher)), 'sha256'), 'hex')
       and media_type = p_media_type and units_remaining > 0
       and (event_id is null or event_id = v_event)
     for update;
    if not found then raise exception 'Voucher code is invalid, used, or for a different event or format'; end if;
    update public.ts_pay_vouchers set units_remaining = units_remaining - 1
     where lib = p_lib and code_hash = v_voucher.code_hash;
    return jsonb_build_object('allowed', true, 'reason', 'voucher', 'free_remaining', 0, 'free_total', v_free);
  end if;

  select pin_hash into v_pin_hash from public.ts_pay_staff_pin where lib = p_lib;
  if v_pin_hash is null then
    return jsonb_build_object('allowed', false, 'message', 'Staff PIN has not been configured.');
  end if;
  select * into v_attempt from public.ts_pay_pin_attempts
   where lib = p_lib and device_id = p_device_id for update;
  if found and v_attempt.locked_until > v_now then
    return jsonb_build_object('allowed', false, 'message', 'Too many incorrect PIN attempts. Please wait a few minutes.');
  end if;
  if p_staff_pin is null or extensions.crypt(p_staff_pin, v_pin_hash) <> v_pin_hash then
    insert into public.ts_pay_pin_attempts(lib, device_id, failures, window_started, locked_until)
    values (p_lib, p_device_id, 1, v_now, 0)
    on conflict (lib, device_id) do update set
      failures = case when public.ts_pay_pin_attempts.window_started <= excluded.window_started - 600000
                      then 1 else public.ts_pay_pin_attempts.failures + 1 end,
      window_started = case when public.ts_pay_pin_attempts.window_started <= excluded.window_started - 600000
                            then excluded.window_started else public.ts_pay_pin_attempts.window_started end,
      locked_until = case when (case when public.ts_pay_pin_attempts.window_started <= excluded.window_started - 600000
                                     then 1 else public.ts_pay_pin_attempts.failures + 1 end) >= 5
                          then excluded.window_started + 300000 else 0 end
    returning failures, locked_until into v_attempt;
    if v_attempt.locked_until > v_now then
      return jsonb_build_object('allowed', false, 'message', 'Too many incorrect PIN attempts. Please wait a few minutes.');
    end if;
    return jsonb_build_object('allowed', false, 'message', 'Staff PIN was not accepted.');
  end if;
  delete from public.ts_pay_pin_attempts where lib = p_lib and device_id = p_device_id;
  if nullif(p_bundle_id, '') is not null then
    select * into v_bundle from public.ts_pay_bundles
     where lib = p_lib and id = p_bundle_id and active and media_type = p_media_type
       and (event_id is null or event_id = v_event)
     order by (event_id is not null) desc limit 1;
    if not found then raise exception 'That bundle is not available for this event and format'; end if;
    v_units := v_bundle.quantity;
    v_amount := v_bundle.price;
  else
    v_amount := v_price;
  end if;
  insert into public.ts_pay_sales(lib, event_id, event_name, device_id, media_type, quantity, amount, payment_method, description)
  values (p_lib, nullif(p_event_id, ''), v_event_name, p_device_id, p_media_type, v_units, v_amount, 'cashier_pin',
          case when v_units > 1 then 'Bundle: ' || v_bundle.name else 'Cashier-approved save' end);
  if v_units > 1 then
    insert into public.ts_pay_credits(lib, event_id, device_id, media_type, remaining)
    values (p_lib, v_event, p_device_id, p_media_type, v_units - 1);
  end if;
  return jsonb_build_object('allowed', true, 'reason', 'paid', 'free_remaining', 0, 'free_total', v_free);
end $$;
create or replace function public.ts_pay_consume_save_once(
  p_lib text, p_event_id text, p_device_id text, p_media_type text, p_request_id text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_result jsonb;
begin
  if p_request_id is null or length(p_request_id) > 100 then raise exception 'Invalid save request id'; end if;
  select result into v_result from public.ts_pay_save_claims
   where lib = p_lib and device_id = p_device_id and request_id = p_request_id;
  if found then return v_result; end if;
  v_result := public.ts_pay_consume_save(p_lib, p_event_id, p_device_id, p_media_type);
  if coalesce((v_result ->> 'allowed')::boolean, false) then
    insert into public.ts_pay_save_claims(lib, device_id, request_id, result)
    values (p_lib, p_device_id, p_request_id, v_result);
  end if;
  return v_result;
end $$;
grant execute on function public.ts_pay_consume_save_once(text,text,text,text,text) to anon, authenticated;

create or replace function public.ts_pay_fulfill_checkout(
  p_order_id text, p_checkout_session_id text, p_payment_id text,
  p_paid_amount_centavos bigint, p_currency text, p_livemode boolean
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_order public.ts_pay_orders%rowtype;
        v_now bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Service role required'; end if;
  select * into v_order from public.ts_pay_orders where id = p_order_id for update;
  if not found then raise exception 'Payment order not found'; end if;
  if v_order.checkout_session_id is distinct from p_checkout_session_id then
    raise exception 'Checkout session does not match payment order';
  end if;
  if v_order.test_mode <> (not p_livemode) then raise exception 'Payment mode does not match order'; end if;
  if upper(coalesce(p_currency, '')) <> 'PHP' or
     round(v_order.amount * 100)::bigint <> p_paid_amount_centavos then
    raise exception 'Paid amount does not match order';
  end if;
  if v_order.status = 'paid' then
    if v_order.payment_id is distinct from p_payment_id then raise exception 'Payment reference mismatch'; end if;
    return jsonb_build_object('fulfilled', true, 'already_fulfilled', true, 'order_id', v_order.id);
  end if;
  if v_order.status <> 'pending' then raise exception 'Payment order is not pending'; end if;
  if v_order.plan_id is not null then
    if v_order.media_type <> 'strip'
       or (v_order.plan_id = 'single_strip' and
           (v_order.amount <> 15 or v_order.quantity <> 1 or v_order.gif_quantity <> 0 or v_order.access_days <> 0))
       or (v_order.plan_id = 'double_strip' and
           (v_order.amount <> 25 or v_order.quantity <> 2 or v_order.gif_quantity <> 0 or v_order.access_days <> 0))
       or (v_order.plan_id = 'quad_gif' and
           (v_order.amount <> 50 or v_order.quantity <> 4 or v_order.gif_quantity <> 1 or v_order.access_days <> 0))
       or (v_order.plan_id = 'monthly_pass' and
           (v_order.amount <> 150 or v_order.quantity <> 1 or v_order.gif_quantity <> 0 or v_order.access_days <> 30))
       or v_order.plan_id not in ('single_strip','double_strip','quad_gif','monthly_pass') then
      raise exception 'Plan details do not match the approved offer';
    end if;
    if v_order.quantity > 0 and v_order.plan_id <> 'monthly_pass' then
      insert into public.ts_pay_credits(lib, event_id, device_id, media_type, remaining)
      values (v_order.lib, coalesce(v_order.event_id, 'default'), v_order.device_id, 'strip', v_order.quantity);
    end if;
    if v_order.gif_quantity > 0 then
      insert into public.ts_pay_credits(lib, event_id, device_id, media_type, remaining)
      values (v_order.lib, coalesce(v_order.event_id, 'default'), v_order.device_id, 'gif', v_order.gif_quantity);
    end if;
    if v_order.access_days > 0 then
      insert into public.ts_pay_memberships as membership(lib, event_id, device_id, access_until, updated_at)
      values (
        v_order.lib, 'default', v_order.device_id,
        v_now + (v_order.access_days::bigint * 86400000), v_now
      )
      on conflict (lib, event_id, device_id) do update
        set access_until = greatest(membership.access_until, v_now) +
              (v_order.access_days::bigint * 86400000),
            updated_at = v_now;
    end if;
  else
    insert into public.ts_pay_credits(lib, event_id, device_id, media_type, remaining)
    values (v_order.lib, coalesce(v_order.event_id, 'default'), v_order.device_id, v_order.media_type, v_order.quantity);
  end if;
  insert into public.ts_pay_sales(
    lib, event_id, event_name, device_id, media_type, quantity, gif_quantity, plan_id,
    product_name, payment_id, test_mode, amount, payment_method, description
  ) values (
    v_order.lib, v_order.event_id, v_order.event_name, v_order.device_id, v_order.media_type,
    case when v_order.plan_id = 'monthly_pass' then 0
         when v_order.plan_id is not null then v_order.quantity
         else v_order.quantity end,
    case when v_order.plan_id is not null then v_order.gif_quantity else 0 end,
    v_order.plan_id, v_order.product_name, p_payment_id, v_order.test_mode, v_order.amount,
    case when v_order.test_mode then 'paymongo_test' else 'paymongo_gcash' end,
    case when v_order.plan_id is not null then 'PayMongo GCash plan'
         when v_order.bundle_id is null then 'PayMongo GCash single save'
         else 'PayMongo GCash bundle' end
  );
  update public.ts_pay_orders set status = 'paid', last_payment_status = 'paid', payment_id = p_payment_id,
    paid_at = (extract(epoch from now()) * 1000)::bigint
   where id = p_order_id;
  return jsonb_build_object('fulfilled', true, 'already_fulfilled', false, 'order_id', v_order.id);
end $$;
revoke all on function public.ts_pay_fulfill_checkout(text,text,text,bigint,text,boolean) from public, anon, authenticated;
grant execute on function public.ts_pay_fulfill_checkout(text,text,text,bigint,text,boolean) to service_role;

grant execute on function public.ts_pay_purchase_save(text,text,text,text,text,text,text) to anon, authenticated;

grant select on public.ts_pay_settings, public.ts_pay_events, public.ts_pay_bundles to anon, authenticated;
grant insert, update, delete on public.ts_pay_settings, public.ts_pay_events, public.ts_pay_bundles to authenticated;
grant select on public.ts_pay_usage, public.ts_pay_sales to authenticated;