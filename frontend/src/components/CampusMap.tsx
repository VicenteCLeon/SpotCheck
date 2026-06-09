import { useState } from "react";
import { GoogleMap, OverlayView, InfoWindow, useJsApiLoader } from "@react-google-maps/api";
import type { Faculty } from "../types";
import { MAP_CENTER, MAP_ZOOM, CAMERA_COORDS, CAMERA_LABELS } from "../mapConfig";

const GOOGLE_MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY as string;

interface Props {
    faculties: Faculty[];
    warnT: number;
    dangerT: number;
}

const STATUS_COLOR: Record<string, string> = {
    danger: "#ef4444",
    warn:   "#f59e0b",
    ok:     "#22c55e",
};

const STATUS_LABEL: Record<string, string> = {
    danger: "Lleno",
    warn:   "Moderado",
    ok:     "Disponible",
};

function pct(f: Faculty) {
    return f.cap > 0 ? Math.round((f.occ / f.cap) * 100) : 0;
}

function statusOf(f: Faculty, warnT: number, dangerT: number): string {
    const p = pct(f);
    if (p >= dangerT) return "danger";
    if (p >= warnT)   return "warn";
    return "ok";
}

export default function CampusMap({ faculties, warnT, dangerT }: Props) {
    const { isLoaded, loadError } = useJsApiLoader({ googleMapsApiKey: GOOGLE_MAPS_KEY });
    const [selected, setSelected] = useState<string | null>(null);

    const center = { lat: MAP_CENTER[0], lng: MAP_CENTER[1] };
    const mapped = faculties.filter((f) => CAMERA_COORDS[f.id]);

    return (
        <div className="bg-surface border border-line rounded-[14px] overflow-hidden">
            <div className="px-4 pt-4 pb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                    <h2 className="m-0 text-[14px] md:text-[15px] font-semibold tracking-tight">
                        Mapa del campus
                    </h2>
                    <div className="text-ink-3 text-[11px] mt-0.5">
                        Ocupación en tiempo real por espacio
                    </div>
                </div>
                <div className="flex gap-3 text-[11px] text-ink-3 items-center">
                    <span className="inline-flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-ok" /> Disponible
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-warn" /> Moderado
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-danger" /> Lleno
                    </span>
                </div>
            </div>

            {loadError || !GOOGLE_MAPS_KEY ? (
                <div style={{ height: 300 }} className="flex items-center justify-center text-center text-ink-3 text-[12px] px-6">
                    {!GOOGLE_MAPS_KEY
                        ? "Falta VITE_GOOGLE_MAPS_KEY en el .env del frontend. Agrégala y reinicia el servidor de desarrollo."
                        : "No se pudo cargar Google Maps. Revisa que la API key sea válida y tenga habilitada la Maps JavaScript API."}
                </div>
            ) : !isLoaded ? (
                <div style={{ height: 300 }} className="flex items-center justify-center text-ink-3 text-sm">
                    Cargando mapa...
                </div>
            ) : (
                <GoogleMap
                    mapContainerStyle={{ height: 300, width: "100%" }}
                    center={center}
                    zoom={MAP_ZOOM}
                    options={{ scrollwheel: true }}
                    onClick={() => setSelected(null)}
                >
                    {mapped.map((f) => {
                        const status   = statusOf(f, warnT, dangerT);
                        const color    = STATUS_COLOR[status];
                        const [lat, lng] = CAMERA_COORDS[f.id];

                        return (
                            <OverlayView
                                key={f.id}
                                position={{ lat, lng }}
                                mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
                            >
                                <div
                                    onClick={(e) => { e.stopPropagation(); setSelected(f.id); }}
                                    style={{
                                        width: 20,
                                        height: 20,
                                        borderRadius: "50%",
                                        background: color,
                                        border: "2px solid #fff",
                                        cursor: "pointer",
                                        transform: "translate(-50%, -50%)",
                                        boxShadow: "0 2px 8px rgba(0,0,0,0.35)",
                                    }}
                                />
                            </OverlayView>
                        );
                    })}

                    {selected && (() => {
                        const f = mapped.find((x) => x.id === selected);
                        if (!f) return null;
                        const status = statusOf(f, warnT, dangerT);
                        const color  = STATUS_COLOR[status];
                        const label  = CAMERA_LABELS[f.id] ?? f.name;
                        const p      = pct(f);
                        const [lat, lng] = CAMERA_COORDS[f.id];

                        return (
                            <InfoWindow
                                position={{ lat, lng }}
                                onCloseClick={() => setSelected(null)}
                            >
                                <div style={{ minWidth: 140, fontFamily: "sans-serif" }}>
                                    <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
                                        {label}
                                    </div>
                                    <div style={{ fontSize: 12, color: "#555", marginBottom: 2 }}>
                                        {f.occ} / {f.cap} personas
                                    </div>
                                    <div style={{ fontSize: 12, marginBottom: 2 }}>
                                        Ocupación:{" "}
                                        <strong style={{ color }}>{p}%</strong>
                                    </div>
                                    <div style={{
                                        display: "inline-block",
                                        marginTop: 4,
                                        padding: "2px 8px",
                                        borderRadius: 12,
                                        background: color,
                                        color: "#fff",
                                        fontSize: 11,
                                        fontWeight: 600,
                                    }}>
                                        {STATUS_LABEL[status]}
                                    </div>
                                    {!f.online && (
                                        <div style={{ fontSize: 11, color: "#e11d48", marginTop: 4 }}>
                                            Cámara offline
                                        </div>
                                    )}
                                </div>
                            </InfoWindow>
                        );
                    })()}
                </GoogleMap>
            )}
        </div>
    );
}
