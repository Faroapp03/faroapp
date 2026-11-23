/**
 * Canal de avisos del vigilante: una petición HTTPS a la dirección que la entidad guarda como secreto
 * (`FARO_AVISO_URL`). Con las mismas guardas que la consulta a GitHub: identidad web genérica, plazo propio, sin
 * seguir redirecciones (`pedirSinRedirecciones`) y sin leer más que el estado de la respuesta.
 */
import { dentroDelPlazo } from '../api/plazo.ts';
import type { VariablesDelEntorno } from '../comun/entorno.ts';
import { cabecerasIdentidadWeb } from '../comun/identidad-web.ts';
import { pedirSinRedirecciones, RedireccionRechazada } from '../comun/salida-sin-redirecciones.ts';
import type { CuerpoAvisoVigilante } from './aviso-vigilante.ts';
import { exigirTrabajo, objetoTrabajo } from './estado-trabajos.js';
import { motivoDeLaCausa } from './fallo-programado.ts';

export const PLAZO_AVISO_MS = 3000;
const MAX_DESTINO = 2048;
const ESTADO_CORRECTO_MIN = 200;
const ESTADO_CORRECTO_MAX = 299;
export class DestinoAvisoInvalido extends Error {}
export type MotivoFalloAviso = 'respuesta-no-admitida' | 'sin-respuesta' | 'plazo-agotado' | 'destino-no-admitido';
export type ResultadoEnvioAviso =
  | Readonly<{ resultado: 'enviado' }>
  | Readonly<{ resultado: 'fallido'; motivo: MotivoFalloAviso }>;

export const MOTIVOS_FALLO_AVISO: readonly MotivoFalloAviso[] = [
  'respuesta-no-admitida',
  'sin-respuesta',
  'plazo-agotado',
  'destino-no-admitido',
];
export function leerResultadoEnvioAviso(entrada: unknown): ResultadoEnvioAviso {
  const o = objetoTrabajo(
    entrada,
    entrada && typeof entrada === 'object' && 'motivo' in entrada ? 'motivo,resultado' : 'resultado',
  );
  if (o.resultado === 'enviado' && o.motivo === undefined) {
    return Object.freeze({ resultado: 'enviado' });
  }
  const motivo = MOTIVOS_FALLO_AVISO.find((m) => m === o.motivo);
  exigirTrabajo(o.resultado === 'fallido' && motivo !== undefined);
  return Object.freeze({ resultado: 'fallido', motivo });
}
/** Solo `https:`, sin usuario ni contraseña en la dirección. Ausente: los avisos no están configurados. */
export function destinoAvisoDelEntorno(variables: VariablesDelEntorno): URL | undefined {
  const texto = variables.FARO_AVISO_URL;
  if (texto === undefined || texto === '') {
    return undefined;
  }
  let destino: URL;
  try {
    destino = new URL(texto);
  } catch {
    throw new DestinoAvisoInvalido('FARO_AVISO_URL no es una dirección válida');
  }
  if (
    destino.protocol !== 'https:' ||
    destino.username !== '' ||
    destino.password !== '' ||
    texto.length > MAX_DESTINO
  ) {
    throw new DestinoAvisoInvalido('FARO_AVISO_URL tiene que ser https y sin credenciales en la dirección');
  }
  return destino;
}
/** Un fallo no se lanza: se devuelve con su motivo para registrarlo, sin el texto de la respuesta. */
export async function enviarAviso(
  destino: URL,
  cuerpo: CuerpoAvisoVigilante,
  pedir: typeof fetch = fetch,
): Promise<ResultadoEnvioAviso> {
  try {
    const respuesta = await dentroDelPlazo(async (senal) => {
      const peticion = new Request(destino, {
        method: 'POST',
        redirect: 'manual',
        signal: senal,
        headers: { ...cabecerasIdentidadWeb(), 'content-type': 'application/json' },
        body: JSON.stringify(cuerpo),
      });
      const recibida = await pedirSinRedirecciones(peticion, undefined, pedir);
      void recibida.body?.cancel().catch(() => undefined);
      return recibida;
    }, PLAZO_AVISO_MS);
    const admitida =
      !respuesta.redirected && respuesta.status >= ESTADO_CORRECTO_MIN && respuesta.status <= ESTADO_CORRECTO_MAX;
    return admitida ? { resultado: 'enviado' } : { resultado: 'fallido', motivo: 'respuesta-no-admitida' };
  } catch (causa) {
    // Una redirección es una respuesta: el servicio que recibe los avisos no la ha aceptado.
    if (causa instanceof RedireccionRechazada) {
      return { resultado: 'fallido', motivo: 'respuesta-no-admitida' };
    }
    return {
      resultado: 'fallido',
      motivo: motivoDeLaCausa(causa) === 'plazo-agotado' ? 'plazo-agotado' : 'sin-respuesta',
    };
  }
}
