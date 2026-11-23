// Cómo lee el revisor de la CSP (herramientas/web/csp.ts) lo que revisa: las formas de evaluar código de un script,
// fuera de sus comentarios; las páginas sin sus comentarios HTML; y un atributo repetido por su primera aparición, como
// el navegador (herramientas/web/etiquetas.ts).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { comprobarCspHtml, comprobarCspScript } from '../../herramientas/web/csp.ts';

/** Si alguno de los problemas dice `texto`. */
function dice(problemas: readonly string[], texto: string): boolean {
  return problemas.some((problema) => problema.includes(texto));
}

test('los scripts: cada forma de evaluar código se marca, y solo fuera de los comentarios', () => {
  const evaluan = [
    'eval (x);',
    "Function('return 1')();",
    'new  Function (a);',
    "window['eval'](x);",
    "setTimeout('x()', 1);",
    'setInterval( "x()", 1);',
    'importScripts ("a.js");',
  ];
  for (const js of evaluan) {
    assert.ok(dice(comprobarCspScript('scripts/prueba.js', js), 'evalúa código'), js);
  }
  const noEvaluan = ['// eval(x)', '/* new Function(a) */', 'setTimeout(() => x(), 1);', 'esFunction(1);'];
  for (const js of noEvaluan) {
    assert.deepEqual(comprobarCspScript('scripts/prueba.js', js), [], js);
  }
});

test('las páginas: una etiqueta dentro de un comentario HTML no es un problema', () => {
  const comentadas = [
    '<!-- <style>p{}</style> -->',
    '<!-- <meta http-equiv="refresh" content="0"> -->',
    '<!-- <script>x()</script> -->',
    '<!-- <p style="color:red"> -->',
  ];
  for (const html of comentadas) {
    assert.deepEqual(comprobarCspHtml('p.html', html), [], html);
  }
});

test('un atributo repetido vale lo que su primera aparición, como en el navegador', () => {
  const externoPrimero = '<script type="module" src="https://otro.example/a.js" src="scripts/a.js"></script>';
  assert.ok(dice(comprobarCspHtml('p.html', externoPrimero), 'otro origen'));
  const propioPrimero = '<script type="module" src="scripts/a.js" src="https://otro.example/a.js"></script>';
  assert.deepEqual(comprobarCspHtml('p.html', propioPrimero), []);
});
