import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';
import { MongoClient } from 'mongodb';
import { crearApp } from '../src/app.js';
import { crearOperacionesAdopcion, crearRepositorioPostulaciones } from '../src/repositorio-postulaciones.js';

const sesiones = '/api/nucleo/sesiones';
const postulaciones = '/api/adopciones/postulaciones';
const vecino = { rut: '11111111-1', perfil: 'vecino' };
const funcionarios = { rut: '17777777-3', perfil: 'funcionario' };
const prohibido = { rut: '9876543-3', perfil: 'vecino' };
const usuarios = { vecino, funcionario: funcionarios, prohibido };
const confirmado = { estado: 'adopcion_concretada', retiroFisicoConfirmado: true, actaFirmada: true };
const detalleInterno = 'Error: servicio externo\n    at fallo (C:\\interno\\registro.js:10:1)';
const m1Tutor = new Map();
let escriturasM1 = 0;
let url;
let cliente;
const servidores = [];

function responder(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

async function cuerpo(req) {
  let datos = '';
  for await (const trozo of req) datos += trozo;
  return JSON.parse(datos);
}

async function iniciar(handler) {
  const servidor = createServer(handler);
  servidores.push(servidor);
  await new Promise((resolve, reject) => servidor.listen(0, '127.0.0.1', resolve).once('error', reject));
  return `http://127.0.0.1:${servidor.address().port}`;
}

function memoria() {
  const docs = new Map();
  const cambiar = (id, origen, cambios) => {
    const previo = docs.get(id);
    if (previo?.estado !== origen) return null;
    const siguiente = { ...previo, ...cambios };
    docs.set(id, siguiente);
    return siguiente;
  };
  return {
    guardar: async datos => {
      const id = (docs.size + 1).toString(16).padStart(24, '0');
      const documento = { ...datos, postulacionID: id, estado: 'recibida' };
      docs.set(id, documento);
      return { documento };
    },
    operaciones: {
      obtener: async id => docs.get(id),
      iniciarEvaluacion: async ({ postulacionId }) => ({
        postulacion: cambiar(postulacionId, 'recibida', { estado: 'en_evaluación' }),
      }),
      aprobarYCancelarParalelas: async ({ postulacionId }) => ({
        postulacion: cambiar(postulacionId, 'en_evaluación', { estado: 'aprobada' }),
      }),
      animalAdoptado: async () => false,
      concretar: async (id, datos) => ({ documento: cambiar(id, 'aprobada', { ...datos, estado: 'adopcion_concretada' }) }),
    },
  };
}

before(async () => {
  const nucleoUrl = await iniciar(async (req, res) => {
    const nombre = req.headers.authorization?.slice(7);
    const usuario = Object.hasOwn(usuarios, nombre) ? usuarios[nombre] : undefined;
    if (req.method === 'POST' && req.url === sesiones) {
      const datos = await cuerpo(req);
      const cuenta = Object.entries(usuarios).find(([, persona]) => persona.rut === datos.rut);
      if (!cuenta || datos.clave !== 'solo-fixture-local') return responder(res, 401, {});
      return responder(res, 201, { ...cuenta[1], token: cuenta[0], nombre: cuenta[0], expira: '2030-01-01' });
    }
    if (!usuario) return responder(res, 401, {});
    if (req.url === `${sesiones}/actual`) return responder(res, 200, usuario);
    return responder(res, 200, { ...usuario, prohibicionTenencia: usuario === prohibido });
  });
  const registroUrl = await iniciar(async (req, res) => {
    const [animalId, destino] = req.url.split('/').slice(4);
    if (req.method === 'PATCH' && destino === 'tutor') {
      assert.equal(req.headers.authorization, 'Bearer fixture-registro');
      escriturasM1++;
      if (animalId === 'M1-FALLA') return responder(res, 500, { error: detalleInterno });
      const { postulanteRut } = await cuerpo(req);
      m1Tutor.set(animalId, postulanteRut);
      return responder(res, 200, { animalId, tutorRut: postulanteRut });
    }
    return responder(res, 200, {
      animalId, estado: animalId === 'FALLECIDO' ? 'fallecido' : 'inscrito', microchip: 'fixture',
    });
  });
  let { guardar, operaciones } = memoria();
  // Usar exclusivamente un replica set local y desechable, separado de entornos reales.
  if (process.env.M3_TEST_MONGODB_URI) {
    assert.match(process.env.M3_TEST_MONGODB_URI, /^mongodb:\/\/127\.0\.0\.1:\d+\/\?/);
    cliente = await MongoClient.connect(process.env.M3_TEST_MONGODB_URI);
    guardar = await crearRepositorioPostulaciones(cliente);
    operaciones = await crearOperacionesAdopcion(cliente);
  }
  url = await iniciar(crearApp({
    nucleoUrl, registroUrl, tokenRegistro: 'fixture-registro', guardarPostulacion: guardar, operacionesAdopcion: operaciones,
  }));
});

after(async () => {
  await Promise.all(servidores.map(servidor => new Promise(resolve => servidor.close(resolve))));
  await cliente?.close();
});

async function api(ruta, token, method = 'GET', datos) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  if (datos) headers['Content-Type'] = 'application/json';
  const respuesta = await fetch(url + ruta, { method, headers, body: JSON.stringify(datos) });
  return { status: respuesta.status, datos: await respuesta.json() };
}

const alta = (animalID, token = 'vecino') => api(postulaciones, token, 'POST', {
  postulanteRut: usuarios[token].rut, animalID, viviendaTipo: 'casa', tienePatio: false,
  hayNinos: false, tieneOtrasMascotas: false, motivoAdopcion: 'Caso de prueba', consentimientoCohabitantes: true,
});
const cambio = (id, datos, token = 'funcionario', sufijo = '') =>
  api(`${postulaciones}/${id}${sufijo}`, token, 'PATCH', datos);

function verificarError(res, status, codigo) {
  assert.equal(res.status, status);
  assert.deepEqual(Object.keys(res.datos), ['error']);
  assert.deepEqual(Object.keys(res.datos.error).sort(), ['codigo', 'mensaje']);
  assert.equal(res.datos.error.codigo, codigo);
}

test('login 201 según contrato, sesión válida 200 y rechazo 401 sin token', async () => {
  const login = await api(sesiones, null, 'POST', { rut: vecino.rut, clave: 'solo-fixture-local' });
  assert.equal(login.status, 201);
  assert.equal((await api('/api/adopciones/acceso/vecino', login.datos.token)).status, 200);
  verificarError(await api('/api/adopciones/acceso/vecino'), 401, 'TOKEN_REQUERIDO');
});

test('flujo completo con M1 HTTP, saltos 409 y vecino 403 sin actualización de tutor', async () => {
  const recibido = await alta('ANIMAL-FLUJO');
  assert.equal(recibido.status, 201);
  assert.equal(recibido.datos.estado, 'recibida');
  const id = recibido.datos.postulacionID;
  const inicial = escriturasM1;
  verificarError(await cambio(id, { estado: 'en_evaluacion' }, 'funcionario', '/concretar'), 409, 'TRANSICION_INVALIDA');
  verificarError(await cambio(id, confirmado), 409, 'TRANSICION_INVALIDA');
  verificarError(await cambio(id, { estado: 'aprobada' }), 409, 'TRANSICION_INVALIDA');
  const evaluada = await cambio(id, { estado: 'en_evaluacion' });
  assert.equal(evaluada.status, 200);
  assert.equal(evaluada.datos.postulacion.estado, 'en_evaluación');
  verificarError(await cambio(id, confirmado), 409, 'TRANSICION_INVALIDA');
  const aprobada = await cambio(id, { estado: 'aprobada' });
  assert.equal(aprobada.status, 200);
  assert.equal(aprobada.datos.postulacion.estado, 'aprobada');
  verificarError(await cambio(id, confirmado, 'vecino'), 403, 'ACCESO_DENEGADO');
  verificarError(await cambio(id, confirmado, 'vecino', '/concretar'), 403, 'ACCESO_DENEGADO');
  assert.equal(escriturasM1, inicial);
  const resultado = await cambio(id, confirmado, 'funcionario', '/concretar');
  assert.equal(resultado.status, 200);
  assert.equal(resultado.datos.estado, 'adopcion_concretada');
  assert.equal(m1Tutor.get('ANIMAL-FLUJO'), vecino.rut);
  verificarError(await cambio(id, confirmado), 409, 'TRANSICION_INVALIDA');
  assert.equal(escriturasM1, inicial + 1);
});

test('M1 falla con detalle interno; cliente recibe 503 genérico y la postulación sigue aprobada', async () => {
  const recibido = await alta('M1-FALLA');
  assert.equal(recibido.status, 201);
  const id = recibido.datos.postulacionID;
  assert.equal((await cambio(id, { estado: 'en_evaluacion' })).status, 200);
  assert.equal((await cambio(id, { estado: 'aprobada' })).status, 200);
  const error = await cambio(id, confirmado);
  verificarError(error, 503, 'SERVICIO_NO_DISPONIBLE');
  assert.doesNotMatch(JSON.stringify(error.datos), /interno|registro\.js|\.js:\d|at fallo/i);
  assert.equal(m1Tutor.has('M1-FALLA'), false);
  // Repetir llega nuevamente a M1, lo que comprueba que la primera petición no concretó.
  verificarError(await cambio(id, confirmado), 503, 'SERVICIO_NO_DISPONIBLE');
});

test('rechaza un animal fallecido y una persona con prohibición de tenencia', async () => {
  verificarError(await alta('FALLECIDO'), 409, 'ANIMAL_NO_DISPONIBLE');
  verificarError(await alta('ANIMAL-PROHIBICION', 'prohibido'), 409, 'PROHIBICION_TENENCIA');
});
