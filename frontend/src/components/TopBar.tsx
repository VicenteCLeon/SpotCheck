import { clockNow, dateLabel } from "../data";
import type { Status } from "../types";

interface TopBarProps {
  now: Date;
  overallStatus: Status;
  userRole?: "admin" | "viewer";
  onManageCameras?: () => void;
  onLogout: () => void;
}

export default function TopBar({ now, overallStatus, userRole, onManageCameras, onLogout }: TopBarProps) {
  const liveColor =
    overallStatus === "danger" ? "var(--color-danger)" : overallStatus === "warn" ? "var(--color-warn)" : "var(--color-ok)";

  return (
    <div className="flex items-center justify-between bg-surface border border-line rounded-xl px-3 py-2 md:px-4 md:py-2.5">
      <div className="flex items-center gap-2.5">
        <div className="w-7 h-7 rounded-[7px] bg-ink relative flex items-center justify-center shrink-0">
          <span
            aria-hidden
            className="w-2.5 h-2.5 rounded-full"
            style={{ background: "var(--color-ok)", boxShadow: "0 0 0 3px rgba(255,255,255,.15) inset" }}
          />
        </div>
        <div>
          <div className="font-semibold text-[15px] tracking-tight">SpotCheck</div>
          <div className="hidden sm:block text-ink-3 text-[11px] md:text-[12px]">Monitor de aforo · Campus universitario</div>
        </div>
        <div className="hidden md:block w-px h-[18px] bg-line-strong mx-1" />
        <div className="hidden md:block text-ink-3 text-[12px] capitalize">{dateLabel(now)}</div>
      </div>

      <div className="flex items-center gap-2 md:gap-[18px] text-[12px] text-ink-3">
        {userRole === "admin" && (
          <>
            <span className="inline-flex items-center gap-1 px-2 py-[3px] rounded-full bg-ink text-surface text-[10px] font-semibold tracking-widest uppercase select-none">
              Admin
            </span>
            <button
              type="button"
              aria-label="Gestionar camaras"
              title="Gestionar cámaras"
              onClick={onManageCameras}
              className="inline-flex w-[30px] h-[30px] rounded-lg border border-line bg-surface items-center justify-center text-ink-2 transition-colors hover:border-line-strong hover:text-ink active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/40"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
              </svg>
            </button>
          </>
        )}
        <span className="inline-flex items-center gap-2 px-2 md:px-2.5 py-[5px] border border-line rounded-full bg-surface-2 text-ink-2 text-[11px] md:text-[11.5px] tracking-wide">
          <span className="w-[7px] h-[7px] rounded-full sc-pulse" style={{ background: liveColor }} />
          EN VIVO
        </span>
        <span className="font-mono text-ink text-[12px] md:text-[13px]">{clockNow(now)}</span>
        <span className="hidden md:inline text-ink-4">·</span>
        <span className="hidden md:inline">
          Latencia <b className="font-mono text-ink-2">1.2s</b>
        </span>
        <button
          type="button"
          aria-label="Cerrar sesion"
          onClick={onLogout}
          className="inline-flex w-[30px] h-[30px] rounded-lg border border-line bg-surface items-center justify-center text-ink-2 transition-colors hover:border-line-strong hover:text-ink active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/40"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M16 17l5-5-5-5" />
            <path d="M21 12H9" />
            <path d="M13 5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2" />
          </svg>
        </button>
      </div>
    </div>
  );
}
