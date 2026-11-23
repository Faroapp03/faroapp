import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { parse as analizarJavascript } from 'acorn';
import { transformSync } from 'esbuild';
import { parse as analizarHtml, type DefaultTreeAdapterTypes, defaultTreeAdapter, serialize } from 'parse5';
import { cssPublicado, htmlPublicado, javascriptPublicado } from '../../herramientas/web/recursos-publicados.ts';

/** El AST conserva tokens y valores; solo se omiten sus posiciones, que cambian al retirar comentarios. */
function astJavascript(texto: string, sourceType: 'script' | 'module'): unknown {
  return JSON.parse(
    JSON.stringify(analizarJavascript(texto, { ecmaVersion: 'latest', sourceType }), (clave, valor: unknown) => {
      if (clave === 'start' || clave === 'end') {
        return undefined;
      }
      return typeof valor === 'bigint' ? { bigint: String(valor) } : valor;
    }),
  );
}

test('JS conserva literales, regex, divisiones, plantillas anidadas, imports y nombres exactos', () => {
  const casos = [
    `const/*separación*/nombre = 'https://ejemplo.invalid/a/*b*/'; // fuera\n`,
    `if (verdad) /[/*]/u.test('/'); const cociente = 20 / 2 / 5; /* fuera */`,
    `let numero = 4; numero /= 2; const patron = /a\\/b/giu; // fuera\n`,
    // biome-ignore lint/suspicious/noTemplateCurlyInString: programa de prueba; la sustitución la analiza Acorn.
    'const texto = String.raw`// literal /* literal */ ${1/* real */+2}`;',
    // biome-ignore lint/suspicious/noTemplateCurlyInString: programa de prueba con plantillas anidadas.
    'const texto = `fuera ${`dentro ${(() => {/* real */ return /[/*]/;})()}`}`;',
    `const numero = 1_000n; /* fuera */ const texto = "/* literal */ // literal";`,
    `import dato from './dato.js'; /* fuera */ export { dato };`,
    `const modulo = import('./fijo.js'); // fuera\nexport default modulo;`,
  ];
  for (const original of casos) {
    const publicado = javascriptPublicado(original, 'module');
    assert.deepEqual(astJavascript(publicado, 'module'), astJavascript(original, 'module'));
    assert.equal(javascriptPublicado(publicado, 'module'), publicado);
  }
  assert.equal(javascriptPublicado('const/*comentario*/x=1;', 'script'), 'const x=1;');
});

test('JS conserva cada terminador de línea y la conducta ASI de return y operadores', () => {
  const original = 'a/*x\r\ny\u2028z\u2029*/+b;//fin\n';
  assert.equal(javascriptPublicado(original, 'script'), 'a \r\n\u2028\u2029+b; \n');
  const asi = 'function prueba(){return/*\r\n*/{dato:1};}\n' + 'let a=1,b=2;a/*\u2028*/++b; [prueba(),a,b];';
  const publicado = javascriptPublicado(asi, 'script');
  assert.deepEqual(astJavascript(publicado, 'script'), astJavascript(asi, 'script'));
  assert.equal(JSON.stringify(runInNewContext(publicado)), JSON.stringify(runInNewContext(asi)));
});

test('JS conserva hashbang y avisos legales, y valida exactamente script o módulo', () => {
  const avisos = [
    '/*! aviso legal */',
    '//! aviso legal',
    '/* @license MIT */',
    '// @preserve este aviso',
    '/* Copyright 2026 Equipo de prueba */',
    '// SPDX-License-Identifier: MIT',
  ];
  for (const aviso of avisos) {
    const original = `${aviso}\n/* ordinario */const x=1;`;
    assert.equal(javascriptPublicado(original, 'script'), `${aviso}\n const x=1;`);
  }
  const hashbang = '#!/usr/bin/env node\r\nconst/* ordinario */x=1;';
  assert.equal(javascriptPublicado(hashbang, 'script'), '#!/usr/bin/env node\r\nconst x=1;');
  assert.throws(() => javascriptPublicado('export const x=1;', 'script'), SyntaxError);
  assert.throws(() => javascriptPublicado('return 1;', 'module'), SyntaxError);
  assert.throws(() => javascriptPublicado('function {', 'script'), SyntaxError);
  assert.doesNotThrow(() => javascriptPublicado('await import("./dato.js");', 'module'));
  assert.equal(javascriptPublicado('<!-- ordinario\nconst x=1;', 'script'), ' \nconst x=1;');
  assert.throws(() => javascriptPublicado('<!-- ordinario\nconst x=1;', 'module'), SyntaxError);
});

/** Serialización del árbol sin comentarios para cotejar texto, atributos, plantillas y estructura. */
function htmlSinComentarios(texto: string): string {
  const documento = analizarHtml(texto);
  const pendientes: DefaultTreeAdapterTypes.Node[] = [documento];
  for (let nodo = pendientes.pop(); nodo; nodo = pendientes.pop()) {
    if ('childNodes' in nodo) {
      nodo.childNodes = nodo.childNodes.filter((hijo) => !defaultTreeAdapter.isCommentNode(hijo));
      pendientes.push(...nodo.childNodes);
    }
    if ('content' in nodo) {
      pendientes.push(nodo.content);
    }
  }
  return serialize(documento);
}

test('HTML retira solo comentarios reales sin añadir espacios entre textos ni elementos', () => {
  const casos = [
    ['<span>a</span><!-- fuera --><span>b</span>', '<span>a</span><span>b</span>'],
    ['a<!-- fuera -->b', 'ab'],
    ['a <!-- fuera --> b', 'a  b'],
    ['<!doctype html><!-- fuera --><title>t</title><p>x</p>', '<!doctype html><title>t</title><p>x</p>'],
    ['<table><!-- fuera --><tr><td>a<!-- dentro -->b</td></tr></table>', '<table><tr><td>ab</td></tr></table>'],
    ['<svg><!-- fuera --><text>a</text></svg>', '<svg><text>a</text></svg>'],
    ['<!-- sin cierre', ''],
  ];
  for (const [original = '', esperado] of casos) {
    const publicado = htmlPublicado(original);
    assert.equal(publicado, esperado);
    assert.equal(htmlSinComentarios(publicado), htmlSinComentarios(original));
    assert.equal(htmlPublicado(publicado), publicado);
  }
});

test('HTML conserva bytes de atributos, script/style y texto crudo; recorre template.content', () => {
  const literales =
    '<div title="<!-- atributo -->" data-x=sin-comillas>' +
    '<script>const texto = "<!-- literal -->";</script>' +
    '<style>p::before { content: "<!-- literal -->"; }</style>' +
    '<textarea><!-- texto --></textarea><pre> a  b\n c </pre></div>';
  assert.equal(htmlPublicado(literales), literales);
  const plantilla = '<template><!-- fuera --><span>a</span><template><!-- dentro -->b</template></template>';
  const publicado = htmlPublicado(plantilla);
  assert.equal(publicado, '<template><span>a</span><template>b</template></template>');
  assert.equal(htmlSinComentarios(publicado), htmlSinComentarios(plantilla));
});

test('HTML conserva avisos legales y condicionales ocultos y revelados', () => {
  const protegidos = [
    '<!--! aviso legal -->',
    '<!-- @license MIT -->',
    '<!-- @preserve aviso -->',
    '<!-- Copyright 2026 Equipo de prueba -->',
    '<!-- SPDX-License-Identifier: MIT -->',
    '<!--[if IE]><p>Condicional</p><![endif]-->',
    '<!--[if !IE]><!--><p>Visible</p><!--<![endif]-->',
  ];
  for (const aviso of protegidos) {
    assert.equal(htmlPublicado(`${aviso}<!-- ordinario -->`), aviso);
  }
});

test('HTML rechaza recortes que formarían entidades o etiquetas nuevas', () => {
  for (const original of [
    '&am<!-- barrera -->p;',
    '&#x4<!-- barrera -->1;',
    '<<!-- barrera -->script>alert(1)</script>',
    '<!-- Copyright 2026 -->&am<!-- barrera -->p;',
    '<!--[if IE]><![endif]-->&am<!-- barrera -->p;',
  ]) {
    assert.throws(() => htmlPublicado(original), /cambia el árbol HTML/);
  }
});

function cssSinCompactar(texto: string): string {
  return transformSync(texto, {
    loader: 'css',
    legalComments: 'inline',
    minifyWhitespace: false,
    minifySyntax: false,
    minifyIdentifiers: false,
    charset: 'utf8',
  }).code;
}

test('CSS conserva selectores, nombres, urls, custom properties, calc y contenido de cadenas', () => {
  const original = `
/* ordinario */
.tarjeta::before {
  --nombre: "/* texto */ á";
  --respaldo: var(--otra, 1px  2px);
  --vacio: ;
  content: "// texto /* literal */";
  background: url("imagen con espacio.svg#marca");
  mask-image: url("data:image/svg+xml,<svg><!--texto--></svg>");
  width: calc(100% - var(--hueco, 2px));
  color: white;
}
@media (min-width: 40rem) { .tarjeta { margin: 0px 0px; } }
`;
  const publicado = cssPublicado(original);
  assert.equal(cssSinCompactar(publicado), cssSinCompactar(original));
  assert.match(publicado, /--nombre:\s*"\/\* texto \*\/ á"/);
  assert.match(publicado, /calc\(100% - var\(--hueco,\s*2px\)\)/);
  assert.ok(publicado.includes('color:white'));
  assert.ok(!publicado.includes('ordinario'));
  assert.equal(cssPublicado(publicado), publicado);
});

test('CSS conserva comentarios legales marcados en su posición y rechaza errores de sintaxis', () => {
  const original = '/*! Aviso legal */\np { color: red; }\n/* @license MIT */\na { color: blue; }';
  const publicado = cssPublicado(original);
  assert.ok(publicado.startsWith('/*! Aviso legal */'));
  assert.ok(publicado.includes('/* @license MIT */'));
  assert.ok(publicado.indexOf('p{') < publicado.indexOf('/* @license MIT */'));
  assert.ok(publicado.indexOf('/* @license MIT */') < publicado.indexOf('a{'));
  assert.throws(() => cssPublicado('p { content: "sin cierre; }'));
});

test('CSS conserva íntegra la entrada ante Copyright/SPDX, sin confundir sus cadenas con comentarios', () => {
  const casos = [
    '/* Copyright 2026 Equipo de prueba */\np { color: red; }',
    '/* SPDX-License-Identifier: MIT */\np { color: red; }',
    '/*! Copyright 2026 Equipo de prueba */\np { color: red; }',
    'p::before { content: "Copyright /* esto no es un comentario */"; }',
    'p { background: url("data:image/svg+xml,<svg>SPDX</svg>"); }',
  ];
  for (const original of casos) {
    assert.equal(cssPublicado(original), original);
  }
  assert.ok(cssPublicado('/* @preserve aviso */\np { color: red; }').includes('/* @preserve aviso */'));
});
