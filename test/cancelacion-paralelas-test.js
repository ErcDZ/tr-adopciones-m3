import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';
import { crearApp } from '../src/app.js';

const sesiones = '/api/nucleo/sesiones';
const baseRuta = '/api/adopciones/postulaciones';

const usuarios = new Map([
  ['tok.vecino', { rut: '11111111-1', perfil: 'vecino' }],
  ['tok.funcionario', { rut: '22222222-2', perfil: 'funcionario' }],
]);

function json(res, estado, datos) {
  res.writeHead(estado, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(datos));
}

function crearNucleoFalso() {
  return createServer((req, res) => {
    if (req.method === 'GET' && req.url === `${sesiones}/actual`) {
      const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
      const u = usuarios.get(token);
      if (!u) return json(res, 401, { error: { codigo: 'TOKEN_INVALIDO' } });
      return json(res, 200, u);
    }
    return json(res, 404, {});
  });
}

function crearMemoria() {
  const docs = new Map([
    ['aaaaaaaaaaaaaaaaaaaaaaaa', { postulacionID: 'aaaaaaaaaaaaaaaaaaaaaaaa', animalID: 'ANIMAL-1', postulanteRut: '11111111-1', estado: 'en_evaluación' }],
    ['bbbbbbbbbbbbbbbbbbbbbbbb', { postulacionID: 'bbbbbbbbbbbbbbbbbbbbbbbb', animalID: 'ANIMAL-1', postulanteRut: '12222222-2', estado: 'en_evaluación' }],
    ['cccccccccccccccccccccccc', { postulacionID: 'cccccccccccccccccccccccc', animalID: 'ANIMAL-1', postulanteRut: '13333333-3', estado: 'recibida' }],
    ['dddddddddddddddddddddddd', { postulacionID: 'dddddddddddddddddddddddd', animalID: 'ANIMAL-2', postulanteRut: '14444444-4', estado: 'recibida' }],
  ]);

  return {
    docs,
    obtener: async (id) => docs.get(id) ?? null,
    aprobarYCancelarParalelas: async ({ postulacionId, animalID, aprobadaPor }) => {
      const objetivo = docs.get(postulacionId);
      objetivo.estado = 'aprobada';
      objetivo.aprobadaPor = aprobadaPor;

      let canceladasParalelas = 0;
      for (const [id, item] of docs.entries()) {
        if (id !== postulacionId && item.animalID === animalID && ['recibida', 'en_evaluación'].includes(item.estado)) {
          item.estado = 'cancelada';
          canceladasParalelas += 1;
        }
      }
      return { postulacion: objetivo, canceladasParalelas };
    },
  };
}

async function escuchar(srv) {
  await new Promise((resolve, reject) => {
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${srv.address().port}`;
}

function cerrar(srv) {
  return new Promise((resolve, reject) => srv.close(err => (err ? reject(err) : resolve())));
}

let nucleoSrv;
let appSrv;
let baseUrl;
let memoria;

before(async () => {
  nucleoSrv = crearNucleoFalso();
  const nucleoUrl = await escuchar(nucleoSrv);
  memoria = crearMemoria();
  appSrv = createServer(crearApp({ nucleoUrl, timeoutMs: 500, operacionesAdopcion: memoria }));
  baseUrl = await escuchar(appSrv);
});

after(async () => {
  await Promise.all([cerrar(appSrv), cerrar(nucleoSrv)]);
});

test('403 si un vecino intenta aprobar con PATCH', async () => {
  const res = await fetch(`${baseUrl}${baseRuta}/aaaaaaaaaaaaaaaaaaaaaaaa`, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer tok.vecino' },
  });
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.error.codigo, 'ACCESO_DENEGADO');
});

test('404 POSTULACION_NO_ENCONTRADA ante id inexistente', async () => {
  const res = await fetch(`${baseUrl}${baseRuta}/ffffffffffffffffffffffff`, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer tok.funcionario' },
  });
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.error.codigo, 'POSTULACION_NO_ENCONTRADA');
});

test('aprueba postulación y cancela 100% de paralelas del mismo animal sin tocar otros animales', async () => {
  const res = await fetch(`${baseUrl}${baseRuta}/aaaaaaaaaaaaaaaaaaaaaaaa`, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer tok.funcionario' },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.postulacion.estado, 'aprobada');
  assert.equal(body.canceladasParalelas, 2);
  assert.equal(memoria.docs.get('bbbbbbbbbbbbbbbbbbbbbbbb').estado, 'cancelada');
  assert.equal(memoria.docs.get('cccccccccccccccccccccccc').estado, 'cancelada');
  assert.equal(memoria.docs.get('dddddddddddddddddddddddd').estado, 'recibida');
});
