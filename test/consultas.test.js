
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { before, after, test } from 'node:test';
import { crearApp } from '../src/app.js';

const rut1 = '10000000-8';
const rut2 = '20000000-1';

const id1 = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const id2 = 'bbbbbbbbbbbbbbbbbbbbbbbb';


const postulaciones = [
  {
    postulacionID: id1,
    postulanteRut: rut1,
    animalID: 'SIM-000001',
    estado: 'recibida'
  },
  {
    postulacionID: id2,
    postulanteRut: rut2,
    animalID: 'SIM-000002',
    estado: 'recibida'
  }
];


async function guardar() {}

guardar.listar = async (rut, pagina, limite) => {
  const propias = postulaciones.filter(p => p.postulanteRut === rut);

  return {
    datos: propias.slice((pagina - 1) * limite, pagina * limite),
    total: propias.length,
    pagina,
    limite
  };
};

guardar.buscarPorId = async id => {
  return postulaciones.find(p => p.postulacionID === id) ?? null;
};


function nucleo(req, res) {
  const token = req.headers.authorization;

  let usuario = null;

  if (token === 'Bearer vecino1') {
    usuario = { rut: rut1, perfil: 'vecino' };
  }

  if (token === 'Bearer vecino2') {
    usuario = { rut: rut2, perfil: 'vecino' };
  }

  res.setHeader('Content-Type', 'application/json');

  if (req.url !== '/api/nucleo/sesiones/actual') {
    res.statusCode = 404;
    return res.end('{}');
  }

  if (!usuario) {
    res.statusCode = 401;
    return res.end('{}');
  }

  res.statusCode = 200;
  res.end(JSON.stringify(usuario));
}

async function escuchar(servidor) {
  await new Promise(resolve => servidor.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${servidor.address().port}`;
}

let servidorNucleo;
let servidorModulo;
let url;

before(async () => {
  servidorNucleo = createServer(nucleo);
  const nucleoUrl = await escuchar(servidorNucleo);

  servidorModulo = createServer(crearApp({
    nucleoUrl,
    guardarPostulacion: guardar
  }));

  url = await escuchar(servidorModulo);
});

after(async () => {
  await new Promise(resolve => servidorModulo.close(resolve));
  await new Promise(resolve => servidorNucleo.close(resolve));
});


async function consultar(ruta, token = 'vecino1') {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  return fetch(url + ruta, { headers });
}


test('200: vecino consulta sus propias postulaciones', async () => {
  const res = await consultar(`/api/adopciones/postulaciones?postulanteRut=${rut1}`);
  const cuerpo = await res.json();

  assert.equal(res.status, 200);
  assert.equal(cuerpo.datos.length, 1);
  assert.equal(cuerpo.datos[0].postulanteRut, rut1);
});


test('403: vecino no puede listar postulaciones de otro RUT', async () => {
  const res = await consultar(`/api/adopciones/postulaciones?postulanteRut=${rut2}`);
  const cuerpo = await res.json();

  assert.equal(res.status, 403);
  assert.equal(cuerpo.error.codigo, 'ACCESO_DENEGADO');
});


test('403: vecino no puede consultar ID de otro RUT', async () => {
  const res = await consultar(`/api/adopciones/postulaciones/${id2}`);
  const cuerpo = await res.json();

  assert.equal(res.status, 403);
  assert.equal(cuerpo.error.codigo, 'ACCESO_DENEGADO');
});


test('200: vecino puede consultar su propio ID', async () => {
  const res = await consultar(`/api/adopciones/postulaciones/${id1}`);
  const cuerpo = await res.json();

  assert.equal(res.status, 200);
  assert.equal(cuerpo.datos.postulanteRut, rut1);
});


test('401: rechaza consulta sin token', async () => {
  const res = await consultar('/api/adopciones/postulaciones', null);

  assert.equal(res.status, 401);
});


test('200: segundo vecino solo ve sus postulaciones', async () => {
  const res = await consultar(
    `/api/adopciones/postulaciones?postulanteRut=${rut2}`,
    'vecino2'
  );
  const cuerpo = await res.json();

  assert.equal(res.status, 200);
  assert.equal(cuerpo.datos.length, 1);
  assert.equal(cuerpo.datos[0].postulanteRut, rut2);
});


test('404: rechaza postulación inexistente', async () => {
  const res = await consultar(
    '/api/adopciones/postulaciones/cccccccccccccccccccccccc'
  );

  assert.equal(res.status, 404);
});
