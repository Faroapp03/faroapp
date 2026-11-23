/**
 * Sincronización con el grupo de Cloudflare Access de los administradores. El Worker solo toca ese grupo: lo lee,
 * sustituye sus reglas de correo por la lista de Faro conservando el nombre y cualquier otra regla, y al retirar a
 * alguien cierra sus sesiones de Access. Cada llamada tiene su plazo y no se repite sola: un fallo vuelve al panel,
 * que lo anota y deja reintentarlo.
 */

import { pedirSinRedirecciones } from '../comun/salida-sin-redirecciones.ts';

const API = 'https://api.cloudflare.com/client/v4';
/** Tres llamadas caben holgadas en el plazo de cinco segundos de cada petición del panel. */
export const PLAZO_LLAMADA_ACCESS_MS = 1500;
/** Un grupo con cincuenta correos y unas pocas reglas más ocupa unos pocos KiB. */
const MAX_RESPUESTA_ACCESS_BYTES = 65_536;

/** Lo único que necesita el Worker para tocar el grupo: la cuenta, el grupo y un token con ese único permiso. */
export interface DestinoGrupoAccess {
  readonly cuenta: string;
  readonly grupo: string;
  readonly token: string;
}
export type ResultadoAccess = 'correcta' | 'fallida';
export interface GrupoAccess {
  /** Deja en el grupo exactamente estos correos, sin tocar las reglas que no son de correo. */
  sincronizar(correos: readonly string[], senal: AbortSignal): Promise<ResultadoAccess>;
  /** Cierra las sesiones de Access de ese correo. */
  revocar(correo: string, senal: AbortSignal): Promise<ResultadoAccess>;
}
type Regla = Readonly<Record<string, unknown>>;
interface GrupoLeido {
  readonly name: string;
  readonly include: readonly Regla[];
  readonly exclude?: readonly Regla[];
  readonly require?: readonly Regla[];
  readonly is_default?: boolean;
}
interface Llamada {
  readonly url: string;
  readonly metodo: 'GET' | 'PUT' | 'POST';
  readonly senal: AbortSignal;
  readonly cuerpo?: object;
}

function esRegla(valor: unknown): valor is Regla {
  return valor !== null && typeof valor === 'object' && !Array.isArray(valor);
}
function sonReglas(valor: unknown): valor is readonly Regla[] {
  return Array.isArray(valor) && valor.every(esRegla);
}
/** Solo se conservan las partes del grupo que la API de actualización admite; otra forma no se toca. */
function leerGrupo(resultado: unknown): GrupoLeido | null {
  if (!esRegla(resultado) || typeof resultado.name !== 'string' || resultado.name === '') {
    return null;
  }
  const { include, exclude, require } = resultado;
  if (!sonReglas(include) || (exclude !== undefined && !sonReglas(exclude))) {
    return null;
  }
  if (require !== undefined && !sonReglas(require)) {
    return null;
  }
  return {
    name: resultado.name,
    include,
    ...(exclude ? { exclude } : {}),
    ...(require ? { require } : {}),
    ...(typeof resultado.is_default === 'boolean' ? { is_default: resultado.is_default } : {}),
  };
}
/** Una regla de correo es exactamente `{ email: { email } }`; cualquier otra forma se conserva tal cual. */
function esReglaDeCorreo(regla: Regla): boolean {
  const correo = regla.email;
  return Object.keys(regla).length === 1 && esRegla(correo) && typeof correo.email === 'string';
}
/** El resultado de la API si Cloudflare confirma con `success: true`; si no, null. */
async function leerRespuesta(respuesta: Response): Promise<unknown | null> {
  const texto = await respuesta.text();
  if (!respuesta.ok || texto.length > MAX_RESPUESTA_ACCESS_BYTES) {
    return null;
  }
  const datos: unknown = JSON.parse(texto);
  return esRegla(datos) && datos.success === true ? (datos.result ?? {}) : null;
}
/**
 * Una llamada con su propio plazo. Un fallo de red, el plazo agotado o una respuesta ilegible son un «no» de
 * Cloudflare; si la petición del panel se ha cancelado, esa cancelación sigue su curso.
 */
async function llamar(pedir: typeof fetch, token: string, llamada: Llamada): Promise<unknown | null> {
  try {
    const respuesta = await pedirSinRedirecciones(
      llamada.url,
      {
        method: llamada.metodo,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        signal: AbortSignal.any([llamada.senal, AbortSignal.timeout(PLAZO_LLAMADA_ACCESS_MS)]),
        ...(llamada.cuerpo ? { body: JSON.stringify(llamada.cuerpo) } : {}),
      },
      pedir,
    );
    return await leerRespuesta(respuesta);
  } catch (error) {
    llamada.senal.throwIfAborted();
    if (error instanceof TypeError || error instanceof SyntaxError || error instanceof DOMException) {
      return null;
    }
    throw error;
  }
}

export function crearGrupoAccess(destino: DestinoGrupoAccess, pedir: typeof fetch = fetch): GrupoAccess {
  const url = `${API}/accounts/${destino.cuenta}/access/groups/${destino.grupo}`;
  return {
    async sincronizar(correos, senal) {
      const actual = leerGrupo(await llamar(pedir, destino.token, { url, metodo: 'GET', senal }));
      if (actual === null) {
        return 'fallida';
      }
      const otras = actual.include.filter((regla) => !esReglaDeCorreo(regla));
      const include = [...otras, ...correos.map((email) => ({ email: { email } }))];
      const escrito = await llamar(pedir, destino.token, { url, metodo: 'PUT', senal, cuerpo: { ...actual, include } });
      return escrito === null ? 'fallida' : 'correcta';
    },
    async revocar(correo, senal) {
      const revocacion = `${API}/accounts/${destino.cuenta}/access/organizations/revoke_user`;
      const llamada = { url: revocacion, metodo: 'POST', senal, cuerpo: { email: correo } } as const;
      return (await llamar(pedir, destino.token, llamada)) === null ? 'fallida' : 'correcta';
    },
  };
}
