import cv2
import time
import logging
import threading
import os
import re
import hmac
import hashlib
import smtplib
import ssl
from collections import deque
from contextlib import asynccontextmanager
from datetime import datetime, timezone, timedelta
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

import requests
import numpy as np
import torch
from fastapi import FastAPI, HTTPException, Depends, Request, Query
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from ultralytics import YOLO
from jose import jwt, JWTError
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Buffer en memoria para el visor de logs del frontend (últimas 200 entradas)
LOG_BUFFER: deque = deque(maxlen=200)

class _MemHandler(logging.Handler):
    def emit(self, record: logging.LogRecord):
        LOG_BUFFER.append({
            "ts": datetime.fromtimestamp(record.created).strftime("%Y-%m-%dT%H:%M:%S"),
            "level": record.levelname,
            "msg": record.getMessage(),
        })

logger.addHandler(_MemHandler())

# ─────────────────────────────────────────────
# CONFIGURACIÓN
# ─────────────────────────────────────────────
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
FRAME_W, FRAME_H = 640, 480
UPLOAD_INTERVAL = 10  # segundos entre escrituras a Supabase

# Credenciales desde .env o config.py como fallback
try:
    from config import SUPABASE_URL, SUPABASE_SERVICE_KEY, GOOGLE_CLIENT_ID
except ImportError:
    SUPABASE_URL = os.getenv("SUPABASE_URL", "")
    SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")
    GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")

# Normalizar: eliminar /rest/v1 y barras finales que algunos usuarios copian
# desde el panel de Supabase (la URL base debe ser https://xxx.supabase.co)
SUPABASE_URL = SUPABASE_URL.rstrip("/")
if SUPABASE_URL.endswith("/rest/v1"):
    SUPABASE_URL = SUPABASE_URL[: -len("/rest/v1")]
SUPABASE_ENABLED = bool(SUPABASE_URL) and bool(SUPABASE_SERVICE_KEY)

# Seguridad
JWT_SECRET = os.getenv("JWT_SECRET", "CAMBIA-ESTO-EN-PRODUCCION")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_HOURS = 8

ALLOWED_DOMAINS = ["@mail.pucv.cl", "@pucv.cl"]
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "http://localhost:5173").split(",")

# ─────────────────────────────────────────────
# MERCADO PAGO — COMPRA DE ACCESO ADMIN
# ─────────────────────────────────────────────
# Un usuario con rol "viewer" y correo @pucv.cl puede comprar el acceso de
# administrador. Tras el pago aprobado, su rol pasa a "admin" en user_roles.
MP_API_BASE       = "https://api.mercadopago.com"
MP_ACCESS_TOKEN   = os.getenv("MP_ACCESS_TOKEN", "")          # APP_USR-... (producción)
MP_WEBHOOK_SECRET = os.getenv("MP_WEBHOOK_SECRET", "")        # firma de notificaciones (opcional pero recomendado)
ADMIN_PRICE       = int(os.getenv("ADMIN_PRICE_CLP", "5000")) # precio del acceso admin en CLP
MP_CURRENCY       = os.getenv("MP_CURRENCY", "CLP")
MP_ENABLED        = bool(MP_ACCESS_TOKEN)

# Solo el dominio institucional exacto @pucv.cl puede comprar admin
# (excluye @mail.pucv.cl, que es el dominio de estudiantes).
BILLING_DOMAIN = "@pucv.cl"

# URL base del frontend para las back_urls de Checkout Pro (primer origen permitido).
FRONTEND_BASE = ALLOWED_ORIGINS[0].strip().rstrip("/") if ALLOWED_ORIGINS else ""

# URL pública del backend (https) para el notification_url del webhook de MP.
# En desarrollo local no es alcanzable por MP; déjala vacía y usa solo /confirm.
PUBLIC_BACKEND_URL = os.getenv("PUBLIC_BACKEND_URL", "").strip().rstrip("/")

# Configuración de cámaras por defecto. Se usa como FALLBACK cuando Supabase no
# está disponible o la tabla "cameras" está vacía. En producción, gestiona las
# cámaras desde la tabla "cameras" de Supabase (ver supabase/cameras.sql).
CAMERAS_FALLBACK = [
    {"id": "cam1", "name": "Camara 1 - Webcam",  "source": 0, "capacity": 10, "building": ""},
    {"id": "cam2", "name": "Camara 2 - Celular", "source": 1, "capacity": 10, "building": ""},
]

# Origen efectivo de la configuración cargada ("supabase" | "fallback").
# Lo actualiza load_cameras_config() al arrancar.
CAMERAS_SOURCE = "fallback"


def _parse_camera_source(raw):
    """La fuente puede ser un índice de webcam (entero) o una URL/ruta (RTSP,
    archivo). En Supabase se guarda como texto; aquí lo convertimos a int cuando
    representa un índice numérico, y lo dejamos como string en cualquier otro caso."""
    if isinstance(raw, int):
        return raw
    s = str(raw).strip()
    return int(s) if s.lstrip("-").isdigit() else s


def fetch_cameras_from_supabase():
    """Lee las cámaras activas desde la tabla 'cameras' de Supabase.
    Devuelve una lista de configs, o None si Supabase está desactivado o falla."""
    if not SUPABASE_ENABLED:
        return None

    url = f"{SUPABASE_URL}/rest/v1/cameras"
    headers = {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
    }
    params = {
        "select": "id,name,source,capacity,building,enabled,sort_order",
        "enabled": "eq.true",
        "order": "sort_order.asc,id.asc",
    }
    try:
        res = requests.get(url, headers=headers, params=params, timeout=5)
    except Exception as e:
        logger.warning(f"No se pudo leer 'cameras' de Supabase: {e}")
        return None

    if res.status_code != 200:
        logger.warning(f"Supabase 'cameras' respondió {res.status_code}: {res.text}")
        return None

    try:
        rows = res.json()
    except ValueError:
        logger.warning("Respuesta de 'cameras' no es JSON válido")
        return None

    config = []
    for row in rows:
        cam_id = row.get("id")
        source = row.get("source")
        if not cam_id or source is None:
            logger.warning(f"Fila de cámara ignorada (id/source faltante): {row}")
            continue
        config.append({
            "id": str(cam_id),
            "name": row.get("name") or str(cam_id),
            "source": _parse_camera_source(source),
            "capacity": int(row.get("capacity") or 50),
            "building": row.get("building") or "",
        })
    return config


def load_cameras_config():
    """Configuración efectiva de cámaras: Supabase si está disponible y tiene
    filas; en caso contrario, la lista local CAMERAS_FALLBACK."""
    global CAMERAS_SOURCE
    remote = fetch_cameras_from_supabase()
    if remote:
        CAMERAS_SOURCE = "supabase"
        logger.info(f"Cámaras cargadas desde Supabase: {len(remote)}")
        return remote
    CAMERAS_SOURCE = "fallback"
    logger.info(f"Cámaras desde configuración local (fallback): {len(CAMERAS_FALLBACK)}")
    return CAMERAS_FALLBACK


def _supabase_rest(method: str, path: str, *, params=None, json=None, prefer=None):
    """Llamada genérica a la REST API de Supabase con la SERVICE KEY.
    Devuelve el objeto Response de requests (el llamador interpreta el status)."""
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    headers = {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": "application/json",
    }
    if prefer:
        headers["Prefer"] = prefer
    return requests.request(method, url, headers=headers, params=params, json=json, timeout=5)

# ─────────────────────────────────────────────
# ALERTAS POR EMAIL (SMTP)
# ─────────────────────────────────────────────
SMTP_HOST     = os.getenv("SMTP_HOST", "")
SMTP_PORT     = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER     = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
ALERT_FROM    = os.getenv("ALERT_FROM", SMTP_USER)
ALERT_TO      = [e.strip() for e in os.getenv("ALERT_RECIPIENTS", "").split(",") if e.strip()]
ALERTS_ENABLED = bool(SMTP_HOST and SMTP_USER and SMTP_PASSWORD and ALERT_TO)

# Umbrales de ocupación — deben coincidir con el frontend (App.tsx: WARN_T, DANGER_T)
WARN_PCT   = 40   # % → zona ámbar
DANGER_PCT = 75   # % → zona crítica

# Ventana horaria de alertas (hora local del servidor)
ALERT_HOUR_START = (13, 30)  # 13:30
ALERT_HOUR_END   = (14, 30)  # 14:30

# Orden de gravedad para detectar si una transición escala o no
_STATUS_RANK = {"ok": 0, "warn": 1, "danger": 2}


def occupancy_status(count: int, capacity: int) -> str:
    """Devuelve 'ok', 'warn' o 'danger' igual que el frontend."""
    if capacity <= 0:
        return "ok"
    pct = (count / capacity) * 100
    if pct >= DANGER_PCT:
        return "danger"
    if pct >= WARN_PCT:
        return "warn"
    return "ok"


def in_alert_window() -> bool:
    """True si la hora local del servidor está dentro de la ventana de alertas."""
    now = datetime.now()
    start = now.replace(hour=ALERT_HOUR_START[0], minute=ALERT_HOUR_START[1], second=0, microsecond=0)
    end   = now.replace(hour=ALERT_HOUR_END[0],   minute=ALERT_HOUR_END[1],   second=0, microsecond=0)
    return start <= now <= end

# ─────────────────────────────────────────────
# RATE LIMITER
# ─────────────────────────────────────────────
limiter = Limiter(key_func=get_remote_address)


# ─────────────────────────────────────────────
# ROLES DE USUARIO
# ─────────────────────────────────────────────
def fetch_user_role(email: str) -> str:
    """Consulta la tabla 'user_roles' de Supabase y devuelve el rol del usuario.
    Si el email no aparece en la tabla, o Supabase no responde, devuelve 'viewer'.
    Nunca lanza excepción: un fallo de red no debe bloquear el login."""
    if not SUPABASE_ENABLED:
        return "viewer"

    url = f"{SUPABASE_URL}/rest/v1/user_roles"
    headers = {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
    }
    params = {"email": f"eq.{email}", "select": "role"}
    try:
        res = requests.get(url, headers=headers, params=params, timeout=3)
    except Exception:
        return "viewer"

    if res.status_code != 200:
        return "viewer"

    try:
        rows = res.json()
        return str(rows[0]["role"]) if rows else "viewer"
    except (ValueError, KeyError, IndexError):
        return "viewer"


# ─────────────────────────────────────────────
# MERCADO PAGO — HELPERS
# ─────────────────────────────────────────────
def _mp_request(method: str, path: str, *, json=None, params=None):
    """Llamada a la REST API de Mercado Pago con el access token (sin SDK,
    igual que el resto del proyecto). Devuelve el Response de requests."""
    headers = {
        "Authorization": f"Bearer {MP_ACCESS_TOKEN}",
        "Content-Type": "application/json",
    }
    return requests.request(
        method, f"{MP_API_BASE}{path}",
        headers=headers, json=json, params=params, timeout=10,
    )


def can_buy_admin(email: str, role: str) -> bool:
    """True si el usuario puede comprar el acceso admin: correo @pucv.cl exacto
    (no @mail.pucv.cl) y que todavía no sea admin."""
    return email.lower().endswith(BILLING_DOMAIN) and role != "admin"


def grant_admin(email: str, payment_id: str | None = None, amount: float | None = None) -> bool:
    """Sube el rol del usuario a 'admin' en Supabase (upsert por email) y deja
    registro de la compra. Idempotente: invocable desde /confirm y desde el
    webhook sin duplicar efecto. Devuelve True si el rol quedó como admin."""
    if not SUPABASE_ENABLED:
        logger.error(f"[BILLING] No se puede otorgar admin a {email}: Supabase desactivado")
        return False

    # Upsert en user_roles (requiere índice único en 'email'; ver DATABASE.md)
    res = _supabase_rest(
        "POST", "user_roles",
        json={"email": email, "role": "admin"},
        prefer="resolution=merge-duplicates,return=minimal",
    )
    if res.status_code not in (200, 201, 204):
        logger.error(f"[BILLING] Supabase rechazó el upsert de rol para {email}: "
                     f"{res.status_code} {res.text}")
        return False

    # Auditoría de la compra (best-effort: no bloquea el otorgamiento del rol)
    try:
        _supabase_rest(
            "POST", "admin_purchases",
            json={
                "email": email,
                "payment_id": str(payment_id) if payment_id is not None else None,
                "amount": amount,
                "currency": MP_CURRENCY,
                "status": "approved",
            },
            prefer="return=minimal",
        )
    except Exception as e:
        logger.warning(f"[BILLING] No se pudo registrar la compra de {email}: {e}")

    logger.info(f"[BILLING] Acceso admin otorgado a {email} (pago {payment_id})")
    return True


def verify_webhook_signature(request: Request, data_id: str) -> bool:
    """Valida la firma HMAC de la notificación de Mercado Pago (cabecera
    x-signature + x-request-id). Si no hay MP_WEBHOOK_SECRET configurado, no se
    puede validar y se rechaza por seguridad. Ver:
    https://www.mercadopago.cl/developers/es/docs/your-integrations/notifications/webhooks"""
    if not MP_WEBHOOK_SECRET:
        return False

    x_signature = request.headers.get("x-signature", "")
    x_request_id = request.headers.get("x-request-id", "")
    # x-signature: "ts=<unix>,v1=<hmac_hex>"
    parts = {}
    for piece in x_signature.split(","):
        k, _, v = piece.partition("=")
        parts[k.strip()] = v.strip()
    ts, v1 = parts.get("ts"), parts.get("v1")
    if not ts or not v1:
        return False

    manifest = f"id:{data_id};request-id:{x_request_id};ts:{ts};"
    expected = hmac.new(
        MP_WEBHOOK_SECRET.encode(), manifest.encode(), hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, v1)


# ─────────────────────────────────────────────
# JWT — HELPERS DE SESIÓN
# ─────────────────────────────────────────────
def create_session_token(
    email: str, name: str | None, picture: str | None, role: str = "viewer"
) -> str:
    expire = datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRE_HOURS)
    payload = {
        "sub": email,
        "name": name,
        "picture": picture,
        "role": role,
        "exp": expire,
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_session_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        if not payload.get("sub"):
            raise HTTPException(401, "Token sin usuario")
        return payload
    except JWTError:
        raise HTTPException(401, "Token de sesión inválido o expirado")


# Dependencia para endpoints protegidos (header Authorization: Bearer <token>)
_bearer = HTTPBearer()


def require_auth(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
) -> dict:
    return decode_session_token(credentials.credentials)


def require_admin(user: dict = Depends(require_auth)) -> dict:
    """Igual que require_auth pero exige role='admin'. Usar en endpoints de gestión."""
    if user.get("role") != "admin":
        raise HTTPException(403, "Se requiere rol de administrador")
    return user


# Dependencia para el video feed (query param ?token=, porque <img src> no admite headers)
def require_auth_query(
    token: str = Query(..., description="JWT de sesión"),
) -> dict:
    return decode_session_token(token)


# ─────────────────────────────────────────────
# FRAME PLACEHOLDER
# ─────────────────────────────────────────────
def make_placeholder(text, color=(0, 165, 255)):
    """Frame JPEG con un mensaje (cuando no hay cámara)."""
    frame = np.full((FRAME_H, FRAME_W, 3), 38, dtype=np.uint8)
    font = cv2.FONT_HERSHEY_SIMPLEX
    size = cv2.getTextSize(text, font, 0.8, 2)[0]
    x = (FRAME_W - size[0]) // 2
    y = (FRAME_H + size[1]) // 2
    cv2.putText(frame, text, (x, y), font, 0.8, color, 2)
    ok, buf = cv2.imencode(".jpg", frame)
    return buf.tobytes() if ok else None


# ─────────────────────────────────────────────
# WORKER POR CÁMARA
# ─────────────────────────────────────────────
class CameraWorker:
    def __init__(self, cam_id, name, source, capacity: int = 50, building: str = ""):
        self.id = cam_id
        self.name = name
        self.source = source
        self.capacity = capacity
        self.building = building
        self.model = YOLO("yolov8n.pt")
        self.model.to(DEVICE)

        self.lock = threading.Lock()
        self.latest_frame = make_placeholder(f"{name}: iniciando...")
        self.count = 0
        self.online = False
        self.error = None
        self.prev_status: str = "ok"  # último estado conocido; detecta transiciones
        self._running = False
        self._thread = None

    def start(self):
        self._running = True
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

    def stop(self):
        self._running = False
        if self._thread:
            self._thread.join(timeout=2)

    def _loop(self):
        while self._running:
            backend = cv2.CAP_DSHOW if isinstance(self.source, int) else cv2.CAP_ANY
            cap = cv2.VideoCapture(self.source, backend)

            if not cap.isOpened():
                self.online = False
                self.error = f"No se pudo abrir: {self.source}"
                logger.warning(f"[{self.id}] {self.error} - reintento en 3s")
                with self.lock:
                    self.latest_frame = make_placeholder(f"{self.name}: SIN SENAL")
                    self.count = 0
                time.sleep(3)
                continue

            cap.set(cv2.CAP_PROP_FRAME_WIDTH, FRAME_W)
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, FRAME_H)
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
            self.online = True
            self.error = None
            logger.info(f"[{self.id}] Capturando desde {self.source}")

            while self._running:
                ok, frame = cap.read()
                if not ok:
                    logger.warning(f"[{self.id}] Frame perdido, reconectando…")
                    with self.lock:
                        self.latest_frame = make_placeholder(f"{self.name}: RECONECTANDO")
                        self.count = 0
                    break

                results = self.model.track(
                    frame, classes=0, persist=True,
                    tracker="bytetrack.yaml", verbose=False, device=DEVICE,
                )

                count = 0
                if results and results[0].boxes is not None:
                    boxes = results[0].boxes.xyxy.cpu().numpy()
                    ids = (results[0].boxes.id.cpu().numpy().astype(int)
                           if results[0].boxes.id is not None
                           else [None] * len(boxes))
                    count = len(boxes)
                    for box, tid in zip(boxes, ids):
                        x1, y1, x2, y2 = map(int, box)
                        cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 255, 0), 2)
                        label = f"ID {tid}" if tid is not None else "Persona"
                        cv2.putText(frame, label, (x1, y1 - 10),
                                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 1)

                cv2.putText(frame, f"{self.name} | Aforo: {count}",
                            (15, 35), cv2.FONT_HERSHEY_SIMPLEX, 0.7,
                            (0, 200, 255), 2)

                ok2, buf = cv2.imencode(".jpg", frame)
                if ok2:
                    with self.lock:
                        self.latest_frame = buf.tobytes()
                        self.count = count

            cap.release()
            self.online = False

    def snapshot(self):
        with self.lock:
            return self.latest_frame


CAMERAS = {}
# Protege mutaciones e iteraciones de CAMERAS (los workers se crean/eliminan
# desde los handlers de la API mientras los hilos de upload/alertas iteran).
CAMERAS_LOCK = threading.RLock()


def cameras_snapshot():
    """Copia de los workers activos para iterar sin riesgo de mutación concurrente."""
    with CAMERAS_LOCK:
        return list(CAMERAS.values())


def start_worker(cfg: dict):
    """Crea y arranca un worker desde una config (con 'source' ya parseada)."""
    worker = CameraWorker(
        cfg["id"], cfg["name"], cfg["source"],
        capacity=cfg.get("capacity", 50),
        building=cfg.get("building", ""),
    )
    worker.start()
    with CAMERAS_LOCK:
        CAMERAS[cfg["id"]] = worker
    logger.info(f"Worker iniciado: {cfg['id']} (capacidad: {cfg.get('capacity', 50)})")
    return worker


def stop_worker(cam_id: str):
    """Detiene y elimina un worker si existe."""
    with CAMERAS_LOCK:
        worker = CAMERAS.pop(cam_id, None)
    if worker:
        worker.stop()
        logger.info(f"Worker detenido: {cam_id}")


def reconcile_worker(cfg: dict):
    """Ajusta el worker en ejecución para que coincida con la config dada:
      · enabled=False    → detiene el worker
      · sin worker       → lo arranca (si enabled)
      · cambió la fuente → reinicia el worker
      · solo metadatos   → actualiza en sitio (sin recargar el modelo YOLO)"""
    cam_id = cfg["id"]
    if not cfg.get("enabled", True):
        stop_worker(cam_id)
        return
    with CAMERAS_LOCK:
        existing = CAMERAS.get(cam_id)
    if existing is None:
        start_worker(cfg)
    elif str(existing.source) != str(cfg["source"]):
        stop_worker(cam_id)
        start_worker(cfg)
    else:
        existing.name = cfg["name"]
        existing.capacity = cfg.get("capacity", existing.capacity)
        existing.building = cfg.get("building", existing.building)


# ─────────────────────────────────────────────
# UPLOADER A SUPABASE
# ─────────────────────────────────────────────
def upload_loop():
    if not SUPABASE_ENABLED:
        logger.warning("Supabase no configurado - persistencia desactivada.")
        return

    url = f"{SUPABASE_URL}/rest/v1/samples"
    headers = {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }

    while True:
        time.sleep(UPLOAD_INTERVAL)
        rows = [{"camera_id": w.id, "count": w.count} for w in cameras_snapshot()]
        if not rows:
            continue
        try:
            res = requests.post(url, json=rows, headers=headers, timeout=5)
            if res.status_code in (200, 201):
                logger.info(f"Supabase: {len(rows)} muestras subidas")
            else:
                logger.warning(f"Supabase respondio {res.status_code}: {res.text}")
        except Exception as e:
            logger.warning(f"Supabase sin conexion: {e}")


# ─────────────────────────────────────────────
# ALERTAS POR EMAIL
# ─────────────────────────────────────────────
_STATUS_LABEL = {
    "ok":     "normal (baja ocupación)",
    "warn":   "ámbar (ocupación media)",
    "danger": "crítico (aforo superado)",
}
_STATUS_COLOR = {"ok": "#27ae60", "warn": "#e67e22", "danger": "#c0392b"}


def send_alert_email(cam: "CameraWorker", prev: str, new: str) -> bool:
    """Envía email al detectar una transición de estado escalante.
    Devuelve True si el email se envió correctamente."""
    if not ALERTS_ENABLED:
        return False

    now_str = datetime.now().strftime("%d/%m/%Y %H:%M:%S")
    pct = round((cam.count / cam.capacity) * 100) if cam.capacity > 0 else 0

    subject = (
        f"[SpotCheck] 🔴 Aforo crítico: {cam.name}"
        if new == "danger"
        else f"[SpotCheck] 🟡 Zona ámbar: {cam.name}"
    )

    texto = (
        f"{'🔴 AFORO CRÍTICO' if new == 'danger' else '🟡 ZONA ÁMBAR'}\n\n"
        f"Cámara     : {cam.name}\n"
        f"Transición : {_STATUS_LABEL[prev]}  →  {_STATUS_LABEL[new]}\n"
        f"Personas   : {cam.count} / {cam.capacity}\n"
        f"Ocupación  : {pct}%\n"
        f"Hora       : {now_str}\n\n"
        f"Revisa el dashboard para más detalles.\n"
        f"Este mensaje es automático — no respondas a este correo."
    )

    color = _STATUS_COLOR[new]
    html = f"""\
<html>
<body style="font-family:sans-serif;color:#222;max-width:520px;">
  <h2 style="color:{color};">
    {'🔴 Aforo Crítico' if new == 'danger' else '🟡 Zona Ámbar'}
  </h2>
  <table style="border-collapse:collapse;width:100%;">
    <tr>
      <td style="padding:5px 14px 5px 0;font-weight:bold;white-space:nowrap;">Cámara</td>
      <td>{cam.name}</td>
    </tr>
    <tr>
      <td style="padding:5px 14px 5px 0;font-weight:bold;white-space:nowrap;">Transición</td>
      <td>
        <span style="color:#888;">{_STATUS_LABEL[prev]}</span>
        &nbsp;→&nbsp;
        <span style="color:{color};font-weight:bold;">{_STATUS_LABEL[new]}</span>
      </td>
    </tr>
    <tr>
      <td style="padding:5px 14px 5px 0;font-weight:bold;white-space:nowrap;">Personas</td>
      <td style="color:{color};font-size:1.2em;font-weight:bold;">
        {cam.count} <span style="font-size:0.8em;color:#888;">/ {cam.capacity}</span>
      </td>
    </tr>
    <tr>
      <td style="padding:5px 14px 5px 0;font-weight:bold;white-space:nowrap;">Ocupación</td>
      <td style="color:{color};font-weight:bold;">{pct}%</td>
    </tr>
    <tr>
      <td style="padding:5px 14px 5px 0;font-weight:bold;white-space:nowrap;">Hora</td>
      <td>{now_str}</td>
    </tr>
  </table>
  <p style="color:#aaa;font-size:11px;margin-top:24px;">
    Mensaje automático generado por SpotCheck durante el horario de almuerzo.<br>
    No respondas a este correo.
  </p>
</body>
</html>"""

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"]    = ALERT_FROM
    msg["To"]      = ", ".join(ALERT_TO)
    msg.attach(MIMEText(texto, "plain", "utf-8"))
    msg.attach(MIMEText(html,  "html",  "utf-8"))

    try:
        ctx = ssl.create_default_context()
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
            server.ehlo()
            server.starttls(context=ctx)
            server.login(SMTP_USER, SMTP_PASSWORD)
            server.sendmail(ALERT_FROM, ALERT_TO, msg.as_string())
        logger.info(
            f"[ALERTA] Email enviado — {cam.name}: {prev} → {new} "
            f"({cam.count}/{cam.capacity}) → {ALERT_TO}"
        )
        return True
    except Exception as exc:
        logger.error(f"[ALERTA] Error al enviar email: {exc}")
        return False


def alert_loop():
    """Monitorea el estado de ocupación de cada cámara cada UPLOAD_INTERVAL segundos.

    Condiciones para enviar una alerta:
      1. Hora local dentro de la ventana ALERT_HOUR_START – ALERT_HOUR_END
      2. La cámara está online
      3. El estado de ocupación subió de nivel (ok→warn, ok→danger, warn→danger)

    El estado anterior se rastrea en cam.prev_status para detectar transiciones.
    Las transiciones descendentes (mejoras) no generan email.
    """
    if not ALERTS_ENABLED:
        logger.warning(
            "Alertas por email desactivadas "
            "(configura SMTP_HOST, SMTP_USER, SMTP_PASSWORD y ALERT_RECIPIENTS en .env)"
        )
        return

    h_start = f"{ALERT_HOUR_START[0]:02d}:{ALERT_HOUR_START[1]:02d}"
    h_end   = f"{ALERT_HOUR_END[0]:02d}:{ALERT_HOUR_END[1]:02d}"
    logger.info(
        f"[ALERTA] Monitor activo — ventana: {h_start}–{h_end} "
        f"→ destinatarios: {', '.join(ALERT_TO)}"
    )

    while True:
        time.sleep(UPLOAD_INTERVAL)

        if not in_alert_window():
            continue  # fuera del horario de almuerzo, no hacer nada

        for cam in cameras_snapshot():
            if not cam.online:
                # Cámara caída: no alertar, pero tampoco cambiar prev_status
                continue

            new_status = occupancy_status(cam.count, cam.capacity)
            prev_status = cam.prev_status

            if new_status != prev_status:
                # Siempre actualizamos el estado para rastrear transiciones correctamente
                cam.prev_status = new_status

                escalating = _STATUS_RANK[new_status] > _STATUS_RANK[prev_status]
                if escalating:
                    send_alert_email(cam, prev=prev_status, new=new_status)
                else:
                    logger.info(
                        f"[ALERTA] {cam.name}: {prev_status} → {new_status} "
                        f"(mejora, sin email)"
                    )


# ─────────────────────────────────────────────
# CICLO DE VIDA
# ─────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(f"Dispositivo de inferencia: {DEVICE.upper()}")
    if DEVICE == "cuda":
        logger.info(f"GPU: {torch.cuda.get_device_name(0)}")
    for cfg in load_cameras_config():
        try:
            start_worker(cfg)
        except Exception as e:
            logger.error(f"No se pudo iniciar worker {cfg['id']}: {e}")

    threading.Thread(target=upload_loop, daemon=True).start()
    logger.info(f"Uploader Supabase: {'activo' if SUPABASE_ENABLED else 'desactivado'}")

    threading.Thread(target=alert_loop, daemon=True).start()

    yield
    for worker in cameras_snapshot():
        worker.stop()
    logger.info("Workers detenidos.")


app = FastAPI(lifespan=lifespan, title="SpotCheck API")

# Rate limiter registrado en la app
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# CORS restringido al frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)


# ─────────────────────────────────────────────
# STREAMING  (requiere JWT en query param)
# ─────────────────────────────────────────────
def mjpeg_stream(cam_id):
    worker = CAMERAS[cam_id]
    while True:
        frame = worker.snapshot()
        if frame is None:
            time.sleep(0.05)
            continue
        yield (b"--frame\r\n"
               b"Content-Type: image/jpeg\r\n\r\n" + frame + b"\r\n")
        time.sleep(0.03)


@app.get("/video_feed/{cam_id}")
async def video_feed(
    cam_id: str,
    _user: dict = Depends(require_auth_query),
):
    if cam_id not in CAMERAS:
        raise HTTPException(404, "Camara no encontrada")
    return StreamingResponse(
        mjpeg_stream(cam_id),
        media_type="multipart/x-mixed-replace; boundary=frame",
    )


# ─────────────────────────────────────────────
# API  (todos los endpoints requieren JWT en header)
# ─────────────────────────────────────────────
@app.get("/api/cameras")
async def list_cameras(_user: dict = Depends(require_auth)):
    return [
        {
            "id": w.id,
            "name": w.name,
            "building": w.building,
            "count": w.count,
            "capacity": w.capacity,
            "status": occupancy_status(w.count, w.capacity),
            "online": w.online,
            "error": w.error,
        }
        for w in cameras_snapshot()
    ]


@app.get("/api/cameras/config")
async def cameras_config(_admin: dict = Depends(require_admin)):
    """Listado completo para administración (solo admins). Lee la tabla 'cameras'
    de Supabase con todos los campos —incluida 'source'— porque el admin necesita
    editarla, y anota el estado 'online' en vivo desde los workers."""
    online_map = {w.id: w.online for w in cameras_snapshot()}

    if not SUPABASE_ENABLED:
        # Sin Supabase no hay persistencia; devolvemos lo que hay en memoria.
        return {
            "source": CAMERAS_SOURCE,
            "supabase": False,
            "cameras": [
                {
                    "id": w.id, "name": w.name, "source": str(w.source),
                    "capacity": w.capacity, "building": w.building,
                    "enabled": True, "sort_order": 0,
                    "online": w.online,
                }
                for w in cameras_snapshot()
            ],
        }

    res = _supabase_rest(
        "GET", "cameras",
        params={"select": "*", "order": "sort_order.asc,id.asc"},
    )
    rows = res.json() if res.status_code == 200 else []
    for r in rows:
        r["online"] = online_map.get(r["id"], False)
    return {"source": CAMERAS_SOURCE, "supabase": True, "cameras": rows}


# ── Gestión de cámaras (CRUD) — solo administradores ──────────────────────────
_CAM_ID_RE = re.compile(r"^[a-zA-Z0-9_-]{1,40}$")


class CameraCreate(BaseModel):
    id: str
    name: str
    source: str
    capacity: int = 50
    building: str = ""
    enabled: bool = True
    sort_order: int = 0


class CameraUpdate(BaseModel):
    name: str | None = None
    source: str | None = None
    capacity: int | None = None
    building: str | None = None
    enabled: bool | None = None
    sort_order: int | None = None


def _require_supabase_for_writes():
    if not SUPABASE_ENABLED:
        raise HTTPException(503, "Supabase no está configurado; la gestión de cámaras requiere persistencia.")


@app.post("/api/cameras", status_code=201)
async def create_camera(payload: CameraCreate, _admin: dict = Depends(require_admin)):
    _require_supabase_for_writes()
    if not _CAM_ID_RE.match(payload.id):
        raise HTTPException(422, "El id solo admite letras, números, '-' y '_' (máx. 40).")
    if not payload.name.strip():
        raise HTTPException(422, "El nombre es obligatorio.")
    if not payload.source.strip():
        raise HTTPException(422, "La fuente es obligatoria.")
    if payload.capacity <= 0:
        raise HTTPException(422, "La capacidad debe ser mayor que 0.")

    res = _supabase_rest("POST", "cameras", json=payload.model_dump(), prefer="return=representation")
    if res.status_code == 409 or "duplicate key" in res.text.lower():
        raise HTTPException(409, f"Ya existe una cámara con id '{payload.id}'.")
    if res.status_code not in (200, 201):
        raise HTTPException(502, f"Supabase rechazó la creación: {res.text}")

    reconcile_worker({
        "id": payload.id,
        "name": payload.name,
        "source": _parse_camera_source(payload.source),
        "capacity": payload.capacity,
        "building": payload.building,
        "enabled": payload.enabled,
    })
    return {"ok": True, "id": payload.id}


@app.patch("/api/cameras/{cam_id}")
async def update_camera(cam_id: str, payload: CameraUpdate, _admin: dict = Depends(require_admin)):
    _require_supabase_for_writes()
    fields = payload.model_dump(exclude_unset=True)
    if not fields:
        raise HTTPException(400, "No se envió ningún campo para actualizar.")
    if "capacity" in fields and (fields["capacity"] is None or fields["capacity"] <= 0):
        raise HTTPException(422, "La capacidad debe ser mayor que 0.")

    res = _supabase_rest(
        "PATCH", "cameras",
        params={"id": f"eq.{cam_id}"},
        json=fields, prefer="return=representation",
    )
    if res.status_code not in (200, 204):
        raise HTTPException(502, f"Supabase rechazó la actualización: {res.text}")
    rows = res.json() if res.text else []
    if not rows:
        raise HTTPException(404, "Cámara no encontrada.")

    row = rows[0]
    reconcile_worker({
        "id": row["id"],
        "name": row["name"],
        "source": _parse_camera_source(row["source"]),
        "capacity": int(row["capacity"]),
        "building": row.get("building") or "",
        "enabled": row.get("enabled", True),
    })
    return {"ok": True, "id": cam_id}


@app.delete("/api/cameras/{cam_id}")
async def delete_camera(cam_id: str, _admin: dict = Depends(require_admin)):
    _require_supabase_for_writes()
    res = _supabase_rest(
        "DELETE", "cameras",
        params={"id": f"eq.{cam_id}"}, prefer="return=representation",
    )
    if res.status_code not in (200, 204):
        raise HTTPException(502, f"Supabase rechazó el borrado: {res.text}")
    rows = res.json() if res.text else []
    if not rows:
        raise HTTPException(404, "Cámara no encontrada.")
    stop_worker(cam_id)
    return {"ok": True, "id": cam_id}


class GoogleTokenPayload(BaseModel):
    id_token: str


@app.post("/api/auth/google")
@limiter.limit("10/minute")
async def auth_google(request: Request, payload: GoogleTokenPayload):
    """
    Valida el id_token de Google, comprueba dominio @mail.pucv.cl
    y devuelve un JWT de sesión firmado por este servidor (8 horas).
    """
    try:
        res = requests.get(
            "https://oauth2.googleapis.com/tokeninfo",
            params={"id_token": payload.id_token},
            timeout=5,
        )
    except requests.RequestException:
        raise HTTPException(502, "No se pudo validar el token con Google")

    if res.status_code != 200:
        raise HTTPException(401, "Token de Google invalido")

    data = res.json()

    if GOOGLE_CLIENT_ID and data.get("aud") != GOOGLE_CLIENT_ID:
        raise HTTPException(401, "Token no corresponde al cliente")

    email = (data.get("email") or "").lower()
    if not email:
        raise HTTPException(401, "El token no incluye correo")

    if str(data.get("email_verified")).lower() != "true":
        raise HTTPException(401, "Correo no verificado")

    if not any(email.endswith(d) for d in ALLOWED_DOMAINS):
        raise HTTPException(403, "Dominio de correo no permitido")

    role = fetch_user_role(email)
    session_token = create_session_token(
        email=email,
        name=data.get("name"),
        picture=data.get("picture"),
        role=role,
    )
    logger.info(f"Login exitoso: {email} (rol: {role})")

    return {
        "token": session_token,
        "email": email,
        "name": data.get("name"),
        "picture": data.get("picture"),
        "role": role,
    }


# ─────────────────────────────────────────────
# MERCADO PAGO — COMPRA DE ACCESO ADMIN (endpoints)
# ─────────────────────────────────────────────
class PaymentConfirm(BaseModel):
    payment_id: str


@app.get("/api/billing/status")
async def billing_status(user: dict = Depends(require_auth)):
    """Indica si el upgrade a admin está disponible para este usuario y su precio.
    El frontend lo usa para decidir si muestra el botón de compra."""
    email = (user.get("sub") or "").lower()
    role = user.get("role", "viewer")
    return {
        "enabled": MP_ENABLED,
        "price": ADMIN_PRICE,
        "currency": MP_CURRENCY,
        "role": role,
        "eligible": MP_ENABLED and can_buy_admin(email, role),
    }


@app.post("/api/billing/create-preference")
async def create_preference(user: dict = Depends(require_auth)):
    """Crea una preferencia de Checkout Pro para comprar el acceso admin.
    Devuelve el init_point (URL del checkout) al que redirige el frontend."""
    if not MP_ENABLED:
        raise HTTPException(503, "Pasarela de pago no configurada.")
    email = (user.get("sub") or "").lower()
    role = user.get("role", "viewer")
    if role == "admin":
        raise HTTPException(409, "Ya tienes acceso de administrador.")
    if not can_buy_admin(email, role):
        raise HTTPException(403, "Solo cuentas @pucv.cl pueden adquirir el acceso de administrador.")

    preference = {
        "items": [{
            "id": "admin-access",
            "title": "SpotCheck · Acceso de administrador",
            "description": "Gestión de cámaras, vista en vivo, logs y gráfico histórico.",
            "quantity": 1,
            "currency_id": MP_CURRENCY,
            "unit_price": ADMIN_PRICE,
        }],
        "payer": {"email": email},
        "external_reference": email,
        "back_urls": {
            "success": f"{FRONTEND_BASE}/?billing=success",
            "failure": f"{FRONTEND_BASE}/?billing=failure",
            "pending": f"{FRONTEND_BASE}/?billing=pending",
        },
        "auto_return": "approved",
        "metadata": {"email": email, "purpose": "admin_access"},
    }
    if PUBLIC_BACKEND_URL:
        preference["notification_url"] = f"{PUBLIC_BACKEND_URL}/api/billing/webhook"

    try:
        res = _mp_request("POST", "/checkout/preferences", json=preference)
    except requests.RequestException as e:
        logger.error(f"[BILLING] Error creando preferencia MP: {e}")
        raise HTTPException(502, "No se pudo contactar a Mercado Pago.")

    if res.status_code not in (200, 201):
        logger.error(f"[BILLING] MP rechazó la preferencia: {res.status_code} {res.text}")
        raise HTTPException(502, "Mercado Pago rechazó la creación del pago.")

    data = res.json()
    logger.info(f"[BILLING] Preferencia creada para {email}: {data.get('id')}")
    return {"init_point": data.get("init_point"), "preference_id": data.get("id")}


def _fetch_payment(payment_id: str) -> dict | None:
    """Consulta un pago en Mercado Pago. Devuelve el dict del pago o None."""
    try:
        res = _mp_request("GET", f"/v1/payments/{payment_id}")
    except requests.RequestException as e:
        logger.warning(f"[BILLING] No se pudo consultar el pago {payment_id}: {e}")
        return None
    if res.status_code != 200:
        logger.warning(f"[BILLING] MP devolvió {res.status_code} al consultar pago {payment_id}")
        return None
    try:
        return res.json()
    except ValueError:
        return None


@app.post("/api/billing/confirm")
async def confirm_payment(payload: PaymentConfirm, user: dict = Depends(require_auth)):
    """Verifica un pago tras el redirect de Checkout Pro. Si está aprobado y
    pertenece a este usuario, sube su rol a admin y emite un JWT nuevo."""
    if not MP_ENABLED:
        raise HTTPException(503, "Pasarela de pago no configurada.")
    email = (user.get("sub") or "").lower()

    payment = _fetch_payment(payload.payment_id)
    if not payment:
        raise HTTPException(404, "Pago no encontrado.")

    ref = (payment.get("external_reference") or "").lower()
    if ref != email:
        raise HTTPException(403, "El pago no corresponde a tu cuenta.")

    if payment.get("status") != "approved":
        return {"status": payment.get("status"), "granted": False}

    granted = grant_admin(
        email,
        payment_id=payment.get("id"),
        amount=payment.get("transaction_amount"),
    )
    if not granted:
        raise HTTPException(500, "No se pudo activar el acceso de administrador.")

    token = create_session_token(
        email=email, name=user.get("name"), picture=user.get("picture"), role="admin",
    )
    return {"status": "approved", "granted": True, "token": token, "role": "admin"}


@app.post("/api/billing/webhook")
async def billing_webhook(request: Request):
    """Notificación de Mercado Pago (fuente autoritativa, por si el usuario cierra
    el navegador antes del redirect). Verifica la firma, consulta el pago y, si
    está aprobado, otorga el acceso admin. Responde 200 salvo firma inválida."""
    params = dict(request.query_params)
    topic = params.get("type") or params.get("topic")
    data_id = params.get("data.id") or params.get("id")
    if not data_id:
        try:
            body = await request.json()
            topic = topic or body.get("type")
            data_id = (body.get("data") or {}).get("id") or body.get("id")
        except Exception:
            pass

    if topic and topic != "payment":
        return {"ok": True, "ignored": topic}
    if not data_id:
        return {"ok": True}

    if not verify_webhook_signature(request, str(data_id)):
        logger.warning(f"[BILLING] Webhook con firma inválida (pago {data_id}) — ignorado")
        raise HTTPException(401, "Firma inválida")

    payment = _fetch_payment(str(data_id))
    if not payment:
        return {"ok": True}

    if payment.get("status") == "approved":
        email = (payment.get("external_reference") or "").lower()
        if email.endswith(BILLING_DOMAIN):
            grant_admin(email, payment_id=payment.get("id"),
                        amount=payment.get("transaction_amount"))
        else:
            logger.warning(f"[BILLING] Pago aprobado con email no elegible: {email}")
    return {"ok": True}


@app.get("/api/counter/{cam_id}")
async def counter(cam_id: str, _user: dict = Depends(require_auth)):
    if cam_id not in CAMERAS:
        raise HTTPException(404, "Camara no encontrada")
    w = CAMERAS[cam_id]
    return {"id": w.id, "name": w.name, "count": w.count,
            "online": w.online, "device": DEVICE}


@app.get("/api/logs")
async def get_logs(_admin: dict = Depends(require_admin)):
    """Últimas entradas del log (solo admin). Más reciente primero."""
    return list(reversed(LOG_BUFFER))


@app.get("/health")
async def health():
    # Health es público — solo retorna estado general sin datos sensibles
    return {"status": "online", "cameras": len(CAMERAS),
            "cameras_source": CAMERAS_SOURCE,
            "supabase": SUPABASE_ENABLED}
