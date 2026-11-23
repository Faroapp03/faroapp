// Procedencia de lo que dice el informe breve: de quién es cada nota (OIT o Faro), las cifras y citas que salen del
// registro de hechos, los estados que dependen de la fecha del informe y las divisiones sin denominador.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  CAPACIDAD_DE_LA_IA,
  FUENTES_GENERALES,
  HECHOS_DEL_INFORME,
  NORMAS_DE_ALTO_RIESGO,
} from '../../src/dominio/hechos-del-informe-breve.ts';
import { construirInforme } from '../../src/dominio/informe.ts';
import { construirInformeBreve } from '../../src/dominio/informe-breve.ts';
import type { ExposicionBreve } from '../../src/dominio/tipos-informe-breve.ts';
import type { Datos } from '../../src/dominio/tipos-paquete.ts';
import { cargarDatos } from '../../src/plataforma/node/datos.ts';
import { textoRegistrado } from '../../src/presentacion/informe-breve/idioma.ts';
import { motivoDeLaExposicion } from '../../src/presentacion/informe-breve/textos.ts';
import { renderizarInformeBreve } from '../../src/presentacion/informe-breve.ts';

const datos = cargarDatos(fileURLToPath(new URL('../../datos/', import.meta.url)));
const css = readFileSync(new URL('../../web/estilos/informe-breve.css', import.meta.url), 'utf8');
const DESPUES_DE_APLICARSE = '2027-12-03';
/** Cuántas tareas de `informeDe` pasan a estimación de Faro en cada caso de procedencia. */
const DE_FARO = { oit: 0, mixta: 1, faro: 3 } as const;

function informeDe(idioma: 'es' | 'ca', paquete: Datos = datos) {
  return construirInforme(
    {
      isco08: '4110',
      fecha: '2026-10-23',
      tareas: [
        {
          id: 't1',
          texto: 'Comprobar documentos',
          tiempo: 'mucho',
          referencia: { tareaOit: '4110-1', relacion: 'propia' },
        },
        {
          id: 't2',
          texto: 'Archivar expedientes',
          tiempo: 'poco',
          referencia: { tareaOit: '4110-2', relacion: 'propia' },
        },
        {
          id: 't3',
          texto: 'Atender llamadas',
          tiempo: 'algo',
          referencia: { tareaOit: '4110-3', relacion: 'propia' },
        },
      ],
    },
    paquete,
    { idioma, formacion: null },
  );
}

/** El párrafo de «En pocas palabras». */
function enPocasPalabras(html: string): string {
  return /<section class="ib-bluf"[\s\S]*?<\/section>/u.exec(html)?.[0] ?? '';
}

/** La frase de «Tus tareas menos expuestas». */
function deLasMenosExpuestas(html: string): string {
  return /<ul class="ib-menos">[\s\S]*?<\/ul>\s*<p class="ib-texto">([^<]*)<\/p>/u.exec(html)?.[1] ?? '';
}

/** La leyenda de «Tus tareas, una a una». */
function leyenda(html: string): string {
  return /<p class="ib-leyenda-tareas">[\s\S]*?<\/p>/u.exec(html)?.[0] ?? '';
}

for (const idioma of ['es', 'ca'] as const) {
  const es = idioma === 'es';

  test(`${idioma}: con todas las notas de la OIT, la frase, la leyenda y las filas solo nombran a la OIT`, () => {
    const informe = informeDe(idioma);
    const breve = construirInformeBreve(informe, datos);
    assert.ok(breve.tareas.length > 0 && breve.tareas.every((tarea) => tarea.origen === 'oit' && !tarea.incierta));
    assert.equal(breve.exposicion?.estimadasPorFaro, 0);
    const html = renderizarInformeBreve(breve, informe);
    assert.match(enPocasPalabras(html), es ? /según el índice de la OIT/u : /segons l’índex de l’OIT/u);
    assert.doesNotMatch(html, /ib-tarea-marcas/u);
    assert.doesNotMatch(leyenda(html), /data-tipo="faro"/u);
    assert.match(leyenda(html), /data-tipo="estudio"><b>[^<]+<\/b> OIT, 2025/u);
  });

  test(`${idioma}: una nota de Faro no se atribuye a la OIT y lleva su sello y su marca de incierta en la fila`, () => {
    const informe = informeDe(idioma);
    const estimada = informe.tareas[0];
    assert.ok(estimada && estimada.valor !== null);
    estimada.evidencia = 'estimacion-faro';
    estimada.incierta = true;
    const breve = construirInformeBreve(informe, datos);
    const fila = breve.tareas.find((tarea) => tarea.nombre === estimada.nombre);
    assert.deepEqual([fila?.origen, fila?.incierta], ['faro', true]);
    assert.equal(breve.exposicion?.estimadasPorFaro, 1);
    const html = renderizarInformeBreve(breve, informe);
    const frase = enPocasPalabras(html);
    assert.doesNotMatch(frase, /índice de la OIT|índex de l’OIT/u);
    assert.match(frase, es ? /según la OIT y la estimación de Faro/u : /segons l’OIT i l’estimació de Faro/u);
    const marcas = /<span class="ib-tarea-marcas">([\s\S]*?)<\/span><\/span>/u.exec(html)?.[1] ?? '';
    assert.match(marcas, /data-tipo="faro"/u);
    assert.match(marcas, es ? /Incierta/u : /Incerta/u);
    assert.equal(html.match(/class="ib-tarea-marcas"/gu)?.length, 1);
    assert.match(leyenda(html), /data-tipo="estudio"[\s\S]*data-tipo="faro"/u);
    estimada.incierta = false;
    const otra = informeDe(idioma);
    for (const tarea of otra.tareas) {
      tarea.evidencia = 'estimacion-faro';
    }
    const soloFaro = renderizarInformeBreve(construirInformeBreve(otra, datos), otra);
    assert.doesNotMatch(leyenda(soloFaro), /data-tipo="estudio"/u);
    assert.match(leyenda(soloFaro), /data-tipo="faro"/u);
  });

  test(`${idioma}: la tarjeta explica la finalización de tareas y conserva la cifra, la fuente y la confianza del estudio`, () => {
    const informe = informeDe(idioma);
    const breve = construirInformeBreve(informe, datos);
    const html = renderizarInformeBreve(breve, informe);
    const porcentaje = Math.round(HECHOS_DEL_INFORME.afirmaciones.capacidad.porcentaje);
    assert.equal(breve.capacidad.deCada100, porcentaje);
    const tarjeta = html.split('<li class="ib-juicio">').at(-1) ?? '';
    const parrafo = /<\/figure><p>(.*?)<\/p>/u.exec(tarjeta)?.[1]?.replace(/<[^>]+>/gu, '') ?? '';
    assert.ok(parrafo.includes(`${porcentaje} %`));
    assert.match(parrafo, es ? /Solo contaba el resultado final\./u : /Puntuava el resultat final\./u);
    assert.ok(
      parrafo.length <=
        'La media de tus tareas es 52 de 100. Las tareas a las que dedicas más tiempo pesan más en el cálculo.'.length,
    );
    assert.doesNotMatch(parrafo, /\b(?:min|hora|horas|hores|experto|expert)\b/u);
    assert.equal(breve.capacidad.confianza, CAPACIDAD_DE_LA_IA.confianza);
    assert.match(
      html,
      new RegExp(`data-tipo="estudio"><b>[^<]+</b> ${FUENTES_GENERALES.osworld}, ${breve.capacidad.anio}<`, 'u'),
    );
    // La conclusión de la capacidad es la última de la lista.
    assert.equal(/class="ib-conf" data-nivel="(\w+)"/u.exec(tarjeta)?.[1], CAPACIDAD_DE_LA_IA.confianza);
  });

  test(`${idioma}: la cita de las normas sale del registro y solo se admite traducida`, () => {
    const informe = informeDe(idioma);
    const html = renderizarInformeBreve(construirInformeBreve(informe, datos), informe);
    const fuentes = /<p class="ib-fuentes">[\s\S]*?<\/p>/u.exec(html)?.[0] ?? '';
    assert.ok(fuentes.includes(textoRegistrado(idioma, FUENTES_GENERALES.normas)));
    assert.ok(fuentes.includes(es ? FUENTES_GENERALES.normas : 'Reglament (UE) 2024/1689 i 2026/1744'));
    assert.throws(() => textoRegistrado(idioma, 'Reglamento (UE) 2099/1'), /no tiene traducción/u);
  });

  test(`${idioma}: la exposición y las menos expuestas nombran a la OIT, a la OIT y a Faro o solo a Faro`, () => {
    const esperadas: Readonly<Record<keyof typeof DE_FARO, readonly [frase: string, menos: string]>> = {
      oit: es
        ? ['según el índice de la OIT', 'Según la OIT, son las que']
        : ['segons l’índex de l’OIT', 'Segons l’OIT, són les que'],
      mixta: es
        ? ['según la OIT y la estimación de Faro', 'Según la OIT y la estimación de Faro, son']
        : ['segons l’OIT i l’estimació de Faro', 'Segons l’OIT i l’estimació de Faro, són'],
      faro: es
        ? ['según la estimación de Faro, ponderado', 'Según la estimación de Faro, son las que']
        : ['segons l’estimació de Faro, ponderat', 'Segons l’estimació de Faro, són les que'],
    };
    for (const caso of ['oit', 'mixta', 'faro'] as const) {
      const informe = informeDe(idioma);
      // La tarea de menor nota pasa a Faro primero: así el caso mixto también llega a «menos expuestas».
      const porNota = informe.tareas.toSorted((a, b) => (a.valor ?? 0) - (b.valor ?? 0));
      for (const tarea of porNota.slice(0, DE_FARO[caso])) {
        tarea.evidencia = 'estimacion-faro';
      }
      const breve = construirInformeBreve(informe, datos);
      assert.equal(breve.exposicion?.estimadasPorFaro, DE_FARO[caso], caso);
      const html = renderizarInformeBreve(breve, informe);
      const [frase, menos] = esperadas[caso];
      assert.ok(enPocasPalabras(html).includes(frase), caso);
      assert.ok(deLasMenosExpuestas(html).startsWith(menos), caso);
      if (caso === 'faro') {
        assert.doesNotMatch(`${enPocasPalabras(html)} ${deLasMenosExpuestas(html)}`, /OIT/u);
      }
    }
  });

  test(`${idioma}: con todas las notas de Faro, la conclusión 01 no atribuye la escala a la OIT ni lleva su sello sin motivo`, () => {
    const conclusion01 = (html: string) => html.split('<li class="ib-juicio">')[1] ?? '';
    const selloOit = /data-tipo="estudio"><b>[^<]+<\/b> OIT, 2025/u;
    const deLaOit = es ? 'La OIT puntúa cada tarea de 0' : 'L’OIT puntua cada tasca de 0';
    const informe = informeDe(idioma);
    const conOit = conclusion01(renderizarInformeBreve(construirInformeBreve(informe, datos), informe));
    assert.ok(conOit.includes(deLaOit));
    assert.match(conOit, selloOit);
    for (const tarea of informe.tareas) {
      tarea.evidencia = 'estimacion-faro';
    }
    const breve = construirInformeBreve(informe, datos);
    assert.ok(breve.exposicion);
    const metodos = { coinciden: 3, total: 3, tercio: 'medio' } as const;
    const sinMetodos = conclusion01(
      renderizarInformeBreve({ ...breve, exposicion: { ...breve.exposicion, metodos: null } }, informe),
    );
    assert.ok(!sinMetodos.includes(deLaOit));
    assert.ok(
      sinMetodos.includes(
        es
          ? 'Faro estima cada tarea con los criterios de puntuación de la OIT, de 0 (la IA no puede hacerla) a 100'
          : 'Faro estima cada tasca amb els criteris de puntuació de l’OIT, de 0 (la IA no la pot fer) a 100',
      ),
    );
    assert.doesNotMatch(sinMetodos, selloOit);
    // Con métodos, la OIT es uno de ellos: queda su sello y la frase dice de qué es fuente.
    const conMetodos = conclusion01(
      renderizarInformeBreve({ ...breve, exposicion: { ...breve.exposicion, metodos } }, informe),
    );
    assert.match(conMetodos, selloOit);
    assert.ok(
      conMetodos.includes(
        es
          ? 'Los 3 métodos de medida que Faro ha comprobado, entre ellos el índice de la OIT, sitúan tu ocupación en la zona media.'
          : 'Els 3 mètodes de mesura que Faro ha comprovat, entre els quals l’índex de l’OIT, situen la teva ocupació a la zona mitjana.',
      ),
    );
  });

  test(`${idioma}: los motivos de confianza atribuyen el margen a quien dio las notas`, () => {
    const base: ExposicionBreve = {
      valor: 50,
      minimo: 40,
      maximo: 70,
      nivel: 'media',
      confianza: 'baja',
      motivo: 'margen-ancho',
      metodos: null,
      conNota: 2,
      sinNota: 0,
      estimadasPorFaro: 0,
    };
    const motivos = (estimadasPorFaro: number) =>
      (['margen-ancho', 'modelos'] as const).map((motivo) =>
        motivoDeLaExposicion({ ...base, motivo, estimadasPorFaro }, idioma),
      );
    assert.deepEqual(
      motivos(0),
      es
        ? ['los dos modelos de la OIT se separan mucho.', 'estimación de la OIT; sus dos modelos dan entre 40 y 70.']
        : ['els dos models de l’OIT s’allunyen molt.', 'estimació de l’OIT; els seus dos models donen entre 40 i 70.'],
    );
    assert.deepEqual(
      motivos(1),
      es
        ? [
            'el margen de las estimaciones de la OIT y de Faro es muy ancho.',
            'estimación de la OIT y de Faro; su margen va de 40 a 70.',
          ]
        : [
            'el marge de les estimacions de l’OIT i de Faro és molt ample.',
            'estimació de l’OIT i de Faro; el seu marge va de 40 a 70.',
          ],
    );
    assert.deepEqual(
      motivos(2),
      es
        ? ['el margen de las estimaciones de Faro es muy ancho.', 'estimación de Faro; su margen va de 40 a 70.']
        : ['el marge de les estimacions de Faro és molt ample.', 'estimació de Faro; el seu marge va de 40 a 70.'],
    );
  });

  test(`${idioma}: la fila de las normas deriva su estado de la fecha registrada de aplicación`, () => {
    const informe = informeDe(idioma);
    const breve = construirInformeBreve(informe, datos);
    const antes = renderizarInformeBreve(breve, informe);
    assert.match(antes, es ? /Aprobadas, aún sin aplicar/u : /Aprovades, encara sense aplicar/u);
    assert.match(
      antes,
      es ? /Aplazadas: iban a aplicarse en agosto de 2026/u : /Ajornades: s’havien d’aplicar l’agost del 2026/u,
    );
    // El mismo día de aplicación ya está en aplicación, igual que cualquier día posterior.
    for (const fecha of [NORMAS_DE_ALTO_RIESGO.aplicacion, DESPUES_DE_APLICARSE]) {
      const despues = renderizarInformeBreve({ ...breve, fecha }, informe);
      assert.doesNotMatch(despues, /aún sin aplicar|encara sense aplicar/u, fecha);
      assert.match(despues, es ? /Aprobadas y en aplicación/u : /Aprovades i en aplicació/u, fecha);
      assert.match(
        despues,
        es ? /En aplicación desde el 2 dic\. 2027/u : /En aplicació des del 2 de des\. del 2027/u,
        fecha,
      );
    }
    assert.equal(NORMAS_DE_ALTO_RIESGO.aplicacion, '2027-12-02');
  });

  test(`${idioma}: «Primer año que se mide» solo con un año de la encuesta en los datos`, () => {
    const informe = informeDe(idioma);
    const breve = construirInformeBreve(informe, datos);
    assert.ok(breve.uso);
    const uno = renderizarInformeBreve({ ...breve, uso: { ...breve.uso, aniosMedidos: [breve.uso.anio] } }, informe);
    assert.match(uno, es ? /Primer año que se mide/u : /Primer any que es mesura/u);
    const dos = renderizarInformeBreve(
      { ...breve, uso: { ...breve.uso, anio: '2026', aniosMedidos: ['2025', '2026'] } },
      informe,
    );
    assert.doesNotMatch(dos, /Primer año que se mide|Primer any que es mesura/u);
    assert.match(dos, es ? /Se mide desde 2025/u : /Es mesura des del 2025/u);
  });
}

test('sin total de ofertas no hay porcentaje: ni infinito ni un cero inventado', () => {
  const ofertas = datos.mercado?.ofertas;
  assert.ok(ofertas);
  const informe = informeDe('es');
  const conTotal = construirInformeBreve(informe, datos).mercado.ofertas;
  assert.ok(conTotal && Number.isFinite(conTotal.pct));
  const sinTotal = { ...datos, mercado: { ...datos.mercado, ofertas: { ...ofertas, total: 0 } } } as Datos;
  assert.equal(construirInformeBreve(informe, sinTotal).mercado.ofertas, null);
  const sinAnterior = { ...datos, mercado: { ...datos.mercado, ofertas: { ...ofertas, total_anterior: 0 } } } as Datos;
  const sinComparacion = construirInformeBreve(informe, sinAnterior).mercado.ofertas;
  assert.equal(sinComparacion?.pct, conTotal.pct);
  assert.equal(sinComparacion?.pctAnterior, null);
  assert.equal(sinComparacion?.direccion, 'sin-dato');
});

test('el pie impreso de la serie de contratos lleva la letra de los pies de su bloque', () => {
  assert.match(css, /\.informe-breve \.ib-serie-papel p \{\s*font-size: var\(--t-xs\);/u);
});
