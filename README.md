# Plantilla App de Carrito (Modo Principiante)

Esta carpeta es una base para crear una app nueva por cliente sin tocar la app de tu familia.

## Pasos rapidos para un cliente nuevo

1. Copiar esta carpeta y renombrarla, por ejemplo: `APP-CLIENTE-JUAN`.
2. Abrir `config.js`.
3. Completar:
   - `APP_NAME`
   - `FOOTER_TEXT`
   - `LOGO_URL`
   - `ADMIN_EMAIL`
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `STORAGE_PREFIX` (un nombre unico por cliente)
4. Subir la carpeta al hosting del cliente.

## Archivo que vas a tocar siempre

- `config.js` (solo este, para cambios de cliente).

## Importante

- Esta plantilla usa la misma logica base de la app original.
- No modifica nada de `APP CUBANITOS` (app familia).

## Guías incluidas

- `GUIA_SUPABASE_Y_GO_LIVE.md` (paso a paso de Supabase nuevo y publicación).
- `supabase/01_base_cliente_nuevo.sql` (tablas + permisos + RLS).
- `supabase/02_alta_admin.sql` (alta del usuario admin).
- `supabase/03_seed_demo.sql` (datos de ejemplo para demo).
