-- =====================================================
-- BASE SUPABASE - CLIENTE NUEVO (PLANTILLA)
-- Ejecutar este archivo en SQL Editor del proyecto NUEVO.
-- =====================================================

create extension if not exists pgcrypto;

-- ---------------------------
-- Tablas principales
-- ---------------------------

create table if not exists public.products (
  sku text primary key,
  name text not null,
  unit text not null default 'Unidad',
  price_presencial numeric(12,2) not null default 0,
  price_pedidosya numeric(12,2) not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.sales (
  id text primary key,
  day date not null,
  time text not null,
  channel text not null default 'presencial' check (channel in ('presencial','pedidosya')),
  items jsonb not null default '[]'::jsonb,
  total numeric(12,2) not null default 0,
  cash numeric(12,2) not null default 0,
  transfer numeric(12,2) not null default 0,
  peya numeric(12,2) not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.expenses (
  id text primary key,
  date date not null,
  provider text not null,
  qty numeric(12,3) not null default 0,
  description text not null,
  iva numeric(12,2) not null default 0,
  iibb numeric(12,2) not null default 0,
  amount numeric(12,2) not null default 0,
  method text not null default 'efectivo',
  pay_cash numeric(12,2) not null default 0,
  pay_transfer numeric(12,2) not null default 0,
  pay_peya numeric(12,2) not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.monthly_carryovers (
  month text primary key, -- formato: YYYY-MM
  cash numeric(12,2) not null default 0,
  transfer numeric(12,2) not null default 0,
  peya numeric(12,2) not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.peya_liquidations (
  id text primary key,
  month text not null, -- formato: YYYY-MM
  from_date date not null,
  to_date date not null,
  amount numeric(12,2) not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.monthly_carryover_history (
  id text primary key,
  month text not null, -- formato: YYYY-MM
  cash numeric(12,2) not null default 0,
  transfer numeric(12,2) not null default 0,
  peya numeric(12,2) not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ---------------------------
-- Indices utiles
-- ---------------------------
create index if not exists idx_sales_day on public.sales(day);
create index if not exists idx_expenses_date on public.expenses(date);
create index if not exists idx_peya_liq_month on public.peya_liquidations(month);
create index if not exists idx_carryover_hist_month on public.monthly_carryover_history(month);

-- ---------------------------
-- RLS
-- ---------------------------
alter table public.products enable row level security;
alter table public.sales enable row level security;
alter table public.expenses enable row level security;
alter table public.monthly_carryovers enable row level security;
alter table public.peya_liquidations enable row level security;
alter table public.monthly_carryover_history enable row level security;
alter table public.admins enable row level security;

-- Limpieza de policies si ya existian (idempotente)
drop policy if exists products_select_all on public.products;
drop policy if exists products_write_admin on public.products;
drop policy if exists sales_select_all on public.sales;
drop policy if exists sales_insert_all on public.sales;
drop policy if exists sales_update_admin on public.sales;
drop policy if exists sales_delete_admin on public.sales;
drop policy if exists expenses_select_all on public.expenses;
drop policy if exists expenses_write_admin on public.expenses;
drop policy if exists carryovers_select_all on public.monthly_carryovers;
drop policy if exists carryovers_write_admin on public.monthly_carryovers;
drop policy if exists peya_liq_select_all on public.peya_liquidations;
drop policy if exists peya_liq_write_admin on public.peya_liquidations;
drop policy if exists carryover_hist_select_all on public.monthly_carryover_history;
drop policy if exists carryover_hist_write_admin on public.monthly_carryover_history;
drop policy if exists admins_select_self on public.admins;

-- Lectura publica (anon + auth)
create policy products_select_all on public.products
for select to anon, authenticated
using (true);

create policy sales_select_all on public.sales
for select to anon, authenticated
using (true);

create policy expenses_select_all on public.expenses
for select to anon, authenticated
using (true);

create policy carryovers_select_all on public.monthly_carryovers
for select to anon, authenticated
using (true);

create policy peya_liq_select_all on public.peya_liquidations
for select to anon, authenticated
using (true);

create policy carryover_hist_select_all on public.monthly_carryover_history
for select to anon, authenticated
using (true);

-- Escritura de catalogo/finanzas solo admin (auth + fila en public.admins)
create policy products_write_admin on public.products
for all to authenticated
using (exists (select 1 from public.admins a where a.user_id = auth.uid()))
with check (exists (select 1 from public.admins a where a.user_id = auth.uid()));

create policy expenses_write_admin on public.expenses
for all to authenticated
using (exists (select 1 from public.admins a where a.user_id = auth.uid()))
with check (exists (select 1 from public.admins a where a.user_id = auth.uid()));

create policy carryovers_write_admin on public.monthly_carryovers
for all to authenticated
using (exists (select 1 from public.admins a where a.user_id = auth.uid()))
with check (exists (select 1 from public.admins a where a.user_id = auth.uid()));

create policy peya_liq_write_admin on public.peya_liquidations
for all to authenticated
using (exists (select 1 from public.admins a where a.user_id = auth.uid()))
with check (exists (select 1 from public.admins a where a.user_id = auth.uid()));

create policy carryover_hist_write_admin on public.monthly_carryover_history
for all to authenticated
using (exists (select 1 from public.admins a where a.user_id = auth.uid()))
with check (exists (select 1 from public.admins a where a.user_id = auth.uid()));

-- Ventas: cualquiera con el link puede crear venta; editar/eliminar solo admin
create policy sales_insert_all on public.sales
for insert to anon, authenticated
with check (true);

create policy sales_update_admin on public.sales
for update to authenticated
using (exists (select 1 from public.admins a where a.user_id = auth.uid()))
with check (exists (select 1 from public.admins a where a.user_id = auth.uid()));

create policy sales_delete_admin on public.sales
for delete to authenticated
using (exists (select 1 from public.admins a where a.user_id = auth.uid()));

-- Admins: cada usuario autenticado solo puede leer su propia fila
create policy admins_select_self on public.admins
for select to authenticated
using (user_id = auth.uid());

-- ---------------------------
-- Grants (permite acceso via API)
-- ---------------------------
grant usage on schema public to anon, authenticated;

grant select on public.products to anon, authenticated;
grant select on public.sales to anon, authenticated;
grant select on public.expenses to anon, authenticated;
grant select on public.monthly_carryovers to anon, authenticated;
grant select on public.peya_liquidations to anon, authenticated;
grant select on public.monthly_carryover_history to anon, authenticated;
grant select on public.admins to authenticated;

grant insert on public.sales to anon, authenticated;
grant update, delete on public.sales to authenticated;

grant insert, update, delete on public.products to authenticated;
grant insert, update, delete on public.expenses to authenticated;
grant insert, update, delete on public.monthly_carryovers to authenticated;
grant insert, update, delete on public.peya_liquidations to authenticated;
grant insert, update, delete on public.monthly_carryover_history to authenticated;
