export const RUTA_CATALOGO = '/api/adopciones/catalogo';
export const LIMITE_MAXIMO = 100;

const RUTA_M1_ANIMALES = '/api/registro/animales';
const PARAMETROS_PERMITIDOS = ['pagina', 'limite', 'especie'];
const ENTERO_POSITIVO = /^[1-9]\d{0,8}$/; // sin signo, decimales, notación científica ni ceros a la izquierda
const ESPECIE = /^[a-záéíóúüñ]{1,30}$/i; // solo letras; nunca se concatena en consultas
const APTOS = ['con_microchip', 'inscrito'];

// Valida los parámetros de consulta (OWASP: lista blanca, tipo y rango). Función pura.
export function leerConsultaCatalogo(query) {
  if (Object.keys(query).some(clave => !PARAMETROS_PERMITIDOS.includes(clave))) {
    return { mensaje: 'La consulta contiene parámetros no permitidos' };
  }
  if (PARAMETROS_PERMITIDOS.some(clave => query[clave] !== undefined && typeof query[clave] !== 'string')) {
    return { mensaje: 'Cada parámetro debe indicarse una sola vez' };
  }
  const pagina = query.pagina ?? '1';
  if (!ENTERO_POSITIVO.test(pagina)) {
    return { mensaje: 'pagina debe ser un entero positivo' };
  }
  const limite = query.limite ?? String(LIMITE_MAXIMO);
  if (!ENTERO_POSITIVO.test(limite) || Number(limite) > LIMITE_MAXIMO) {
    return { mensaje: `limite debe ser un entero entre 1 y ${LIMITE_MAXIMO}` };
  }
  if (query.especie !== undefined && !ESPECIE.test(query.especie)) {
    return { mensaje: 'especie debe contener solo letras (máximo 30)' };
  }
  return {
    consulta: { pagina: Number(pagina), limite: Number(limite), especie: query.especie?.toLowerCase() },
  };
}

export function validarConsultaCatalogo({ error }) {
  return (req, res, next) => {
    const { consulta, mensaje } = leerConsultaCatalogo(req.query);
    if (!consulta) return error(res, 400, 'PARAMETROS_INVALIDOS', mensaje);
    req.consulta = consulta;
    next();
  };
}

export function listarCatalogo({ consultarRegistro, tokenRegistro, error }) {
  return async (req, res) => {
    const { pagina, limite, especie } = req.consulta;
    const respuesta = await consultarRegistro(RUTA_M1_ANIMALES, {
      headers: { Authorization: tokenRegistro ? `Bearer ${tokenRegistro}` : req.get('Authorization') },
    });
    const lista = Array.isArray(respuesta.datos) ? respuesta.datos : respuesta.datos?.datos;
    if (respuesta.estado !== 200 || !Array.isArray(lista)) {
      // Caída, tiempo de espera, acceso denegado o respuesta inesperada de M1: sin detalles internos.
      return error(res, 503, 'SERVICIO_NO_DISPONIBLE', 'No pudimos cargar el catálogo en este momento');
    }

    const disponibles = lista
      .filter(animal => typeof animal?.animalId === 'string' && animal.animalId && animal.microchip &&
        APTOS.includes(animal.estado) && (!especie || String(animal.especie ?? '').toLowerCase() === especie))
      .map(animal => ({
        animalID: animal.animalId,
        nombre: typeof animal.nombre === 'string' && animal.nombre.trim() ? animal.nombre : animal.animalId,
      }));
    const inicio = (pagina - 1) * limite;
    return res.set('Cache-Control', 'no-store')
      .json({ datos: disponibles.slice(inicio, inicio + limite), pagina, limite, total: disponibles.length });
  };
}
