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
| Producción | nginx + Let's Encrypt · Vercel (frontend) |

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

Las cámaras se configuran en `backend/main.py`:

```python
CAMERAS_CONFIG = [
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

## Arquitectura

```
Navegador
    │
    ├── GET  /                  →  React SPA (Vite)
    ├── POST /api/auth/google   →  FastAPI: valida token Google, emite JWT
    ├── GET  /api/cameras       →  FastAPI: lista cámaras + conteo + estado
    └── GET  /video_feed/{id}   →  FastAPI: stream MJPEG (token en query param)

FastAPI (hilos en background)
    ├── CameraWorker × N  → captura frames, corre YOLOv8, actualiza conteo
    ├── upload_loop       → escribe muestras en Supabase cada 10 s
    └── alert_loop        → detecta transiciones de estado, envía emails
```

**Polling del frontend:**
- Cada 2 s → `GET /api/cameras` → actualiza conteos y sparklines
- Cada 60 s → Supabase → actualiza gráfico histórico

---

## Despliegue en producción

- **Frontend** → Vercel (`frontend/` como root, variables en Vercel Dashboard)
- **Backend** → servidor Ubuntu 22.04 con nginx + certbot + systemd

---

## Seguridad

- CORS restringido a `ALLOWED_ORIGINS`
- Rate limiting en `/api/auth/google` (10 req/min por IP)
- Todos los endpoints protegidos por JWT excepto `/health`
- Video stream autenticado via query param (`?token=`) — solo acceptable con HTTPS
- Dominio `@mail.pucv.cl` validado server-side contra la API de Google

---

## Estructura del proyecto

```
MonitorDeAforo-preview-/
├── backend/
│   ├── main.py            # FastAPI: cámaras, auth, alertas
│   ├── requirements.txt
│   ├── .env               # 
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── App.tsx        # Lógica principal + polling
│   │   ├── api.ts         # Llamadas HTTP
│   │   ├── types.ts
│   │   ├── data.tsx       # Utilidades puras
│   │   └── components/
│   ├── .env               #
│   └── .env.example
├── deploy/
│   ├── nginx.conf
│   ├── setup-ssl.sh
│   └── monitor-aforo.service
├── DEPLOY.md
├── start.bat
└── README.md
```
