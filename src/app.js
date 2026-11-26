
import express from 'express';
import { fileURLToPath } from 'node:url';
import { crearClienteNucleo } from './nucleo.js';
import { crearPostulacion, RUTA_POSTULACIONES } from './postulaciones.js';
import { listarAnimalesDisponibles, RUTA_ANIMALES_DISPONIBLES } from './animales.js';
import { concretarAdopcion } from './adopcion-concretada.js';

const SESIONES = '/api/nucleo/sesiones';

function error(res, estado, codigo, mensaje) {
  return res.status(estado).json({
    error: { codigo, mensaje }
  });
}

function nucleoIndisponible(res) {
  return error(res, 503, 'SERVICIO_NO_DISPONIBLE',
    'El núcleo no está disponible');
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
      return error(res, 403, 'PERFIL_NO_AUTORIZADO',
        'No tienes permiso para esta ruta');
    }
    next();
  };
}

export function crearApp({
  nucleoUrl,
  timeoutMs = 35000,
  registroUrl = nucleoUrl,
  tokenRegistro,
  guardarPostulacion
}) {
  const consultarNucleo = crearClienteNucleo(nucleoUrl, timeoutMs);
  const consultarRegistro = crearClienteNucleo(registroUrl, timeoutMs);
  const app = express();

  app.disable('x-powered-by');
  app.use(express.static(fileURLToPath(new URL('../public/', import.meta.url))));

  // INICIO DE SESION
  app.post(SESIONES, express.json(), async (req, res) => {
    const { rut, clave } = req.body ?? {};

    if (!textoValido(rut) || !textoValido(clave)) {
      return error(res, 400, 'DATOS_FALTANTES',
        'Se requieren rut y clave');
    }

    const { estado, datos } = await consultarNucleo(SESIONES, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rut, clave })
    });

    if (estado === 401) {
      return error(res, 401, 'CREDENCIALES_INVALIDAS',
        'RUT o clave incorrectos');
    }

    if (estado === 400 && datos?.error?.codigo === 'RUT_INVALIDO') {
      return error(res, 400, 'RUT_INVALIDO',
        'El RUT no es válido');
    }

    if (estado !== 201 || !tieneIdentidad(datos) ||
        !textoValido(datos.token) ||
        !textoValido(datos.nombre) ||
        !textoValido(datos.expira)) {
      return nucleoIndisponible(res);
    }

    const { token, rut: rutConfirmado, perfil, nombre, expira } = datos;

    return res.set('Cache-Control', 'no-store')
      .status(201).json({
        token,
        rut: rutConfirmado,
        perfil,
        nombre,
        expira
      });
  });

  // VALIDAR TOKEN CON EL NUCLEO
  async function autenticar(req, res, next) {
    const authorization = req.get('Authorization');

    if (!authorization) {
      return error(res, 401, 'TOKEN_REQUERIDO',
        'Se requiere un token Bearer');
    }

    if (!/^Bearer +[A-Za-z0-9._~+\/-]+=*$/i.test(authorization)) {
      return error(res, 401, 'TOKEN_INVALIDO',
        'El token no es válido');
    }

    const { estado, datos } = await consultarNucleo(
      `${SESIONES}/actual`,
      { headers: { Authorization: authorization } }
    );

    if (estado === 401) {
      return error(res, 401, 'TOKEN_INVALIDO',
        'El token expiró o no es válido');
    }

    if (estado !== 200 || !tieneIdentidad(datos)) {
      return nucleoIndisponible(res);
    }

    req.usuario = {
      rut: datos.rut,
      perfil: datos.perfil
    };

    next();
  }

  function responderUsuario(req, res) {
    return res.set('Cache-Control', 'no-store')
      .json(req.usuario);
  }

  app.get('/api/adopciones/acceso/vecino',
    autenticar, requierePerfil('vecino'), responderUsuario);

  app.get('/api/adopciones/acceso/funcionario',
    autenticar, requierePerfil('funcionario'), responderUsuario);

  app.get([RUTA_ANIMALES_DISPONIBLES, '/api/adopciones/catalogo'],
    autenticar,
    requierePerfil('vecino', 'funcionario'),
    listarAnimalesDisponibles({ consultarRegistro, tokenRegistro, error })
  );

  // CREAR POSTULACION - SPRINT 3
  app.post(RUTA_POSTULACIONES,
    autenticar,
    requierePerfil('vecino'),
    express.json(),
    crearPostulacion({
      consultarNucleo,
      consultarRegistro,
      tokenRegistro,
      guardar: guardarPostulacion,
      error
    })
  );

  // LISTADO DE POSTULACIONES
  // Vecino: solo sus solicitudes
  // Funcionario: todas las solicitudes
  app.get(RUTA_POSTULACIONES,
    autenticar,
    requierePerfil('vecino', 'funcionario'),
    async (req, res) => {
      const page = req.query.page === undefined
        ? 1 : Number(req.query.page);

      const limit = req.query.limit === undefined
        ? 10 : Number(req.query.limit);

      if (!Number.isSafeInteger(page) || page < 1 ||
          !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
        return error(res, 400, 'DATO_INVALIDO',
          'Página o límite incorrecto');
      }

      const esFuncionario = req.usuario.perfil === 'funcionario';
      const rutToken = req.usuario.rut.toUpperCase();

      if (!esFuncionario) {
        const rutSolicitado = req.query.postulanteRut;

        if (typeof rutSolicitado !== 'string' ||
            !rutSolicitado.trim()) {
          return error(res, 400, 'DATO_INVALIDO',
            'Debes indicar postulanteRut');
        }

        if (rutSolicitado.toUpperCase() !== rutToken) {
          return error(res, 403, 'ACCESO_DENEGADO',
            'No puedes consultar postulaciones de otro usuario');
        }
      }

      if (!guardarPostulacion) {
        return error(res, 503, 'SERVICIO_NO_DISPONIBLE',
          'MongoDB no está disponible');
      }

      try {
        let resultado;

        if (esFuncionario) {
          if (!guardarPostulacion.listarTodas) {
            return error(res, 503, 'SERVICIO_NO_DISPONIBLE',
              'El listado no está disponible');
          }

          resultado = await guardarPostulacion.listarTodas(page, limit);
        } else {
          if (!guardarPostulacion.listar) {
            return error(res, 503, 'SERVICIO_NO_DISPONIBLE',
              'El listado no está disponible');
          }

          resultado = await guardarPostulacion.listar(
            rutToken, page, limit
          );
        }

        return res.set('Cache-Control', 'no-store')
          .status(200).json({
            datos: resultado.datos,
            total: resultado.total,
            page: resultado.pagina,
            limit: resultado.limite
          });

      } catch {
        return error(res, 503, 'SERVICIO_NO_DISPONIBLE',
          'No se pudieron consultar las postulaciones');
      }
    }
  );

  // CONSULTAR UNA POSTULACION POR ID
  app.get(`${RUTA_POSTULACIONES}/:postulacionId`,
    autenticar,
    requierePerfil('vecino', 'funcionario'),
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

        if (req.usuario.perfil === 'vecino' &&
            postulacion.postulanteRut?.toUpperCase() !==
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

  // TAREA 60: CONSULTAR INHABILIDADES DEL POSTULANTE
  // Solo para funcionarios autenticados
  app.get('/api/adopciones/funcionarios/usuarios/:rut',
    autenticar,
    requierePerfil('funcionario'),
    async (req, res) => {
      const rut = req.params.rut.toUpperCase();

      if (!/^\d{1,8}-[\dK]$/i.test(rut)) {
        return error(res, 400, 'DATO_INVALIDO',
          'El RUT no tiene un formato válido');
      }

      try {
        const { estado, datos } = await consultarNucleo(
          `/api/nucleo/usuarios/${encodeURIComponent(rut)}`,
          {
            headers: {
              Authorization: req.get('Authorization')
            }
          }
        );

        if (estado === 404) {
          return error(res, 404, 'USUARIO_NO_ENCONTRADO',
            'El usuario no existe');
        }

        if (estado === 401 || estado === 403) {
          return error(res, estado, 'ACCESO_DENEGADO',
            'El núcleo no autorizó la consulta');
        }

        if (estado !== 200 ||
            typeof datos?.prohibicionTenencia !== 'boolean') {
          return nucleoIndisponible(res);
        }

        return res.set('Cache-Control', 'no-store')
          .status(200).json({
            datos: {
              rut,
              nombre: datos.nombre ?? '',
              prohibicionTenencia: datos.prohibicionTenencia
            }
          });

      } catch {
        return nucleoIndisponible(res);
      }
    }
  );

  const concretar = concretarAdopcion({
    consultarRegistro, operaciones: guardarPostulacion?.operacionesConcrecion, error,
  });

  // TAREA 59: FUNCIONARIO CAMBIA ESTADO
  app.patch(`${RUTA_POSTULACIONES}/:postulacionId`,
    autenticar,
    requierePerfil('funcionario'),
    express.json(),
    async (req, res) => {
      if (req.body?.estado === 'adopcion_concretada') return concretar(req, res);
      const id = req.params.postulacionId;
      const { estado, observaciones } = req.body ?? {};

      if (!/^[0-9a-f]{24}$/i.test(id)) {
        return error(res, 404, 'POSTULACION_NO_ENCONTRADA',
          'La postulación no existe');
      }

      const permitidos = ['en_evaluación', 'aprobada', 'rechazada'];

      if (!permitidos.includes(estado)) {
        return error(res, 400, 'DATO_INVALIDO',
          'El estado solicitado no es válido');
      }

      if (typeof observaciones !== 'string' ||
          !observaciones.trim() || observaciones.length > 1000) {
        return error(res, 400, 'DATO_INVALIDO',
          'Debes ingresar observaciones válidas');
      }

      if (!guardarPostulacion?.cambiarEstado) {
        return error(res, 503, 'SERVICIO_NO_DISPONIBLE',
          'MongoDB no está disponible');
      }

      try {
        const resultado = await guardarPostulacion.cambiarEstado(
          id,
          estado,
          observaciones.trim(),
          req.usuario.rut
        );

        if (resultado.noExiste) {
          return error(res, 404, 'POSTULACION_NO_ENCONTRADA',
            'La postulación no existe');
        }

        if (resultado.conflicto === 'TRANSICION_INVALIDA') {
          return error(res, 409, 'TRANSICION_INVALIDA',
            'No puedes realizar ese cambio de estado');
        }

        if (resultado.conflicto === 'ANIMAL_YA_ADOPTADO') {
          return error(res, 409, 'ANIMAL_YA_ADOPTADO',
            'Este animal ya tiene una postulación aprobada');
        }

        return res.set('Cache-Control', 'no-store')
          .status(200).json({
            datos: resultado.documento,
            canceladas: resultado.canceladas
          });

      } catch {
        return error(res, 503, 'SERVICIO_NO_DISPONIBLE',
          'No se pudo actualizar la postulación');
      }
    }
  );

  // RUTAS NO EXISTENTES
  app.use((req, res) =>
    error(res, 404, 'RUTA_NO_ENCONTRADA', 'La ruta no existe')
  );

  // CONTROL DE ERRORES
  app.use((fallo, req, res, next) => {
    if (res.headersSent) return next(fallo);

    if (fallo.type === 'entity.parse.failed') {
      return error(res, 400, 'JSON_INVALIDO',
        'El cuerpo debe ser JSON válido');
    }

    if (fallo.type === 'entity.too.large') {
      return error(res, 413, 'CUERPO_DEMASIADO_GRANDE',
        'El cuerpo excede el tamaño permitido');
    }

    return error(res, 500, 'ERROR_INTERNO',
      'Ocurrió un error interno');
  });

  return app;
}
