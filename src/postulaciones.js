const VIVIENDAS = ['casa', 'departamento', 'otra'];
const ESTADOS_ANIMAL = ['registrado', 'con_microchip', 'inscrito', 'fallecido'];
const APTOS = ['con_microchip', 'inscrito'];
const ESTADOS_POSTULACION = [
  'recibida', 'en_evaluacion', 'en_evaluación', 'aprobada',
  'rechazada', 'cancelada', 'adopcion_concretada',
];

export const RUTA_POSTULACIONES = '/api/adopciones/postulaciones';

const CONFLICTOS = {
  POSTULACION_DUPLICADA: 'Ya existe una postulación tuya para este animal',
  LIMITE_POSTULACIONES: 'Ya tienes el máximo de dos postulaciones activas',
};

function sanitizarParaVecino(documento) {
  const { inhabilidades, evaluadorRut, ...vistaVecino } = documento;
  return vistaVecino;
}

export function crearPostulacion({ consultarNucleo, consultarRegistro, tokenRegistro, guardar, error }) {
  return async (req, res) => {
    const {
      postulanteRut, animalID, viviendaTipo, tienePatio, hayNinos,
      tieneOtrasMascotas, motivoAdopcion, consentimientoCohabitantes,
    } = req.body ?? {};
    if (typeof postulanteRut !== 'string' || !/^\d{1,8}-[\dK]$/i.test(postulanteRut)) {
      return error(res, 400, 'RUT_INVALIDO', 'Indica el RUT del postulante sin puntos y con guión');
    }
    const rut = req.usuario.rut.toUpperCase();
    if (postulanteRut.toUpperCase() !== rut) {
      return error(res, 403, 'RUT_NO_COINCIDE', 'Solo puedes postular con tu propio RUT');
    }
    if (typeof animalID !== 'string' || !/^[a-z\d][a-z\d_-]{0,79}$/i.test(animalID) ||
        !VIVIENDAS.includes(viviendaTipo) ||
        [tienePatio, hayNinos, tieneOtrasMascotas].some(valor => typeof valor !== 'boolean') ||
        typeof motivoAdopcion !== 'string' || !motivoAdopcion.trim() ||
        consentimientoCohabitantes !== true) {
      return error(res, 400, 'DATOS_INVALIDOS', 'Revisa el animal, los datos del hogar y el consentimiento obligatorio');
    }
    if (!guardar) {
      return error(res, 503, 'SERVICIO_NO_DISPONIBLE', 'El almacenamiento de postulaciones no está disponible');
    }

    const usuarioAuth = req.get('Authorization');
    const animal = await consultarRegistro(`/api/registro/animales/${encodeURIComponent(animalID)}`, {
      headers: { Authorization: tokenRegistro ? `Bearer ${tokenRegistro}` : usuarioAuth },
    });
    if (animal.estado === 404 && animal.datos?.error?.codigo === 'ANIMAL_NO_ENCONTRADO') {
      return error(res, 404, 'ANIMAL_NO_ENCONTRADO', 'El animal no existe en el registro');
    }
    if (animal.estado !== 200 || animal.datos?.animalId !== animalID ||
        !ESTADOS_ANIMAL.includes(animal.datos.estado)) {
      return error(res, 503, 'SERVICIO_NO_DISPONIBLE', 'No pudimos comprobar el animal en el registro');
    }
    if (!APTOS.includes(animal.datos.estado) || !animal.datos.microchip) {
      return error(res, 409, 'ANIMAL_NO_DISPONIBLE', 'El animal no está apto para adopción');
    }

    const persona = await consultarNucleo(`/api/nucleo/usuarios/${encodeURIComponent(rut)}`, {
      headers: { Authorization: usuarioAuth },
    });
    if (persona.estado === 401) {
      return error(res, 401, 'TOKEN_INVALIDO', 'El token no es válido o expiró');
    }
    if (persona.estado !== 200 || persona.datos?.rut?.toUpperCase?.() !== rut ||
        typeof persona.datos.prohibicionTenencia !== 'boolean') {
      return error(res, 503, 'SERVICIO_NO_DISPONIBLE', 'No pudimos verificar la prohibición de tenencia');
    }
    if (persona.datos.prohibicionTenencia) {
      return error(res, 409, 'PROHIBICION_TENENCIA', 'Existe una prohibición de tenencia asociada a tu cuenta');
    }

    const { conflicto, documento } = await guardar({
      postulanteRut: rut, animalID, viviendaTipo, tienePatio, hayNinos,
      tieneOtrasMascotas, motivoAdopcion: motivoAdopcion.trim(), consentimientoCohabitantes,
    });
    if (conflicto) return error(res, 409, conflicto, CONFLICTOS[conflicto]);

    return res.location(`${RUTA_POSTULACIONES}/${documento.postulacionID}`)
      .set('Cache-Control', 'no-store').status(201).json(documento);
  };
}

export function listarPostulaciones({ listar, error }) {
  return async (req, res) => {
    const pageParam = req.query.page ?? '1';
    const limitParam = req.query.limit ?? '10';
    const page = Number(pageParam);
    const limit = Number(limitParam);

    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
      return error(res, 400, 'DATOS_INVALIDOS', 'Los parámetros page y limit deben ser enteros positivos (máx. 100)');
    }

    const { estado, postulanteRut } = req.query;
    if (estado !== undefined) {
      if (typeof estado !== 'string' || !ESTADOS_POSTULACION.includes(estado)) {
        return error(res, 400, 'DATOS_INVALIDOS', 'El estado indicado no es válido');
      }
    }

    const rutUsuario = req.usuario.rut.toUpperCase();
    const esVecino = req.usuario.perfil === 'vecino';
    let rutFiltro;

    if (esVecino) {
      if (postulanteRut !== undefined) {
        if (typeof postulanteRut !== 'string' || postulanteRut.toUpperCase() !== rutUsuario) {
          return error(res, 403, 'ACCESO_DENEGADO', 'No tienes permiso para consultar postulaciones de otro RUT');
        }
      }
      rutFiltro = rutUsuario;
    } else if (postulanteRut !== undefined) {
      if (typeof postulanteRut !== 'string' || !/^\d{1,8}-[\dK]$/i.test(postulanteRut)) {
        return error(res, 400, 'RUT_INVALIDO', 'Indica un RUT válido sin puntos y con guión');
      }
      rutFiltro = postulanteRut.toUpperCase();
    }

    if (!listar) {
      return error(res, 503, 'SERVICIO_NO_DISPONIBLE', 'El servicio de consulta no está disponible');
    }

    const resultado = await listar({ postulanteRut: rutFiltro, estado, page, limit });
    const datos = esVecino ? resultado.datos.map(sanitizarParaVecino) : resultado.datos;

    return res.set('Cache-Control', 'no-store').status(200).json({
      page: resultado.page,
      limit: resultado.limit,
      total: resultado.total,
      datos,
    });
  };
}

export function obtenerPostulacion({ obtenerPorId, error }) {
  return async (req, res) => {
    const { postulacionID } = req.params;
    if (typeof postulacionID !== 'string' || !/^[a-z\d]{1,64}$/i.test(postulacionID)) {
      return error(res, 400, 'DATOS_INVALIDOS', 'El identificador de postulación no es válido');
    }

    if (!obtenerPorId) {
      return error(res, 503, 'SERVICIO_NO_DISPONIBLE', 'El servicio de consulta no está disponible');
    }

    const documento = await obtenerPorId(postulacionID);
    if (!documento) {
      return error(res, 404, 'POSTULACION_NO_ENCONTRADA', 'No existe una postulación con ese identificador');
    }

    const esVecino = req.usuario.perfil === 'vecino';
    if (esVecino && documento.postulanteRut?.toUpperCase() !== req.usuario.rut.toUpperCase()) {
      return error(res, 403, 'ACCESO_DENEGADO', 'No tienes permiso para ver esta postulación');
    }

    const respuesta = esVecino ? sanitizarParaVecino(documento) : documento;
    return res.set('Cache-Control', 'no-store').status(200).json(respuesta);
  };
}