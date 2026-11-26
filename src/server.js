import { crearApp } from './app.js';
import { MongoClient } from 'mongodb';
import { crearRepositorioPostulaciones, crearOperacionesAdopcion } from './repositorio-postulaciones.js';

const puerto = Number(process.env.PORT ?? 3000);
const nucleoUrl = process.env.NUCLEO_URL;
if (!Number.isInteger(puerto) || puerto < 1 || puerto > 65535) {
  throw new Error('PORT debe ser un entero entre 1 y 65535');
}
if (!nucleoUrl) {
  throw new Error('Configura NUCLEO_URL en el entorno o en .env');
}

const cliente = process.env.MONGODB_URI ? new MongoClient(process.env.MONGODB_URI) : undefined;
let guardarPostulacion;
let operacionesAdopcion;
if (cliente) {
  try {
    await cliente.connect();
    guardarPostulacion = await crearRepositorioPostulaciones(cliente);
    operacionesAdopcion = await crearOperacionesAdopcion(cliente);
  } catch {
    await cliente.close();
    throw new Error('No se pudo inicializar MongoDB para las postulaciones');
  }
}

const app = crearApp({
  nucleoUrl,
  timeoutMs: Number(process.env.NUCLEO_TIMEOUT_MS ?? 35_000),
  registroUrl: process.env.M1_URL || nucleoUrl,
  tokenRegistro: process.env.M1_TOKEN,
  guardarPostulacion,
  operacionesAdopcion,
});
const servidor = app.listen(puerto, () => console.log(`Adopciones escucha en el puerto ${puerto}`));
if (cliente) {
  const cerrar = () => servidor.close(() => cliente.close());
  process.once('SIGINT', cerrar);
  process.once('SIGTERM', cerrar);
}
