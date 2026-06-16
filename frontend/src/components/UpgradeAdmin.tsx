import { useState } from "react";
import { createBillingPreference } from "../api";

interface UpgradeAdminProps {
  token: string;
  price: number;
  currency: string;
  onError: (msg: string) => void;
}

function formatPrice(price: number, currency: string): string {
  try {
    return new Intl.NumberFormat("es-CL", {
      style: "currency",
      currency,
      maximumFractionDigits: currency === "CLP" ? 0 : 2,
    }).format(price);
  } catch {
    return `${price} ${currency}`;
  }
}

/**
 * Tarjeta de upsell: ofrece a un `viewer` con correo @pucv.cl comprar el acceso
 * de administrador vía Mercado Pago. Al confirmar, redirige al checkout (init_point).
 */
export default function UpgradeAdmin({ token, price, currency, onError }: UpgradeAdminProps) {
  const [loading, setLoading] = useState(false);

  async function handleBuy() {
    setLoading(true);
    try {
      const initPoint = await createBillingPreference(token);
      // Redirige a Checkout Pro de Mercado Pago
      window.location.href = initPoint;
    } catch (err) {
      setLoading(false);
      onError(err instanceof Error ? err.message : "No se pudo iniciar el pago.");
    }
  }

  return (
    <div className="mt-3 px-4 py-3.5 rounded-[14px] border border-line bg-surface flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-[9px] bg-ink/[0.06] border border-line flex items-center justify-center shrink-0 text-ink-2">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="5" width="20" height="14" rx="2" /><line x1="2" y1="10" x2="22" y2="10" />
          </svg>
        </div>
        <div>
          <h3 className="m-0 text-[13.5px] font-semibold">Acceso de administrador</h3>
          <p className="m-0 mt-0.5 text-[11.5px] text-ink-3 leading-snug max-w-[420px]">
            Desbloquea gestión de cámaras, vista en vivo, logs del sistema y el gráfico
            histórico. Pago único vía Mercado Pago.
          </p>
        </div>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <span className="font-semibold text-[15px] text-ink whitespace-nowrap">
          {formatPrice(price, currency)}
        </span>
        <button
          type="button"
          onClick={handleBuy}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[10px] bg-ink text-surface text-[12px] font-semibold transition-opacity hover:opacity-90 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/40"
        >
          {loading ? "Redirigiendo…" : "Adquirir acceso"}
        </button>
      </div>
    </div>
  );
}
