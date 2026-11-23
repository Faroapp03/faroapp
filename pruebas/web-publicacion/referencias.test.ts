import assert from 'node:assert/strict';
import { test } from 'node:test';
import { referenciasCss, referenciasJs, resolver, rutasDeSrcset } from '../../herramientas/web/referencias.ts';
import { PORTADA } from '../../src/plataforma/cabeceras-web.ts';
import { webAislada } from './web-aislada.ts';

function comprobar(archivos: Record<string, string>): string[] {
  return JSON.parse(
    webAislada(
      archivos,
      "import { comprobarReferencias } from './referencias.ts';\n" +
        `process.stdout.write(JSON.stringify(comprobarReferencias(${JSON.stringify(Object.keys(archivos))})));`,
    ),
  );
}

test('la navegación a raíz requiere la portada real; no convierte imports ni recursos en páginas', () => {
  const portada = PORTADA.slice(1);
  assert.deepEqual(
    comprobar({ 'p.html': '<a href="/#destino">Inicio</a>', [portada]: '<h1 id="destino">Inicio</h1>' }),
    [],
  );
  assert.deepEqual(comprobar({ 'app.webmanifest': '{"start_url":"/"}', [portada]: '<h1>Inicio</h1>' }), []);
  assert.ok(comprobar({ 'p.html': '<a href="/">Inicio</a>' }).length > 0);
  assert.ok(comprobar({ 'p.html': '<a href="/#ausente">Inicio</a>', [portada]: '<h1>Inicio</h1>' }).length > 0);
  assert.ok(comprobar({ 'scripts/a.js': "import '/';", [portada]: '<h1>Inicio</h1>' }).length > 0);
  assert.ok(comprobar({ 'base.css': 'p { background: url(/); }', [portada]: '<h1>Inicio</h1>' }).length > 0);
  assert.ok(comprobar({ 'p.html': '<img src="/" alt="">', [portada]: '<h1>Inicio</h1>' }).length > 0);
});

test('imports estáticos, export, dinámicos y Worker se siguen sin comentarios', () => {
  assert.deepEqual(
    referenciasJs(`import './a.js'; export { a } from './b.js'; import('./c.js');
new Worker(urlDeGuion(new URL('./w.js', import.meta.url))); // import './no.js';`),
    ['./a.js', './b.js', './c.js', './w.js'],
  );
});

test('HTML, CSS, manifiesto, IDs y módulos relativos se resuelven desde una copia portable', () => {
  assert.deepEqual(
    comprobar({
      'p.html': '<p id="x"></p><a href="p.html#x"></a><script src="scripts/a.js"></script><link href="base.css">',
      'scripts/a.js': "export { x } from '../scripts/b.js';",
      'scripts/b.js': 'export const x = 1;',
      'base.css': 'p { background: url(a.png); }',
      'app.webmanifest': '{"start_url":"p.html","icons":[{"src":"a.png"}]}',
      'a.png': '',
    }),
    [],
  );
});

test('rutas ausentes, consultas y fragmentos HTML inexistentes se rechazan', () => {
  for (const referencia of ['falta.png', 'a.png?otra', 'p.html#falta']) {
    assert.ok(comprobar({ 'p.html': `<a href="${referencia}"></a>`, 'a.png': '' }).length > 0, referencia);
  }
});

test('resolver distingue raíz web y carpeta relativa, conservando normalización y rechazo de consultas', () => {
  assert.equal(resolver('administracion/index.html', '/administracion/panel.js'), 'administracion/panel.js');
  assert.equal(resolver('administracion/index.html', './panel.js'), 'administracion/panel.js');
  assert.equal(resolver('administracion/index.html', '../scripts/a.js'), 'scripts/a.js');
  assert.equal(resolver('administracion/index.html', '../../fuera.js'), '../fuera.js');
  assert.equal(resolver('administracion/index.html', '/../fuera.js'), '../fuera.js');
  assert.deepEqual(
    comprobar({
      'administracion/index.html': '<script src="/administracion/panel.js"></script><a href="/p.html#x">Ir</a>',
      'administracion/panel.js': '',
      'p.html': '<p id="x">Destino</p>',
    }),
    [],
  );
  assert.ok(
    comprobar({ 'administracion/index.html': '<script src="/administracion/panel.js?otra"></script>' }).some(
      (problema) => problema.includes('lleva una consulta'),
    ),
  );
});

test('un import bare sin alias no se confunde con un archivo relativo existente', () => {
  assert.ok(comprobar({ 'scripts/a.js': "import 'b.js';", 'scripts/b.js': '' }).length > 0);
});

test('texto de diccionario que termina en import no crea una dependencia', () => {
  assert.deepEqual(referenciasJs("const textos = ['import', 'texto'];"), []);
});

test('comentarios y texto de plantillas no se interpretan como imports ejecutados', () => {
  assert.deepEqual(referenciasJs("// import './comentario.js';\nconst t = `import './texto.js';`;"), []);
});

test('imports ejecutables dentro de sustituciones de plantilla conservan su alcance', () => {
  const casos = [
    `const t = \`\${import('./a.js')}\`;`,
    `const t = \`\${\`anidada \${import('./a.js')}\`}\`;`,
    `const t = \`\${(() => { /* } { \` */ return import('./a.js'); })()}\`;`,
    `const t = \`\${/}/.test('}') ? import('./a.js') : ''}\`;`,
  ];
  for (const codigo of casos) {
    assert.deepEqual(referenciasJs(codigo), ['./a.js'], codigo);
  }
});

test('CSS detecta imports minificados y URL sin interpretar comentarios o texto', () => {
  const css = `/* url(fantasma.png) @import 'fantasma.css'; */
    @import"ausente.css"; @import url('presente.css');
    .x { background-image: image-set("uno.png" 1x, url('dos.png') 2x); content: "url(falso.png)"; }`;
  assert.deepEqual(referenciasCss(css), ['ausente.css', 'presente.css', 'uno.png', 'dos.png']);
  assert.ok(comprobar({ 'p.css': '@import"ausente.css";' }).some((error) => error.includes('ausente.css')));
});

test('referencias CSS embebidas y direcciones porcentuales se comprueban como archivos locales', () => {
  assert.deepEqual(
    comprobar({
      'p.html': '<style>.x{background:url("a%20b.png")}</style><i style="background:url(a%20b.png)"></i>',
      'a b.png': '',
    }),
    [],
  );
  assert.ok(
    comprobar({ 'p.html': '<style>.x{background:url(ausente.png)}</style>' }).some((error) =>
      error.includes('ausente.png'),
    ),
  );
});

test('imports y URL CSS admiten comentarios y escapes de cadena sin inventar referencias', () => {
  assert.deepEqual(referenciasCss(`@import/**/"archivo.css"; .x{ background: url("a\\20 b.png") }`), [
    'archivo.css',
    'a b.png',
  ]);
  assert.ok(comprobar({ 'p.css': '@import/**/"ausente.css";' }).some((error) => error.includes('ausente.css')));
  assert.ok(comprobar({ 'p.html': '<img src="%invalido">' }).some((error) => error.includes('codificación inválida')));
});

test('atributos de recursos, formularios y metadatos con dirección verifican destinos', () => {
  for (const pagina of [
    '<form action="falta.html"></form>',
    '<object data="falta.svg"></object>',
    '<link imagesrcset="falta.png 1x">',
    '<meta property="og:image" content="falta.png">',
    '<meta http-equiv="refresh" content="0; url=falta.html">',
  ]) {
    assert.ok(comprobar({ 'p.html': pagina }).length > 0, pagina);
  }
  assert.deepEqual(comprobar({ 'p.html': '<meta name="description" content="texto ordinario">' }), []);
});

test('new URL literal con import.meta.url verifica archivos sin confundir directorios o texto', () => {
  assert.deepEqual(
    referenciasJs(`const a = new URL('./foto.png', import.meta.url); const b = new URL('../', import.meta.url);
      const texto = "new URL('./fantasma.png', import.meta.url)"; // new URL('./otro.png', import.meta.url)`),
    ['./foto.png'],
  );
  assert.ok(
    comprobar({ 'scripts/a.js': "new URL('./falta.png', import.meta.url)" }).some((error) =>
      error.includes('falta.png'),
    ),
  );
});

test('CSS url sin comillas reconoce escapes y srcset conserva comas de data', () => {
  assert.deepEqual(referenciasCss(String.raw`x{background:url(a\29 b.png),url(a\)b.png)}`), ['a)b.png', 'a)b.png']);
  assert.deepEqual(rutasDeSrcset('data:image/png;base64,AAAA 1x, /foto.png 2x'), [
    'data:image/png;base64,AAAA',
    '/foto.png',
  ]);
});

test('una página con base explícita falla con diagnóstico en lugar de resolver desde un directorio equivocado', () => {
  const errores = comprobar({ 'p.html': '<base href="/sub/"><img src="foto.png">', 'sub/foto.png': '' });
  assert.ok(errores.some((error) => error.includes('base no admitida')));
});

test('una hoja minificada por esbuild conserva comprobación del import', async () => {
  const { transform } = await import('esbuild');
  const { code } = await transform('@import url("falta.css");', { loader: 'css', minify: true });
  assert.ok(comprobar({ 'estilos/p.css': code }).some((error) => error.includes('falta.css')));
});

test('recursos literales con consulta o fragmento no escapan al control de referencias', () => {
  const consulta = "new URL('./ausente.js?v=1', import.meta.url)";
  const ambos = "new URL('./ausente.js?v=1#seccion', import.meta.url)";
  const fragmento = "new URL('./ausente.js#seccion', import.meta.url)";
  assert.deepEqual(referenciasJs(`${consulta}; ${ambos}; ${fragmento}`), [
    './ausente.js?v=1',
    './ausente.js?v=1#seccion',
    './ausente.js#seccion',
  ]);
  for (const codigo of [consulta, ambos]) {
    assert.ok(comprobar({ 'scripts/a.js': codigo }).some((error) => error.includes('lleva una consulta')));
  }
  assert.ok(comprobar({ 'scripts/a.js': fragmento }).some((error) => error.includes('ausente.js')));
});
