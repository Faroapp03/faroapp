/**
 * Programador único de la alarma del objeto durable. Cloudflare admite una sola alarma por objeto y `setAlarm` sustituye
 * la anterior; por eso cada tarea guarda sus vencimientos en sus propias filas y la alarma nunca queda después del más
 * próximo de todas. Las operaciones van en serie para que dos esperas intercaladas no fijen una fecha posterior a otra
 * pendiente.
 */
import type { AlmacenAccesos } from '../../administracion/accesos.ts';
import { registrarFalloMantenimiento } from '../../api/errores.ts';
import { PLAZO_CLIENTE_MS } from './durable-limites.ts';
import type { AlmacenSesionPortalSqlite } from './sesion-portal-sqlite.ts';
import type { AlmacenSesionRecorridoSqlite } from './sesion-recorrido-sqlite.ts';
import type { SqlAccesoPublico } from './sqlite.ts';

const REINTENTO_MS = 3_600_000;
const MAX_PENDIENTES = 32;
const MAX_INSTANTE_DATE = 8_640_000_000_000_000;
const MILISEGUNDOS = 1000;
/**
 * El plazo de cada operación de la cola, desde que le llega el turno: lo mismo que el Worker espera la respuesta del
 * objeto. Cuenta el tiempo total de la operación (sus tareas y su acción también), aunque solo se comprueba en las
 * llamadas de alarma: una operación encadena varias (leer y adelantar al arrancar, el reintento y fijar) y la que llega
 * con el plazo vencido no se hace. El tiempo que pasa esperando turno en la cola no cuenta. `alarm()` no responde al
 * Worker, pero tiene el mismo plazo para no dejar la cola parada.
 */
const PLAZO_OPERACION_MS = PLAZO_CLIENTE_MS;
export interface AlarmasRegistroDurable {
  getAlarm(): Promise<number | null>;
  setAlarm(fecha: number): Promise<void>;
  deleteAlarm(): Promise<void>;
}
/** Retirada física de filas con plazo: cuándo vence la más próxima y cómo retirar las vencidas. */
export interface TareaAlarmaDurable {
  /** Nombre neutro con que se registra un fallo de la tarea; el registro no copia mensajes ni datos de las filas. */
  readonly operacion: 'registro-conectividad' | 'retirada-sesiones' | 'retirada-intentos';
  /** Instante, en milisegundos, en que vence la fila más próxima; null si no queda ninguna. */
  vencimiento(): Promise<number | null>;
  /** Retira lo vencido a la hora actual; repetirla no cambia el resultado, porque la alarma puede llegar más de una vez. */
  ejecutar(): Promise<void>;
}
/** Escribe una fila que vence en `fecha` solo después de dejar la alarma a esa hora o antes. */
export type CubrirVencimiento = <T>(fecha: number, escribir: () => T) => Promise<T>;
/** Una operación de la cola: su plazo, los avisos que había al empezar y la alarma de su primera lectura. */
interface OperacionCola {
  /** Se rechaza cuando vence el plazo de la operación. */
  readonly vence: Promise<never>;
  vencida: boolean;
  readonly avisos: number;
  leida?: { readonly fecha: number | null };
}
function instante(valor: unknown): valor is number {
  return Number.isSafeInteger(valor) && (valor as number) >= 0 && (valor as number) <= MAX_INSTANTE_DATE;
}
function sinRespuesta(): Error {
  return new Error('Alarma del objeto durable sin respuesta');
}
export class ProgramadorAlarmaDurable {
  private cola: Promise<void> = Promise.resolve();
  private pendientes = 0;
  /**
   * Avisos de que la alarma puede no ser la debida: una llamada de alarma que vence o termina tarde, o un `alarm()` que
   * falla. Cada operación anota cuántos había al empezar; si al acabar hay más, su comprobación ya no vale.
   */
  private avisos = 0;
  /** Avisos que había al empezar la última operación que dejó la alarma comprobada; -1 antes de la primera. */
  private comprobados = -1;
  /** Próximo intento de cada tarea que falló en esta instancia; si el objeto se reinicia, el arranque la intenta antes. */
  private readonly reintentos = new Map<TareaAlarmaDurable, number>();
  private readonly alarmas: AlarmasRegistroDurable;
  private readonly tareas: readonly TareaAlarmaDurable[];
  private readonly ahora: () => number;
  constructor(alarmas: AlarmasRegistroDurable, tareas: readonly TareaAlarmaDurable[], ahora: () => number = Date.now) {
    this.alarmas = alarmas;
    this.tareas = tareas;
    this.ahora = ahora;
  }
  private enSerie<T>(accion: (operacion: OperacionCola) => Promise<T>): Promise<T> {
    if (this.pendientes >= MAX_PENDIENTES) {
      return Promise.reject(new Error('Mantenimiento del objeto durable ocupado'));
    }
    this.pendientes++;
    const respuesta = this.cola.then(() => this.conPlazo(accion));
    // Solo la cola captura el rechazo para permitir la operación siguiente; el llamador conserva su rechazo.
    this.cola = respuesta.then(
      () => undefined,
      () => undefined,
    );
    return respuesta.finally(() => {
      this.pendientes--;
    });
  }
  /** Ejecuta una operación de la cola con su plazo, que empieza cuando le llega el turno. */
  private async conPlazo<T>(accion: (operacion: OperacionCola) => Promise<T>): Promise<T> {
    let reloj: ReturnType<typeof setTimeout> | undefined;
    const operacion: OperacionCola = {
      avisos: this.avisos,
      vencida: false,
      vence: new Promise<never>((_resolver, rechazar) => {
        reloj = setTimeout(() => {
          operacion.vencida = true;
          rechazar(sinRespuesta());
        }, PLAZO_OPERACION_MS);
      }),
    };
    // Sin ninguna llamada de alarma en curso, el vencimiento no lo espera nadie.
    operacion.vence.catch(() => undefined);
    try {
      return await accion(operacion);
    } finally {
      clearTimeout(reloj);
    }
  }
  /**
   * Una llamada de alarma que no responde antes de que venza el plazo de su operación hace fallar la operación sin esperar
   * más, para que la cola siga atendiendo; con el plazo ya vencido, la llamada ni se hace. Lo que la operación ya hizo se
   * queda: `cubrir` escribe la fila al final, así que no ha escrito; `reprogramando`, si vence al fijar, ya ha escrito y el
   * Worker recibe 503. Esa fila la cubre la alarma que había o su reintento; con `reintento` false y sin alarma previa, no
   * la cubre ninguna hasta que la llamada vencida termina o llega la operación siguiente. La llamada vencida sigue en
   * curso y puede cambiar la alarma al terminar; por eso, cuando termina, bien o mal, el propio objeto encola una
   * comprobación que la adelanta si hace falta, sin esperar a otra operación. Si no termina nunca, el aviso hace que la
   * compruebe la operación siguiente.
   */
  private async llamar<T>(operacion: OperacionCola, llamada: () => Promise<T>): Promise<T> {
    if (operacion.vencida) {
      throw sinRespuesta();
    }
    const curso = llamada();
    let terminada = false;
    const seguida = curso.finally(() => {
      terminada = true;
    });
    try {
      return await Promise.race([seguida, operacion.vence]);
    } catch (error) {
      if (!terminada) {
        this.avisos++;
        const comprobar = () => {
          this.avisos++;
          void this.arranque().catch(() => undefined);
        };
        curso.then(comprobar, comprobar);
      }
      throw error;
    }
  }
  private leerAlarma(operacion: OperacionCola): Promise<number | null> {
    return this.llamar(operacion, () => this.alarmas.getAlarm());
  }
  private programar(operacion: OperacionCola, fecha: number): Promise<void> {
    return this.llamar(operacion, () => this.alarmas.setAlarm(fecha));
  }
  private retirar(operacion: OperacionCola): Promise<void> {
    return this.llamar(operacion, () => this.alarmas.deleteAlarm());
  }
  private hoy(): number {
    const hoy = this.ahora();
    if (!instante(hoy) || hoy > MAX_INSTANTE_DATE - REINTENTO_MS) {
      throw new Error('Reloj de mantenimiento no válido');
    }
    return hoy;
  }
  private async alarmaActual(operacion: OperacionCola): Promise<number | null> {
    const actual = await this.leerAlarma(operacion);
    if (actual !== null && !instante(actual)) {
      throw new Error('Alarma de mantenimiento no válida');
    }
    if (!operacion.leida) {
      operacion.leida = { fecha: actual };
    }
    return actual;
  }
  /** Adelanta la alarma a `fecha` si la programada es posterior o no hay ninguna; nunca la retrasa. */
  private async adelantar(operacion: OperacionCola, fecha: number): Promise<void> {
    if (!instante(fecha)) {
      throw new Error('Vencimiento de mantenimiento no válido');
    }
    const actual = await this.alarmaActual(operacion);
    if (actual === null || fecha < actual) {
      await this.programar(operacion, fecha);
    }
  }
  /**
   * Cuándo toca una tarea; la que falla al calcularlo o al ejecutarse no vuelve antes de su reintento. Un fallo al
   * calcularlo deja el registro neutro solo cuando crea el reintento, no en cada operación mientras siga fallando.
   */
  private async vencimientoDe(tarea: TareaAlarmaDurable, hoy: number): Promise<number | null> {
    let propia: number | null;
    try {
      propia = await tarea.vencimiento();
      if (propia !== null && !instante(propia)) {
        throw new Error('Vencimiento de mantenimiento no válido');
      }
    } catch (error) {
      const pendiente = this.reintentos.get(tarea);
      if (pendiente !== undefined && pendiente > hoy) {
        return pendiente;
      }
      registrarFalloMantenimiento(tarea.operacion, error);
      propia = hoy + REINTENTO_MS;
      this.reintentos.set(tarea, propia);
    }
    if (propia === null) {
      this.reintentos.delete(tarea);
      return null;
    }
    return Math.max(propia, this.reintentos.get(tarea) ?? propia);
  }
  /** Vencimiento más próximo entre todas las tareas. */
  private async objetivo(hoy: number): Promise<number | null> {
    let fecha: number | null = null;
    for (const tarea of this.tareas) {
      const propia = await this.vencimientoDe(tarea, hoy);
      if (propia !== null && (fecha === null || propia < fecha)) {
        fecha = propia;
      }
    }
    return fecha;
  }
  /**
   * Deja la alarma en el vencimiento más próximo de todas las tareas, o la retira si no queda ninguna fila con plazo y no
   * hay tope. `tope` es la alarma que había antes de la operación: la nueva nunca queda después de ella, así el reintento
   * de una tarea que falló no retrasa la alarma que adelantó una fila posterior. Es null si no había ninguna y en
   * `alarm()`, que acaba de ejecutar todas las tareas y sabe cuáles han fallado.
   */
  private async fijar(operacion: OperacionCola, hoy: number, tope: number | null): Promise<void> {
    const objetivo = await this.objetivo(hoy);
    const fecha = objetivo === null || tope === null ? (objetivo ?? tope) : Math.min(objetivo, tope);
    if (fecha === null) {
      await this.retirar(operacion);
    } else {
      await this.programar(operacion, fecha);
    }
    this.comprobados = operacion.avisos;
  }
  /**
   * Primera operación de cada instancia, y la primera tras un aviso: si hay filas que vencen antes de la alarma ya
   * programada, o no hay alarma, la adelanta. Nunca la retrasa ni la retira, para no pisar la que dejó una instancia
   * anterior.
   */
  private async arrancar(operacion: OperacionCola): Promise<void> {
    if (this.comprobados === this.avisos) {
      return;
    }
    const fecha = await this.objetivo(this.hoy());
    if (fecha !== null) {
      await this.adelantar(operacion, fecha);
    }
    this.comprobados = operacion.avisos;
  }
  /**
   * Comprueba la alarma si aún no se ha comprobado en esta instancia o ha habido un aviso desde entonces. Si las alarmas
   * fallan, el rechazo llega al llamador y la comprobación se repite en la operación siguiente.
   */
  arranque(): Promise<void> {
    return this.comprobados === this.avisos ? Promise.resolve() : this.enSerie((operacion) => this.arrancar(operacion));
  }
  readonly cubrir: CubrirVencimiento = (fecha, escribir) =>
    this.enSerie(async (operacion) => {
      await this.arrancar(operacion);
      await this.adelantar(operacion, fecha);
      return escribir();
    });
  /**
   * Operación que cambia filas con plazo: deja un reintento cercano si se pide, opera y fija la alarma al vencimiento más
   * próximo, sin pasar de la que había antes de la operación.
   */
  reprogramando<T>(
    accion: () => Promise<T>,
    reintento: boolean,
    fijarTras: (resultado: T) => boolean = () => true,
  ): Promise<T> {
    return this.enSerie(async (operacion) => {
      await this.arrancar(operacion);
      const hoy = this.hoy();
      if (reintento) {
        await this.adelantar(operacion, hoy + REINTENTO_MS);
      }
      const resultado = await accion();
      if (fijarTras(resultado)) {
        const previa = operacion.leida ? operacion.leida.fecha : await this.alarmaActual(operacion);
        await this.fijar(operacion, hoy, previa);
      }
      return resultado;
    });
  }
  /**
   * Ejecuta todas las tareas aunque alguna falle; la que falla deja un registro neutro y se reintenta una hora después, o
   * antes si otra tarea vence antes. Cloudflare reintenta un manejador que lanza como mucho seis veces y recomienda
   * capturar las excepciones; por eso el reintento de cada tarea queda en la alarma propia. El manejador solo lanza, con
   * un mensaje neutro, cuando no puede atender la alarma: la cola está llena, el reloj no es válido o no ha podido dejar
   * programada o retirar la alarma. Entonces deja un aviso y la operación siguiente vuelve a comprobarla, por si
   * Cloudflare agota sus reintentos. La primera alarma, a una hora, cubre un corte a mitad de las tareas.
   */
  async alarm(): Promise<void> {
    try {
      await this.enSerie(async (operacion) => {
        const hoy = this.hoy();
        await this.programar(operacion, hoy + REINTENTO_MS);
        for (const tarea of this.tareas) {
          try {
            await tarea.ejecutar();
            this.reintentos.delete(tarea);
          } catch (error) {
            registrarFalloMantenimiento(tarea.operacion, error);
            this.reintentos.set(tarea, hoy + REINTENTO_MS);
          }
        }
        await this.fijar(operacion, hoy, null);
      });
    } catch {
      this.avisos++;
      throw new Error('Mantenimiento del objeto durable no disponible');
    }
  }
}

/** El registro de los canales de máquina solo tiene filas que retirar una vez preparado. */
function accesosPreparados(sql: SqlAccesoPublico): boolean {
  return Object.hasOwn(sql.filas('SELECT * FROM publico_estado WHERE id=1')[0] ?? {}, 'accesos_version');
}
/**
 * El programador del objeto durable con sus tres tareas: el registro de los canales de máquina (30 días desde el día de
 * cada uso), las huellas de sesión del portal (al caducar, como mucho una hora) y los contadores de intentos (al vencer
 * su cuarto de hora). El orden de la lista no da prioridad: la alarma va al vencimiento más próximo de todas.
 */
export function programadorDelObjetoDurable(
  storage: Partial<AlarmasRegistroDurable>,
  sql: SqlAccesoPublico,
  sesion: AlmacenSesionRecorridoSqlite,
  portal: AlmacenSesionPortalSqlite,
): ProgramadorAlarmaDurable {
  return new ProgramadorAlarmaDurable(alarmasDelStorage(storage), [
    {
      operacion: 'registro-conectividad',
      vencimiento: async () => (accesosPreparados(sql) ? sesion.siguienteVencimientoAccesos() : null),
      ejecutar: async () => {
        if (accesosPreparados(sql)) {
          await sesion.depurarAccesos();
        }
      },
    },
    {
      operacion: 'retirada-sesiones',
      vencimiento: async () => portal.vencimiento(),
      ejecutar: async () => portal.retirarCaducadas(Math.floor(Date.now() / MILISEGUNDOS)),
    },
    {
      operacion: 'retirada-intentos',
      vencimiento: async () => sesion.vencimientoLimites(),
      ejecutar: async () => sesion.retirarLimitesVencidos(Date.now()),
    },
  ]);
}
/** El registro de los canales de máquina, con su retirada coordinada con el resto de tareas del objeto. */
export function accesosConAlarma(almacen: AlmacenAccesos, programador: ProgramadorAlarmaDurable): AlmacenAccesos {
  return {
    prepararAccesos: () => programador.reprogramando(() => almacen.prepararAccesos(), false),
    registrarAcceso: (uso) => programador.reprogramando(() => almacen.registrarAcceso(uso), true),
    depurarAccesos: () => programador.reprogramando(() => almacen.depurarAccesos(), true),
    leerAccesosDeSesion: (acceso, pagina) =>
      programador.reprogramando(
        () => almacen.leerAccesosDeSesion(acceso, pagina),
        false,
        (resultado) => resultado.estado === 'activa',
      ),
  };
}

/**
 * Las alarmas del binding, sin sustituir las ausentes por una promesa vacía: sin ellas falla toda operación que escribe
 * una fila con plazo (sesiones del portal, intentos y registro de los canales); las demás siguen operativas.
 */
export function alarmasDelStorage(storage: Partial<AlarmasRegistroDurable>): AlarmasRegistroDurable {
  return {
    getAlarm: async () => {
      const leer = storage.getAlarm;
      if (typeof leer !== 'function') {
        throw new Error('Alarmas del registro operativo no disponibles');
      }
      return leer.call(storage);
    },
    setAlarm: async (fecha) => {
      const programar = storage.setAlarm;
      if (typeof programar !== 'function') {
        throw new Error('Alarmas del registro operativo no disponibles');
      }
      await programar.call(storage, fecha);
    },
    deleteAlarm: async () => {
      const retirar = storage.deleteAlarm;
      if (typeof retirar !== 'function') {
        throw new Error('Alarmas del registro operativo no disponibles');
      }
      await retirar.call(storage);
    },
  };
}
