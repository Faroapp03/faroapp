// Relaciones entre las páginas, sus traducciones y los recursos publicados para la copia sin conexión.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { listaDelServicio } from '../../herramientas/web/copia-sin-conexion.ts';
import { archivosPublicados } from '../../herramientas/web/publicados.ts';
import ca from '../../web/idiomas/ca.js';
import es from '../../web/idiomas/es.js';
import { conRutasRelativas } from '../ayudas/paginas-con-rutas-absolutas.ts';
import { modulosDelMapa, webConstruida } from '../ayudas/web-construida.ts';

const WEB = new URL('../../web/', import.meta.url);
const PAGINAS = ['datos-globales.html', 'datos-globales-ue.html', 'datos-globales-mundo.html'];
const INSTITUCIONES = {
  es: [
    ['Eurostat', 'Eurostat'],
    ['Idescat', 'Idescat'],
    ['Comisión Europea', 'Comisión Europea'],
    ['Centre d’Estudis d’Opinió', 'CEO'],
  ],
  ca: [
    ['Eurostat', 'Eurostat'],
    ['Idescat', 'Idescat'],
    ['Comissió Europea', 'Comissió Europea'],
    ['Centre d’Estudis d’Opinió', 'CEO'],
  ],
} as const;
const NO_SON_FUENTES = ['tema', 'titulo', 'consultadas', 'licencias', 'decada-digital'];
const RECURSOS = [
  ...PAGINAS,
  'scripts/datos-globales.js',
  'scripts/datos-globales-ue.js',
  'scripts/datos-globales-mundo.js',
  'scripts/datos-globales/pagina.js',
  'estilos/datos-globales.css',
  'estilos/datos-globales-paginas.css',
];
const MUESTRA = 'datos-globales-muestra.json';
const leer = (archivo: string) => conRutasRelativas(archivo, readFileSync(new URL(archivo, WEB), 'utf8'));

function contenido(diccionario: Readonly<Record<string, string>>, clave: string): string {
  const texto = diccionario[clave];
  assert.ok(typeof texto === 'string', clave);
  return texto;
}

function navegacion(html: string, atributo: RegExp): string {
  const bloque = [...html.matchAll(/<nav\b[^>]*>[\s\S]*?<\/nav>/g)].find(([nav]) => atributo.test(nav));
  assert.ok(bloque, `Falta navegación ${atributo}`);
  return bloque[0];
}

function enlaces(html: string) {
  return [...html.matchAll(/<a\b([^>]*)>/g)].map(([, atributos = '']) => ({
    href: /\bhref="([^"]+)"/.exec(atributos)?.[1],
    actual: /\baria-current="page"/.test(atributos),
  }));
}

test('fuentes: cada institución aparece en las condiciones ES/CA', () => {
  for (const [lengua, diccionario] of [
    ['es', es],
    ['ca', ca],
  ] as const) {
    const entradas = Object.entries(diccionario).filter(
      ([clave]) =>
        clave.startsWith('datos-globales.fuentes.') &&
        !NO_SON_FUENTES.includes(clave.slice('datos-globales.fuentes.'.length)),
    );
    assert.ok(entradas.length > 0);
    for (const [clave, texto] of entradas) {
      const institucion = INSTITUCIONES[lengua].find(([inicio]) => texto.startsWith(inicio));
      assert.ok(institucion, `${lengua}: ${clave} no empieza por una institución conocida`);
      const [, nombre] = institucion;
      assert.ok(
        contenido(diccionario, 'datos-globales.fuentes.licencias').includes(nombre),
        `${lengua}: condiciones ${nombre}`,
      );
    }
  }
});

test('leyenda: símbolos decorativos y escritura TIC-H conservan las relaciones HTML/ES/CA', () => {
  const html = leer('datos-globales.html');
  assert.match(
    html,
    /<strong data-texto="datos-globales\.metodo\.medido\.titulo"\s*><span\s+aria-hidden="true"\s*>●<\/span/,
  );
  assert.match(html, /«<span\s+aria-hidden="true"\s*>○<\/span/);
  for (const diccionario of [es, ca]) {
    assert.match(contenido(diccionario, 'datos-globales.metodo.medido.titulo'), /^\{0\} /);
    assert.match(contenido(diccionario, 'datos-globales.metodo.medido.todas'), /«\{0\} /);
    assert.ok(!contenido(diccionario, 'datos-globales.fuentes.tic-h').includes('TIC\u2011H'));
    assert.ok(!contenido(diccionario, 'datos-globales.opinion.sin-pregunta').includes('○'));
  }
  assert.ok(!html.includes('TIC\u2011H'));
});

test('pestañas: las tres páginas conservan orden y únicamente la actual marcada', () => {
  for (const pagina of PAGINAS) {
    const nav = navegacion(leer(pagina), /\bclass="[^"]*\bdg-pestanas\b[^"]*"/);
    const links = enlaces(nav);
    assert.deepEqual(
      links.map(({ href }) => href),
      PAGINAS,
      pagina,
    );
    assert.deepEqual(
      links.filter(({ actual }) => actual).map(({ href }) => href),
      [pagina],
      pagina,
    );
  }
});

test('mundo: la sección de enganche del globo y su CSS están en el HTML publicado', () => {
  const html = leer('datos-globales-mundo.html');
  assert.match(html, /<link\b(?=[^>]*\brel="stylesheet")(?=[^>]*\bhref="estilos\/globo\.css")[^>]*>/);
  assert.match(html, /<section\b(?=[^>]*\bclass="[^"]*\bdg-globo\b[^"]*")(?=[^>]*\bid="datos-globales-globo")[^>]*>/);
});

test('menú: las páginas comunes conservan el enlace a Datos globales', () => {
  // La página de credenciales está aislada y no comparte la navegación del recorrido.
  const paginas = readdirSync(WEB).filter((archivo) => archivo.endsWith('.html') && archivo !== 'acceso-api.html');
  assert.ok(paginas.length > 0);
  for (const pagina of paginas) {
    const menu = navegacion(leer(pagina), /\bid="menu"/);
    assert.match(
      menu,
      /<a href="datos-globales\.html"(?: aria-current="page")?\s*><span class="menu-destino" data-texto="comun\.seccion\.datos-globales"/,
      pagina,
    );
  }
});

test('catálogos: recursos del dossier disponibles sin publicar la muestra de pruebas', () => {
  const enLaCopia = listaDelServicio('ARCHIVOS', webConstruida());
  assert.ok(enLaCopia.length > 0, 'el service worker no declara ARCHIVOS');
  for (const archivo of RECURSOS.filter((ruta) => !ruta.endsWith('.js'))) {
    assert.ok(enLaCopia.includes(archivo), archivo);
  }
  const comprobados = listaDelServicio('COMPROBADOS', webConstruida());
  for (const pagina of PAGINAS) {
    const modulos = modulosDelMapa(pagina);
    assert.ok(modulos.length > 0, pagina);
    for (const modulo of modulos) {
      assert.ok(enLaCopia.includes(modulo) || comprobados.includes(modulo), `${pagina}: ${modulo}`);
    }
  }
  // Las pruebas viven fuera de web/: comprobar que su muestra no llega a los recursos publicados.
  assert.ok(!archivosPublicados().some((archivo) => archivo.split('/').at(-1) === MUESTRA));
  assert.ok(!enLaCopia.some((archivo) => archivo.split('/').at(-1) === MUESTRA));
});
