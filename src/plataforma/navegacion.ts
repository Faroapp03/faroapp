/**
 * Si una petición es la carga de una página, igual en el Worker y en el servidor local: el portal, el recorrido y la
 * página de una dirección que no existe deciden con ella qué recibe una navegación y qué un guion, una API o un recurso.
 */

const ACEPTA_HTML = /(?:^|,)\s*text\/html(?:\s*[;,]|$)/i;

/** Lo que se mira de una petición para saber si es la carga de una página: su método y sus cabeceras. */
export interface PeticionLeida {
  readonly method: string;
  readonly headers: Pick<Headers, 'get'>;
}

/**
 * Si la petición es la carga de una página. Sin metadatos de Fetch decide la aceptación de HTML; también cuando un
 * service worker reenvía una navegación, que llega con modo same-origin y, según el navegador, destino empty.
 */
export function esNavegacion(peticion: Pick<PeticionLeida, 'headers'>): boolean {
  const modo = peticion.headers.get('sec-fetch-mode');
  const destino = peticion.headers.get('sec-fetch-dest');
  if (modo === 'navigate' || destino === 'document') {
    return true;
  }
  const reenviada = (modo === null || modo === 'same-origin') && (destino === null || destino === 'empty');
  return reenviada && ACEPTA_HTML.test(peticion.headers.get('accept') ?? '');
}

/** Si la petición es la carga de una página con GET. */
export function esCargaDePagina(peticion: PeticionLeida): boolean {
  return peticion.method === 'GET' && esNavegacion(peticion);
}
