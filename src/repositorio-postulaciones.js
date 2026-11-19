
import { ObjectId } from 'mongodb';

const ACTIVAS = ['recibida', 'en_evaluación'];

export async function crearRepositorioPostulaciones(cliente) {
  const db = cliente.db('tr_adopciones');
  const postulaciones = db.collection('postulaciones');
  const controles = db.collection('control_postulaciones');

  await postulaciones.createIndex(
    { postulanteRut: 1, animalID: 1 },
    { unique: true }
  );

  await postulaciones.createIndex({ postulanteRut: 1, estado: 1 });

  // Guardar postulaciones
  async function guardar(datos) {
    const rut = datos.postulanteRut;

    try {
      await controles.updateOne(
        { _id: rut },
        { $setOnInsert: { revision: 0 } },
        { upsert: true }
      );
    } catch (fallo) {
      if (fallo.code !== 11000) throw fallo;
    }

    return cliente.withSession(sesion => sesion.withTransaction(async () => {
      await controles.updateOne(
        { _id: rut },
        { $inc: { revision: 1 } },
        { session: sesion }
      );

      const duplicada = await postulaciones.findOne(
        { postulanteRut: rut, animalID: datos.animalID },
        { session: sesion, projection: { _id: 1 } }
      );

      if (duplicada) {
        return { conflicto: 'POSTULACION_DUPLICADA' };
      }

      const total = await postulaciones.countDocuments(
        { postulanteRut: rut, estado: { $in: ACTIVAS } },
        { session: sesion, limit: 2 }
      );

      if (total >= 2) {
        return { conflicto: 'LIMITE_POSTULACIONES' };
      }

      const id = new ObjectId();

      const documento = {
        ...datos,
        postulacionID: id.toHexString(),
        estado: 'recibida',
        fechaCreacion: new Date().toISOString()
      };

      await postulaciones.insertOne(
        { _id: id, ...documento },
        { session: sesion }
      );

      return { documento };
    }, {
      readConcern: { level: 'snapshot' },
      writeConcern: { w: 'majority' }
    }));
  }

  // Listar las postulaciones de un RUT
  guardar.listar = async (rut, pagina = 1, limite = 10) => {
    const filtro = { postulanteRut: rut };

    const total = await postulaciones.countDocuments(filtro);

    const datos = await postulaciones.find(
      filtro,
      { projection: { _id: 0 } }
    )
      .sort({ fechaCreacion: -1 })
      .skip((pagina - 1) * limite)
      .limit(limite)
      .toArray();

    return { datos, total, pagina, limite };
  };

  // Buscar una postulación por su identificador
  guardar.buscarPorId = async id => {
    if (!/^[0-9a-f]{24}$/i.test(id)) {
      return null;
    }

    return postulaciones.findOne(
      { _id: new ObjectId(id) },
      { projection: { _id: 0 } }
    );
  };

  return guardar;
}
