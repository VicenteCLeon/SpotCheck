import { useEffect, useState, useCallback, useRef } from "react";
import type { Faculty, DayPoint, ActivityEntry } from "./types";
import { statusOf, fmt, clockNow } from "./data";
import {
  fetchCameras,
  fetchLogs,
  streamUrl,
  fetchHourlyOccupancy,
  UnauthorizedError,
  isTokenExpired,
  parseSessionPayload,
} from "./api";
import type { CameraDTO, LogEntry } from "./api";
import TopBar from "./components/TopBar";
import KpiCard from "./components/KpiCard";
import FacultyCard from "./components/FacultyCard";
import DayChart from "./components/DayChart";
import ActivityLog from "./components/ActivityLog";
import Login from "./components/Login";
import AdminPanel from "./components/AdminPanel";
import LegalNotice, { RETENTION_MONTHS } from "./components/LegalNotice";
import CampusMap from "./components/CampusMap";
import LogViewer from "./components/LogViewer";

const WARN_T = 60;
const DANGER_T = 85;
const SEMAFORO_STYLE = "tower" as const;
const SHOW_SPARK = true;
const POLL_MS = 2000;
const HISTORY_MS = 60000;
const AUTH_STORAGE_KEY = "monitor-aforo-token";
const SPARK_MAX_POINTS = 24; // ~48 segundos de historial real

// ── Helpers de sesión ──────────────────────────────────────────────────────────
function readStoredToken(): string | null {
  const token = localStorage.getItem(AUTH_STORAGE_KEY);
  if (!token) return null;
  if (isTokenExpired(token)) {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    return null;
  }
  return token;
}

export default function App() {
  const [now, setNow] = useState(new Date());
  const [faculties, setFaculties] = useState<Faculty[]>([]);
  const [dayCurve, setDayCurve] = useState<DayPoint[]>([]);
  const [connError, setConnError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<"admin" | "viewer">("viewer");
  const [adminOpen, setAdminOpen] = useState(false);
  const [legalOpen, setLegalOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(true);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [totalSpark, setTotalSpark] = useState<number[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logsOpen, setLogsOpen] = useState(false);

  // Historial real de conteos por cámara (no dispara re-renders)
  const historyRef = useRef<Map<string, number[]>>(new Map());
  // Capacidad total actualizada en cada poll (para el gráfico histórico)
  const totalCapRef = useRef<number>(0);

  // Suscripciones de notificaciones por cámara (P10)
  const [subscriptions, setSubscriptions] = useState<Set<string>>(() => {
    try {
      const s = localStorage.getItem("monitor-aforo-notifs");
      return s ? new Set(JSON.parse(s)) : new Set<string>();
    } catch { return new Set<string>(); }
  });
  const subscriptionsRef = useRef<Set<string>>(subscriptions);
  useEffect(() => { subscriptionsRef.current = subscriptions; }, [subscriptions]);
  const pendingNotifRef = useRef<string[]>([]);

  // ── Restaurar sesión desde localStorage ────────────────────────────────────
  useEffect(() => {
    const token = readStoredToken();
    if (token) {
      setSessionToken(token);
      const payload = parseSessionPayload(token);
      setUserRole(payload?.role === "admin" ? "admin" : "viewer");
    } else {
      setLoading(false);
    }
  }, []);

  // ── Logout ─────────────────────────────────────────────────────────────────
  const handleLogout = useCallback((reason?: string) => {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    setSessionToken(null);
    setUserRole("viewer");
    setAdminOpen(false);
    setFaculties([]);
    setDayCurve([]);
    setActivity([]);
    setTotalSpark([]);
    historyRef.current.clear();
    totalCapRef.current = 0;
    setLoading(true);
    if (reason) setConnError(reason);
    else setConnError(null);
  }, []);

  // ── Notificaciones de browser por cámara (P10) ────────────────────────────
  const toggleSubscription = useCallback(async (camId: string) => {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      await Notification.requestPermission();
    }
    setSubscriptions((prev) => {
      const next = new Set(prev);
      if (next.has(camId)) next.delete(camId);
      else next.add(camId);
      localStorage.setItem("monitor-aforo-notifs", JSON.stringify([...next]));
      return next;
    });
  }, []);

  // ── Reloj ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // ── Expiración de sesión ───────────────────────────────────────────────────
  useEffect(() => {
    if (!sessionToken) return;
    const id = setInterval(() => {
      if (isTokenExpired(sessionToken)) {
        handleLogout("Tu sesión expiró. Vuelve a iniciar sesión.");
      }
    }, 60_000);
    return () => clearInterval(id);
  }, [sessionToken, handleLogout]);

  // ── Polling de cámaras ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!sessionToken) return;
    let cancelled = false;

    async function poll() {
      try {
        const cams: CameraDTO[] = await fetchCameras(sessionToken!);
        if (cancelled) return;

        let nextEvents: ActivityEntry[] = [];

        setFaculties((prev) => {
          const prevMap = new Map(prev.map((f) => [f.id, f]));

          const next = cams.map((c) => {
            const prevCount = prevMap.get(c.id)?.occ ?? c.count;

            // Acumular historial real para el sparkline
            const prevHist = historyRef.current.get(c.id) ?? [];
            const newHist = [...prevHist, c.count].slice(-SPARK_MAX_POINTS);
            historyRef.current.set(c.id, newHist);

            return {
              id: c.id,
              name: c.name,
              cap: c.capacity,
              occ: c.count,
              building: c.building || "Sin ubicación",
              cams: 1,
              fps: 30,
              delta: c.count - prevCount,
              lastUpd: 0,
              online: c.online,
              streamUrl: streamUrl(c.id, sessionToken!),
              spark: newHist,
            };
          });

          // Actualizar capacidad total para el gráfico histórico
          totalCapRef.current = next.reduce((s, f) => s + f.cap, 0);

          const timeLabel = clockNow(new Date());
          const events: ActivityEntry[] = [];

          for (const f of next) {
            const prevF = prevMap.get(f.id);
            if (!prevF) continue;

            if (prevF.online !== false && f.online === false) {
              events.push({
                t: timeLabel,
                kind: "danger",
                text: <span><b>{f.name}</b> cámara offline</span>,
              });
            } else if (prevF.online === false && f.online !== false) {
              events.push({
                t: timeLabel,
                kind: "ok",
                text: <span><b>{f.name}</b> cámara en línea</span>,
              });
            }

            if (f.cap > 0) {
              const prevPct = (prevF.occ / f.cap) * 100;
              const nextPct = (f.occ / f.cap) * 100;
              const prevStatus = statusOf(prevPct, WARN_T, DANGER_T);
              const nextStatus = statusOf(nextPct, WARN_T, DANGER_T);

              if (prevStatus !== nextStatus) {
                if (nextStatus === "danger") {
                  events.push({
                    t: timeLabel,
                    kind: "danger",
                    text: <span><b>{f.name}</b> superó {DANGER_T}% de aforo</span>,
                  });
                } else if (nextStatus === "warn") {
                  events.push({
                    t: timeLabel,
                    kind: "warn",
                    text: <span><b>{f.name}</b> entró en zona ámbar</span>,
                  });
                } else {
                  events.push({
                    t: timeLabel,
                    kind: "ok",
                    text: <span><b>{f.name}</b> volvió a nivel normal</span>,
                  });
                  if (subscriptionsRef.current.has(f.id)) {
                    pendingNotifRef.current.push(f.name);
                  }
                }
              }
            }
          }

          nextEvents = events;
          return next;
        });

        // Historial del aforo total para el KPI sparkline
        const newTotal = cams.reduce((s, c) => s + c.count, 0);
        setTotalSpark((prev) => [...prev, newTotal].slice(-SPARK_MAX_POINTS));

        if (nextEvents.length > 0) {
          setActivity((prev) => [...nextEvents, ...prev].slice(0, 8));
        }

        if (pendingNotifRef.current.length > 0 && typeof Notification !== "undefined" && Notification.permission === "granted") {
          for (const name of pendingNotifRef.current) {
            new Notification(`${name} disponible`, {
              body: "El espacio volvió a un nivel de ocupación normal.",
            });
          }
          pendingNotifRef.current = [];
        }

        setConnError(null);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof UnauthorizedError) {
          handleLogout("Sesión inválida. Vuelve a iniciar sesión.");
          return;
        }
        setConnError("Sin conexión con el backend (puerto 8000)");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [sessionToken, handleLogout]);

  // ── Logs del sistema (solo admin, P15) ────────────────────────────────────
  useEffect(() => {
    if (!sessionToken || userRole !== "admin") return;
    let cancelled = false;

    async function loadLogs() {
      try {
        const data = await fetchLogs(sessionToken!);
        if (!cancelled) setLogs(data);
      } catch { /* silently ignore */ }
    }

    loadLogs();
    const id = setInterval(loadLogs, 10_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [sessionToken, userRole]);

  // ── Histórico desde Supabase ───────────────────────────────────────────────
  useEffect(() => {
    if (!sessionToken) return;
    let cancelled = false;

    async function loadHistory() {
      try {
        const hourly = await fetchHourlyOccupancy();
        if (cancelled) return;
        const points: DayPoint[] = hourly.map((h) => {
          const people = Number(h.people) || 0;
          return {
            t: Number(h.bucket),
            people: Math.round(people),
            pct: totalCapRef.current > 0 ? people / totalCapRef.current : 0,
          };
        });
        setDayCurve(points);
      } catch {
        // si falla, el gráfico queda vacío — no es crítico
      }
    }

    loadHistory();
    const id = setInterval(loadHistory, HISTORY_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [sessionToken]);

  // ── Login ──────────────────────────────────────────────────────────────────
  if (!sessionToken) {
    return (
      <Login
        onSuccess={(token, _email) => {
          localStorage.setItem(AUTH_STORAGE_KEY, token);
          setSessionToken(token);
          const payload = parseSessionPayload(token);
          setUserRole(payload?.role === "admin" ? "admin" : "viewer");
          setConnError(null);
          setLoading(true);
        }}
      />
    );
  }

  // ── Dashboard ──────────────────────────────────────────────────────────────
  const totalOcc = faculties.reduce((s, f) => s + f.occ, 0);
  const totalCap = faculties.reduce((s, f) => s + f.cap, 0);
  const overallPct = totalCap > 0 ? Math.round((totalOcc / totalCap) * 100) : 0;
  const alerts = faculties.filter((f) => f.cap > 0 && (f.occ / f.cap) * 100 >= WARN_T).length;
  const criticals = faculties.filter((f) => f.cap > 0 && (f.occ / f.cap) * 100 >= DANGER_T).length;
  const onlineCount = faculties.filter((f) => f.online !== false).length;
  const overallStatus = statusOf(overallPct, WARN_T, DANGER_T);

  return (
    <div className="min-h-screen bg-bg">
      <div className="px-3 pt-3 pb-[88px] md:px-7 md:pt-5 md:pb-10 max-w-[1440px] mx-auto">

        <TopBar
          now={now}
          overallStatus={overallStatus}
          userRole={userRole}
          onManageCameras={() => setAdminOpen(true)}
          onLogout={() => handleLogout()}
        />

        {adminOpen && sessionToken && userRole === "admin" && (
          <AdminPanel
            token={sessionToken}
            onClose={() => setAdminOpen(false)}
            onSessionExpired={() => handleLogout("Sesión inválida. Vuelve a iniciar sesión.")}
          />
        )}

        {connError && (
          <div className="mt-3 px-3.5 py-2.5 rounded-[10px] border border-danger bg-danger-bg text-danger text-[12px] font-medium flex items-center gap-2">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            {connError} · reintentando…
          </div>
        )}

        {faculties.length > 0 && (
          <div className="mt-3">
            <CampusMap faculties={faculties} warnT={WARN_T} dangerT={DANGER_T} />
          </div>
        )}

        <div className="mt-3">
          <button
            type="button"
            onClick={() => setSummaryOpen((v) => !v)}
            aria-expanded={summaryOpen}
            className="w-full flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-[10px] border border-line bg-surface text-left transition-colors hover:border-line-strong"
          >
            <div className="flex items-center gap-2.5">
              <span className="text-[13px] md:text-[13.5px] font-semibold">Resumen general</span>
              <span className="text-[11px] text-ink-3 hidden sm:inline">
                {fmt(totalOcc)} / {fmt(totalCap)} · {overallPct}% ocupación
              </span>
            </div>
            <svg
              width="16" height="16" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              className={`text-ink-3 transition-transform duration-200 ${summaryOpen ? "rotate-180" : ""}`}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          {summaryOpen && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 mt-2.5">
              <KpiCard
                label="Aforo total" value={fmt(totalOcc)} unit={`/ ${fmt(totalCap)}`}
                delta={`${overallPct}%`}
                deltaKind={overallStatus === "danger" ? "up" : overallStatus === "warn" ? "flat" : "down"}
                foot="Personas detectadas ahora"
                spark={totalSpark.length >= 2 ? totalSpark : undefined}
              />
              <KpiCard
                label="Ocupación general" value={`${overallPct}`} unit="%"
                delta={overallStatus === "danger" ? "crítico" : overallStatus === "warn" ? "atención" : "normal"}
                deltaKind={overallStatus === "danger" ? "up" : overallStatus === "warn" ? "flat" : "down"}
                foot="Promedio del campus"
              />
              <KpiCard
                label="Cámaras en línea" value={onlineCount} unit={`/ ${faculties.length}`}
                delta={onlineCount === faculties.length && faculties.length > 0 ? "todas activas" : "revisar"}
                deltaKind={onlineCount === faculties.length ? "flat" : "up"}
                foot="Estado de conexión"
              />
              <KpiCard
                label="Cámaras en alerta" value={alerts} unit={`/ ${faculties.length}`}
                delta={`${criticals} críticas`} deltaKind={criticals > 0 ? "up" : "flat"}
                foot="Aforo ≥ umbral ámbar"
              />
            </div>
          )}
        </div>

        <div className="mx-1 mt-6 mb-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="m-0 text-[14px] md:text-[15px] font-semibold tracking-tight">Cámaras · en tiempo real</h2>
              <div className="text-ink-3 text-[11px] md:text-[12px] mt-0.5">refresco cada 2 s</div>
            </div>
            <div className="flex gap-3 text-[11px] text-ink-3 items-center">
              <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-[2px] bg-ok" /> Normal</span>
              <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-[2px] bg-warn" /> Atención</span>
              <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-[2px] bg-danger" /> Crítico</span>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="text-ink-3 text-[12px] py-10 text-center">Conectando con el backend…</div>
        ) : faculties.length === 0 ? (
          <div className="text-ink-3 text-[12px] py-10 text-center">No hay cámaras configuradas en el backend.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            {faculties.map((f) => (
              <FacultyCard
                key={f.id}
                f={f}
                warnT={WARN_T}
                dangerT={DANGER_T}
                semaforoStyle={SEMAFORO_STYLE}
                showSpark={SHOW_SPARK}
                subscribed={subscriptions.has(f.id)}
                onToggleNotify={() => toggleSubscription(f.id)}
              />
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-2.5 mt-2.5">
          <div className="bg-surface border border-line rounded-[14px] px-4 py-4">
            <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
              <div>
                <h3 className="m-0 text-[13px] md:text-[13.5px] font-semibold">Ocupación del campus · histórico</h3>
                <div className="text-ink-3 text-[11px] mt-0.5 hidden sm:block">Cada 10 min · últimas 6 h · datos en tiempo real</div>
              </div>
            </div>
            {dayCurve.length >= 2 ? (
              <DayChart data={dayCurve} warnT={WARN_T} dangerT={DANGER_T} />
            ) : (
              <div className="h-[200px] flex items-center justify-center text-center text-ink-3 text-[12px] px-4">
                Recopilando datos… el gráfico se dibuja cuando haya registros de al menos 2 horas distintas.
              </div>
            )}
          </div>

          <div className="bg-surface border border-line rounded-[14px] px-4 py-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="m-0 text-[13px] md:text-[13.5px] font-semibold">Actividad reciente</h3>
              <span className="text-ink-3 text-[11.5px]">Últimos eventos</span>
            </div>
            <ActivityLog entries={activity} />
          </div>
        </div>

        {userRole === "admin" && (
          <div className="mt-2.5 bg-surface border border-line rounded-[14px]">
            <button
              type="button"
              onClick={() => setLogsOpen((v) => !v)}
              className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left hover:bg-surface-2 rounded-[14px] transition-colors"
            >
              <span className="text-[13px] font-semibold">Logs del sistema</span>
              <div className="flex items-center gap-2 text-ink-3 text-[11px]">
                <span>{logs.length} entradas</span>
                <svg
                  width="14" height="14" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                  className={`transition-transform duration-200 ${logsOpen ? "rotate-180" : ""}`}
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </div>
            </button>
            {logsOpen && (
              <div className="px-4 pb-4 border-t border-line">
                <LogViewer entries={logs} />
              </div>
            )}
          </div>
        )}

        <footer className="mt-6 pt-4 border-t border-line text-[11px] text-ink-4 flex flex-wrap items-center justify-between gap-2">
          <span>
            Recinto con cámaras para medición de aforo · No se almacenan imágenes; solo conteos
            numéricos (retención {RETENTION_MONTHS} meses).
          </span>
          <button
            type="button"
            onClick={() => setLegalOpen(true)}
            className="underline hover:text-ink-2"
          >
            Aviso de videovigilancia
          </button>
        </footer>
      </div>

      {legalOpen && <LegalNotice onClose={() => setLegalOpen(false)} />}
    </div>
  );
}
