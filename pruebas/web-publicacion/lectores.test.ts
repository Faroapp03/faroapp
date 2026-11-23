import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sinComentariosJs } from '../../herramientas/web/comentarios-js.ts';
import { aperturas, etiquetasDe, sinComentariosHtml } from '../../herramientas/web/etiquetas.ts';

test('cadenas, regex y plantillas conservan bytes; comentarios dejan un espacio', () => {
  for (const texto of ["const x = 'https://ejemplo/a';", 'const r = /a[/*]b/;', `const t = \`a // b \${"/*"}\`;`]) {
    assert.equal(sinComentariosJs(`${texto} // comentario`), `${texto}  `);
  }
  assert.equal(sinComentariosJs('const/*a*/x = 1;'), 'const x = 1;');
});

test('los límites conocidos de la heurística léxica no se presentan como parser completo', () => {
  assert.equal(sinComentariosJs('a = i++ / 2; // c'), 'a = i++ / 2; // c');
  assert.equal(sinComentariosJs("if (x) /'/.test(s); // c"), "if (x) /'/.test(s); // c");
});

test('atributos HTML sin valor, duplicados y distintas comillas conservan semántica', () => {
  const [etiqueta] = aperturas(etiquetasDe(sinComentariosHtml("<!-- <p> --><A HREF='a' href=b disabled></A>")));
  assert.ok(etiqueta);
  assert.equal(etiqueta.nombre, 'a');
  assert.deepEqual(
    [...etiqueta.atributos],
    [
      ['href', 'a'],
      ['disabled', null],
    ],
  );
});
