import { useEffect, useRef, useState } from "react";
import { verifyGoogleToken } from "../api";
import LegalNotice from "./LegalNotice";

const ALLOWED_DOMAINS = ["@mail.pucv.cl", "@pucv.cl"];

interface LoginProps {
  /** Recibe el JWT de sesión y el correo del usuario autenticado. */
  onSuccess: (token: string, email: string) => void;
}

export default function Login({ onSuccess }: LoginProps) {
  const buttonRef = useRef<HTMLDivElement | null>(null);
  const initializedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showLegal, setShowLegal] = useState(false);

  useEffect(() => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
    if (!clientId) {
      setError("Falta configurar VITE_GOOGLE_CLIENT_ID en el .env del frontend.");
      return;
    }

    function tryInit() {
      if (initializedRef.current) return true;
      const google = window.google?.accounts?.id;
      if (!google || !buttonRef.current) return false;

      google.initialize({
        client_id: clientId,
        callback: async (response: { credential: string }) => {
          setLoading(true);
          setError(null);
          try {
            const result = await verifyGoogleToken(response.credential);
            onSuccess(result.token, result.email);
          } catch (err: unknown) {
            if (err instanceof Error && err.message === "DOMAIN_NOT_ALLOWED") {
              setError(`Solo se permiten correos ${ALLOWED_DOMAINS.join(" o ")}`);
            } else {
              setError("No se pudo verificar el correo con Google. Intenta de nuevo.");
            }
          } finally {
            setLoading(false);
          }
        },
      });

      if (buttonRef.current.childNodes.length === 0) {
        google.renderButton(buttonRef.current, {
          theme: "outline",
          size: "large",
          width: 320,
          text: "signin_with",
          shape: "pill",
        });
      }
      google.prompt();
      initializedRef.current = true;
      return true;
    }

    if (!tryInit()) {
      const id = window.setInterval(() => {
        if (tryInit()) window.clearInterval(id);
      }, 200);
      return () => window.clearInterval(id);
    }
    return undefined;
  }, [onSuccess]);

  return (
    <div className="min-h-screen bg-bg">
      <div className="relative min-h-screen overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgb(68,128,207),transparent_55%),radial-gradient(circle_at_bottom_right,rgba(120,170,255,0.25),transparent_55%)]" />
        <div className="relative z-10 flex min-h-screen items-center justify-center px-4 py-10">
          <div className="w-full max-w-[420px] rounded-[18px] border border-line bg-surface/90 p-6 shadow-[0_20px_80px_rgba(20,20,20,0.15)] backdrop-blur">
            <div className="mb-5">
              <div className="flex flex-col items-start gap-3">
                <div className="w-full rounded-[14px] bg-ink/5 border border-line p-3">
                  <img src="/Logo1.png" alt="SpotCheck" className="w-full h-auto" />
                </div>
              </div>
              <h1 className="mt-3 text-[22px] font-semibold text-ink">Inicio de sesión</h1>
              <p className="mt-1 text-[12.5px] text-ink-3">
                Solo correos institucionales pueden acceder al panel.
              </p>
            </div>

            <div className="space-y-4">
              <div className="text-[12px] text-ink-3">
                Debes iniciar sesión con un correo <span className="font-mono">{ALLOWED_DOMAINS.join(" o ")}</span> válido.
              </div>
              <div className="flex justify-center">
                <div ref={buttonRef} />
              </div>
              {loading && (
                <div className="text-center text-[11.5px] text-ink-3">Verificando credenciales…</div>
              )}
              {error && (
                <div className="text-center text-[11.5px] text-danger">{error}</div>
              )}
            </div>

            <div className="mt-5 pt-4 border-t border-line">
              <p className="m-0 text-[11px] text-ink-4 leading-relaxed">
                Recinto con cámaras para <b>medición de aforo</b>. No se almacenan imágenes ni
                grabaciones: solo conteos numéricos.{" "}
                <button
                  type="button"
                  onClick={() => setShowLegal(true)}
                  className="underline text-ink-3 hover:text-ink"
                >
                  Ver aviso de videovigilancia
                </button>
              </p>
              <div className="mt-2 text-[11px] text-ink-4">Acceso seguro · Sesión válida 8 horas</div>
            </div>
          </div>
        </div>
      </div>

      {showLegal && <LegalNotice onClose={() => setShowLegal(false)} />}
    </div>
  );
}
