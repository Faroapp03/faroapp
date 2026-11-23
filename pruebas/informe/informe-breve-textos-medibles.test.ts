/**
 * Lo que el papel estima es solo lo que se puede medir (INTERVALOS_MEDIBLES, tareas-en-papel.ts). Una tarea cuyo nombre
 * lleva un carácter que no es medible (un emoji, U+2E3B, una letra árabe, U+0085…) no se imprime y cuenta entre las que
 * el papel dice que están en pantalla; las demás se reparten como si ella no estuviera. Y los textos reales que el modelo
 * estima (los títulos de las ocupaciones del catálogo, el código y el pie de la hoja y los nombres de las tareas
 * oficiales) son todos medibles, en castellano y en catalán.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { MAX_TAREAS_INFORME } from '../../src/comun/protocolo-web.ts';
import { construirInforme } from '../../src/dominio/informe.ts';
import { construirInformeBreve } from '../../src/dominio/informe-breve.ts';
import type { InformeBreve } from '../../src/dominio/tipos-informe-breve.ts';
import { cargarDatos } from '../../src/plataforma/node/datos.ts';
import { textosDeLaHoja } from '../../src/presentacion/informe-breve/hoja-ia.ts';
import {
  esMedible,
  INTERVALOS_MEDIBLES,
  lineasDelTexto,
  repartoEnPapel,
  textoMedible,
} from '../../src/presentacion/informe-breve/tareas-en-papel.ts';
import { renderizarInformeBreve, titulos } from '../../src/presentacion/informe-breve.ts';

const DATOS = cargarDatos(fileURLToPath(new URL('../../datos/', import.meta.url)));
const FECHA = '2026-10-23';
const COLUMNA = 20;
const MIN_OCUPACIONES = 3000;
const MIN_TAREAS = 3000;
const CIFRAS_DEL_GRUPO = 4;
const NOTA_INICIAL = 0.9;
const SALTO = 0.1;
const MEDIO_MARGEN = 0.02;

type Idioma = 'es' | 'ca';

/** Un informe de la oficinista con las tareas de `nombres`, de la más expuesta a la menos (cada una, una nota más baja). */
function informeCon(nombres: readonly string[], idioma: Idioma = 'es') {
  const informe = construirInforme(
    {
      isco08: '4110',
      fecha: FECHA,
      tareas: nombres.map((texto, i) => {
        const valor = NOTA_INICIAL - i * SALTO;
        return {
          id: `t${i + 1}`,
          texto,
          tiempo: 'mucho' as const,
          estimacion: {
            valor,
            margen: [valor - MEDIO_MARGEN, valor + MEDIO_MARGEN] as [number, number],
            origen: 'faro' as const,
            referencias: 'ocupacion' as const,
            incierta: false,
          },
        };
      }),
    },
    DATOS,
    { idioma, formacion: null },
  );
  return { informe, breve: construirInformeBreve(informe, DATOS) };
}

function repartoDe(breve: InformeBreve, informe: ReturnType<typeof informeCon>['informe'], idioma: Idioma = 'es') {
  return repartoEnPapel(breve, textosDeLaHoja(breve, titulos(informe).tituloTexto, idioma));
}

const NO_MEDIBLES = [
  ['un emoji', 'Atender a los clientes 😀 en la tienda'],
  ['U+2E3B (la raya de tres cuadratines)', 'Fecha⸻límite'],
  ['una letra árabe', 'Revisar el pedido ب del cliente'],
  ['U+0085 (siguiente línea)', 'Cerrar la caja\u0085del día'],
] as const;

for (const [que, nombre] of NO_MEDIBLES) {
  test(`una tarea con ${que} no se imprime, cuenta entre las que están en pantalla y las demás se reparten igual`, () => {
    const medibles = ['Atender llamadas', 'Archivar expedientes', 'Preparar los pedidos de la semana'];
    const todas = informeCon([medibles[0] as string, nombre, ...medibles.slice(1)]);
    const sola = informeCon(medibles);
    const conTodas = repartoDe(todas.breve, todas.informe);
    const sinEsa = repartoDe(sola.breve, sola.informe);
    const posicion = todas.breve.tareas.findIndex((tarea) => tarea.nombre === nombre);
    assert.ok(posicion >= 0, 'la tarea está en el informe');
    assert.equal(conTodas.tareas[posicion], false, `${que}: no se imprime`);
    assert.deepEqual(
      conTodas.tareas.filter((_, i) => i !== posicion),
      sinEsa.tareas,
      `${que}: las demás se reparten igual`,
    );
    const html = renderizarInformeBreve(todas.breve, todas.informe);
    const enPantalla = [...html.matchAll(/<li class="ib-tarea"[^>]*data-solo-pantalla/g)].length;
    assert.equal(
      enPantalla,
      conTodas.tareas.filter((enPapel) => !enPapel).length,
      `${que}: las filas solo de pantalla`,
    );
    assert.match(
      html,
      /<p class="ib-tareas-fuera">En esta hoja caben 3 de tus 4 tareas\./,
      `${que}: la línea de papel`,
    );
  });
}

test('una menos expuesta con un carácter que no es medible tampoco se imprime y la otra sí', () => {
  const { breve, informe } = informeCon([
    'Atender llamadas',
    'Archivar expedientes',
    'Preparar pedidos',
    'Cerrar 😀',
    'Revisar caja',
  ]);
  assert.equal(breve.menosExpuestas.length, 2);
  const reparto = repartoDe(breve, informe);
  assert.deepEqual(
    breve.menosExpuestas.map((tarea, i) => [tarea.nombre, reparto.menos[i]]),
    [
      ['Revisar caja', true],
      ['Cerrar 😀', false],
    ],
  );
});

test('un informe con todas las tareas medibles se reparte como siempre: caben todas y no hay línea de papel', () => {
  const { breve, informe } = informeCon(['Atender llamadas', 'Archivar expedientes', 'Preparar los pedidos']);
  assert.deepEqual(repartoDe(breve, informe).tareas, [true, true, true]);
  assert.doesNotMatch(renderizarInformeBreve(breve, informe), /ib-tareas-fuera/);
});

/** Los puntos de código que se pasan a esMedible, en hexadecimal: sin forma, sin caja o fuera de los intervalos. */
const SIN_ESTIMACION = ['0x0c', '0x0b', '0x85', '0x2028', '0x2029', '0x00', '0x2e3b', '0x0628', '0x1f600', '0x0301'];
/** Los que sí: letras con acento, interpunct, comillas, fracciones, otros espacios, monedas y flechas. */
const CON_ESTIMACION = [
  '0x61',
  '0xf1',
  '0xe7',
  '0xb7',
  '0x2019',
  '0xbe',
  '0x100',
  '0xa0',
  '0x2003',
  '0x3000',
  '0x20ac',
  '0x2192',
];

function desde(codigos: readonly string[]): string[] {
  return codigos.map((codigo) => String.fromCodePoint(Number(codigo)));
}

test('un texto con un carácter que no es medible no tiene estimación', () => {
  assert.equal(lineasDelTexto('Hola 😀', COLUMNA).lineas, Number.POSITIVE_INFINITY);
  assert.equal(textoMedible('Hola\tmundo\nde\r\nnuevo'), true);
  for (const caracter of desde(SIN_ESTIMACION)) {
    assert.equal(esMedible(caracter), false, `U+${caracter.codePointAt(0)} no es medible`);
    assert.equal(textoMedible(`a${caracter}b`), false);
  }
  for (const caracter of desde(CON_ESTIMACION)) {
    assert.equal(esMedible(caracter), true, `U+${caracter.codePointAt(0)} es medible`);
  }
});

test('los intervalos medibles no se solapan y cada uno tiene un avance positivo', () => {
  const ordenados = INTERVALOS_MEDIBLES.toSorted((a, b) => a.desde - b.desde);
  for (const [i, intervalo] of ordenados.entries()) {
    assert.ok(intervalo.desde <= intervalo.hasta && intervalo.avance > 0);
    assert.ok(i === 0 || (ordenados[i - 1]?.hasta ?? 0) < intervalo.desde, 'sin solapes');
  }
});

for (const idioma of ['es', 'ca'] as const) {
  test(`${idioma}: los títulos del catálogo, el código y el pie de la hoja son medibles`, () => {
    const lista = [
      ...Object.entries(DATOS.esco.ocupaciones).map(([codigo, ocupacion]) => ({
        esco: codigo,
        isco08: ocupacion.isco08,
      })),
      ...Object.keys(DATOS.clasificaciones.isco08_es)
        .filter((codigo) => codigo.length === CIFRAS_DEL_GRUPO)
        .map((codigo) => ({ esco: undefined, isco08: codigo })),
    ];
    const noMedibles: string[] = [];
    for (const { esco, isco08 } of lista) {
      const informe = construirInforme(
        {
          isco08,
          ...(esco ? { ocupacionEsco: esco } : {}),
          fecha: FECHA,
          tareas: [{ id: 't1', texto: 'Atender llamadas', tiempo: 'mucho' as const }],
        },
        DATOS,
        { idioma, formacion: null },
      );
      const breve = construirInformeBreve(informe, DATOS);
      const textos = textosDeLaHoja(breve, titulos(informe).tituloTexto, idioma);
      for (const texto of [textos.ocupacion, textos.pie]) {
        if (!textoMedible(texto)) {
          noMedibles.push(`${esco ?? isco08}: ${[...texto].filter((c) => !esMedible(c) && !/\s/.test(c)).join('')}`);
        }
      }
    }
    assert.deepEqual(noMedibles, [], `${idioma}: textos de ocupación con caracteres que no son medibles`);
    assert.ok(lista.length > MIN_OCUPACIONES);
  });

  test(`${idioma}: los nombres de las tareas oficiales de todos los grupos son medibles`, () => {
    const porGrupo = Object.entries(DATOS.oit.tareas).reduce<Map<string, string[]>>((grupos, [id, tarea]) => {
      grupos.set(tarea.isco08, [...(grupos.get(tarea.isco08) ?? []), id]);
      return grupos;
    }, new Map());
    const noMedibles: string[] = [];
    let nombres = 0;
    for (const [isco08, ids] of porGrupo) {
      for (let desde = 0; desde < ids.length; desde += MAX_TAREAS_INFORME) {
        const informe = construirInforme(
          {
            isco08,
            fecha: FECHA,
            tareas: ids.slice(desde, desde + MAX_TAREAS_INFORME).map((tareaOit, i) => ({
              id: `t${i + 1}`,
              texto: 'Tarea',
              tiempo: 'mucho' as const,
              referencia: { tareaOit, relacion: 'propia' as const },
            })),
          },
          DATOS,
          { idioma, formacion: null },
        );
        for (const tarea of construirInformeBreve(informe, DATOS).tareas) {
          nombres += 1;
          if (!textoMedible(tarea.nombre)) {
            noMedibles.push(`${isco08}: ${tarea.nombre}`);
          }
        }
      }
    }
    assert.deepEqual(noMedibles, [], `${idioma}: nombres de tareas con caracteres que no son medibles`);
    assert.ok(nombres > MIN_TAREAS, `se recorren las tareas oficiales (${nombres})`);
  });
}
