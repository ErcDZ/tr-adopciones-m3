
import { ObjectId } from 'mongodb';

const ACTIVAS = ['recibida', 'en_evaluación'];

export async function crearRepositorioPostulaciones(cliente) {
  const db = cliente.db('tr_adopciones');
  const postulaciones = db.collection('postulaciones');
  const controles = db.collection('control_postulaciones');
  const controlesAnimales = db.collection('control_animales');

  await postulaciones.createIndex(
    { postulanteRut: 1, animalID: 1 },
    { unique: true }
  );

  await postulaciones.createIndex({ postulanteRut: 1, estado: 1 });
  await postulaciones.createIndex({ animalID: 1, estado: 1 });

  // GUARDAR POSTULACIONES
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

    return cliente.withSession(sesion =>
      sesion.withTransaction(async () => {
        await controles.updateOne(
          { _id: rut },
          { $inc: { revision: 1 } },
          { session: sesion }
        );

        const duplicada = await postulaciones.findOne(
          { postulanteRut: rut, animalID: datos.animalID },
          { session: sesion }
        );

        if (duplicada) {
          return { conflicto: 'POSTULACION_DUPLICADA' };
        }

        const total = await postulaciones.countDocuments(
          {
            postulanteRut: rut,
            estado: { $in: ACTIVAS }
          },
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
      })
    );
  }

  // LISTADO DE POSTULACIONES DEL VECINO
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

  // TAREA 60: LISTADO GLOBAL PARA FUNCIONARIOS
  guardar.listarTodas = async (pagina = 1, limite = 10) => {
    const total = await postulaciones.countDocuments({});

    const datos = await postulaciones.find(
      {},
      { projection: { _id: 0 } }
    )
      .sort({ fechaCreacion: -1 })
      .skip((pagina - 1) * limite)
      .limit(limite)
      .toArray();

    return { datos, total, pagina, limite };
  };

  // CONSULTAR POSTULACION POR ID
  guardar.buscarPorId = async id => {
    if (typeof id !== 'string' || !/^[0-9a-f]{24}$/i.test(id)) {
      return null;
    }

    return postulaciones.findOne(
      { _id: new ObjectId(id) },
      { projection: { _id: 0 } }
    );
  };

  // TAREA 59: CAMBIAR ESTADO
  guardar.cambiarEstado = async (id, nuevoEstado, observaciones, funcionarioRut) => {
    if (typeof id !== 'string' || !/^[0-9a-f]{24}$/i.test(id)) {
      return { noExiste: true };
    }

    const objetoId = new ObjectId(id);
    const inicial = await postulaciones.findOne({ _id: objetoId });

    if (!inicial) {
      return { noExiste: true };
    }

    const animalID = inicial.animalID;

    try {
      await controlesAnimales.updateOne(
        { _id: animalID },
        { $setOnInsert: { revision: 0 } },
        { upsert: true }
      );
    } catch (fallo) {
      if (fallo.code !== 11000) throw fallo;
    }

    return cliente.withSession(sesion =>
      sesion.withTransaction(async () => {
        await controlesAnimales.updateOne(
          { _id: animalID },
          { $inc: { revision: 1 } },
          { session: sesion }
        );

        const actual = await postulaciones.findOne(
          { _id: objetoId },
          { session: sesion }
        );

        if (!actual) {
          return { noExiste: true };
        }

        const transiciones = {
          recibida: ['en_evaluación'],
          en_evaluación: ['aprobada', 'rechazada']
        };

        const permitidas = transiciones[actual.estado] ?? [];

        if (!permitidas.includes(nuevoEstado)) {
          return { conflicto: 'TRANSICION_INVALIDA' };
        }

        if (nuevoEstado === 'aprobada') {
          const aprobada = await postulaciones.findOne(
            {
              animalID,
              estado: { $in: ['aprobada', 'adopcion_concretada'] },
              _id: { $ne: objetoId }
            },
            { session: sesion }
          );

          if (aprobada) {
            return { conflicto: 'ANIMAL_YA_ADOPTADO' };
          }
        }

        const fecha = new Date().toISOString();

        await postulaciones.updateOne(
          { _id: objetoId },
          {
            $set: {
              estado: nuevoEstado,
              observaciones,
              funcionarioRut,
              fechaActualizacion: fecha
            }
          },
          { session: sesion }
        );

        let canceladas = 0;

        // RN-07: CANCELACION AUTOMATICA
        if (nuevoEstado === 'aprobada') {
          const resultado = await postulaciones.updateMany(
            {
              animalID,
              _id: { $ne: objetoId },
              estado: { $in: ACTIVAS }
            },
            {
              $set: {
                estado: 'cancelada',
                fechaActualizacion: fecha,
                motivoCancelacion: 'Otra postulación fue aprobada'
              }
            },
            { session: sesion }
          );

          canceladas = resultado.modifiedCount;
        }

        const documento = await postulaciones.findOne(
          { _id: objetoId },
          {
            session: sesion,
            projection: { _id: 0 }
          }
        );

        return { documento, canceladas };
      }, {
        readConcern: { level: 'snapshot' },
        writeConcern: { w: 'majority' }
      })
    );
  };

  guardar.operacionesConcrecion = {
    obtener: guardar.buscarPorId,
    concretar(id, animalID, cambios, notificar) {
      return cliente.withSession(sesion => sesion.withTransaction(async () => {
        await controlesAnimales.updateOne(
          { _id: animalID }, { $inc: { revision: 1 } }, { upsert: true, session: sesion }
        );
        const objetoId = new ObjectId(id);
        const duplicada = await postulaciones.findOne(
          { animalID, estado: 'adopcion_concretada', _id: { $ne: objetoId } },
          { projection: { _id: 1 }, session: sesion }
        );
        if (duplicada) return { conflicto: 'ANIMAL_NO_DISPONIBLE' };

        const documento = await postulaciones.findOneAndUpdate(
          { _id: objetoId, animalID, estado: 'aprobada' },
          { $set: {
            ...cambios,
            estado: 'adopcion_concretada',
            fechaActualizacion: cambios.fechaConcrecion,
          } },
          { returnDocument: 'after', projection: { _id: 0 }, session: sesion }
        );
        if (!documento) return { conflicto: 'TRANSICION_INVALIDA' };
        // Un rechazo de M1 aborta la transacción, incluido el cambio de estado.
        await notificar(documento);
        return { documento };
      }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } }));
    },
  };

  return guardar;
}
