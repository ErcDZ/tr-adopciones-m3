import { RUTA_POSTULACIONES } from './postulaciones.js';

export const RUTA_POSTULACION = `${RUTA_POSTULACIONES}/:postulacionId`;

const ID_POSTULACION = /^[a-f\d]{24}$/i;
const ESTADO_ORIGEN = 'aprobada';
const ESTADO_DESTINO = 'adopcion_concretada';

const CONFLICTOS = {
  TRANSICION_INVALIDA: `Solo una postulación en estado ${ESTADO_ORIGEN} puede pasar a ${ESTADO_DESTINO}`,
  ANIMAL_NO_DISPONIBLE: 'El animal ya tiene una adopción concretada',
};

// PATCH /api/adopciones/postulaciones/{postulacionId}: transición aprobada → adopcion_concretada (RN-08).
// Orden: validar entrada → leer postulación → validar estado y confirmaciones → notificar a M1 →
// confirmar en MongoDB. Si M1 falla, no se escribe nada en MongoDB.
export function concretarAdopcion({ consultarRegistro, tokenRegistro, operaciones, error }) {
  return async (req, res) => {
    const { postulacionId } = req.params;
    const { estado, retiroFisicoConfirmado, actaFirmada } = req.body ?? {};

    if (!ID_POSTULACION.test(postulacionId)) {
      return error(res, 400, 'ID_INVALIDO', 'El identificador de la postulación no es válido');
    }
    if (typeof estado !== 'string' || !estado.trim()) {
      return error(res, 400, 'DATOS_INVALIDOS', 'Indica el estado destino de la postulación');
    }
    if (estado !== ESTADO_DESTINO) {
      return error(res, 409, 'TRANSICION_INVALIDA', `Esta ruta solo admite la transición a ${ESTADO_DESTINO}`);
    }
    if (typeof retiroFisicoConfirmado !== 'boolean' || typeof actaFirmada !== 'boolean') {
      return error(res, 400, 'DATOS_INVALIDOS', 'Indica retiroFisicoConfirmado y actaFirmada como booleanos');
    }
    if (!operaciones) {
      return error(res, 503, 'SERVICIO_NO_DISPONIBLE', 'El almacenamiento de postulaciones no está disponible');
    }

    let postulacion;
    try {
      postulacion = await operaciones.obtener(postulacionId);
    } catch {
      return error(res, 503, 'SERVICIO_NO_DISPONIBLE', 'No pudimos consultar la postulación');
    }
    if (!postulacion) {
      return error(res, 404, 'POSTULACION_NO_ENCONTRADA', 'La postulación no existe');
    }
    if (postulacion.estado !== ESTADO_ORIGEN) {
      return error(res, 409, 'TRANSICION_INVALIDA', CONFLICTOS.TRANSICION_INVALIDA);
    }
    if (!retiroFisicoConfirmado || !actaFirmada) {
      return error(res, 409, 'CONFIRMACION_REQUERIDA',
        'Debe confirmarse el retiro físico del animal y la firma del acta de compromiso');
    }
    try {
      if (await operaciones.animalAdoptado(postulacion.animalID)) {
        return error(res, 409, 'ANIMAL_NO_DISPONIBLE', CONFLICTOS.ANIMAL_NO_DISPONIBLE);
      }
    } catch {
      return error(res, 503, 'SERVICIO_NO_DISPONIBLE', 'No pudimos comprobar el estado del animal');
    }

    // Notificar al módulo 1 ANTES de confirmar en MongoDB.
    const tutor = await consultarRegistro(`/api/registro/animales/${encodeURIComponent(postulacion.animalID)}/tutor`, {
      method: 'PATCH',
      headers: {
        Authorization: tokenRegistro ? `Bearer ${tokenRegistro}` : req.get('Authorization'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ postulanteRut: postulacion.postulanteRut }),
    });
    if (tutor.estado === 404 && tutor.datos?.error?.codigo === 'ANIMAL_NO_ENCONTRADO') {
      return error(res, 404, 'ANIMAL_NO_ENCONTRADO', 'El animal no existe en el registro');
    }
    if (tutor.estado !== 200) {
      // Bloqueo de la transición: la postulación sigue en "aprobada".
      return error(res, 503, 'SERVICIO_NO_DISPONIBLE',
        'No pudimos actualizar el tutor en el registro; la adopción no se concretó');
    }

    let resultado;
    try {
      resultado = await operaciones.concretar(postulacionId, {
        retiroFisicoConfirmado: true,
        actaFirmada: true,
        fechaConcrecion: new Date().toISOString(),
        concretadaPor: req.usuario.rut,
      });
    } catch {
      return error(res, 503, 'SERVICIO_NO_DISPONIBLE',
        'El registro fue notificado, pero no pudimos guardar el cambio. Reintenta la operación');
    }
    if (resultado.conflicto) {
      return error(res, 409, resultado.conflicto, CONFLICTOS[resultado.conflicto]);
    }
    return res.set('Cache-Control', 'no-store').status(200).json(resultado.documento);
  };
}
