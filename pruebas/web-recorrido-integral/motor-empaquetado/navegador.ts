// Una muestra fija de casos del banco por el Worker real del motor empaquetado, en Chromium, Firefox y WebKit y con el
// service worker de la construcción, frente al motor de las fuentes en Node con el mismo paquete de datos publicado:
// cada paso, byte a byte. Cada caso recorre hasta tres pasos. Las tres variantes de esta muestra son propias del
// navegador: llevan los nombres de las del medidor (medicion.ts, VARIANTES) para elegirlas con FARO_VARIANTES, pero no
// son su simulación de personas. «normal» responde siempre la primera opción de cada pregunta; «ruido» la sortea con la
// misma fórmula que el azar del medidor y la clave de ruido del banco del caso; «sin-vectores» retira la tabla de vectores
// (vectores-movil.json) a los dos motores antes de crearlos, y los dos recorren el camino del producto cuando esa tabla
// no llega (src/plataforma/navegador/motor.ts, cargarExtra). El service worker solo sirve un paquete cuya copia ha
// quedado completa (src/service-worker/paquete.js, desdeLaCopiaDelPaquete): la tabla no se puede negar mientras copia,
// porque la copia no se completaría y el Worker no cargaría nada. Por eso se copia entera y después se retira la tabla
// de la copia del dispositivo (su caché faro-paquete-<versión>), que el service worker responde entonces con un 503, y
// del servidor, que responde 404 al motor de las fuentes.

import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { type Browser, chromium, firefox, type Page, webkit } from 'playwright-core';
import { huellasDeLosMapas } from '../../../herramientas/web/integridad.ts';
import { entornoParaLanzar } from '../../../scripts/entorno-firefox.ts';
import { ARCHIVOS_EXTRA_DEL_PAQUETE } from '../../../src/plataforma/archivos-del-paquete.ts';
import { POLITICAS_DE_CONFIANZA } from '../../../src/plataforma/cabeceras-web.ts';
import { crearServidor } from '../../../src/plataforma/node/servidor.ts';
import { identidadAlArrancar } from '../../navegadores/identidad-al-arrancar.ts';
import { cerrarSinSustituir, conPlazo, lanzarConPlazo, recursosDelCaso } from '../../navegadores/recursos-del-caso.mjs';
import { RAIZ } from './medicion.ts';

const PASOS = 3;
const PLAZO_MS = 120_000;
/** Lo que puede tardar el Worker en responder un paso, con el paquete y la IA por cargar en el primero. */
const PLAZO_DE_UN_PASO_MS = 90_000;
const BIEN = 200;
const NO_EXISTE = 404;
const RUTA_DEL_PASO = '/local/recorrido-v2/paso';
const CABECERAS: [string, string][] = [['content-type', 'application/json']];
/** Los únicos guiones que la prueba registra o arranca, relativos a la raíz de la web. */
const GUIONES_DE_LA_PRUEBA: readonly string[] = ['service-worker.js', 'scripts/motor-local/worker.js'];
/**
 * Sin red fuera del equipo, como el ensayo oficial (pruebas/navegadores/ensayo.ts, lanzarMotor): Chromium con los
 * mismos argumentos; Firefox y WebKit, que no los admiten, con un proxy cerrado (el puerto 9 del propio equipo, donde
 * no escucha nadie) para todo lo que no es 127.0.0.1. Así nada sale del equipo en ningún motor.
 */
const SIN_RED_EN_CHROMIUM = [
  '--disable-background-networking',
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
];
const PROXY_CERRADO = { server: 'http://127.0.0.1:9', bypass: '127.0.0.1' };
const opcionesDeRed = (motor: Navegador): { proxy?: typeof PROXY_CERRADO } =>
  motor === 'chromium' ? {} : { proxy: PROXY_CERRADO };
/** La política de Trusted Types de los guiones de la web (web/scripts/confianza.js), que admite su CSP. */
const [POLITICA_DEL_WORKER] = POLITICAS_DE_CONFIANZA;
/**
 * Los mensajes con que la página pide la copia del paquete al service worker y él dice cómo ha quedado
 * (src/service-worker/paquete.js; los mismos textos que web/scripts/paquete-sin-conexion.js). Sus módulos usan el
 * ámbito del service worker y no se cargan en Node.
 */
const PREPARAR_PAQUETE = 'PREPARAR_PAQUETE';
const ESTADO_DEL_PAQUETE = 'ESTADO_DEL_PAQUETE';
/** El principio del nombre de la caché de la copia de cada versión del paquete (src/service-worker/paquete.js). */
const PREFIJO_DEL_PAQUETE = 'faro-paquete-';
const TABLA_DE_VECTORES = `/${ARCHIVOS_EXTRA_DEL_PAQUETE.vectoresMovil}`;
/** Lo que se enseña a cada lado de la primera diferencia entre dos respuestas. */
const CONTEXTO_DE_LA_DIFERENCIA = 60;
/** Lo que se enseña de un mensaje del Worker sin estado. */
const CORTE_DEL_MENSAJE = 240;

/** Los tres motores de navegador de Playwright, en el orden de la batería. */
export const NAVEGADORES = ['chromium', 'firefox', 'webkit'] as const;
export type Navegador = (typeof NAVEGADORES)[number];
const MOTORES = { chromium, firefox, webkit };

/** Cómo se recorre cada variante de la muestra. */
export const VARIANTES_DEL_NAVEGADOR: Readonly<
  Record<string, { readonly ruido: boolean; readonly vectores: boolean }>
> = {
  normal: { ruido: false, vectores: true },
  ruido: { ruido: true, vectores: true },
  'sin-vectores': { ruido: false, vectores: false },
};

/** Una respuesta del Worker: su estado y su cuerpo; si el mensaje no trae estado, el mensaje entero en `otro`. */
type Respondida = { readonly status: number; readonly body: string; readonly otro?: string };
type CasoDelBanco = { readonly texto: string; readonly idioma: string; readonly clave: string };
type MotorDeLasFuentes = typeof import('../../../src/plataforma/navegador/motor.ts');

/**
 * Los navegadores pedidos (FARO_NAVEGADORES, separados por comas): por omisión, los tres, en su orden. Un nombre que
 * no es uno de ellos es un error: no se descarta en silencio.
 */
export function navegadoresPedidos(pedidos: string | undefined): Navegador[] {
  if (pedidos === undefined || pedidos.trim() === '') {
    return [...NAVEGADORES];
  }
  const nombres = pedidos.split(',').map((nombre) => nombre.trim());
  const desconocidos = nombres.filter((nombre) => !(NAVEGADORES as readonly string[]).includes(nombre));
  if (desconocidos.length) {
    throw new Error(`FARO_NAVEGADORES: «${desconocidos.join(', ')}» no es chromium, firefox ni webkit`);
  }
  return NAVEGADORES.filter((motor) => nombres.includes(motor));
}

/**
 * Los casos de los bancos del producto, en su orden: uno de cada `paso`, `cuantos` en total. Cada uno lleva la clave
 * de ruido de su banco y su id («clave/id»), con la que la variante con ruido sortea sus respuestas.
 */
export async function muestraDelBanco(cuantos: number, paso: number): Promise<CasoDelBanco[]> {
  const banco = join(RAIZ, 'motores/ocupaciones/banco');
  const leer = async (archivo: string): Promise<unknown> => JSON.parse(await readFile(join(banco, archivo), 'utf8'));
  const { bancos } = (await leer('bancos.json')) as { bancos: { archivo: string; clave_de_ruido: string }[] };
  type Leido = { readonly id: string; readonly texto: string; readonly idioma: string };
  const casos: CasoDelBanco[] = [];
  for (const { archivo, clave_de_ruido: claveDeRuido } of bancos) {
    const contenido = (await leer(archivo)) as { casos?: Leido[]; frases?: Leido[] };
    for (const { id, texto, idioma } of contenido.casos ?? contenido.frases ?? []) {
      casos.push({ texto, idioma, clave: `${claveDeRuido}/${id}` });
    }
  }
  return Array.from({ length: cuantos }, (_, i) => casos[i * paso]).filter((c): c is CasoDelBanco => c !== undefined);
}

/** El servidor de la construcción: su origen, cómo retirar la tabla de vectores y cómo cerrarlo. */
interface Servido {
  readonly origen: string;
  readonly retirarLaTabla: () => void;
  readonly cerrar: () => Promise<void>;
}

/**
 * La web de la construcción servida por el servidor local del producto, como en el despliegue; sin API. Después de
 * retirarLaTabla, la tabla de vectores del paquete responde 404 y todo lo demás se sirve igual.
 */
async function servir(web: string): Promise<Servido> {
  const carpeta = mkdtempSync(join(tmpdir(), 'motor-empaquetado-servidor-'));
  const autoridad = join(carpeta, 'autoridad-secciones.sqlite');
  const api = (): Promise<Response> => Promise.resolve(new Response(null, { status: NO_EXISTE }));
  // La CSP admite los mapas de esta construcción, no los de mapa-de-modulos.ts.
  const huellaMapaModulos = huellasDeLosMapas(web).join(' ');
  const opciones = {
    web,
    api,
    archivoAutoridadSecciones: autoridad,
    puerto: 0,
    anfitrion: '127.0.0.1',
    huellaMapaModulos,
  };
  const servidor = crearServidor(opciones);
  let sinLaTabla = false;
  const atender = servidor.listeners('request') as RequestListener[];
  servidor.removeAllListeners('request');
  servidor.on('request', (peticion: IncomingMessage, respuesta: ServerResponse) => {
    const ruta = new URL(peticion.url ?? '/', 'http://127.0.0.1').pathname;
    if (sinLaTabla && ruta.startsWith('/paquete/') && ruta.endsWith(TABLA_DE_VECTORES)) {
      respuesta.writeHead(NO_EXISTE).end();
      return;
    }
    for (const oyente of atender) {
      oyente.call(servidor, peticion, respuesta);
    }
  });
  servidor.listen(0, '127.0.0.1');
  await once(servidor, 'listening');
  const direccion = servidor.address();
  const puerto = typeof direccion === 'object' && direccion ? direccion.port : 0;
  return {
    origen: `http://127.0.0.1:${puerto}`,
    retirarLaTabla: () => {
      sinLaTabla = true;
    },
    // Primero el servidor, que tiene abierta la base de la autoridad; después, su carpeta.
    cerrar: async () => {
      const cerrado = once(servidor, 'close');
      servidor.closeAllConnections();
      servidor.close();
      await cerrado;
      rmSync(carpeta, { recursive: true, force: true });
    },
  };
}

/** Qué opción de una pregunta se responde en el paso `n` del caso: la primera, o una sorteada con ruido. */
type Eleccion = (pregunta: string, opciones: number, n: number) => number;

const PRIMERA: Eleccion = () => 0;

/** 2^32: lleva los primeros 4 bytes de la huella a [0, 1). */
const ESCALA_DEL_AZAR = 4294967296;

/**
 * La opción sorteada, fija por caso, paso y pregunta. Es la fórmula de la tirada fija del medidor (crearAzar(null), en
 * motores/ocupaciones/herramientas/medicion/azar.ts), escrita aquí: fuera del motor solo se importa su entrada pública
 * (pruebas/motores/motores-independientes.test.ts).
 */
function sorteada(clave: string): Eleccion {
  const azar = (...partes: string[]) =>
    createHash('sha256').update(partes.join('|')).digest().readUInt32BE(0) / ESCALA_DEL_AZAR;
  return (pregunta, opciones, n) => Math.floor(azar('navegador', clave, String(n), pregunta) * opciones);
}

/** Las respuestas siguientes: la opción elegida de la pregunta del paso, o ninguna si el paso no pregunta. */
function siguiente(cuerpo: string, elegir: Eleccion, n: number): { pregunta: string; opcion: string } | null {
  const { paso } = JSON.parse(cuerpo) as {
    paso?: { tipo: string; pregunta?: { id: string; opciones: { id: unknown }[] } };
  };
  const pregunta = paso?.tipo === 'pregunta' ? paso.pregunta : undefined;
  const opcion = pregunta?.opciones[elegir(pregunta.id, pregunta.opciones.length, n)];
  return pregunta && opcion ? { pregunta: pregunta.id, opcion: String(opcion.id) } : null;
}

interface Peticion {
  readonly id: number;
  readonly paquete: string;
  readonly completo: boolean;
  readonly url: string;
  readonly method: string;
  readonly headers: [string, string][];
  readonly body: string;
}

/**
 * Deja en la página `guion`, que da la dirección de un guion de GUIONES_DE_LA_PRUEBA lista para registrarlo o
 * arrancarlo, con la regla de guionAdmitido (web/scripts/confianza.js); con Trusted Types, por su política.
 */
async function prepararGuiones(pagina: Page): Promise<void> {
  await pagina.evaluate(
    ([politica, propios]) => {
      type Fabrica = { createPolicy: (nombre: string, reglas: object) => { createScriptURL: (t: string) => string } };
      const raiz = new URL('/', location.href);
      const admitido = (direccion: string): string => {
        const url = new URL(direccion, raiz);
        const propio =
          url.origin === raiz.origin &&
          url.pathname.startsWith(raiz.pathname) &&
          propios.includes(url.pathname.slice(raiz.pathname.length));
        if (!propio) {
          throw new TypeError(`Guion no admitido: ${direccion}`);
        }
        return url.href;
      };
      const fabrica = (globalThis as unknown as { trustedTypes?: Fabrica }).trustedTypes;
      const creada = fabrica?.createPolicy(politica, { createScriptURL: admitido });
      (globalThis as unknown as { guion: (t: string) => string }).guion = (texto) =>
        creada ? creada.createScriptURL(texto) : admitido(texto);
    },
    [POLITICA_DEL_WORKER, GUIONES_DE_LA_PRUEBA] as const,
  );
}

/**
 * Registra el service worker de la construcción y espera a que controle la página. Si su instalación falla y queda
 * «redundant», lo dice en el acto en vez de esperar hasta el plazo. El mensaje no atribuye la causa: puede ser un archivo
 * que no cuadra con su huella u otro fallo de la instalación.
 */
async function controlarConElServiceWorker(pagina: Page): Promise<void> {
  const desenlace = await conPlazo(
    pagina.evaluate(async () => {
      const { guion } = globalThis as unknown as { guion: (t: string) => string };
      const contenedor = navigator.serviceWorker;
      const controla = new Promise<string>((listo) => {
        contenedor.addEventListener('controllerchange', () => listo('controla'));
      });
      const registro = await contenedor.register(guion('/service-worker.js'));
      const instalando = registro.installing;
      const redundante = new Promise<string>((listo) => {
        instalando?.addEventListener('statechange', () => {
          if (instalando.state === 'redundant') {
            listo('redundante');
          }
        });
      });
      return contenedor.controller ? 'controla' : Promise.race([controla, redundante]);
    }),
    PLAZO_MS,
    'el service worker no llegó a controlar la página',
  );
  if (desenlace !== 'controla') {
    throw new Error('la instalación del service worker de la construcción falló: quedó «redundant»');
  }
}

/**
 * La página controlada por el service worker de la construcción, con la copia del paquete pedida y, después de
 * `antesDelWorker`, el Worker del motor en marcha. Falla si el service worker no dice que la copia ha quedado completa.
 */
async function abrirElWorker(
  navegador: Browser,
  origen: string,
  antesDelWorker: (pagina: Page) => Promise<void>,
): Promise<Page> {
  // La prueba registra el service worker y crea el Worker desde una página de la web sin guiones (llms.txt), con la CSP
  // omitida: nada de la página compite con ella. WebKit mantiene Trusted Types aunque se omita la CSP («This assignment
  // requires a TrustedScriptURL»), así que las dos direcciones pasan por una política de nombre admitido con la misma
  // regla que guionAdmitido (web/scripts/confianza.js): solo un guion propio de una lista cerrada, del mismo origen y
  // bajo la raíz de la web; cualquier otra dirección es un error. Sin Trusted Types, van como texto, con la misma regla.
  const pagina = await (await navegador.newContext({ bypassCSP: true })).newPage();
  await pagina.goto(`${origen}/llms.txt`);
  await prepararGuiones(pagina);
  await controlarConElServiceWorker(pagina);
  // Como la página (motor-local/cliente.js, laCopia), se pide al service worker la copia del paquete y se espera a que
  // diga cómo ha quedado (src/service-worker/paquete.js, ESTADO_DEL_PAQUETE): el service worker solo sirve el paquete de
  // su copia; sin ella, el Worker no carga el motor.
  const completo = await conPlazo(
    pagina.evaluate(
      ([preparar, estado]) =>
        new Promise<boolean>((listo) => {
          const contenedor = navigator.serviceWorker;
          contenedor.addEventListener('message', ({ data }: MessageEvent<{ type?: string; completo?: boolean }>) => {
            if (data?.type === estado) {
              listo(data.completo === true);
            }
          });
          contenedor.startMessages();
          void contenedor.ready.then((registro) => registro.active?.postMessage({ type: preparar }));
        }),
      [PREPARAR_PAQUETE, ESTADO_DEL_PAQUETE] as const,
    ),
    PLAZO_MS,
    'el service worker no dijo cómo ha quedado la copia del paquete',
  );
  if (!completo) {
    throw new Error('el service worker no completó la copia del paquete');
  }
  await antesDelWorker(pagina);
  await pagina.evaluate(() => {
    const { guion } = globalThis as unknown as { guion: (t: string) => string };
    (globalThis as unknown as { motor: Worker }).motor = new Worker(guion('/scripts/motor-local/worker.js'), {
      type: 'module',
    });
  });
  return pagina;
}

/** Retira la tabla de vectores de la copia del paquete que guarda el service worker en el dispositivo. */
async function retirarDeLaCopia(pagina: Page): Promise<void> {
  const retiradas = await pagina.evaluate(
    async ([prefijo, tabla]) => {
      let cuantas = 0;
      for (const nombre of (await caches.keys()).filter((n) => n.startsWith(prefijo))) {
        const copia = await caches.open(nombre);
        for (const peticion of await copia.keys()) {
          if (new URL(peticion.url).pathname.endsWith(tabla) && (await copia.delete(peticion))) {
            cuantas += 1;
          }
        }
      }
      return cuantas;
    },
    [PREFIJO_DEL_PAQUETE, TABLA_DE_VECTORES] as const,
  );
  if (retiradas !== 1) {
    throw new Error(`la tabla de vectores tenía que estar una vez en la copia del dispositivo: estaba ${retiradas}`);
  }
}

/**
 * Lo que responde el Worker del paquete a una petición, como lo recibe la página (web/scripts/motor-local/cliente.js).
 * Si no responde en PLAZO_DE_UN_PASO_MS, falla diciendo qué paso: no espera hasta el plazo del caso.
 */
function alWorker(pagina: Page, peticion: Peticion): Promise<Respondida> {
  const respondida = pagina.evaluate(
    (p) =>
      new Promise<Respondida>((listo) => {
        const motor = (globalThis as unknown as { motor: Worker }).motor;
        const oir = (evento: MessageEvent<Respondida & { id: number }>): void => {
          const { data } = evento;
          if (data.id === p.id) {
            motor.removeEventListener('message', oir);
            const otro = typeof data.status === 'number' ? {} : { otro: JSON.stringify(data) };
            listo({ status: data.status, body: data.body, ...otro });
          }
        };
        motor.addEventListener('message', oir);
        motor.postMessage(p);
      }),
    peticion,
  );
  return conPlazo(respondida, PLAZO_DE_UN_PASO_MS, `el Worker del paquete no respondió el paso ${peticion.id}`);
}

/** Lo comparado: los pasos, los que no coinciden y los que dan un paso con la IA que corresponde a la variante. */
interface Cuenta {
  comparados: number;
  conLaIa: number;
  readonly distintos: string[];
}

/**
 * Si una respuesta es un paso calculado con la IA de la variante (ruta-local.ts): el clasificador cargado y la tabla de
 * vectores cargada o, en la variante sin vectores, sin cargar.
 */
function conLaIa(estado: number, cuerpo: string, vectores: boolean): boolean {
  const { paso, lectura } = JSON.parse(cuerpo) as { paso?: unknown; lectura?: Record<string, unknown> };
  return estado === BIEN && paso !== undefined && lectura?.conVectores === vectores && lectura.conClasificador === true;
}

/** La primera diferencia entre dos respuestas: el estado, o la posición del cuerpo y lo que dice cada una allí. */
export function diferencia(delPaquete: Respondida, deLasFuentes: Respondida): string {
  if (delPaquete.otro !== undefined) {
    return `el Worker respondió sin estado: ${delPaquete.otro.slice(0, CORTE_DEL_MENSAJE)}`;
  }
  if (delPaquete.status !== deLasFuentes.status) {
    return `estado ${delPaquete.status} en el paquete y ${deLasFuentes.status} en las fuentes`;
  }
  const a = delPaquete.body;
  const b = deLasFuentes.body;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) {
    i += 1;
  }
  const tramo = (texto: string): string =>
    JSON.stringify(texto.slice(Math.max(0, i - CONTEXTO_DE_LA_DIFERENCIA), i + CONTEXTO_DE_LA_DIFERENCIA));
  const largos = `${a.length} y ${b.length} caracteres`;
  return `cuerpo distinto desde el carácter ${i} (${largos}): paquete ${tramo(a)}, fuentes ${tramo(b)}`;
}

/** Un caso, hasta PASOS pasos: cada uno, al Worker del paquete y al motor de las fuentes. */
async function recorrerCaso(
  motores: { pagina: Page; fuentes: { responder: (peticion: Peticion) => Promise<Response> } },
  direcciones: { paquete: string; completo: boolean; url: string },
  caso: CasoDelBanco,
  recorrido: { readonly elegir: Eleccion; readonly vectores: boolean; readonly cuenta: Cuenta },
): Promise<void> {
  const { cuenta } = recorrido;
  const respuestas: { pregunta: string; opcion: string }[] = [];
  for (let n = 0; n < PASOS; n++) {
    const body = JSON.stringify({ texto: caso.texto, idioma: caso.idioma, respuestas });
    cuenta.comparados += 1;
    const peticion = { id: cuenta.comparados, ...direcciones, method: 'POST', headers: CABECERAS, body };
    const delPaquete = await alWorker(motores.pagina, peticion);
    const respuesta = await motores.fuentes.responder(peticion);
    const esperada = { status: respuesta.status, body: await respuesta.text() };
    if (delPaquete.status !== esperada.status || delPaquete.body !== esperada.body) {
      cuenta.distintos.push(`${caso.idioma} «${caso.texto}», paso ${n + 1}: ${diferencia(delPaquete, esperada)}`);
    }
    cuenta.conLaIa += conLaIa(esperada.status, esperada.body, recorrido.vectores) ? 1 : 0;
    const otra = siguiente(esperada.body, recorrido.elegir, n);
    if (!otra) {
      return;
    }
    respuestas.push(otra);
  }
}

/** Lo que da la muestra en un navegador y una variante: el navegador y su versión, la variante y la cuenta de sus pasos. */
export interface Celda extends Cuenta {
  readonly navegador: Navegador;
  readonly version: string;
  readonly variante: string;
  readonly casos: number;
}

/**
 * Pasa los casos por el Worker del paquete en `navegador` y por el motor de las fuentes, en la `variante` dada, y
 * devuelve cuántos pasos se han comparado, cuántos dan un paso con la IA de la variante y los que no coinciden, con su
 * primera diferencia. El navegador arranca con el entorno de los lanzamientos directos (entornoParaLanzar,
 * scripts/entorno-firefox.ts): el heredado, con HOME y sin CFFIXED_USER_HOME, y las carpetas de Firefox (MOZ_APP_DATA y
 * MOZ_LOCAL_APP_DATA) heredadas de la batería o propias del proceso; y con la identidad web (identidadAlArrancar). El
 * servidor y el navegador son recursos del caso `t` (recursos-del-caso.mjs): se cierran aunque venza.
 */
export async function compararEnNavegador(
  t: TestContext,
  web: string,
  casos: readonly CasoDelBanco[],
  { navegador: motor, variante }: { readonly navegador: Navegador; readonly variante: string },
): Promise<Celda> {
  const forma = VARIANTES_DEL_NAVEGADOR[variante];
  if (!forma) {
    throw new Error(`variante desconocida: ${variante}`);
  }
  const recursos = recursosDelCaso(t);
  const servido = await recursos.abrir(
    'el servidor de la construcción',
    () => servir(web),
    (abierto) => abierto.cerrar(),
  );
  const { origen } = servido;
  const navegador = await lanzarConPlazo(
    MOTORES[motor],
    {
      headless: true,
      env: entornoParaLanzar(),
      ...opcionesDeRed(motor),
      ...identidadAlArrancar(motor, SIN_RED_EN_CHROMIUM),
    },
    t.name,
    { recursos },
  );
  try {
    const pagina = await abrirElWorker(navegador, origen, async (abierta) => {
      if (!forma.vectores) {
        await retirarDeLaCopia(abierta);
        servido.retirarLaTabla();
      }
    });
    const paquete = `${origen}/paquete/${readdirSync(join(web, 'paquete'))[0]}/`;
    const fuentes = (await import(join(RAIZ, 'src/plataforma/navegador/motor.ts'))) as MotorDeLasFuentes;
    const deLasFuentes = await fuentes.crearMotorLocal(new URL(paquete));
    const cuenta: Cuenta = { comparados: 0, conLaIa: 0, distintos: [] };
    for (const caso of casos) {
      await recorrerCaso(
        { pagina, fuentes: deLasFuentes },
        { paquete, completo: true, url: `${origen}${RUTA_DEL_PASO}` },
        caso,
        { elegir: forma.ruido ? sorteada(caso.clave) : PRIMERA, vectores: forma.vectores, cuenta },
      );
    }
    return { navegador: motor, version: navegador.version(), variante, casos: casos.length, ...cuenta };
  } finally {
    await cerrarSinSustituir(() => recursos.cerrar(navegador), `el navegador ${motor} no se cerró`);
    await cerrarSinSustituir(() => recursos.cerrar(servido), 'el servidor de la construcción no se cerró');
  }
}
