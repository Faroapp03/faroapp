// Reglas de fechas, coste, orden e itinerario de Citilab con fichas propias y días fijos.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CursoCitilabOficial, DatosCitilab } from '../../../compartido/contratos/tipos-citilab.ts';
import { citilabDelInforme, itinerarioCitilab, momentoCitilab, tramoCitilab } from '../src/formacion-citilab.ts';

const HOY = '2026-10-06';
const AYER = '2026-10-05';
const MANANA = '2026-10-07';

function curso(cambios: Partial<CursoCitilabOficial> = {}): CursoCitilabOficial {
  return {
    id: 0,
    titulo: 'Curso',
    enlace: 'https://www.citilab.eu/formacio-prueba/',
    modificado: HOY,
    publico: ['adults'],
    temas: ['competencies-digitals'],
    trata_ia: false,
    modalidad: 'presencial',
    requisitos: 'ninguno',
    horas: null,
    sesiones: null,
    inicio: HOY,
    fin: '2026-12-01',
    horario: null,
    periodico: false,
    coste: { gratuito: true, precio_eur: 0, carnet_citilaber: false, descuento_paro_pct: null },
    lugar: null,
    ...cambios,
  };
}

function paquete(cursos: CursoCitilabOficial[]): DatosCitilab {
  return { cursos, copia: HOY, fuente: 'Citilab · muestra', listado: 'https://www.citilab.eu/formacio/' };
}

function informe(datos: DatosCitilab, citilabDePago = false, hoy = HOY) {
  const resultado = citilabDelInforme(datos, hoy, { citilabDePago });
  assert.ok(resultado, 'la muestra debe producir cursos de Citilab');
  return resultado;
}

test('el inicio y el fin son inclusivos; la periodicidad requiere ausencia de ambas fechas', () => {
  const casos: readonly [string | null, string | null, boolean, ReturnType<typeof momentoCitilab>][] = [
    [MANANA, '2026-12-01', false, 'por-iniciar'],
    [MANANA, null, false, 'por-iniciar'],
    [HOY, HOY, false, 'iniciado'],
    [AYER, HOY, false, 'iniciado'],
    [AYER, AYER, false, 'consultar'],
    [AYER, null, true, 'consultar'],
    [null, MANANA, true, 'consultar'],
    [null, null, false, 'consultar'],
    [null, null, true, 'periodico'],
  ];
  for (const [inicio, fin, periodico, esperado] of casos) {
    assert.equal(momentoCitilab({ inicio, fin, periodico }, HOY), esperado);
  }
});

test('el itinerario exige fechas vigentes y la IA tiene prioridad sobre el tema digital', () => {
  const digital = { temas: ['competencies-digitals'], trata_ia: false };
  for (const momento of ['por-iniciar', 'iniciado'] as const) {
    assert.equal(tramoCitilab(digital, momento), 'para-empezar');
    assert.equal(tramoCitilab({ ...digital, trata_ia: true }, momento), 'para-ir-mas-alla');
    assert.equal(tramoCitilab({ temas: [], trata_ia: true }, momento), 'para-ir-mas-alla');
    assert.equal(tramoCitilab({ temas: ['fabricacio-digital'], trata_ia: false }, momento), null);
  }
  for (const momento of ['periodico', 'consultar'] as const) {
    assert.equal(tramoCitilab(digital, momento), null);
    assert.equal(tramoCitilab({ ...digital, trata_ia: true }, momento), null);
  }
});

test('la oferta excluye el pago y el coste desconocido; sin cursos admitidos devuelve null', () => {
  const gratuito = curso({ id: 1 });
  const pago = curso({ id: 2, coste: { ...gratuito.coste, gratuito: false, precio_eur: 20 } });
  const desconocido = curso({ id: 3, coste: { ...gratuito.coste, gratuito: null, precio_eur: null } });
  assert.deepEqual(
    informe(paquete([pago, desconocido, gratuito])).cursos.map(({ id }) => id),
    [1],
  );
  assert.deepEqual(
    informe(paquete([pago, desconocido, gratuito]), true).cursos.map(({ id }) => id),
    [gratuito.id, pago.id, desconocido.id],
  );
  assert.equal(citilabDelInforme(undefined, HOY, { citilabDePago: true }), null);
  assert.equal(citilabDelInforme(paquete([]), HOY, { citilabDePago: true }), null);
  assert.equal(citilabDelInforme(paquete([pago, desconocido]), HOY, { citilabDePago: false }), null);
});

test('el orden prioriza coste, momento e inicio y desempata títulos en catalán', () => {
  const ids = {
    proximaA: 1,
    proximaZ: 2,
    proximaPosterior: 3,
    iniciado: 4,
    periodico: 5,
    terminado: 6,
    sinFecha: 7,
    pago: 8,
  };
  const gratuito = curso();
  const datos = paquete([
    curso({ id: ids.pago, inicio: MANANA, coste: { ...gratuito.coste, gratuito: false } }),
    curso({ id: ids.sinFecha, inicio: null, fin: null }),
    curso({ id: ids.terminado, inicio: AYER, fin: AYER }),
    curso({ id: ids.periodico, inicio: null, fin: null, periodico: true }),
    curso({ id: ids.iniciado, inicio: HOY }),
    curso({ id: ids.proximaPosterior, inicio: '2026-10-08', titulo: 'A' }),
    curso({ id: ids.proximaZ, inicio: MANANA, titulo: 'Zebra' }),
    curso({ id: ids.proximaA, inicio: MANANA, titulo: 'Ànec' }),
  ]);
  assert.deepEqual(
    informe(datos, true).cursos.map(({ id }) => id),
    [
      ids.proximaA,
      ids.proximaZ,
      ids.proximaPosterior,
      ids.iniciado,
      ids.periodico,
      ids.terminado,
      ids.sinFecha,
      ids.pago,
    ],
  );
});

test('los requisitos separan iniciación del resto y el itinerario desempata por inicio y título', () => {
  const ids = { ninguno: 1, prueba: 2, otros: 3, sinDato: 4, ia: 5, terminado: 6, periodico: 7 };
  const datos = paquete([
    curso({ id: ids.sinDato, requisitos: null, inicio: MANANA, titulo: 'Z' }),
    curso({ id: ids.otros, requisitos: 'otros', inicio: MANANA, titulo: 'A' }),
    curso({ id: ids.prueba, requisitos: 'prueba', inicio: HOY }),
    curso({ id: ids.ninguno, requisitos: 'ninguno', inicio: '2026-11-01' }),
    curso({ id: ids.ia, trata_ia: true }),
    curso({ id: ids.terminado, inicio: AYER, fin: AYER }),
    curso({ id: ids.periodico, inicio: null, fin: null, periodico: true }),
  ]);
  const citilab = informe(datos);
  assert.deepEqual(
    itinerarioCitilab(citilab, 'para-empezar').map(({ id }) => id),
    [ids.ninguno, ids.prueba, ids.otros, ids.sinDato],
  );
  assert.deepEqual(
    itinerarioCitilab(citilab, 'para-ir-mas-alla').map(({ id }) => id),
    [ids.ia],
  );
  assert.deepEqual(itinerarioCitilab(null, 'para-empezar'), []);
});

test('la lista blanca conserva los hechos y la cita sin exponer campos internos ni adicionales', () => {
  const ficha = { ...curso(), internoFuturo: 'no publicar' };
  const datos = paquete([ficha]);
  const {
    modificado: _modificado,
    temas: _temas,
    trata_ia: _ia,
    periodico: _periodico,
    internoFuturo: _extra,
    ...hechos
  } = ficha;
  assert.deepEqual(informe(datos), {
    cursos: [{ ...hechos, momento: 'iniciado', tramo: 'para-empezar' }],
    consultado: HOY,
    copiaAntigua: false,
    listado: datos.listado,
    fuente: datos.fuente,
  });
});

test('el aviso de copia antigua empieza en el día 31 y conserva antigüedades negativas', () => {
  const datos = paquete([curso()]);
  assert.equal(informe(datos, false, '2026-11-05').copiaAntigua, false);
  assert.equal(informe(datos, false, '2026-11-06').copiaAntigua, true);
  assert.equal(informe(datos, false, AYER).copiaAntigua, false);
});

test('las dos selecciones conservan los datos y los empates completos mantienen su orden de entrada', () => {
  const datos = paquete([curso({ id: 2 }), curso({ id: 1 })]);
  const antes = structuredClone(datos);
  for (const ficha of datos.cursos) {
    Object.freeze(ficha);
  }
  Object.freeze(datos.cursos);
  Object.freeze(datos);
  const citilab = informe(datos);
  const antesInforme = structuredClone(citilab);
  assert.deepEqual(
    citilab.cursos.map(({ id }) => id),
    [2, 1],
  );
  assert.deepEqual(
    itinerarioCitilab(citilab, 'para-empezar').map(({ id }) => id),
    [2, 1],
  );
  assert.deepEqual(datos, antes);
  assert.deepEqual(citilab, antesInforme);
});

test('un inicio desconocido va detrás del año 9999 entre cursos para consultar', () => {
  const sinFecha = curso({ id: 1, inicio: null, fin: null });
  const conFecha = curso({ id: 2, inicio: '9999-01-01', fin: null });
  for (const cursos of [
    [sinFecha, conFecha],
    [conFecha, sinFecha],
  ]) {
    const citilab = informe({ ...paquete(cursos), copia: '9999-12-31' }, false, '9999-12-31');
    assert.ok(citilab.cursos.every(({ momento }) => momento === 'consultar'));
    assert.deepEqual(
      citilab.cursos.map(({ id }) => id),
      [conFecha.id, sinFecha.id],
    );
  }
});
