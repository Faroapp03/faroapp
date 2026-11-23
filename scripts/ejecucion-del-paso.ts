// La ejecución de un paso de la verificación: una orden propia sin shell, en su grupo de procesos, con plazo y salida
// acotada. Al cortarlo (plazo, salida excesiva o interrupción) se detiene su árbol entero (detener-arbol.ts) y se
// informa del primer fallo, con lo que la limpieza no pudo resolver en líneas aparte.
// Los descendientes pertenecen a un grupo nuevo del proceso creado aquí; un descendiente que cree otra sesión o se
// vaya a otro grupo se busca por la tabla de procesos.

import { type ChildProcess, spawn } from 'node:child_process';
import { detenerArbol } from './detener-arbol.ts';
import { FalloDeComprobacion } from './fallo-de-comprobacion.ts';

/** Un paso que escriba sin límite falla antes de agotar la memoria de la comprobación. */
const MAX_SALIDA_CARACTERES = 1_048_576;
const CODIGO_EXITO = 0;

/** Una orden propia comprobada, sin shell ni pasos opcionales. */
export interface Paso {
  readonly nombre: string;
  readonly comando: string;
  readonly argumentos: readonly string[];
  /** Conserva stdout como datos y emite stderr por separado, sin incorporarlo al protocolo estructurado. */
  readonly diagnosticosSeparados?: boolean;
  /** Variables que se añaden al entorno heredado de la orden. */
  readonly entorno?: Readonly<Record<string, string>>;
  /** Variables del entorno heredado que no se transmiten a la orden. */
  readonly excluir?: readonly string[];
}

/** Estado limitado de un proceso hijo, propiedad exclusiva de ejecutarPaso. */
interface Ejecucion {
  salida: string;
  diagnosticos: string;
  fallo: Error | null;
  /** La detención del árbol del paso, si se ha pedido: lo que no pudo resolver. */
  limpieza: Promise<readonly string[]> | null;
  /** Si, tras la limpieza, el paso no llegó a cerrar su salida y se cerró desde aquí. */
  salidaAbierta: boolean;
  /** Lo que hace esperarCierre al empezar la limpieza: vigilar que la salida del paso llegue a cerrarse. */
  alDetener: () => void;
}

/** Lo que se espera a que la salida del paso se cierre tras la limpieza antes de cerrarla desde aquí. */
const ESPERA_DEL_CIERRE_MS = 1000;
const SALIDA_ABIERTA =
  'Limpieza de los procesos del paso: la salida del paso sigue abierta tras la limpieza (la conserva un proceso que no ' +
  'se encontró); se ha cerrado desde la verificación.';

/**
 * Detiene una sola vez el árbol del paso: su grupo, creado por spawn(detached:true), y los descendientes que se hayan
 * ido a otros grupos, como los navegadores (detener-arbol.ts). Una vez recogido el proceso principal, su PID no se
 * señala: podría estar reutilizado.
 */
function detenerPaso(proceso: ChildProcess, estado: Ejecucion): void {
  if (proceso.pid !== undefined && estado.limpieza === null) {
    estado.limpieza = detenerArbol(proceso.pid, {
      raizTerminada: () => proceso.exitCode !== null || proceso.signalCode !== null,
    });
    estado.alDetener();
  }
}

/** Conserva stdout/stderr dentro del límite; un exceso detiene el paso completo. */
function recogerSalida(proceso: ChildProcess, estado: Ejecucion, separar: boolean): void {
  proceso.stdout?.setEncoding('utf8');
  proceso.stderr?.setEncoding('utf8');
  const recoger = (texto: string, campo: 'salida' | 'diagnosticos'): void => {
    if (estado.fallo) {
      return;
    }
    if (estado.salida.length + estado.diagnosticos.length + texto.length > MAX_SALIDA_CARACTERES) {
      estado.fallo ??= new FalloDeComprobacion('La salida supera el límite de la comprobación');
      detenerPaso(proceso, estado);
      return;
    }
    estado[campo] += texto;
  };
  proceso.stdout?.on('data', (texto: string) => recoger(texto, 'salida'));
  proceso.stderr?.on('data', (texto: string) => recoger(texto, separar ? 'diagnosticos' : 'salida'));
}

/** Convierte el cierre del proceso en resultado: un código ausente tampoco significa éxito. */
function falloDelCierre(paso: Paso, codigo: number | null, senal: NodeJS.Signals | null): Error | null {
  if (senal) {
    return new FalloDeComprobacion(`${paso.nombre}: termina por señal ${senal}`);
  }
  if (codigo !== CODIGO_EXITO) {
    return new FalloDeComprobacion(`${paso.nombre}: termina con código ${codigo ?? 'ausente'}`, {
      codigo: codigo ?? undefined,
    });
  }
  return null;
}

/**
 * Limpia el árbol del paso si quien ejecuta interrumpe la comprobación. Se retira cuando el paso ha terminado y su
 * limpieza también: una señal repetida mientras tanto no hace nada más (la limpieza ya está en curso) y no interrumpe
 * la verificación a medias.
 */
function vigilarInterrupciones(proceso: ChildProcess, estado: Ejecucion): () => void {
  const interrumpir = (senal: NodeJS.Signals): void => {
    estado.fallo ??= new FalloDeComprobacion(`Comprobación interrumpida por ${senal}`);
    detenerPaso(proceso, estado);
  };
  const alInterrumpir = (): void => interrumpir('SIGINT');
  const alTerminar = (): void => interrumpir('SIGTERM');
  process.on('SIGINT', alInterrumpir);
  process.on('SIGTERM', alTerminar);
  return () => {
    process.off('SIGINT', alInterrumpir);
    process.off('SIGTERM', alTerminar);
  };
}

/**
 * El resultado del paso cerrado. Si se detuvo su árbol, espera a esa detención; lo que no se resolvió (supervivientes o
 * consultas fallidas) se añade al fallo original, que conserva su primera línea y su código.
 */
async function resultadoDelCierre(
  paso: Paso,
  estado: Ejecucion,
  codigo: number | null,
  senal: NodeJS.Signals | null,
): Promise<string> {
  const pendientesDeLimpieza = (await estado.limpieza) ?? [];
  const fallo = estado.fallo ?? falloDelCierre(paso, codigo, senal);
  if (fallo) {
    const codigoDelPaso = fallo instanceof FalloDeComprobacion ? fallo.codigo : undefined;
    const limpieza = pendientesDeLimpieza
      .map((problema) => `\nLimpieza de los procesos del paso: ${problema}.`)
      .join('');
    const abierta = estado.salidaAbierta ? `\n${SALIDA_ABIERTA}` : '';
    throw new FalloDeComprobacion(
      `${fallo.message}${limpieza}${abierta}\n${estado.salida}${estado.diagnosticos}`.trim(),
      {
        cause: fallo,
        codigo: codigoDelPaso,
      },
    );
  }
  if (estado.diagnosticos) {
    process.stderr.write(estado.diagnosticos);
  }
  return estado.salida;
}

/**
 * Espera el cierre y siempre limpia su temporizador; no captura errores de otros procesos. El primer fallo (plazo,
 * salida excesiva, interrupción o error al lanzar) es el que se informa. Si tras una limpieza la salida del paso no se
 * cierra, se cierra desde aquí y se informa.
 */
function esperarCierre(proceso: ChildProcess, paso: Paso, plazoMs: number): Promise<string> {
  let acabar: (codigo: number | null, senal: NodeJS.Signals | null) => void = () => undefined;
  let acabado = false;
  let vigiaDelCierre: ReturnType<typeof setTimeout> | undefined;
  const estado: Ejecucion = {
    salida: '',
    diagnosticos: '',
    fallo: null,
    limpieza: null,
    salidaAbierta: false,
    alDetener: () => {
      void estado.limpieza?.then(() => {
        if (acabado) {
          return;
        }
        vigiaDelCierre = setTimeout(() => {
          estado.salidaAbierta = true;
          proceso.stdout?.destroy();
          proceso.stderr?.destroy();
          acabar(null, null);
        }, ESPERA_DEL_CIERRE_MS);
      });
    },
  };
  recogerSalida(proceso, estado, paso.diagnosticosSeparados === true);
  const retirarInterrupciones = vigilarInterrupciones(proceso, estado);
  return new Promise((resolver, rechazar) => {
    const temporizador = setTimeout(() => {
      estado.fallo ??= new FalloDeComprobacion(`${paso.nombre}: supera el plazo de ${plazoMs} ms`);
      detenerPaso(proceso, estado);
    }, plazoMs);
    acabar = (codigo, senal) => {
      if (acabado) {
        return;
      }
      acabado = true;
      clearTimeout(temporizador);
      clearTimeout(vigiaDelCierre);
      resultadoDelCierre(paso, estado, codigo, senal).finally(retirarInterrupciones).then(resolver, rechazar);
    };
    proceso.once('error', (error: Error) => {
      estado.fallo ??= new FalloDeComprobacion(`${paso.nombre}: no se puede ejecutar (${error.message})`, {
        cause: error,
      });
    });
    proceso.once('close', (codigo, senal) => acabar(codigo, senal));
  });
}

/**
 * Ejecuta una herramienta sin shell, en su grupo propio y con salida acotada.
 *
 * @param paso - Orden y argumentos de la herramienta.
 * @param raiz - Directorio de trabajo del producto o del caso de prueba.
 * @param plazoMs - Tiempo máximo del paso, en milisegundos.
 * @returns La salida de la herramienta si termina con éxito.
 * @throws {FalloDeComprobacion} Si falta la herramienta, falla, supera el plazo o escribe demasiado.
 */
export function ejecutarPaso(paso: Paso, raiz: string, plazoMs: number): Promise<string> {
  if (process.platform !== 'darwin' && process.platform !== 'linux') {
    throw new FalloDeComprobacion('La comprobación de grupos de procesos admite macOS y Linux');
  }
  if (!Number.isSafeInteger(plazoMs) || plazoMs <= 0) {
    throw new FalloDeComprobacion('El plazo tiene que ser un entero positivo en milisegundos');
  }
  const proceso = spawn(paso.comando, [...paso.argumentos], {
    cwd: raiz,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    // Una suite hija no debe heredar el marcador interno de node:test de su padre ni las variables que excluya el paso.
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter(
          ([nombre]) => nombre !== 'NODE_TEST_CONTEXT' && !paso.excluir?.includes(nombre),
        ),
      ),
      ...paso.entorno,
    },
  });
  return esperarCierre(proceso, paso, plazoMs);
}
