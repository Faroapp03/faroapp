import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const INICIAL = readFileSync(new URL('../../web/scripts/idioma-inicial.js', import.meta.url), 'utf8');
const VERSION = readFileSync(new URL('../../web/scripts/version.js', import.meta.url), 'utf8');
function inicial(idiomas: string[], guardado: string | null = null, bloqueado = false, mapa = '') {
  const dataset: Record<string, string> = {};
  const precargas: { rel?: string; href?: string; integrity?: string }[] = [];
  let manifiesto = '';
  let retirar = () => {};
  let plazo = 0;
  const document = {
    documentElement: { dataset },
    baseURI: 'https://faro.invalid/inicio.html',
    currentScript: { getAttribute: () => 'scripts/idioma-inicial.js' },
    createElement: () => ({}),
    head: { append: (enlace: object) => precargas.push(enlace) },
    querySelector: (selector: string) =>
      selector === 'link[rel=manifest]'
        ? {
            setAttribute: (_nombre: string, valor: string) => {
              manifiesto = valor;
            },
          }
        : { textContent: mapa },
  };
  const localStorage = {
    getItem: () => {
      if (bloqueado) {
        throw new Error('Bloqueado');
      }
      return guardado;
    },
  };
  runInNewContext(INICIAL, {
    document,
    URL,
    URLSearchParams,
    location: { href: 'https://faro.invalid/inicio.html', search: '' },
    history: { state: null, replaceState: () => assert.fail('sin ?idioma no se toca la dirección') },
    localStorage,
    navigator: { languages: idiomas },
    setTimeout: (funcion: () => void, ms: number) => {
      retirar = funcion;
      plazo = ms;
    },
  });
  return { dataset, precargas, manifiesto, retirar: () => retirar(), plazo };
}

test('el idioma inicial respeta navegador, preferencia válida y almacenamiento bloqueado', () => {
  for (const idioma of ['ca', 'ca-ES', 'ca-ES-valencia', 'CA']) {
    assert.equal(inicial([idioma]).dataset.idioma, 'ca');
  }
  for (const idiomas of [[], ['es', 'ca'], ['es-ES'], ['en'], ['en', 'ca'], ['cak'], ['est']]) {
    assert.equal(inicial(idiomas).dataset.idioma, 'es');
  }
  assert.equal(inicial(['ca'], 'es').dataset.idioma, 'es');
  assert.equal(inicial(['es'], 'ca').dataset.idioma, 'ca');
  assert.equal(inicial(['ca'], 'fr').dataset.idioma, 'ca');
  assert.equal(inicial(['ca'], 'es', true).dataset.idioma, 'ca');
});

test('precarga solo el idioma elegido, con huella disponible y ocultación temporal en CA', () => {
  const mapa = JSON.stringify({ integrity: { './idiomas/ca.js': 'sha384-ejemplo' } });
  const resultado = inicial(['ca'], null, false, mapa);
  assert.deepEqual(resultado.precargas, [
    { rel: 'modulepreload', href: 'https://faro.invalid/idiomas/ca.js', integrity: 'sha384-ejemplo' },
  ]);
  assert.equal(resultado.manifiesto, 'https://faro.invalid/manifest-ca.webmanifest');
  assert.ok('traduciendo' in resultado.dataset);
  const ESPERA_MAXIMA_MS = 1500;
  assert.equal(resultado.plazo, ESPERA_MAXIMA_MS);
  resultado.retirar();
  assert.equal(resultado.dataset.traduciendo, undefined);
  const castellano = inicial(['es']);
  assert.equal(castellano.manifiesto, 'https://faro.invalid/manifest.webmanifest');
  assert.equal(castellano.dataset.traduciendo, undefined);
  assert.equal(inicial(['ca'], null, false, '{').precargas.length, 0);
});

test('la versión cambia solo al sustituirse o perderse un controlador que existía al abrir', () => {
  const inicial = {};
  const serviceWorker: { controller: object | null } = { controller: inicial };
  // Se ejecuta el módulo sin el prefijo export para aislar la captura de su controlador inicial.
  const fuente = `${VERSION.replace(/^export /gm, '')}\nversionCambiada;`;
  const cambiada: () => boolean = runInNewContext(fuente, { navigator: { serviceWorker } });
  assert.equal(cambiada(), false);
  serviceWorker.controller = {};
  assert.equal(cambiada(), true);
  serviceWorker.controller = null;
  assert.equal(cambiada(), true);
  const sinControl: () => boolean = runInNewContext(fuente, { navigator: { serviceWorker } });
  serviceWorker.controller = inicial;
  assert.equal(sinControl(), false);
  const sinSoporte: () => boolean = runInNewContext(fuente, {});
  assert.equal(sinSoporte(), false);
});

const DIGITOS_SHA256 = 64;
/** El guion como lo cita la página construida: con la huella de sus bytes en el nombre (guiones-con-huella.ts). */
const PUBLICADO = `scripts/idioma-inicial-${'0'.repeat(DIGITOS_SHA256)}.js`;

/** Dónde está instalada la web y con qué nombre carga la página el guion: el de su fuente, si no se indica. */
interface Instalacion {
  base: string;
  guion?: string;
}

function inicialEnPagina(
  { base, guion = 'scripts/idioma-inicial.js' }: Instalacion,
  pagina: string,
  idioma: string,
  integridad: Record<string, string>,
) {
  const precargas: { href?: string; integrity?: string }[] = [];
  let manifiesto = '';
  const document = {
    baseURI: new URL(pagina, base).href,
    currentScript: { getAttribute: () => new URL(guion, base).href },
    documentElement: { dataset: {} },
    createElement: () => ({}),
    head: { append: (enlace: object) => precargas.push(enlace) },
    querySelector: (selector: string) =>
      selector === 'link[rel=manifest]'
        ? {
            setAttribute: (_: string, valor: string) => {
              manifiesto = valor;
            },
          }
        : { textContent: JSON.stringify({ integrity: integridad }) },
  };
  runInNewContext(INICIAL, {
    document,
    URL,
    URLSearchParams,
    location: { href: document.baseURI, search: '' },
    history: { state: null, replaceState: () => assert.fail('sin ?idioma no se toca la dirección') },
    navigator: { languages: [idioma] },
    localStorage: { getItem: () => null },
    setTimeout: () => {},
  });
  return { precargas, manifiesto };
}

test('idiomas y manifiestos iniciales resuelven la raíz y el mapa de cada instalación, con su fuente o publicado', () => {
  const instalaciones = ['https://faro.invalid/', 'https://faro.invalid/subcarpeta/'].flatMap((base) => [
    { base },
    { base, guion: PUBLICADO },
  ]);
  for (const instalacion of instalaciones) {
    for (const idioma of ['es', 'ca']) {
      for (const [pagina, rutaMapa] of [
        ['inicio.html', `./idiomas/${idioma}.js`],
        ['administracion/index.html', `../idiomas/${idioma}.js`],
        ['demo/recorrido.html', `../idiomas/${idioma}.js`],
      ]) {
        assert.ok(pagina && rutaMapa);
        const resultado = inicialEnPagina(instalacion, pagina, idioma, { [rutaMapa]: 'sha384-test' });
        assert.equal(resultado.precargas[0]?.href, new URL(rutaMapa, new URL(pagina, instalacion.base)).href);
        assert.equal(resultado.precargas[0]?.integrity, 'sha384-test');
        assert.equal(
          resultado.manifiesto,
          new URL(idioma === 'ca' ? 'manifest-ca.webmanifest' : 'manifest.webmanifest', instalacion.base).href,
        );
      }
    }
  }
});

test('sin mapa válido o con dos huellas para el diccionario no se precarga sin una huella inequívoca', () => {
  const base = 'https://faro.invalid/subcarpeta/';
  assert.deepEqual(inicialEnPagina({ base }, 'administracion/index.html', 'ca', {}).precargas, []);
  assert.deepEqual(
    inicialEnPagina({ base }, 'administracion/index.html', 'ca', {
      '../idiomas/ca.js': 'sha384-a',
      '/subcarpeta/idiomas/ca.js': 'sha384-b',
    }).precargas,
    [],
  );
});

test('el diccionario solo se reconoce en su entrada estable del paquete, no en otras carpetas', () => {
  const base = 'https://faro.invalid/';
  for (const ruta of ['./publico/idiomas/ca.js', './acceso-web/bundle/idiomas/ca.js', './js/idiomas/ca.js']) {
    assert.deepEqual(inicialEnPagina({ base }, 'inicio.html', 'ca', { [ruta]: 'sha384-test' }).precargas, [], ruta);
  }
});
