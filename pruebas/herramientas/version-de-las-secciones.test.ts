// Guardia: las pruebas que sirven o construyen el documento público de secciones toman su versión del producto
// (VERSION_SECCIONES_PUBLICAS), nunca de un número escrito a mano. Un número fijo se queda atrás cuando el producto
// sube de versión, y la copia sin conexión rechaza el documento y no se instala. Solo se admite un número donde una
// prueba ejerce a propósito una versión antigua o inválida, y cada excepción tiene que seguir en uso.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { join, relative, sep } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'acorn';
import { VERSION_SECCIONES_PUBLICAS } from '../../src/administracion/secciones-web.js';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
const CARPETA_DE_PRUEBAS = join(RAIZ, 'pruebas');
const EXTENSIONES_DE_CODIGO = /\.(?:ts|js|mjs)$/;

/** Un número de versión escrito en un documento público de secciones de una prueba. */
interface VersionEscrita {
  readonly archivo: string;
  readonly linea: number;
  readonly version: number;
}

interface Nodo {
  readonly type: string;
  readonly [campo: string]: unknown;
}

/** La política pública sin la Encuesta, que guardan los navegadores y las copias sin conexión ya instaladas. */
const VERSION_PUBLICA_SIN_ENCUESTA = 3;
/** Una versión que ya no es pública: el lector la rechaza. */
const VERSION_RECHAZADA = 2;

/** Las versiones escritas a mano que se admiten, por archivo desde la raíz. */
const EXCEPCIONES: Readonly<Record<string, readonly number[]>> = {
  // El lector acepta la política sin la Encuesta guardada y la vigente la sustituye; con la Encuesta, se rechaza.
  'pruebas/administracion/secciones-politica-v3.test.ts': [VERSION_PUBLICA_SIN_ENCUESTA],
  // La copia sin conexión instalada sin la Encuesta la abre al recibir la política vigente.
  'pruebas/web-service-worker/encuesta-sin-conexion.test.ts': [VERSION_PUBLICA_SIN_ENCUESTA],
  // El lector rechaza una versión que ya no es pública.
  'pruebas/web-controles/secciones.test.js': [VERSION_RECHAZADA],
  'pruebas/web-service-worker/secciones.test.ts': [VERSION_RECHAZADA],
};

function archivosDePruebas(carpeta: string): string[] {
  return readdirSync(carpeta, { withFileTypes: true }).flatMap((entrada) => {
    const ruta = join(carpeta, entrada.name);
    if (entrada.isDirectory()) {
      return entrada.name === 'fixtures' ? [] : archivosDePruebas(ruta);
    }
    return EXTENSIONES_DE_CODIGO.test(entrada.name) ? [ruta] : [];
  });
}

function esNodo(valor: unknown): valor is Nodo {
  return !!valor && typeof valor === 'object' && typeof (valor as { type?: unknown }).type === 'string';
}

/** El nombre de una propiedad escrita como identificador o como texto; `null` si es calculada o es una expansión. */
function nombreDePropiedad(propiedad: Nodo): string | null {
  if (propiedad.type !== 'Property' || propiedad.computed || !esNodo(propiedad.key)) {
    return null;
  }
  const clave = propiedad.key;
  if (clave.type === 'Identifier') {
    return String(clave.name);
  }
  return clave.type === 'Literal' && typeof clave.value === 'string' ? clave.value : null;
}

/** La propiedad de un objeto con ese nombre, si la tiene. */
function propiedad(propiedades: readonly Nodo[], nombre: string): Nodo | undefined {
  return propiedades.find((candidata) => nombreDePropiedad(candidata) === nombre);
}

/** El número escrito como valor de una propiedad, con su línea; `null` si el valor no es un número literal. */
function numeroEscrito(version: Nodo | undefined): { readonly linea: number; readonly valor: number } | null {
  const valor = version?.value;
  if (!esNodo(valor) || valor.type !== 'Literal' || typeof valor.value !== 'number') {
    return null;
  }
  return { linea: (valor.loc as { start: { line: number } }).start.line, valor: valor.value };
}

/** Todos los objetos literales del árbol, en orden de aparición. */
function objetosDelArbol(nodo: Nodo): Nodo[] {
  const hijos = Object.values(nodo)
    .flatMap((hijo) => (Array.isArray(hijo) ? hijo : [hijo]))
    .filter(esNodo);
  return [...(nodo.type === 'ObjectExpression' ? [nodo] : []), ...hijos.flatMap(objetosDelArbol)];
}

/**
 * Las versiones numéricas escritas en documentos públicos de secciones: los objetos con `autoridad` y `version`, y, en
 * un archivo que construye alguno, los que cambian la `version` de otro documento expandido (`{ ...doc, version: 2 }`).
 */
function versionesEscritas(archivo: string, texto: string): VersionEscrita[] {
  // Quitar los tipos deja espacios en su lugar, así las líneas son las del archivo.
  const codigo = archivo.endsWith('.ts') ? stripTypeScriptTypes(texto) : texto;
  const arbol = parse(codigo, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
  const objetos = objetosDelArbol(arbol as unknown as Nodo).map((objeto) => {
    const propiedades = (objeto.properties as unknown[]).filter(esNodo);
    const version = propiedad(propiedades, 'version');
    return {
      documento: !!version && !!propiedad(propiedades, 'autoridad'),
      expansion: propiedades.some((candidata) => candidata.type === 'SpreadElement'),
      numero: numeroEscrito(version),
    };
  });
  const construyeDocumentos = objetos.some(({ documento }) => documento);
  return objetos
    .filter(({ documento, expansion, numero }) => numero && (documento || (construyeDocumentos && expansion)))
    .map(({ numero }) => ({ archivo, linea: numero?.linea ?? 0, version: numero?.valor ?? 0 }));
}

const ESCRITAS = archivosDePruebas(CARPETA_DE_PRUEBAS).flatMap((ruta) =>
  versionesEscritas(relative(RAIZ, ruta).split(sep).join('/'), readFileSync(ruta, 'utf8')),
);

test('ninguna prueba escribe a mano la versión del documento público de secciones', () => {
  const ajenas = ESCRITAS.filter(
    ({ archivo, version }) => version === VERSION_SECCIONES_PUBLICAS || !EXCEPCIONES[archivo]?.includes(version),
  ).map(({ archivo, linea, version }) => `${archivo}:${linea} (versión ${version})`);
  assert.deepEqual(ajenas, []);
});

test('cada excepción ejerce una versión antigua o inválida y sigue en uso', () => {
  for (const [archivo, versiones] of Object.entries(EXCEPCIONES)) {
    for (const version of versiones) {
      assert.ok(version < VERSION_SECCIONES_PUBLICAS, `${archivo}: la versión ${version} no es antigua`);
      assert.ok(
        ESCRITAS.some((escrita) => escrita.archivo === archivo && escrita.version === version),
        `${archivo}: la excepción de la versión ${version} ya no se usa`,
      );
    }
  }
});

test('la guardia reconoce el número escrito a mano, también dentro de JSON.stringify, y admite la constante', () => {
  const texto = [
    "const a = { version: 4, autoridad: 'x', revision: 0, secciones: {} };",
    "const b: string = JSON.stringify({ 'version': 3, autoridad: 'x', revision: 0, secciones: {} });",
    "const c = { version: VERSION_SECCIONES_PUBLICAS, autoridad: 'x', revision: 0, secciones: {} };",
    "const d = { version: 2, api: 'deshabilitada' };",
    'const e = { ...c, version: 2 };',
  ].join('\n');
  assert.deepEqual(versionesEscritas('ejemplo.ts', texto), [
    { archivo: 'ejemplo.ts', linea: 1, version: 4 },
    { archivo: 'ejemplo.ts', linea: 2, version: 3 },
    { archivo: 'ejemplo.ts', linea: 5, version: 2 },
  ]);
  // Fuera de un archivo que construye documentos de secciones, una expansión con su versión es de otro contrato.
  assert.deepEqual(versionesEscritas('otro.ts', 'const f = { ...base, version: 2 };'), []);
});
