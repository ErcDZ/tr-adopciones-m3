# Verificación del flujo de Adopciones M3

Fecha: 25 de noviembre de 2026. Base de GitHub: `55f7888efab687a1acf18712c221d67b99d0b3ca`. Rama de revisión: `codex/verificacion-flujo-owasp`. La rama reutiliza el controlador de concreción del commit `ce35396` de Kristobal e incorpora las transiciones previas y la conexión a MongoDB.

## Evidencia ejecutada

En Windows con Node.js 24.18.0, `npm ci` instaló las dependencias y `npm test` pasó **13 pruebas, 0 fallos**. La suite de flujo usa solicitudes HTTP al servidor Express y servicios simulados separados para el Núcleo y el Registro. Sus cuatro pruebas también pasaron con **MongoDB 8.2.7 real**, en un replica set local desechable.

| Caso | Resultado observado | Entorno |
| --- | --- | --- |
| Autenticación | Inicio de sesión HTTP 201 según el contrato de creación de sesión. Ruta protegida HTTP 200 con la sesión válida y 401 `TOKEN_REQUERIDO` sin token. | HTTP local |
| Flujo de adopción | Alta HTTP 201 en `recibida`. Cambios HTTP 200 a `en_evaluación`, `aprobada` y `adopcion_concretada`. M1 simulado recibió el PATCH de tutor exactamente una vez y almacenó el RUT del postulante. | HTTP local con MongoDB real |
| Ruta de concreción con destino equivocado | Desde `recibida`, enviar `en_evaluacion` a la ruta de **concreción** devolvió 409 `TRANSICION_INVALIDA`. La ruta de **evaluación** permite el paso normal de `recibida` a `en_evaluación`. | HTTP local con MongoDB real |
| Sin aprobación o sin perfil | Desde `recibida` o `en_evaluación` hacia concreción se recibió 409 `TRANSICION_INVALIDA`. Tras aprobar, el perfil vecino recibió 403 `ACCESO_DENEGADO`. Estos rechazos no actualizan el tutor. | HTTP local con MongoDB real |
| Error externo | M1 devolvió HTTP 500 con una traza y una ruta de prueba. El cliente recibió solamente HTTP 503 con `error.codigo` y `error.mensaje`. Se mantuvo la postulación en `aprobada`. | HTTP local con MongoDB real |
| Animal fallecido | Alta rechazada con HTTP 409 `ANIMAL_NO_DISPONIBLE`. | M1 simulado local |
| RUT con prohibición | Alta rechazada con HTTP 409 `PROHIBICION_TENENCIA`. | Núcleo simulado local |

Para reproducir: ejecutar `npm ci` y `npm test`. Para usar MongoDB real en la prueba de flujo, configurar `M3_TEST_MONGODB_URI` con un replica set local **nuevo y desechable** en `127.0.0.1`, y ejecutar `node --test test/flujo-adopcion.test.js`. La prueba escribe datos de prueba en `tr_adopciones`; usar una instancia separada.

## Tabla 3 Prácticas OWASP observadas

Líneas de la rama de revisión. El alcance cubre los endpoints implementados en esta rama.

| Práctica | Archivo y línea exactos | Evidencia |
| --- | --- | --- |
| Validación de entradas | `src/app.js:44–48`; `src/postulaciones.js:18–30`; `src/adopcion-concretada.js:22–33` | Se comprueban cuerpo, RUT, atributos de vivienda, consentimiento, ID y tipos booleanos. Las pruebas rechazan JSON inválido, datos de acceso faltantes y saltos de estado. |
| Autenticación | `src/app.js:70–90` | Comprueba formato Bearer y consulta sesión activa al Núcleo. Se verifican 401 para token ausente, mal formado o rechazado, y 200 para sesión válida. |
| Autorización por perfil e identidad | `src/app.js:27–34`, `96–121`; `src/postulaciones.js:21–24` | Acceso, creación, catálogo y cambios de estado aplican perfil. Alta compara el RUT con la sesión. Vecino recibe 403 al concretar. |
| Errores controlados | `src/app.js:11–17`, `123–134`; `src/adopcion-concretada.js:71–89` | El esquema público es `{ error: { codigo, mensaje } }`. Se comprobó 503 genérico ante falla externa con ruta interna y traza. |
| Secretos en entorno | `src/server.js:14`, `30–32`; `.gitignore:2–4` | MongoDB y token de Registro se obtienen del entorno. Se revisaron 45 commits alcanzables y los archivos candidatos hallados por búsqueda de formatos comunes de tokens, claves, URI y asignaciones literales. Se identificaron ejemplos locales y datos ficticios de prueba. No se identificaron credenciales privadas en ese alcance. |
| Protección de credenciales en tránsito entre servicios | `src/nucleo.js:2–6`, `12–22`; `src/app.js:65–67` | Se rechazan credenciales incrustadas en la URL y redirecciones de servicios externos. El login responde con `Cache-Control: no-store`. |

Referencia: [OWASP Error Handling Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Error_Handling_Cheat_Sheet.html).

## Estado de la nube

- El origen público del Núcleo respondió HTTP 200 en su página raíz. La prueba local distingue el HTTP 201 del login, según contrato, del 200 de la consulta autenticada.
- `entrega.json:7` tiene `urlNube` vacío. La dirección inferida del nombre del servicio en Render devolvió HTTP 404 y `x-render-routing: no-server` en `/` y `/salud`.
- Pendiente la URL confirmada, el despliegue de la rama y los datos de prueba autorizados. Con ellos se deben ejecutar login y sesión, 401 sin token, 403 de vecino, animal fallecido, RUT prohibido, concreción con confirmación de tutor en M1 y comprobación de disponibilidad de la instancia antes del cierre.
- El cambio de tutor y el guardado de la concreción abarcan dos servicios. Si M1 confirma y luego falla MongoDB, la API devuelve 503 y la reconciliación depende del comportamiento de reintento del Registro; ese escenario requiere verificación en el entorno integrado.
