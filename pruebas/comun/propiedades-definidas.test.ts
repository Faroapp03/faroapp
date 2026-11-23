// Guardia: toda propiedad personalizada que lee una hoja de la web (var(--nombre)) tiene quien le dé valor. Una
// propiedad sin definir no avisa: la declaración que la usa queda sin efecto y el elemento hereda otro tamaño u otro
// color sin que nada falle. El valor puede darlo una hoja de web/estilos (una declaración «--nombre:» o un @property) o
// un guion: los setProperty de web/scripts y src y la tabla de medidas de web/scripts/informe.js, que convierte los
// atributos data-* de los datos en propiedades.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));

/** Las hojas que se revisan y, en ellas mismas, las primeras fuentes de valores. */
const HOJAS = 'web/estilos';
/** Los guiones que pueden dar valor a una propiedad desde fuera de las hojas. */
const GUIONES = ['web/scripts', 'src'];
/** La tabla de medidas de los datos del informe: cada fila nombra la propiedad que pone. */
const TABLA_DE_MEDIDAS = 'web/scripts/informe.js';

/** Un uso: var( seguido del nombre, con o sin valor de reserva. */
const USO = /\bvar\(\s*(--[\w-]+)/gu;
/** Una definición en una hoja: el nombre al principio de una declaración, seguido de «:». */
const DEFINICION = /(?:^|[{;\s])(--[\w-]+)\s*:/gu;
/** Una propiedad registrada con @property. */
const REGISTRO = /@property\s+(--[\w-]+)/gu;
/** El primer argumento literal de un setProperty. */
const PUESTA = /\bsetProperty\(\s*['"`](--[\w-]+)['"`]/gu;
/** Una fila de la tabla de medidas: { …, propiedad: '--nombre', … }. */
const FILA = /\bpropiedad:\s*['"`](--[\w-]+)['"`]/gu;

/** @returns los archivos de una carpeta y sus subcarpetas con esa extensión, con ruta relativa a la raíz. */
function archivos(carpeta: string, extension: RegExp): string[] {
  return readdirSync(join(RAIZ, carpeta), { recursive: true, withFileTypes: true })
    .filter((entrada) => entrada.isFile() && extension.test(entrada.name))
    .map((entrada) => relative(RAIZ, join(entrada.parentPath, entrada.name)).split('\\').join('/'));
}

/** @returns el primer grupo de cada coincidencia de un patrón en un texto. */
function nombres(texto: string, patron: RegExp): string[] {
  return [...texto.matchAll(patron)].flatMap(([, nombre]) => (nombre === undefined ? [] : [nombre]));
}

/** @returns los nombres que define una hoja, por declaración o por registro. */
function definidasEnHoja(css: string): string[] {
  return [...nombres(css, DEFINICION), ...nombres(css, REGISTRO)];
}

/** @returns los nombres que pone un guion con setProperty o con la tabla de medidas. */
function puestasPorGuion(codigo: string): string[] {
  return [...nombres(codigo, PUESTA), ...nombres(codigo, FILA)];
}

/** @returns cada uso sin valor en un texto, con su línea: «línea N: --nombre». */
function usosSinValor(css: string, conValor: ReadonlySet<string>): string[] {
  return [...css.matchAll(USO)].flatMap((coincidencia) => {
    const nombre = coincidencia[1] ?? '';
    if (conValor.has(nombre)) {
      return [];
    }
    const linea = css.slice(0, coincidencia.index).split('\n').length;
    return [`línea ${linea}: ${nombre}`];
  });
}

test('la guardia distingue usos, definiciones de hoja y valores puestos por un guion', () => {
  const css = ':root{--a:1px}\n.b{--c: 2px; width:var(--a)}\n.d{height:var( --c, 3px );margin:var(--e)}';
  assert.deepEqual(definidasEnHoja(css), ['--a', '--c']);
  assert.deepEqual(definidasEnHoja('@property --f { syntax: "<length>"; inherits: true; initial-value: 0px; }'), [
    '--f',
  ]);
  assert.deepEqual(usosSinValor(css, new Set(definidasEnHoja(css))), ['línea 3: --e']);
  assert.deepEqual(
    puestasPorGuion("el.style.setProperty('--g', '1');\nconst T = [{ atributo: 'data-x', propiedad: '--h' }];"),
    ['--g', '--h'],
  );
  // Un selector o un valor con guiones no define nada.
  assert.deepEqual(definidasEnHoja('.a--b:hover{content:"--x: y"}'), []);
});

test('toda propiedad personalizada que usa una hoja de la web tiene valor en una hoja o en un guion', () => {
  const hojas = archivos(HOJAS, /\.css$/u).map((ruta) => ({ ruta, css: readFileSync(join(RAIZ, ruta), 'utf8') }));
  const guiones = GUIONES.flatMap((carpeta) => archivos(carpeta, /\.(?:js|mjs|ts)$/u));
  assert.ok(guiones.includes(TABLA_DE_MEDIDAS), `${TABLA_DE_MEDIDAS} existe y se revisa`);
  const conValor = new Set([
    ...hojas.flatMap(({ css }) => definidasEnHoja(css)),
    ...guiones.flatMap((ruta) => puestasPorGuion(readFileSync(join(RAIZ, ruta), 'utf8'))),
  ]);
  const sinValor = hojas.flatMap(({ ruta, css }) => usosSinValor(css, conValor).map((uso) => `${ruta}, ${uso}`));
  assert.deepEqual(sinValor, []);
});
