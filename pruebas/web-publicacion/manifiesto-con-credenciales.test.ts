import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// El manifiesto está tras la puerta de cada entrega (cookie del portal o HTTP Basic) y el navegador lo pide sin
// credenciales salvo que su enlace lleve crossorigin="use-credentials" (HTML, «link type manifest»). Toda página que lo
// enlace lo lleva; los guiones que cambian de idioma solo reapuntan el href del mismo enlace y no crean otro.

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
/** Las carpetas con páginas o guiones propios; los paquetes y motores generados no enlazan el manifiesto. */
const CARPETAS = ['web', 'src'];
const EXCLUIDAS = new Set(['node_modules', 'paquete', 'motor', 'firmas']);
/** Un enlace cuyo rel incluye «manifest» como una de sus palabras, entre comillas o sin ellas. */
const ENLACE =
  /<link\b[^>]*\brel\s*=\s*(?:"(?:[^"]*\s)?manifest(?:\s[^"]*)?"|'(?:[^']*\s)?manifest(?:\s[^']*)?'|manifest(?=[\s/>]))[^>]*>/giu;
const CON_CREDENCIALES = /\scrossorigin\s*=\s*["']use-credentials["']/iu;
/** Un guion que crea su propio enlace al manifiesto, en vez de reapuntar el de la página. */
const ENLACE_CREADO = new RegExp(
  [
    String.raw`\.rel\s*=\s*["'\x60](?:[^"'\x60]*\s)?manifest(?:\s[^"'\x60]*)?["'\x60]`,
    String.raw`setAttribute\(\s*["']rel["']\s*,\s*["'\x60](?:[^"'\x60]*\s)?manifest(?:\s[^"'\x60]*)?["'\x60]`,
    String.raw`relList\.(?:add|toggle|replace)\([^)]*["'\x60]manifest["'\x60]`,
  ].join('|'),
  'iu',
);
/** Las páginas públicas que enlazan el manifiesto: si faltara alguna, la guardia no estaría mirando donde debe. */
const MINIMO_DE_PAGINAS = 20;

function archivos(carpeta: string): string[] {
  return readdirSync(carpeta, { withFileTypes: true }).flatMap((entrada) => {
    if (EXCLUIDAS.has(entrada.name)) {
      return [];
    }
    const ruta = join(carpeta, entrada.name);
    return entrada.isDirectory() ? archivos(ruta) : [ruta];
  });
}

const fuentes = CARPETAS.flatMap((carpeta) => archivos(join(RAIZ, carpeta))).filter((ruta) =>
  /\.(?:html|[cm]?[jt]s)$/u.test(ruta),
);

test('toda página que enlaza el manifiesto lo pide con credenciales', () => {
  const conEnlace: string[] = [];
  const sinCredenciales: string[] = [];
  for (const ruta of fuentes) {
    for (const enlace of readFileSync(ruta, 'utf8').match(ENLACE) ?? []) {
      conEnlace.push(relative(RAIZ, ruta));
      if (!CON_CREDENCIALES.test(enlace)) {
        sinCredenciales.push(`${relative(RAIZ, ruta)}: ${enlace}`);
      }
    }
  }
  assert.deepEqual(sinCredenciales, []);
  assert.ok(conEnlace.length >= MINIMO_DE_PAGINAS, String(conEnlace.length));
  for (const pagina of ['web/inicio.html', 'web/administracion/index.html']) {
    assert.ok(conEnlace.includes(pagina), pagina);
  }
});

test('ningún guion crea un enlace al manifiesto que no lleve el atributo de la página', () => {
  const creados = fuentes
    .filter((ruta) => ENLACE_CREADO.test(readFileSync(ruta, 'utf8')))
    .map((ruta) => relative(RAIZ, ruta));
  assert.deepEqual(creados, []);
});

test('la guardia reconoce un enlace sin el atributo y uno con otro valor', () => {
  for (const enlace of [
    '<link rel="manifest" href="manifest.webmanifest" />',
    '<link rel=manifest href="manifest.webmanifest">',
    '<link href="manifest-ca.webmanifest" rel="manifest" crossorigin="anonymous" />',
    '<link rel="manifest" href="manifest.webmanifest" crossorigin />',
    '<link rel="icon manifest" href="manifest.webmanifest" />',
    "<link rel='manifest preload' href='manifest-ca.webmanifest'>",
    '<link\n  href="manifest.webmanifest"\n  rel="MANIFEST"\n/>',
  ]) {
    const encontrados = enlace.match(ENLACE) ?? [];
    assert.equal(encontrados.length, 1, enlace);
    assert.equal(CON_CREDENCIALES.test(encontrados[0] ?? ''), false, enlace);
  }
  assert.equal(
    CON_CREDENCIALES.test('<link rel="manifest" href="manifest.webmanifest" crossorigin="use-credentials" />'),
    true,
  );
  for (const otro of ['<link rel="manifest-ca" href="x" />', '<link rel="stylesheet" href="manifest.css" />']) {
    assert.deepEqual(otro.match(ENLACE) ?? [], [], otro);
  }
});

test('la guardia reconoce los guiones que crean su propio enlace al manifiesto', () => {
  for (const guion of [
    "enlace.rel = 'manifest';",
    'enlace.rel = "icon manifest";',
    'enlace.rel = `manifest`;',
    "enlace.setAttribute('rel', 'manifest');",
    "enlace.relList.add('manifest');",
    "enlace.relList.toggle('manifest', true);",
  ]) {
    assert.equal(ENLACE_CREADO.test(guion), true, guion);
  }
  for (const guion of [
    "document.querySelector('link[rel=manifest]')?.setAttribute('href', destino);",
    'document.querySelector(\'link[rel="manifest"]\');',
    "enlace.rel = 'modulepreload';",
    "enlace.relList.add('manifestacion');",
  ]) {
    assert.equal(ENLACE_CREADO.test(guion), false, guion);
  }
});
