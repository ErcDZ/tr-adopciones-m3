import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, beforeEach, test } from 'node:test';
import { crearApp } from '../../../adopcion-animales/src/app.js';

const RUTA = '/api/adopciones/catalogo';
const perfiles = new Map([
  ['demo.vecino', { rut: '10000000-8', perfil: 'vecino' }],
  ['demo.funcionario', { rut: '20000000-1', perfil: 'funcionario' }],
]);
const animales = [
  { animalId: 'SIM-000001', nombre: 'Cholito', especie: 'perro', microchip: '985000000000001', estado: 'con_microchip' },
  { animalId: 'SIM-000002', nombre: 'Michi', especie: 'gato', microchip: '985000000000002', estado: 'inscrito' },
  { animalId: 'SIM-000003', nombre: 'Sin chip', especie: 'perro', estado: 'registrado' },
  ...Array.from({ length: 150 }, (_, i) => ({
    animalId: `SIM-1${String(i).padStart(5, '0')}`, nombre: `Perro ${i}`, especie: 'perro',
    microchip: `98500000001${i}`, estado: 'inscrito',
  })),
];
const cabecera = token => ({ Authorization: `Bearer ${token}` });
const con = token => ({ headers: cabecera(token) });

function json(res, estado, datos) {
  res.writeHead(estado, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(datos));
}

let modoM1 = 'ok';
function nucleo(req, res) {
  const usuario = perfiles.get(req.headers.authorization?.slice(7));
  if (req.url === '/api/nucleo/sesiones/actual') return usuario ? json(res, 200, usuario) : json(res, 401, {});
  if (req.url === '/api/registro/animales') {
    if (modoM1 === 'caido') return res.destroy();
    if (modoM1 === 'lento') return; // nunca responde: provoca el tiempo de espera
    if (modoM1 === 'html') { res.writeHead(502, { 'Content-Type': 'text/html' }); return res.end('<h1>Error interno host-m1:8081</h1>'); }
    if (modoM1 === 'denegado') return json(res, 403, { error: { codigo: 'ACCESO_DENEGADO' } });
    return json(res, 200, { datos: animales });
  }
  return json(res, 404, {});
}

async function escuchar(servidor) {
  await new Promise((resolve, reject) => {
    servidor.once('error', reject);
    servidor.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${servidor.address().port}`;
}
const cerrar = servidor => new Promise((resolve, reject) => servidor.close(err => err ? reject(err) : resolve()));

let core; let modulo; let base;
before(async () => {
  core = createServer(nucleo);
  const nucleoUrl = await escuchar(core);
  modulo = createServer(crearApp({ nucleoUrl, timeoutMs: 300 }));
  base = await escuchar(modulo);
});
after(async () => {
  modulo.closeAllConnections();
  core.closeAllConnections();
  await Promise.all([cerrar(modulo), cerrar(core)]);
});
beforeEach(() => { modoM1 = 'ok'; });

async function pedir(consulta = '', opciones = con('demo.vecino')) {
  const respuesta = await fetch(`${base}${RUTA}${consulta}`, opciones);
  return { estado: respuesta.status, cuerpo: await respuesta.json() };
}
function esErrorEstandar(cuerpo, codigo) {
  assert.deepEqual(Object.keys(cuerpo), ['error']);
  assert.deepEqual(Object.keys(cuerpo.error).sort(), ['codigo', 'mensaje']);
  assert.equal(cuerpo.error.codigo, codigo);
}

test('200: lista solo animales aptos con animalID', async () => {
  const { estado, cuerpo } = await pedir('?limite=2');
  assert.equal(estado, 200);
  assert.deepEqual(cuerpo.datos, [
    { animalID: 'SIM-000001', nombre: 'Cholito' },
    { animalID: 'SIM-000002', nombre: 'Michi' },
  ]);
  assert.equal(cuerpo.total, 152); // excluye al animal sin microchip
});

test('200: filtra por especie y pagina', async () => {
  const { estado, cuerpo } = await pedir('?especie=GATO');
  assert.equal(estado, 200);
  assert.deepEqual(cuerpo.datos, [{ animalID: 'SIM-000002', nombre: 'Michi' }]);
  assert.equal((await pedir('?pagina=2&limite=100')).cuerpo.datos.length, 52);
});

test('200: valores por defecto y límite máximo 100 aceptado', async () => {
  const sinParametros = await pedir();
  assert.equal(sinParametros.cuerpo.datos.length, 100);
  assert.equal(sinParametros.cuerpo.pagina, 1);
  assert.equal((await pedir('?limite=100')).estado, 200);
});

for (const consulta of [
  'pagina=0', 'pagina=-1', 'pagina=abc', 'pagina=1.5', 'pagina=1e2', 'pagina=01', 'pagina=',
  'limite=0', 'limite=-5', 'limite=101', 'limite=9999999999', 'limite=10;DROP',
  "especie=perro'%20OR%20'1'='1", 'especie=gato;DROP', 'especie=%24ne', 'especie=', `especie=${'a'.repeat(31)}`,
  'especie[$ne]=x', 'pagina[$gt]=0', 'pagina=1&pagina=2', 'otro=1',
]) {
  test(`400: rechaza ?${consulta}`, async () => {
    const { estado, cuerpo } = await pedir(`?${consulta}`);
    assert.equal(estado, 400);
    esErrorEstandar(cuerpo, 'PARAMETROS_INVALIDOS');
    assert.doesNotMatch(cuerpo.error.mensaje, /DROP|\$ne|\$gt|OR '1'/); // no refleja la entrada
  });
}

test('401: sin token, encabezado mal formado y token inválido', async () => {
  for (const [opciones, codigo] of [
    [{}, 'TOKEN_REQUERIDO'],
    [{ headers: { Authorization: 'Basic abc' } }, 'TOKEN_INVALIDO'],
    [con('desconocido'), 'TOKEN_INVALIDO'],
  ]) {
    const { estado, cuerpo } = await pedir('', opciones);
    assert.equal(estado, 401);
    esErrorEstandar(cuerpo, codigo);
  }
});

test('401 se evalúa antes que 400', async () => {
  const { estado, cuerpo } = await pedir('?limite=999', {});
  assert.equal(estado, 401);
  esErrorEstandar(cuerpo, 'TOKEN_REQUERIDO');
});

test('403: el perfil funcionario no usa el catálogo del vecino', async () => {
  const { estado, cuerpo } = await pedir('', con('demo.funcionario'));
  assert.equal(estado, 403);
  esErrorEstandar(cuerpo, 'PERFIL_NO_AUTORIZADO');
});

for (const modo of ['caido', 'lento', 'html', 'denegado']) {
  test(`503: M1 ${modo} responde SERVICIO_NO_DISPONIBLE sin detalles internos`, async () => {
    modoM1 = modo;
    const { estado, cuerpo } = await pedir();
    assert.equal(estado, 503);
    esErrorEstandar(cuerpo, 'SERVICIO_NO_DISPONIBLE');
    assert.doesNotMatch(JSON.stringify(cuerpo), /host-m1|8081|ECONN|timeout|abort|stack/i);
  });
}
