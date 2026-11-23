import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { type DefaultTreeAdapterTypes, parseFragment } from 'parse5';
import { construirInforme } from '../../src/dominio/informe.ts';
import { construirInformeBreve } from '../../src/dominio/informe-breve.ts';
import { cargarDatos } from '../../src/plataforma/node/datos.ts';
import { tareasConsultables } from '../../src/presentacion/informe-breve/consulta-tareas.ts';
import { renderizarInformeBreve } from '../../src/presentacion/informe-breve.ts';

type Nodo = DefaultTreeAdapterTypes.Node;
type Elemento = DefaultTreeAdapterTypes.Element;
const DATOS = cargarDatos(fileURLToPath(new URL('../../datos/', import.meta.url)));
const MAXIMO = 30;
const LETRAS = 300;
const REPETICIONES = 6;
const TAREAS_OFICIALES = 8;
const NOTA_MAYOR = 71;
const NOTA_MENOR = 39;
/** En el caso con notas de Faro, una de cada tantas tareas es una estimación de Faro. */
const CADA_CUANTAS_DE_FARO = 3;

function conClase(nodo: Nodo, clase: string): Elemento[] {
  const propios =
    'tagName' in nodo && nodo.attrs.some(({ name, value }) => name === 'class' && value.split(' ').includes(clase))
      ? [nodo]
      : [];
  return [...propios, ...('childNodes' in nodo ? nodo.childNodes.flatMap((hijo) => conClase(hijo, clase)) : [])];
}
/** Las celdas de cada fila del cuerpo de la tabla, en orden. */
function filasDelCuerpo(nodo: Nodo): string[][] {
  const deEtiqueta = (raiz: Nodo, etiqueta: string): Elemento[] =>
    'childNodes' in raiz
      ? raiz.childNodes.flatMap((hijo) => [
          ...('tagName' in hijo && hijo.tagName === etiqueta ? [hijo] : []),
          ...deEtiqueta(hijo, etiqueta),
        ])
      : [];
  return deEtiqueta(nodo, 'tbody')
    .flatMap((cuerpo) => deEtiqueta(cuerpo, 'tr'))
    .map((fila) => fila.childNodes.filter((celda) => 'tagName' in celda).map(contenido));
}
function contenido(nodo: Nodo): string {
  if ('value' in nodo) {
    return nodo.value;
  }
  return 'childNodes' in nodo ? nodo.childNodes.map(contenido).join('') : '';
}
function caso(idioma: 'es' | 'ca', conNota: boolean, repetidos = false) {
  const informe = construirInforme(
    {
      isco08: '4110',
      fecha: '2026-10-23',
      sinIa: true,
      tareas: Array.from({ length: MAXIMO }, (_, i) => ({
        id: `t${i}`,
        texto: repetidos
          ? 'El mismo nombre confirmado'
          : `Tarea ${i}: ${'Comprobar personalmente documentos y explicar las decisiones. '.repeat(REPETICIONES)}`.slice(
              0,
              LETRAS,
            ),
        tiempo: 'mucho' as const,
        ...(conNota
          ? { referencia: { tareaOit: `4110-${(i % TAREAS_OFICIALES) + 1}`, relacion: 'propia' as const } }
          : {}),
      })),
    },
    DATOS,
    { idioma, formacion: null },
  );
  const breve = construirInformeBreve(informe, DATOS);
  return { informe, breve };
}
/** No queda ninguna pieza que solo apareciera al imprimir en lugar de otra ni el aviso de nombres abreviados. */
function sinSustitutosDeImpresion(html: Nodo, idioma: 'es' | 'ca') {
  for (const clase of [
    'ib-aviso-sintesis',
    'ib-leyenda-sintesis',
    'ib-ordinal',
    'ib-margen-impreso',
    'ib-nota-impresa',
    'ib-referencia-impresa',
    'ib-serie-impresa',
  ]) {
    assert.equal(conClase(html, clase).length, 0, clase);
  }
  assert.ok(!contenido(html).includes(idioma === 'es' ? 'puntos suspensivos' : 'punts suspensius'));
}
/** El gráfico que se ve en pantalla es el que se imprime, con sus años y sus cifras escritos. */
function graficoConSusCifras(html: Nodo, breve: ReturnType<typeof caso>['breve']) {
  const anual = breve.mercado.anual;
  assert.ok(anual);
  const grafico = conClase(html, 'ib-figura-ancha')[0];
  assert.ok(grafico);
  for (const etiqueta of anual.etiquetas) {
    assert.ok(contenido(grafico).includes(etiqueta));
  }
  for (const valor of anual.valores) {
    assert.ok(contenido(grafico).includes(valor.toLocaleString('es-ES', { useGrouping: 'always' })));
  }
}
for (const idioma of ['es', 'ca'] as const) {
  test(`el informe ${idioma} de 30 tareas lleva en su hoja los nombres íntegros, tiempos y notas, y su consulta íntegra`, () => {
    const { informe, breve } = caso(idioma, true);
    const html = parseFragment(renderizarInformeBreve(breve, informe));
    const hojas = conClase(html, 'hoja');
    assert.equal(hojas.length, 2);
    assert.equal(conClase(html, 'ib-tarea').length, MAXIMO);
    const consultables = tareasConsultables(breve, informe);
    // Los nombres de la hoja son los mismos textos de la consulta, enteros y en el mismo orden: nada se abrevia.
    assert.deepEqual(
      conClase(hojas[0] as Elemento, 'ib-tarea-nombre').map(contenido),
      consultables.map(({ texto }) => texto),
    );
    for (const tarea of informe.tareas) {
      assert.ok(contenido(hojas[0] as Elemento).includes(tarea.texto));
    }
    const consulta = conClase(html, 'ib-consulta-tareas')[0];
    assert.ok(consulta);
    for (const tarea of informe.tareas) {
      assert.ok(contenido(consulta).includes(tarea.texto));
    }
    // Fila a fila: número, tarea entera y su margen, en el orden de la hoja.
    const filas = filasDelCuerpo(consulta);
    assert.equal(filas.length, MAXIMO);
    for (const [indice, { margen, texto }] of consultables.entries()) {
      assert.ok(margen);
      assert.ok(contenido(consulta).includes(margen));
      assert.equal(filas[indice]?.[0], String(indice + 1));
      assert.equal(filas[indice]?.[1], texto);
      assert.match(
        filas[indice]?.[4] ?? '',
        new RegExp(`^${margen.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}( · |$)`, 'u'),
      );
    }
    assert.deepEqual(
      conClase(html, 'ib-tarea-tiempo').map(contenido),
      Array.from({ length: MAXIMO }, () => (idioma === 'es' ? 'Mucho' : 'Molt')),
    );
    assert.deepEqual(
      conClase(html, 'ib-tarea-valor').map(contenido),
      consultables.map(({ tarea }) => String(tarea.valor)),
    );
    sinSustitutosDeImpresion(html, idioma);
    graficoConSusCifras(html, breve);
    assert.ok(conClase(html, 'ib-fuentes').length);
  });
  test(`con notas de Faro ${idioma}, el nombre de cada tarea sigue siendo el texto de la consulta y las marcas van aparte`, () => {
    const { informe } = caso(idioma, true);
    // Una de cada tres tareas pasa a estimación de Faro, y la mitad de ellas son inciertas.
    for (const [indice, tarea] of informe.tareas.entries()) {
      if (indice % CADA_CUANTAS_DE_FARO === 0) {
        tarea.evidencia = 'estimacion-faro';
        tarea.incierta = indice % (2 * CADA_CUANTAS_DE_FARO) === 0;
      }
    }
    const breve = construirInformeBreve(informe, DATOS);
    const html = parseFragment(renderizarInformeBreve(breve, informe));
    const hoja = conClase(html, 'hoja')[0] as Elemento;
    const consultables = tareasConsultables(breve, informe);
    assert.deepEqual(
      conClase(hoja, 'ib-tarea-nombre').map(contenido),
      consultables.map(({ texto }) => texto),
    );
    const deFaro = breve.tareas.filter((tarea) => tarea.origen === 'faro');
    assert.equal(deFaro.length, MAXIMO / CADA_CUANTAS_DE_FARO);
    const celdas = conClase(hoja, 'ib-tarea-celda');
    assert.equal(celdas.length, deFaro.length);
    assert.equal(conClase(hoja, 'ib-tarea-marcas').length, deFaro.length);
    for (const celda of celdas) {
      assert.equal(conClase(celda, 'ib-tarea-nombre').length, 1);
      assert.match(
        contenido(conClase(celda, 'ib-tarea-marcas')[0] as Elemento),
        idioma === 'es' ? /^Cálculo de Faro/u : /^Càlcul de Faro/u,
      );
    }
    assert.equal(
      conClase(hoja, 'ib-tarea-marcas').filter((marca) => /Incierta|Incerta/u.test(contenido(marca))).length,
      breve.tareas.filter((tarea) => tarea.incierta).length,
    );
  });
  test(`30 tareas sin nota ${idioma} conservan explícitamente su ausencia de dato`, () => {
    const { informe, breve } = caso(idioma, false);
    const html = parseFragment(renderizarInformeBreve(breve, informe));
    assert.equal(conClase(html, 'ib-sin-nota').length, MAXIMO);
    assert.ok(
      conClase(html, 'ib-sin-nota').every((nodo) => contenido(nodo) === (idioma === 'es' ? 'Sin nota' : 'Sense nota')),
    );
    assert.equal(conClase(html, 'ib-tarea').length, MAXIMO);
    assert.deepEqual(
      conClase(html, 'ib-tarea-valor').map(contenido),
      Array.from({ length: MAXIMO }, () => '—'),
    );
  });
}

test('nombres repetidos conservan las ocurrencias y su orden aun tras serializar el breve', () => {
  const { informe, breve } = caso('es', true, true);
  const consultables = tareasConsultables(breve, informe);
  assert.equal(consultables.length, MAXIMO);
  assert.equal(consultables[0]?.tarea.valor, NOTA_MAYOR);
  assert.equal(consultables.at(-1)?.tarea.valor, NOTA_MENOR);
  const serializado = structuredClone(breve);
  const html = parseFragment(renderizarInformeBreve(serializado, informe));
  assert.deepEqual(conClase(html, 'ib-menos-nombre').map(contenido), [
    'El mismo nombre confirmado',
    'El mismo nombre confirmado',
  ]);
  assert.deepEqual(
    conClase(html, 'ib-tarea-valor').map(contenido),
    consultables.map(({ tarea }) => String(tarea.valor)),
  );
});
