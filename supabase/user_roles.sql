-- ============================================================================
--  SpotCheck · Tabla de roles de usuario
--  Ejecutar en el SQL Editor de Supabase (una sola vez).
--
--  Solo los emails listados aquí con role='admin' obtendrán ese rol en el JWT.
--  Cualquier @mail.pucv.cl que NO esté en la tabla recibe role='viewer' por defecto.
--  El backend usa la SERVICE KEY para leerla; la ANON KEY no tiene acceso (RLS).
-- ============================================================================

create table if not exists public.user_roles (
    email       text        primary key,
    role        text        not null default 'viewer'
                            check (role in ('admin', 'viewer')),
    created_at  timestamptz not null default now()
);

-- RLS activado sin políticas anon: solo la SERVICE KEY del backend puede leer.
alter table public.user_roles enable row level security;

-- ── Agregar admins ──────────────────────────────────────────────────────────
-- Reemplaza el email con el de quien deba tener acceso de administrador.
-- Puedes insertar múltiples filas. Los viewers no necesitan estar aquí.
--
-- insert into public.user_roles (email, role) values
--     ('admin@mail.pucv.cl', 'admin')
-- on conflict (email) do update set role = excluded.role;
