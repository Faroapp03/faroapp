// Casos del revisor de la CSP de la web (herramientas/web/csp.ts), con ejemplos que disparan sus reglas y otros
// parecidos que no; el HTML no distingue mayúsculas en etiquetas, atributos ni esquemas, y admite saltos de línea
// entre atributos, así que los casos se repiten con esas formas.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { comprobarCspHtml, comprobarCspScript, scriptsRevisados } from '../../herramientas/web/csp.ts';
import { SERVICE_WORKER } from '../../herramientas/web/publicados.ts';

/** Los problemas de una página de prueba con este HTML. */
function pagina(html: string): string[] {
  return comprobarCspHtml('p.html', html);
}
/** Si alguno de los problemas dice `texto`. */
function dice(problemas: string[], texto: string): boolean {
  return problemas.some((problema) => problema.includes(texto));
}

test('cada regla de las páginas se dispara con su ejemplo', () => {
  const casos: [html: string, motivo: string][] = [
    ['<script>x()</script>', 'script en línea'],
    ['<script type="importmap" src="scripts/mapa.json"></script>', 'no es un módulo'],
    ['<script type="module" src="https://otro.example/a.js"></script>', 'script de otro origen'],
    ['<script src="scripts/x.js"></script>', 'scripts/x.js no es un módulo'],
    ['<p style="color:red">', 'atributo style en <p>'],
    ['<div onclick="x()">', 'manejador en línea (onclick) en <div>'],
    ['<iframe srcdoc="hola">', 'srcdoc en <iframe>'],
    ['<a href=" javascript:x()">', 'href="javascript:…" en <a>'],
    ['<style>p{}</style>', 'bloque <style> en línea'],
    ['<meta http-equiv="refresh" content="0">', '<meta http-equiv>'],
    ['<meta http-equiv=set-cookie content="a=b">', '<meta http-equiv>'],
    ['<img src="https://otro.example/a.png">', '<img> carga un recurso de otro origen'],
    ['<img srcset="https://otro.example/a.png 2x">', '<img> carga un recurso de otro origen'],
    ['<link rel="stylesheet" href="https://otro.example/a.css">', '<link> carga un recurso de otro origen'],
    ['<svg><use xlink:href="https://otro.example/s.svg#a"></use></svg>', '<use> carga un recurso de otro origen'],
    ['<SCRIPT>x()</SCRIPT>', 'script en línea'],
    ['<DIV ONCLICK="x()">', 'manejador en línea (onclick) en <div>'],
    ['<div\nonClick="x()">', 'manejador en línea (onclick) en <div>'],
    ['<a href="Javascript:x()">', 'href="javascript:…" en <a>'],
    ['<P STYLE="color:red">', 'atributo style en <p>'],
    ['<p\nstyle="color:red">', 'atributo style en <p>'],
    ['<STYLE>p{}</STYLE>', 'bloque <style> en línea'],
    ['<IFRAME SRCDOC="hola">', 'srcdoc en <iframe>'],
    ['<META HTTP-EQUIV="Refresh" content="0">', '<meta http-equiv>'],
    ['<IMG SRC="https://otro.example/a.png">', '<img> carga un recurso de otro origen'],
  ];
  for (const [html, motivo] of casos) {
    const problemas = pagina(html);
    assert.ok(dice(problemas, motivo), `${html}: ${problemas}`);
  }
});

test('lo parecido que la CSP sí admite no se marca', () => {
  const admitidos = [
    '<script type="importmap">{"imports":{}}</script>',
    '<script type="module" src="scripts/x.js"></script>',
    '<script src="scripts/tema-inicial.js"></script>',
    '<a href="https://otro.example/">un enlace no carga nada</a>',
    '<a href="/inicio.html">',
    '<img src="iconos/a.png" alt>',
    '<img srcset>',
    '<link rel="icon" href>',
    '<metadato http-equiv="refresh">',
    '<meta xhttp-equiv="refresh">',
    '<meta http-equiv="refreshing">',
    '<p class="stylesheet">',
  ];
  for (const html of admitidos) {
    assert.deepEqual(pagina(html), [], html);
  }
});

test('tema e idioma iniciales admiten la ruta absoluta común sin abrir otros cargadores', () => {
  for (const nombre of ['tema-inicial', 'idioma-inicial']) {
    const src = `/scripts/${nombre}.js`;
    assert.deepEqual(comprobarCspHtml('administracion/index.html', `<script src="${src}"></script>`), []);
    for (const externo of [`//otro.example${src}`, `https://otro.example${src}`]) {
      assert.ok(dice(pagina(`<script src="${externo}"></script>`), 'otro origen'));
    }
    assert.ok(dice(pagina(`<script src="/otra/${nombre}.js"></script>`), 'no es un módulo'));
  }
  assert.ok(dice(pagina('<script src="/scripts/otro.js"></script>'), 'no es un módulo'));
});

test('un script problemático se cuenta una sola vez, sin repetirlo como recurso', () => {
  assert.equal(pagina('<script type="module" src="https://otro.example/a.js"></script>').length, 1);
});

test('los scripts: palabras parecidas a las prohibidas no se marcan', () => {
  const parecidos = [
    'medieval(1);',
    'const myinnerHTML = 1;',
    'const innerHTMLish = 1;',
    'const MyDOMParser = 1;',
    'const DOMParsers = 1;',
    'const tienesrcdoc = 1;',
    'const srcdocs = 1;',
    'myimportScripts(1);',
  ];
  for (const js of parecidos) {
    assert.deepEqual(comprobarCspScript('scripts/prueba.js', js), [], js);
  }
});

test('se revisan los scripts y los diccionarios, y el service worker; nada más', () => {
  const publicados = ['scripts/a.js', 'idiomas/ca.js', 'otros/x.js', 'scripts/a.css', SERVICE_WORKER, 'inicio.html'];
  assert.deepEqual(scriptsRevisados(publicados), ['scripts/a.js', 'idiomas/ca.js', SERVICE_WORKER]);
});

test('la red de seguridad: comillas simples, sin comillas, entidades con nombre y códigos imposibles', () => {
  const escondidos = [
    "<a href='&#106;avascript:x()'>",
    '<a href=java&Tab;script:x()>',
    '<a href="java&NewLine;script:x()">',
    '<a href="javascript&colon;x()">',
    '<a href="&#x110000;javascript:x()">',
    '<a href="&#99999999;javascript:x()">',
    '<A HREF="JAVA&Tab;SCRIPT:x()">',
    "<a\nhref='&#106;AVASCRIPT:x()'>",
  ];
  for (const html of escondidos) {
    assert.ok(dice(pagina(html), 'dirección que ejecuta código'), html);
  }
});

test('un srcset con una imagen propia y otra de otro origen se marca', () => {
  assert.ok(dice(pagina('<img srcset="a.png 1x, https://otro.example/b.png 2x">'), 'otro origen'));
});

test('los scripts no admiten recursos de otro origen aunque el archivo sea un cargador', () => {
  for (const archivo of ['scripts/inicio.js', 'scripts/cargador.js', 'scripts/conectividad/invitacion.js']) {
    for (const direccion of ['https://otro.example/api.js', '//otro.example/api.js']) {
      assert.ok(dice(comprobarCspScript(archivo, `const guion = '${direccion}';`), 'otro origen'));
    }
    assert.deepEqual(comprobarCspScript(archivo, "const guion = './propio.js';"), []);
  }
});

test('los enlaces de contacto del plan no autorizan peticiones ni otros destinos', () => {
  const archivo = 'scripts/recorrido/plan-formacion/contactos-proveedores.js';
  const enlace = 'https://www.life-global.org/es/help';
  assert.deepEqual(comprobarCspScript(archivo, `const fuente = '${enlace}';`), []);
  assert.ok(dice(comprobarCspScript(archivo, `fetch('${enlace}');`), 'otro origen'));
  assert.ok(dice(comprobarCspScript(archivo, "const fuente = 'https://otro.example/';"), 'otro origen'));
  assert.ok(dice(comprobarCspScript('scripts/prueba.js', `const fuente = '${enlace}';`), 'otro origen'));
  // El guion de la sincronía del proveedor no tiene enlaces informativos autorizados.
  const sincronia = 'scripts/recorrido/plan-formacion/sincronia-proveedor.js';
  assert.ok(dice(comprobarCspScript(sincronia, `const fuente = '${enlace}';`), 'otro origen'));
});

test('los scripts: el espacio de nombres de SVG no es un recurso de otro origen', () => {
  assert.deepEqual(comprobarCspScript('scripts/prueba.js', "const SVG = 'http://www.w3.org/2000/svg';"), []);
  assert.ok(dice(comprobarCspScript('scripts/prueba.js', "fetch('http://www.w3.org/2000/svg/otro');"), 'otro origen'));
});

test('los scripts: insertar HTML sin la política de Trusted Types, también con outerHTML', () => {
  const informe = 'scripts/recorrido/paso-informe.js';
  assert.ok(dice(comprobarCspScript(informe, 'nodo.outerHTML = texto;'), 'sin htmlDeConfianza'));
  assert.ok(!dice(comprobarCspScript(informe, 'nodo.xinnerHTML = texto;'), 'sin htmlDeConfianza'));
});

test('los scripts: innerHTML, outerHTML, insertAdjacentHTML y document.write fuera del punto documentado se marcan', () => {
  for (const codigo of [
    'nodo.innerHTML = texto;',
    'nodo.outerHTML = texto;',
    "nodo.insertAdjacentHTML('beforeend', texto);",
    'document.write(texto);',
  ]) {
    assert.ok(dice(comprobarCspScript('scripts/prueba.js', codigo), 'fuera del punto documentado'), codigo);
  }
});
