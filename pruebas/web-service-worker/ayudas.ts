import { createHash } from 'node:crypto';
import { type Context, createContext, runInContext } from 'node:vm';
import { textoPoliticaCache } from '../../herramientas/web/politica-cache.ts';
import {
  catalogoDeListas,
  lineaDelValor,
  type ValoresDelServicio,
} from '../../herramientas/web/servicio/servicio-publicado.ts';
import { servicioPublicado } from '../ayudas/web-construida.ts';

export interface Catalogos {
  politica?: string;
  archivos?: string[];
  bajoDemanda?: string[];
  comprobados?: [string, string][];
  paginasSecciones?: [string, string][];
  /**
   * Lo que entrega la red de la prueba para cada ruta de `archivos` y `bajoDemanda`, de lo que sale su huella en
   * HUELLAS_DE_ARCHIVOS (huellasDeArchivos). Sin él, el cuerpo de RedDePrueba por defecto: la ruta de la dirección.
   */
  cuerpoDe?: (ruta: string) => string;
  /** Rutas de `archivos` o `bajoDemanda` que el catálogo deja sin huella: un catálogo incoherente. */
  sinHuella?: string[];
  paquete?: string;
  /** TAMANOS_DEL_PAQUETE: lo que pesa cada archivo del paquete, como JSON. */
  tamanos?: string;
  version?: string;
  fuente?: string;
}
export const BASES = ['https://ejemplo.invalid/', 'https://ejemplo.invalid/Mis%20documentos/A%C3%B1o%202026/'];
type Oyentes = Map<string, (evento: Record<string, unknown>) => void>;

/** CacheStorage de memoria; cada lectura devuelve una rama nueva del cuerpo, como el navegador. */
class CopiasDePrueba {
  guardadas = new Map<string, Map<string, Response>>();
  borradas: string[] = [];
  aperturas = 0;
  antesDeGuardar?: (nombre: string, clave: string) => Promise<void>;
  despuesDeGuardar?: (nombre: string, clave: string) => void;
  async open(nombre: string) {
    this.aperturas++;
    const mapa = this.guardadas.get(nombre) ?? new Map<string, Response>();
    this.guardadas.set(nombre, mapa);
    return {
      match: async (clave: string | Request) => mapa.get(typeof clave === 'string' ? clave : clave.url)?.clone(),
      keys: async () => [...mapa.keys()].map((clave) => new Request(clave)),
      delete: async (clave: string | Request) => mapa.delete(typeof clave === 'string' ? clave : clave.url),
      put: async (clave: string, respuesta: Response) => {
        await this.antesDeGuardar?.(nombre, clave);
        mapa.set(clave, respuesta.clone());
        this.despuesDeGuardar?.(nombre, clave);
      },
    };
  }
  async keys() {
    return [...this.guardadas.keys()];
  }
  async has(nombre: string) {
    return this.guardadas.has(nombre);
  }
  async delete(nombre: string) {
    this.borradas.push(nombre);
    return this.guardadas.delete(nombre);
  }
  async match(clave: string, opciones: { cacheName: string }) {
    return this.guardadas.get(opciones.cacheName)?.get(clave)?.clone();
  }
}

/** La huella SHA-256 de un texto, como la calcula la preparación de la web para HUELLAS_DE_ARCHIVOS. */
export const huellaDe = (texto: string) => createHash('sha256').update(texto).digest('hex');

/**
 * HUELLAS_DE_ARCHIVOS del catálogo de prueba: la huella real de lo que entrega la red de la prueba por cada archivo de
 * ARCHIVOS y BAJO_DEMANDA (`cuerpoDe`, o el cuerpo de RedDePrueba por defecto). Nunca se acepta un cuerpo sin
 * comprobarlo: lo que una prueba cambie después en su red ya no cuadra, como un archivo de otra versión.
 */
function huellasDeArchivos(base: string, catalogos: Catalogos): [string, string][] {
  const cuerpoDe = catalogos.cuerpoDe ?? ((ruta: string) => new URL(ruta, base).pathname);
  const rutas = [...(catalogos.archivos ?? ['inicio.html', 'sin-conexion.html']), ...(catalogos.bajoDemanda ?? [])];
  const sinHuella = new Set(catalogos.sinHuella ?? []);
  return rutas.filter((ruta) => !sinHuella.has(ruta)).map((ruta) => [ruta, huellaDe(cuerpoDe(ruta))]);
}

/**
 * El CATALOGO de los catálogos de una prueba. Una ruta va en una sola clase: si la prueba la nombra en varias listas
 * (un catálogo contaminado o de otra política), cuenta la que la protege más, como el service worker antes del
 * CATALOGO único: comprobado, luego demanda y luego lo que se precarga. Las huellas son las de lo que queda en ARCHIVOS
 * y BAJO_DEMANDA, una por ruta.
 */
function catalogoDePrueba(base: string, catalogos: Catalogos) {
  const comprobados = catalogos.comprobados ?? [];
  const enComprobados = new Set(comprobados.map(([ruta]) => ruta));
  const bajoDemanda = (catalogos.bajoDemanda ?? []).filter((ruta) => !enComprobados.has(ruta));
  const fuera = new Set([...enComprobados, ...bajoDemanda]);
  const archivos = (catalogos.archivos ?? ['inicio.html', 'sin-conexion.html']).filter((ruta) => !fuera.has(ruta));
  const deLaCopia = new Set([...archivos, ...bajoDemanda]);
  return catalogoDeListas({
    ARCHIVOS: archivos,
    BAJO_DEMANDA: bajoDemanda,
    PAGINAS_DE_SECCIONES: (catalogos.paginasSecciones ?? []).filter(([ruta]) => !fuera.has(ruta)),
    HUELLAS_DE_ARCHIVOS: [...new Map(huellasDeArchivos(base, catalogos).filter(([ruta]) => deLaCopia.has(ruta)))],
    COMPROBADOS: comprobados,
  });
}

class RedDePrueba {
  peticiones: string[] = [];
  offline = true;
  respuesta: ((url: string, opciones?: RequestInit) => Response | Promise<Response>) | undefined;
  async fetch(pedido: Request | string, opciones?: RequestInit) {
    const url = typeof pedido === 'string' ? pedido : pedido.url;
    this.peticiones.push(url);
    if (this.offline) {
      throw new TypeError('Sin red simulada');
    }
    if (this.respuesta) {
      // La señal con que se puede cortar la petición, venga en las opciones o en la Request, como en fetch.
      const signal = opciones?.signal ?? (typeof pedido === 'string' ? undefined : pedido.signal);
      return this.respuesta(url, signal ? { ...opciones, signal } : opciones);
    }
    return new Response(new URL(url).pathname, {
      headers: { 'content-type': url.endsWith('.html') ? 'text/html' : 'application/octet-stream' },
    });
  }
}

/** El service worker derivado de src/service-worker/ que publica la construcción (herramientas/web/servicio). */
const DERIVADO = servicioPublicado();

/**
 * El valor de una declaración generada del service worker derivado, en la misma línea que escribe la construcción
 * (lineaDelValor). Exige que esté una vez, para que ninguna prueba ejecute los valores publicados.
 */
function conValor(codigo: string, nombre: keyof ValoresDelServicio, valor: unknown): string {
  const linea = lineaDelValor(nombre);
  if (codigo.match(linea)?.length !== 1) {
    throw new Error(`El service worker no declara ${nombre} una sola vez en una línea`);
  }
  return codigo.replace(linea, () => `var ${nombre} = ${JSON.stringify(valor)};`);
}

function cargarEntrada(contexto: Context, base: string, catalogos: Catalogos) {
  if (catalogos.politica !== undefined && catalogos.politica !== textoPoliticaCache()) {
    throw new Error('El service worker derivado lleva la política de su fuente única: no admite otra');
  }
  let codigo = catalogos.fuente ?? DERIVADO;
  const generados: Partial<Record<keyof ValoresDelServicio, unknown>> = {
    CATALOGO: catalogoDePrueba(base, catalogos),
    ...(catalogos.paquete ? { PAQUETE: catalogos.paquete } : {}),
    ...(catalogos.tamanos ? { TAMANOS_DEL_PAQUETE: catalogos.tamanos } : {}),
    ...(catalogos.version ? { VERSION: catalogos.version } : {}),
  };
  for (const [nombre, valor] of Object.entries(generados)) {
    codigo = conValor(codigo, nombre as keyof ValoresDelServicio, valor);
  }
  runInContext(codigo, contexto, { filename: 'service-worker.js' });
}

/** Cuántas veces el service worker reclama las pestañas (clients.claim) y salta la espera (skipWaiting). */
type LlamadasDelCiclo = { reclamaciones: number; saltos: number };

/**
 * Los cerrojos con nombre (Web Locks), como en el navegador: una petición espera a que termine la anterior con el mismo
 * nombre, haya ido bien o mal; con `ifAvailable`, si está tomado, no espera y su acción recibe null.
 */
function cerrojos() {
  const enCurso = new Map<string, Promise<unknown>>();
  const tomados = new Set<string>();
  return {
    tomados,
    request: (
      nombre: string,
      opcionesOAccion: { ifAvailable?: boolean } | ((cerrojo: unknown) => Promise<unknown>),
      soloAccion?: (cerrojo: unknown) => Promise<unknown>,
    ) => {
      const accion = typeof opcionesOAccion === 'function' ? opcionesOAccion : soloAccion;
      const ifAvailable = typeof opcionesOAccion === 'object' && opcionesOAccion.ifAvailable === true;
      if (!accion) {
        throw new TypeError('Falta la acción del cerrojo');
      }
      if (ifAvailable && tomados.has(nombre)) {
        return accion(null);
      }
      const turno = (enCurso.get(nombre) ?? Promise.resolve()).then(async () => {
        tomados.add(nombre);
        try {
          return await accion({ name: nombre });
        } finally {
          tomados.delete(nombre);
        }
      });
      enCurso.set(
        nombre,
        turno.then(
          () => undefined,
          () => undefined,
        ),
      );
      return turno;
    },
  };
}

/** Una pestaña abierta (WindowClient): cuenta a qué direcciones la hace navegar el service worker. */
export type PestanaDePrueba = {
  id: string;
  url: string;
  navegaciones: string[];
  navigate: (url: string) => Promise<unknown>;
};

/** Una pestaña de prueba en `url`. */
export function pestanaEn(id: string, url: string): PestanaDePrueba {
  const pestana: PestanaDePrueba = {
    id,
    url,
    navegaciones: [],
    navigate: async (destino) => {
      pestana.navegaciones.push(destino);
      return pestana;
    },
  };
  return pestana;
}

function ambitoDelServicio(
  base: string,
  oyentes: Oyentes,
  llamadas: LlamadasDelCiclo,
  locks: ReturnType<typeof cerrojos>,
) {
  const pestanas: PestanaDePrueba[] = [];
  return {
    location: { href: new URL('service-worker.js', base).href },
    navigator: { locks },
    registration: { waiting: null as object | null, installing: null as object | null, update: async () => {} },
    clients: {
      claim: async () => {
        llamadas.reclamaciones++;
      },
      /** Las pestañas abiertas; una prueba las añade con sw.evaluar('self.clients.pestanas'). */
      pestanas,
      matchAll: async () => pestanas,
      get: async (id: string) => pestanas.find((pestana) => pestana.id === id),
    },
    skipWaiting: async () => {
      llamadas.saltos++;
    },
    addEventListener: (tipo: string, fn: (evento: Record<string, unknown>) => void) => oyentes.set(tipo, fn),
  };
}

/**
 * Lo que el service worker usa de la plataforma. Los temporizadores se buscan en cada llamada, para que una prueba
 * pueda falsearlos (mock.timers).
 */
function plataforma() {
  return {
    URL,
    Headers,
    Request,
    Response,
    AbortSignal,
    AbortController,
    DOMException,
    setTimeout: (...argumentos: Parameters<typeof setTimeout>) => globalThis.setTimeout(...argumentos),
    clearTimeout: (plazo: ReturnType<typeof setTimeout>) => globalThis.clearTimeout(plazo),
    TextDecoder,
    Uint8Array,
    crypto,
  };
}

/**
 * Ejecuta la entrada real con catálogos ligeros; no instala una web ficticia ni abre almacenes del equipo. Con
 * `locks` (los `cerrojos` de otro), los dos comparten los cerrojos del origen, como el activo y el que espera.
 */
export function servicio(base: string, catalogos: Catalogos = {}, copias = new CopiasDePrueba(), locks = cerrojos()) {
  const oyentes: Oyentes = new Map();
  const red = new RedDePrueba();
  const avisos: unknown[][] = [];
  const llamadas: LlamadasDelCiclo = { reclamaciones: 0, saltos: 0 };
  const urlDe = (ruta: string) => new URL(ruta, base).href;
  const ambito = ambitoDelServicio(base, oyentes, llamadas, locks);
  const contexto = createContext({
    ...plataforma(),
    console: { warn: (...datos: unknown[]) => avisos.push(datos) },
    caches: copias,
    fetch: (pedido: Request | string, opciones?: RequestInit) => red.fetch(pedido, opciones),
    self: ambito,
    navigator: ambito.navigator,
  });
  cargarEntrada(contexto, base, catalogos);
  const nombreCopia = String(runInContext('COPIA', contexto));
  return {
    nombreCopia,
    copias,
    registro: ambito.registration,
    base,
    oyentes,
    red,
    guardadas: copias.guardadas,
    peticiones: red.peticiones,
    borradas: copias.borradas,
    avisos,
    urlDe,
    evaluar: (codigo: string) => runInContext(codigo, contexto),
    get aperturas() {
      return copias.aperturas;
    },
    get activaciones() {
      return llamadas.reclamaciones + llamadas.saltos;
    },
    get reclamaciones() {
      return llamadas.reclamaciones;
    },
    get saltos() {
      return llamadas.saltos;
    },
    conectar: () => {
      red.offline = false;
    },
    instalar: () => ciclo(oyentes, 'install'),
    activar: () => ciclo(oyentes, 'activate'),
  };
}

function ciclo(oyentes: Oyentes, tipo: string) {
  let tarea = Promise.resolve<unknown>(undefined);
  oyentes.get(tipo)?.({
    waitUntil: (p: Promise<unknown>) => {
      tarea = p;
    },
  });
  return tarea;
}

/** La ausencia de respondWith demuestra paso a red, incluso si hay una copia residual. */
export async function pedir(
  sw: ReturnType<typeof servicio>,
  ruta: string,
  opciones = { method: 'GET', mode: 'navigate' },
  idsDeLaNavegacion: { clientId?: string; resultingClientId?: string } = {},
) {
  let respuesta: Promise<Response> | undefined;
  const trabajos: Promise<unknown>[] = [];
  const antes = sw.aperturas;
  sw.oyentes.get('fetch')?.({
    request: { url: sw.urlDe(ruta), ...opciones },
    ...idsDeLaNavegacion,
    respondWith: (valor: Promise<Response> | Response) => {
      respuesta = Promise.resolve(valor);
    },
    waitUntil: (valor: Promise<unknown>) => trabajos.push(valor),
  });
  const recibida = await respuesta;
  await Promise.all(trabajos);
  return {
    interceptada: respuesta !== undefined,
    aperturas: sw.aperturas - antes,
    estado: recibida?.status,
    cuerpo: recibida ? await recibida.text() : null,
  };
}

export async function prepararPaquete(sw: ReturnType<typeof servicio>, revisar = false) {
  let trabajo = Promise.resolve<unknown>(undefined);
  let mensaje: unknown;
  sw.oyentes.get('message')?.({
    data: { type: 'PREPARAR_PAQUETE', revisar },
    source: {
      postMessage: (valor: unknown) => {
        mensaje = valor;
      },
    },
    waitUntil: (valor: Promise<unknown>) => {
      trabajo = valor;
    },
  });
  await trabajo;
  return mensaje;
}
