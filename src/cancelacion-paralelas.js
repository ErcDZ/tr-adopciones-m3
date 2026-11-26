import { RUTA_POSTULACIONES } from './postulaciones.js';

export const RUTA_POSTULACION_DETALLE = `${RUTA_POSTULACIONES}/:postulacionId`;

const ID_HEX_24 = /^[a-f\d]{24}$/i;
const EN_EVALUACION = 'en_evaluación';

export function aprobarYCancelarParalelas({ operaciones, error }) {
  return async (req, res) => {
    const { postulacionId } = req.params;

    if (!ID_HEX_24.test(postulacionId)) {
      return error(res, 400, 'ID_INVALIDO', 'El identificador de la postulación no es válido');
    }
    const estado = req.body?.estado ?? 'aprobada';
    const destino = estado === 'en_evaluacion' ? EN_EVALUACION : estado;
    if (![EN_EVALUACION, 'aprobada'].includes(destino)) {
      return error(res, 409, 'TRANSICION_INVALIDA', 'El cambio de estado solicitado no está permitido');
    }

    if (!operaciones || typeof operaciones.obtener !== 'function' || typeof operaciones.aprobarYCancelarParalelas !== 'function') {
      return error(res, 503, 'SERVICIO_NO_DISPONIBLE', 'El servicio de postulaciones no está disponible');
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
    const origen = destino === EN_EVALUACION ? 'recibida' : EN_EVALUACION;
    if (postulacion.estado !== origen) {
      return error(res, 409, 'TRANSICION_INVALIDA', 'El cambio de estado solicitado no está permitido');
    }

    try {
      const cambiar = destino === EN_EVALUACION ? operaciones.iniciarEvaluacion : operaciones.aprobarYCancelarParalelas;
      if (!cambiar) return error(res, 503, 'SERVICIO_NO_DISPONIBLE', 'El servicio de postulaciones no está disponible');
      const resultado = await cambiar({
        postulacionId,
        animalID: postulacion.animalID,
        aprobadaPor: req.usuario.rut,
      });
      if (resultado.conflicto) {
        return error(res, 409, resultado.conflicto, 'El estado de la postulación o del animal impide el cambio');
      }
      return res.set('Cache-Control', 'no-store').status(200).json(resultado);
    } catch {
      return error(res, 503, 'SERVICIO_NO_DISPONIBLE', 'No pudimos aprobar la postulación');
    }
  };
}
