# SpotCheck — Monitor de Aforo

Sistema de monitoreo de aforo en tiempo real para el campus universitario. Detecta personas por cámara y muestra el estado de ocupación en un dashboard web.

---

## Acceso

El sistema requiere iniciar sesión con una cuenta de Google institucional (`@pucv.cl` o `@mail.pucv.cl`).

Abre la URL del frontend e inicia sesión con tu cuenta Google institucional.

---

## Roles

| Rol | Qué puede hacer |
|---|---|
| **Viewer** | Ver el dashboard en tiempo real, recibir notificaciones de navegador |
| **Admin** | Todo lo anterior + gestionar cámaras, ver video en vivo, exportar datos, ver logs |

> Los usuarios `@pucv.cl` (no `@mail.pucv.cl`) pueden adquirir acceso admin desde el dashboard.

---

## Dashboard

Al iniciar sesión verás:

- **Mapa del campus** — estado de cada zona: verde (disponible), amarillo (moderado), rojo (lleno)
- **Resumen general** — aforo total, porcentaje de ocupación global, cámaras en línea y en alerta
- **Tarjetas por zona** — conteo de personas en tiempo real, barra de progreso y estado de conexión
- **Actividad reciente** — eventos como cambios de estado o cámaras desconectadas

Los datos se actualizan automáticamente cada 2 segundos.

### Niveles de ocupación

| Color | Umbral | Significado |
|---|---|---|
| Verde | < 40% | Disponible |
| Amarillo | 40–74% | Ocupación moderada |
| Rojo | ≥ 75% | Lleno o por lleno |

---

## Notificaciones de navegador

Puedes suscribirte a una zona para recibir una notificación cuando vuelva a estar disponible:

1. En la tarjeta de la zona, activa el ícono de notificación (campana)
2. El navegador pedirá permiso la primera vez
3. Recibirás una notificación cuando esa zona baje a nivel normal

---

## Funciones de administrador

Las siguientes funciones están disponibles solo para admins desde los botones de la barra superior:

### Gestionar cámaras

Abre el panel de administración de cámaras para:

- Agregar una cámara nueva (índice USB `0`, `1`… o URL RTSP)
- Editar nombre, aforo máximo, edificio u orden de visualización
- Activar o desactivar una cámara sin reiniciar el sistema
- Eliminar una cámara

Los cambios se aplican en tiempo real sin reiniciar el backend.

### Vista en vivo

Muestra el video MJPEG en vivo de todas las cámaras activas. Cada cámara tiene:

- Indicador de estado online/offline
- Botón de reconexión individual si la señal se pierde

### Exportar datos

Descarga el histórico de ocupación por horario y zona para análisis:

1. Haz clic en el botón de descarga (↓) en la barra superior
2. Elige el **rango de fechas** (por defecto los últimos 7 días; máximo 92 días)
3. Elige la **granularidad**:
   - **Por hora** — promedio, máximo y mínimo de personas por cada hora y zona
   - **Por día** — resumen diario por zona
   - **Detallado** — cada muestra registrada (~cada 10 segundos)
4. Elige la **zona** (todas o una específica)
5. Elige el **formato**: CSV (abre directo en Excel) o Excel (.xlsx)
6. Haz clic en **Descargar**

El archivo se llama `spotcheck_ocupacion_<granularidad>_<desde>_<hasta>.<ext>`.

Las horas en el archivo corresponden al horario local del servidor (Chile).

### Gráfico histórico

Muestra la ocupación del campus cada 10 minutos durante las últimas 6 horas. Aparece en la sección inferior del dashboard.

### Logs del sistema

Panel desplegable con las últimas 200 entradas del log del backend: arranque de workers, muestras subidas a Supabase, alertas enviadas y errores.

---

## Alertas por email

El sistema envía un email automático al equipo responsable cuando una zona sube de nivel de ocupación **durante el horario de almuerzo (13:30–14:30)**:

- Normal → Moderado (≥ 40%): aviso ámbar
- Normal/Moderado → Lleno (≥ 75%): aviso crítico

Las mejoras (zona que se desocupa) no generan email.

---

## Sesión

- La sesión dura **8 horas** y se mantiene al recargar la página
- Se invalida automáticamente al expirar (el sistema lo detecta cada 60 s)
- Para cerrar sesión usa el botón de salida (→) en la barra superior

---

