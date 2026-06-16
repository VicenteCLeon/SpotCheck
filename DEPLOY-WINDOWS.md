# Despliegue en producción — Windows + DigitalOcean

El backend corre en tu **PC con Windows** (donde están las cámaras) y queda expuesto al internet mediante **ngrok**. El frontend se despliega en **DigitalOcean App Platform** y los usuarios acceden desde sus celulares.

```
Celular / navegador
        │ HTTPS
        ▼
  DigitalOcean App Platform (frontend estático)
        │ VITE_API_BASE = https://xxxx.ngrok-free.app
        ▼
  ngrok (túnel HTTPS público)
        │
  Tu PC Windows - localhost:8000
  (uvicorn + YOLOv8 + cámaras USB/RTSP local)
```

> **Archivos relevantes** (solo en tu disco local — excluidos de git por `.gitignore`):
> - `deploy/ngrok-config.yml` — config del túnel ngrok
> - `start-prod.bat` — arranca backend + ngrok de un doble clic
>
> **En git** (se despliegan automáticamente):
> - `.do/app.yaml` — spec de DigitalOcean App Platform

---

## Paso 1 — Instalar ngrok

1. Ve a [ngrok.com](https://ngrok.com) y crea una cuenta gratuita.
2. Descarga el ejecutable para Windows desde [ngrok.com/download](https://ngrok.com/download).
3. Extrae el ZIP y mueve `ngrok.exe` a una carpeta en tu PATH (ej. `C:\tools\`).
4. En la [dashboard de ngrok](https://dashboard.ngrok.com/get-started/your-authtoken), copia tu **authtoken** y regístralo:

   ```cmd
   ngrok config add-authtoken TU_TOKEN_AQUI
   ```

5. Verifica:

   ```cmd
   ngrok version
   ```

---

## Paso 2 — Primera ejecución del backend

Haz doble clic en `start-prod.bat`. El script:

1. Crea el entorno virtual Python 3.12.
2. Instala dependencias.
3. Arranca uvicorn en modo producción (`--workers 1`, sin `--reload`).
4. Abre el túnel ngrok.
5. Imprime la **URL pública** del backend.

Al final verás algo como:

```
=============================================
  URL publica del backend:
  https://abcd1234.ngrok-free.app
=============================================
```

**Anota esa URL** — la necesitas en los pasos siguientes.

> **Importante:** en el plan gratis de ngrok, esta URL **cambia cada vez** que reinicias ngrok. Cada vez que cambie debes actualizar `VITE_API_BASE` en DigitalOcean, `PUBLIC_BACKEND_URL` en `.env` y el webhook en Mercado Pago.

---

## Paso 3 — Configurar el backend (.env)

Edita `backend/.env` (cópialo desde `backend/.env.example`):

```env
JWT_SECRET=<python -c "import secrets; print(secrets.token_hex(32))">
GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
SUPABASE_URL=https://tu-proyecto.supabase.co
SUPABASE_SERVICE_KEY=eyJ...

# CORS: la URL de DigitalOcean que obtienes en el Paso 4
# Si aún no desplegaste el frontend, déjalo vacío y actualiza después.
ALLOWED_ORIGINS=https://spotcheck-xxxxx.ondigitalocean.app

# URL del túnel ngrok (del Paso 2)
PUBLIC_BACKEND_URL=https://anaerobic-cannot-composure.ngrok-free.dev/

# Mercado Pago (ver Paso 6)
MP_ACCESS_TOKEN=APP_USR-...
MP_WEBHOOK_SECRET=...
ADMIN_PRICE_CLP=5000
```

Reinicia el backend tras cualquier cambio en `.env` (cierra la ventana "SpotCheck Backend" y vuelve a ejecutar `start-prod.bat`).

---

## Paso 4 — Desplegar el frontend en DigitalOcean App Platform

### 4.1 — Subir el código a GitHub

Si aún no tienes el repo en GitHub:

```cmd
git add .
git commit -m "Add DO app spec"
git push
```

### 4.2 — Crear la app en DigitalOcean

1. Ve a [cloud.digitalocean.com/apps](https://cloud.digitalocean.com/apps) y haz clic en **Create App**.
2. Conecta tu cuenta de GitHub y selecciona el repo **SpotCheck**.
3. DigitalOcean detecta el `.do/app.yaml` automáticamente y preconfigura todo.
4. En la pantalla de revisión verás el componente `frontend` como **Static Site**.

### 4.3 — Variables de entorno (obligatorio antes del primer deploy)

En el paso de configuración (o después en Settings → App-Level Env Vars):

| Variable | Valor |
|---|---|
| `VITE_API_BASE` | `https://abcd1234.ngrok-free.app` ← tu URL de ngrok |
| `VITE_GOOGLE_CLIENT_ID` | `xxxx.apps.googleusercontent.com` |
| `VITE_SUPABASE_URL` | `https://tu-proyecto.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | `eyJ...` |
| `VITE_GOOGLE_MAPS_KEY` | `AIza...` |

> Estas variables se incrustan **en el momento del build** (Vite las incrusta en el JS). Cada vez que cambies `VITE_API_BASE` (por cambio de URL de ngrok) debes hacer **Redeploy** en DigitalOcean.

### 4.4 — Deploy

Haz clic en **Deploy**. En 2-3 minutos tendrás una URL como:

```
https://spotcheck-xxxxx.ondigitalocean.app
```

Esa es la URL que comparten los usuarios.

---

## Paso 5 — Google OAuth (autorizar el dominio de DO)

En [Google Cloud Console](https://console.cloud.google.com) → Credenciales → tu cliente OAuth 2.0:

- **Orígenes de JavaScript autorizados** → agrega:
  `https://spotcheck-xxxxx.ondigitalocean.app`

Sin este paso el login con Google da error `redirect_uri_mismatch`.

---

## Paso 6 — Actualizar CORS en el backend

Edita `backend/.env` con la URL real de DigitalOcean:

```env
ALLOWED_ORIGINS=https://spotcheck-xxxxx.ondigitalocean.app
```

Reinicia el backend.

---

## Paso 7 — Mercado Pago (acceso admin)

1. Ejecuta la **migración SQL** en Supabase (SQL Editor):

   ```sql
   ALTER TABLE user_roles ADD CONSTRAINT user_roles_email_key UNIQUE (email);

   CREATE TABLE IF NOT EXISTS admin_purchases (
     id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
     email      text NOT NULL,
     payment_id text,
     amount     numeric,
     currency   text,
     status     text,
     created_at timestamptz NOT NULL DEFAULT now()
   );
   ALTER TABLE admin_purchases ENABLE ROW LEVEL SECURITY;
   ```

2. En el [panel de Mercado Pago](https://www.mercadopago.cl/developers/panel/app):
   - **URL de la aplicación**: `https://spotcheck-xxxxx.ondigitalocean.app`
   - Eso desbloquea las credenciales de producción.
   - Copia el **Access Token** → `MP_ACCESS_TOKEN` en `.env`.

3. En el panel de MP → **Webhooks**:
   - URL: `https://abcd1234.ngrok-free.app/api/billing/webhook`
   - Tipo: **Pagos**
   - Copia la **clave secreta** → `MP_WEBHOOK_SECRET` en `.env`.

4. Reinicia el backend.

---

## Paso 8 — Verificación final

Desde tu celular (fuera de la WiFi de tu casa):

- [ ] Abre `https://spotcheck-xxxxx.ondigitalocean.app`
- [ ] Login con cuenta `@pucv.cl` o `@mail.pucv.cl` funciona.
- [ ] Las tarjetas de cámara muestran conteos en tiempo real.
- [ ] Un `viewer` con correo `@pucv.cl` ve la tarjeta de compra admin.

Desde el PC:

```cmd
curl https://abcd1234.ngrok-free.app/health
```

Debe responder `{"status":"online", ...}`.

---

## Operación diaria

1. **Doble clic en `start-prod.bat`** al iniciar el día.
2. Si la URL de ngrok cambió:
   - Actualiza `VITE_API_BASE` en DigitalOcean → Settings → Env Vars → **Redeploy**.
   - Actualiza `PUBLIC_BACKEND_URL` en `backend/.env` y el webhook en MP.
   - Reinicia el backend.
3. Cuando termines, cierra las ventanas "SpotCheck Backend" y "ngrok".

> El PC debe estar **encendido y con internet** para que los usuarios accedan.

---

## Cámaras

- **USB** (`0`, `1`, `2`…): funcionan directamente en tu PC.
- **RTSP** (`rtsp://192.168.x.x:554/...`): cámaras IP en la misma red local, configúralas desde el AdminPanel o la tabla `cameras` de Supabase.

Las cámaras solo las ve el backend en tu PC — nunca el servidor de DigitalOcean ni los celulares.
