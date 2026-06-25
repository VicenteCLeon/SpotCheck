import { useEffect, useState } from "react";
import { exportOccupancy, UnauthorizedError } from "../api";
import type { ExportFormat, ExportGranularity } from "../api";

interface Zone {
  id: string;
  name: string;
}

interface ExportModalProps {
  token: string;
  zones: Zone[];
  onClose: () => void;
  onSessionExpired: () => void;
}

/** Fecha local en formato YYYY-MM-DD (sin desfase por UTC de toISOString). */
function fmtLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function ExportModal({ token, zones, onClose, onSessionExpired }: ExportModalProps) {
  const today = new Date();
  const weekAgo = new Date();
  weekAgo.setDate(today.getDate() - 6);

  const [from, setFrom] = useState(fmtLocalDate(weekAgo));
  const [to, setTo] = useState(fmtLocalDate(today));
  const [granularity, setGranularity] = useState<ExportGranularity>("hour");
  const [format, setFormat] = useState<ExportFormat>("csv");
  const [zone, setZone] = useState(""); // "" = todas
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cerrar con tecla Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const rangeInvalid = from > to;

  async function handleDownload() {
    if (rangeInvalid) {
      setError("La fecha inicial no puede ser posterior a la final.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const blob = await exportOccupancy(token, {
        from,
        to,
        granularity,
        format,
        cameraId: zone || undefined,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const zonePart = zone ? `_${zone}` : "";
      a.download = `spotcheck_ocupacion_${granularity}${zonePart}_${from}_${to}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      if (err instanceof UnauthorizedError) return onSessionExpired();
      setError(err instanceof Error ? err.message : "No se pudo exportar.");
    } finally {
      setBusy(false);
    }
  }

  const field = "w-full px-2.5 py-1.5 rounded-lg border border-line bg-surface-2 text-ink text-[13px] focus:outline-none focus:border-line-strong";
  const label = "block text-[11px] text-ink-3 uppercase tracking-wide mb-1";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 backdrop-blur-sm px-3 py-6 overflow-y-auto">
      <div className="w-full max-w-[560px] rounded-[16px] border border-line bg-surface shadow-[0_20px_80px_rgba(20,20,20,0.25)]">
        {/* Cabecera */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-line">
          <div>
            <h2 className="m-0 text-[15px] font-semibold">Exportar datos de ocupación</h2>
            <p className="m-0 text-[11.5px] text-ink-3 mt-0.5">Histórico por horario y zona para análisis (CSV o Excel)</p>
          </div>
          <button
            type="button" onClick={onClose} aria-label="Cerrar"
            className="w-8 h-8 rounded-lg border border-line bg-surface flex items-center justify-center text-ink-2 hover:border-line-strong hover:text-ink"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Rango de fechas */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Desde</label>
              <input type="date" className={field} value={from} max={to}
                onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div>
              <label className={label}>Hasta</label>
              <input type="date" className={field} value={to} min={from} max={fmtLocalDate(today)}
                onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>

          {/* Granularidad */}
          <div>
            <label className={label}>Granularidad</label>
            <div className="grid grid-cols-3 gap-2">
              {([
                { v: "hour", t: "Por hora" },
                { v: "day", t: "Por día" },
                { v: "raw", t: "Detallado" },
              ] as { v: ExportGranularity; t: string }[]).map((opt) => (
                <button
                  key={opt.v} type="button" onClick={() => setGranularity(opt.v)}
                  className={`px-2.5 py-1.5 rounded-lg border text-[12.5px] transition-colors ${
                    granularity === opt.v
                      ? "border-line-strong bg-surface-2 text-ink font-medium"
                      : "border-line text-ink-2 hover:border-line-strong"
                  }`}
                >
                  {opt.t}
                </button>
              ))}
            </div>
            <p className="text-ink-4 text-[11px] mt-1.5">
              {granularity === "hour"
                ? "Promedio, máximo y mínimo de ocupación por cada hora y zona."
                : granularity === "day"
                ? "Resumen agregado por día y zona."
                : "Cada muestra registrada (una fila por lectura, ~cada 10 s)."}
            </p>
          </div>

          {/* Zona */}
          <div>
            <label className={label}>Zona</label>
            <select className={field} value={zone} onChange={(e) => setZone(e.target.value)}>
              <option value="">Todas las zonas</option>
              {zones.map((z) => (
                <option key={z.id} value={z.id}>{z.name}</option>
              ))}
            </select>
          </div>

          {/* Formato */}
          <div>
            <label className={label}>Formato</label>
            <div className="grid grid-cols-2 gap-2">
              {([
                { v: "csv", t: "CSV" },
                { v: "xlsx", t: "Excel (.xlsx)" },
              ] as { v: ExportFormat; t: string }[]).map((opt) => (
                <button
                  key={opt.v} type="button" onClick={() => setFormat(opt.v)}
                  className={`px-2.5 py-1.5 rounded-lg border text-[12.5px] transition-colors ${
                    format === opt.v
                      ? "border-line-strong bg-surface-2 text-ink font-medium"
                      : "border-line text-ink-2 hover:border-line-strong"
                  }`}
                >
                  {opt.t}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div className="px-3 py-2 rounded-lg border border-danger bg-danger-bg text-danger text-[12px]">{error}</div>
          )}

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button" onClick={handleDownload} disabled={busy || rangeInvalid}
              className="px-3.5 py-1.5 rounded-lg bg-ink text-surface text-[12.5px] font-medium hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-2"
            >
              {busy ? (
                "Generando…"
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  Descargar
                </>
              )}
            </button>
            <button
              type="button" onClick={onClose}
              className="px-3.5 py-1.5 rounded-lg border border-line text-ink-2 text-[12.5px] hover:border-line-strong hover:text-ink"
            >
              Cerrar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
