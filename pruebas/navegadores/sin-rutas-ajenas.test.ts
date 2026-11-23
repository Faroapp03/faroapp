// Los guiones de pruebas, herramientas, scripts, flujos de GitHub y la plataforma de datos solo escriben y leen dentro
// del producto o del temporal del sistema: ninguno nombra carpetas de la máquina de quien lo desarrolla ni sube por
// encima de la raíz del repositorio.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
const CARPETAS = ['pruebas', 'herramientas', 'scripts', '.github', 'plataforma_datos'];
/** Por debajo de esta cifra la búsqueda no está recorriendo el producto. */
const MINIMO_DE_GUIONES = 100;
/** Desde `pruebas/navegadores/`, la carpeta de los ejemplos, tres niveles hacia arriba salen de la raíz. */
const NIVELES_FUERA = 3;
const GUION = /\.(?:[cm]?[jt]s|py|sh|ya?ml)$/u;
const RUTAS_DE_MAQUINA = [/\/Users\//gu, /\/Volumes\//gu, /Desarrollo\//gu, /·\sDesarrollo\b/gu];
/** Carpetas de máquina compuestas al ejecutarse, para que las excepciones no se señalen a sí mismas. */
const USUARIOS = `/${'Users'}/`;
const VOLUMENES = `/${'Volumes'}/`;
/**
 * Líneas exactas de pruebas de `plataforma_datos/` que llevan a propósito una ruta de máquina sintética de otra persona:
 * comprueban que el informe de diagnósticos la borra (URL de archivo y ruta con espacios) y que el panel del catálogo
 * rechaza una URL de archivo. Se exceptúa la línea, no el archivo: otra ruta en él se sigue señalando.
 */
const EXCEPCIONES: ReadonlyMap<string, readonly string[]> = new Map([
  [
    'plataforma_datos/orquestacion/pruebas/test_informe_diagnosticos.py',
    [
      `"file://${USUARIOS}otra-persona/Documents/Proyecto/datos.json",`,
      `"${USUARIOS}otra-persona/Mis documentos/Año 2026/componer.py:12: fallo",`,
    ],
  ],
  ['plataforma_datos/cursos/pruebas/test_panel_catalogo.py', [`panel._url("file://${VOLUMENES}privado")`]],
]);
/**
 * Rutas relativas que se resuelven desde el propio archivo: `new URL(…, import.meta.url)`, `import('…')` y las
 * declaraciones `import`/`export … from` que abren línea. El código que un guion escribe para otro archivo va dentro de
 * una cadena y no abre línea, así que no se resuelve desde aquí.
 */
const RELATIVAS_AL_ARCHIVO = [
  /new URL\(\s*(['"`])(\.\.?\/[^'"`]*)\1\s*,\s*import\.meta\.url\s*\)/gu,
  /\bimport\(\s*(['"])(\.\.?\/[^'"]*)\1\s*\)/gu,
  /^[ \t]*(?:import|export)\b[^'"\n]*?\bfrom\s+(['"])(\.\.?\/[^'"]*)\1/gmu,
  /^[ \t]*\}[ \t]*from\s+(['"])(\.\.?\/[^'"]*)\1/gmu,
  /^[ \t]*import\s+(['"])(\.\.?\/[^'"]*)\1/gmu,
];

function guiones(carpeta: string): string[] {
  return readdirSync(join(RAIZ, carpeta), { recursive: true, withFileTypes: true })
    .filter((entrada) => entrada.isFile() && GUION.test(entrada.name) && !entrada.parentPath.includes('node_modules'))
    .map((entrada) => relative(RAIZ, join(entrada.parentPath, entrada.name)));
}

/** El número de línea, desde 1, del carácter en `indice`. */
function lineaDe(texto: string, indice: number): number {
  return texto.slice(0, indice).split('\n').length;
}

/** Las rutas de máquina fuera de las líneas exceptuadas del archivo, como `archivo:línea: fragmento`. */
function rutasDeMaquina(ruta: string, texto: string): string[] {
  const lineas = texto.split('\n');
  const exceptuadas = EXCEPCIONES.get(ruta) ?? [];
  return RUTAS_DE_MAQUINA.flatMap((patron) =>
    [...texto.matchAll(patron)]
      .map((encontrado) => ({ numero: lineaDe(texto, encontrado.index), fragmento: encontrado[0] }))
      .filter(({ numero }) => !exceptuadas.includes((lineas[numero - 1] ?? '').trim()))
      .map(({ numero, fragmento }) => `${ruta}:${numero}: ${fragmento}`),
  );
}

/** Las rutas de máquina y las relativas que salen de la raíz, como `archivo:línea: fragmento`. */
function rutasAjenas(ruta: string, texto: string): string[] {
  const hallazgos = rutasDeMaquina(ruta, texto);
  const linea = (indice: number) => lineaDe(texto, indice);
  for (const patron of RELATIVAS_AL_ARCHIVO) {
    for (const encontrado of texto.matchAll(patron)) {
      const fija = (encontrado[2] ?? '').split('${')[0] ?? '';
      const destino = resolve(dirname(join(RAIZ, ruta)), fija);
      if (destino !== resolve(RAIZ) && !destino.startsWith(resolve(RAIZ) + sep)) {
        hallazgos.push(`${ruta}:${linea(encontrado.index)}: ${encontrado[2]}`);
      }
    }
  }
  return hallazgos;
}

test('ningún guion nombra carpetas de la máquina ni sale de la raíz del repositorio', () => {
  const archivos = CARPETAS.flatMap(guiones);
  assert.ok(archivos.length > MINIMO_DE_GUIONES, 'la búsqueda recorre los guiones del producto');
  for (const recorrido of ['.github/workflows/calidad.yml', 'plataforma_datos/cursos/pruebas/test_panel_catalogo.py']) {
    assert.ok(archivos.includes(recorrido), recorrido);
  }
  assert.deepEqual(
    archivos.flatMap((ruta) => rutasAjenas(ruta, readFileSync(join(RAIZ, ruta), 'utf8'))),
    [],
  );
});

test('la guardia reconoce rutas de máquina y relativas que suben por encima de la raíz', () => {
  // Los ejemplos se componen en tiempo de ejecución para que la guardia no se señale a sí misma.
  const ruta = 'pruebas/navegadores/ensayo.mjs';
  const subir = '../'.repeat(NIVELES_FUERA);
  assert.deepEqual(rutasAjenas(ruta, `const salida = new URL('${subir}otra/carpeta/', import.meta.url);`), [
    `${ruta}:1: ${subir}otra/carpeta/`,
  ]);
  assert.deepEqual(rutasAjenas(ruta, `\nimport { x } from '${subir}fuera.ts';`), [`${ruta}:2: ${subir}fuera.ts`]);
  assert.deepEqual(rutasAjenas(ruta, `const m = await import('${subir}fuera.mjs');`), [`${ruta}:1: ${subir}fuera.mjs`]);
  assert.deepEqual(rutasAjenas(ruta, `import {\n  x,\n} from '${subir}fuera.ts';`), [`${ruta}:3: ${subir}fuera.ts`]);
  assert.deepEqual(rutasAjenas(ruta, `import '${subir}fuera.css';`), [`${ruta}:1: ${subir}fuera.css`]);
  assert.deepEqual(rutasAjenas(ruta, `escribir('otro/a/b.ts', "import type { X } from '${subir}x.ts';");`), []);
  for (const carpeta of ['Users', 'Volumes']) {
    assert.equal(rutasAjenas(ruta, `const a = '/${carpeta}/alguien/salida';`).length, 1, carpeta);
  }
  assert.equal(rutasAjenas(ruta, `const a = '2 \u00b7 ${'Desarrollo'}';`).length, 1);
  assert.equal(rutasAjenas(ruta, `const a = '${'Desarrollo'}/organizacion';`).length, 1);
  assert.deepEqual(
    rutasAjenas(ruta, "import { y } from '../../src/y.ts';\nconst d = new URL('../../datos/', import.meta.url);"),
    [],
  );
  assert.deepEqual(rutasAjenas(ruta, "const area = 'Desarrollo profesional';"), []);
});

test('cada excepción sigue en su archivo y cubre solo su línea exacta', () => {
  for (const [archivo, lineas] of EXCEPCIONES) {
    const presentes = readFileSync(join(RAIZ, archivo), 'utf8')
      .split('\n')
      .map((l) => l.trim());
    for (const exceptuada of lineas) {
      assert.equal(presentes.filter((l) => l === exceptuada).length, 1, `${archivo}: ${exceptuada}`);
      assert.deepEqual(rutasAjenas(archivo, `    ${exceptuada}`), []);
      assert.equal(rutasAjenas(archivo, `${exceptuada} # ${VOLUMENES}otra`).length, 2, exceptuada);
      assert.equal(rutasAjenas('pruebas/otra.py', exceptuada).length, 1, exceptuada);
    }
  }
});
