export async function aprobarPostulacion({ req, res, operacionesAdopcion, error }) {
  const id = String(req.params?.id ?? '').trim();
  if (!id) {
    return error(res, 404, 'POSTULACION_NO_ENCONTRADA', 'Postulación no encontrada');
  }

  if (!operacionesAdopcion) {
    return error(res, 503, 'SERVICIO_NO_DISPONIBLE', 'El almacenamiento de postulaciones no está disponible');
  }

  if (typeof operacionesAdopcion.aprobarPostulacion === 'function') {
    const resultado = await operacionesAdopcion.aprobarPostulacion(id, req.usuario);
    if (!resultado) {
      return error(res, 404, 'POSTULACION_NO_ENCONTRADA', 'Postulación no encontrada');
    }
    if (resultado.error) {
      return error(res, resultado.estado ?? 409, resultado.error.codigo, resultado.error.mensaje);
    }
    return res.set('Cache-Control', 'no-store').status(200).json(resultado);
  }

  const docs = operacionesAdopcion.docs;
  if (!docs || typeof docs.get !== 'function') {
    return error(res, 503, 'SERVICIO_NO_DISPONIBLE', 'El almacenamiento de postulaciones no está disponible');
  }

  const actual = docs.get(id);
  if (!actual) {
    return error(res, 404, 'POSTULACION_NO_ENCONTRADA', 'Postulación no encontrada');
  }

  const aprobada = {
    ...actual,
    estado: 'aprobada',
    revisadoPor: req.usuario.rut,
    fechaResolucion: new Date().toISOString(),
  };
  docs.set(id, aprobada);

  let canceladasParalelas = 0;
  for (const [docId, doc] of docs.entries()) {
    if (docId !== id && doc?.animalID === actual.animalID && doc?.estado !== 'aprobada') {
      docs.set(docId, {
        ...doc,
        estado: 'cancelada',
        motivoCancelacion: 'ANIMAL_APROBADO_OTRO_POSTULANTE',
        fechaResolucion: new Date().toISOString(),
      });
      canceladasParalelas += 1;
    }
  }

  return res.set('Cache-Control', 'no-store').status(200).json({
    postulacion: aprobada,
    canceladasParalelas,
  });
}