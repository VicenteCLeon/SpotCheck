## VII. Detalle Casos de Prueba — SpotCheck

---

### P01 — Iniciar sesión
- **RF:** FR-01
- **Ejecutor:** Estudiante, Administrador
- **Precondición:** No aplica
- **Descripción:** Los usuarios iniciarán sesión utilizando su correo institucional y contraseña. El usuario debe estar previamente registrado en el sistema.
- **Actividades:**
  1. Ingresar a la URL de SpotCheck desde un navegador moderno.
  2. Seleccionar la opción "Iniciar sesión".
  3. Ingresar correo institucional (ej. estudiante@pucv.cl) y contraseña.
  4. Presionar el botón "Ingresar".
- **Resultados esperados:**
  1. Al seleccionar "Iniciar sesión" se muestra un formulario con campos de correo y contraseña, y el enlace "¿Olvidaste tu contraseña?".
  2. Si las credenciales son correctas, el usuario accede al dashboard según su rol.
  3. Si las credenciales son incorrectas, se muestra un mensaje de error:
     a. "El formato de correo ingresado es incorrecto. Por favor ingrese un correo institucional válido."
     b. "El correo y la contraseña no coinciden. Por favor intente de nuevo."
- **Credenciales de prueba:**
  - Estudiante: estudiante@pucv.cl / alum123
  - Administrador: admin@pucv.cl / admin123

---

### P02 — Diferenciación de roles
- **RF:** FR-02
- **Ejecutor:** Estudiante, Administrador
- **Precondición:** P01
- **Descripción:** El sistema debe mostrar vistas y funcionalidades diferenciadas según el rol del usuario autenticado: Estudiante o Administrador.
- **Actividades:**
  1. Iniciar sesión con la cuenta de Estudiante (estudiante@pucv.cl).
  2. Observar el menú y opciones disponibles y registrar.
  3. Cerrar sesión.
  4. Iniciar sesión con la cuenta de Administrador (admin@pucv.cl).
  5. Observar el menú y opciones disponibles y comparar con el paso 2.
- **Resultados esperados:**
  1. El estudiante accede únicamente a la vista de disponibilidad de espacios, mapa y notificaciones.
  2. El administrador accede además al panel de administración, gestión de ubicaciones y reportes.
  3. No es posible acceder a funciones de otro rol sin el permiso correspondiente.

---

### P03 — Monitoreo de ocupación en tiempo real (YOLOv8)
- **RF:** FR-03, FR-04
- **Ejecutor:** Administrador (verificación técnica)
- **Precondición:** No aplica (requiere cámara activa en nodo de procesamiento)
- **Descripción:** El sistema debe recopilar y procesar datos de ocupación en tiempo real desde la cámara instalada en el espacio monitoreado, utilizando el modelo YOLOv8.
- **Actividades:**
  1. Verificar que la cámara web está conectada y activa en el nodo de procesamiento.
  2. Iniciar el módulo de captura que ejecuta YOLOv8.
  3. Posicionar entre 1 y 10 personas frente a la cámara en condiciones controladas.
  4. Observar el conteo de personas generado en el panel de administración.
  5. Repetir con distintas cantidades: 0, 5 y 10 personas.
- **Resultados esperados:**
  1. El sistema inicia el procesamiento del flujo de video sin almacenar frames en disco.
  2. El conteo numérico de personas se actualiza en tiempo real y se refleja en el backend.
  3. La precisión del conteo supera el 80% en condiciones controladas de iluminación y ángulo (NFR-03).
  4. Con 0 personas, el conteo reportado es 0.

---

### P04 — Clasificación de disponibilidad por categorías
- **RF:** FR-05
- **Ejecutor:** Estudiante, Administrador
- **Precondición:** P03
- **Descripción:** El sistema debe traducir el conteo numérico de personas en categorías de disponibilidad: Disponible, Moderado o Lleno.
- **Actividades:**
  1. Con 0 personas en el espacio, revisar el indicador de disponibilidad en la app.
  2. Ingresar personas hasta superar el 50% de la capacidad máxima configurada y revisar.
  3. Ingresar personas hasta superar el 90% de la capacidad máxima y revisar.
  4. Registrar el estado mostrado en cada escenario.
- **Resultados esperados:**
  1. Ocupación baja (0–40%): indicador muestra "Disponible" en color verde.
  2. Ocupación media (41–75%): indicador muestra "Moderado" en color amarillo.
  3. Ocupación alta (>75%): indicador muestra "Lleno" en color rojo.
  4. La clasificación se actualiza automáticamente al cambiar el conteo.

---

### P05 — Actualización de datos en intervalos predefinidos
- **RF:** FR-06
- **Ejecutor:** Estudiante
- **Precondición:** P03
- **Descripción:** El sistema debe actualizar los datos de disponibilidad en intervalos predefinidos, garantizando información reciente sin recargar la página.
- **Actividades:**
  1. Abrir la vista principal de SpotCheck con datos de un espacio monitoreado.
  2. Registrar el conteo y la hora de la última actualización.
  3. Esperar el tiempo del intervalo de actualización configurado.
  4. Verificar si el indicador y el conteo se actualizan sin recargar la página.
- **Resultados esperados:**
  1. Los datos se actualizan automáticamente dentro del intervalo configurado.
  2. La latencia máxima entre detección real y visualización no supera los 30 segundos (NFR-01).
  3. La marca de tiempo de última actualización cambia en cada ciclo.

---

### P06 — Visualización de lista de ubicaciones monitoreadas
- **RF:** FR-07
- **Ejecutor:** Estudiante, Administrador
- **Precondición:** P01
- **Descripción:** El sistema debe mostrar al usuario una lista con todas las ubicaciones actualmente monitoreadas (comedor y patio de la sede IBC).
- **Actividades:**
  1. Iniciar sesión en la aplicación.
  2. Acceder a la vista principal o dashboard.
  3. Revisar la lista de ubicaciones mostradas.
  4. Verificar que aparecen el comedor y el patio de la sede IBC.
- **Resultados esperados:**
  1. La vista principal muestra el comedor y el patio como ubicaciones disponibles.
  2. Cada ubicación presenta nombre, estado de disponibilidad actual y capacidad.
  3. La lista es accesible desde dispositivos móviles y navegadores modernos.

---

### P07 — Indicador visual de nivel de ocupación
- **RF:** FR-08
- **Ejecutor:** Estudiante
- **Precondición:** P06
- **Descripción:** El sistema debe mostrar un indicador visual (color) del nivel de ocupación para cada ubicación, permitiendo al estudiante interpretar la disponibilidad de forma rápida.
- **Actividades:**
  1. Iniciar sesión como estudiante.
  2. Observar la lista de ubicaciones en el dashboard.
  3. Identificar el indicador visual (color) asociado a cada espacio.
  4. Verificar que el color coincide con el estado de disponibilidad reportado.
- **Resultados esperados:**
  1. Cada ubicación presenta un indicador de color visible desde la lista principal.
  2. El indicador es legible desde dispositivo móvil sin necesidad de ampliar la pantalla.
  3. Verde = Disponible, Amarillo = Moderado, Rojo = Lleno.
  4. El estudiante interpreta el estado de un espacio en menos de 5 segundos (NFR-15).

---

### P08 — Información detallada de un espacio
- **RF:** FR-09
- **Ejecutor:** Estudiante, Administrador
- **Precondición:** P06
- **Descripción:** El sistema debe permitir visualizar información detallada de cada espacio: capacidad máxima, ocupación actual y tendencias básicas.
- **Actividades:**
  1. Desde la lista de ubicaciones, seleccionar el espacio "Comedor".
  2. Revisar la información desplegada en la vista de detalle.
  3. Repetir con el espacio "Patio".
- **Resultados esperados:**
  1. La vista de detalle muestra: nombre del espacio, capacidad máxima, ocupación actual (número de personas), categoría de disponibilidad e indicador de tendencia.
  2. Los datos son consistentes con los reportados en la lista principal.
  3. La vista de detalle es accesible desde dispositivos móviles.

---

### P09 — Interfaz con mapa de ubicación de espacios
- **RF:** FR-10
- **Ejecutor:** Estudiante
- **Precondición:** P01
- **Descripción:** El sistema debe incluir una vista de mapa que permita al estudiante ubicar geográficamente los espacios monitoreados dentro de la sede IBC.
- **Actividades:**
  1. Iniciar sesión como estudiante.
  2. Acceder a la opción "Mapa" desde el dashboard.
  3. Verificar que el comedor y el patio aparecen marcados en el mapa.
  4. Seleccionar un marcador y verificar que muestra el estado de disponibilidad.
- **Resultados esperados:**
  1. Se muestra un mapa con la sede IBC donde se identifican los espacios monitoreados.
  2. Cada marcador muestra el nombre del espacio y su disponibilidad actual.
  3. Al interactuar con un marcador se accede a la vista de detalle del espacio (FR-09).
  4. El mapa es funcional en dispositivos móviles.

---

### P10 — Suscripción y recepción de notificaciones
- **RF:** FR-11
- **Ejecutor:** Estudiante
- **Precondición:** P01
- **Descripción:** El sistema debe permitir suscribirse a un espacio específico para recibir una notificación cuando dicho espacio cambie a estado Disponible.
- **Actividades:**
  1. Iniciar sesión como estudiante.
  2. Seleccionar el espacio "Comedor" (en estado "Lleno").
  3. Activar la opción "Notificarme cuando esté disponible".
  4. Esperar a que la ocupación baje al umbral "Disponible".
  5. Verificar la recepción de la notificación (push o correo).
- **Resultados esperados:**
  1. El sistema registra la suscripción del estudiante al espacio seleccionado.
  2. Cuando el espacio cambia a "Disponible", se envía notificación al usuario suscrito.
  3. La notificación llega dentro de los 30 segundos posteriores al cambio de estado (NFR-01).
  4. El usuario puede desactivar la suscripción desde la misma interfaz.

---

### P11 — Almacenamiento de datos agregados de ocupación
- **RF:** FR-12
- **Ejecutor:** Administrador
- **Precondición:** P03
- **Descripción:** El sistema debe almacenar datos históricos de ocupación de forma agregada, sin ningún identificador personal, para análisis institucional.
- **Actividades:**
  1. Iniciar sesión como administrador.
  2. Acceder al panel de reportes o base de datos.
  3. Verificar que se almacenan registros de ocupación por espacio y por intervalo de tiempo.
  4. Verificar que los registros no contienen datos personales ni identificadores de personas.
- **Resultados esperados:**
  1. El sistema almacena registros con: nombre del espacio, fecha/hora, conteo de personas y categoría de ocupación.
  2. Ningún registro contiene datos personales ni identificadores de dispositivos.
  3. Los datos son consultables por el administrador a través del panel.

---

### P12 — Procesamiento de video sin almacenamiento de imágenes
- **RF:** FR-14
- **Ejecutor:** Administrador (verificación técnica)
- **Precondición:** P03
- **Descripción:** El sistema debe procesar el flujo de video exclusivamente en memoria RAM, sin guardar frames, imágenes ni grabaciones en ningún almacenamiento persistente.
- **Actividades:**
  1. Iniciar el módulo de captura con la cámara activa.
  2. Revisar el sistema de archivos del nodo de procesamiento durante la ejecución.
  3. Verificar que no se generan archivos de imagen o video en ningún directorio.
  4. Detener el módulo y revisar nuevamente el sistema de archivos.
- **Resultados esperados:**
  1. Durante el procesamiento no se crea ningún archivo de imagen (.jpg, .png) ni de video (.mp4, .avi) en el sistema de archivos del nodo.
  2. Los únicos datos persistidos son los conteos numéricos enviados al backend.
  3. Al detener el módulo, no quedan artefactos de imagen en ningún directorio.

---

### P13 — Almacenamiento exclusivo de datos de ocupación (sin PII)
- **RF:** FR-16
- **Ejecutor:** Administrador
- **Precondición:** P11
- **Descripción:** El sistema no debe almacenar información identificable de personas. Solo se persisten datos numéricos de ocupación por espacio.
- **Actividades:**
  1. Acceder a la base de datos (Supabase/PostgreSQL) como administrador.
  2. Revisar todas las tablas del sistema.
  3. Verificar que no existen columnas con datos personales derivados de usuarios de los espacios.
  4. Confirmar que los únicos datos almacenados son: espacio_id, timestamp, conteo, categoría.
- **Resultados esperados:**
  1. La base de datos no contiene información personal identificable (PII) de los usuarios de los espacios monitoreados.
  2. Los registros de ocupación contienen únicamente: identificador del espacio, marca de tiempo, conteo numérico y categoría.
  3. El sistema cumple con la normativa chilena de protección de datos (NFR-11, NFR-12).

---

### P14 — Panel de administración — gestión de ubicaciones y umbrales
- **RF:** FR-20
- **Ejecutor:** Administrador
- **Precondición:** P01 (como Administrador)
- **Descripción:** El administrador debe poder agregar, eliminar y configurar espacios monitoreados, así como ajustar umbrales de capacidad desde el panel, sin modificar código fuente.
- **Actividades:**
  1. Iniciar sesión como administrador y acceder al panel de administración.
  2. Agregar una nueva ubicación con nombre "Sala de estudio" y capacidad 30 personas.
  3. Verificar que la nueva ubicación aparece en el listado.
  4. Modificar el umbral de capacidad del espacio "Comedor" de 100 a 80 personas.
  5. Eliminar la ubicación "Sala de estudio" creada en el paso 2.
  6. Verificar que ya no aparece en el listado.
- **Resultados esperados:**
  1. Al agregar una ubicación, aparece inmediatamente en el listado del panel y en la vista del estudiante.
  2. Al modificar el umbral, las categorías de disponibilidad se recalculan con el nuevo valor.
  3. Al eliminar una ubicación, desaparece del listado sin afectar los datos históricos almacenados.
  4. Todas las operaciones se realizan sin intervenir en el código fuente ni reiniciar el sistema.

---

### P15 — Registro de actividad y errores (logs)
- **RF:** FR-21
- **Ejecutor:** Administrador
- **Precondición:** P01 (como Administrador)
- **Descripción:** El sistema debe registrar automáticamente los eventos relevantes y errores en un log accesible para el administrador, para diagnóstico durante el piloto.
- **Actividades:**
  1. Iniciar sesión como administrador y acceder a la sección de logs del sistema.
  2. Forzar un error desconectando la cámara mientras el sistema está en ejecución.
  3. Verificar que el evento de falla de cámara aparece en los logs.
  4. Reconectar la cámara y verificar que el sistema reanuda operación automáticamente.
  5. Verificar que la reconexión queda registrada en los logs.
- **Resultados esperados:**
  1. El panel muestra registros de logs ordenados por fecha y hora.
  2. La desconexión de la cámara genera un registro de error con descripción y timestamp.
  3. La reconexión exitosa genera un registro de reanudación del servicio.
  4. El administrador puede filtrar los logs por tipo de evento (error, info, advertencia).