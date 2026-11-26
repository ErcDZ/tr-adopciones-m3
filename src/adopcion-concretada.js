const ID_POSTULACION = /^[a-f\d]{24}$/i;
const ESTADO_ORIGEN = 'aprobada';
const ESTADO_DESTINO = 'adopcion_concretada';

const CONFLICTOS = {
  TRANSICION_INVALIDA: `Solo una postulación en estado ${ESTADO_ORIGEN} puede pasar a ${ESTADO_DESTINO}`,
  ANIMAL_NO_DISPONIBLE: 'El animal ya tiene una adopción concretada',
};

// PATCH /api/adopciones/postulaciones/{postulacionId}: transición aprobada → adopcion_concretada (RN-08).
// MongoDB confirma el cambio solo después de que M1 acepta la actualización.
export function concretarAdopcion({ consultarRegistro, operaciones, error }) {
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
    let notificacion;
    let falloRegistro;
    const notificar = documento => {
      // Reusar el resultado si el driver repite el callback de la transacción.
      notificacion ??= actualizarTutor(documento);
      return notificacion;
    };
    async function actualizarTutor(documento) {
      const tutor = await consultarRegistro(`/api/registro/animales/${encodeURIComponent(documento.animalID)}/tutor`, {
        method: 'PATCH',
        headers: {
          Authorization: req.get('Authorization'),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ tutorRut: documento.postulanteRut }),
      });
      if (tutor.estado === 200 && tutor.datos?.animalId === documento.animalID &&
          tutor.datos?.tutorRut === documento.postulanteRut) return;

      const errores = {
        401: [401, 'TOKEN_INVALIDO', 'El token no es válido o expiró'],
        403: [403, 'PERFIL_NO_AUTORIZADO', 'El registro no permite actualizar el tutor'],
        404: [404, 'ANIMAL_NO_ENCONTRADO', 'El animal no existe en el registro'],
        409: [409, 'TUTOR_NO_ACTUALIZADO', 'El registro rechazó el cambio de tutor'],
      };
      falloRegistro = errores[tutor.estado] ?? [
        503, 'SERVICIO_NO_DISPONIBLE', 'No pudimos actualizar el tutor en el registro; la adopción no se concretó',
      ];
      throw new Error('No se confirmó la actualización en M1');
    }

    let resultado;
    try {
      resultado = await operaciones.concretar(postulacionId, postulacion.animalID, {
        retiroFisicoConfirmado: true,
        actaFirmada: true,
        fechaConcrecion: new Date().toISOString(),
        concretadaPor: req.usuario.rut,
      }, notificar);
    } catch {
      if (falloRegistro) return error(res, ...falloRegistro);
      return error(res, 503, 'SERVICIO_NO_DISPONIBLE',
        'No pudimos confirmar la concreción. Consulta el estado antes de reintentar');
    }
    if (resultado.conflicto) {
      return error(res, 409, resultado.conflicto, CONFLICTOS[resultado.conflicto]);
    }
    return res.set('Cache-Control', 'no-store').status(200).json({ datos: resultado.documento });
  };
}
