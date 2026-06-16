import { useEffect, useState } from "react";

interface MjpegStreamProps {
  /** URL completa del stream (incluye token en query param). */
  src: string;
  alt: string;
  onRetry: () => void;
}

/** Busca un marcador de 2 bytes (p. ej. SOI 0xFFD8 / EOI 0xFFD9) en el buffer. */
function findMarker(buf: Uint8Array, b0: number, b1: number, from: number): number {
  for (let i = from; i < buf.length - 1; i++) {
    if (buf[i] === b0 && buf[i + 1] === b1) return i;
  }
  return -1;
}

/**
 * Reproductor MJPEG basado en fetch. A diferencia de <img src>, puede enviar el
 * header `ngrok-skip-browser-warning`, evitando la página de advertencia de ngrok
 * gratis. Lee el multipart/x-mixed-replace como stream, extrae cada frame JPEG
 * (entre SOI 0xFFD8 y EOI 0xFFD9) y lo pinta como object URL.
 */
export default function MjpegStream({ src, alt, onRetry }: MjpegStreamProps) {
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    let objectUrl: string | null = null;

    async function run() {
      setFailed(false);
      setFrameUrl(null);
      try {
        const res = await fetch(src, {
          headers: { "ngrok-skip-browser-warning": "true" },
          signal: controller.signal,
        });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

        const reader = res.body.getReader();
        let buffer = new Uint8Array(0);

        while (!cancelled) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value) continue;

          const merged = new Uint8Array(buffer.length + value.length);
          merged.set(buffer, 0);
          merged.set(value, buffer.length);
          buffer = merged;

          // Extrae todos los frames JPEG completos presentes en el buffer.
          let start = findMarker(buffer, 0xff, 0xd8, 0);
          let end = start >= 0 ? findMarker(buffer, 0xff, 0xd9, start + 2) : -1;
          while (start >= 0 && end >= 0) {
            const frame = buffer.slice(start, end + 2);
            const url = URL.createObjectURL(new Blob([frame], { type: "image/jpeg" }));
            if (objectUrl) URL.revokeObjectURL(objectUrl);
            objectUrl = url;
            if (!cancelled) setFrameUrl(url);

            buffer = buffer.slice(end + 2);
            start = findMarker(buffer, 0xff, 0xd8, 0);
            end = start >= 0 ? findMarker(buffer, 0xff, 0xd9, start + 2) : -1;
          }

          // Evita crecimiento ilimitado si llega basura sin un SOI válido.
          if (start < 0 && buffer.length > 2_000_000) buffer = new Uint8Array(0);
        }
      } catch (err) {
        if (!cancelled && (err as Error).name !== "AbortError") setFailed(true);
      }
    }

    run();
    return () => {
      cancelled = true;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);

  if (failed) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-ink-4 text-[12px]">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34l1 1L23 7v10" />
          <line x1="1" y1="1" x2="23" y2="23" />
        </svg>
        Sin señal
        <button
          type="button" onClick={onRetry}
          className="mt-1 px-2 py-1 rounded-md border border-line text-ink-2 text-[11px] hover:border-line-strong hover:text-ink"
        >
          Reintentar
        </button>
      </div>
    );
  }

  if (!frameUrl) {
    return (
      <div className="absolute inset-0 flex items-center justify-center text-ink-4 text-[12px]">
        Conectando…
      </div>
    );
  }

  return <img src={frameUrl} alt={alt} className="absolute inset-0 w-full h-full object-contain" />;
}
