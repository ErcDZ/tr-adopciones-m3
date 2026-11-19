export function crearClienteNucleo(urlBase, timeoutMs) {
  const base = new URL(urlBase);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password ||
      base.pathname !== '/' || base.search || base.hash) {
    throw new Error('NUCLEO_URL debe ser un origen HTTP o HTTPS sin ruta ni credenciales');
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647) {
    throw new Error('NUCLEO_TIMEOUT_MS debe ser un entero entre 1 y 2147483647');
  }

  return async (ruta, opciones) => {
    try {
      const respuesta = await fetch(new URL(ruta, base), {
        ...opciones,
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
      return { estado: respuesta.status, datos: await respuesta.json() };
    } catch {
      // Incluye caída de red, tiempo de espera y respuestas no JSON.
      return { estado: 503 };
    }
  };
}
