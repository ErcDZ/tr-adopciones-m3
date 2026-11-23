
let token = '';
let postulacionActual = null;
let paginaActual = 1;
let totalPostulaciones = 0;

const inicio = document.getElementById('inicio');
const administracion = document.getElementById('administracion');
const evaluacion = document.getElementById('evaluacion');
const aviso = document.getElementById('aviso');
const salir = document.getElementById('salir');

function mensaje(texto) {
  aviso.textContent = texto;
  aviso.hidden = !texto;
}

// Realizar peticiones a nuestra API
async function peticion(ruta, opciones = {}) {
  const respuesta = await fetch(ruta, {
    ...opciones,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...opciones.headers
    }
  });

  const datos = await respuesta.json();

  if (!respuesta.ok) {
    throw new Error(
      datos.error?.mensaje || 'Ocurrió un error'
    );
  }

  return datos;
}

// INICIAR SESION
document.getElementById('sesion').addEventListener('submit', async evento => {
  evento.preventDefault();
  mensaje('');

  const formulario = new FormData(evento.target);

  try {
    const sesion = await peticion('/api/nucleo/sesiones', {
      method: 'POST',
      body: JSON.stringify({
        rut: formulario.get('rut'),
        clave: formulario.get('clave')
      })
    });

    token = sesion.token;

    // Comprobar que realmente sea funcionario
    await peticion('/api/adopciones/acceso/funcionario');

    inicio.hidden = true;
    administracion.hidden = false;
    salir.hidden = false;

    await cargarPostulaciones();

  } catch (error) {
    token = '';
    inicio.hidden = false;
    administracion.hidden = true;
    salir.hidden = true;
    mensaje(error.message);
  }
});

// LISTAR POSTULACIONES
async function cargarPostulaciones() {
  mensaje('');

  try {
    const resultado = await peticion(
      `/api/adopciones/postulaciones?page=${paginaActual}&limit=10`
    );

    const lista = document.getElementById('lista');
    lista.replaceChildren();

    totalPostulaciones = resultado.total || 0;

    for (const postulacion of resultado.datos) {
      const fila = document.createElement('tr');

      const valores = [
        postulacion.postulacionID,
        postulacion.postulanteRut,
        postulacion.animalID,
        postulacion.estado
      ];

      for (const valor of valores) {
        const celda = document.createElement('td');
        celda.textContent = valor ?? '';
        fila.appendChild(celda);
      }

      const celdaAccion = document.createElement('td');
      const boton = document.createElement('button');

      boton.textContent = 'Evaluar';
      boton.type = 'button';

      boton.addEventListener('click', () => {
        abrirEvaluacion(postulacion.postulacionID);
      });

      celdaAccion.appendChild(boton);
      fila.appendChild(celdaAccion);
      lista.appendChild(fila);
    }

    document.getElementById('pagina').textContent =
      `Página ${paginaActual}`;

    document.getElementById('anterior').disabled =
      paginaActual === 1;

    document.getElementById('siguiente').disabled =
      paginaActual * 10 >= totalPostulaciones;

  } catch (error) {
    mensaje(error.message);
  }
}

// MOSTRAR LOS ANTECEDENTES
async function abrirEvaluacion(id) {
  mensaje('');

  try {
    const respuesta = await peticion(
      `/api/adopciones/postulaciones/${id}`
    );

    const postulacion = respuesta.datos;
    postulacionActual = postulacion.postulacionID;

    const detalle = document.getElementById('detalle');
    detalle.replaceChildren();

    const campos = {
      'RUT': postulacion.postulanteRut,
      'Animal': postulacion.animalID,
      'Estado': postulacion.estado,
      'Vivienda': postulacion.viviendaTipo,
      'Patio': postulacion.tienePatio ? 'Sí' : 'No',
      'Niños': postulacion.hayNinos ? 'Sí' : 'No',
      'Otras mascotas': postulacion.tieneOtrasMascotas ? 'Sí' : 'No',
      'Motivo': postulacion.motivoAdopcion
    };

    for (const [nombre, valor] of Object.entries(campos)) {
      const parrafo = document.createElement('p');
      parrafo.textContent = `${nombre}: ${valor ?? ''}`;
      detalle.appendChild(parrafo);
    }

    // Consultar habilitación desde el backend
    const persona = await peticion(
      `/api/adopciones/funcionarios/usuarios/${encodeURIComponent(postulacion.postulanteRut)}`
    );

    document.getElementById('habilitacion').textContent =
      persona.datos.prohibicionTenencia
        ? 'El postulante tiene prohibición de tenencia'
        : 'El postulante no registra prohibición de tenencia';

    document.getElementById('formEvaluacion').reset();

    administracion.hidden = true;
    evaluacion.hidden = false;

  } catch (error) {
    mensaje(error.message);
  }
}

// GUARDAR EVALUACION
document.getElementById('formEvaluacion').addEventListener('submit', async evento => {
  evento.preventDefault();
  mensaje('');

  const formulario = new FormData(evento.target);

  const estado = formulario.get('estado');
  const observaciones = String(
    formulario.get('observaciones') || ''
  ).trim();

  if (!estado || !observaciones) {
    mensaje('Debes seleccionar un estado e ingresar observaciones');
    return;
  }

  try {
    const resultado = await peticion(
      `/api/adopciones/postulaciones/${postulacionActual}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ estado, observaciones })
      }
    );

    evaluacion.hidden = true;
    administracion.hidden = false;

    await cargarPostulaciones();

    mensaje(
      `Estado actualizado. Postulaciones canceladas: ${resultado.canceladas || 0}`
    );

  } catch (error) {
    mensaje(error.message);
  }
});

// ACTUALIZAR LISTADO
document.getElementById('actualizar').addEventListener('click', cargarPostulaciones);

// PAGINACION
document.getElementById('anterior').addEventListener('click', async () => {
  if (paginaActual > 1) {
    paginaActual--;
    await cargarPostulaciones();
  }
});

document.getElementById('siguiente').addEventListener('click', async () => {
  if (paginaActual * 10 < totalPostulaciones) {
    paginaActual++;
    await cargarPostulaciones();
  }
});

// VOLVER AL LISTADO
document.getElementById('volver').addEventListener('click', () => {
  evaluacion.hidden = true;
  administracion.hidden = false;
  mensaje('');
});

// CERRAR SESION
salir.addEventListener('click', () => {
  token = '';
  postulacionActual = null;
  paginaActual = 1;

  inicio.hidden = false;
  administracion.hidden = true;
  evaluacion.hidden = true;
  salir.hidden = true;

  document.getElementById('sesion').reset();
  mensaje('');
});
