/**
 * Cursos por el camino publicado: el Worker del motor que la propia web arrancó (web/scripts/motor-local/worker.js),
 * con la página del recorrido ya sin servidor, su CSP, sus Trusted Types y su copia sin conexión. Se le manda un GET
 * /api/cursos por su protocolo (cliente.js); la puerta del motor lo calcula en el trabajador de cursos anidado. El
 * corte, la recuperación y el rechazo de referencias ajenas, que la web no expone, los prueba trabajador-de-cursos.ts.
 */
import assert from 'node:assert/strict';
import type { Page, Worker } from 'playwright-core';
import { CABECERA_CONTRATO, CONTRATO_API } from '../../web/scripts/protocolo-web.js';
import type { Fixture } from './fixture.ts';
import type { ViolacionEsperada } from './observacion.ts';

/** El guion del Worker del motor, desde la raíz de la web, y el del trabajador de cursos que arranca dentro. */
const WORKER_DEL_MOTOR = '/scripts/motor-local/worker.js';
const TRABAJADOR_DE_CURSOS = '/trabajador-de-cursos.js';
const CORRECTO = 200;
/** Lo que espera la sonda el aviso de su violación, que el navegador entrega en una tarea aparte. */
const ESPERA_DEL_AVISO_MS = 5000;
/** Los identificadores de cliente.js empiezan en 1: uno negativo nunca coincide con una petición de la página. */
const ID_PROPIO = -1;
const CAMPOS_DE_CURSOS = ['fecha', 'enLaBolsa', 'total', 'pagina', 'paginas', 'fichas', 'recuentos'];

/** La petición del protocolo del Worker (worker.js, PeticionAlMotor). */
interface PeticionAlMotor {
  id: number;
  paquete: string;
  completo: boolean;
  url: string;
  method: string;
  headers: [string, string][];
  body: string | null;
}
/** Lo que el Worker contesta a una petición: la respuesta del motor, o por qué no la ha dado. */
interface RespuestaDelMotor {
  id: number;
  status?: number;
  headers?: [string, string][];
  body?: string;
  fallo?: boolean;
  noCoincide?: boolean;
  faltaElResto?: boolean;
}

/**
 * Los motores que no registran en `resource` el guion de un Worker anidado. Firefox anota los import() del Worker del
 * motor, pero no el guion del trabajador de cursos que este crea, y Playwright tampoco ve esa carga: ahí no hay señal
 * del anidado sin un punto de prueba en el producto. En Firefox lo acreditan trabajador-de-cursos.test.mjs
 * (comprobarElTrabajadorAnidado), que cuenta desde la página cada arranque y exige que calcule el trabajador anidado,
 * y, sin navegador, pruebas/web-motor/trabajador-de-cursos-entregado.test.ts, que exige que worker.js entregue a
 * crearMotorLocal el trabajador creado con la dirección publicada de trabajador-de-cursos.js.
 */
const SIN_RECURSO_DEL_ANIDADO = new Set(['firefox']);
const MOTORES_CONOCIDOS = new Set(['chromium', 'firefox', 'webkit']);

/** Si el motor de la página registra el guion del anidado. El motor sale de Playwright, no de la página. */
function registraElAnidado(pagina: Page): boolean {
  const motor = pagina.context().browser()?.browserType().name();
  assert(motor && MOTORES_CONOCIDOS.has(motor), `Motor sin identificar: ${String(motor)}`);
  return !SIN_RECURSO_DEL_ANIDADO.has(motor);
}

/** El Worker del motor que arrancó la web; la prueba no crea otro. */
function workerDelMotor(pagina: Page): Worker {
  const worker = pagina.workers().find((w) => new URL(w.url()).pathname === WORKER_DEL_MOTOR);
  assert(worker, `El recorrido no arrancó el Worker publicado del motor (${WORKER_DEL_MOTOR})`);
  return worker;
}

/**
 * Dentro del Worker: la petición entra por su escucha de mensajes, como las de la página, y su respuesta se recoge
 * envolviendo postMessage solo hasta que sale la de este identificador. No cambia nada de lo publicado. Con la
 * respuesta, si este Worker ha cargado el guion del trabajador de cursos: sin él, el motor calcularía en su hilo.
 */
function preguntarDentro({ peticion, guion }: { peticion: PeticionAlMotor; guion: string }) {
  const ambito = globalThis as unknown as {
    postMessage: (mensaje: unknown, ...resto: unknown[]) => void;
    dispatchEvent: (evento: Event) => boolean;
  };
  const anidado = () => performance.getEntriesByType('resource').some(({ name }) => name.endsWith(guion));
  return new Promise<{ respuesta: RespuestaDelMotor; anidado: boolean }>((responder) => {
    const enviar = ambito.postMessage;
    ambito.postMessage = function (this: unknown, mensaje: unknown, ...resto: unknown[]) {
      if ((mensaje as { id?: unknown } | null)?.id === peticion.id) {
        ambito.postMessage = enviar;
        responder({ respuesta: mensaje as RespuestaDelMotor, anidado: anidado() });
        return;
      }
      enviar.call(this, mensaje, ...resto);
    };
    ambito.dispatchEvent(new MessageEvent('message', { data: peticion }));
  });
}

/**
 * La violación que provoca a propósito la sonda de Trusted Types (arrancarSinPolitica), con su firma en los tres
 * motores: la directiva, el sumidero, el tipo y el guion, y la página del recorrido. La observación del ensayo la
 * acepta una sola vez; cualquier otra violación de CSP o de Trusted Types sigue fallando.
 */
export function violacionDeLaSonda(origen: string): ViolacionEsperada {
  return {
    directiva: 'require-trusted-types-for',
    recurso: 'trusted-types-sink',
    muestra: `Worker constructor|${WORKER_DEL_MOTOR}`,
    documento: `${origen}/recorrido.html`,
  };
}

/** En la página: un guion propio arrancado con un texto, sin pasar por la política faro-guiones. */
/**
 * Espera además a que el navegador entregue su aviso de la violación (securitypolicyviolation), como mucho
 * `esperaMs`: la observación del ensayo, que escucha antes, lo recibe así antes de que la prueba la compruebe.
 */
async function arrancarSinPolitica({ guion, esperaMs }: { guion: string; esperaMs: number }) {
  const aviso = new Promise<boolean>((avisado) => {
    const plazo = setTimeout(() => avisado(false), esperaMs);
    const escuchar = (evento: SecurityPolicyViolationEvent) => {
      if (evento.effectiveDirective === 'require-trusted-types-for') {
        removeEventListener('securitypolicyviolation', escuchar);
        clearTimeout(plazo);
        avisado(true);
      }
    };
    addEventListener('securitypolicyviolation', escuchar);
  });
  let resultado: string;
  try {
    new Worker(guion, { type: 'module' }).terminate();
    resultado = 'admitido';
  } catch (error) {
    resultado = error instanceof TypeError ? 'rechazado' : String(error);
  }
  return { resultado, avisada: await aviso };
}

/**
 * El cálculo de Cursos en el Worker publicado, dos veces, sin servidor y sin peticiones a él.
 *
 * @param pagina - La página del recorrido, ya sin servidor.
 * @param fixture - Su servidor, para comprobar que no recibe nada.
 * @param version - La versión del paquete publicado (huellaPaquete), la carpeta /paquete/<versión>/.
 */
export async function probarTrabajadorDeCursos(pagina: Page, fixture: Fixture, version: string) {
  const worker = workerDelMotor(pagina);
  const pedidasAntes = fixture.peticiones.length;
  const peticion: PeticionAlMotor = {
    id: ID_PROPIO,
    paquete: new URL(`/paquete/${version}/`, fixture.origen).href,
    completo: true,
    url: new URL('/api/cursos', fixture.origen).href,
    method: 'GET',
    headers: [[CABECERA_CONTRATO, String(CONTRATO_API)]],
    body: null,
  };
  const { respuesta: primera, anidado } = await worker.evaluate(preguntarDentro, {
    peticion,
    guion: TRABAJADOR_DE_CURSOS,
  });
  const { respuesta: segunda } = await worker.evaluate(preguntarDentro, { peticion, guion: TRABAJADOR_DE_CURSOS });
  const sonda = await pagina.evaluate(arrancarSinPolitica, { guion: WORKER_DEL_MOTOR, esperaMs: ESPERA_DEL_AVISO_MS });
  const trustedTypes = sonda.resultado;

  assert.equal(primera.fallo, undefined, 'El motor del dispositivo responde');
  assert.equal(primera.faltaElResto, undefined, 'La copia sin conexión está completa');
  assert.equal(primera.status, CORRECTO, `Cursos responde con el trabajador anidado: ${String(primera.body)}`);
  if (registraElAnidado(pagina)) {
    assert.ok(anidado, 'El Worker del motor ha cargado el trabajador de cursos: no calcula en su propio hilo');
  }
  const cursos = JSON.parse(String(primera.body)) as { fichas?: unknown; total?: unknown };
  assert.deepEqual(Object.keys(cursos).sort(), [...CAMPOS_DE_CURSOS].sort(), 'La forma de /api/cursos');
  assert.ok(Array.isArray(cursos.fichas) && cursos.fichas.length > 0, 'La bolsa del día trae cursos');
  assert.ok(typeof cursos.total === 'number' && cursos.total > 0, 'El total de cursos no es cero');
  assert.deepEqual(
    { status: segunda.status, body: segunda.body },
    { status: primera.status, body: primera.body },
    'La misma consulta da la misma respuesta',
  );
  assert.equal(fixture.peticiones.length, pedidasAntes, 'Sin peticiones al servidor: lo sirve la copia sin conexión');
  assert.equal(trustedTypes, 'rechazado', 'Trusted Types: la página no arranca un guion sin su política');
  assert.equal(sonda.avisada, true, 'Trusted Types: el navegador avisa de la violación que provoca la sonda');
  return { status: primera.status, total: cursos.total, fichas: cursos.fichas.length, anidado, trustedTypes };
}
