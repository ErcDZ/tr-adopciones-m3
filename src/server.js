import { crearApp } from './app.js';

const puerto = Number(process.env.PORT ?? 3000);
const nucleoUrl = process.env.NUCLEO_URL;
if (!Number.isInteger(puerto) || puerto < 1 || puerto > 65535) {
  throw new Error('PORT debe ser un entero entre 1 y 65535');
}
if (!nucleoUrl) {
  throw new Error('Configura NUCLEO_URL en el entorno o en .env');
}

const app = crearApp({
  nucleoUrl,
  timeoutMs: Number(process.env.NUCLEO_TIMEOUT_MS ?? 35_000),
});
app.listen(puerto, () => console.log(`Adopciones escucha en el puerto ${puerto}`));
