# SpotCheck — Monitor de Aforo 

Sistema de monitoreo de aforo en tiempo real. Detecta personas mediante YOLOv8 en cámaras IP o USB y muestra el estado en un dashboard web con alertas automáticas por email.

---

## Stack

| Capa | Tecnología |
|---|---|
| Backend | Python 3.12 · FastAPI · YOLOv8 (ultralytics) · OpenCV |
| Frontend | React 19 · TypeScript · Vite · Tailwind CSS v4 |
| Base de datos | Supabase (PostgreSQL) |
| Auth | Google OAuth + JWT propio (8h) |
| Producción | ngrok (túnel HTTPS) · DigitalOcean App Platform (frontend) |

---

## Funcionalidades

### Roles de usuario
El sistema tiene dos roles asignados desde Supabase:

| Rol | Acceso |
|---|---|
| `viewer` | Dashboard de solo lectura, notificaciones de navegador |
| `admin` | Todo lo anterior + panel de gestión de cámaras, vista en vivo, logs del sistema, gráfico histórico |

> Un `viewer` con correo **`@pucv.cl`** puede comprar el acceso `admin` con Mercado Pago. Ver [Pasarela de pago](#pasarela-de-pago--acceso-admin).

### Dashboard
- **Mapa del campus** — visualización geográfica de las cámaras con su estado de ocupación
- **KPI cards con sparklines** — aforo total, ocupación general, cámaras en línea y en alerta, con mini-gráfico de historial reciente
- **Tarjetas por cámara** — conteo en tiempo real, barra de progreso, sparkline y estado online/offline
- **Resumen plegable** — sección de KPIs colapsable
- **Actividad reciente** — log de eventos en pantalla (cambios de estado, cámaras offline/online)
- **Aviso legal de videovigilancia** — modal accesible desde el login y el footer del dashboard

### Solo admin
- **Vista en vivo** (`LivePreview`) — modal con el stream MJPEG de todas las cámaras activas, con indicador online/offline y botón de reconexión individual
- **Panel de gestión de cámaras** (`AdminPanel`) — CRUD completo: crear, editar y eliminar cámaras sin reiniciar el backend
- **Gráfico histórico** — ocupación del campus cada 10 min durante las últimas 6 h (datos de Supabase)
- **Logs del sistema** — visor desplegable con las últimas entradas de log del backend

### Notificaciones de navegador
Los usuarios pueden suscribirse por cámara para recibir una notificación push del navegador cuando un espacio vuelve a nivel de ocupación normal.

### Sesión persistente
El JWT se guarda en `localStorage` y se restaura al recargar la página. La sesión se invalida automáticamente al expirar (verificación cada 60 s).

---

## Inicio rápido (desarrollo local)

**Requisito:** Python 3.12 instalado (`winget install Python.Python.3.12`)

```bash
# 1. Copia y rellena las variables de entorno
cp backend/.env.example  backend/.env
cp frontend/.env.example frontend/.env

# 2. Arranca todo
./start.bat
```

- Frontend → http://localhost:5173
- Backend  → http://localhost:8000
- API docs → http://localhost:8000/docs

`start.bat` crea el entorno virtual Python 3.12 e instala todas las dependencias automáticamente en el primer arranque.

---

## Variables de entorno

### `backend/.env`

```env
JWT_SECRET=<genera con: python -c "import secrets; print(secrets.token_hex(32))">
GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
SUPABASE_URL=https://tu-proyecto.supabase.co
SUPABASE_SERVICE_KEY=eyJ...
ALLOWED_ORIGINS=http://localhost:5173

# Alertas por email (opcional — ver sección Alertas)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=tucuenta@gmail.com
SMTP_PASSWORD=xxxx-xxxx-xxxx-xxxx
ALERT_FROM=tucuenta@gmail.com
ALERT_RECIPIENTS=responsable@mail.cl

# Pasarela de pago — acceso admin (opcional — ver sección Pasarela de pago)
MP_ACCESS_TOKEN=APP_USR-xxxx
MP_WEBHOOK_SECRET=xxxx
ADMIN_PRICE_CLP=5000
PUBLIC_BACKEND_URL=https://xxxx.ngrok-free.app   # URL del túnel ngrok
```

### `frontend/.env`

```env
VITE_GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
VITE_SUPABASE_URL=https://tu-proyecto.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
VITE_API_BASE=http://localhost:8000
```

---

## Cámaras

Las cámaras se gestionan de dos formas:

1. **Via AdminPanel (recomendado)** — CRUD en tiempo real desde la UI sin reiniciar el backend. Requiere rol `admin`.
2. **Fallback en `backend/main.py`** — usado cuando Supabase no está disponible o la tabla `cameras` está vacía:

```python
CAMERAS_FALLBACK = [
    {"id": "cam1", "name": "Hall principal", "source": 0, "capacity": 30},
    {"id": "cam2", "name": "Biblioteca",     "source": 1, "capacity": 50},
]
```

- `source`: índice de webcam USB (`0`, `1`…) o URL RTSP (`"rtsp://..."`)
- `capacity`: aforo máximo del espacio

---

## Alertas por email

El sistema envía un email cuando el estado de ocupación de una cámara **sube de nivel**, únicamente dentro de la ventana horaria de almuerzo.

| Transición | Email |
|---|---|
| Normal → Ámbar (≥ 60%) | 🟡 Zona ámbar |
| Normal/Ámbar → Crítico (≥ 85%) | 🔴 Aforo crítico |
| Cualquier mejora | Sin email |

**Ventana horaria** (configurable en `main.py`):
```python
ALERT_HOUR_START = (13, 30)
ALERT_HOUR_END   = (14, 30)
```

Para Gmail: usa una [Contraseña de aplicación](https://myaccount.google.com/apppasswords) (requiere 2FA activado).

---

## Pasarela de pago — acceso admin

Un usuario con rol `viewer` y correo **`@pucv.cl`** (no `@mail.pucv.cl`) puede comprar el acceso de administrador mediante **Mercado Pago** (Checkout Pro). Tras el pago aprobado, su rol pasa a `admin` en la tabla `user_roles` y obtiene un JWT nuevo sin necesidad de reloguear.

**Flujo:**

```
viewer @pucv.cl
   │  click "Adquirir acceso"
   ├─→ POST /api/billing/create-preference   →  backend crea preferencia MP
   │                                             y devuelve init_point
   ├─→ redirige a Checkout Pro (Mercado Pago) →  el usuario paga
   ├─→ MP redirige a  /?billing=success&payment_id=...
   ├─→ POST /api/billing/confirm              →  backend verifica el pago con MP,
   │                                             sube el rol a admin, emite JWT
   └─→ (respaldo) POST /api/billing/webhook   →  MP notifica server-to-server;
                                                 fuente autoritativa si el usuario
                                                 cierra el navegador antes del redirect
```

**Requisitos:**
1. Credenciales **de producción** desde el [panel de Mercado Pago](https://www.mercadopago.cl/developers/panel/app) → `MP_ACCESS_TOKEN`.
2. Configura el webhook en el panel de MP apuntando a `https://tu-backend/api/billing/webhook` y copia la *clave secreta* en `MP_WEBHOOK_SECRET` (necesaria para validar la firma; sin ella el webhook se rechaza por seguridad).
3. Ejecuta la migración SQL de `DATABASE.md` (índice único en `user_roles.email` + tabla `admin_purchases`).
4. `PUBLIC_BACKEND_URL` es la URL pública HTTPS del backend (en producción: la URL de ngrok). En desarrollo local déjala vacía: el flujo `/confirm` sigue funcionando, solo no llega el webhook.

> El precio se fija en el servidor (`ADMIN_PRICE_CLP`); el monto nunca lo define el cliente. El backend valida que el pago esté `approved` y que su `external_reference` coincida con el correo autenticado antes de otorgar el rol.

---

## Arquitectura

```
Navegador
    │
    ├── GET  /                        →  React SPA (Vite)
    ├── POST /api/auth/google         →  FastAPI: valida token Google, emite JWT
    ├── GET  /api/cameras             →  FastAPI: lista cámaras + conteo + estado (todos)
    ├── GET  /api/cameras/config      →  FastAPI: configuración completa (solo admin)
    ├── POST /api/cameras             →  FastAPI: crear cámara (solo admin)
    ├── PATCH /api/cameras/{id}       →  FastAPI: editar cámara (solo admin)
    ├── DELETE /api/cameras/{id}      →  FastAPI: eliminar cámara (solo admin)
    ├── GET  /api/counter/{id}        →  FastAPI: conteo de una cámara específica
    ├── GET  /api/logs                →  FastAPI: logs del sistema (solo admin)
    ├── GET  /api/billing/status      →  FastAPI: ¿puede comprar admin? + precio
    ├── POST /api/billing/create-preference → FastAPI: crea pago en Mercado Pago
    ├── POST /api/billing/confirm     →  FastAPI: verifica pago, sube rol a admin
    ├── POST /api/billing/webhook     →  FastAPI: notificación de Mercado Pago (sin auth, firma)
    ├── GET  /video_feed/{id}         →  FastAPI: stream MJPEG (token en query param)
    └── GET  /health                  →  FastAPI: health check (sin auth)

FastAPI (hilos en background)
    ├── CameraWorker × N  → captura frames, corre YOLOv8, actualiza conteo
    ├── upload_loop       → escribe muestras en Supabase cada 10 s
    └── alert_loop        → detecta transiciones de estado, envía emails
```

**Polling del frontend:**
- Cada 2 s → `GET /api/cameras` → actualiza conteos y sparklines
- Cada 10 s → `GET /api/logs` → actualiza logs del sistema (solo admin)
- Cada 60 s → Supabase → actualiza gráfico histórico (solo admin)

---

## Despliegue en producción

El backend corre en la **PC local** (donde están las cámaras USB/RTSP) y se expone al internet mediante un túnel HTTPS. El frontend se aloja en la nube como sitio estático.

| Capa | Dónde | Por qué |
|---|---|---|
| **Backend** | PC Windows local | Las cámaras son USB o RTSP en red local — no son accesibles desde la nube |
| **Túnel HTTPS** | ngrok | Expone `localhost:8000` al internet con HTTPS sin abrir puertos del router |
| **Frontend** | DigitalOcean App Platform | Sitio estático gratuito, auto-deploy desde GitHub, HTTPS incluido |

**Inicio rápido de producción:**

```cmd
:: Doble clic o ejecutar desde la raíz del proyecto
start-prod.bat
```

`start-prod.bat` arranca uvicorn (sin `--reload`) y abre el túnel ngrok. Imprime la URL pública del backend al terminar.

Ver [`DEPLOY-WINDOWS.md`](DEPLOY-WINDOWS.md) para la guía completa paso a paso.

---

## Seguridad

- CORS restringido a `ALLOWED_ORIGINS`
- Rate limiting en `/api/auth/google` (10 req/min por IP)
- Todos los endpoints protegidos por JWT excepto `/health`
- Video stream autenticado via query param (`?token=`) — solo acceptable con HTTPS
- Dominios `@mail.pucv.cl` y `@pucv.cl` validados server-side contra la API de Google
- Pasarela de pago: precio fijado en el servidor, pago verificado contra la API de Mercado Pago, `external_reference` validado contra el usuario autenticado y firma del webhook (HMAC) comprobada antes de otorgar el rol

---

## Estructura del proyecto

```
SpotCheck/
├── backend/
│   ├── main.py            # FastAPI: cámaras, auth, alertas, logs, billing MP
│   ├── requirements.txt
│   ├── .env               # secretos locales (no en git)
│   ├── .env.example
│   ├── logs/              # logs de producción (no en git)
│   └── tests/
├── frontend/
│   ├── src/
│   │   ├── App.tsx        # Lógica principal + polling + retorno de MP
│   │   ├── api.ts         # Llamadas HTTP + helpers JWT + billing
│   │   ├── types.ts
│   │   ├── data.tsx       # Utilidades puras
│   │   ├── mapConfig.ts   # Etiquetas y posiciones de cámaras en el mapa
│   │   └── components/
│   │       ├── Login.tsx
│   │       ├── TopBar.tsx
│   │       ├── KpiCard.tsx
│   │       ├── FacultyCard.tsx
│   │       ├── CampusMap.tsx      # Mapa interactivo del campus
│   │       ├── DayChart.tsx       # Gráfico histórico de ocupación
│   │       ├── ActivityLog.tsx    # Log de eventos en pantalla
│   │       ├── AdminPanel.tsx     # CRUD de cámaras (solo admin)
│   │       ├── LivePreview.tsx    # Vista en vivo MJPEG (solo admin)
│   │       ├── LogViewer.tsx      # Visor de logs del sistema (solo admin)
│   │       ├── UpgradeAdmin.tsx   # CTA de compra de acceso admin (Mercado Pago)
│   │       └── LegalNotice.tsx    # Aviso de videovigilancia
│   ├── .env
│   └── .env.example
├── .do/
│   └── app.yaml           # Spec de DigitalOcean App Platform (frontend)
├── deploy/                # Configs de infraestructura (no en git)
│   ├── ngrok-config.yml   # Túnel ngrok → localhost:8000
│   ├── nginx.conf         # Para despliegue alternativo en VPS Linux
│   ├── setup-ssl.sh       # Certbot para VPS Linux
│   └── monitor-aforo.service  # Systemd para VPS Linux
├── DATABASE.md            # Esquema de Supabase + migración SQL de billing
├── DEPLOY-WINDOWS.md      # Guía de producción: PC Windows + ngrok + DO
├── start.bat              # Desarrollo local (con --reload)
├── start-prod.bat         # Producción (sin --reload + ngrok)
└── README.md
```
