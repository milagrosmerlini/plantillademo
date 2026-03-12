-- =====================================================
-- ALTA DE ADMIN (DESPUES DE CREAR USUARIO EN AUTH)
-- =====================================================
-- 1) Primero crea el usuario en Supabase Auth (email + password).
-- 2) Reemplaza el email de abajo y ejecuta este script.

insert into public.admins (user_id)
select id
from auth.users
where email = 'admin@tu-negocio.com'
on conflict (user_id) do nothing;
