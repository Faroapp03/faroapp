import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import { textoPoliticaCache } from '../../herramientas/web/politica-cache.ts';
import { moduloDeLaPolitica } from '../../herramientas/web/servicio/politica-del-servicio.ts';
import { servicioConValores, valoresDelServicio } from '../../herramientas/web/servicio/servicio-publicado.ts';
import { rutaFueraDeLaCopia } from '../../src/plataforma/politica-cache-web.ts';
import { servicioPublicado } from '../ayudas/web-construida.ts';

test('política clásica es idéntica a fuente TS para rutas públicas y operativas', () => {
  const clasica: (ruta: string) => boolean = runInNewContext(`${textoPoliticaCache()}\nrutaFueraDeLaCopia;`);
  for (const ruta of [
    'inicio.html',
    'sin-conexion.html',
    'secciones.json',
    'secciones-v3.json',
    'openapi.json',
    'llms.txt',
    'api',
    '%61pi/salud',
    'mcp',
    'oauth/token',
    'activar-acceso.html',
    'administracion/panel',
    'scripts/activar-acceso.js',
    '.well-known/security.txt',
    'imagenes/activar-acceso.png',
    'apilar.html',
    'api-publica.html',
    '%E0%A4',
    '../inicio.html',
  ]) {
    assert.equal(clasica(ruta), rutaFueraDeLaCopia(ruta), ruta);
  }
  assert.ok(moduloDeLaPolitica().startsWith(textoPoliticaCache()), 'el service worker recibe la política de su fuente');
});

test('una política publicada alterada no se acepta por conservar la firma de función', async () => {
  const publicado = servicioPublicado();
  const reconstruido = await servicioConValores(valoresDelServicio(publicado));
  assert.equal(publicado, reconstruido, 'el service worker publicado es el que da la política de su fuente');
  const alterado = publicado.replace(
    'function rutaFueraDeLaCopia(ruta) {',
    'function rutaFueraDeLaCopia(ruta) {\n  return false;',
  );
  assert.notEqual(alterado, publicado);
  assert.notEqual(alterado, reconstruido);
});

test('el generador cerrado rechaza otro export o import sin ejecutar la fuente', () => {
  const raiz = mkdtempSync(join(tmpdir(), 'c28c-fuente-'));
  const fuente = readFileSync(new URL('../../src/plataforma/politica-cache-web.ts', import.meta.url), 'utf8');
  try {
    mkdirSync(join(raiz, 'src/plataforma'), { recursive: true });
    for (const extra of ["\nimport './ajeno.js';", '\nexport const ajeno = true;']) {
      writeFileSync(join(raiz, 'src/plataforma/politica-cache-web.ts'), fuente + extra);
      assert.throws(() => textoPoliticaCache(pathToFileURL(`${raiz}/`)), /no admite imports ni otras exportaciones/);
    }
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});
