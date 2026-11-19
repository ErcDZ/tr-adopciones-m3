
import express from 'express';
import { fileURLToPath } from 'node:url';
import { crearClienteNucleo } from './nucleo.js';
import { crearPostulacion, RUTA_POSTULACIONES } from './postulaciones.js';

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

function requierePerfil(...perfiles) {
  return (req, res, next) => {
    if (!perfiles.includes(req.usuario.perfil)) {
      return error(res, 403, 'PERFIL_NO_AUTORIZADO', 'Tu perfil no tiene permiso para esta ruta');
    }
    next();
  };
}

export function crearApp({ nucleoUrl, timeoutMs = 35_000, registroUrl = nucleoUrl, tokenRegistro, guardarPostulacion }) {
  const consultarNucleo = crearClienteNucleo(nucleoUrl, timeoutMs);
  const consultarRegistro = crearClienteNucleo(registroUrl, timeoutMs);
  const app = express();

  app.disable('x-powered-by');
  app.use(express.static(fileURLToPath(new URL('../public/', import.meta.url))));

  // INICIO DE SESION
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

    if (estado !== 201 || !tieneIdentidad(datos) ||
        !textoValido(datos.token) || !textoValido(datos.nombre) ||
        !textoValido(datos.expira)) {
      return nucleoIndisponible(res);
    }

    const { token, rut: rutConfirmado, perfil, nombre, expira } = datos;

    return res.set('Cache-Control', 'no-store').status(201)
      .json({ token, rut: rutConfirmado, perfil, nombre, expira });
  });

  // VALIDAR TOKEN CON EL NUCLEO
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

  app.get('/api/adopciones/acceso/vecino',
    autenticar, requierePerfil('vecino'), responderUsuario);

  app.get('/api/adopciones/acceso/funcionario',
    autenticar, requierePerfil('funcionario'), responderUsuario);

  // REGISTRAR UNA POSTULACION
  app.post(RUTA_POSTULACIONES,
    autenticar,
    requierePerfil('vecino'),
    express.json(),
    crearPostulacion({
      consultarNucleo,
      consultarRegistro,
      tokenRegistro,
      guardar: guardarPostulacion,
      error,
    })
  );

  // TAREA 54: LISTAR POSTULACIONES DEL PROPIO RUT
  app.get(RUTA_POSTULACIONES,
    autenticar,
    requierePerfil('vecino'),
    async (req, res) => {
      const rutSolicitado = req.query.postulanteRut;
      const rutToken = req.usuario.rut.toUpperCase();

      if (typeof rutSolicitado !== 'string' || !rutSolicitado.trim()) {
        return error(res, 400, 'DATO_INVALIDO', 'Debes indicar postulanteRut');
      }

      // Bloqueamos las consultas a otro RUT
      if (rutSolicitado.toUpperCase() !== rutToken) {
        return error(res, 403, 'ACCESO_DENEGADO',
          'No puedes consultar postulaciones de otro usuario');
      }

      const page = req.query.page === undefined ? 1 : Number(req.query.page);
      const limit = req.query.limit === undefined ? 10 : Number(req.query.limit);

      if (!Number.isSafeInteger(page) || page < 1 ||
          !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
        return error(res, 400, 'DATO_INVALIDO', 'Página o límite incorrecto');
      }

      if (!guardarPostulacion?.listar) {
        return error(res, 503, 'SERVICIO_NO_DISPONIBLE', 'MongoDB no está disponible');
      }

      try {
        const resultado = await guardarPostulacion.listar(rutToken, page, limit);

        return res.set('Cache-Control', 'no-store').status(200).json({
          datos: resultado.datos,
          total: resultado.total,
          page: resultado.pagina,
          limit: resultado.limite,
        });
      } catch {
        return error(res, 503, 'SERVICIO_NO_DISPONIBLE',
          'No se pudieron consultar las postulaciones');
      }
    }
  );

  // TAREA 54: CONSULTAR UNA POSTULACION POR SU ID
  app.get(`${RUTA_POSTULACIONES}/:postulacionId`,
    autenticar,
    requierePerfil('vecino'),
    async (req, res) => {
      if (!guardarPostulacion?.buscarPorId) {
        return error(res, 503, 'SERVICIO_NO_DISPONIBLE',
          'MongoDB no está disponible');
      }

      const id = req.params.postulacionId;

      if (!/^[0-9a-f]{24}$/i.test(id)) {
        return error(res, 404, 'POSTULACION_NO_ENCONTRADA',
          'La postulación no existe');
      }

      try {
        const postulacion = await guardarPostulacion.buscarPorId(id);

        if (!postulacion) {
          return error(res, 404, 'POSTULACION_NO_ENCONTRADA',
            'La postulación no existe');
        }

        // Comparamos el dueño de la postulación con el token
        if (postulacion.postulanteRut?.toUpperCase() !==
            req.usuario.rut.toUpperCase()) {
          return error(res, 403, 'ACCESO_DENEGADO',
            'No puedes consultar una postulación de otro usuario');
        }

        return res.set('Cache-Control', 'no-store')
          .status(200).json({ datos: postulacion });
      } catch {
        return error(res, 503, 'SERVICIO_NO_DISPONIBLE',
          'No se pudo consultar la postulación');
      }
    }
  );

  app.use((req, res) =>
    error(res, 404, 'RUTA_NO_ENCONTRADA', 'La ruta no existe')
  );

  app.use((fallo, req, res, next) => {
    if (res.headersSent) return next(fallo);

    if (fallo.type === 'entity.parse.failed') {
      return error(res, 400, 'JSON_INVALIDO', 'El cuerpo debe ser JSON válido');
    }

    if (fallo.type === 'entity.too.large') {
      return error(res, 413, 'CUERPO_DEMASIADO_GRANDE',
        'El cuerpo excede el tamaño permitido');
    }

    return error(res, 500, 'ERROR_INTERNO', 'Ocurrió un error interno');
  });

  return app;
}
