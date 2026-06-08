// Coordenadas del campus y de cada cámara.
// Ajusta MAP_CENTER y las coordenadas por cámara según la ubicación real.
//
// Para obtener coordenadas: abre Google Maps, haz clic derecho en el punto exacto
// y copia las coordenadas (lat, lng).

export const MAP_CENTER: [number, number] = [-33.04458, -71.61239];
export const MAP_ZOOM = 19;

// Mapea camera_id → [lat, lng]
// Si una cámara no aparece aquí, no se dibuja en el mapa.
export const CAMERA_COORDS: Record<string, [number, number]> = {
    cam1: [-33.04455568751296, -71.6123758188712],
    cam2: [-33.044602340825875, -71.61239995875096],
};

// Etiqueta del lugar que aparece en el popup (opcional — si no existe usa cam.name)
export const CAMERA_LABELS: Record<string, string> = {
    cam1: "Comedor",
    cam2: "Patio central",
};
