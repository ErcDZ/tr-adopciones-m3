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

La interfaz llama a estas rutas en el mismo origen y envía el token Bearer. El endpoint de postulaciones se incluye en este repositorio. El catálogo aún requiere el controlador de HU-01 del equipo.

- `GET /api/adopciones/catalogo` devuelve `200` y `{ "datos": [{ "animalID": "A-001", "nombre": "Ejemplo" }] }`. El formulario toma el identificador de la selección.
- `POST /api/adopciones/postulaciones` recibe el JSON de abajo y devuelve `201` con `{ "postulacionID": "POST-001" }`. El código recibido se muestra en pantalla.
- `400` muestra el mensaje de validación del servidor o pide revisar los campos obligatorios. `409` admite `LIMITE_POSTULACIONES`, `PROHIBICION_TENENCIA` y `ANIMAL_NO_DISPONIBLE`. También se muestra el mensaje del servidor si envía otro código. El backend decide y aplica estas reglas de negocio.

```json
{
  "postulanteRut": "12345678-9",
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

## Endpoint de postulaciones y MongoDB

Configura `MONGODB_URI` en el entorno local con un replica set o un clúster de Atlas que admita transacciones. Un servidor standalone de MongoDB no admite la transacción que protege RN-06. La base se llama `tr_adopciones` y la colección `postulaciones`. El servicio puede iniciar sin esta variable para probar la autenticación, pero el alta devuelve `503` mientras no haya almacenamiento configurado.

- `M1_URL` es el origen HTTP del registro. Si se omite, se usa `NUCLEO_URL`. El ZIP del núcleo no incluye el registro simulado. Si usas el ZIP para autenticación, configura por separado el origen del registro y un token que el registro acepte.
- `M1_TOKEN` es un token Bearer de servicio (solo el valor del token) autorizado para consultar los animales del catálogo. Guárdalo exclusivamente en el servidor y renuévalo antes de que expire. Si se omite, se reenvía el token del vecino y aplican las restricciones de propiedad del simulador. Una respuesta de acceso denegado del registro se traduce en `503` para esa verificación. Usa el servicio y las cuentas autorizadas por el equipo.

`POST /api/adopciones/postulaciones` exige el JSON documentado arriba. El servidor compara `postulanteRut` con el RUT confirmado por el núcleo y usa ese RUT confirmado para consultar la prohibición de tenencia y guardar. Considera apto al animal registrado en M1 con microchip y estado `con_microchip` o `inscrito`. El registro simulado devuelve el identificador con el nombre `animalId`.

| HTTP | Motivo |
| --- | --- |
| `201` | Documento guardado con `postulacionID`, estado `recibida` y `fechaCreacion` en UTC ISO 8601. `Location` identifica la postulación creada. |
| `400` | JSON inválido, RUT con formato incorrecto o datos del formulario inválidos. |
| `401` | Token ausente o inválido. |
| `403` | Perfil distinto de vecino o RUT distinto al de la sesión. |
| `404 ANIMAL_NO_ENCONTRADO` | M1 confirma que el animal no existe. |
| `409` | `ANIMAL_NO_DISPONIBLE`, `PROHIBICION_TENENCIA`, `LIMITE_POSTULACIONES` o `POSTULACION_DUPLICADA`. |
| `503` | Una dependencia no permite completar la verificación o falta configurar MongoDB. |

MongoDB utiliza un índice único de RUT y animal para impedir duplicados en cualquier estado. La transacción actualiza primero un documento de control por RUT y después cuenta las postulaciones `recibida` y `en_evaluación`. Las solicitudes simultáneas del mismo RUT compiten por el mismo control, por lo que una transacción reintenta con un conteo actualizado. Los futuros cambios de estado que vuelvan a activar una postulación deberán aplicar la misma coordinación.

## Aprobación de postulación y cancelación de paralelas (HU-04.3)

`PATCH /api/adopciones/postulaciones/:postulacionId` requiere autenticación Bearer válida y perfil `funcionario`. Aprueba la postulación indicada y cancela en cascada las postulaciones paralelas pendientes del mismo `animalID` dentro de una transacción en `tr_adopciones.postulaciones`, sin modificar postulaciones de otros animales.

| HTTP | Código / Motivo |
| --- | --- |
| `200` | Postulación aprobada y paralelas del mismo animal canceladas. |
| `401` | Token ausente o inválido. |
| `403` | `ACCESO_DENEGADO` si el perfil autenticado no es `funcionario`. |
| `404` | `POSTULACION_NO_ENCONTRADA` si el identificador no existe. |

## Controles de seguridad (OWASP)

| Categoría OWASP | Control aplicado | Ubicación en código | Verificación |
| --- | --- | --- | --- |
| Broken Access Control | Verificación de sesión y rol `funcionario` antes de ejecutar la aprobación (`403 ACCESO_DENEGADO` para `vecino`). | `src/app.js` (líneas 111–119) y `requierePerfil` | `npm test` |
| Broken Authentication | Validación de encabezado `Bearer` y consulta de sesión activa en el núcleo (`401 TOKEN_REQUERIDO` / `TOKEN_INVALIDO`). | `src/app.js` y `src/nucleo.js` | `npm test` |
| Security Misconfiguration | Cabecera `X-Powered-By` deshabilitada, `Cache-Control: no-store` en sesión y manejo de `400 JSON_INVALIDO` / `413 CUERPO_DEMASIADO_GRANDE` / `500 ERROR_INTERNO`. | `src/app.js` | `npm test` |