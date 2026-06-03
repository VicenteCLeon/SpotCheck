-- ============================================================================
--  SpotCheck · Tabla de configuración de cámaras
--  Ejecutar en el SQL Editor de Supabase (una sola vez).
--
--  El backend lee esta tabla al arrancar (con la SERVICE KEY) para saber qué
--  cámaras levantar. Si la tabla no existe, está vacía o Supabase no responde,
--  el backend usa la lista local CAMERAS_FALLBACK definida en main.py.
-- ============================================================================

create table if not exists public.cameras (
    -- Identificador estable usado en las URLs (/video_feed/{id}) y como clave
    -- de las muestras. No usar UUID: queremos algo legible como "cam1".
    id          text        primary key,
    name        text        not null,
    -- Fuente de captura. Para una webcam local es el índice ("0", "1"); para una
    -- cámara IP es la URL RTSP/HTTP. Se guarda como texto y el backend la
    -- convierte a entero cuando corresponde.
    source      text        not null,
    -- Aforo máximo de la sala/zona que cubre la cámara.
    capacity    integer     not null default 50 check (capacity > 0),
    -- Edificio o ubicación (para agrupar en el dashboard). Opcional.
    building    text        not null default '',
    -- Permite desactivar una cámara sin borrar la fila.
    enabled     boolean     not null default true,
    -- Orden de aparición en el dashboard.
    sort_order  integer     not null default 0,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

-- Mantener updated_at al día automáticamente -------------------------------
create or replace function public.set_updated_at()
returns trigger as $$
begin
    new.updated_at = now();
    return new;
end;
$$ language plpgsql;

drop trigger if exists trg_cameras_updated_at on public.cameras;
create trigger trg_cameras_updated_at
    before update on public.cameras
    for each row execute function public.set_updated_at();

-- Seguridad ----------------------------------------------------------------
-- Activamos RLS y NO creamos políticas para anon/authenticated: así la ANON
-- KEY (que vive en el frontend) no puede leer ni escribir esta tabla. El
-- backend usa la SERVICE KEY, que omite RLS, para leerla. La gestión de
-- cámaras se hace desde el panel de Supabase o desde el backend.
alter table public.cameras enable row level security;

-- Datos iniciales (equivalentes a CAMERAS_FALLBACK en main.py) --------------
insert into public.cameras (id, name, source, capacity, building, sort_order)
values
    ('cam1', 'Camara 1 - Webcam',  '0', 10, '', 1),
    ('cam2', 'Camara 2 - Celular', '1', 10, '', 2)
on conflict (id) do nothing;
