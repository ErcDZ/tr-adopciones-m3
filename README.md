# tr-adopciones-m3
Proyecto Ingenieria de Software TI3043/D-IEI-N4-P2-C2(E-F)/D

Repositorio del Grupo 3 Modulo 3 sobre el Sistema municipal de tenencia responsable de mascotas

## Ejecutar la API

Requisitos: Node.js 22 o superior y npm. Desde la raíz del repositorio:

```powershell
npm ci
Copy-Item .env.example .env
npm start
```

| Variable | Uso |
| --- | --- |
| `PORT` | Puerto de Adopciones. Por defecto, `3000`. |
| `NUCLEO_URL` | Origen del núcleo sin ruta, por ejemplo `https://nucleo-tr.onrender.com`. Obligatoria. |
| `NUCLEO_TIMEOUT_MS` | Tiempo máximo por consulta, incluida la lectura del JSON. Por defecto, `35000` ms para considerar el arranque en frío de Render. |

Para usar el ZIP del docente, descomprímelo fuera de este repositorio, inicia el núcleo según su README y cambia `NUCLEO_URL` al origen local. Mantén el ZIP y las credenciales fuera de Git. `.env.example` solo contiene configuración pública y `.gitignore` excluye los archivos `.env` locales.

## Rutas y permisos

| Método y ruta | Acceso | Respuesta correcta |
| --- | --- | --- |
| `POST /api/nucleo/sesiones` | Pública. JSON con `rut` y `clave`. | `201` con `token`, `rut`, `perfil`, `nombre` y `expira`. |
| `GET /api/adopciones/acceso/vecino` | Bearer válido de perfil `vecino`. | `200` con `rut` y `perfil`. |
| `GET /api/adopciones/acceso/funcionario` | Bearer válido de perfil `funcionario`. | `200` con `rut` y `perfil`. |

Las dos rutas de acceso demuestran el control de permisos antes de incorporar operaciones de adopción. Cada ruta permite exclusivamente el perfil indicado. Para probar manualmente, envía un inicio de sesión a Adopciones con una cuenta de prueba de la [documentación del núcleo](https://nucleo-tr.onrender.com/). Usa su token en el encabezado `Authorization: Bearer <token>` de una solicitud a la ruta del perfil. Repite con la ruta del otro perfil para comprobar el `403`, y luego sin encabezado para comprobar el `401`.

Los errores siguen el contrato del núcleo. Por ejemplo:

```json
{"error":{"codigo":"SERVICIO_NO_DISPONIBLE","mensaje":"El núcleo no está disponible"}}
```

| HTTP | Códigos y significado |
| --- | --- |
| `401` | `CREDENCIALES_INVALIDAS` en el inicio de sesión. `TOKEN_REQUERIDO` si falta el encabezado y `TOKEN_INVALIDO` si el formato es incorrecto o el núcleo rechaza el token. |
| `403` | `PERFIL_NO_AUTORIZADO` si la sesión es válida pero el perfil carece de permiso. |
| `503` | `SERVICIO_NO_DISPONIBLE` si falla la comunicación, se agota el tiempo de espera o la respuesta del núcleo no cumple el contrato esperado. |

## Cómo funciona

1. **Arranque.** `src/server.js` carga la configuración aportada por Node y abre el puerto. `src/app.js` construye Express por separado, lo que permite que las pruebas usen puertos temporales.
2. **Inicio de sesión.** El proxy comprueba que RUT y clave sean cadenas con contenido y los reenvía. El núcleo comprueba el dígito verificador y las credenciales y emite el token. Adopciones devuelve los campos documentados con `Cache-Control: no-store`.
3. **Autenticación.** En cada petición protegida se comprueba el formato del encabezado. `GET /api/nucleo/sesiones/actual` valida el token y el middleware guarda en `req.usuario` el RUT y el perfil confirmados por el núcleo. El cliente HTTP en `src/nucleo.js` acota el tiempo de espera y rechaza redirecciones para evitar reenviar credenciales a otro destino.
4. **Autorización.** Después de autenticar, `requierePerfil(...perfiles)` compara el perfil confirmado con la lista permitida por la ruta. Un 401 corresponde a una sesión ausente o rechazada, un 403 a una sesión válida con permisos insuficientes y un 503 a una verificación que no se pudo completar. En ninguno de esos casos se ejecuta el controlador protegido.

## Pruebas

```powershell
npm test
```

La suite usa Express y un servidor HTTP de prueba que imita el contrato del núcleo. Verifica inicio de sesión, validación de entradas, propagación del token, acceso por perfil, acceso denegado, token inválido o expirado y fallos o demora del núcleo. Se ejecuta sin credenciales ni conexión a Render.

## Formulario de postulación

Con Express en ejecución, abre `http://localhost:3000/` (o el puerto configurado), inicia sesión como vecino y selecciona **Solicitar adopción** en el catálogo. El token se mantiene en memoria mientras está abierta la página. Tras autenticar, la interfaz comprueba el perfil con la ruta protegida de vecino. El backend de postulaciones también debe autenticar y autorizar cada solicitud.

### Contrato provisional para integrar con HU-01 y postulaciones

La interfaz llama a estas rutas en el mismo origen y envía el token Bearer. Este repositorio aún requiere los controladores de catálogo y postulaciones del equipo. Si el equipo ya acordó rutas, nombres o valores distintos, adapta las llamadas y el mapeo en `public/postulacion.js` al contrato acordado.

- `GET /api/adopciones/catalogo` devuelve `200` y `{ "datos": [{ "animalID": "A-001", "nombre": "Ejemplo" }] }`. El formulario toma el identificador de la selección.
- `POST /api/adopciones/postulaciones` recibe el JSON de abajo y devuelve `201` con `{ "postulacionID": "POST-001" }`. El código recibido se muestra en pantalla.
- `400` muestra el mensaje de validación del servidor o pide revisar los campos obligatorios. `409` admite `LIMITE_POSTULACIONES`, `PROHIBICION_TENENCIA` y `ANIMAL_NO_DISPONIBLE`. También se muestra el mensaje del servidor si envía otro código. El backend decide y aplica estas reglas de negocio.

```json
{
  "animalID": "A-001",
  "viviendaTipo": "casa",
  "tienePatio": true,
  "hayNinos": false,
  "tieneOtrasMascotas": true,
  "motivoAdopcion": "Queremos adoptar y podemos asumir sus cuidados.",
  "consentimientoCohabitantes": true
}
```

El formulario exige una opción explícita de sí o no para los tres campos booleanos. Los valores de vivienda implementados son `casa`, `departamento` y `otra`. La casilla de consentimiento empieza desmarcada y debe marcarse antes de enviar.
