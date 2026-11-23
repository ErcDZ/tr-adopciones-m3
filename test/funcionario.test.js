
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { before, after, test } from 'node:test';
import { crearApp } from '../src/app.js';

const rutVecino = '10000000-8';
const rutFuncionario = '20000000-1';
const id = 'aaaaaaaaaaaaaaaaaaaaaaaa';

// Datos de prueba, sin modificar MongoDB real
const postulacion = {
  postulacionID: id,
  postulanteRut: rutVecino,
  animalID: 'SIM-000001',
  estado: 'recibida',
  viviendaTipo: 'casa',
  tienePatio: true,
  hayNinos: false,
  tieneOtrasMascotas: false,
  motivoAdopcion: 'Quiero adoptar'
};

// Simulación del repositorio
async function guardar() {}

guardar.listarTodas = async (pagina, limite) => ({
  datos: [postulacion],
  total: 1,
  pagina,
  limite
});

guardar.listar = async (rut, pagina, limite) => ({
  datos: rut === rutVecino ? [postulacion] : [],
  total: rut === rutVecino ? 1 : 0,
  pagina,
  limite
});

guardar.buscarPorId = async codigo =>
  codigo === id ? postulacion : null;

guardar.cambiarEstado = async (codigo, estado, observaciones) => ({
  documento: { ...postulacion, estado, observaciones },
  canceladas: 1
});

// Simulación del núcleo municipal
function nucleo(req, res) {
  res.setHeader('Content-Type', 'application/json');

  if (req.url === '/api/nucleo/sesiones/actual') {
    const usuarios = {
      'Bearer funcionario': {
        rut: rutFuncionario,
        perfil: 'funcionario'
      },
      'Bearer vecino': {
        rut: rutVecino,
        perfil: 'vecino'
      }
    };

    const usuario = usuarios[req.headers.authorization];

    res.statusCode = usuario ? 200 : 401;
    return res.end(JSON.stringify(usuario || {}));
  }

  if (req.url === `/api/nucleo/usuarios/${rutVecino}`) {
    res.statusCode = 200;
    return res.end(JSON.stringify({
      rut: rutVecino,
      nombre: 'Vecino de prueba',
      prohibicionTenencia: false
    }));
  }

  res.statusCode = 404;
  res.end('{}');
}

async function escuchar(servidor) {
  await new Promise(resolve =>
    servidor.listen(0, '127.0.0.1', resolve)
  );

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

function consultar(ruta, token = 'funcionario', opciones = {}) {
  return fetch(url + ruta, {
    ...opciones,
    headers: {
      Authorization: `Bearer ${token}`,
      ...opciones.headers
    }
  });
}

// PRUEBA 1
test('Funcionario puede listar todas las postulaciones', async () => {
  const res = await consultar('/api/adopciones/postulaciones');
  const datos = await res.json();

  assert.equal(res.status, 200);
  assert.equal(datos.total, 1);
});

// PRUEBA 2
test('Vecino no puede listar postulaciones ajenas', async () => {
  const res = await consultar(
    '/api/adopciones/postulaciones?postulanteRut=20000000-1',
    'vecino'
  );

  assert.equal(res.status, 403);
});

// PRUEBA 3
test('Funcionario puede consultar una postulación', async () => {
  const res = await consultar(`/api/adopciones/postulaciones/${id}`);
  const datos = await res.json();

  assert.equal(res.status, 200);
  assert.equal(datos.datos.postulanteRut, rutVecino);
});

// PRUEBA 4
test('Funcionario puede consultar inhabilidades', async () => {
  const res = await consultar(
    `/api/adopciones/funcionarios/usuarios/${rutVecino}`
  );
  const datos = await res.json();

  assert.equal(res.status, 200);
  assert.equal(datos.datos.prohibicionTenencia, false);
});

// PRUEBA 5
test('Vecino no puede consultar inhabilidades administrativas', async () => {
  const res = await consultar(
    `/api/adopciones/funcionarios/usuarios/${rutVecino}`,
    'vecino'
  );

  assert.equal(res.status, 403);
});

// PRUEBA 6
test('Funcionario puede enviar evaluación con observaciones', async () => {
  const res = await consultar(
    `/api/adopciones/postulaciones/${id}`,
    'funcionario',
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        estado: 'en_evaluación',
        observaciones: 'Se revisaron los antecedentes'
      })
    }
  );

  const datos = await res.json();

  assert.equal(res.status, 200);
  assert.equal(datos.datos.estado, 'en_evaluación');
});

// PRUEBA 7
test('Rechaza una evaluación sin observaciones', async () => {
  const res = await consultar(
    `/api/adopciones/postulaciones/${id}`,
    'funcionario',
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        estado: 'aprobada',
        observaciones: ''
      })
    }
  );

  assert.equal(res.status, 400);
});

// PRUEBA 8
test('Vecino no puede cambiar estados', async () => {
  const res = await consultar(
    `/api/adopciones/postulaciones/${id}`,
    'vecino',
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        estado: 'aprobada',
        observaciones: 'Prueba'
      })
    }
  );

  assert.equal(res.status, 403);
});
