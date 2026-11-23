import assert from 'node:assert/strict';
import { test } from 'node:test';
import { colocarInforme, informeDelEjemplo } from '../../herramientas/web/informe-ejemplo.ts';

function encabezados(html: string): number[] {
  return [...html.matchAll(/<h([1-6])\b/g)].map((m) => Number(m[1]));
}

for (const idioma of ['es', 'ca'] as const) {
  test(`el ejemplo ${idioma} tiene un título principal y encabezados sin saltos`, () => {
    const html = informeDelEjemplo(idioma);
    const niveles = encabezados(html);
    assert.equal(niveles[0], 1);
    assert.equal(niveles.filter((nivel) => nivel === 1).length, 1);
    for (let i = 1; i < niveles.length; i += 1) {
      assert.ok((niveles[i] ?? 0) <= (niveles[i - 1] ?? 0) + 1, niveles.join(', '));
    }
    assert.equal([...html.matchAll(/<section class="hoja /g)].length, 2);
  });
}

test('el mismo caso ficticio tiene textos catalanes explícitos y conserva todas las cifras', () => {
  const es = informeDelEjemplo('es');
  const ca = informeDelEjemplo('ca');
  assert.match(ca, /class="informe-breve" lang="ca"/);
  assert.match(ca, /La teva feina i la IA/);
  assert.match(ca, /Concertar cites per als pacients/);
  assert.match(ca, /Calmar pacients nerviosos o enfadats/);
  assert.doesNotMatch(ca, /Concertar citas|Calmar a pacientes|Tus tareas|El mercado laboral/);
  // La línea de papel (ib-tareas-fuera) cuenta cuántas tareas caben en la hoja impresa y eso depende de la longitud de
  // los textos de cada idioma: no es una cifra del informe.
  const cifras = (html: string) =>
    html
      .replace(/<p class="ib-tareas-fuera">[^<]*<\/p>/g, '')
      .replace(/<[^>]*>/g, '')
      .match(/\d+(?:[.,]\d+)*/g);
  assert.deepEqual(cifras(ca), cifras(es));
});

test('la publicación conserva una sola página activa y la versión catalana inerte, sin acumularla al regenerar', () => {
  const pagina = 'antes<main id="contenido" class="informe-breve">viejo</main>después';
  const es = informeDelEjemplo('es');
  const ca = informeDelEjemplo('ca');
  const generado = colocarInforme(pagina, es, ca);
  assert.match(generado, /<template id="informe-ejemplo-ca">/);
  assert.ok(generado.startsWith('antes'));
  assert.ok(generado.endsWith('después'));
  assert.equal(colocarInforme(generado, es, ca), generado);
  const formateado =
    'antes<main id="contenido"></main>\n    <template id="informe-ejemplo-ca"\n      ><main>Anterior</main></template\n    >después';
  assert.equal(colocarInforme(formateado, es, ca), generado);
  assert.throws(() => colocarInforme('sin informe', es, ca), /main completo/);
});
