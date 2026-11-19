
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { crearPostulacion } from '../src/postulaciones.js';

const datosValidos = {
  postulanteRut: '10000000-8',
  animalID: 'SIM-000001',
  viviendaTipo: 'casa',
  tienePatio: true,
  hayNinos: false,
  tieneOtrasMascotas: false,
  motivoAdopcion: 'Puedo cuidar a la mascota',
  consentimientoCohabitantes: true,
};

// Ejecutamos una postulación con servicios simulados, sin usar Internet ni MongoDB.
async function probar({ cambios = {}, estadoAnimal = 'inscrito', prohibicion = false, conflicto = null } = {}) {
  let guardados = 0;
  let consultas = 0;

  const req = {
    usuario: { rut: '10000000-8', perfil: 'vecino' },
    body: { ...datosValidos, ...cambios },
    get: () => 'Bearer token-de-prueba',
  };
  const res = {
    codigo: 200,
    cuerpo: null,
    encabezados: {},
    status(numero) { this.codigo = numero; return this; },
    json(valor) { this.cuerpo = valor; return this; },
    location(valor) { this.encabezados.Location = valor; return this; },
    set(nombre, valor) { this.encabezados[nombre] = valor; return this; },
  };

  const ruta = crearPostulacion({
    consultarRegistro: async () => {
      consultas++;
      return { estado: 200, datos: {
        animalId: 'SIM-000001', estado: estadoAnimal, microchip: '123456789012345',
      }};
    },
    consultarNucleo: async () => {
      consultas++;
      return { estado: 200, datos: { rut: '10000000-8', prohibicionTenencia: prohibicion } };
    },
    guardar: async () => {
      guardados++;
      if (conflicto) return { conflicto };
      return { documento: { postulacionID: 'prueba123', estado: 'recibida' } };
    },
    error: (respuesta, estado, codigo, mensaje) =>
      respuesta.status(estado).json({ error: { codigo, mensaje } }),
  });

  await ruta(req, res);
  return { res, consultas, guardados };
}

test('400: rechaza RUT con formato incorrecto', async () => {
  const { res, consultas } = await probar({ cambios: { postulanteRut: 'rut-malo' } });
  assert.equal(res.codigo, 400);
  assert.equal(res.cuerpo.error.codigo, 'DATO_INVALIDO');
  assert.equal(consultas, 0);
});

test('403: rechaza cuando el RUT no coincide con el del token', async () => {
  const { res, consultas } = await probar({ cambios: { postulanteRut: '20000000-1' } });
  assert.equal(res.codigo, 403);
  assert.equal(res.cuerpo.error.codigo, 'RUT_NO_COINCIDE');
  assert.equal(consultas, 0);
});

test('400: rechaza tipo de vivienda no permitido', async () => {
  const { res, guardados } = await probar({ cambios: { viviendaTipo: 'castillo' } });
  assert.equal(res.codigo, 400);
  assert.equal(res.cuerpo.error.codigo, 'DATO_INVALIDO');
  assert.equal(guardados, 0);
});

test('400: rechaza un booleano incorrecto', async () => {
  const { res } = await probar({ cambios: { tienePatio: 'sí' } });
  assert.equal(res.codigo, 400);
  assert.equal(res.cuerpo.error.codigo, 'DATO_INVALIDO');
});

test('400: exige consentimiento verdadero', async () => {
  const { res } = await probar({ cambios: { consentimientoCohabitantes: false } });
  assert.equal(res.codigo, 400);
  assert.equal(res.cuerpo.error.codigo, 'DATO_INVALIDO');
});

test('409: rechaza animal fallecido', async () => {
  const { res, guardados } = await probar({ estadoAnimal: 'fallecido' });
  assert.equal(res.codigo, 409);
  assert.equal(res.cuerpo.error.codigo, 'ANIMAL_NO_DISPONIBLE');
  assert.equal(guardados, 0);
});

test('409: rechaza vecino con prohibición de tenencia', async () => {
  const { res, guardados } = await probar({ prohibicion: true });
  assert.equal(res.codigo, 409);
  assert.equal(res.cuerpo.error.codigo, 'PROHIBICION_TENENCIA');
  assert.equal(guardados, 0);
});

test('409: rechaza tercera postulación activa', async () => {
  const { res } = await probar({ conflicto: 'LIMITE_POSTULACIONES' });
  assert.equal(res.codigo, 409);
  assert.equal(res.cuerpo.error.codigo, 'LIMITE_POSTULACIONES');
});

test('409: rechaza postulación duplicada', async () => {
  const { res } = await probar({ conflicto: 'POSTULACION_DUPLICADA' });
  assert.equal(res.codigo, 409);
  assert.equal(res.cuerpo.error.codigo, 'POSTULACION_DUPLICADA');
});

test('201: permite una postulación válida', async () => {
  const { res, guardados } = await probar();
  assert.equal(res.codigo, 201);
  assert.equal(guardados, 1);
  assert.equal(res.cuerpo.estado, 'recibida');
  assert.equal(res.encabezados.Location, '/api/adopciones/postulaciones/prueba123');
});
