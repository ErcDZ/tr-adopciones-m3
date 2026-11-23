
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { before, after, test } from 'node:test';
import { crearApp } from '../src/app.js';

const ID = '123456789012345678901234';
const ID_INEXISTENTE = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const RUTA = '/api/adopciones/postulaciones/';

// Simulamos el núcleo con dos perfiles
function nucleo(req, res) {
  res.setHeader('Content-Type', 'application/json');

  if (req.url !== '/api/nucleo/sesiones/actual') {
    res.statusCode = 404;
    return res.end('{}');
  }

  const token = req.headers.authorization;

  if (token === 'Bearer funcionario') {
    return res.end(JSON.stringify({
      rut: '20000000-1',
      perfil: 'funcionario'
    }));
  }

  if (token === 'Bearer vecino') {
    return res.end(JSON.stringify({
      rut: '10000000-8',
      perfil: 'vecino'
    }));
  }

  res.statusCode = 401;
  res.end('{}');
}

// Simulamos el repositorio para probar la API
async function guardar() {}

guardar.cambiarEstado = async (id, estado, observaciones, rut) => {
  if (id === ID_INEXISTENTE) {
    return { noExiste: true };
  }

  // Simulamos una transición no permitida
  if (estado === 'rechazada') {
    return { conflicto: 'TRANSICION_INVALIDA' };
  }

  return {
    documento: {
      postulacionID: id,
      estado,
      observaciones,
      funcionarioRut: rut
    },
    canceladas: 0
  };
};

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

// Enviar una solicitud PATCH
function cambiarEstado(
  token = 'funcionario',
  estado = 'en_evaluación',
  observaciones = 'Revisión realizada',
  id = ID
) {
  return fetch(url + RUTA + id, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify({ estado, observaciones })
  });
}

// PRUEBA 1
test('401: rechaza cambio sin token', async () => {
  const res = await cambiarEstado(null);
  assert.equal(res.status, 401);
});

// PRUEBA 2
test('403: vecino no puede cambiar estados', async () => {
  const res = await cambiarEstado('vecino');
  assert.equal(res.status, 403);

  const datos = await res.json();
  assert.equal(datos.error.codigo, 'PERFIL_NO_AUTORIZADO');
});

// PRUEBA 3
test('200: funcionario puede iniciar evaluación', async () => {
  const res = await cambiarEstado();
  const datos = await res.json();

  assert.equal(res.status, 200);
  assert.equal(datos.datos.estado, 'en_evaluación');
  assert.equal(datos.datos.funcionarioRut, '20000000-1');
});

// PRUEBA 4
test('400: rechaza estado incorrecto', async () => {
  const res = await cambiarEstado('funcionario', 'inventado');
  assert.equal(res.status, 400);
});

// PRUEBA 5
test('400: exige observaciones', async () => {
  const res = await cambiarEstado('funcionario', 'en_evaluación', '');
  assert.equal(res.status, 400);
});

// PRUEBA 6
test('409: rechaza transición inválida simulada', async () => {
  const res = await cambiarEstado('funcionario', 'rechazada');
  const datos = await res.json();

  assert.equal(res.status, 409);
  assert.equal(datos.error.codigo, 'TRANSICION_INVALIDA');
});

// PRUEBA 7
test('404: rechaza postulación inexistente', async () => {
  const res = await cambiarEstado(
    'funcionario',
    'en_evaluación',
    'Revisión',
    ID_INEXISTENTE
  );

  assert.equal(res.status, 404);
});
