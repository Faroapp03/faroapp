// «Qué página corresponde a esta ruta» tiene una sola fuente, paginaDeLaRuta (src/administracion/secciones-web.js), que
// el service worker lleva dentro, servida en su construcción desde la política única (herramientas/web/servicio): los
// mismos casos dan la misma página en el servidor y en el service worker, también para un alias (paginaDelAlias). Y
// los módulos propios del service worker (src/service-worker/) no llevan una normalización de rutas que pueda
// apartarse de ella.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { paginaDeLaRuta } from '../../src/administracion/secciones-web.js';
import { BASES, servicio } from './ayudas.ts';

/** Cada ruta con la página que nombra, o undefined si no nombra ninguna. */
const CASOS: [string, string | undefined][] = [
  ['/biblioteca.html', '/biblioteca.html'],
  ['/biblioteca', '/biblioteca.html'],
  ['/BIBLIOTECA.HTML', '/biblioteca.html'],
  ['/%62iblioteca.html', '/biblioteca.html'],
  ['//biblioteca.html', '/biblioteca.html'],
  ['/x/%2f../biblioteca.html', '/biblioteca.html'],
  ['/x/./../biblioteca', '/biblioteca.html'],
  ['/x/%2e%2e/biblioteca.html', '/biblioteca.html'],
  ['/x/%2E%2E/biblioteca', '/biblioteca.html'],
  ['/biblioteca/', '/biblioteca.html'],
  ['/biblioteca/index.html', undefined],
  ['/datos-globales', '/datos-globales.html'],
  ['/datos-globales-ue', '/datos-globales-ue.html'],
  ['/Datos-Globales-Mundo.html', '/datos-globales-mundo.html'],
  ['/inicio.html', undefined],
  ['/como-funciona.html', undefined],
  ['biblioteca.html', undefined],
  ['/%E0%A4%A', undefined],
];

test('el servidor da a cada ruta la página de la tabla', () => {
  for (const [camino, pagina] of CASOS) {
    assert.equal(paginaDeLaRuta(camino), pagina, camino);
  }
});

for (const base of BASES) {
  test(`el service worker da a cada ruta la misma página que el servidor, también como alias: ${base}`, () => {
    const sw = servicio(base);
    for (const [camino, pagina] of CASOS) {
      assert.equal(sw.evaluar(`paginaDeLaRuta(${JSON.stringify(camino)})`), pagina, camino);
    }
    for (const [camino, pagina] of CASOS.filter(([ruta, nombrada]) => ruta.startsWith('/') && nombrada)) {
      const alias = `${base}${camino.slice(1)}`;
      assert.equal(sw.evaluar(`paginaDelAlias(${JSON.stringify(alias)})`), pagina?.slice(1), alias);
    }
    // Un alias es una dirección entera: la consulta y el fragmento no cambian la página ni la sección que nombra.
    for (const resto of ['?a=1', '#b', '?a=1#b']) {
      const alias = `${base}biblioteca${resto}`;
      assert.equal(sw.evaluar(`paginaDelAlias(${JSON.stringify(alias)})`), 'biblioteca.html', alias);
      assert.equal(
        sw.evaluar(`seccionDeLaClave(${JSON.stringify(alias)})`),
        sw.evaluar(`seccionDeLaClave(${JSON.stringify(`${base}biblioteca.html`)})`),
        alias,
      );
    }
  });
}

test('el service worker no normaliza rutas por su cuenta: usa paginaDeLaRuta', () => {
  const carpeta = new URL('../../src/service-worker/', import.meta.url);
  const modulos = readdirSync(carpeta).filter((nombre) => nombre.endsWith('.js'));
  assert.ok(modulos.includes('servir.js'), 'los módulos del service worker están en src/service-worker/');
  const fuente = modulos.map((nombre) => readFileSync(new URL(nombre, carpeta), 'utf8')).join('\n');
  assert.doesNotMatch(
    fuente,
    /decodeURI(?:Component)?\s*\(|[!=]==?\s*['"]\.\.['"]|['"]\.\.['"]\s*[!=]==?/u,
    'sin una normalización propia de las rutas',
  );
  assert.match(fuente, /\bpaginaDeLaRuta\(/u, 'la página de un alias sale de paginaDeLaRuta');
});
