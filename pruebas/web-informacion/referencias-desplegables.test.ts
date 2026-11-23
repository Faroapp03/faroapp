// Las listas de referencias de las guías (Qué es la IA, Qué es Faro) van en un desplegable nativo cerrado, con el
// mismo aspecto que las Fuentes de Datos globales: el título en el resumen, sin `open` y con la hoja común.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const WEB = new URL('../../web/', import.meta.url);
const leer = (ruta: string) => readFileSync(new URL(ruta, WEB), 'utf8');
/** Las referencias de cada guía. */
const REFERENCIAS_IA = 8;
const REFERENCIAS_FARO = 5;
const PAGINAS = [
  ['entender-ia.html', 'entender-ia.referencias.titulo', REFERENCIAS_IA],
  ['que-es-faro.html', 'comun.referencias', REFERENCIAS_FARO],
] as const;

test('las referencias están dentro de un <details> cerrado, con su título en el resumen', () => {
  for (const [archivo, clave, total] of PAGINAS) {
    const html = leer(archivo);
    const seccion = /<section class="bloque referencias"[^>]*>([\s\S]*?)<\/section>/u.exec(html)?.[1] ?? '';
    const abre = /<details class="desplegable"([^>]*)>/u.exec(seccion);
    assert.ok(abre, `${archivo}: las referencias van en un desplegable`);
    assert.doesNotMatch(abre[1] ?? '', /\bopen\b/u, `${archivo}: cerrado al cargar`);
    assert.match(
      seccion,
      new RegExp(
        `<summary class="desplegable-resumen"\\s*>\\s*<h2 id="t-referencias" data-texto="${clave.replace('.', '\\.')}">Referencias</h2>\\s*</summary`,
        'u',
      ),
      `${archivo}: el título «Referencias» va en el resumen`,
    );
    const cuerpo = /<div class="desplegable-cuerpo">([\s\S]*?)<\/details>/u.exec(seccion)?.[1] ?? '';
    assert.equal([...cuerpo.matchAll(/<li id="ref-\d+"/gu)].length, total, `${archivo}: toda la lista está dentro`);
    assert.equal([...html.matchAll(/<details class="desplegable"/gu)].length, 1, archivo);
    assert.match(html, /href="estilos\/contenidos\.css"/u, `${archivo}: carga la hoja común`);
  }
});

test('el desplegable es común: Datos globales y las referencias comparten hoja, y el foco y el «+» / «−» existen', () => {
  const comun = leer('estilos/contenidos.css');
  assert.match(comun, /\.desplegable-resumen,\n\.dg-desplegable-resumen \{\n\s*display: flex;/u);
  assert.match(
    comun,
    /\.desplegable-resumen:focus-visible,\n\.dg-desplegable-resumen:focus-visible \{\n\s*outline: var\(--foco\);/u,
  );
  assert.match(comun, /\.desplegable-resumen::after,\n\.dg-desplegable-resumen::after \{[^}]*content: "\+";/u);
  assert.match(
    comun,
    /\.desplegable\[open\] > \.desplegable-resumen::after,\n\.dg-desplegable\[open\] > \.dg-desplegable-resumen::after \{\n\s*content: "−";/u,
  );
  assert.match(
    comun,
    /@media print \{\n\s*\.desplegable:not\(\[open\]\)::details-content \{\n\s*content-visibility: visible;/u,
  );
  assert.doesNotMatch(comun, /animation|transition/u);
  const propia = leer('estilos/datos-globales.css');
  assert.doesNotMatch(propia, /\.dg-desplegable-resumen \{/u, 'lo común no se repite en datos-globales.css');
  for (const archivo of ['datos-globales.html', 'datos-globales-ue.html']) {
    const html = leer(archivo);
    assert.ok(
      html.indexOf('estilos/contenidos.css') < html.indexOf('estilos/datos-globales.css'),
      `${archivo}: la hoja común va antes que la propia`,
    );
  }
});
