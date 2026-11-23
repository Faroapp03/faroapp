import assert from 'node:assert/strict';

/** El estado con que se pide identificarse; se escribe aquí y no se toma de la tabla del código que se prueba. */
const NO_AUTENTICADO = 401;

/** Los esquemas con que las puertas de Faro piden la identificación en un 401. */
export type EsquemaDesafio = 'Basic' | 'Bearer';

/**
 * Devuelve la misma respuesta tras comprobar que, si es un 401, lleva `WWW-Authenticate` con el desafío del esquema de
 * su puerta (RFC 9110, 15.5.2), y en Basic con su `realm` (RFC 7617, 2). Con otro estado no exige nada. Mira la
 * respuesta y no el código: es la prueba que manda sobre la guardia textual de `pruebas/seguridad`.
 */
export function asegurarDesafioSi401<R extends Response>(respuesta: R, esquema: EsquemaDesafio): R {
  if (respuesta.status !== NO_AUTENTICADO) {
    return respuesta;
  }
  const desafio = respuesta.headers.get('www-authenticate') ?? '';
  assert.match(desafio, new RegExp(`^${esquema}(?:\\s|$)`, 'i'), `Un 401 sin el desafío ${esquema}: «${desafio}»`);
  if (esquema === 'Basic') {
    assert.match(desafio, /\brealm="[^"]*"/i, `Un desafío Basic sin realm: «${desafio}»`);
  }
  return respuesta;
}

/** La puerta, con cada una de sus respuestas pasada por `asegurarDesafioSi401`. */
export function conDesafio<A extends unknown[]>(
  puerta: (...argumentos: A) => Promise<Response>,
  esquema: EsquemaDesafio,
): (...argumentos: A) => Promise<Response> {
  return async (...argumentos) => asegurarDesafioSi401(await puerta(...argumentos), esquema);
}
