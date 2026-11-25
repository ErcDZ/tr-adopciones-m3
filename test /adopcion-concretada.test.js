import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, beforeEach, test } from 'node:test';
import { crearApp } from '../src/app.js';

const ID = 'a'.repeat(24);
const OTRO_ID = 'b'.repeat(24);
const RUTA = id => `/api/adopciones/postulaciones/${id}`;
const perfiles = new Map([
  ['demo.vecino', { rut: '10000000-8', perfil: 'vecino' }],
  ['demo.funcionario', { rut: '20000000-1', perfil: 'funcionario' }],
]);

function json(res, estado, datos) {
  res.writeHead(estado, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(datos));
}

function nucleo(req, res) {
  const usuario = perfiles.get(req.headers.authorization?.slice(7));
  return req.url === '/api/nucleo/sesiones/actual' && usuario ? json(res, 200, usuario) : json(res, 401, {});
}

// M1 simulado: registra cada PATCH de tutor y responde según `modoM1`.
let modoM1;
let llamadasM1;
let eventos;
async function registro(req, res) {
  let cuerpo = '';
  for await (const trozo of req) cuerpo += trozo;
  const coincide = req.method === 'PATCH' && /^\/api\/registro\/animales\/[^/]+\/tutor$/.test(req.url);
  if (!coincide) return json(res, 404, {});
  llamadasM1.push({ url: req.url, authorization: req.headers.authorization, cuerpo: JSON.parse(cuerpo) });
  eventos.push('m1');
  if (modoM1 === 'caido') return json(res, 500, {});
  if (modoM1 === 'html') {
    res.writeHead(502, { 'Content-Type': 'text/html' });
    return res.end('<h1>Error</h1>');
  }
  if (modoM1 === 'colgado') return; // nunca responde: el cliente agota el tiempo
  if (modoM1 === 'sin_animal') return json(res, 404, { error: { codigo: 'ANIMAL_NO_ENCONTRADO' } });
  return json(res, 200, { animalId: 'SIM-000001', tutorRut: JSON.parse(cuerpo).postulanteRut });
}

// Repositorio en memoria con la misma interfaz que crearOperacionesAdopcion.
let docs;
let falloMongo;
const operaciones = {
  obtener: async id => docs.get(id) ?? null,
  animalAdoptado: async animalID => [...docs.values()].some(d => d.animalID === animalID && d.estado === 'adopcion_concretada'),
  concretar: async (id, cambios) => {
    eventos.push('mongo');
    if (falloMongo) throw new Error('mongo caído');
    const actual = docs.get(id);
    if (actual?.estado !== 'aprobada') return { conflicto: 'TRANSICION_INVALIDA' };
    const documento = { ...actual, ...cambios, estado: 'adopcion_concretada' };
    docs.set(id, documento);
    return { documento };
  },
};

const cuerpoValido = { estado: 'adopcion_concretada', retiroFisicoConfirmado: true, actaFirmada: true };
let nucleoSrv; let registroSrv; let moduloSrv; let base; let nucleoUrl; let registroUrl;
const escuchar = s => new Promise(r => s.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${s.address().port}`)));
const cerrar = s => new Promise(r => { s.closeAllConnections?.(); s.close(() => r()); });

before(async () => {
  nucleoSrv = createServer(nucleo);
  registroSrv = createServer(registro);
  nucleoUrl = await escuchar(nucleoSrv);
  registroUrl = await escuchar(registroSrv);
  moduloSrv = createServer(crearApp({ nucleoUrl, registroUrl, timeoutMs: 300, operacionesAdopcion: operaciones }));
  base = await escuchar(moduloSrv);
});
after(async () => { await Promise.all([cerrar(moduloSrv), cerrar(registroSrv), cerrar(nucleoSrv)]); });
beforeEach(() => {
  modoM1 = 'ok'; llamadasM1 = []; eventos = []; falloMongo = false;
  docs = new Map([
    [ID, { postulacionID: ID, postulanteRut: '10000000-8', animalID: 'SIM-000001', estado: 'aprobada' }],
    [OTRO_ID, { postulacionID: OTRO_ID, postulanteRut: '10000000-8', animalID: 'SIM-000002', estado: 'recibida' }],
  ]);
});

const patch = (id, cuerpo = cuerpoValido, token = 'demo.funcionario') => fetch(base + RUTA(id), {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
  body: JSON.stringify(cuerpo),
});

test('concreta la adopción: notifica a M1 con postulanteRut y luego guarda en MongoDB', async () => {
  const res = await patch(ID);
  assert.equal(res.status, 200);
  const cuerpo = await res.json();
  assert.equal(cuerpo.estado, 'adopcion_concretada');
  assert.equal(cuerpo.retiroFisicoConfirmado, true);
  assert.equal(cuerpo.actaFirmada, true);
  assert.equal(cuerpo.concretadaPor, '20000000-1');
  assert.deepEqual(eventos, ['m1', 'mongo']);
  assert.equal(llamadasM1.length, 1);
  assert.equal(llamadasM1[0].url, '/api/registro/animales/SIM-000001/tutor');
  assert.deepEqual(llamadasM1[0].cuerpo, { postulanteRut: '10000000-8' });
  assert.equal(docs.get(ID).estado, 'adopcion_concretada');
});

test('409 TRANSICION_INVALIDA si la postulación no está aprobada, sin llamar a M1', async () => {
  const res = await patch(OTRO_ID);
  assert.equal(res.status, 409);
  assert.equal((await res.json()).error.codigo, 'TRANSICION_INVALIDA');
  assert.equal(llamadasM1.length, 0);
  assert.equal(docs.get(OTRO_ID).estado, 'recibida');
});

test('409 TRANSICION_INVALIDA al repetir la operación sobre una adopción ya concretada', async () => {
  assert.equal((await patch(ID)).status, 200);
  const res = await patch(ID);
  assert.equal(res.status, 409);
  assert.equal((await res.json()).error.codigo, 'TRANSICION_INVALIDA');
  assert.equal(llamadasM1.length, 1);
});

test('409 TRANSICION_INVALIDA para otros estados destino', async () => {
  const res = await patch(ID, { estado: 'recibida' });
  assert.equal(res.status, 409);
  assert.equal((await res.json()).error.codigo, 'TRANSICION_INVALIDA');
  assert.equal(docs.get(ID).estado, 'aprobada');
});

test('400 si faltan o no son booleanos retiroFisicoConfirmado y actaFirmada', async () => {
  for (const cuerpo of [
    { estado: 'adopcion_concretada' },
    { estado: 'adopcion_concretada', retiroFisicoConfirmado: true },
    { estado: 'adopcion_concretada', actaFirmada: true },
    { estado: 'adopcion_concretada', retiroFisicoConfirmado: 'si', actaFirmada: true },
    {},
  ]) {
    const res = await patch(ID, cuerpo);
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error.codigo, 'DATOS_INVALIDOS');
  }
  assert.equal(llamadasM1.length, 0);
  assert.equal(docs.get(ID).estado, 'aprobada');
});

test('409 CONFIRMACION_REQUERIDA si el retiro o el acta no están confirmados', async () => {
  for (const cuerpo of [
    { ...cuerpoValido, retiroFisicoConfirmado: false },
    { ...cuerpoValido, actaFirmada: false },
    { ...cuerpoValido, retiroFisicoConfirmado: false, actaFirmada: false },
  ]) {
    const res = await patch(ID, cuerpo);
    assert.equal(res.status, 409);
    assert.equal((await res.json()).error.codigo, 'CONFIRMACION_REQUERIDA');
  }
  assert.equal(llamadasM1.length, 0);
  assert.equal(docs.get(ID).estado, 'aprobada');
});

for (const modo of ['caido', 'html', 'colgado']) {
  test(`503 y sin cambios en MongoDB si M1 no responde (${modo})`, async () => {
    modoM1 = modo;
    const res = await patch(ID);
    assert.equal(res.status, 503);
    assert.equal((await res.json()).error.codigo, 'SERVICIO_NO_DISPONIBLE');
    assert.equal(llamadasM1.length, 1);
    assert.deepEqual(eventos, ['m1']); // nunca se intentó escribir en MongoDB
    assert.equal(docs.get(ID).estado, 'aprobada');
    assert.equal(docs.get(ID).actaFirmada, undefined);
  });
}

test('404 ANIMAL_NO_ENCONTRADO si M1 no conoce al animal, sin cambios en MongoDB', async () => {
  modoM1 = 'sin_animal';
  const res = await patch(ID);
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error.codigo, 'ANIMAL_NO_ENCONTRADO');
  assert.equal(docs.get(ID).estado, 'aprobada');
});

test('503 si MongoDB falla después de notificar a M1; la postulación sigue aprobada', async () => {
  falloMongo = true;
  const res = await patch(ID);
  assert.equal(res.status, 503);
  assert.deepEqual(eventos, ['m1', 'mongo']);
  assert.equal(docs.get(ID).estado, 'aprobada');
  falloMongo = false;
  assert.equal((await patch(ID)).status, 200); // el reintento es idempotente
});

test('409 TRANSICION_INVALIDA si otra solicitud ganó la carrera después de notificar a M1', async () => {
  const original = operaciones.concretar;
  operaciones.concretar = async () => ({ conflicto: 'TRANSICION_INVALIDA' });
  try {
    const res = await patch(ID);
    assert.equal(res.status, 409);
    assert.equal((await res.json()).error.codigo, 'TRANSICION_INVALIDA');
  } finally {
    operaciones.concretar = original;
  }
});

test('409 ANIMAL_NO_DISPONIBLE si el animal ya tiene otra adopción concretada', async () => {
  docs.set(OTRO_ID, { ...docs.get(OTRO_ID), animalID: 'SIM-000001', estado: 'adopcion_concretada' });
  const res = await patch(ID);
  assert.equal(res.status, 409);
  assert.equal((await res.json()).error.codigo, 'ANIMAL_NO_DISPONIBLE');
  assert.equal(llamadasM1.length, 0);
});

test('404 si la postulación no existe y 400 si el identificador es inválido', async () => {
  const noExiste = await patch('c'.repeat(24));
  assert.equal(noExiste.status, 404);
  assert.equal((await noExiste.json()).error.codigo, 'POSTULACION_NO_ENCONTRADA');
  const invalido = await patch('no-es-un-id');
  assert.equal(invalido.status, 400);
  assert.equal((await invalido.json()).error.codigo, 'ID_INVALIDO');
});

test('401 sin token y 403 con perfil vecino', async () => {
  assert.equal((await patch(ID, cuerpoValido, null)).status, 401);
  const vecino = await patch(ID, cuerpoValido, 'demo.vecino');
  assert.equal(vecino.status, 403);
  assert.equal((await vecino.json()).error.codigo, 'PERFIL_NO_AUTORIZADO');
  assert.equal(llamadasM1.length, 0);
});

test('envía M1_TOKEN a M1 cuando está configurado', async () => {
  const servidor = createServer(crearApp({
    nucleoUrl, registroUrl, timeoutMs: 300, tokenRegistro: 'servicio.m1', operacionesAdopcion: operaciones,
  }));
  const origen = await escuchar(servidor);
  try {
    const res = await fetch(origen + RUTA(ID), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer demo.funcionario' },
      body: JSON.stringify(cuerpoValido),
    });
    assert.equal(res.status, 200);
    assert.equal(llamadasM1[0].authorization, 'Bearer servicio.m1');
  } finally {
    await cerrar(servidor);
  }
});
