import { ObjectId } from 'mongodb';

const ACTIVAS = ['recibida', 'en_evaluación'];

export async function crearRepositorioPostulaciones(cliente) {
  const db = cliente.db('tr_adopciones');
  const postulaciones = db.collection('postulaciones');
  const controles = db.collection('control_postulaciones');
  await postulaciones.createIndex({ postulanteRut: 1, animalID: 1 }, { unique: true });
  await postulaciones.createIndex({ postulanteRut: 1, estado: 1 });

  const guardar = async datos => {
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

  guardar.listar = async ({ postulanteRut, estado, page = 1, limit = 10 }) => {
    const filtro = {};
    if (postulanteRut) filtro.postulanteRut = postulanteRut;
    if (estado) filtro.estado = estado;

    const total = await postulaciones.countDocuments(filtro);
    const datos = await postulaciones
      .find(filtro, { projection: { _id: 0 } })
      .sort({ fechaCreacion: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .toArray();

    return { page, limit, total, datos };
  };

  guardar.obtenerPorId = async postulacionID => {
    return postulaciones.findOne({ postulacionID }, { projection: { _id: 0 } });
  };

  return guardar;
}