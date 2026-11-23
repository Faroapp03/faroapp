// La apertura de Inicio dice qué se obtiene, tres hechos y lleva al recorrido: «Empezar» y el informe de ejemplo. Con
// el recorrido cerrado desde el panel, los dos enlaces se ocultan como el del menú. El menú y las tarjetas ofrecen
// «Qué es Faro»; el pie ofrece «Instalar Faro» (pruebas/web-informacion/pie.test.ts).
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { sinComentariosHtml } from '../../herramientas/web/etiquetas.ts';
import ca from '../../web/idiomas/ca.js';
import es from '../../web/idiomas/es.js';
import { seccionDeLaRuta } from '../../web/scripts/secciones-contrato.js';

const WEB = new URL('../../web/', import.meta.url);
const ESTILOS = new URL('estilos/', WEB);
const INICIO = sinComentariosHtml(readFileSync(new URL('inicio.html', WEB), 'utf8'));
const HOJAS = readdirSync(ESTILOS, { recursive: true, encoding: 'utf8' }).filter((ruta) => ruta.endsWith('.css'));
const css = (hoja: string) => readFileSync(new URL(hoja, ESTILOS), 'utf8');
const APERTURA = /<section[^>]*class="apertura"[\s\S]*?<\/section>/.exec(INICIO)?.[0] ?? '';
/** Las claves de los textos de la apertura. */
const CLAVES_APERTURA = [
  'inicio.portada.intro',
  'inicio.portada.hecho.gratis',
  'inicio.portada.hecho.registro',
  'inicio.portada.hecho.dispositivo',
  'inicio.portada.ejemplo',
  'comun.seccion.empezar',
];

test('la apertura lleva la marca, la entradilla, los tres hechos y, por este orden, «Empezar» y el ejemplo', () => {
  assert.ok(APERTURA, 'la portada');
  assert.match(APERTURA, /<h1 id="apertura-titulo" class="apertura-marca"/);
  assert.match(APERTURA, /<p class="apertura-entradilla" data-texto="inicio\.portada\.intro"/);
  const lista = /<ul class="apertura-hechos" role="list">([\s\S]*?)<\/ul>/.exec(APERTURA)?.[1] ?? '';
  assert.deepEqual(
    [...lista.matchAll(/<li data-texto="([^"]+)"/g)].map(([, clave]) => clave),
    ['inicio.portada.hecho.gratis', 'inicio.portada.hecho.registro', 'inicio.portada.hecho.dispositivo'],
  );
  const enlaces = [...APERTURA.matchAll(/<a\s+class="([^"]+)"\s+href="([^"]+)"/g)].map(([, clase, href]) => [
    clase,
    href,
  ]);
  assert.deepEqual(enlaces, [
    ['boton-empezar', 'recorrido.html'],
    ['apertura-ejemplo', 'informe-ejemplo.html'],
  ]);
  assert.match(
    APERTURA,
    /<a class="boton-empezar" href="recorrido\.html"\s*><span data-texto="comun\.seccion\.empezar">/,
  );
  assert.ok(!APERTURA.includes('<button'), 'los dos son enlaces: se abren, se copian y funcionan sin JavaScript');
});

test('los textos de la apertura existen en los dos idiomas, distintos, sin duraciones ni promesas de resultado', () => {
  for (const clave of CLAVES_APERTURA) {
    const castellano = (es as Record<string, string>)[clave];
    const catalan = (ca as Record<string, string>)[clave];
    assert.ok(castellano && catalan, clave);
    assert.notEqual(castellano, catalan, clave);
    for (const texto of [castellano, catalan]) {
      assert.doesNotMatch(texto, /\d\s*(min|hora|segund)/iu, `${clave}: sin duración`);
      assert.doesNotMatch(texto, /empleabilidad|ocupabilitat|garantiza|garanteix|prototip|demo|beta/iu, clave);
    }
  }
});

test('«Empezar» y el ejemplo son de la sección del recorrido y secciones.js oculta su grupo entero', () => {
  for (const ruta of ['/recorrido.html', '/informe-ejemplo.html']) {
    assert.equal(seccionDeLaRuta(ruta), 'recorrido', ruta);
  }
  // El grupo es una unidad de secciones.js (pruebas/web-controles/secciones.test.js): sin depender de :has().
  assert.match(APERTURA, /<div class="apertura-acciones"\s*><a class="boton-empezar"/);
  assert.match(readFileSync(new URL('scripts/secciones.js', WEB), 'utf8'), /\.historia, \.apertura-acciones, /);
  assert.ok(!css('portada-apertura.css').includes(':has('));
});

test('los hechos son una lista anunciada como tal y se separan con un hueco, sin signos al principio de línea', () => {
  assert.match(APERTURA, /<ul class="apertura-hechos" role="list">/);
  const hechos = /\.apertura-hechos \{([^}]*)\}/.exec(css('portada-apertura.css'))?.[1] ?? '';
  assert.match(hechos, /flex-wrap: wrap;/);
  assert.match(hechos, /gap: 2px 1\.5em;/);
  assert.doesNotMatch(hechos, /max-width/);
  assert.doesNotMatch(css('portada-apertura.css'), /apertura-hechos li[^{]*::before/);
});

/** Un valor en px de una regla de una hoja: el primero de `propiedad` dentro del bloque de `selector`. */
function pixeles(bloque: string, selector: string, propiedad: string): number {
  const reglas = new RegExp(`${selector.replace(/[.]/g, '\\.')} \\{([^}]*)\\}`).exec(bloque)?.[1] ?? '';
  const valor = new RegExp(`${propiedad}: (\\d+)px`).exec(reglas)?.[1];
  assert.ok(valor, `${selector} { ${propiedad} }`);
  return Number(valor);
}

// Las pantallas del encaje: anchos y altos visibles (con las barras del navegador en Safari) de los móviles comunes.
const ANCHO_ESTRECHO = 320;
const ANCHO_MEDIO = 360;
const ANCHO_COMUN = 375;
const ALTO_SAFARI_ESTRECHO = 460;
const ALTO_ESTRECHO = 568;
const ALTO_MEDIO = 584;
const ALTO_SAFARI_COMUN = 548;
const ALTO_COMUN = 667;
/** Alturas fijas: cabecera móvil, marca (16 vw), líneas de la entradilla (0,91 rem × 1,75) y de los hechos, y botón. */
const CABECERA = 72;
const MARCA_POR_ANCHO = 0.16;
const LINEA_ENTRADILLA = 25.48;
const LINEA_HECHOS = 20.8;
const BOTON = 48;
/** Líneas en el peor idioma: la entradilla ocupa 3; los hechos, 3 por debajo de 360 px y 2 a partir de ahí. */
const LINEAS_ENTRADILLA = 3;
const LINEAS_HECHOS_ESTRECHO = 3;
const LINEAS_HECHOS = 2;

/** Lo que mide la apertura desde la parte de arriba de la marca hasta el borde inferior de «Empezar», con las reglas de
 * cada ancho. */
function textoHastaElBoton(ancho: number, hojas: { movil: string; estrecho: string; apertura: string }): number {
  const estrecha = ancho <= ANCHO_MEDIO;
  const margenHechos = estrecha
    ? pixeles(hojas.estrecho, '.apertura-hechos', 'margin-top')
    : Number(/\.apertura-hechos \{[^}]*margin: (\d+)px 0 0;/.exec(hojas.apertura)?.[1]);
  return (
    ancho * MARCA_POR_ANCHO +
    pixeles(estrecha ? hojas.estrecho : hojas.movil, '.apertura-entradilla', 'margin-top') +
    LINEAS_ENTRADILLA * LINEA_ENTRADILLA +
    margenHechos +
    (ancho < ANCHO_MEDIO ? LINEAS_HECHOS_ESTRECHO : LINEAS_HECHOS) * LINEA_HECHOS +
    pixeles(estrecha ? hojas.estrecho : hojas.apertura, '.apertura-acciones', 'margin-top') +
    BOTON
  );
}

test('en móvil «Empezar» queda en la primera pantalla, también a 320 px con las barras de Safari', () => {
  const hoja = css('portada-adaptaciones.css');
  const movil = /@media \(max-width: 700px\) \{([\s\S]*?)\n\}/.exec(hoja)?.[1] ?? '';
  const estrecho = /@media \(max-width: 360px\) \{([\s\S]*?)\n\}/.exec(hoja)?.[1] ?? '';
  const apertura = css('portada-apertura.css');
  const [, minimo, resta, maximo] =
    /--apertura-titulo: clamp\((\d+)px, calc\(100svh - (\d+)px\), (\d+)px\);/.exec(movil) ?? [];
  assert.ok(minimo && resta && maximo);
  assert.match(movil, /\.apertura-imagen \{[^}]*height: calc\(var\(--apertura-titulo\) \* 510 \/ 305\);/);
  assert.match(movil, /\.apertura-cuerpo \{[^}]*padding: var\(--apertura-titulo\) 26px 28px;/);
  assert.doesNotMatch(movil, /\.apertura \{[^}]*min-height/, 'una altura mínima empujaría el botón hacia abajo');
  const pantallas = [
    [ANCHO_ESTRECHO, ALTO_SAFARI_ESTRECHO],
    [ANCHO_ESTRECHO, ALTO_ESTRECHO],
    [ANCHO_MEDIO, ALTO_MEDIO],
    [ANCHO_COMUN, ALTO_SAFARI_COMUN],
    [ANCHO_COMUN, ALTO_COMUN],
  ];
  for (const [ancho = 0, alto = 0] of pantallas) {
    const titulo = Math.min(Number(maximo), Math.max(Number(minimo), alto - Number(resta)));
    const borde = CABECERA + titulo + textoHastaElBoton(ancho, { movil, estrecho, apertura });
    assert.ok(borde <= alto, `${ancho}×${alto}: el botón acaba en ${Math.round(borde)} px`);
  }
});

test('ninguna hoja define estilos para botones de apertura sin uso', () => {
  const ausentes = ['.apertura-principal', '.apertura-secundaria', '.apertura-instalar'];
  for (const hoja of HOJAS) {
    for (const ausente of ausentes) {
      assert.ok(!css(hoja).includes(ausente), `${hoja}: ${ausente}`);
    }
  }
});

test('«Qué es Faro», «Empezar» e «Instalar Faro» están en el menú, las tarjetas de inicio y el pie', () => {
  const menu = /<nav id="menu"[^>]*>[\s\S]*?<\/nav>/.exec(INICIO)?.[0] ?? '';
  assert.match(menu, /<a href="que-es-faro\.html"/);
  assert.match(menu, /<a href="recorrido\.html"/);
  const tarjetas = [...INICIO.matchAll(/<a class="historia [^"]*" href="([^"]+)"/g)].map(([, href]) => href);
  assert.deepEqual(tarjetas, ['entender-ia.html', 'que-es-faro.html', 'biblioteca.html']);
  assert.match(INICIO, /<a class="pie-instalar" href="instalar\.html" data-texto="comun\.pie\.instalar">/);
});

test('la portada no tiene «Explorar Faro» ni sitio para un botón de instalar: ni enlace, ni clave, ni estilos', () => {
  assert.ok(!INICIO.includes('href="#explorar"'));
  assert.ok(!INICIO.includes('data-instalar-aqui'));
  assert.ok(!Object.hasOwn(es, 'inicio.portada.explorar'));
  assert.ok(!Object.hasOwn(ca, 'inicio.portada.explorar'));
  for (const hoja of HOJAS) {
    for (const ausente of ['.apertura-explorar', '.apertura-empezar', '.instalacion-boton', '.instalacion-dialogo']) {
      assert.ok(!css(hoja).includes(ausente), `${hoja}: ${ausente}`);
    }
  }
});
