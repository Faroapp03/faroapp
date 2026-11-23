// El desafío WWW-Authenticate que exige un 401 (RFC 9110, 15.5.2). Sirve a las respuestas que solo lo llevan en el 401 y
// con un desafío fijo: Bearer en las llamadas de mantenimiento y Basic en la emisión de tokens de socios. Construyen el
// suyo la consulta de socios, que lo lleva también en el 403 y con el error del token (RFC 6750, 3), y la entrega
// privada de ensayo, que siempre responde 401 cuando lo pide.
import { ESTADO_HTTP } from '../comun/estados-http.ts';

/** Las cabeceras de una respuesta con ese estado: el desafío si es un 401; ninguna en otro caso. */
export function cabecerasDeDesafio(estado: number, desafio = 'Bearer'): { readonly 'www-authenticate'?: string } {
  return estado === ESTADO_HTTP.noAutenticado ? { 'www-authenticate': desafio } : {};
}
