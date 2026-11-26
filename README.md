# tr-adopciones-m3

Proyecto Ingenieria de Software TI3043/D-IEI-N4-P2-C2(E-F)/D



Repositorio del Grupo 3 Modulo 3 sobre el Sistema municipal de tenencia responsable de mascotas



## Stack utilizado



- **Runtime:** Node.js 22+ (ESM) con `npm`

- **Framework:** Express

- **Base de datos:** MongoDB (`tr_adopciones`, colección `postulaciones`, con *replica set* o clúster de Atlas para transacciones)

- **Integraciones:** Servicio de Núcleo (autenticación, sesión activa y prohibición de tenencia) y Servicio de Registro / M1 (animales disponibles, estado y microchip)

- **Pruebas automatizadas:** Suite de pruebas con `npm test`



## Ejecutar la API



Requisitos: Node.js 22 o superior y npm. Desde la raíz del repositorio:



```powershell

npm ci

Copy-Item .env.example .env

npm test

npm start

```



| Variable | Uso |

| --- | --- |

| `PORT` | Puerto de Adopciones. Por defecto, `3000`. |

| `NUCLEO_URL` | Origen del núcleo sin ruta, por ejemplo `https://nucleo-tr.onrender.com`. Obligatoria. |

| `NUCLEO_TIMEOUT_MS` | Tiempo máximo por consulta, incluida la lectura del JSON. Por defecto, `35000` ms para considerar el arranque en frío de Render. |

| `MONGODB_URI` | URI de conexión a MongoDB (con *replica set* o Atlas para transacciones). Si se omite, el servicio puede iniciar, pero el alta devuelve `503`. |

| `M1_URL` | Origen HTTP del registro. Si se omite, se usa `NUCLEO_URL`. |

| `M1_TOKEN` | Token Bearer de servicio (solo el valor del token) autorizado para consultar los animales del catálogo. Si se omite, se reenvía el token del vecino. |



Para usar el ZIP del docente, descomprímelo fuera de este repositorio, inicia el núcleo según su README y cambia `NUCLEO_URL` al origen local. Mantén el ZIP y las credenciales fuera de Git. `.env.example` solo contiene configuración pública y `.gitignore` excluye los archivos `.env` locales.



## Usuarios de prueba



Todos los usuarios de prueba usan la clave `tenencia2026`. Son datos ficticios. Nadie puede crear cuentas: todos los módulos usan estas mismas personas.



| RUT | Nombre | Perfil | Observación |

| --- | --- | --- | --- |

| `11111111-1` | Carolina Rojas Pizarro | `vecino` | |

| `12222222-5` | Marcelo Araya Soto | `vecino` | |

| `9876543-3` | Rodrigo Pérez Vera | `vecino` | Con prohibición de tenencia (RN-04): sirve para probar que el módulo rechaza registrar o adoptar |

| `13333333-9` | Patricia Muñoz Lagos | `comunitario` | Responsable de animal comunitario (RN-03) |

| `14444444-2` | Jorge Tapia Cortés | `comunitario` | |

| `15555555-6` | Dra. Valentina Herrera Díaz | `veterinario` | |

| `16666666-K` | Dr. Andrés Contreras Riquelme | `veterinario` | |

| `17777777-3` | Claudia Vega Morales | `funcionario` | Unidad Canina |

| `18888888-7` | Felipe Ortiz Bravo | `funcionario` | Unidad Canina |

| `19999999-0` | María José Salinas Ruiz | `jefatura` | |

| `20111111-0` | Sebastián Fuentes Olivares | `jefatura` | |

| `21222222-4` | Admin Sistema | `admin` | |

| `22333333-8` | Soporte Informática | `admin` | |



## Rutas y permisos



| Método y ruta | Acceso | Respuesta correcta |

| --- | --- | --- |

| `POST /api/nucleo/sesiones` | Pública. JSON con `rut` y `clave`. | `201` con `token`, `rut`, `perfil`, `nombre` y `expira`. |

| `GET /api/adopciones/acceso/vecino` | Bearer válido de perfil `vecino`. | `200` con `rut` y `perfil`. |

| `GET /api/adopciones/acceso/funcionario` | Bearer válido de perfil `funcionario`. | `200` con `rut` y `perfil`. |

| `GET /api/adopciones/animales-disponibles` | Bearer válido (`vecino` o `funcionario`). Soporta `?page=1&limit=10&especie=...`. | `200` con `page`, `limit`, `total` y `datos`. |

| `POST /api/adopciones/postulaciones` | Bearer válido de perfil `vecino`. JSON con datos de postulación. | `201` con documento creado (`postulacionID`, `estado: "recibida"`, `fechaCreacion`) y header `Location`. |

| `PATCH /api/adopciones/postulaciones/:postulacionId` | Bearer válido de perfil `funcionario`. | `200` tras aprobar la postulación y cancelar en cascada las paralelas del mismo `animalID`. |



Las dos rutas de acceso demuestran el control de permisos antes de incorporar operaciones de adopción. Cada ruta permite exclusivamente el perfil indicado. Para probar manualmente, envía un inicio de sesión a Adopciones con una cuenta de prueba de la [documentación del núcleo](https://nucleo-tr.onrender.com/). Usa su token en el encabezado `Authorization: Bearer <token>` de una solicitud a la ruta del perfil. Repite con la ruta del otro perfil para comprobar el `403`, y luego sin encabezado para comprobar el `401`.



Los errores siguen el contrato del núcleo. Por ejemplo:



```json

{"error":{"codigo":"SERVICIO_NO_DISPONIBLE","mensaje":"El núcleo no está disponible"}}

```



| HTTP | Códigos y significado |

| --- | --- |

| `400` | `DATOS_FALTANTES`, `RUT_INVALIDO`, `DATOS_INVALIDOS`, `PARAMETROS_PAGINACION_INVALIDOS` o `JSON_INVALIDO`. |

| `401` | `CREDENCIALES_INVALIDAS` en el inicio de sesión. `TOKEN_REQUERIDO` si falta el encabezado y `TOKEN_INVALIDO` si el formato es incorrecto o el núcleo rechaza el token. |

| `403` | `PERFIL_NO_AUTORIZADO`, `RUT_NO_COINCIDE` o `ACCESO_DENEGADO` si la sesión es válida pero el perfil o RUT carece de permiso. |

| `404` | `RUTA_NO_ENCONTRADA`, `ANIMAL_NO_ENCONTRADO` o `POSTULACION_NO_ENCONTRADA`. |

| `409` | `ANIMAL_NO_DISPONIBLE`, `PROHIBICION_TENENCIA`, `LIMITE_POSTULACIONES` o `POSTULACION_DUPLICADA`. |

| `413` | `CUERPO_DEMASIADO_GRANDE`. |

| `500` | `ERROR_INTERNO`. |

| `503` | `SERVICIO_NO_DISPONIBLE` si falla la comunicación, se agota el tiempo de espera, falta configuración o la respuesta del núcleo/registro no cumple el contrato esperado. |



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



### Integración con catálogo y postulaciones



La interfaz llama a estas rutas en el mismo origen y envía el token Bearer:



- `GET /api/adopciones/animales-disponibles` (con soporte para `page`, `limit` y `especie`) devuelve `200` y `{ "page": 1, "limit": 10, "total": ..., "datos": [{ "animalID": "A-001", "especie": "...", "nombre": "Ejemplo", "microship": "..." }] }`.

- `POST /api/adopciones/postulaciones` recibe el JSON de abajo y devuelve `201` con el documento creado (`postulacionID`, `estado: "recibida"`, `fechaCreacion`) y el header `Location`.

- `400` muestra el mensaje de validación del servidor o pide revisar los campos obligatorios. `409` admite `LIMITE_POSTULACIONES`, `PROHIBICION_TENENCIA`, `POSTULACION_DUPLICADA` y `ANIMAL_NO_DISPONIBLE`. También se muestra el mensaje del servidor si envía otro código. El backend decide y aplica estas reglas de negocio.



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

### Evaluación y concreción

El funcionario inicia la evaluación enviando `{"estado":"en_evaluacion"}` al PATCH de la postulación. Se conserva `en_evaluación` como valor almacenado. Después envía `{"estado":"aprobada"}`, lo que también cancela las postulaciones paralelas activas. Ambos pasos requieren el estado anterior correspondiente.

Para concretar, el funcionario envía `{"estado":"adopcion_concretada","retiroFisicoConfirmado":true,"actaFirmada":true}` a `PATCH /api/adopciones/postulaciones/:postulacionId/concretar` o al PATCH de detalle. La API exige `aprobada` y confirma el estado con una escritura condicional. Antes de guardar, solicita el cambio de tutor a M1 con `PATCH /api/registro/animales/:animalId/tutor`. Si M1 falla, se responde 503 con un mensaje controlado.

El índice de exclusividad de adopción usa un filtro parcial con `$in`. Usar MongoDB 6.0 o posterior con replica set o Atlas. Si el índice rechaza datos existentes, el equipo debe revisar las postulaciones aprobadas o concretadas duplicadas antes de desplegar.

`GET /salud` informa disponibilidad HTTP del proceso. La verificación de Núcleo, Registro y almacenamiento se realiza mediante pruebas de sus rutas.

[Pruebas y evidencias de verificación](docs/verificacion-adopciones.md)



## Controles de seguridad (OWASP)



| Categoría OWASP | Control aplicado | Ubicación en código | Verificación |

| --- | --- | --- | --- |

| Broken Access Control | Verificación de sesión y rol `funcionario` antes de aprobar o concretar (`403 ACCESO_DENEGADO` para `vecino`). | `src/app.js`, `requiereFuncionario` y registro de PATCH | `npm test` |

| Broken Authentication | Validación de encabezado `Bearer` y consulta de sesión activa en el núcleo (`401 TOKEN_REQUERIDO` / `TOKEN_INVALIDO`). | `src/app.js` y `src/nucleo.js` | `npm test` |

| Security Misconfiguration | Cabecera `X-Powered-By` deshabilitada, `Cache-Control: no-store` en sesión y manejo de `400 JSON_INVALIDO` / `413 CUERPO_DEMASIADO_GRANDE` / `500 ERROR_INTERNO`. | `src/app.js` | `npm test` |
