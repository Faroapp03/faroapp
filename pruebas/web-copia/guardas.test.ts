import assert from 'node:assert/strict';
import { test } from 'node:test';
import { copiaAislada, entradaDePrueba } from './aislada.ts';

const CIFRAS_SHA256 = 64;
function comprobar(archivos: Record<string, string>): string[] {
  return JSON.parse(
    copiaAislada(
      archivos,
      `
import { comprobarServiceWorker } from './copia-sin-conexion.ts';
import { contexto, HUELLA } from './contexto-de-prueba.ts';
const publicados = ${JSON.stringify(Object.keys(archivos))};
process.stdout.write(JSON.stringify(await comprobarServiceWorker(publicados, HUELLA, contexto())));
`,
    ),
  );
}

test('rutas operativas en cualquiera de las clases del catálogo se rechazan antes de compilar', () => {
  for (const clase of ['instalar', 'adorno', 'demanda', 'comprobado']) {
    const archivos = entradaDePrueba();
    const ruta = 'activar-acceso.html';
    const valor = [[ruta, 'a'.repeat(CIFRAS_SHA256), clase]];
    archivos['service-worker.js'] =
      archivos['service-worker.js']?.replace(
        /^var CATALOGO = .*;$/m,
        () => `var CATALOGO = ${JSON.stringify(valor)};`,
      ) ?? '';
    assert.match(comprobar(archivos).join('\n'), /activar-acceso.html.*operativa y no admite caché/);
  }
});

test('una clase escrita a mano en el CATALOGO (inicio.html como adorno) no pasa', () => {
  const archivos = entradaDePrueba();
  const huella = 'a'.repeat(CIFRAS_SHA256);
  for (const [clase, pasa] of [
    ['adorno', false],
    ['instalar', true],
  ] as const) {
    const sw =
      archivos['service-worker.js']?.replace(
        /^var CATALOGO = \[(.*)\];$/m,
        (_, entradas) => `var CATALOGO = [${entradas}, ["inicio.html", "${huella}", "${clase}"]];`,
      ) ?? '';
    const problemas = comprobar({ ...archivos, 'service-worker.js': sw }).join('\n');
    assert.equal(/no lleva la clase o el orden que dan sus listas/.test(problemas), !pasa, `${clase}: ${problemas}`);
  }
});

test('una selección pública incompleta se denuncia sin reclamar los recursos de acceso excluidos', () => {
  const archivos = {
    ...entradaDePrueba(),
    'scripts/falta.js': '',
    'activar-acceso.html': '',
    'scripts/activar-acceso.js': '',
  };
  const problemas = comprobar(archivos);
  assert.ok(problemas.some((problema) => problema.includes('scripts/falta.js')));
  assert.ok(problemas.every((problema) => !problema.includes('activar-acceso')));
});

test('falta el service worker, un catálogo con una ruta repetida o una foto sin reducida se denuncian', () => {
  const archivos = entradaDePrueba();
  delete archivos['service-worker.js'];
  const salida = copiaAislada(
    archivos,
    `
import { comprobarServiceWorker } from './copia-sin-conexion.ts';
import { contexto, HUELLA } from './contexto-de-prueba.ts';
const publicados = ${JSON.stringify(Object.keys(archivos))};
process.stdout.write(JSON.stringify(await comprobarServiceWorker(publicados, HUELLA, contexto())));
`,
  );
  assert.match(salida, /falta el service worker publicado/);
  const repetido = entradaDePrueba();
  repetido['service-worker.js'] =
    repetido['service-worker.js']?.replace(
      /^var CATALOGO = \[(.*)\];$/m,
      (_, entradas) => `var CATALOGO = [${entradas}, ${entradas}];`,
    ) ?? '';
  assert.match(comprobar(repetido).join('\n'), /CATALOGO no tiene la forma/);
  assert.match(comprobar({ ...entradaDePrueba(), 'imagenes/fotografias/casa.webp': '' }).join('\n'), /casa-800.webp/);
});
