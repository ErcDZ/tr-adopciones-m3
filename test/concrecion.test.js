import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';
import { crearApp } from '../src/app.js';

test('la concreción exige funcionario, confirmaciones y aceptación de M1 antes de guardar', async t => {
  const id = '671234567890123456789012';
  const postulacion = { estado: 'recibida', animalID: 'SIM-000001', postulanteRut: '12222222-5' };
  const confirmaciones = {
    estado: 'adopcion_concretada', retiroFisicoConfirmado: true, actaFirmada: true,
  };
  let llamadasM1 = 0;
  let guardados = 0;
  let respuestaM1 = { estado: 503, datos: {} };
  const nucleo = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/nucleo/sesiones/actual') {
      const perfil = req.headers.authorization === 'Bearer funcionario-ficticio' ? 'funcionario' : 'vecino';
      res.end(JSON.stringify({ perfil, rut: '17777777-3' }));
      return;
    }
    llamadasM1++;
    assert.equal(req.url, '/api/registro/animales/SIM-000001/tutor');
    assert.equal(req.method, 'PATCH');
    assert.equal(req.headers.authorization, 'Bearer funcionario-ficticio');
    let cuerpo = '';
    for await (const parte of req) cuerpo += parte;
    assert.deepEqual(JSON.parse(cuerpo), { tutorRut: '12222222-5' });
    res.statusCode = respuestaM1.estado;
    res.end(JSON.stringify(respuestaM1.datos));
  }).listen(0, '127.0.0.1');
  t.after(() => nucleo.close());
  await once(nucleo, 'listening');
  const guardarPostulacion = () => {};
  guardarPostulacion.operacionesConcrecion = {
    obtener: async () => postulacion,
    animalAdoptado: async () => false,
    concretar: async (postulacionId, cambios) => {
      assert.equal(postulacionId, id);
      guardados++;
      Object.assign(postulacion, cambios, { estado: 'adopcion_concretada' });
      return { documento: postulacion };
    },
  };
  const app = crearApp({
    nucleoUrl: `http://127.0.0.1:${nucleo.address().port}`,
    tokenRegistro: 'solo-lectura-ficticio',
    guardarPostulacion,
  }).listen(0, '127.0.0.1');
  t.after(() => app.close());
  await once(app, 'listening');
  function confirmar(cuerpo = confirmaciones, perfil = 'funcionario') {
    return fetch(`http://127.0.0.1:${app.address().port}/api/adopciones/postulaciones/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${perfil}-ficticio` },
      body: JSON.stringify(cuerpo),
    });
  }

  assert.equal((await confirmar(confirmaciones, 'vecino')).status, 403);
  assert.equal((await confirmar()).status, 409);
  postulacion.estado = 'aprobada';
  assert.equal((await confirmar({ ...confirmaciones, actaFirmada: false })).status, 409);
  assert.equal(llamadasM1, 0);
  assert.equal((await confirmar()).status, 503);
  assert.equal(guardados, 0);
  assert.equal(postulacion.estado, 'aprobada');
  respuestaM1 = { estado: 200, datos: { animalId: postulacion.animalID, tutorRut: 'otro-rut' } };
  assert.equal((await confirmar()).status, 503);
  assert.equal(guardados, 0);
  respuestaM1.datos.tutorRut = postulacion.postulanteRut;
  const respuesta = await confirmar();
  assert.equal(respuesta.status, 200);
  const { datos } = await respuesta.json();
  assert.equal(datos.estado, 'adopcion_concretada');
  assert.equal(datos.concretadaPor, '17777777-3');
  assert.equal(datos.retiroFisicoConfirmado, true);
  assert.equal(datos.actaFirmada, true);
  assert.ok(Number.isFinite(Date.parse(datos.fechaConcrecion)));
  assert.equal((await confirmar()).status, 409);
  assert.equal(llamadasM1, 3);
  assert.equal(guardados, 1);
});
