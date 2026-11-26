import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';
import { crearApp } from '../src/app.js';

const sesiones = '/api/nucleo/sesiones';
const vecino = '/api/adopciones/acceso/vecino';
const funcionario = '/api/adopciones/acceso/funcionario';
const catalogo = '/api/adopciones/animales-disponibles';
const perfiles = new Map([
  ['demo.vecino', { rut: '10000000-8', perfil: 'vecino' }],
  ['demo.funcionario', { rut: '20000000-1', perfil: 'funcionario' }],
  ['demo.admin', { rut: '30000000-5', perfil: 'admin' }],
]);
const cabecera = token => ({ Authorization: `Bearer ${token}` });
const identidad = perfiles.get('demo.vecino');
const sesion = {
  ...identidad, token: 'demo.vecino', nombre: 'Usuario ficticio', expira: '2099-01-01T08:00:00Z',
};

function json(res, estado, datos) {
  res.writeHead(estado, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(datos));
}

async function nucleo(req, res) {
  if (req.method === 'GET' && req.url === '/api/registro/animales') {
    if (req.headers.authorization === 'Bearer demo.vecino') {
      return json(res, 200, { datos: [
        { animalId: 'A-001', nombre: 'Animal ficticio', especie: 'perro', estado: 'inscrito', microchip: '123' },
        { animalId: 'A-002', especie: 'perro', estado: 'fallecido', microchip: '456' },
        { animalId: 'A-003', especie: 'perro', estado: 'desconocido', microchip: '789' },
      ] });
    }
    return json(res, req.headers.authorization === 'Bearer demo.funcionario' ? 403 : 401, {});
  }
  if (req.method === 'POST' && req.url === sesiones) {
    let cuerpo = '';
    for await (const trozo of req) cuerpo += trozo;
    const { rut, clave } = JSON.parse(cuerpo);
    if (rut !== identidad.rut) return json(res, 400, { error: { codigo: 'RUT_INVALIDO' } });
    if (clave === 'indisponible') return json(res, 500, {});
    if (clave !== 'clave-ficticia') return json(res, 401, {});
    return json(res, 201, { ...sesion, campoInterno: 'omitido' });
  }
  if (req.method !== 'GET' || req.url !== `${sesiones}/actual`) return json(res, 404, {});
  if (req.headers.authorization === 'Bearer demo.timeout') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.write('{"rut":');
  }
  if (req.headers.authorization === 'Bearer demo.html') {
    res.writeHead(502, { 'Content-Type': 'text/html' });
    return res.end('<h1>Error</h1>');
  }
  if (req.headers.authorization === 'Bearer demo.incompleto') {
    return json(res, 200, { rut: identidad.rut });
  }
  const usuario = perfiles.get(req.headers.authorization?.slice(7));
  return usuario ? json(res, 200, usuario) : json(res, 401, {});
}

async function escuchar(servidor) {
  await new Promise((resolve, reject) => {
    servidor.once('error', reject);
    servidor.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${servidor.address().port}`;
}

function cerrar(servidor) {
  return new Promise((resolve, reject) => servidor.close(err => err ? reject(err) : resolve()));
}

let core;
let modulo;
let base;
before(async () => {
  core = createServer(nucleo);
  const nucleoUrl = await escuchar(core);
  modulo = createServer(crearApp({ nucleoUrl, timeoutMs: 300 }));
  base = await escuchar(modulo);
});
after(async () => { await Promise.all([cerrar(modulo), cerrar(core)]); });

const login = (clave, rut = identidad.rut) => fetch(base + sesiones, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ rut, clave }),
});
const acceder = (ruta, headers) => fetch(base + ruta, { headers });

async function comprobarError(res, estado, codigo) {
  assert.equal(res.status, estado);
  const cuerpo = await res.json();
  assert.match(cuerpo.error.mensaje, /\S/);
  assert.deepEqual(cuerpo, { error: { codigo, mensaje: cuerpo.error.mensaje } });
}

test('el catálogo protege el acceso y conserva el identificador devuelto por M1', async () => {
  await comprobarError(await acceder(catalogo), 401, 'TOKEN_REQUERIDO');
  await comprobarError(await acceder(catalogo, cabecera('demo.admin')), 403, 'PERFIL_NO_AUTORIZADO');
  const res = await acceder(catalogo + '?especie=perro', cabecera('demo.vecino'));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    page: 1, limit: 10, total: 1,
    datos: [{ animalID: 'A-001', nombre: 'Animal ficticio', especie: 'perro', microship: '123' }],
  });
});

test('el rechazo de M1 no se confunde con un permiso local ni invalida la sesión por un token de servicio', async () => {
  await comprobarError(await acceder(catalogo, cabecera('demo.funcionario')), 503, 'SERVICIO_NO_DISPONIBLE');
  const servicio = createServer(crearApp({
    nucleoUrl: `http://127.0.0.1:${core.address().port}`,
    tokenRegistro: 'demo.servicio-vencido',
  }));
  const origen = await escuchar(servicio);
  try {
    const res = await fetch(origen + catalogo, { headers: cabecera('demo.vecino') });
    await comprobarError(res, 503, 'SERVICIO_NO_DISPONIBLE');
  } finally {
    await cerrar(servicio);
  }
});

test('reenvía rut y clave y devuelve la sesión del núcleo', async () => {
  const res = await login('clave-ficticia');
  assert.equal(res.status, 201);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await res.json(), sesion);
});

test('rechaza datos faltantes, RUT inválido, JSON inválido y clave incorrecta', async () => {
  await comprobarError(await login(''), 400, 'DATOS_FALTANTES');
  await comprobarError(await login('clave-ficticia', 'mal'), 400, 'RUT_INVALIDO');
  const res = await fetch(base + sesiones, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{',
  });
  await comprobarError(res, 400, 'JSON_INVALIDO');
  await comprobarError(await login('incorrecta'), 401, 'CREDENCIALES_INVALIDAS');
});

test('rechaza encabezados ausentes o mal formados y tokens rechazados por el núcleo', async () => {
  await comprobarError(await acceder(vecino), 401, 'TOKEN_REQUERIDO');
  await comprobarError(await acceder(vecino, { Authorization: 'Basic demo' }), 401, 'TOKEN_INVALIDO');
  for (const token of ['demo.invalido', 'demo.expirado']) {
    await comprobarError(await acceder(vecino, cabecera(token)), 401, 'TOKEN_INVALIDO');
  }
});

test('autoriza cada perfil en su ruta y devuelve la identidad confirmada', async () => {
  for (const [ruta, token] of [[vecino, 'demo.vecino'], [funcionario, 'demo.funcionario']]) {
    const res = await acceder(ruta, cabecera(token));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), perfiles.get(token));
  }
});

test('impide acceso cruzado y rechaza perfiles fuera del alcance', async () => {
  await comprobarError(await acceder(funcionario, cabecera('demo.vecino')), 403, 'PERFIL_NO_AUTORIZADO');
  await comprobarError(await acceder(vecino, cabecera('demo.funcionario')), 403, 'PERFIL_NO_AUTORIZADO');
  await comprobarError(await acceder(funcionario, cabecera('demo.admin')), 403, 'PERFIL_NO_AUTORIZADO');
});

test('devuelve 503 ante errores del núcleo, respuesta incompleta o tiempo agotado', async () => {
  await comprobarError(await login('indisponible'), 503, 'SERVICIO_NO_DISPONIBLE');
  for (const token of ['demo.html', 'demo.incompleto', 'demo.timeout']) {
    await comprobarError(await acceder(vecino, cabecera(token)), 503, 'SERVICIO_NO_DISPONIBLE');
  }
});
