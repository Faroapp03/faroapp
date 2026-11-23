// El motor empaquetado de una construcción, cargado en Node con sus propios objetos para que lo mida el medidor del
// producto (motores/ocupaciones/herramientas/medir-casos.ts). El paquete solo exporta crearMotorLocal y cargarPaquete:
// las demás piezas se toman por el nombre que les conserva esbuild (keepNames), y la previa por omisión del paso de
// pantalla, del ámbito de su módulo con el inspector de V8. No se cambia ni un byte del paquete. Sus lecturas (fetch)
// se sirven de la carpeta web/ de la construcción, que llega en FARO_PAQUETE_WEB. El medidor lee la tabla de atributos
// como archivo de las fuentes: antes de medir se exige que sea, huella a huella, la que lleva el paquete.

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { Session } from 'node:inspector';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

type Funcion = (...argumentos: never[]) => unknown;
type Exportada = (...argumentos: unknown[]) => unknown;
interface Remoto {
  readonly objectId?: string;
  readonly description?: string;
}
interface Propiedad {
  readonly name: string;
  readonly value?: Remoto;
}
interface MotorLocal {
  readonly datos: unknown;
  readonly responder: (peticion: {
    url: string;
    method: string;
    headers: [string, string][];
    body: string | null;
  }) => Promise<Response>;
}

const WEB = process.env.FARO_PAQUETE_WEB ?? '';
/** La tabla de atributos de las fuentes, la que lee el medidor (medicion.ts la enlaza en la raíz medida). */
const ATRIBUTOS_DE_LAS_FUENTES = fileURLToPath(
  new URL('../../../motores/ocupaciones/src/recorrido/preguntas/atributos.json', import.meta.url),
);
const ORIGEN = 'http://paquete.invalid/';
const PRESTADO = '__faroPrestado';
const NO_EXISTE = 404;
const leidos: string[] = [];

globalThis.fetch = (entrada: RequestInfo | URL): Promise<Response> => {
  const url = new URL(entrada instanceof Request ? entrada.url : String(entrada));
  if (url.origin !== new URL(ORIGEN).origin) {
    return Promise.reject(new TypeError(`Lectura fuera de la construcción: ${url.href}`));
  }
  const ruta = decodeURIComponent(url.pathname.slice(1));
  leidos.push(ruta);
  try {
    return Promise.resolve(new Response(readFileSync(join(WEB, ruta))));
  } catch {
    return Promise.resolve(new Response(null, { status: NO_EXISTE }));
  }
};

// Al evaluarse, el paquete da nombre a cada función con Object.defineProperty(f, 'name', …): se anotan. Su ayudante
// guarda Object.defineProperty al cargarse, así que el envoltorio queda en él y, acabada la carga, solo lo delega,
// salvo mientras el paquete prepara su motor: las funciones que nombra entonces se anotan aparte.
const nombradas = new Map<string, Funcion[]>();
const delMotor = new Map<string, Funcion[]>();
const definir = Object.defineProperty;
let anotando: Map<string, Funcion[]> | null = nombradas;
Object.defineProperty = <T>(objeto: T, clave: PropertyKey, descriptor: PropertyDescriptor & ThisType<unknown>): T => {
  if (anotando && clave === 'name' && typeof objeto === 'function' && typeof descriptor.value === 'string') {
    const lista = anotando.get(descriptor.value) ?? [];
    lista.push(objeto as Funcion);
    anotando.set(descriptor.value, lista);
  }
  return definir(objeto, clave, descriptor);
};
const entrada = pathToFileURL(join(WEB, 'motor/src/plataforma/navegador/motor.js')).href;
const modulo = (await import(entrada).finally(() => {
  anotando = null;
  Object.defineProperty = definir;
})) as { crearMotorLocal: (base: URL) => Promise<MotorLocal> };

function unica(nombre: string, sirve: (f: Funcion) => boolean = () => true, en = nombradas): Exportada {
  const halladas = (en.get(nombre) ?? []).filter(sirve);
  if (halladas.length !== 1) {
    throw new Error(`El paquete trae ${halladas.length} funciones «${nombre}» que sirvan, no una`);
  }
  return halladas[0] as unknown as Exportada;
}

function pedirAlInspector(sesion: Session, metodo: string, parametros: object): Record<string, unknown> {
  let respuesta: object | undefined;
  sesion.post(metodo, parametros, (error, resultado) => {
    if (error) {
      throw error;
    }
    respuesta = resultado;
  });
  if (!respuesta) {
    throw new Error(`El inspector no ha respondido a ${metodo}`);
  }
  return respuesta as Record<string, unknown>;
}

/** El valor de una variable del módulo de `funcion`, leído de su ámbito con el inspector. */
function delAmbito(funcion: Exportada, variable: string): unknown {
  const sesion = new Session();
  sesion.connect();
  const almacen = globalThis as Record<string, unknown>;
  try {
    almacen[PRESTADO] = funcion;
    const remota = pedirAlInspector(sesion, 'Runtime.evaluate', { expression: `globalThis.${PRESTADO}` });
    const propiedades = (id: string | undefined): Record<string, unknown> =>
      pedirAlInspector(sesion, 'Runtime.getProperties', { objectId: id, ownProperties: true });
    const internas = propiedades((remota.result as Remoto).objectId).internalProperties as Propiedad[];
    const ambitos = propiedades(internas.find((p) => p.name === '[[Scopes]]')?.value?.objectId).result as Propiedad[];
    const delModulo = ambitos.find((a) => a.value?.description === 'Module')?.value?.objectId;
    const valor = (propiedades(delModulo).result as Propiedad[]).find((p) => p.name === variable)?.value;
    const asignar = `function () { globalThis.${PRESTADO} = this; }`;
    pedirAlInspector(sesion, 'Runtime.callFunctionOn', { objectId: valor?.objectId, functionDeclaration: asignar });
    return almacen[PRESTADO];
  } finally {
    almacen[PRESTADO] = undefined;
    sesion.disconnect();
  }
}

const version = readdirSync(join(WEB, 'paquete'))[0] ?? '';
anotando = delMotor;
const motor = await modulo.crearMotorLocal(new URL(`paquete/${version}/`, ORIGEN));
// Un paso espera a que el paquete termine de leer sus archivos extra: así se sabe si su pantalla usa el clasificador.
const cuerpo = JSON.stringify({ texto: 'cocinero', idioma: 'es', respuestas: [] });
const url = new URL('local/recorrido-v2/paso', ORIGEN).href;
await (await motor.responder({ url, method: 'POST', headers: [], body: cuerpo })).text();
anotando = null;

// La tabla de atributos que lleva el paquete (la que importa src/plataforma/navegador/motor.ts) la devuelve, ya
// comprobada, la función losAtributos de su motor. Se compara su huella con la de la tabla de las fuentes.
const huella = (valor: unknown): string => createHash('sha256').update(JSON.stringify(valor)).digest('hex');
/** La huella SHA-256 de la tabla de atributos del paquete, igual a la de las fuentes. */
export const HUELLA_DE_LOS_ATRIBUTOS = huella(unica('losAtributos', undefined, delMotor)());
const huellaDeLasFuentes = huella(JSON.parse(readFileSync(ATRIBUTOS_DE_LAS_FUENTES, 'utf8')));
if (HUELLA_DE_LOS_ATRIBUTOS !== huellaDeLasFuentes) {
  throw new Error(
    `La tabla de atributos del paquete (${HUELLA_DE_LOS_ATRIBUTOS}) no es la de las fuentes (${huellaDeLasFuentes})`,
  );
}

const pasoDePantalla = unica('pasoDePantalla');
// La previa por omisión es el valor por omisión del cuarto parámetro del paso: function n(a,b,c,d=PREVIA){…}.
const porOmision = /^function\s*[\w$]*\([^,]*,[^,]*,[^,]*,[^=]*=([\w$]+)\)/.exec(String(pasoDePantalla))?.[1] ?? '';
const previaCalibrada = delAmbito(pasoDePantalla, porOmision);
if (typeof previaCalibrada !== 'function') {
  throw new Error('No se encuentra la previa por omisión del paso de pantalla en el paquete');
}

export const CLASIFICADOR_EN_LA_PANTALLA = leidos.some((ruta) => ruta.endsWith('/clasificador-movil.json'));
export const cargarDatos = (): unknown => motor.datos;
export const comprobarAtributos = unica('comprobarAtributos');
export { pasoDePantalla, previaCalibrada };
export const buscar = unica('buscar', (f) => f.constructor.name === 'Function');
export const textoDeBusqueda = unica('textoDeBusqueda');
export const usarVectores = unica('usarVectores');
export const usarClasificador = unica('usarClasificador');
export const textoParaVectores = unica('textoParaVectores');
export const cargarDesdeContenedor = unica('cargarDesdeContenedor');
export const cargarClasificador = unica('cargarClasificador');
export const textoComoEnEsco = unica('textoComoEnEsco');
