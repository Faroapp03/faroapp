// La única puerta entre la app y el motor de cursos (motores/cursos/): lo carga con import() dinámico la primera vez
// que se pide, con un tiempo máximo, y guarda el módulo si sale bien. Así, si el motor falla al cargarse, se queda
// colgado o sus funciones lanzan errores, la API sigue arrancando y el motor de ocupaciones (el recorrido) sigue
// respondiendo: solo lo que es formación se queda sin él (el informe sale entero, con un aviso en lugar de la
// formación). Ningún otro módulo de src/api, src/plataforma, el motor de ocupaciones (motores/ocupaciones/) ni el
// informe (src/dominio/informe.ts) importa valores del motor de forma estática (pruebas/motores/fusible-cursos.test.ts lo
// comprueba, sin excepciones).
// Si falla un archivo de datos que solo es de cursos (archivos-del-paquete.ts, esDeCursos), el paquete carga sin él y
// la puerta de esos datos da el motor por averiado (puertaConSusDatos).
// La app pide al motor operaciones con nombre (operar, operaciones-de-cursos.ts). Donde hay hilos, la puerta las manda
// a un trabajador propio (crearPuertaEnTrabajador: worker_threads en Node, un Web Worker de módulo en el navegador)
// con un tiempo máximo: si vence, lo termina (terminate()) y responde «bloqueado»; si el trabajador se cae o la
// operación lanza, «averiado»; la siguiente operación crea un trabajador nuevo. Así un cálculo en bucle no retrasa al
// motor de ocupaciones, que sigue en su hilo. La puerta con trabajador no carga nunca el motor en el hilo de la app: las
// listas de los filtros de /api/cursos son contrato (compartido/contratos/filtros-de-cursos.ts) y
// pruebas/motores/fusible-cursos-hilo.test.ts lo comprueba. En Cloudflare, el Worker principal no carga el motor: lo pide a un
// Worker aparte por un enlace de servicio (service binding; plataforma/cloudflare/puerta-cursos.ts). Sin trabajador
// (el Worker de Cursos por dentro, las herramientas y las pruebas que no lo piden), se ejecutan en el mismo hilo
// (crearPuertaDelMotor) y el tiempo máximo solo corta lo asíncrono: ver motores/cursos/README.md.
// En el navegador, el motor se compila archivo a archivo: el import() pide sus archivos la primera vez que hacen
// falta (la copia sin conexión los lleva en COMPROBADOS, dentro de web/service-worker.js).

import type * as Motor from '../../motores/cursos/src/index.ts';
import { ColaDeOperaciones } from './cola-de-operaciones.ts';
import {
  type ArgumentosDe,
  aplicarOperacion,
  esGuardado,
  esOrigen,
  type MensajeAlTrabajador,
  type MensajeDelTrabajador,
  type NombreDeOperacion,
  OPERACIONES_DE_CURSOS,
  type ValorDe,
} from './operaciones-de-cursos.ts';

/** El motor de cursos: lo que exporta su entrada pública, motores/cursos/src/index.ts. */
export type MotorDeCursos = typeof Motor;

/** Por qué no está el motor: no se encuentra, se ha roto (al cargarse o al ejecutar) o no responde a tiempo. */
export type MotivoSinMotor = 'ausente' | 'averiado' | 'bloqueado';

/** El motor no está disponible: el motivo y, para el registro, el detalle técnico (sin datos de la persona). */
export interface SinMotor {
  readonly disponible: false;
  readonly motivo: MotivoSinMotor;
  readonly detalle: string;
}

/** El motor, si se ha podido cargar. */
export type EstadoDelMotor<M = MotorDeCursos> = { readonly disponible: true; readonly motor: M } | SinMotor;

/** Lo que da una operación del motor, si ha terminado bien y a tiempo. */
export type ResultadoDelMotor<Valor> = { readonly disponible: true; readonly valor: Valor } | SinMotor;

/** Con qué se manda una operación: los datos del paquete, si la operación los lleva, y su tiempo máximo. */
export interface OpcionesDeLaOperacion {
  readonly datos?: object;
  readonly limiteMs?: number;
  /** Retira una consulta pendiente o activa de la puerta con trabajador, sin afectar a las siguientes. */
  readonly senal?: AbortSignal;
}

/** La puerta que usa la app: ejecuta las operaciones del motor con tiempo máximo y control de errores. */
export interface PuertaDelMotor {
  /**
   * Si las consultas corren en un trabajador propio, sin cargar el motor en este hilo.
   */
  readonly enSuTrabajador: boolean;
  /**
   * Una operación con nombre (operaciones-de-cursos.ts), en el trabajador de cursos si la puerta lo tiene. Un error es
   * «averiado»; si no termina en `limiteMs`, «bloqueado» (con trabajador, se termina y el siguiente uso crea otro).
   */
  operar<N extends NombreDeOperacion>(
    nombre: N,
    argumentos: ArgumentosDe<N>,
    opciones?: OpcionesDeLaOperacion,
  ): Promise<ResultadoDelMotor<ValorDe<N>>>;
}

/** La puerta con trabajador propio; su dueño la cierra al retirar el montaje. */
export interface PuertaConTrabajador extends PuertaDelMotor {
  /** Termina el trabajador, resuelve las operaciones pendientes y rechaza nuevos usos. Es idempotente. */
  cerrar(): void;
}

/** La puerta sin trabajador: carga el motor en este hilo (el Worker de Cloudflare, las herramientas y las pruebas). */
export interface PuertaEnEsteHilo<M = MotorDeCursos> extends PuertaDelMotor {
  /** El motor, cargado una sola vez en este hilo; nunca lanza ni se queda colgado más de su tiempo máximo. */
  cargar(): Promise<EstadoDelMotor<M>>;
  /**
   * Ejecuta un cierre con el motor, siempre en este hilo: solo para las pruebas de la puerta (la app usa operar, que
   * pruebas/motores/fusible-cursos-trabajador.test.ts exige). Un error es «averiado»; si no termina en `limiteMs`,
   * «bloqueado». Una operación síncrona que no termina no se puede cortar: el tiempo máximo vale para lo asíncrono.
   */
  ejecutar<Valor>(
    operacion: (motor: M) => Valor | Promise<Valor>,
    limiteMs?: number,
  ): Promise<ResultadoDelMotor<Valor>>;
}

/** Los tiempos máximos de una puerta. */
export interface TiemposDeLaPuerta {
  /** Tiempo máximo de la carga, en milisegundos. Por defecto, LIMITE_CARGA_MS. */
  readonly limiteCargaMs?: number;
  /** Tiempo máximo de cada operación, en milisegundos. Por defecto, LIMITE_OPERACION_MS. */
  readonly limiteOperacionMs?: number;
}

/** Cómo se crea una puerta en este hilo: el importador (las pruebas lo inyectan) y los tiempos máximos. */
export interface OpcionesDeLaPuerta<M> extends TiemposDeLaPuerta {
  /** Lo que carga el motor. Por defecto, import() de motores/cursos/src/index.ts. */
  readonly importar?: () => Promise<M>;
}

/** Lo que puede tardar en cargarse el motor (en Node, la primera vez, lee y prepara sus archivos). */
export const LIMITE_CARGA_MS = 10_000;

/** Lo que puede tardar una operación del motor. */
export const LIMITE_OPERACION_MS = 10_000;

/** Las funciones que tiene que exportar el motor para darlo por cargado, las de sus operaciones; sin ellas, está averiado. */
const EXPORTACIONES_DEL_MOTOR = Object.keys(OPERACIONES_DE_CURSOS);

/**
 * Las listas que tiene que reexportar el motor (filtros de /api/cursos, compartido/contratos/filtros-de-cursos.ts); sin
 * ellas, también está averiado.
 */
const LISTAS_DEL_MOTOR = ['FUENTES_DE_CURSOS', 'OPCIONES_DE_CURSOS'];

/** Los códigos de error de un módulo que no se encuentra. */
const CODIGOS_DE_AUSENCIA = new Set(['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND', 'ERR_UNSUPPORTED_DIR_IMPORT']);

/** Los mensajes de un módulo que no se encuentra en los navegadores (Chromium, Firefox y Safari). */
const MENSAJES_DE_AUSENCIA =
  /cannot find module|failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed/iu;

/** La carga por defecto: el motor de cursos, por su única entrada pública. */
function importarElMotor(): Promise<MotorDeCursos> {
  return import('../../motores/cursos/src/index.ts');
}

/** El mensaje de un error, sin la pila. */
export function mensajeDe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/** Si el error de una carga dice que el módulo no se encuentra. */
export function esAusencia(error: unknown): boolean {
  const codigo = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  return (typeof codigo === 'string' && CODIGOS_DE_AUSENCIA.has(codigo)) || MENSAJES_DE_AUSENCIA.test(mensajeDe(error));
}

/** Un fallo de la puerta, con su motivo. */
export class FalloDelMotor extends Error {
  readonly motivo: MotivoSinMotor;
  constructor(motivo: MotivoSinMotor, detalle: string) {
    super(detalle);
    this.motivo = motivo;
  }
}

/**
 * Espera una promesa como mucho `ms` milisegundos.
 *
 * @param promesa - Lo que se espera.
 * @param ms - El tope de la espera.
 * @param que - Lo que se espera, para el detalle.
 * @returns Lo que da la promesa.
 * @throws {FalloDelMotor} «bloqueado» si no llega a tiempo; o el error de la promesa.
 */
async function comoMucho<Valor>(promesa: Promise<Valor>, ms: number, que: string): Promise<Valor> {
  let reloj: ReturnType<typeof setTimeout> | undefined;
  const vencida = new Promise<never>((_, falla) => {
    reloj = setTimeout(() => falla(new FalloDelMotor('bloqueado', `${que} no ha terminado en ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([promesa, vencida]);
  } finally {
    clearTimeout(reloj);
  }
}

/** El estado sin motor de un fallo de la puerta o de cualquier otro error. */
function sinMotor(error: unknown, motivoPorDefecto: MotivoSinMotor): SinMotor {
  if (error instanceof FalloDelMotor) {
    return { disponible: false, motivo: error.motivo, detalle: error.message };
  }
  return { disponible: false, motivo: motivoPorDefecto, detalle: mensajeDe(error) };
}

/** Comprueba que lo cargado tiene la forma del motor. */
export function comprobarMotor<M>(modulo: M): M {
  const exportado = (nombre: string): unknown =>
    typeof modulo === 'object' && modulo !== null ? (modulo as Record<string, unknown>)[nombre] : undefined;
  const faltan = [
    ...EXPORTACIONES_DEL_MOTOR.filter((nombre) => typeof exportado(nombre) !== 'function'),
    ...LISTAS_DEL_MOTOR.filter((nombre) => typeof exportado(nombre) !== 'object' || exportado(nombre) === null),
  ];
  if (faltan.length > 0) {
    throw new FalloDelMotor('averiado', `al motor le faltan ${faltan.join(', ')}`);
  }
  return modulo;
}

/** Empieza la carga del motor: un error de carga sale como «ausente» o «averiado». */
function iniciarCarga<M>(importar: () => Promise<M>): Promise<M> {
  return Promise.resolve()
    .then(importar)
    .then(comprobarMotor, (error: unknown) => {
      throw error instanceof FalloDelMotor
        ? error
        : new FalloDelMotor(esAusencia(error) ? 'ausente' : 'averiado', mensajeDe(error));
    });
}

/**
 * Ejecuta en este hilo las operaciones factuales; rechaza referencias de recursos o archivos.
 *
 * @param ejecutar - El ejecutar de la puerta.
 * @returns El operar de la puerta.
 */
function operadorEnEsteHilo<M>(ejecutar: PuertaEnEsteHilo<M>['ejecutar']): PuertaDelMotor['operar'] {
  return (nombre, argumentos, { datos, limiteMs } = {}) =>
    ejecutar(async (motor) => {
      const lista = argumentos as readonly unknown[];
      if (lista.some(esOrigen) || lista.some(esGuardado)) {
        throw new Error('Las consultas factuales no aceptan referencias de recursos o archivos');
      }
      return (await aplicarOperacion(motor as object, nombre, datos, lista)) as ValorDe<typeof nombre>;
    }, limiteMs);
}

/**
 * Crea una puerta al motor de cursos. La app usa una sola (motorDeCursos); las pruebas crean las suyas con su
 * importador.
 *
 * @param opciones - El importador y los tiempos máximos; por defecto, el motor real y LIMITE_CARGA_MS y LIMITE_OPERACION_MS.
 * @returns La puerta.
 */
export function crearPuertaDelMotor<M = MotorDeCursos>(opciones: OpcionesDeLaPuerta<M> = {}): PuertaEnEsteHilo<M> {
  const importar = opciones.importar ?? (importarElMotor as unknown as () => Promise<M>);
  const limiteCargaMs = opciones.limiteCargaMs ?? LIMITE_CARGA_MS;
  const limiteOperacionMs = opciones.limiteOperacionMs ?? LIMITE_OPERACION_MS;
  let cargado: M | null = null;
  // La carga en curso: si se queda colgada, las peticiones siguientes la esperan otra vez con su tiempo máximo, sin
  // lanzar otra. Si falla, se olvida y la siguiente lo vuelve a intentar.
  let enCurso: Promise<M> | null = null;

  async function cargar(): Promise<EstadoDelMotor<M>> {
    if (cargado !== null) {
      return { disponible: true, motor: cargado };
    }
    if (enCurso === null) {
      const intento = iniciarCarga(importar);
      enCurso = intento;
      intento.then(
        (motor) => {
          cargado = motor;
        },
        () => {
          if (enCurso === intento) {
            enCurso = null;
          }
        },
      );
    }
    try {
      const motor = await comoMucho(enCurso, limiteCargaMs, 'la carga del motor de cursos');
      return { disponible: true, motor };
    } catch (error) {
      return sinMotor(error, 'averiado');
    }
  }

  async function ejecutar<Valor>(
    operacion: (motor: M) => Valor | Promise<Valor>,
    limiteMs = limiteOperacionMs,
  ): Promise<ResultadoDelMotor<Valor>> {
    const estado = await cargar();
    if (!estado.disponible) {
      return estado;
    }
    try {
      const valor = await comoMucho(
        Promise.resolve().then(() => operacion(estado.motor)),
        limiteMs,
        'una operación del motor de cursos',
      );
      return { disponible: true, valor };
    } catch (error) {
      return sinMotor(error, 'averiado');
    }
  }

  return { enSuTrabajador: false, cargar, operar: operadorEnEsteHilo(ejecutar), ejecutar };
}

/** Un trabajador de cursos en marcha, visto desde la puerta: le manda mensajes y lo termina. */
export interface TrabajadorEnMarcha {
  enviar(mensaje: MensajeAlTrabajador): void;
  terminar(): void;
}

/** Lo que la puerta oye de su trabajador: sus mensajes, y que se ha caído (un error sin atender o su salida). */
export interface AvisosDelTrabajador {
  mensaje(mensaje: MensajeDelTrabajador): void;
  caido(detalle: string): void;
}

/** Cómo arranca su plataforma un trabajador de cursos: worker_threads en Node, un Web Worker en el navegador. */
export type LanzarTrabajador = (avisos: AvisosDelTrabajador) => TrabajadorEnMarcha;

/** Una operación que se manda al trabajador, sin su identificador. */
type Pedido = Omit<Extract<MensajeAlTrabajador, { tipo: 'operacion' }>, 'id'>;

/** Un trabajador de la puerta, con lo que espera de él y lo que ya le ha mandado. */
class Instancia {
  readonly listo: Promise<void>;
  readonly enviados = new Set<string>();
  private readonly pendientes = new Map<number, (respuesta: MensajeDelTrabajador | FalloDelMotor) => void>();
  private readonly trabajador: TrabajadorEnMarcha;
  private avisarListo: (fallo?: FalloDelMotor) => void = () => {};
  private readonly alRetirarse: (instancia: Instancia) => void;
  private siguiente = 0;
  private terminado = false;

  /**
   * Arranca un trabajador.
   *
   * @param lanzar - Cómo lo arranca la plataforma.
   * @param alRetirarse - Lo que avisa a la puerta de que este trabajador ya no vale.
   */
  constructor(lanzar: LanzarTrabajador, alRetirarse: (instancia: Instancia) => void) {
    this.alRetirarse = alRetirarse;
    this.listo = new Promise<void>((resolver, rechazar) => {
      this.avisarListo = (fallo) => (fallo ? rechazar(fallo) : resolver());
    });
    // Que un trabajador que no llega a estar listo no deje una promesa rechazada sin atender.
    this.listo.catch(() => {});
    this.trabajador = lanzar({
      mensaje: (mensaje) => this.recibir(mensaje),
      caido: (detalle) =>
        this.retirar(new FalloDelMotor('averiado', `el trabajador de cursos se ha caído: ${detalle}`)),
    });
  }

  /** Atiende un mensaje del trabajador. */
  private recibir(mensaje: MensajeDelTrabajador): void {
    if (mensaje.tipo === 'listo') {
      this.avisarListo();
    } else if (mensaje.tipo === 'sin-motor') {
      this.retirar(new FalloDelMotor(mensaje.motivo, mensaje.detalle));
    } else {
      const avisar = this.pendientes.get(mensaje.id);
      this.pendientes.delete(mensaje.id);
      avisar?.(mensaje);
    }
  }

  /** Termina el trabajador y da `fallo` a todo lo que esperaba de él. Se puede llamar más de una vez. */
  retirar(fallo: FalloDelMotor): void {
    this.avisarListo(fallo);
    this.alRetirarse(this);
    if (!this.terminado) {
      this.terminado = true;
      try {
        this.trabajador.terminar();
      } catch {
        // Ya estaba terminado: no queda nada que cortar.
      }
    }
    for (const avisar of this.pendientes.values()) {
      avisar(fallo);
    }
    this.pendientes.clear();
  }

  /** Un hilo retirado nunca recibe datos ni nuevas operaciones, aunque termine una espera anterior. */
  private exigirVigente(): void {
    if (this.terminado) {
      throw new FalloDelMotor('averiado', 'el trabajador del motor de cursos se ha retirado');
    }
  }

  /** Manda un valor que el trabajador guarda con su clave, si aún no lo tiene. */
  guardar(clave: string, valor: unknown): void {
    this.exigirVigente();
    if (!this.enviados.has(clave)) {
      this.enviados.add(clave);
      this.trabajador.enviar({ tipo: 'guardar', clave, valor });
    }
  }

  /** Manda una operación y espera su respuesta; un fallo es un FalloDelMotor. */
  pedir(pedido: Pedido): Promise<unknown> {
    this.exigirVigente();
    this.siguiente += 1;
    const id = this.siguiente;
    return new Promise((resolver, rechazar) => {
      this.pendientes.set(id, (respuesta) => {
        if (respuesta instanceof FalloDelMotor) {
          rechazar(respuesta);
        } else if (respuesta.tipo === 'hecho') {
          resolver(respuesta.valor);
        } else if (respuesta.tipo === 'fallo') {
          rechazar(new FalloDelMotor('averiado', respuesta.detalle));
        }
      });
      this.trabajador.enviar({ ...pedido, id });
    });
  }
}

/** La puerta con su trabajador: cada operación, en él, con su tiempo máximo. */
class PuertaEnTrabajador {
  private actual: Instancia | null = null;
  private cerrada = false;
  private readonly cola = new ColaDeOperaciones();
  private readonly claves = new WeakMap<object, string>();
  private ultimaClave = 0;
  private readonly lanzar: LanzarTrabajador;
  private readonly limiteCargaMs: number;
  private readonly limiteOperacionMs: number;

  constructor(lanzar: LanzarTrabajador, limiteCargaMs: number, limiteOperacionMs: number) {
    this.lanzar = lanzar;
    this.limiteCargaMs = limiteCargaMs;
    this.limiteOperacionMs = limiteOperacionMs;
  }

  /** Una clave nueva para algo que se guarda en el trabajador. */
  private claveNueva(prefijo: string): string {
    this.ultimaClave += 1;
    return `${prefijo}${this.ultimaClave}`;
  }

  /** La clave de unos datos: la misma para el mismo objeto, para mandarlos una sola vez a cada trabajador. */
  private claveDe(datos: object): string {
    const clave = this.claves.get(datos) ?? this.claveNueva('d');
    this.claves.set(datos, clave);
    return clave;
  }

  /** Impide que un montaje retirado vuelva a arrancar un trabajador. */
  private exigirAbierta(): void {
    if (this.cerrada) {
      throw new FalloDelMotor('averiado', 'la puerta del motor de cursos se ha cerrado');
    }
  }

  /** El cierre del dueño, también durante una carga o una operación. */
  readonly cerrar = (): void => {
    this.cerrada = true;
    this.actual?.retirar(new FalloDelMotor('averiado', 'la puerta del motor de cursos se ha cerrado'));
  };

  /** El trabajador en marcha, listo; si no hay ninguno, lo arranca. */
  private async listo(): Promise<Instancia> {
    this.exigirAbierta();
    const en =
      this.actual ??
      new Instancia(this.lanzar, (retirada) => {
        if (this.actual === retirada) {
          this.actual = null;
        }
      });
    this.actual = en;
    try {
      await comoMucho(en.listo, this.limiteCargaMs, 'la carga del motor de cursos en su trabajador');
      this.exigirAbierta();
    } catch (error) {
      if (error instanceof FalloDelMotor && error.motivo === 'bloqueado') {
        en.retirar(error);
      }
      throw error;
    }
    return en;
  }

  /** La consulta, en el trabajador: devuelve su valor. */
  private async enLaInstancia(
    en: Instancia,
    nombre: NombreDeOperacion,
    argumentos: readonly unknown[],
    { datos, limiteMs = this.limiteOperacionMs, senal }: OpcionesDeLaOperacion,
  ): Promise<unknown> {
    senal?.throwIfAborted();
    try {
      if (argumentos.some(esOrigen) || argumentos.some(esGuardado)) {
        throw new Error('Las consultas factuales no aceptan referencias de recursos o archivos');
      }
      this.exigirAbierta();
      const forma = OPERACIONES_DE_CURSOS[nombre];
      const claveDeDatos = forma.datos && datos !== undefined ? this.claveDe(datos) : null;
      if (claveDeDatos !== null) {
        en.guardar(claveDeDatos, datos);
      }
      const pedido = en.pedir({
        tipo: 'operacion',
        nombre,
        datos: claveDeDatos,
        argumentos,
      });
      return await comoMucho(pedido, limiteMs, `la operación ${nombre} del motor de cursos`);
    } catch (error) {
      if (error instanceof FalloDelMotor && error.motivo === 'bloqueado') {
        // El trabajador no ha terminado a tiempo: se termina, y con él lo que estuviera calculando.
        en.retirar(error);
      }
      throw error;
    }
  }

  /** La retirada también corta una carga en curso, y solo retira el trabajador de esta operación activa. */
  private async enElTrabajador(
    nombre: NombreDeOperacion,
    argumentos: readonly unknown[],
    opciones: OpcionesDeLaOperacion,
  ): Promise<unknown> {
    const { senal } = opciones;
    senal?.throwIfAborted();
    const retirar = () => this.actual?.retirar(new FalloDelMotor('bloqueado', 'consulta de cursos retirada'));
    senal?.addEventListener('abort', retirar, { once: true });
    try {
      return await this.enLaInstancia(await this.listo(), nombre, argumentos, opciones);
    } finally {
      senal?.removeEventListener('abort', retirar);
    }
  }

  /** La cola no consume el plazo de ejecución; una consulta retirada no llega al trabajador. */
  readonly operar: PuertaDelMotor['operar'] = (nombre, argumentos, opciones = {}) =>
    this.cola.agregar(async (): Promise<ResultadoDelMotor<ValorDe<typeof nombre>>> => {
      try {
        const valor = await this.enElTrabajador(nombre, argumentos, opciones);
        return { disponible: true, valor: valor as ValorDe<typeof nombre> };
      } catch (error) {
        opciones.senal?.throwIfAborted();
        return sinMotor(error, 'averiado');
      }
    }, opciones.senal);
}

/**
 * Crea una puerta que ejecuta las operaciones en un trabajador de cursos propio (worker_threads o Web Worker), que se
 * puede terminar. No carga el motor en este hilo: todo lo que la app le pide son operaciones con nombre.
 *
 * @param lanzar - Cómo arranca la plataforma un trabajador.
 * @param opciones - Los tiempos máximos; por defecto, LIMITE_CARGA_MS y LIMITE_OPERACION_MS.
 * @returns La puerta.
 */
export function crearPuertaEnTrabajador(
  lanzar: LanzarTrabajador,
  opciones: TiemposDeLaPuerta = {},
): PuertaConTrabajador {
  const enTrabajador = new PuertaEnTrabajador(
    lanzar,
    opciones.limiteCargaMs ?? LIMITE_CARGA_MS,
    opciones.limiteOperacionMs ?? LIMITE_OPERACION_MS,
  );
  return { enSuTrabajador: true, operar: enTrabajador.operar, cerrar: enTrabajador.cerrar };
}

/** La puerta en este hilo, con el motor real: la de las API sin trabajador, las herramientas y las pruebas. */
export const motorDeCursos: PuertaEnEsteHilo = crearPuertaDelMotor();

/**
 * Los paquetes de datos con algún archivo de cursos que no se ha podido cargar, con el detalle. Lo anotan los
 * cargadores del paquete (plataforma/navegador/paquete.ts y plataforma/node/datos.ts), que cargan el núcleo igual.
 */
const DATOS_DE_CURSOS_AVERIADOS = new WeakMap<object, string>();

/**
 * Anota que en estos datos falta algún archivo de cursos (archivos-del-paquete.ts, esDeCursos): la puerta que los usa
 * da el motor por averiado (puertaConSusDatos).
 *
 * @param datos - Los datos cargados, sin las partes de cursos que han fallado.
 * @param detalle - Lo que ha fallado, para el registro.
 */
export function anotarDatosDeCursosAveriados(datos: object, detalle: string): void {
  DATOS_DE_CURSOS_AVERIADOS.set(datos, detalle);
}

/**
 * La puerta que corresponde a unos datos: la misma si sus archivos de cursos se han cargado bien; si no, una que da
 * siempre el motor por averiado, con el detalle de lo que ha fallado, sin cargarlo.
 *
 * @param puerta - La puerta del motor.
 * @param datos - Los datos con que trabajará.
 * @returns La puerta.
 */
export function puertaConSusDatos<P extends PuertaDelMotor>(puerta: P, datos: object): P {
  const detalle = DATOS_DE_CURSOS_AVERIADOS.get(datos);
  if (detalle === undefined) {
    return puerta;
  }
  const averiado: SinMotor = { disponible: false, motivo: 'averiado', detalle };
  const siempreAveriado = async (): Promise<SinMotor> => averiado;
  const enEsteHilo = 'cargar' in puerta ? { cargar: siempreAveriado, ejecutar: siempreAveriado } : {};
  return { ...puerta, operar: siempreAveriado, ...enEsteHilo } as P;
}
