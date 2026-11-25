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

// Operaciones para la transición aprobada → adopcion_concretada (RN-08).
export async function crearOperacionesAdopcion(cliente) {
  const postulaciones = cliente.db('tr_adopciones').collection('postulaciones');
  // Un animal solo puede tener una adopción concretada.
  await postulaciones.createIndex({ animalID: 1 }, {
    unique: true,
    partialFilterExpression: { estado: 'adopcion_concretada' },
    name: 'animal_adopcion_concretada_unica',
  });

  return {
    obtener: id => postulaciones.findOne({ _id: new ObjectId(id) }, { projection: { _id: 0 } }),
    animalAdoptado: async animalID => Boolean(
      await postulaciones.findOne({ animalID, estado: 'adopcion_concretada' }, { projection: { _id: 1 } }),
    ),
    // Actualización condicional: solo cambia si la postulación sigue en "aprobada".
    concretar: async (id, cambios) => {
      try {
        const documento = await postulaciones.findOneAndUpdate(
          { _id: new ObjectId(id), estado: 'aprobada' },
          { $set: { ...cambios, estado: 'adopcion_concretada' } },
          { returnDocument: 'after', projection: { _id: 0 } },
        );
        return documento ? { documento } : { conflicto: 'TRANSICION_INVALIDA' };
      } catch (fallo) {
        if (fallo.code === 11000) return { conflicto: 'ANIMAL_NO_DISPONIBLE' };
        throw fallo;
      }
    },
  };
}
