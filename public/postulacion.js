const porId = id => document.getElementById(id);
const inicio = porId('inicio');
const sesion = porId('sesion');
const catalogo = porId('catalogo');
const solicitud = porId('solicitud');
const formulario = porId('postulacion');
const aviso = porId('aviso');
const resultado = porId('resultado');
const salir = porId('salir');
const recargar = porId('recargar');
let token;
let animalID;

const conflictos = new Map([
  ['LIMITE_POSTULACIONES', 'Ya tienes el máximo de dos postulaciones.'],
  ['PROHIBICION_TENENCIA', 'Existe una prohibición de tenencia asociada a tu cuenta.'],
  ['ANIMAL_NO_DISPONIBLE', 'El animal ya no está disponible para adopción.'],
]);

function mostrar(elemento, texto = '') {
  elemento.textContent = texto;
  elemento.hidden = !texto;
  if (elemento === aviso && texto) elemento.focus();
}

async function api(ruta, { bearer, datos } = {}) {
  const headers = { Accept: 'application/json' };
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  if (datos) headers['Content-Type'] = 'application/json';
  const respuesta = await fetch(ruta, {
    method: datos ? 'POST' : 'GET',
    headers,
    body: datos ? JSON.stringify(datos) : undefined,
  });
  const cuerpo = await respuesta.json().catch(() => null);
  return { estado: respuesta.status, cuerpo };
}

function mensaje(cuerpo, alternativa) {
  const detalle = cuerpo?.error?.mensaje ?? cuerpo?.mensaje;
  return typeof detalle === 'string' && detalle.trim() ? detalle : alternativa;
}

function cerrarSesion(texto) {
  token = undefined;
  animalID = undefined;
  formulario.reset();
  catalogo.hidden = solicitud.hidden = salir.hidden = true;
  inicio.hidden = false;
  mostrar(resultado);
  mostrar(aviso, texto);
}

salir.addEventListener('click', () => cerrarSesion());
recargar.addEventListener('click', cargarCatalogo);

async function cargarCatalogo() {
  const activo = token;
  const animales = porId('animales');
  animales.replaceChildren();
  recargar.hidden = true;
  mostrar(aviso);
  try {
    const { estado, cuerpo } = await api('/api/adopciones/catalogo', { bearer: activo });
    if (activo !== token) return;
    if (estado === 401) return cerrarSesion('Tu sesión expiró. Inicia sesión nuevamente.');
    if (estado !== 200 || !Array.isArray(cuerpo?.datos)) throw new Error();
    const disponibles = cuerpo.datos.filter(animal => typeof animal?.animalID === 'string' && animal.animalID.trim());
    if (disponibles.length === 0) animales.textContent = 'No hay animales disponibles.';
    for (const animal of disponibles) {
      const fila = document.createElement('article');
      const nombre = document.createElement('strong');
      nombre.textContent = animal.nombre || animal.animalID;
      const boton = document.createElement('button');
      boton.type = 'button';
      boton.textContent = 'Solicitar adopción';
      boton.setAttribute('aria-label', `Solicitar adopción de ${nombre.textContent}`);
      boton.addEventListener('click', () => elegirAnimal(animal.animalID, nombre.textContent));
      fila.append(nombre, boton);
      animales.append(fila);
    }
  } catch {
    if (activo !== token) return;
    mostrar(aviso, 'No pudimos cargar el catálogo. Intenta nuevamente.');
    recargar.hidden = false;
  }
}

function elegirAnimal(id, nombre) {
  if (!token) return;
  animalID = id;
  porId('animal').textContent = nombre === id ? id : `${nombre} (${id})`;
  formulario.reset();
  mostrar(aviso);
  mostrar(resultado);
  catalogo.hidden = true;
  solicitud.hidden = false;
  porId('titulo').focus();
}

porId('volver').addEventListener('click', () => {
  solicitud.hidden = true;
  catalogo.hidden = false;
  animalID = undefined;
  mostrar(aviso);
});

sesion.addEventListener('submit', async evento => {
  evento.preventDefault();
  const boton = sesion.querySelector('button');
  if (boton.disabled) return;
  boton.disabled = true;
  mostrar(aviso);
  const datos = Object.fromEntries(new FormData(sesion));
  try {
    const login = await api('/api/nucleo/sesiones', { datos });
    if (login.estado !== 201 || !login.cuerpo?.token) {
      return mostrar(aviso, mensaje(login.cuerpo, 'No pudimos iniciar sesión.'));
    }
    const validacion = await api('/api/adopciones/acceso/vecino', { bearer: login.cuerpo.token });
    if (validacion.estado === 403) return mostrar(aviso, 'Solo las cuentas con perfil vecino pueden postular.');
    if (validacion.estado !== 200 || validacion.cuerpo?.perfil !== 'vecino') {
      return mostrar(aviso, mensaje(validacion.cuerpo, 'No pudimos validar tu sesión.'));
    }
    token = login.cuerpo.token;
    inicio.hidden = true;
    salir.hidden = catalogo.hidden = false;
    await cargarCatalogo();
  } catch {
    mostrar(aviso, 'No pudimos conectar con el servicio. Intenta nuevamente.');
  } finally {
    sesion.elements.clave.value = '';
    boton.disabled = false;
  }
});

formulario.addEventListener('submit', async evento => {
  evento.preventDefault();
  const boton = formulario.querySelector('button');
  if (!token || !animalID || boton.disabled) return;
  mostrar(aviso);
  const campos = new FormData(formulario);
  const motivoAdopcion = campos.get('motivoAdopcion').trim();
  if (!motivoAdopcion) {
    mostrar(aviso, 'Escribe el motivo de adopción.');
    formulario.elements.motivoAdopcion.focus();
    return;
  }

  const activo = token;
  const datos = {
    animalID,
    viviendaTipo: campos.get('viviendaTipo'),
    tienePatio: campos.get('tienePatio') === 'si',
    hayNinos: campos.get('hayNinos') === 'si',
    tieneOtrasMascotas: campos.get('tieneOtrasMascotas') === 'si',
    motivoAdopcion,
    consentimientoCohabitantes: campos.has('consentimientoCohabitantes'),
  };
  boton.disabled = true;
  porId('volver').disabled = true;
  salir.disabled = true;
  try {
    const { estado, cuerpo } = await api('/api/adopciones/postulaciones', { bearer: activo, datos });
    if (activo !== token) return;
    if (estado === 201) {
      const id = cuerpo?.postulacionID;
      solicitud.hidden = true;
      catalogo.hidden = false;
      formulario.reset();
      animalID = undefined;
      if ((typeof id === 'string' && id.trim()) || Number.isSafeInteger(id)) {
        mostrar(resultado, `Solicitud recibida. Código de postulación ${id}.`);
        resultado.focus();
      } else {
        mostrar(aviso, 'El servidor recibió la solicitud, pero no devolvió su código.');
      }
      return;
    }
    if (estado === 400) return mostrar(aviso, mensaje(cuerpo, 'Revisa que todos los datos obligatorios estén completos y sean válidos.'));
    if (estado === 409) {
      const codigo = cuerpo?.error?.codigo ?? cuerpo?.error;
      return mostrar(aviso, conflictos.get(codigo) ?? mensaje(cuerpo, 'No puedes postular en este momento. Revisa tus postulaciones y la disponibilidad del animal.'));
    }
    if (estado === 401) return cerrarSesion('Tu sesión expiró. Inicia sesión nuevamente.');
    if (estado === 403) return cerrarSesion('Tu cuenta no tiene permiso para postular.');
    mostrar(aviso, 'No pudimos confirmar el envío. Verifica tu solicitud antes de volver a enviarla.');
  } catch {
    if (activo === token) mostrar(aviso, 'Se perdió la conexión. Verifica tu solicitud antes de volver a enviarla.');
  } finally {
    boton.disabled = false;
    porId('volver').disabled = false;
    salir.disabled = false;
  }
});
