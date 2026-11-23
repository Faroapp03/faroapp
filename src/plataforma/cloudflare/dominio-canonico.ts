// Una sola dirección para Faro: www.<dominio> redirige de forma permanente a https://<dominio>, con la misma ruta y la
// misma consulta. Así la web y la API comparten siempre un único origen y FARO_ORIGENES no tiene que abrir ningún otro.
// La regla de la zona debe redirigir www (docs/despliegue.md, «Dirección»). Si una petición a www llega al Worker, este
// hace la misma redirección antes de servir nada: el oficial, antes de la portada, robots.txt y el formulario de acceso
// (worker-oficial.ts); el general, antes de sus páginas (worker.ts). Ninguno publica una segunda copia del sitio.

/** El prefijo del nombre de dominio que se redirige. */
const PREFIJO_WWW = 'www.';
/** Redirección permanente: los navegadores y los buscadores la recuerdan. */
const REDIRECCION_PERMANENTE = 301;

/**
 * Redirige www.<dominio> a https://<dominio> en un solo salto, también si la petición llegó por http. El destino sale
 * solo del nombre de la dirección pedida, nunca de sus parámetros. Cada salto quita un prefijo, así que la cadena
 * termina siempre: no hay bucles.
 *
 * @param url - La dirección pedida.
 * @returns La redirección 301 al dominio sin «www», o null si la dirección ya es la principal.
 */
export function redireccionAlDominioPrincipal(url: URL): Response | null {
  if (!url.hostname.startsWith(PREFIJO_WWW)) {
    return null;
  }
  const principal = new URL(url);
  principal.protocol = 'https:';
  principal.hostname = url.hostname.slice(PREFIJO_WWW.length);
  return Response.redirect(principal, REDIRECCION_PERMANENTE);
}

/**
 * Rechaza rutas mal codificadas o con otra codificación residual y redirige www.<dominio> a <dominio>.
 *
 * @param url - La dirección pedida.
 * @returns 400 para rutas inválidas o ambiguas, la redirección 301 al dominio sin «www», o null.
 */
export function respuestaDeRutaCanonica(url: URL): Response | null {
  // Una secuencia inválida no debe ocultar un alias reservado ni llegar al proveedor de archivos.
  try {
    const ruta = decodeURIComponent(url.pathname);
    if (/%[0-9a-f]{2}/i.test(ruta)) {
      return new Response(null, { status: 400 });
    }
  } catch {
    return new Response(null, { status: 400 });
  }
  return redireccionAlDominioPrincipal(url);
}
