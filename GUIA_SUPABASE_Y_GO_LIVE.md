# Guía Simple: Supabase Nuevo + Go Live (Familia y Plantilla)

Esta guía es para trabajar separado:
- App familia: la actual (mamá/tío).
- App plantilla: la genérica para vender.

## 1) Supabase nuevo para la plantilla (cliente nuevo)

1. En Supabase crea un proyecto nuevo.
2. En `SQL Editor`, ejecuta:
   - `supabase/01_base_cliente_nuevo.sql`
   - (Opcional demo) `supabase/03_seed_demo.sql`
3. En `Auth > Users`, crea el usuario admin (email + contraseña).
4. En `SQL Editor`, ejecuta:
   - `supabase/02_alta_admin.sql` (cambiando el email por el del admin).
5. Copia del proyecto nuevo:
   - `Project URL`
   - `anon public key`
6. En `config.js` de la plantilla completa:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `ADMIN_EMAIL`
   - `STORAGE_PREFIX` (ejemplo: `cliente_juan`)

## 2) Go live app familia (la de mamá/tío)

Usa su carpeta y su Supabase actual, sin mezclar nada:

1. Publica la carpeta `APP CUBANITOS` (la actual).
2. No cambies sus claves si ya funciona.
3. Ese link queda solo para familia.

## 3) Go live plantilla genérica

No publiques la carpeta de familia.
Publica la carpeta `PLANTILLA_APP_CUBANITOS` o una copia por cliente.

Flujo recomendado:
1. Copia `PLANTILLA_APP_CUBANITOS` a `APP-CLIENTE-NOMBRE`.
2. Edita `config.js` del cliente.
3. Publica `APP-CLIENTE-NOMBRE`.

Cada cliente queda con:
- Su link.
- Su Supabase.
- Su configuración.

## 4) Cómo “ver” cada go live

- App familia: abres el link de familia.
- App cliente/plantilla: abres el link del cliente.

No se pisan entre sí porque:
- Están en carpetas distintas.
- Tienen Supabase distinto.
- Tienen configuración distinta.
