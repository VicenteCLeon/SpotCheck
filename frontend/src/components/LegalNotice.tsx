import { useEffect } from "react";

/** Período de retención de los conteos. Debe coincidir con supabase/retention.sql. */
export const RETENTION_MONTHS = 12;

interface LegalNoticeProps {
  onClose: () => void;
}

/**
 * Aviso de videovigilancia y privacidad (modal).
 * Punto clave: el sistema NO almacena imágenes ni grabaciones; el procesamiento
 * es en tiempo real y solo se persisten conteos numéricos agregados.
 */
export default function LegalNotice({ onClose }: LegalNoticeProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/40 backdrop-blur-sm px-3 py-6 overflow-y-auto">
      <div className="w-full max-w-[640px] rounded-[16px] border border-line bg-surface shadow-[0_20px_80px_rgba(20,20,20,0.25)]">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-line">
          <h2 className="m-0 text-[15px] font-semibold">Aviso de videovigilancia y privacidad</h2>
          <button
            type="button" onClick={onClose} aria-label="Cerrar"
            className="w-8 h-8 rounded-lg border border-line bg-surface flex items-center justify-center text-ink-2 hover:border-line-strong hover:text-ink"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="px-5 py-4 space-y-3.5 text-[12.5px] leading-relaxed text-ink-2">
          <p className="m-0">
            Las dependencias de la <b>Pontificia Universidad Católica de Valparaíso</b> están
            equipadas con cámaras cuya única finalidad es la <b>medición de aforo en tiempo real</b>,
            para resguardar la seguridad de las personas y cumplir con los límites de ocupación.
          </p>

          <div className="rounded-xl border border-ok/40 bg-ok-bg/60 px-3.5 py-3">
            <p className="m-0 font-semibold text-ok">No se almacenan imágenes ni grabaciones</p>
            <p className="m-0 mt-1 text-ink-2">
              El video se procesa en vivo para contar personas y se descarta de inmediato.
              El sistema <b>solo guarda conteos numéricos agregados</b> (cuántas personas hay en
              cada zona), que no permiten identificar a ninguna persona.
            </p>
          </div>

          <div>
            <h3 className="m-0 text-[12.5px] font-semibold text-ink">Datos tratados</h3>
            <p className="m-0 mt-1">
              Conteo de personas por cámara y marca temporal. No se recogen rostros, biometría,
              matrículas ni ningún dato personal identificable.
            </p>
          </div>

          <div>
            <h3 className="m-0 text-[12.5px] font-semibold text-ink">Conservación de los datos</h3>
            <p className="m-0 mt-1">
              Los conteos se conservan durante <b>{RETENTION_MONTHS} meses</b> con fines estadísticos
              y de gestión de aforo; transcurrido ese plazo se eliminan automáticamente.
            </p>
          </div>

          <div>
            <h3 className="m-0 text-[12.5px] font-semibold text-ink">Marco legal y derechos</h3>
            <p className="m-0 mt-1">
              El tratamiento se realiza conforme a la <b>Ley N° 19.628</b> sobre protección de la vida
              privada. Las personas pueden ejercer sus derechos de información dirigiéndose a la
              unidad responsable de la Universidad.
            </p>
          </div>

          <p className="m-0 text-[11px] text-ink-4 pt-1">
            Responsable del tratamiento: Pontificia Universidad Católica de Valparaíso ·
            Sistema SpotCheck — Monitor de Aforo.
          </p>
        </div>

        <div className="px-5 py-3 border-t border-line flex justify-end">
          <button
            type="button" onClick={onClose}
            className="px-3.5 py-1.5 rounded-lg bg-ink text-surface text-[12.5px] font-medium hover:opacity-90"
          >
            Entendido
          </button>
        </div>
      </div>
    </div>
  );
}
