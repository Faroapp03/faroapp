// El contrato entre las dos piezas de la política clásica publicada: la política de caché usa EXTENSIONES sin
// declararla, y la declara, una sola vez, la copia del contrato de secciones que va antes en el mismo guion.
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import {
  declaracionDelRegistro,
  exigirRegistroDeclarado,
  textoPoliticaCache,
} from '../../herramientas/web/politica-cache.ts';

const MOTIVO = /debe declarar const EXTENSIONES una sola vez/;

test('el contrato clásico de secciones debe declarar EXTENSIONES una sola vez y fuera de los comentarios', () => {
  const declaracion = declaracionDelRegistro();
  assert.doesNotThrow(() => exigirRegistroDeclarado(`${declaracion}function seccionDeLaRuta() {}\n`));
  assert.throws(() => exigirRegistroDeclarado('function seccionDeLaRuta() {}\n'), MOTIVO);
  assert.throws(() => exigirRegistroDeclarado('// const EXTENSIONES = [];\nfunction seccionDeLaRuta() {}\n'), MOTIVO);
  assert.throws(() => exigirRegistroDeclarado(`${declaracion}${declaracion}`), MOTIVO);
});

test('la política clásica publicada se evalúa con la EXTENSIONES que declara su pieza de secciones', () => {
  const politica = textoPoliticaCache();
  assert.equal(politica.match(/^const EXTENSIONES = /gm)?.length, 1);
  assert.doesNotThrow(() => runInNewContext(politica, {}));
});

test('la política no se publica si el contrato de secciones de la raíz no deja una sola EXTENSIONES', () => {
  const raiz = mkdtempSync(join(tmpdir(), 'politica sin registro '));
  try {
    for (const fuente of ['src/plataforma/politica-cache-web.ts', 'web/scripts/secciones-publicas.js']) {
      mkdirSync(dirname(join(raiz, fuente)), { recursive: true });
      cpSync(new URL(`../../${fuente}`, import.meta.url), join(raiz, fuente));
    }
    const origen = 'src/administracion/secciones-web.js';
    const importacion = "import { EXTENSIONES } from '../plataforma/extensiones.ts';\n";
    const contrato = readFileSync(new URL(`../../${origen}`, import.meta.url), 'utf8');
    assert.equal(contrato.split(importacion).length, 2);
    mkdirSync(dirname(join(raiz, origen)), { recursive: true });
    writeFileSync(join(raiz, origen), contrato.replace(importacion, `${importacion}const EXTENSIONES = [];\n`));
    assert.throws(() => textoPoliticaCache(pathToFileURL(`${raiz}/`)), MOTIVO);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});
