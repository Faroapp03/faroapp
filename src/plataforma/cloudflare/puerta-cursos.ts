// La puerta del motor de cursos en el Worker principal de Cloudflare: cada operación se pide al Worker de Cursos
// (worker-cursos.ts) por su enlace de servicio (CURSOS), con un tiempo máximo. El Worker principal no carga el motor:
// en Cloudflare no hay hilos, y la única forma de que un cálculo en bucle del motor no detenga al motor de ocupaciones
// es que corra en otro Worker, con su propia instancia aislada y su propio tope de CPU. Igual que en las demás
// plataformas (motor-de-cursos.ts): sin enlace, «ausente»; si no responde a tiempo, «bloqueado» (se corta la espera, y
// Cloudflare corta el cálculo con el tope de CPU del Worker de Cursos); si falla, responde 5xx o algo que no se
// entiende, «averiado». Las listas de los filtros de /api/cursos no se piden: son contrato.
// Cada petición se basta sola (protocolo-cursos.ts): lo que una operación «guardaría» en el lado del motor no se puede
// guardar, porque la siguiente petición puede llegar a otra instancia aislada. Los recursos de la hoja de ruta los
// lleva el Worker de Cursos en su paquete y el principal los nombra con su referencia (formacionDelWorkerDeCursos).
// Los dos Workers se publican por separado: si el de Cursos lleva otro paquete que el principal, su respuesta no se usa
// y la formación figura como no disponible («averiado»), para no mezclar datos de dos versiones en un informe.

import {
  LIMITE_OPERACION_MS,
  mensajeDe,
  type PuertaDelMotor,
  type ResultadoDelMotor,
  type SinMotor,
} from '../motor-de-cursos.ts';
import { esGuardado, esOrigen, type OPERACIONES_DE_CURSOS, type ValorDe } from '../operaciones-de-cursos.ts';
import {
  DIRECCION_DE_CURSOS,
  HUELLA_DEL_PAQUETE,
  leerRespuestaDeCursos,
  type PeticionACursos,
} from './protocolo-cursos.ts';

/** Lo que el Worker principal usa del enlace de servicio: su fetch. */
export interface EnlaceDeCursos {
  fetch(peticion: Request): Promise<Response>;
}

/** Los tiempos máximos de la puerta, en milisegundos, y el paquete que espera. */
export interface OpcionesDeLaPuertaCloudflare {
  /** Lo que puede tardar cada operación, con la respuesta entera leída. */
  readonly limiteOperacionMs?: number;
  /** La huella del paquete del Worker principal; por defecto, la de su construcción (HUELLA_DEL_PAQUETE). */
  readonly huellaPaquete?: string;
}

/** El primer estado HTTP de error del servidor. */
const PRIMER_ERROR_DEL_SERVIDOR = 500;

/** Un fallo de la puerta. */
function sin(motivo: SinMotor['motivo'], detalle: string): SinMotor {
  return { disponible: false, motivo, detalle };
}

/** Lo que responde el Worker de Cursos, leído entero: su estado y su cuerpo como JSON, o null si no es JSON. */
async function respuestaEntera(enlace: EnlaceDeCursos, peticion: PeticionACursos, senal: AbortSignal) {
  const respuesta = await enlace.fetch(
    new Request(DIRECCION_DE_CURSOS, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(peticion),
      signal: senal,
    }),
  );
  let cuerpo: unknown = null;
  try {
    cuerpo = await respuesta.json();
  } catch {
    cuerpo = null;
  }
  return { estado: respuesta.status, cuerpo };
}

/**
 * Pide una operación al Worker de Cursos y espera su respuesta entera como mucho `limiteMs`. El plazo no depende de
 * que el enlace atienda la señal de corte: la espera se corta igual.
 *
 * @param enlace - El enlace de servicio.
 * @param peticion - Lo que se pide.
 * @param limiteMs - El tiempo máximo.
 * @returns El valor, o por qué no hay motor.
 */
async function pedir(
  enlace: EnlaceDeCursos,
  peticion: PeticionACursos,
  limiteMs: number,
): Promise<ResultadoDelMotor<unknown>> {
  const control = new AbortController();
  const que = `la operación ${peticion.nombre}`;
  let reloj: ReturnType<typeof setTimeout> | undefined;
  const vencida = new Promise<SinMotor>((resolver) => {
    reloj = setTimeout(() => {
      resolver(sin('bloqueado', `${que} del Worker de Cursos no ha terminado en ${limiteMs} ms`));
      control.abort();
    }, limiteMs);
  });
  const respondida = respuestaEntera(enlace, peticion, control.signal).then(
    ({ estado, cuerpo }): ResultadoDelMotor<unknown> => {
      const leida = leerRespuestaDeCursos(cuerpo);
      if (estado >= PRIMER_ERROR_DEL_SERVIDOR || leida === null) {
        const forma = leida === null ? 'sin la forma esperada' : 'con un error del servidor';
        return sin('averiado', `el Worker de Cursos ha respondido ${estado} ${forma} a ${que}`);
      }
      if (leida.huellaPaquete !== peticion.huellaPaquete) {
        return sin(
          'averiado',
          `el Worker de Cursos lleva el paquete ${leida.huellaPaquete} y el principal el ${peticion.huellaPaquete}: no se usa su respuesta a ${que}`,
        );
      }
      return leida.ok ? { disponible: true, valor: leida.valor } : sin(leida.motivo, leida.detalle);
    },
    (error: unknown) => sin('averiado', `el Worker de Cursos no ha respondido a ${que}: ${mensajeDe(error)}`),
  );
  try {
    return await Promise.race([respondida, vencida]);
  } finally {
    clearTimeout(reloj);
  }
}

/** Por qué no se puede mandar una operación al Worker de Cursos, o null si se puede. */
function noSePuedeMandar(nombre: keyof typeof OPERACIONES_DE_CURSOS, argumentos: readonly unknown[]): string | null {
  if (argumentos.some(esGuardado)) {
    return `${nombre} usa algo guardado en el lado del motor, y en Cloudflare no se guarda nada entre peticiones`;
  }
  if (argumentos.some(esOrigen)) {
    return `${nombre} usa un archivo de otro paquete: el Worker de Cursos solo lee el suyo`;
  }
  return null;
}

/**
 * Crea la puerta del motor de cursos del Worker principal.
 *
 * @param enlace - El enlace de servicio al Worker de Cursos; sin él, el motor está «ausente».
 * @param opciones - El tiempo máximo de cada operación (por defecto, el de las demás puertas) y la huella del paquete
 * que espera (por defecto, la de la construcción).
 * @returns La puerta.
 */
export function crearPuertaDeCursosCloudflare(
  enlace: EnlaceDeCursos | undefined,
  opciones: OpcionesDeLaPuertaCloudflare = {},
): PuertaDelMotor {
  const limiteOperacionMs = opciones.limiteOperacionMs ?? LIMITE_OPERACION_MS;
  const huellaPaquete = opciones.huellaPaquete ?? HUELLA_DEL_PAQUETE;
  const ausente = sin('ausente', 'el Worker principal no tiene el enlace de servicio al Worker de Cursos');

  const operar: PuertaDelMotor['operar'] = async (nombre, argumentos, { limiteMs } = {}) => {
    if (enlace === undefined) {
      return ausente;
    }
    const lista = argumentos as readonly unknown[];
    const motivo = noSePuedeMandar(nombre, lista);
    if (motivo !== null) {
      return sin('averiado', motivo);
    }
    // Los datos del paquete no viajan: viaja su huella, y el Worker de Cursos solo responde con el mismo paquete.
    const resultado = await pedir(
      enlace,
      { tipo: 'operacion', nombre, argumentos: lista, huellaPaquete },
      limiteMs ?? limiteOperacionMs,
    );
    return resultado as ResultadoDelMotor<ValorDe<typeof nombre>>;
  };

  // Las operaciones corren fuera del Worker principal, que nunca carga el motor.
  return { enSuTrabajador: true, operar };
}
