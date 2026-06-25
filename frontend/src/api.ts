// ── Conexión con el backend FastAPI ───────────────────────────────────────────
export const API_BASE = (import.meta.env.VITE_API_BASE as string) || "http://localhost:8000";

// ── Supabase (anon key — pública por diseño) ──────────────────────────────────
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

// ── Tipos ─────────────────────────────────────────────────────────────────────
export interface CameraDTO {
    id: string;
    name: string;
    building: string;
    count: number;
    capacity: number;
    status: "ok" | "warn" | "danger";
    online: boolean;
    error: string | null;
}

export interface HourPoint {
    bucket: number;
    people: number;
}

// Fila de configuración de cámara (vista de administración)
export interface CameraConfigRow {
    id: string;
    name: string;
    source: string;
    capacity: number;
    building: string;
    enabled: boolean;
    sort_order: number;
    online: boolean;
}

export interface CameraConfigResponse {
    source: string;       // "supabase" | "fallback"
    supabase: boolean;
    cameras: CameraConfigRow[];
}

// Campos editables al crear/actualizar una cámara
export interface CameraInput {
    id: string;
    name: string;
    source: string;
    capacity: number;
    building: string;
    enabled: boolean;
    sort_order: number;
}

export interface GoogleAuthResult {
    token: string;   // JWT de sesión firmado por el backend
    email: string;
    name?: string;
    picture?: string;
    role: string;    // "admin" | "viewer"
}

export interface SessionPayload {
    sub: string;
    name?: string;
    picture?: string;
    role: string;
    exp: number;
}

// ── Error especial para respuestas 401 ────────────────────────────────────────
export class UnauthorizedError extends Error {
    constructor() {
        super("UNAUTHORIZED");
        this.name = "UnauthorizedError";
    }
}

// ── Helper: fetch autenticado con JWT ─────────────────────────────────────────
async function authFetch(url: string, token: string, options: RequestInit = {}): Promise<Response> {
    const res = await fetch(url, {
        ...options,
        headers: {
            ...(options.headers ?? {}),
            Authorization: `Bearer ${token}`,
            "ngrok-skip-browser-warning": "true",
        },
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
}

// ── Endpoints del backend ─────────────────────────────────────────────────────
export async function fetchCameras(token: string): Promise<CameraDTO[]> {
    const res = await authFetch(`${API_BASE}/api/cameras`, token);
    return res.json();
}

/**
 * URL del stream MJPEG con el JWT en query param.
 * (Los elementos <img src> no admiten headers personalizados.)
 */
export function streamUrl(camId: string, token: string): string {
    return `${API_BASE}/video_feed/${camId}?token=${encodeURIComponent(token)}`;
}

// ── Gestión de cámaras (solo admins) ──────────────────────────────────────────
/** Lanza un Error con el mensaje `detail` del backend si la respuesta no es OK. */
async function mutate(url: string, token: string, method: string, body?: unknown): Promise<unknown> {
    const res = await fetch(url, {
        method,
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "ngrok-skip-browser-warning": "true",
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
            const data = await res.json();
            if (data?.detail) detail = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail);
        } catch { /* sin cuerpo JSON */ }
        throw new Error(detail);
    }
    return res.status === 204 ? null : res.json();
}

export async function fetchCamerasConfig(token: string): Promise<CameraConfigResponse> {
    const res = await authFetch(`${API_BASE}/api/cameras/config`, token);
    return res.json();
}

export async function createCamera(token: string, cam: CameraInput): Promise<void> {
    await mutate(`${API_BASE}/api/cameras`, token, "POST", cam);
}

export async function updateCamera(token: string, id: string, fields: Partial<CameraInput>): Promise<void> {
    await mutate(`${API_BASE}/api/cameras/${encodeURIComponent(id)}`, token, "PATCH", fields);
}

export async function deleteCamera(token: string, id: string): Promise<void> {
    await mutate(`${API_BASE}/api/cameras/${encodeURIComponent(id)}`, token, "DELETE");
}

// ── Exportación de ocupación (solo admin) ─────────────────────────────────────
export type ExportGranularity = "hour" | "day" | "raw";
export type ExportFormat = "csv" | "xlsx";

export interface ExportParams {
    from?: string;        // YYYY-MM-DD (local); vacío = últimos 7 días
    to?: string;          // YYYY-MM-DD (local)
    granularity: ExportGranularity;
    format: ExportFormat;
    cameraId?: string;    // zona específica; vacío = todas
}

/** Descarga el histórico de ocupación por horario y zona como Blob (CSV o XLSX). */
export async function exportOccupancy(token: string, p: ExportParams): Promise<Blob> {
    const qs = new URLSearchParams();
    if (p.from) qs.set("from", p.from);
    if (p.to) qs.set("to", p.to);
    qs.set("granularity", p.granularity);
    qs.set("format", p.format);
    if (p.cameraId) qs.set("camera_id", p.cameraId);

    const res = await fetch(`${API_BASE}/api/export/occupancy?${qs.toString()}`, {
        headers: {
            Authorization: `Bearer ${token}`,
            "ngrok-skip-browser-warning": "true",
        },
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
            const data = await res.json();
            if (data?.detail) detail = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail);
        } catch { /* sin cuerpo JSON */ }
        throw new Error(detail);
    }
    return res.blob();
}

// ── Supabase: histórico de ocupación (usa anon key directamente) ───────────────
export async function fetchHourlyOccupancy(): Promise<HourPoint[]> {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/recent_occupancy`, {
        method: "POST",
        headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
            "Content-Type": "application/json",
        },
        body: "{}",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

// ── Auth: verificar token Google y obtener JWT de sesión ──────────────────────
export async function verifyGoogleToken(idToken: string): Promise<GoogleAuthResult> {
    const res = await fetch(`${API_BASE}/api/auth/google`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "ngrok-skip-browser-warning": "true",
        },
        body: JSON.stringify({ id_token: idToken }),
    });
    if (res.status === 403) throw new Error("DOMAIN_NOT_ALLOWED");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

// ── Pasarela de pago (Mercado Pago) — compra de acceso admin ──────────────────
export interface BillingStatus {
    enabled: boolean;       // pasarela configurada en el backend
    price: number;          // precio del acceso admin
    currency: string;       // p. ej. "CLP"
    role: string;           // rol actual del usuario
    eligible: boolean;      // true si puede comprar (viewer @pucv.cl)
}

export interface ConfirmResult {
    status: string;         // estado del pago en Mercado Pago
    granted: boolean;       // true si el rol se subió a admin
    token?: string;         // nuevo JWT con rol admin (si granted)
    role?: string;
}

/** Estado de la pasarela y elegibilidad del usuario actual. */
export async function fetchBillingStatus(token: string): Promise<BillingStatus> {
    const res = await authFetch(`${API_BASE}/api/billing/status`, token);
    return res.json();
}

/** Crea la preferencia de Checkout Pro y devuelve la URL del checkout. */
export async function createBillingPreference(token: string): Promise<string> {
    const data = (await mutate(`${API_BASE}/api/billing/create-preference`, token, "POST")) as {
        init_point?: string;
    };
    if (!data?.init_point) throw new Error("Mercado Pago no devolvió una URL de pago.");
    return data.init_point;
}

/** Verifica un pago tras el redirect y, si está aprobado, devuelve el JWT admin. */
export async function confirmBillingPayment(token: string, paymentId: string): Promise<ConfirmResult> {
    return (await mutate(`${API_BASE}/api/billing/confirm`, token, "POST", {
        payment_id: paymentId,
    })) as ConfirmResult;
}

// ── Utilidades JWT (decodificación sin verificar firma — solo lectura de claims) ─
export function parseSessionPayload(token: string): SessionPayload | null {
    try {
        const payload = JSON.parse(atob(token.split(".")[1]));
        return {
            sub: payload.sub ?? "",
            name: payload.name,
            picture: payload.picture,
            role: payload.role ?? "viewer",
            exp: typeof payload.exp === "number" ? payload.exp : 0,
        };
    } catch {
        return null;
    }
}

// ── Logs del sistema (solo admin) ─────────────────────────────────────────────
export interface LogEntry {
    ts: string;
    level: "INFO" | "WARNING" | "ERROR";
    msg: string;
}

export async function fetchLogs(token: string): Promise<LogEntry[]> {
    const res = await authFetch(`${API_BASE}/api/logs`, token);
    return res.json();
}

export function isTokenExpired(token: string): boolean {
    const payload = parseSessionPayload(token);
    if (!payload || payload.exp === 0) return true;
    return Date.now() >= payload.exp * 1000;
}
