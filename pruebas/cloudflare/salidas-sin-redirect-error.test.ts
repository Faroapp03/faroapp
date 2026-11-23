/**
 * Guardia: workerd rechaza `redirect: 'error'` al crear la petición, así que ningún código que pueda ejecutarse en un
 * Worker lo usa; las salidas pasan por `pedirSinRedirecciones` (src/comun/salida-sin-redirecciones.ts). Recorre las
 * importaciones desde cada entrada de Worker y, además, todo `src/`, `motores/` y `compartido/` (el motor de cursos
 * se carga con un `import()` no literal que el recorrido no sigue). Solo se admiten las excepciones nominales, que
 * tampoco pueden estar al alcance de un Worker.
 */
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
const CARPETA_WORKERS = join(RAIZ, 'src/plataforma/cloudflare');
/** Lo que se ejecuta solo en el navegador, donde `redirect: 'error'` es válido. */
const EXCEPCIONES: Readonly<Record<string, string>> = {
  'src/catalogo-cursos/carga.ts':
    'Solo la importa src/plataforma/navegador/formacion-acreditada.ts y se publica en web/recursos/catalogo-cursos/lector.js: se ejecuta en el navegador.',
  'src/seleccion-formacion/carga.ts':
    'Solo la importa src/plataforma/navegador/formacion-acreditada.ts y se empaqueta con el motor del navegador: se ejecuta en el navegador.',
};
const REDIRECT_ERROR = /redirect\s*:\s*(?:\/\*[\s\S]*?\*\/\s*)?\(?\s*['"]error['"]/;
const IMPORTACION = /(?:\bfrom|\bimport)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g;
const EXTENSIONES = /\.(?:ts|js|mjs)$/;

function entradasDeWorker(): string[] {
  return readdirSync(CARPETA_WORKERS)
    .filter((nombre) => /^worker(?:-[a-z]+)?\.ts$/.test(nombre))
    .map((nombre) => join(CARPETA_WORKERS, nombre));
}
/** Todo lo que alcanza un Worker por importaciones relativas: lo que puede ejecutarse en workerd. */
function alcanzablesDesdeWorkers(): Set<string> {
  const vistos = new Set<string>();
  const pendientes = entradasDeWorker();
  for (let archivo = pendientes.pop(); archivo !== undefined; archivo = pendientes.pop()) {
    if (vistos.has(archivo) || !EXTENSIONES.test(archivo) || !existsSync(archivo)) {
      continue;
    }
    vistos.add(archivo);
    for (const [, especificador] of readFileSync(archivo, 'utf8').matchAll(IMPORTACION)) {
      pendientes.push(resolve(dirname(archivo), especificador as string));
    }
  }
  return vistos;
}
function archivosDe(carpeta: string): string[] {
  return readdirSync(carpeta, { withFileTypes: true, recursive: true })
    .filter((entrada) => entrada.isFile() && EXTENSIONES.test(entrada.name))
    .map((entrada) => join(entrada.parentPath, entrada.name));
}
const usaRedirectError = (archivo: string) => REDIRECT_ERROR.test(readFileSync(archivo, 'utf8'));

test('la guardia reconoce las formas de escribir redirect «error»', () => {
  for (const texto of ["redirect: 'error'", 'redirect:"error"', "redirect: /** @type {RequestRedirect} */ ('error')"]) {
    assert.ok(REDIRECT_ERROR.test(texto), texto);
  }
  assert.ok(!REDIRECT_ERROR.test("redirect: 'manual'"));
});

test('ningún código al alcance de un Worker usa redirect «error»', () => {
  const alcanzables = alcanzablesDesdeWorkers();
  assert.ok(alcanzables.has(join(RAIZ, 'src/administracion/envio-aviso.ts')), 'el recorrido llega a las salidas');
  const conError = [...alcanzables].filter(usaRedirectError).map((archivo) => relative(RAIZ, archivo));
  assert.deepEqual(conError, []);
  for (const excepcion of Object.keys(EXCEPCIONES)) {
    assert.ok(!alcanzables.has(join(RAIZ, excepcion)), `${excepcion} no puede estar al alcance de un Worker`);
  }
});

test('en src/, motores/ y compartido/, redirect «error» solo aparece en las excepciones nominales', () => {
  const carpetas = ['src', 'motores', 'compartido'];
  const archivos = carpetas.flatMap((carpeta) => archivosDe(join(RAIZ, carpeta)));
  assert.ok(
    archivos.some((archivo) => archivo.includes(`${join(RAIZ, 'motores')}/`)),
    'el barrido llega a motores/',
  );
  const conError = archivos
    .filter(usaRedirectError)
    .map((archivo) => relative(RAIZ, archivo))
    .sort();
  assert.deepEqual(conError, Object.keys(EXCEPCIONES).sort());
});
