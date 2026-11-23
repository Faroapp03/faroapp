// «Tus primeras sesiones», en la segunda hoja del plan, cabe en su página sea cual sea el plan: un tope de filas por
// fecha (vista-agenda.js) y, cuando el plan tiene más, una nota que dice cuántas se ven, cuándo empieza el curso que no
// se ve y dónde están las demás. El alto real de la hoja lo mide pruebas/navegadores/informe-impreso.test.mjs.
import './dom.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { HojaConfirmada } from '../../web/scripts/recorrido/estado.js';
import { crearAgenda } from '../../web/scripts/recorrido/plan-formacion/agenda.js';
import { vistaAgendaInicial } from '../../web/scripts/recorrido/plan-formacion/vista-agenda.js';
import { planDePrueba } from '../fixtures/plan-formacion.ts';
import type { Nodo } from './dom.ts';

type Plan = HojaConfirmada['plan'];
type Sesion = { inicio: string; fin: string | null };

/** Las filas de vista-agenda.js: las de la agenda, la de una sesión oficial y las de sus dos notas. */
const FILAS_DE_LA_AGENDA = 7;
const FILAS_DE_SESION_OFICIAL = 3;
const FILAS_DE_LA_NOTA_SIN_HORA = 2;
const FILAS_DE_LA_NOTA_DE_RECORTE = 3;
/** Las fechas de estudio que se ven cuando la agenda se recorta: las filas menos las de la nota de recorte. */
const FECHAS_DE_LA_AGENDA_RECORTADA = FILAS_DE_LA_AGENDA - FILAS_DE_LA_NOTA_DE_RECORTE;
const DIAS_DE_LA_SEMANA = 7;
const TODA_LA_SEMANA = Array.from({ length: DIAS_DE_LA_SEMANA }, (_, i) => i + 1);
const JUEVES = 4;
const DE_LUNES_A_JUEVES = TODA_LA_SEMANA.filter((dia) => dia <= JUEVES);
const LUNES = 1;
const MARTES = 2;
const MINUTOS_MINIMOS = 15;
/** Lo que dura el curso del dato de prueba: dos horas en un solo día. */
const MINUTOS_DEL_CURSO = 120;
const DIA_MS = 86_400_000;

/** Un curso de duración y ritmo conocidos: el cronograma lo reparte entero, y dos cursos así van uno tras otro. */
function asincrono(eleccion: Plan['elecciones'][number]): Plan['elecciones'][number] {
  const hechos = eleccion.oferta.hechos;
  return {
    ...eleccion,
    oferta: {
      ...eleccion.oferta,
      hechos: { ...hechos, sincronia: { ...hechos.sincronia, valor: 'asincrona', motivo: 'conocido' } },
    },
  };
}

/** Un curso con sus sesiones publicadas por el proveedor. */
function conSesiones(eleccion: Plan['elecciones'][number], sesiones: Sesion[]): Plan['elecciones'][number] {
  const hechos = eleccion.oferta.hechos;
  return {
    ...eleccion,
    oferta: {
      ...eleccion.oferta,
      unidad: { ...eleccion.oferta.unidad, tipo: 'edicion' },
      hechos: {
        ...hechos,
        calendario_formacion: {
          valor: { tipo: 'sesiones', sesiones },
          motivo: 'conocido',
          unidad: null,
          moneda: null,
          alcance: 'edicion',
          vigencia: { comprobado_el: '2026-10-22T10:00:00Z' },
        },
      },
    },
  } as Plan['elecciones'][number];
}

/** Dos cursos de 2 h seguidos, 15 minutos al día los siete días de la semana. */
function dosCursosSeguidos(idioma: 'es' | 'ca'): Plan {
  const plan = planDePrueba(idioma);
  return {
    ...plan,
    disponibilidad: { dias: TODA_LA_SEMANA, minutosPorDia: MINUTOS_MINIMOS },
    elecciones: plan.elecciones.map(asincrono),
  };
}

/** Sesiones de una hora los días que siguen a `desde`, una por día. */
function sesionesDesde(desde: string, cuantas: number): Sesion[] {
  return Array.from({ length: cuantas }, (_, i) => {
    const dia = new Date(Date.parse(`${desde}T17:30:00Z`) + i * DIA_MS).toISOString();
    return { inicio: dia, fin: dia.replace('T17:30', 'T18:30') };
  });
}

/** Dos cursos con sesiones oficiales lejanas: siete sesiones cada uno, a partir del 30 de noviembre y del 7 de diciembre. */
function sesionesLejanas(idioma: 'es' | 'ca'): Plan {
  const plan = dosCursosSeguidos(idioma);
  const [primero, segundo] = plan.elecciones;
  assert.ok(primero && segundo);
  return {
    ...plan,
    elecciones: [
      conSesiones(primero, sesionesDesde('2026-11-30', DIAS_DE_LA_SEMANA)),
      conSesiones(segundo, sesionesDesde('2026-12-07', DIAS_DE_LA_SEMANA)),
    ],
  };
}

function pintar(plan: Plan) {
  const seccion = vistaAgendaInicial(plan as never, crearAgenda(plan as never).cronograma) as unknown as Nodo;
  const filas = seccion.querySelectorAll('tbody tr') as unknown as Nodo[];
  const ocupadas = filas
    .map((fila) => {
      const celdas = fila.querySelectorAll('td') as unknown as Nodo[];
      return Math.max(
        1,
        ...celdas.map((celda) =>
          (celda.querySelectorAll('.pe-bloque-agenda') as unknown as Nodo[])
            .map((bloque) => (bloque.className.includes('pe-bloque-oficial') ? FILAS_DE_SESION_OFICIAL : 1))
            .reduce((a, b) => a + b, 0),
        ),
      );
    })
    .reduce((a, b) => a + b, 0);
  const notas = (seccion.querySelectorAll('.pe-nota') as unknown as Nodo[]).map((nota) => nota.textContent);
  const recorte = seccion.querySelector('.pe-agenda-recortada') as unknown as Nodo | null;
  return { seccion, fechas: filas.length, ocupadas, notas, recorte: recorte?.textContent ?? null };
}

/** Las fechas distintas del plan: los días de estudio y los de las sesiones oficiales futuras. */
function fechasDelPlan(plan: Plan): number {
  const cronograma = crearAgenda(plan as never).cronograma;
  const dias = new Set(cronograma.semanas.flatMap((semana) => semana.slots.map((slot) => slot.fecha)));
  for (const sesion of cronograma.sesiones) {
    dias.add(new Date(sesion.inicio ?? '').toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' }));
  }
  return dias.size;
}

/** Un curso de estudio en un solo día y otro con sesiones oficiales en dos días: las siete filas justas. */
function sesionesQueLlenan(idioma: 'es' | 'ca'): Plan {
  const plan = planDePrueba(idioma);
  const [primero, segundo] = plan.elecciones;
  assert.ok(primero && segundo);
  return {
    ...plan,
    disponibilidad: { dias: [LUNES, MARTES], minutosPorDia: MINUTOS_DEL_CURSO },
    elecciones: [asincrono(primero), conSesiones(segundo, sesionesDesde('2027-09-27', 2))],
  };
}

test('dos cursos seguidos de 2 h a 15 minutos diarios: de sus 14 primeras fechas se ven 4 y la nota dice el resto', () => {
  const plan = dosCursosSeguidos('es');
  const { fechas, ocupadas, notas, recorte } = pintar(plan);
  assert.equal(fechas, FECHAS_DE_LA_AGENDA_RECORTADA);
  assert.ok(ocupadas <= FECHAS_DE_LA_AGENDA_RECORTADA);
  assert.equal(
    recorte,
    `Aquí ves las 4 primeras fechas. El curso 2 empieza el 31 oct. 2026. Las otras ${fechasDelPlan(plan) - fechas} fechas están en el calendario que puedes guardar con «Añadir a mi calendario» desde tu plan en pantalla.`,
  );
  assert.match(notas[0] ?? '', /^Las primeras fechas de tus cursos\. Junto a cada fecha/u);
});

test('en catalán la agenda recortada dice lo mismo, con la misma calidad', () => {
  const plan = dosCursosSeguidos('ca');
  const { fechas, notas, recorte } = pintar(plan);
  assert.equal(fechas, FECHAS_DE_LA_AGENDA_RECORTADA);
  assert.equal(
    recorte,
    `Aquí veus les 4 primeres dates. El curs 2 comença el 31 d’oct. del 2026. Les altres ${fechasDelPlan(plan) - fechas} dates són al calendari que pots desar amb «Afegir al meu calendari» des del teu pla en pantalla.`,
  );
  assert.match(notas[0] ?? '', /^Les primeres dates dels teus cursos\. Al costat de cada data/u);
});

test('la frontera del tope: siete fechas caben enteras y sin nota; ocho se recortan', () => {
  // Los dos cursos sin sincronía publicada se turnan los siete días: siete fechas, la semana entera.
  const semana = pintar({
    ...planDePrueba('es'),
    disponibilidad: { dias: TODA_LA_SEMANA, minutosPorDia: MINUTOS_MINIMOS },
  });
  assert.equal(semana.fechas, FILAS_DE_LA_AGENDA);
  assert.equal(semana.recorte, null);
  assert.match(semana.notas[0] ?? '', /^Los primeros siete días de cada curso\./u);
  // De lunes a jueves, dos cursos seguidos: cuatro fechas de cada uno, ocho.
  const plan = dosCursosSeguidos('es');
  const ocho = pintar({ ...plan, disponibilidad: { dias: DE_LUNES_A_JUEVES, minutosPorDia: MINUTOS_MINIMOS } });
  assert.equal(ocho.fechas, FECHAS_DE_LA_AGENDA_RECORTADA);
  assert.match(ocho.recorte ?? '', /^Aquí ves las 4 primeras fechas\. El curso 2 empieza /u);
});

test('cada fecha con sesión oficial cuenta tres filas: con sesiones lejanas en los dos cursos se ve una', () => {
  for (const idioma of ['es', 'ca'] as const) {
    const plan = sesionesLejanas(idioma);
    const { seccion, fechas, ocupadas, recorte } = pintar(plan);
    assert.equal(fechas, 1, `${idioma}: una fecha con su sesión oficial y la nota de recorte llenan las filas`);
    assert.equal(ocupadas, FILAS_DE_SESION_OFICIAL, idioma);
    assert.ok(ocupadas + FILAS_DE_LA_NOTA_DE_RECORTE <= FILAS_DE_LA_AGENDA, `${idioma}: ${ocupadas} filas`);
    assert.equal((seccion.querySelectorAll('.pe-bloque-oficial') as unknown as Nodo[]).length, 1);
    const curso =
      idioma === 'ca' ? 'El curs 2 comença el 7 de des. del 2026, 18:30.' : 'El curso 2 empieza el 7 dic. 2026, 18:30.';
    assert.ok(recorte?.includes(curso), `${idioma}: ${recorte}`);
    const faltan = fechasDelPlan(plan) - fechas;
    const otras = idioma === 'ca' ? `Les altres ${faltan} dates són` : `Las otras ${faltan} fechas están`;
    assert.ok(recorte?.includes(otras), `${idioma}: cuenta las fechas que faltan`);
  }
});

test('una fecha de estudio y dos con sesión oficial llenan las siete filas sin recorte', () => {
  const { fechas, ocupadas, recorte } = pintar(sesionesQueLlenan('es'));
  assert.equal(fechas, 1 + 2);
  assert.equal(ocupadas, FILAS_DE_LA_AGENDA);
  assert.equal(recorte, null);
});

test('la nota de las sesiones sin hora cuenta dos filas', () => {
  const plan = dosCursosSeguidos('es');
  const [primero, segundo] = plan.elecciones;
  assert.ok(primero && segundo);
  const sinHora = conSesiones(segundo, [{ inicio: '2026-11-24T18:30:00-00:00', fin: '2026-11-24T18:45:00-00:00' }]);
  const { fechas, notas, recorte } = pintar({ ...plan, elecciones: [primero, sinHora] });
  assert.ok(notas.includes('Confirma con el proveedor las sesiones que no tienen hora publicada.'));
  assert.equal(fechas, FILAS_DE_LA_AGENDA - FILAS_DE_LA_NOTA_SIN_HORA - FILAS_DE_LA_NOTA_DE_RECORTE);
  assert.match(recorte ?? '', /^Aquí ves las 2 primeras fechas\. Las otras \d+ fechas están/u);
});

test('un plan corto pinta lo mismo que siempre: sus fechas, su nota y ninguna nota de recorte', () => {
  for (const idioma of ['es', 'ca'] as const) {
    const dos = planDePrueba(idioma);
    const uno = { ...dos, elecciones: dos.elecciones.slice(0, 1) };
    const esperado =
      idioma === 'ca'
        ? [
            'Les teves primeres sessionsEls primers set dies de cada curs. Al costat de cada data veus el temps que et proposes dedicar-hi i el que tens disponible. Les sessions oficials s’indiquen a part.1 · Curso sintético de privacidadDataCurs 1dl., 26 d’oct.30 min / 30 min30 minAquesta agenda cobreix el començament. Ajusta-la quan consultis el programa i la durada.',
            'Les teves primeres sessionsEls primers set dies de cada curs. Al costat de cada data veus el temps que et proposes dedicar-hi i el que tens disponible. Les sessions oficials s’indiquen a part.1 · Curso sintético de privacidad2 · Curso sintético de privacidadDataCurs 1Curs 2dl., 26 d’oct.30 min / 30 min15 min15 minAquesta agenda cobreix el començament. Ajusta-la quan consultis el programa i la durada.',
          ]
        : [
            'Tus primeras sesionesLos primeros siete días de cada curso. Junto a cada fecha ves el tiempo que te propones dedicar y el que tienes disponible. Las sesiones oficiales se indican aparte.1 · Curso sintético de privacidadFechaCurso 1lun., 26 oct.30 min / 30 min30 minEsta agenda cubre el comienzo. Ajústala cuando consultes el programa y la duración.',
            'Tus primeras sesionesLos primeros siete días de cada curso. Junto a cada fecha ves el tiempo que te propones dedicar y el que tienes disponible. Las sesiones oficiales se indican aparte.1 · Curso sintético de privacidad2 · Curso sintético de privacidadFechaCurso 1Curso 2lun., 26 oct.30 min / 30 min15 min15 minEsta agenda cubre el comienzo. Ajústala cuando consultes el programa y la duración.',
          ];
    assert.deepEqual(
      [uno, dos].map((plan) => pintar(plan).seccion.textContent),
      esperado,
      idioma,
    );
  }
});
