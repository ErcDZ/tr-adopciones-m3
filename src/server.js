import { crearApp } from './app.js';
import express from 'express';
import { MongoClient } from 'mongodb';
import { crearRepositorioPostulaciones } from './repositorio-postulaciones.js';

const puerto = Number(process.env.PORT ?? 3000);
const nucleoUrl = process.env.NUCLEO_URL;
if (!Number.isInteger(puerto) || puerto < 1 || puerto > 65535) {
  throw new Error('PORT debe ser un entero entre 1 y 65535');
}
if (!nucleoUrl) {
  throw new Error('Configura NUCLEO_URL en el entorno o en .env');
}

const opciones = {
  nucleoUrl,
  timeoutMs: Number(process.env.NUCLEO_TIMEOUT_MS ?? 35_000),
  registroUrl: process.env.M1_URL || nucleoUrl,
  tokenRegistro: process.env.M1_TOKEN,
};
const cliente = process.env.MONGODB_URI
  ? new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 3000 })
  : undefined;
const app = express();
app.disable('x-powered-by');
let aplicacion = crearApp(opciones);
let inicializacion;

function inicializarRepositorio() {
  inicializacion ??= crearRepositorioPostulaciones(cliente)
    .then(guardarPostulacion => {
      aplicacion = crearApp({ ...opciones, guardarPostulacion });
    })
    .catch(fallo => {
      inicializacion = undefined;
      throw fallo;
    });
  return inicializacion;
}

app.get('/salud', async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  if (cliente) {
    try {
      await cliente.db('tr_adopciones').command({ ping: 1 }, { timeoutMS: 2000 });
      await inicializarRepositorio();
      return res.json({ estado: 'ok', baseDatos: 'conectada' });
    } catch {
      // La respuesta pública no incluye errores ni detalles de conexión.
    }
  }
  return res.status(503).json({ estado: 'error', baseDatos: 'no_disponible' });
});

app.use((req, res, next) => aplicacion(req, res, next));
const servidor = app.listen(puerto, '0.0.0.0', () => {
  console.log(`Adopciones escucha en el puerto ${puerto}`);
});
if (cliente) {
  inicializarRepositorio().catch(() => {
    console.error('No se pudo inicializar MongoDB para las postulaciones');
  });
  const cerrar = () => servidor.close(() => cliente.close());
  process.once('SIGINT', cerrar);
  process.once('SIGTERM', cerrar);
}
