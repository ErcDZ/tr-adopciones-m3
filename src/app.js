import express from 'express';
import { fileURLToPath } from 'node:url';
import { crearClienteNucleo } from './nucleo.js';
import { crearPostulacion, RUTA_POSTULACIONES } from './postulaciones.js';
import { listarAnimalesDisponibles, RUTA_ANIMALES_DISPONIBLES } from './animales.js';
import { aprobarPostulacion } from './aprobaciones.js';

const SESIONES = '/api/nucleo/sesiones';

function error(res, estado, codigo, mensaje) {
  return res.status(estado).json({ error: { codigo, mensaje } });
}

function nucleoIndisponible(res) {
  return error(res, 503, 'SERVICIO_NO_DISPONIBLE', 'El núcleo no está disponible');
}

function textoValido(valor) {
  return typeof valor === 'string' && valor.trim().length > 0;
}

function tieneIdentidad(datos) {
  return textoValido(datos?.rut) && textoValido(datos?.perfil);
}

function requierePerfil(perfiles, codigoError = 'PERFIL_NO_AUTORIZADO') {
  const permitidos = Array.isArray(perfiles) ? perfiles : [perfiles];
  return (req, res, next) => {
    if (!permitidos.includes(req.usuario.perfil)) {
      return error(res, 403, codigoError, 'Tu perfil no tiene permiso para esta ruta');
    }
    next();
  };
}

export function crearApp({
  nucleoUrl,
  timeoutMs = 35_000,
  registroUrl = nucleoUrl,
  tokenRegistro,
  guardarPostulacion,
  operacionesAdopcion,
}) {
  const consultarNucleo = crearClienteNucleo(nucleoUrl, timeoutMs);
  const consultarRegistro = crearClienteNucleo(registroUrl || nucleoUrl, timeoutMs);
  const app = express();
  app.disable('x-powered-by');
  app.use(express.static(fileURLToPath(new URL('../public/', import.meta.url))));

  app.post(SESIONES, express.json(), async (req, res) => {
    const { rut, clave } = req.body ?? {};
    if (!textoValido(rut) || !textoValido(clave)) {
      return error(res, 400, 'DATOS_FALTANTES', 'Se requieren rut y clave');
    }

    const { estado, datos } = await consultarNucleo(SESIONES, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rut, clave }),
    });
    if (estado === 401) {
      return error(res, 401, 'CREDENCIALES_INVALIDAS', 'RUT o clave incorrectos');
    }
    if (estado === 400 && datos?.error?.codigo === 'RUT_INVALIDO') {
      return error(res, 400, 'RUT_INVALIDO', 'Usa un RUT sin puntos, con guión y dígito verificador válido');
    }
    if (estado !== 201 || !tieneIdentidad(datos) || !textoValido(datos.token) ||
        !textoValido(datos.nombre) || !textoValido(datos.expira)) {
      return nucleoIndisponible(res);
    }
    const { token, rut: rutConfirmado, perfil, nombre, expira } = datos;
    return res.set('Cache-Control', 'no-store').status(201)
      .json({ token, rut: rutConfirmado, perfil, nombre, expira });
  });

  async function autenticar(req, res, next) {
    const authorization = req.get('Authorization');
    if (!authorization) {
      return error(res, 401, 'TOKEN_REQUERIDO', 'Se requiere un token Bearer');
    }
    if (!/^Bearer +[A-Za-z0-9._~+\/-]+=*$/i.test(authorization)) {
      return error(res, 401, 'TOKEN_INVALIDO', 'El encabezado Bearer no es válido');
    }

    const { estado, datos } = await consultarNucleo(`${SESIONES}/actual`, {
      headers: { Authorization: authorization },
    });
    if (estado === 401) {
      return error(res, 401, 'TOKEN_INVALIDO', 'El token no es válido o expiró');
    }
    if (estado !== 200 || !tieneIdentidad(datos)) {
      return nucleoIndisponible(res);
    }
    req.usuario = { rut: datos.rut, perfil: datos.perfil };
    next();
  }

  function responderUsuario(req, res) {
    res.set('Cache-Control', 'no-store').json(req.usuario);
  }

app.get('/api/adopciones/acceso/vecino', autenticar, requierePerfil('vecino'), responderUsuario);
app.get('/api/adopciones/acceso/funcionario', autenticar, requierePerfil('funcionario'), responderUsuario);
app.post(RUTA_POSTULACIONES, autenticar, requierePerfil('vecino'), express.json(), crearPostulacion({
  consultarNucleo, consultarRegistro, tokenRegistro, guardar: guardarPostulacion, error,
}));

app.patch(
  `${RUTA_POSTULACIONES}/:id`,
  autenticar,
  requierePerfil('funcionario', 'ACCESO_DENEGADO'),
  express.json(),
  (req, res) => aprobarPostulacion({ req, res, operacionesAdopcion, error })
);

app.get(
  RUTA_ANIMALES_DISPONIBLES,
  autenticar,
  requierePerfil('vecino'),
  listarAnimalesDisponibles({ consultarRegistro, tokenRegistro, error })
);

  app.use((req, res) => error(res, 404, 'RUTA_NO_ENCONTRADA', 'La ruta no existe'));

  app.use((fallo, req, res, next) => {
    if (res.headersSent) return next(fallo);
    if (fallo.type === 'entity.parse.failed') {
      return error(res, 400, 'JSON_INVALIDO', 'El cuerpo debe ser JSON válido');
    }
    if (fallo.type === 'entity.too.large') {
      return error(res, 413, 'CUERPO_DEMASIADO_GRANDE', 'El cuerpo excede el tamaño permitido');
    }
    return error(res, 500, 'ERROR_INTERNO', 'Ocurrió un error interno');
  });

  return app;
}
