// Guardia: nada se mueve en bucle. Las hojas de la web y el CSS que los Workers escriben dentro de sus páginas solo
// declaran animaciones de una sola pasada; un movimiento que se repite marea a quien lo mira. La regla es exacta: falla
// una animación declarada como «infinite» o con un número de repeticiones distinto de 1, no una animación cualquiera.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));

/** Las hojas de la web, en todas sus subcarpetas, y las páginas que escriben los Workers con su CSS incrustado. */
const ORIGENES: readonly (readonly [carpeta: string, extension: RegExp, recursivo: boolean])[] = [
  ['web/estilos', /\.css$/u, true],
  ['src/plataforma/cloudflare', /\.ts$/u, false],
];

/** Una declaración de animación: la propiedad corta o el número de repeticiones, con su valor hasta «;», «}» o «`». */
const DECLARACION = /\banimation(-iteration-count)?\s*:\s*([^;}`]*)/gu;

/** Un número sin unidad: dentro de la propiedad corta, solo puede ser el de repeticiones. */
const NUMERO = /^(?:\d+\.?\d*|\.\d+)$/u;

/** @returns los archivos de un origen, con ruta relativa a la raíz. */
function archivos(carpeta: string, extension: RegExp, recursivo: boolean): string[] {
  return readdirSync(join(RAIZ, carpeta), { recursive: recursivo, withFileTypes: true })
    .filter((entrada) => entrada.isFile() && extension.test(entrada.name))
    .map((entrada) => relative(RAIZ, join(entrada.parentPath, entrada.name)).split('\\').join('/'));
}

/**
 * Las repeticiones que declara un valor. En la propiedad corta se quitan las funciones, como cubic-bezier() o steps(),
 * cuyos números no son repeticiones; cada animación de una lista separada por comas aporta las suyas.
 * @returns los valores de repetición escritos, como «infinite» o «3».
 */
function repeticiones(valor: string, esLaPropiedadCorta: boolean): string[] {
  const palabras = valor
    .replace(/\([^)]*\)/gu, '')
    .split(/[\s,]+/u)
    .filter((palabra) => palabra !== '');
  return esLaPropiedadCorta ? palabras.filter((palabra) => palabra === 'infinite' || NUMERO.test(palabra)) : palabras;
}

/** @returns cada bucle declarado en un texto, con su línea. */
function buclesDe(texto: string): string[] {
  const bucles: string[] = [];
  for (const coincidencia of texto.matchAll(DECLARACION)) {
    const [declaracion, numeroDeRepeticiones, valor = ''] = coincidencia;
    const repetidas = repeticiones(valor, numeroDeRepeticiones === undefined).filter((veces) => veces !== '1');
    if (repetidas.length > 0) {
      const linea = texto.slice(0, coincidencia.index).split('\n').length;
      bucles.push(`línea ${linea}: ${declaracion.trim()}`);
    }
  }
  return bucles;
}

test('la guardia reconoce un bucle en cualquiera de sus formas y deja pasar las animaciones de una vez', () => {
  assert.deepEqual(buclesDe('a{animation:x 1s ease-in-out infinite alternate}'), [
    'línea 1: animation:x 1s ease-in-out infinite alternate',
  ]);
  assert.deepEqual(buclesDe('a{animation: x 1s 3 both;}'), ['línea 1: animation: x 1s 3 both']);
  assert.deepEqual(buclesDe('a{\n  animation-iteration-count: 2;\n}'), ['línea 2: animation-iteration-count: 2']);
  assert.deepEqual(buclesDe('a{animation:y 1s,x 2s infinite}'), ['línea 1: animation:y 1s,x 2s infinite']);
  assert.deepEqual(
    buclesDe(
      'a{animation:x .35s cubic-bezier(0.2, 0, 0, 1) 0.1s 1 both}b{animation:none}c{animation-iteration-count:1}' +
        'd{animation:x 4s steps(4) both}',
    ),
    [],
  );
});

test('ninguna hoja de la web ni ningún CSS de los Workers declara una animación en bucle', () => {
  const hallados = ORIGENES.flatMap(([carpeta, extension, recursivo]) =>
    archivos(carpeta, extension, recursivo).flatMap((ruta) =>
      buclesDe(readFileSync(join(RAIZ, ruta), 'utf8')).map((bucle) => `${ruta}, ${bucle}`),
    ),
  );
  assert.deepEqual(hallados, []);
});

test('la guardia recorre las hojas de las subcarpetas y las páginas de los Workers', () => {
  const recorridos = ORIGENES.flatMap(([carpeta, extension, recursivo]) => archivos(carpeta, extension, recursivo));
  assert.ok(recorridos.includes('web/estilos/catalogo-cursos.css'));
  assert.ok(recorridos.includes('web/estilos/recorrido/conversacion.css'));
  assert.ok(recorridos.includes('src/plataforma/cloudflare/portada-publica.ts'));
});
