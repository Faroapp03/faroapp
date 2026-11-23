/** Navegación común y enlaces del recorrido a las páginas públicas vigentes. */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { aperturas, etiquetasDe, sinComentariosHtml } from '../../herramientas/web/etiquetas.ts';
import ca from '../../web/idiomas/ca.js';
import es from '../../web/idiomas/es.js';
import { conRutasRelativas } from '../ayudas/paginas-con-rutas-absolutas.ts';

const WEB = new URL('../../web/', import.meta.url);
const leer = (archivo: string) => conRutasRelativas(archivo, readFileSync(new URL(archivo, WEB), 'utf8'));
const PAGINAS = readdirSync(WEB).filter((archivo) => archivo.endsWith('.html'));
const etiquetas = (html: string) => aperturas(etiquetasDe(sinComentariosHtml(html)));

test('el menú empieza por «Inicio»: sin el título «Explorar Faro», con «Comprobar Faro» solo en el pie', () => {
  for (const pagina of PAGINAS) {
    const html = leer(pagina);
    const menu = /<nav id="menu"[^>]*>[\s\S]*?<\/nav>/.exec(html)?.[0] ?? '';
    assert.match(
      menu,
      /^<nav id="menu"[^>]*aria-label="Menú principal"[^>]*data-texto-aria-label="comun\.menu\.nombre"/,
      pagina,
    );
    assert.doesNotMatch(menu, /aria-labelledby|menu-titulo|comun\.menu\.titulo|doctor\.html|fix-doc/, pagina);
    assert.match(menu, /^<nav[^>]*>\s*<ul class="menu-lista">\s*<li\s*><a href="inicio\.html"/, pagina);
    assert.match(
      html,
      /<a class="pie-doctor" href="doctor\.html"/,
      `${pagina}: el pie sigue llevando a Comprobar Faro`,
    );
  }
  for (const diccionario of [es, ca]) {
    assert.ok(!Object.hasOwn(diccionario, 'comun.menu.titulo') && !Object.hasOwn(diccionario, 'comun.seccion.fix-doc'));
    assert.ok(diccionario['comun.menu.nombre']);
  }
});

test('Cursos sigue a Biblioteca en el menú común y solo marca su propia página', () => {
  const orden = [
    'inicio.html',
    'entender-ia.html',
    'que-es-faro.html',
    'recorrido.html',
    'biblioteca.html',
    'cursos.html',
    'datos-globales.html',
  ];
  for (const pagina of PAGINAS) {
    const menu = /<nav id="menu"[^>]*>[\s\S]*?<\/nav>/.exec(leer(pagina))?.[0] ?? '';
    const enlaces = etiquetas(menu).filter(({ nombre }) => nombre === 'a');
    assert.deepEqual(
      enlaces.map(({ atributos }) => atributos.get('href')),
      orden,
      pagina,
    );
    const cursos = enlaces.find(({ atributos }) => atributos.get('href') === 'cursos.html');
    assert.equal(cursos?.atributos.get('aria-current'), pagina === 'cursos.html' ? 'page' : undefined, pagina);
    assert.equal(
      etiquetas(menu).filter(({ atributos }) => atributos.get('data-texto') === 'comun.seccion.cursos').length,
      1,
      pagina,
    );
  }
  assert.equal(es['comun.seccion.cursos'], 'Cursos');
  assert.equal(ca['comun.seccion.cursos'], 'Cursos');
});

test('Inicio conserva sus accesos sin buscador y los informes enlazan a sus resultados', () => {
  const inicio = leer('inicio.html');
  // «03 / Prepararte» lleva a la Biblioteca.
  assert.match(inicio, /<a class="historia historia-proceso" href="biblioteca\.html">/);
  assert.doesNotMatch(inicio, /<a class="historia[^"]*" href="que-es-faro\.html#como-funciona">/);
  assert.match(inicio, /<a class="historia historia-ia" href="entender-ia\.html">/);
  assert.match(inicio, /<a class="historia historia-faro" href="que-es-faro\.html">/);
  assert.match(inicio, /<a href="recorrido\.html"/);
  assert.match(leer('que-es-faro.html'), /id="como-funciona"/);
  assert.doesNotMatch(inicio, /buscador-(?:franja|boton|secciones)|id="buscador"/);
  // El enlace al informe lleva a cómo leerlo (pestaña «Qué obtienes»).
  for (const pagina of ['recorrido.html', 'informe-ejemplo.html']) {
    assert.match(leer(pagina), /<a href="que-es-faro\.html#resultados" data-texto="que-es-faro\.enlace\.informe">/);
    assert.doesNotMatch(leer(pagina), /que-es-faro\.html#estado|como-funciona\.estado/);
  }
});
