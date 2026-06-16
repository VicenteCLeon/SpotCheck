# Base de datos — SpotCheck

Motor: **Supabase (PostgreSQL)**. El backend se comunica vía REST API (PostgREST) con llamadas HTTP directas (`requests`). No se usa ningún SDK oficial de Supabase.

---

## Tablas

### `cameras`
Configuración de las cámaras. Tabla principal de administración.

| Campo | Tipo | Descripción |
|---|---|---|
| `id` | text (PK) | Identificador único (letras, números, `-`, `_`, máx. 40 chars) |
| `name` | text | Nombre descriptivo |
| `source` | text | Índice USB (`"0"`, `"1"`) o URL RTSP |
| `capacity` | int | Aforo máximo del espacio |
| `building` | text | Ubicación física |
| `enabled` | bool | Si está activa o no |
| `sort_order` | int | Orden de visualización |

**Accesos:**
- Backend al arrancar: lee solo `enabled=true`, ordenadas por `sort_order`
- Admin panel: lee todas (`*`) para gestión
- CRUD endpoints: `POST`, `PATCH`, `DELETE` (requiere Supabase habilitado)

---

### `user_roles`
Asignación de roles por correo institucional.

| Campo | Tipo | Descripción |
|---|---|---|
| `email` | text | Correo del usuario |
| `role` | text | `"admin"` o `"viewer"` |

**Accesos:**
- Backend en cada login: consulta `WHERE email = ?` para incluir el rol en el JWT
- Si el email no aparece → rol por defecto `"viewer"`
- Compra de admin (Mercado Pago): `grant_admin()` hace **upsert** por `email`
  (`Prefer: resolution=merge-duplicates`), por lo que `email` **debe tener un
  índice único**.

> ⚠️ Para que el upsert funcione, `email` necesita una restricción única:
> ```sql
> ALTER TABLE user_roles ADD CONSTRAINT user_roles_email_key UNIQUE (email);
> ```

---

### `admin_purchases`
Auditoría de las compras del acceso de administrador vía Mercado Pago.

| Campo | Tipo | Descripción |
|---|---|---|
| `email` | text | Correo institucional que compró el acceso |
| `payment_id` | text | ID del pago en Mercado Pago |
| `amount` | numeric | Monto cobrado |
| `currency` | text | Moneda (p. ej. `CLP`) |
| `status` | text | Estado del pago (`approved`) |
| `created_at` | timestamp | Generado automáticamente por Supabase |

**Accesos:**
- Backend al confirmar un pago aprobado (`/api/billing/confirm` o webhook):
  inserta una fila (best-effort; un fallo aquí no impide otorgar el rol).

---

### `samples`
Serie temporal de conteos de aforo.

| Campo | Tipo | Descripción |
|---|---|---|
| `camera_id` | text | Referencia a `cameras.id` |
| `count` | int | Número de personas detectadas |
| `created_at` | timestamp | Generado automáticamente por Supabase |

**Accesos:**
- `upload_loop` en backend: inserta una fila por cámara cada 10 segundos
- No se lee directamente; se consume a través de la función RPC `recent_occupancy`
- Retención: 12 meses (política definida en `supabase/retention.sql`)

---

## Función RPC

### `recent_occupancy()`
Función PostgreSQL llamada directamente desde el **frontend** (sin pasar por el backend).

- Endpoint: `POST /rest/v1/rpc/recent_occupancy`
- Autenticación: ANON KEY (pública, definida en `VITE_SUPABASE_ANON_KEY`)
- Retorna: filas con `bucket` (hora) y `people` (media de personas)
- Uso: gráfico histórico de ocupación de las últimas ~6 h (solo visible para admins)
- Polling: cada 60 segundos desde el frontend

---

## Flujo de acceso

```
Backend (SERVICE KEY)
  ├── Al arrancar    → GET  cameras?enabled=eq.true&order=sort_order.asc,id.asc
  ├── En cada login  → GET  user_roles?email=eq.{email}&select=role
  ├── Cada 10 s      → POST samples  [{ camera_id, count }, ...]
  └── Admin CRUD     → POST / PATCH / DELETE  cameras

Frontend (ANON KEY)
  └── Cada 60 s      → POST /rest/v1/rpc/recent_occupancy  (gráfico histórico)
```

---

## Modo sin Supabase (fallback)

Si `SUPABASE_URL` o `SUPABASE_SERVICE_KEY` no están configurados, `SUPABASE_ENABLED = False`:

| Función | Comportamiento |
|---|---|
| Cámaras | Usa la lista `CAMERAS_FALLBACK` de `main.py` |
| Roles | Todos los usuarios son `"viewer"` |
| Persistencia | `upload_loop` desactivado, no se guardan muestras |
| CRUD de cámaras | Devuelve `503` |
| Gráfico histórico | Sin datos |

---

## Variables de entorno requeridas

| Variable | Usado por | Descripción |
|---|---|---|
| `SUPABASE_URL` | Backend | URL base del proyecto (`https://xxx.supabase.co`) |
| `SUPABASE_SERVICE_KEY` | Backend | Service key (acceso total, nunca exponer al cliente) |
| `VITE_SUPABASE_URL` | Frontend | Misma URL, expuesta al navegador |
| `VITE_SUPABASE_ANON_KEY` | Frontend | Anon key (pública por diseño, solo lectura via RLS) |

---

## Migración: pasarela de pago (acceso admin)

Ejecuta esto en el **SQL Editor** de Supabase antes de habilitar Mercado Pago:

```sql
-- 1. user_roles.email debe ser único para el upsert de grant_admin()
ALTER TABLE user_roles
  ADD CONSTRAINT user_roles_email_key UNIQUE (email);

-- 2. Tabla de auditoría de compras
CREATE TABLE IF NOT EXISTS admin_purchases (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email       text NOT NULL,
  payment_id  text,
  amount      numeric,
  currency    text,
  status      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- 3. (Opcional) RLS: solo el backend con la service key escribe estas tablas.
ALTER TABLE admin_purchases ENABLE ROW LEVEL SECURITY;
```

> La `service key` del backend salta RLS, así que no necesitas políticas para que
> el backend inserte. Mantén `admin_purchases` y `user_roles` sin políticas de
> `anon` para que no sean escribibles desde el frontend.
