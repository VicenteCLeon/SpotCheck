import { useCallback, useEffect, useRef, useState } from "react";
import { fetchCamerasConfig, streamUrl, UnauthorizedError } from "../api";
import type { CameraConfigRow } from "../api";
import MjpegStream from "./MjpegStream";

interface LivePreviewProps {
  token: string;
  onClose: () => void;
  onSessionExpired: () => void;
}

export default function LivePreview({ token, onClose, onSessionExpired }: LivePreviewProps) {
  const [rows, setRows] = useState<CameraConfigRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  // Sufijo de cache-busting por cámara: al cambiarlo se fuerza la reconexión del <img>.
  const [nonce, setNonce] = useState<Record<string, number>>({});

  const onSessionExpiredRef = useRef(onSessionExpired);
  useEffect(() => { onSessionExpiredRef.current = onSessionExpired; });

  const refresh = useCallback(async () => {
    setLoading(true);
    setListError(null);
    try {
      const data = await fetchCamerasConfig(token);
      setRows(data.cameras);
    } catch (err) {
      if (err instanceof UnauthorizedError) return onSessionExpiredRef.current();
      setListError("No se pudo cargar la lista de cámaras.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { refresh(); }, [refresh]);

  // Cerrar con tecla Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const reloadCam = (id: string) =>
    setNonce((n) => ({ ...n, [id]: (n[id] ?? 0) + 1 }));

  const active = rows.filter((r) => r.enabled);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 backdrop-blur-sm px-3 py-6 overflow-y-auto">
      <div className="w-full max-w-[1100px] rounded-[16px] border border-line bg-surface shadow-[0_20px_80px_rgba(20,20,20,0.25)]">
        {/* Cabecera */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-line">
          <div>
            <h2 className="m-0 text-[15px] font-semibold">Cámaras en vivo</h2>
            <p className="m-0 text-[11.5px] text-ink-3 mt-0.5">
              Visualización en tiempo real de las fuentes de video con detección de personas
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button" onClick={refresh} title="Actualizar lista"
              className="h-8 px-2.5 rounded-lg border border-line bg-surface flex items-center gap-1.5 text-ink-2 text-[12px] hover:border-line-strong hover:text-ink"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" />
              </svg>
              Recargar
            </button>
            <button
              type="button" onClick={onClose} aria-label="Cerrar"
              className="w-8 h-8 rounded-lg border border-line bg-surface flex items-center justify-center text-ink-2 hover:border-line-strong hover:text-ink"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        <div className="px-5 py-4">
          {listError && (
            <div className="px-3 py-2 mb-3 rounded-lg border border-danger bg-danger-bg text-danger text-[12px]">{listError}</div>
          )}

          {loading ? (
            <div className="text-ink-3 text-[12px] py-10 text-center">Cargando cámaras…</div>
          ) : active.length === 0 ? (
            <div className="text-ink-3 text-[12px] py-10 text-center">No hay cámaras activas para mostrar.</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
              {active.map((r) => (
                <div key={r.id} className="rounded-xl border border-line overflow-hidden bg-surface-2">
                  <div className="relative aspect-video bg-black">
                    <MjpegStream
                      key={`${r.id}-${nonce[r.id] ?? 0}`}
                      src={`${streamUrl(r.id, token)}&_=${nonce[r.id] ?? 0}`}
                      alt={`Stream de ${r.name}`}
                      onRetry={() => reloadCam(r.id)}
                    />
                  </div>
                  <div className="flex items-center justify-between px-3 py-2">
                    <div className="min-w-0">
                      <div className="font-medium text-ink text-[12.5px] truncate">{r.name}</div>
                      <div className="text-ink-4 text-[11px] font-mono truncate">
                        {r.id} · fuente {r.source}
                      </div>
                    </div>
                    {r.online ? (
                      <span className="inline-flex items-center gap-1.5 text-ok text-[11px] shrink-0"><span className="w-1.5 h-1.5 rounded-full bg-ok" />en línea</span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-danger text-[11px] shrink-0"><span className="w-1.5 h-1.5 rounded-full bg-danger" />offline</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
