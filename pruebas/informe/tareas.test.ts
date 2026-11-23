// Contratos de tarea: prioridad oficial, escala de estimaciones, competencias y autoría.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EntradaInvalida } from '../../src/dominio/errores.ts';
import { crearLengua } from '../../src/dominio/lengua.ts';
import {
  type Ambito,
  esRedaccionManual,
  prepararEstimacionesParaInforme,
  tareaInforme,
} from '../../src/dominio/tareas.ts';
import type { Entrada, TareaEntrada } from '../../src/dominio/tipos-entrada.ts';
import type { Datos } from '../../src/dominio/tipos-paquete.ts';

const NOTAS = { media: 0.4, centro: 0.5, alta: 0.6, inferior: 0.2, mayor: 1.1, negativa: -0.1 } as const;
const DATOS: Datos = {
  esco: {
    competencias: [
      ['u-e', 'Esencial', 'skill'],
      ['u-o', 'Opcional', 'skill'],
      ['u-f', 'Otra', 'skill'],
    ],
    ocupaciones: {
      propia: {
        uri: 'propia',
        titulo: 'Primera',
        isco08: '4226',
        competencias: [
          [0, 'e'],
          [1, 'o'],
        ],
      },
      otra: { uri: 'otra', titulo: 'Segunda', isco08: '4226', competencias: [[1, 'e']] },
      secundaria: { uri: 'secundaria', titulo: 'Tercera', isco08: '4311', competencias: [[0, 'e']] },
    },
  },
  oit: {
    fuente: { cita: 'Fuente', aviso_adaptacion: 'Aviso' },
    ocupaciones: {},
    tareas: {
      '4226-1': {
        isco08: '4226',
        indice: 1,
        texto_en: 'First task',
        nota: NOTAS.media,
        margen: [NOTAS.inferior, NOTAS.alta],
        metodo: 'predicted',
      },
      '4226-2': {
        isco08: '4226',
        indice: 2,
        texto_en: 'Second task',
        nota: NOTAS.alta,
        margen: null,
        metodo: 'reconciled',
      },
      '4311-1': {
        isco08: '4311',
        indice: 1,
        texto_en: 'Another task',
        nota: NOTAS.alta,
        margen: null,
        metodo: 'predicted',
      },
      '4226-3': { isco08: '4226', indice: 3, texto_en: 'Without note', nota: null, margen: null, metodo: null },
    },
  },
  clasificaciones: { cno11: {}, isco08_es: { '4226': 'Principal', '4311': 'Secundario' }, isco08_a_cno11: {} },
  cambra: {
    fuente: '',
    genero: { mujeres_exposicion_media_o_alta: 0, hombres_exposicion_media_o_alta: 0, pagina_impresa: 1 },
  },
  textos: {
    aviso_traduccion: 'Aviso',
    tareas: {
      '4226-1': {
        corto: 'Primera tarea',
        texto_es: 'Texto',
        ia_podria: 'Ayudar',
        lo_tuyo: 'Decidir',
        estado: 'redacción manual',
      },
      '4226-2': { corto: 'Segunda tarea', texto_es: 'Texto', ia_podria: 'Ordenar', estado: 'redactado con IA' },
    },
    competencias_por_ocupacion: {
      propia: { '4226-1': ['u-e', 'u-o', 'u-f'] },
      otra: { '4226-1': ['u-o'], '4226-2': ['u-o', 'u-f'] },
      secundaria: { '4311-1': ['u-e'] },
    },
  },
};
const TAREA: TareaEntrada = { id: 't', texto: '  Una tarea.;:  ', tiempo: 'algo' };
type Estimacion = NonNullable<TareaEntrada['estimacion']>;

function ambito(cambios: Partial<Ambito> = {}): Ambito {
  return {
    datos: DATOS,
    ocupacion: { esco: 'propia', isco08: '4226', secundario: null },
    lengua: crearLengua(DATOS),
    sinReferencias: false,
    ...cambios,
  };
}

function estimada(valor: number, margen: [number, number], cambios: Partial<Estimacion> = {}): TareaEntrada {
  return { ...TAREA, estimacion: { valor, margen, origen: 'ejemplo', ...cambios } };
}

function oficial(tareaOit = '4226-1', relacion: 'propia' | 'equivalente' = 'propia'): TareaEntrada {
  return { ...TAREA, referencia: { tareaOit, relacion } };
}

function entradaCon(tareas: TareaEntrada[]): Entrada {
  return { ocupacionEsco: 'propia', isco08: '4226', fecha: '2026-10-13', tareas };
}

function errorDeEntrada(mensaje: string): (error: unknown) => boolean {
  return (error) => {
    assert.ok(error instanceof EntradaInvalida);
    assert.equal(error.message, mensaje);
    return true;
  };
}

test('la referencia OIT manda aunque haya una estimación inválida', () => {
  const entrada = { ...oficial(), estimacion: estimada(Infinity, [0, Infinity]).estimacion };
  assert.deepEqual(tareaInforme(ambito(), entrada), tareaInforme(ambito(), oficial()));
  const salida = tareaInforme(ambito(), entrada);
  assert.equal(salida.valor, NOTAS.media);
  assert.deepEqual(salida.margen, [NOTAS.inferior, NOTAS.alta]);
  assert.equal(salida.franja, 'media');
  assert.deepEqual(salida.franjasPosibles, ['baja', 'media', 'alta']);
});

test('los extremos 0 y 1 y los cortes se admiten sin redondear ni mutar', () => {
  for (const nota of [0, NOTAS.media, NOTAS.alta, 1]) {
    const entrada = estimada(nota, [0, 1]);
    const antes = structuredClone(entrada);
    const salida = tareaInforme(ambito(), entrada);
    assert.equal(salida.valor, nota);
    assert.deepEqual(salida.margen, [0, 1]);
    assert.deepEqual(entrada, antes);
  }
});

test('notas y extremos contenidos pero fuera de escala se rechazan con EntradaInvalida', () => {
  const casos: [number, [number, number]][] = [
    [NOTAS.mayor, [NOTAS.mayor, NOTAS.mayor]],
    [NOTAS.negativa, [NOTAS.negativa, 0]],
    [Infinity, [0, Infinity]],
    [-Infinity, [-Infinity, 0]],
    [NOTAS.centro, [0, Infinity]],
    [NOTAS.centro, [-Infinity, 1]],
    [NOTAS.centro, [NOTAS.negativa, 1]],
    [NOTAS.centro, [0, NOTAS.mayor]],
  ];
  for (const [valor, margen] of casos) {
    assert.throws(
      () => tareaInforme(ambito(), estimada(valor, margen)),
      errorDeEntrada('Estimación fuera de escala 0–1: t'),
    );
  }
});

test('NaN, margen invertido o nota fuera del margen conservan el error anterior', () => {
  const casos: [number, [number, number]][] = [
    [NaN, [0, 1]],
    [NOTAS.centro, [NaN, 1]],
    [NOTAS.centro, [0, NaN]],
    [NOTAS.centro, [NOTAS.alta, 1]],
    [NOTAS.centro, [1, 0]],
    [Infinity, [0, 1]],
  ];
  for (const [valor, margen] of casos) {
    assert.throws(
      () => tareaInforme(ambito(), estimada(valor, margen)),
      errorDeEntrada('Estimación fuera de su margen: t'),
    );
  }
});

test('las competencias propias conservan orden y relación; equivalente mantiene la ocupación', () => {
  const relaciones = ['esencial', 'opcional', 'propuesta-faro'];
  const salida = tareaInforme(ambito(), oficial());
  assert.deepEqual(
    salida.competencias.map(({ uri }) => uri),
    ['u-e', 'u-o', 'u-f'],
  );
  assert.deepEqual(
    salida.competencias.map(({ relacion }) => relacion),
    relaciones,
  );
  assert.deepEqual(tareaInforme(ambito(), oficial('4226-1', 'equivalente')).competencias, salida.competencias);
});

test('sin enlace propio usa el grupo y elimina duplicados sin cambiar el orden', () => {
  const salida = tareaInforme(ambito(), oficial('4226-2'));
  assert.deepEqual(
    salida.competencias.map(({ uri, relacion, alcance }) => ({ uri, relacion, alcance })),
    [
      { uri: 'u-o', relacion: 'opcional', alcance: 'grupo' },
      { uri: 'u-f', relacion: 'propuesta-faro', alcance: 'grupo' },
    ],
  );
  const sinEsco = ambito({ ocupacion: { esco: null, isco08: '4226', secundario: null } });
  const delGrupo = tareaInforme(sinEsco, oficial()).competencias;
  assert.deepEqual(
    delGrupo.map(({ uri }) => uri),
    ['u-e', 'u-o', 'u-f'],
  );
  assert.ok(delGrupo.every(({ relacion, alcance }) => relacion === 'sin-ocupacion' && alcance === 'grupo'));
});

test('el segundo grupo no atribuye relación con la ocupación ESCO principal', () => {
  const dosGrupos = ambito({ ocupacion: { esco: 'propia', isco08: '4226', secundario: '4311' } });
  const salida = tareaInforme(dosGrupos, oficial('4311-1'));
  assert.equal(salida.referencia?.isco08, '4311');
  assert.deepEqual(
    salida.competencias.map(({ relacion }) => relacion),
    ['sin-ocupacion'],
  );
});

test('se conservan errores de referencia y de competencia de entrada', () => {
  for (const tareaOit of ['4226-3', '9999-1']) {
    assert.throws(() => tareaInforme(ambito(), oficial(tareaOit)), errorDeEntrada(`Tarea OIT sin nota: ${tareaOit}`));
  }
  assert.throws(
    () => tareaInforme(ambito(), oficial('4311-1')),
    errorDeEntrada('La tarea t no pertenece a la ocupación 4226'),
  );
  assert.throws(
    () => tareaInforme(ambito(), estimada(NOTAS.centro, [0, 1], { competencias: ['desconocida'] })),
    EntradaInvalida,
  );
});

test('autoría manual y traducción conseguida tienen la marca correspondiente', () => {
  assert.equal(tareaInforme(ambito(), oficial()).textosIa, false);
  assert.equal(tareaInforme(ambito(), oficial('4226-2')).textosIa, true);
  const lengua = crearLengua(
    DATOS,
    'ca',
    new Map([
      ['Ayudar', 'Ajudar'],
      ['Decidir', 'Decidir en català'],
    ]),
  );
  const salida = tareaInforme(ambito({ lengua }), oficial());
  assert.equal(salida.iaPodria, 'Ajudar');
  assert.equal(salida.textosIa, true);
  assert.equal(lengua.hayTraducciones(), true);
  assert.deepEqual(
    lengua.sinTraducir().filter(({ texto }) => texto === 'Esencial'),
    [{ texto: 'Esencial', idioma: 'es' }],
  );
});

test('ejemplo y estimación real distinguen autoría, incertidumbre y origen', () => {
  const ejemplo = tareaInforme(ambito(), estimada(NOTAS.centro, [0, 1], { iaPodria: 'Ayudar' }));
  assert.equal(ejemplo.ejemplo, true);
  assert.equal(ejemplo.textosIa, false);
  const contexto = ambito();
  const salida = tareaInforme(
    contexto,
    estimada(NOTAS.centro, [0, 1], { origen: 'faro', referencias: 'oit', incierta: true, iaPodria: 'Ayudar' }),
  );
  assert.equal(salida.ejemplo, undefined);
  assert.equal(salida.incierta, true);
  assert.equal(salida.textosIa, true);
  assert.equal(
    salida.origenValor,
    contexto.lengua.textos.origen.incierta +
      contexto.lengua.textos.origen.metodoOit(contexto.lengua.textos.origen.margenMedido),
  );
});

test('sin nota conserva la tarea y distingue la falta de referencias', () => {
  const contexto = ambito();
  const salida = tareaInforme(contexto, TAREA);
  assert.equal(salida.nombre, 'Una tarea');
  assert.equal(salida.valor, null);
  assert.equal(salida.evidencia, 'insuficiente');
  assert.deepEqual(salida.competencias, []);
  assert.equal(salida.origenValor, contexto.lengua.textos.origen.insuficiente);
  assert.equal(
    tareaInforme(ambito({ sinReferencias: true }), TAREA).origenValor,
    contexto.lengua.textos.origen.sinReferencias,
  );
});

test('la regla compartida solo reconoce el estado manual', () => {
  assert.equal(esRedaccionManual('redacción manual'), true);
  for (const estado of ['redactado con IA', 'traducido con IA', undefined] as const) {
    assert.equal(esRedaccionManual(estado), false);
  }
});

test('preparar estimaciones válidas o con prioridad OIT conserva toda la identidad', () => {
  const tareas = [
    TAREA,
    estimada(0, [0, 0]),
    estimada(1, [1, 1]),
    estimada(NOTAS.media, [0, 1]),
    estimada(NOTAS.alta, [NOTAS.media, NOTAS.alta]),
    { ...oficial(), estimacion: estimada(Infinity, [0, Infinity]).estimacion },
  ];
  const entrada = entradaCon(tareas);
  const preparada = prepararEstimacionesParaInforme(entrada);
  assert.equal(preparada.entrada, entrada);
  assert.equal(preparada.entrada.tareas, tareas);
  assert.equal(preparada.tareasSinEstimacion.size, 0);
  for (const [indice, tarea] of tareas.entries()) {
    assert.equal(preparada.entrada.tareas[indice], tarea);
  }
});

test('el preparado retira los mismos inválidos que rechaza el camino estricto', () => {
  const casos: [number, [number, number]][] = [
    [NOTAS.mayor, [NOTAS.mayor, NOTAS.mayor]],
    [NOTAS.negativa, [NOTAS.negativa, 0]],
    [Infinity, [0, Infinity]],
    [-Infinity, [-Infinity, 0]],
    [NOTAS.centro, [0, Infinity]],
    [NOTAS.centro, [-Infinity, 1]],
    [NOTAS.centro, [NOTAS.negativa, 1]],
    [NOTAS.centro, [0, NOTAS.mayor]],
    [NaN, [0, 1]],
    [NOTAS.centro, [NaN, 1]],
    [NOTAS.centro, [0, NaN]],
    [NOTAS.centro, [1, 0]],
    [NOTAS.centro, [NOTAS.alta, 1]],
  ];
  for (const [valor, margen] of casos) {
    const tarea = estimada(valor, margen);
    const entrada = entradaCon([tarea]);
    assert.throws(() => tareaInforme(ambito(), tarea), EntradaInvalida);
    const preparada = prepararEstimacionesParaInforme(entrada);
    assert.notEqual(preparada.entrada, entrada);
    assert.deepEqual([...preparada.tareasSinEstimacion], ['t']);
    assert.deepEqual(preparada.entrada.tareas, [TAREA]);
    assert.equal(Object.hasOwn(preparada.entrada.tareas[0] ?? {}, 'estimacion'), false);
  }
});

test('el preparado conserva orden y datos de la entrada congelada y solo clona tareas afectadas', () => {
  const valida = Object.freeze({ ...estimada(NOTAS.centro, [0, 1]), id: 'valida' });
  const invalida = Object.freeze({ ...estimada(NOTAS.mayor, [NOTAS.mayor, NOTAS.mayor]), id: 'invalida' });
  const entrada = entradaCon([valida, invalida, TAREA]);
  const antes = structuredClone(entrada);
  Object.freeze(entrada.tareas);
  Object.freeze(entrada);
  const preparada = prepararEstimacionesParaInforme(entrada);
  assert.deepEqual(entrada, antes);
  assert.notEqual(preparada.entrada.tareas, entrada.tareas);
  assert.equal(preparada.entrada.tareas[0], valida);
  assert.notEqual(preparada.entrada.tareas[1], invalida);
  assert.equal(preparada.entrada.tareas[2], TAREA);
  assert.deepEqual(
    preparada.entrada.tareas.map(({ id }) => id),
    ['valida', 'invalida', 't'],
  );
  assert.deepEqual([...preparada.tareasSinEstimacion], ['invalida']);
});

test('el preparado no captura competencias ni referencias erróneas, ni decide por ID duplicado', () => {
  const invalida = estimada(NOTAS.mayor, [NOTAS.mayor, NOTAS.mayor]);
  const competenciaDesconocida = estimada(NOTAS.centro, [0, 1], { competencias: ['desconocida'] });
  const referenciaDesconocida = { ...oficial('9999-1'), estimacion: invalida.estimacion };
  const entrada = entradaCon([invalida, competenciaDesconocida, referenciaDesconocida]);
  const preparada = prepararEstimacionesParaInforme(entrada);
  assert.equal(preparada.entrada.tareas[1], competenciaDesconocida);
  assert.equal(preparada.entrada.tareas[2], referenciaDesconocida);
  assert.throws(
    () => tareaInforme(ambito(), competenciaDesconocida),
    errorDeEntrada('Competencia ESCO desconocida: desconocida'),
  );
  assert.throws(() => tareaInforme(ambito(), referenciaDesconocida), errorDeEntrada('Tarea OIT sin nota: 9999-1'));
});

test('la tarea preparada queda sin nota con motivo y texto ES/CA, sin perder tiempo ni inventar nota', () => {
  const preparada = prepararEstimacionesParaInforme(entradaCon([estimada(NOTAS.mayor, [NOTAS.mayor, NOTAS.mayor])]));
  const [tarea] = preparada.entrada.tareas;
  assert.ok(tarea);
  for (const idioma of ['es', 'ca'] as const) {
    const contexto = ambito({ lengua: crearLengua(DATOS, idioma), tareasSinEstimacion: preparada.tareasSinEstimacion });
    const salida = tareaInforme(contexto, tarea);
    assert.equal(salida.motivoSinNota, 'estimacion-no-disponible');
    assert.equal(typeof salida.origenValor, 'string');
    assert.ok(salida.origenValor.length > 0);
    assert.equal(salida.origenValor, contexto.lengua.textos.origen.estimacionNoDisponible);
    assert.equal(salida.id, TAREA.id);
    assert.equal(salida.texto, TAREA.texto);
    assert.equal(salida.tiempo, TAREA.tiempo);
    assert.equal(salida.peso, 2);
    assert.equal(salida.valor, null);
    assert.equal(salida.margen, null);
    assert.equal(salida.franja, null);
    assert.equal(salida.evidencia, 'insuficiente');
    assert.deepEqual(salida.competencias, []);
  }
});

test('el motivo solo se publica en tareas sin nota marcadas y no cambia sinReferencias ni la prioridad OIT', () => {
  const marcas = new Set([TAREA.id]);
  const contexto = ambito({ tareasSinEstimacion: marcas, sinReferencias: true });
  assert.equal(tareaInforme(contexto, TAREA).origenValor, contexto.lengua.textos.origen.estimacionNoDisponible);
  assert.equal(tareaInforme(contexto, oficial()).motivoSinNota, undefined);
  const valida = estimada(NOTAS.centro, [0, 1]);
  assert.deepEqual(tareaInforme(contexto, valida), tareaInforme(ambito(), valida));
  const sinMarca = tareaInforme(ambito({ tareasSinEstimacion: new Set(), sinReferencias: true }), TAREA);
  assert.equal(Object.hasOwn(sinMarca, 'motivoSinNota'), false);
  assert.equal(sinMarca.origenValor, contexto.lengua.textos.origen.sinReferencias);
});
