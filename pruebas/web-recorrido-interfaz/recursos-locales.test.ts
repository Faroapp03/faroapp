import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { type DefaultTreeAdapterTypes, parse } from 'parse5';
import { CLASES, VALORES_NEUTROS, valoresDelServicio } from '../../herramientas/web/servicio/servicio-publicado.ts';
import { TEXTOS_RECORRIDO as ca } from '../../web/idiomas/ca/recorrido.js';
import { TEXTOS_RECORRIDO as es } from '../../web/idiomas/es/recorrido.js';
import { cuantasPaginasPublicas } from '../ayudas/paginas-de-la-web.ts';
import { webConstruida } from '../ayudas/web-construida.ts';

const WEB = new URL('../../web/', import.meta.url);
/** Las páginas públicas de la web construida llevan todas su mapa de módulos. */
const PAGINAS_CON_MAPA = cuantasPaginasPublicas(WEB);
const DIGITOS_SHA256 = 64;
const CARGADORES_RETIRADOS =
  /(?:^|\/)(?:datos-segun-modo|proveedor-ia|interruptor-modo|motor-local\/modo)\.js(?:[?#]|$)/;

/** Las claves y los valores JSON de un mapa: incluye integrity y los destinos de imports/scopes. */
function cadenasDelMapa(valor: unknown): string[] {
  if (typeof valor === 'string') {
    return [valor];
  }
  if (Array.isArray(valor)) {
    return valor.flatMap(cadenasDelMapa);
  }
  if (valor !== null && typeof valor === 'object') {
    return Object.entries(valor).flatMap(([clave, contenido]) => [clave, ...cadenasDelMapa(contenido)]);
  }
  return [];
}

type Carga = { lugar: string; ruta: string };

function recursosDelElemento(nodo: DefaultTreeAdapterTypes.Element): Carga[] {
  const atributos = new Map(nodo.attrs.map(({ name, value }) => [name, value]));
  const src = atributos.get('src');
  if (nodo.tagName === 'script' && src) {
    return [{ lugar: 'script src', ruta: src }];
  }
  const href = atributos.get('href');
  const precarga = atributos.get('rel')?.toLowerCase().split(/\s+/).includes('modulepreload');
  if (nodo.tagName === 'link' && precarga && href) {
    return [{ lugar: 'modulepreload', ruta: href }];
  }
  if (nodo.tagName === 'script' && atributos.get('type') === 'importmap') {
    const texto = nodo.childNodes.map((hijo) => ('value' in hijo ? hijo.value : '')).join('');
    const mapa: unknown = JSON.parse(texto);
    return cadenasDelMapa(mapa).map((ruta) => ({ lugar: 'importmap', ruta }));
  }
  return [];
}

/** Lee HTML como el navegador: comentarios y texto de otros scripts no inventan etiquetas de carga. */
function recursosDeLaPagina(html: string): Carga[] {
  const recursos: Carga[] = [];
  const pendientes: DefaultTreeAdapterTypes.Node[] = [parse(html)];
  for (let nodo = pendientes.pop(); nodo; nodo = pendientes.pop()) {
    if ('childNodes' in nodo) {
      pendientes.push(...nodo.childNodes);
    }
    if ('content' in nodo) {
      pendientes.push(nodo.content);
    }
    if ('tagName' in nodo) {
      recursos.push(...recursosDelElemento(nodo));
    }
  }
  return recursos;
}

function cargasRetiradas(html: string): { lugar: string; ruta: string }[] {
  return recursosDeLaPagina(html).filter(({ ruta }) => CARGADORES_RETIRADOS.test(ruta));
}

/** Lo del CATALOGO del service worker de `web` que es un cargador retirado, con la clase en que va. */
function listasRetiradas(web: string): { lugar: string; ruta: string }[] {
  return valoresDelServicio(readFileSync(join(web, 'service-worker.js'), 'utf8'))
    .CATALOGO.filter(([ruta]) => CARGADORES_RETIRADOS.test(ruta))
    .map(([ruta, , lugar]) => ({ lugar, ruta }));
}

for (const [lugar, html] of [
  ['script src', '<script src="./scripts/proveedor-ia.js"></script>'],
  ['modulepreload', "<link href='./scripts/proveedor-ia.js' rel='MODULEPRELOAD'>"],
  ['importmap', '<script type="importmap">{"integrity":{"./scripts/proveedor-ia.js":"sha384-sintetica"}}</script>'],
] as const) {
  test(`la guarda detecta proveedor-ia en ${lugar}`, () => {
    assert.deepEqual(cargasRetiradas(html), [{ lugar, ruta: './scripts/proveedor-ia.js' }]);
  });
}

test('la guarda lee destinos de imports/scopes, sin confundir comentarios ni texto de scripts', () => {
  const html =
    '<!-- <link rel="modulepreload" href="./scripts/proveedor-ia.js"> -->' +
    '<script>const ejemplo = "<script src=./scripts/proveedor-ia.js>";</script>' +
    '<script type="importmap">{"imports":{"proveedor":"./scripts/proveedor-ia.js"},' +
    '"scopes":{"./":{"modo":"./scripts/motor-local/modo.js"}}}</script>';
  assert.deepEqual(cargasRetiradas(html), [
    { lugar: 'importmap', ruta: './scripts/proveedor-ia.js' },
    { lugar: 'importmap', ruta: './scripts/motor-local/modo.js' },
  ]);
});

test('la guarda detecta proveedor-ia en cada clase del CATALOGO del service worker', (t) => {
  const carpeta = mkdtempSync(join(tmpdir(), 'faro-recursos-locales-'));
  t.after(() => rmSync(carpeta, { recursive: true, force: true }));
  const huella = '0'.repeat(DIGITOS_SHA256);
  const valores = {
    ...VALORES_NEUTROS,
    CATALOGO: CLASES.map((clase) => [`${clase}/proveedor-ia.js`, huella, clase]),
  };
  writeFileSync(
    join(carpeta, 'service-worker.js'),
    Object.entries(valores)
      .map(([nombre, valor]) => `var ${nombre} = ${JSON.stringify(valor)};\n`)
      .join(''),
  );
  assert.deepEqual(
    listasRetiradas(carpeta),
    CLASES.map((lugar) => ({ lugar, ruta: `${lugar}/proveedor-ia.js` })),
  );
});

test('las páginas y la copia sin conexión no cargan el circuito externo retirado', () => {
  const problemas: { pagina: string; lugar: string; ruta: string }[] = [];
  const construida = webConstruida();
  const paginas = (carpeta: string) =>
    readdirSync(carpeta, { recursive: true, encoding: 'utf8' }).filter((nombre) => nombre.endsWith('.html'));
  for (const nombre of paginas(fileURLToPath(WEB))) {
    const html = readFileSync(new URL(nombre, WEB), 'utf8');
    assert.doesNotMatch(html, /\bdata-interruptor-modo(?:\s|=|>)/, nombre);
    problemas.push(...cargasRetiradas(html).map((carga) => ({ pagina: nombre, ...carga })));
  }
  const construidas = paginas(construida).map((nombre) => [nombre, readFileSync(join(construida, nombre), 'utf8')]);
  const conMapa = construidas.filter(([, html]) => html?.includes('<script type="importmap">'));
  assert.equal(conMapa.length, PAGINAS_CON_MAPA, 'las páginas públicas construidas llevan su mapa de módulos');
  for (const [nombre, html] of construidas) {
    problemas.push(...cargasRetiradas(html ?? '').map((carga) => ({ pagina: `construida/${nombre}`, ...carga })));
  }
  problemas.push(...listasRetiradas(webConstruida()).map((carga) => ({ pagina: 'service-worker', ...carga })));
  assert.deepEqual(problemas, []);
});

test('el aviso inicial del recorrido coincide con castellano y no depende de un modo o de JavaScript', () => {
  const html = readFileSync(new URL('recorrido.html', WEB), 'utf8');
  const parrafo = html.match(/<p\b[^>]*data-texto="recorrido\.privacidad\.local"[^>]*>([\s\S]*?)<\/p\s*>/);
  assert.ok(parrafo);
  assert.doesNotMatch(parrafo[0], /\bhidden\b|data-modos|data-proveedor-ia/);
  assert.equal(parrafo[1]?.replace(/\s+/g, ' ').trim(), es['recorrido.privacidad.local']);
  assert.doesNotMatch(
    html,
    /data-texto="recorrido\.privacidad\.ia-(?:on|off)"|id="rc-comprobacion"|id="rc-sin-conexion"/,
  );
  for (const diccionario of [es, ca]) {
    assert.ok(diccionario['recorrido.privacidad.local']);
    assert.equal(diccionario['recorrido.privacidad.ia-on'], undefined);
    assert.equal(diccionario['recorrido.privacidad.ia-off'], undefined);
  }
});
