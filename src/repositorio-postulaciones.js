import { ObjectId } from 'mongodb';

const ACTIVAS = ['recibida', 'en_evaluación'];

export async function crearRepositorioPostulaciones(cliente) {
  const db = cliente.db('tr_adopciones');
  const postulaciones = db.collection('postulaciones');
  const controles = db.collection('control_postulaciones');
  await postulaciones.createIndex({ postulanteRut: 1, animalID: 1 }, { unique: true });
  await postulaciones.createIndex({ postulanteRut: 1, estado: 1 });

  return async datos => {
    const rut = datos.postulanteRut;
    // El documento de control permite serializar las escrituras de un mismo RUT.
    try {
      await controles.updateOne({ _id: rut }, { $setOnInsert: { revision: 0 } }, { upsert: true });
    } catch (fallo) {
      if (fallo.code !== 11000) throw fallo;
    }

    return cliente.withSession(sesion => sesion.withTransaction(async () => {
      await controles.updateOne({ _id: rut }, { $inc: { revision: 1 } }, { session: sesion });
      const duplicada = await postulaciones.findOne({ postulanteRut: rut, animalID: datos.animalID }, {
        session: sesion, projection: { _id: 1 },
      });
      if (duplicada) return { conflicto: 'POSTULACION_DUPLICADA' };
      const total = await postulaciones.countDocuments({ postulanteRut: rut, estado: { $in: ACTIVAS } }, {
        session: sesion, limit: 2,
      });
      if (total >= 2) return { conflicto: 'LIMITE_POSTULACIONES' };
      const id = new ObjectId();
      const documento = {
        ...datos,
        postulacionID: id.toHexString(),
        estado: 'recibida',
        fechaCreacion: new Date().toISOString(),
      };
      await postulaciones.insertOne({ _id: id, ...documento }, { session: sesion });
      return { documento };
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } }));
  };
}

export async function crearOperacionesAdopcion(cliente) {
  const postulaciones = cliente.db('tr_adopciones').collection('postulaciones');
  await postulaciones.createIndex({ animalID: 1 }, {
    name: 'animal_adopcion_exclusiva',
    unique: true,
    partialFilterExpression: { estado: { $in: ['aprobada', 'adopcion_concretada'] } },
  });

  function actualizar(id, origen, cambios, opciones) {
    return postulaciones.findOneAndUpdate(
      { _id: new ObjectId(id), estado: origen },
      { $set: cambios },
      { returnDocument: 'after', projection: { _id: 0 }, ...opciones },
    );
  }

  return {
    obtener: id => postulaciones.findOne({ _id: new ObjectId(id) }, { projection: { _id: 0 } }),
    async iniciarEvaluacion({ postulacionId, aprobadaPor }) {
      const postulacion = await actualizar(postulacionId, 'recibida', {
        estado: 'en_evaluación', evaluadorRut: aprobadaPor, fechaActualizacion: new Date().toISOString(),
      });
      return postulacion ? { postulacion, canceladasParalelas: 0 } : { conflicto: 'TRANSICION_INVALIDA' };
    },
    async aprobarYCancelarParalelas({ postulacionId, animalID, aprobadaPor }) {
      try {
        return await cliente.withSession(sesion => sesion.withTransaction(async () => {
          const fechaActualizacion = new Date().toISOString();
          const postulacion = await actualizar(postulacionId, 'en_evaluación', {
            estado: 'aprobada', aprobadaPor, fechaActualizacion,
          }, { session: sesion });
          if (!postulacion) return { conflicto: 'TRANSICION_INVALIDA' };
          const canceladas = await postulaciones.updateMany(
            { _id: { $ne: new ObjectId(postulacionId) }, animalID, estado: { $in: ACTIVAS } },
            { $set: { estado: 'cancelada', fechaActualizacion, motivoCancelacion: 'Otra postulación fue aprobada' } },
            { session: sesion },
          );
          return { postulacion, canceladasParalelas: canceladas.modifiedCount };
        }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } }));
      } catch (fallo) {
        if (fallo.code === 11000) return { conflicto: 'ANIMAL_NO_DISPONIBLE' };
        throw fallo;
      }
    },
    animalAdoptado: async animalID => Boolean(
      await postulaciones.findOne({ animalID, estado: 'adopcion_concretada' }, { projection: { _id: 1 } }),
    ),
    async concretar(id, cambios) {
      const documento = await actualizar(id, 'aprobada', { ...cambios, estado: 'adopcion_concretada' });
      return documento ? { documento } : { conflicto: 'TRANSICION_INVALIDA' };
    },
  };
}
