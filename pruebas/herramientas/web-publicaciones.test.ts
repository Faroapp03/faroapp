// Las utilidades publicadas deben conservar exactamente la fuente comprobada, incluidos sus contratos JSDoc.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import {
  artefactosComunes,
  cabeceraDeCopia,
  PUBLICACIONES_COMUNES,
  PUBLICACIONES_DE_EXTENSIONES,
  textoVariantesDisponibles,
} from '../../herramientas/web/comunes.ts';
import { EXTENSIONES } from '../../src/plataforma/extensiones.ts';

const SIN_EXTENSIONES = EXTENSIONES.length === 0 && 'Sin extensiones instaladas no hay textos que cargar.';

test('las utilidades web corresponden exactamente a sus fuentes TypeScript', () => {
  for (const [archivo, contenido] of artefactosComunes()) {
    assert.equal(readFileSync(archivo, 'utf8'), contenido, archivo.pathname);
  }
});

test('toda copia declarada empieza nombrando su fuente, con comentario de CSS o de JavaScript', () => {
  assert.equal(cabeceraDeCopia('web/estilos/a.css'), '/* Generado desde web/estilos/a.css; no editar esta copia. */\n');
  assert.equal(cabeceraDeCopia('src/comun/a.ts'), '// Generado desde src/comun/a.ts; no editar esta copia.\n');
  const publicados = artefactosComunes();
  const declaradas = [...Object.entries(PUBLICACIONES_COMUNES), ...PUBLICACIONES_DE_EXTENSIONES];
  assert.equal(publicados.size, declaradas.length);
  for (const [origen, destino] of declaradas) {
    const destinoUrl = new URL(`../../${destino}`, import.meta.url);
    const contenido = [...publicados].find(([url]) => url.href === destinoUrl.href)?.[1];
    assert.ok(contenido?.startsWith(cabeceraDeCopia(origen)), destino);
  }
});

test('importar las publicaciones no carga los textos de las extensiones: solo los lee el módulo de variantes', {
  skip: SIN_EXTENSIONES,
}, () => {
  // Proceso aislado que cuenta las cargas de <carpeta>/idiomas/<idioma>/recorrido.js antes y después de generar.
  const codigo = `
import { registerHooks } from 'node:module';
let cargados = 0;
registerHooks({
  load(url, contexto, siguiente) {
    if (/\\/idiomas\\/(?:es|ca)\\/recorrido\\.js$/.test(url)) cargados += 1;
    return siguiente(url, contexto);
  },
});
const comunes = await import(${JSON.stringify(new URL('../../herramientas/web/comunes.ts', import.meta.url).href)});
const alImportar = cargados;
await comunes.textoVariantesDisponibles();
console.log(JSON.stringify({ alImportar, alGenerar: cargados }));
`;
  const resultado = spawnSync(process.execPath, ['--input-type=module', '-e', codigo], { encoding: 'utf8' });
  assert.equal(resultado.status, 0, resultado.stderr);
  assert.deepEqual(JSON.parse(resultado.stdout), { alImportar: 0, alGenerar: 2 * EXTENSIONES.length });
});

test('sin el archivo de textos de una extensión, el módulo de variantes lo dice con su ruta', {
  skip: SIN_EXTENSIONES,
}, async () => {
  const [extension] = EXTENSIONES;
  assert.ok(extension);
  const raiz = mkdtempSync(join(realpathSync(tmpdir()), 'faro-textos-'));
  try {
    const ruta = `web/${posix.dirname(extension.entrada)}/idiomas/es/recorrido.js`;
    await assert.rejects(textoVariantesDisponibles(pathToFileURL(`${raiz}/`)), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, `Faltan los textos de la extensión ${extension.id} en es: ${ruta}`);
      assert.equal((error.cause as { code?: unknown } | undefined)?.code, 'ERR_MODULE_NOT_FOUND');
      return true;
    });
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});
