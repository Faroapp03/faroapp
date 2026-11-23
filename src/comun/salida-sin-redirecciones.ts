/**
 * Salida HTTP que no sigue redirecciones y se comporta igual en workerd, en el navegador y en Node. workerd solo
 * admite los modos `follow` y `manual` de `redirect` y rechaza el modo `error` al crear la petición, así que se pide
 * en modo `manual` y la redirección se rechaza aquí: llega como respuesta 3xx (workerd y Node) o como
 * `opaqueredirect` (navegador).
 */

const PRIMER_ESTADO_REDIRECCION = 300;
const ULTIMO_ESTADO_REDIRECCION = 399;

/**
 * La respuesta era una redirección y no se ha seguido. Es un `TypeError`, como el rechazo de `fetch` en el modo
 * `error`, para que cada llamador lo clasifique igual que cualquier otra petición rechazada.
 */
export class RedireccionRechazada extends TypeError {
  constructor() {
    super('La respuesta es una redirección y no se sigue');
    this.name = 'RedireccionRechazada';
  }
}

export function esRedireccion(respuesta: Response): boolean {
  return (
    respuesta.type === 'opaqueredirect' ||
    respuesta.redirected ||
    (respuesta.status >= PRIMER_ESTADO_REDIRECCION && respuesta.status <= ULTIMO_ESTADO_REDIRECCION)
  );
}

/**
 * Pide sin seguir redirecciones; una redirección se rechaza con `RedireccionRechazada` sin leer su cuerpo. `redirect`
 * va siempre en las opciones, que prevalecen sobre las de una `Request` recibida.
 */
export async function pedirSinRedirecciones(
  entrada: Request | URL | string,
  opciones?: RequestInit,
  pedir: typeof fetch = fetch,
): Promise<Response> {
  const respuesta = await pedir(entrada, { ...opciones, redirect: 'manual' });
  if (esRedireccion(respuesta)) {
    void respuesta.body?.cancel().catch(() => undefined);
    throw new RedireccionRechazada();
  }
  return respuesta;
}
