-- =====================================================
-- SEED DEMO (datos de ejemplo)
-- Ejecutar en el proyecto DEMO luego de 01_base_cliente_nuevo.sql
-- =====================================================

-- Limpia datos de demo previos (si existen)
delete from public.sales where id like 'demo_%';
delete from public.expenses where id like 'demo_%';
delete from public.peya_liquidations where id like 'demo_%';
delete from public.monthly_carryover_history where id like 'demo_%';
delete from public.monthly_carryovers where month = '2026-03';

-- Productos demo
insert into public.products (sku, name, unit, price_presencial, price_pedidosya)
values
  ('cubanito_comun', 'Cubanito comun', 'Unidad', 1000, 1300),
  ('cubanito_negro', 'Cubanito choco negro', 'Unidad', 1300, 1900),
  ('cubanito_blanco', 'Cubanito choco blanco', 'Unidad', 1300, 1900),
  ('garrapinadas', 'Garrapiñadas', 'Bolsa', 1200, 1600)
on conflict (sku) do update set
  name = excluded.name,
  unit = excluded.unit,
  price_presencial = excluded.price_presencial,
  price_pedidosya = excluded.price_pedidosya;

-- Ventas demo (marzo 2026)
insert into public.sales (id, day, time, channel, items, total, cash, transfer, peya)
values
  ('demo_sale_001', '2026-03-10', '15:12', 'presencial', '[{"sku":"cubanito_comun","qty":3,"unitPrice":1000}]'::jsonb, 3000, 3000, 0, 0),
  ('demo_sale_002', '2026-03-10', '17:05', 'pedidosya', '[{"sku":"cubanito_negro","qty":2,"unitPrice":1900}]'::jsonb, 3800, 0, 0, 3800),
  ('demo_sale_003', '2026-03-11', '16:18', 'presencial', '[{"sku":"garrapinadas","qty":4,"unitPrice":1200}]'::jsonb, 4800, 2000, 2800, 0),
  ('demo_sale_004', '2026-03-11', '18:41', 'presencial', '[{"sku":"cubanito_blanco","qty":2,"unitPrice":1300}]'::jsonb, 2600, 0, 2600, 0),
  ('demo_sale_005', '2026-03-12', '15:44', 'pedidosya', '[{"sku":"cubanito_comun","qty":5,"unitPrice":1300}]'::jsonb, 6500, 0, 0, 6500)
on conflict (id) do update set
  day = excluded.day,
  time = excluded.time,
  channel = excluded.channel,
  items = excluded.items,
  total = excluded.total,
  cash = excluded.cash,
  transfer = excluded.transfer,
  peya = excluded.peya;

-- Gastos demo
insert into public.expenses (id, date, provider, qty, description, iva, iibb, amount, method, pay_cash, pay_transfer, pay_peya)
values
  ('demo_exp_001', '2026-03-10', 'MAXI', 2, 'CUBANITO COMUN', 0, 0, 1800, 'efectivo', 1800, 0, 0),
  ('demo_exp_002', '2026-03-11', 'PLASTICOS BLANCOS', 1, 'BOLSAS GARRAPINADAS', 0, 0, 2500, 'transferencia', 0, 2500, 0),
  ('demo_exp_003', '2026-03-12', 'PEDIDO YA', 1, 'SERVICIOS DE PEDIDO YA', 0, 0, 3200, 'peya', 0, 0, 3200)
on conflict (id) do update set
  date = excluded.date,
  provider = excluded.provider,
  qty = excluded.qty,
  description = excluded.description,
  iva = excluded.iva,
  iibb = excluded.iibb,
  amount = excluded.amount,
  method = excluded.method,
  pay_cash = excluded.pay_cash,
  pay_transfer = excluded.pay_transfer,
  pay_peya = excluded.pay_peya;

-- Sobrante mensual demo
insert into public.monthly_carryovers (month, cash, transfer, peya)
values ('2026-03', 15000, 9000, 6000)
on conflict (month) do update set
  cash = excluded.cash,
  transfer = excluded.transfer,
  peya = excluded.peya;

-- Historial sobrante demo
insert into public.monthly_carryover_history (id, month, cash, transfer, peya)
values
  ('demo_carry_hist_001', '2026-03', 12000, 7000, 5000),
  ('demo_carry_hist_002', '2026-03', 15000, 9000, 6000)
on conflict (id) do update set
  month = excluded.month,
  cash = excluded.cash,
  transfer = excluded.transfer,
  peya = excluded.peya;

-- Liquidacion PeYa demo
insert into public.peya_liquidations (id, month, from_date, to_date, amount)
values
  ('demo_peya_001', '2026-03', '2026-03-01', '2026-03-10', 18000)
on conflict (id) do update set
  month = excluded.month,
  from_date = excluded.from_date,
  to_date = excluded.to_date,
  amount = excluded.amount;
