import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { type DefaultTreeAdapterTypes, parseFragment } from 'parse5';
import { caso } from '../ayudas/informe-contexto.ts';

type Nodo = DefaultTreeAdapterTypes.Node;
type Elemento = DefaultTreeAdapterTypes.Element;
function textoDe(nodo: Nodo): string {
  if ('value' in nodo) {
    return nodo.value;
  }
  return 'childNodes' in nodo ? nodo.childNodes.map(textoDe).join('') : '';
}
function conClase(nodo: Nodo, clase: string): Elemento[] {
  const coincide =
    'tagName' in nodo && nodo.attrs.some((a) => a.name === 'class' && a.value.split(' ').includes(clase));
  return [
    ...(coincide ? [nodo] : []),
    ...('childNodes' in nodo ? nodo.childNodes.flatMap((n) => conClase(n, clase)) : []),
  ];
}

test('pantalla conserva consultas y gráfico; el papel incluye la tabla anual equivalente', () => {
  const css = readFileSync(new URL('../../web/estilos/informe-breve.css', import.meta.url), 'utf8');
  assert.match(
    css,
    /@media\s+print\s*\{\s*\.informe-breve\s+\.ib-contexto,\s*\.informe-breve\s+\.ib-figura-ancha\s*\{\s*display:\s*none/u,
  );
  assert.match(css, /\.informe-breve\s+\.ib-serie-papel\s*\{\s*display:\s*block/u);
  for (const idioma of ['es', 'ca'] as const) {
    const { html: marcado, breve } = caso(undefined, idioma);
    const anual = breve.mercado.anual;
    assert.ok(anual);
    const html = parseFragment(marcado);
    const tabla = conClase(html, 'ib-serie-papel')[0];
    const grafico = conClase(html, 'ib-figura-ancha')[0];
    assert.ok(tabla && grafico);
    for (const etiqueta of anual.etiquetas) {
      assert.ok(textoDe(tabla).includes(etiqueta));
      assert.ok(textoDe(grafico).includes(etiqueta));
    }
    for (const [indice, valor] of anual.valores.entries()) {
      const cifra = valor.toLocaleString('es-ES', { useGrouping: 'always' });
      assert.ok(textoDe(tabla).includes(`${cifra}${anual.publicado[indice] ? '' : '*'}`));
      assert.ok(textoDe(grafico).includes(cifra));
    }
  }
});
