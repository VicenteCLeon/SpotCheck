-- ============================================================================
--  SpotCheck · Política de retención de datos
--  Ejecutar en el SQL Editor de Supabase.
--
--  Respalda el aviso de privacidad mostrado en la app: los conteos se conservan
--  durante 12 meses y luego se eliminan automáticamente. Recuerda: la tabla
--  "samples" solo guarda conteos numéricos agregados, nunca imágenes ni video.
--
--  NOTA: ajusta el nombre de la columna de fecha ("created_at") si en tu tabla
--  "samples" se llama distinto (p. ej. "ts" o "inserted_at").
-- ============================================================================

-- Función que borra las muestras con más de 12 meses de antigüedad.
create or replace function public.delete_old_samples()
returns integer as $$
declare
    borradas integer;
begin
    delete from public.samples
    where created_at < now() - interval '12 months';
    get diagnostics borradas = row_count;
    return borradas;
end;
$$ language plpgsql;

-- ── Programar la limpieza automática (requiere la extensión pg_cron) ──────────
-- En Supabase: Database → Extensions → activar "pg_cron".
-- Luego ejecutar lo siguiente UNA vez para correr la limpieza cada día a las 03:00.
--
-- create extension if not exists pg_cron;
--
-- select cron.schedule(
--     'purgar-samples-antiguos',
--     '0 3 * * *',
--     $$ select public.delete_old_samples(); $$
-- );
--
-- Si no usas pg_cron, ejecuta manualmente cuando lo necesites:
--   select public.delete_old_samples();
