import { RUTA_POSTULACIONES } from './postulaciones.js';

export const RUTA_POSTULACION_DETALLE = `${RUTA_POSTULACIONES}/:postulacionId`;

const ID_HEX_24 = /^[a-f\d]{24}$/i;

export function aprobarYCancelarParalelas({ operaciones, error }) {
  return async (req, res) => {
    const { postulacionId } = req.params;

    if (!ID_HEX_24.test(postulacionId)) {
      return error(res, 400, 'ID_INVALIDO', 'El identificador de la postulación no es válido');
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

    try {
      const resultado = await operaciones.aprobarYCancelarParalelas({
        postulacionId,
        animalID: postulacion.animalID,
        aprobadaPor: req.usuario.rut,
      });
      return res.set('Cache-Control', 'no-store').status(200).json(resultado);
    } catch {
      return error(res, 503, 'SERVICIO_NO_DISPONIBLE', 'No pudimos aprobar la postulación');
    }
  };
}