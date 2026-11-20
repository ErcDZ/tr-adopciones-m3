const ESTADOS_ANIMAL = ['registrado', 'con_microchip', 'inscrito', 'fallecido', 'adoptado'];
const APTOS = ['con_microchip', 'inscrito'];
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

export const RUTA_ANIMALES_DISPONIBLES = '/api/adopciones/animales-disponibles';

function enterPositivo(valor, defecto) {
  if (valor === undefined || valor === null || String(valor).trim() === '') {
    return defecto;
  }
  if (!/^\d+$/.test(String(valor).trim())) {
    return null;
  }
  const numero = Number.parseInt(String(valor).trim(), 10);
  return Number.isSafeInteger(numero) && numero >= 1 ? numero : null;
}

function extraerListaAnimales(datos) {
  if (Array.isArray(datos)) return datos;
  if (Array.isArray(datos?.datos)) return datos.datos;
  if (Array.isArray(datos?.animales)) return datos.animales;
  return null;
}

function esAnimalDisponible(item) {
  if (!item || typeof item !== 'object') return false;
  const id = item.animalID ?? item.animalId;
  const estado = typeof item.estado === 'string' ? item.estado.trim().toLowerCase() : '';
  const estaFallecido = item.fallecido === true || estado === 'fallecido';
  const estaAdoptado =
    item.adoptado === true ||
    item.disponible === false ||
    item.disponibleAdopcion === false ||
    ['adoptado', 'no_disponible', 'registrado'].includes(estado);

  if (!id || estaFallecido || estaAdoptado) return false;
  if (estado && ESTADOS_ANIMAL.includes(estado) && !APTOS.includes(estado)) return false;
  if (!item.microchip && !item.microship) return false;

  return true;
}

function normalizarAnimal(item) {
  return {
    animalID: String(item.animalID ?? item.animalId),
    especie: item.especie ?? '',
    nombre: item.nombre ?? '',
    microship: String(item.microship ?? item.microchip ?? ''),
  };
}

export function listarAnimalesDisponibles({ consultarRegistro, tokenRegistro, error }) {
  return async (req, res) => {
    const page = enterPositivo(req.query?.page, DEFAULT_PAGE);
    const limit = enterPositivo(req.query?.limit, DEFAULT_LIMIT);

    if (!page || !limit || limit > MAX_LIMIT) {
      return error(
        res,
        400,
        'PARAMETROS_PAGINACION_INVALIDOS',
        `Los parámetros page y limit deben ser enteros positivos (limit máximo ${MAX_LIMIT})`
      );
    }

    const especieFiltro =
      typeof req.query?.especie === 'string' && req.query.especie.trim().length > 0
        ? req.query.especie.trim().toLowerCase()
        : null;

    const usuarioAuth = req.get('Authorization');
    const respuesta = await consultarRegistro('/api/registro/animales', {
      headers: { Authorization: tokenRegistro ? `Bearer ${tokenRegistro}` : usuarioAuth },
    });

    if (respuesta.estado === 401) {
      return error(res, 401, 'TOKEN_INVALIDO', 'El token no es válido o expiró');
    }

    const listaBruta = extraerListaAnimales(respuesta.datos);
    if (respuesta.estado !== 200 || !listaBruta) {
      return error(
        res,
        503,
        'SERVICIO_NO_DISPONIBLE',
        'No pudimos obtener el listado de animales desde el registro'
      );
    }

    const filtrados = listaBruta
      .filter(esAnimalDisponible)
      .filter((item) => {
        if (!especieFiltro) return true;
        return String(item.especie ?? '').trim().toLowerCase() === especieFiltro;
      })
      .map(normalizarAnimal);

    const total = filtrados.length;
    const inicio = (page - 1) * limit;
    const datos = filtrados.slice(inicio, inicio + limit);

    return res.set('Cache-Control', 'no-store').status(200).json({
      page,
      limit,
      total,
      datos,
    });
  };
}