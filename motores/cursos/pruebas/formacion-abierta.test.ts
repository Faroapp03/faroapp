// Selección perezosa, vigencia y orden de fichas abiertas con datos propios; integración local con Cibernàrium.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type {
  CursoAbierto,
  DatosFormacionAbierta,
  FichaAbiertaOficial,
} from '../../../compartido/contratos/tipos-formacion-abierta.ts';
import type { DatosBarcelonaActiva } from '../src/barcelona-activa.ts';
import { fichaVigente, formacionAbiertaDelInforme, ordenAbierto } from '../src/formacion-abierta.ts';

const HOY = '2026-10-06';
const AYER = '2026-10-05';
const MANANA = '2026-10-07';
const BARCELONA: DatosBarcelonaActiva = {
  cita: 'Barcelona Activa · muestra',
  consulta: HOY,
  url_ficha: 'https://treball.barcelonactiva.cat/ca/cataleg-ocupacions?idFicha=',
  url_actividad: 'https://cibernarium.barcelonactiva.cat/ficha-actividad?activityId=',
  ocupaciones: {},
  cibernarium: [{ id: 'ia', titulo: 'IA', inicio: MANANA, fin: MANANA, modalidad: 'presencial' }],
};

function ficha(cambios: Partial<FichaAbiertaOficial> = {}): FichaAbiertaOficial {
  return {
    id: 'curso',
    titulo: 'Curso de prueba',
    entidad: 'Entidad',
    titular: 'publico',
    enlace: 'https://cursos.example/curso',
    idioma: 'es',
    traduccion_automatica: false,
    tema: 'digital',
    area_digcomp: null,
    nivel: 'A1',
    horas: 10,
    a_tu_ritmo: true,
    inicio: '2026-01-01',
    fin: null,
    dirigido_a: null,
    certificado: null,
    comprobado: '2026-10-01',
    ...cambios,
  };
}

function paquete(fichas: FichaAbiertaOficial[]): DatosFormacionAbierta {
  return { fichas, revision: HOY, fuente: 'Formación abierta · muestra', criterio: 'prueba' };
}

function informe(datos: DatosFormacionAbierta, modo: 'publica' | 'gratis' = 'publica') {
  const resultado = formacionAbiertaDelInforme(() => datos, modo, HOY);
  assert.ok(resultado, 'la muestra debe producir fichas abiertas');
  return resultado;
}

function curso(cambios: Partial<CursoAbierto> = {}): CursoAbierto {
  const { area_digcomp: _area, inicio: _inicio, traduccion_automatica, a_tu_ritmo, dirigido_a, ...hechos } = ficha();
  return {
    ...hechos,
    traduccionAutomatica: traduccion_automatica,
    aTuRitmo: a_tu_ritmo,
    dirigidoA: dirigido_a,
    ...cambios,
  };
}

test('el modo no evita ambas lecturas y la ausencia del paquete abierto evita leer Barcelona Activa', () => {
  const prohibida = () => assert.fail('lector invocado con la pieza apagada');
  assert.equal(formacionAbiertaDelInforme(prohibida, 'no', HOY, prohibida), null);
  assert.equal(
    formacionAbiertaDelInforme(() => undefined, 'publica', HOY, prohibida),
    null,
  );
  assert.equal(
    formacionAbiertaDelInforme(() => undefined, 'gratis', HOY, prohibida),
    null,
  );
});

test('la antigüedad de la comprobación no excluye; el fin publicado incluye hoy y excluye ayer', () => {
  const casos: readonly [string, string | null, string, boolean][] = [
    ['2026-06-08', null, HOY, true],
    ['2026-06-07', null, HOY, true],
    ['2025-01-01', MANANA, HOY, true],
    ['2025-01-01', AYER, HOY, false],
    [HOY, null, HOY, true],
    [MANANA, null, HOY, true],
    [HOY, AYER, HOY, false],
    [HOY, HOY, HOY, true],
    [HOY, MANANA, HOY, true],
    ['2024-02-29', null, '2024-06-28', true],
    ['2024-02-29', null, '2024-06-29', true],
  ];
  for (const [comprobado, fin, hoy, esperado] of casos) {
    assert.equal(fichaVigente({ comprobado, fin }, hoy), esperado, `${comprobado} → ${hoy}`);
  }
});

test('publica excluye otras entidades; gratis las agrupa por separado; solo el fin publicado retira una ficha', () => {
  const datos = paquete([
    ficha({ id: 'otra', titular: 'no-publico' }),
    ficha({ id: 'publica' }),
    ficha({ id: 'antigua', comprobado: '2026-01-01', fin: MANANA }),
    ficha({ id: 'terminada', fin: AYER }),
  ]);
  const publica = informe(datos);
  assert.deepEqual(publica.publica.map(({ id }) => id).sort(), ['antigua', 'publica']);
  assert.deepEqual(publica.noPublica, []);
  assert.ok(!JSON.stringify(publica).includes('otra'));
  const gratis = informe(datos, 'gratis');
  assert.deepEqual(gratis.publica.map(({ id }) => id).sort(), ['antigua', 'publica']);
  assert.deepEqual(
    gratis.noPublica.map(({ id }) => id),
    ['otra'],
  );
  assert.equal(
    formacionAbiertaDelInforme(() => paquete([ficha({ fin: AYER })]), 'gratis', HOY),
    null,
  );
});

test('niveles, horas conocidas y títulos determinan el orden de cada bloque', () => {
  const datos = paquete([
    ficha({ id: 'b2', nivel: 'B2', horas: 5 }),
    ficha({ id: 'a1-largo', horas: 37.5 }),
    ficha({ id: 'sin-horas-z', nivel: 'iniciacion', horas: null, titulo: 'Z' }),
    ficha({ id: 'sin-horas-a', horas: null, titulo: 'A' }),
    ficha({ id: 'a1-corto-b', horas: 18.75, titulo: 'B' }),
    ficha({ id: 'a1-corto-a', horas: 18.75, titulo: 'A' }),
    ficha({ id: 'a2', nivel: 'A2', horas: 1 }),
    ficha({ id: 'b1', nivel: 'B1', horas: 1 }),
    ficha({ id: 'c2', nivel: 'C2', horas: 1 }),
    ficha({ id: 'c1', nivel: 'C1', horas: 1 }),
  ]);
  assert.deepEqual(
    informe(datos).publica.map(({ id }) => id),
    ['a1-corto-a', 'a1-corto-b', 'a1-largo', 'sin-horas-a', 'sin-horas-z', 'a2', 'b1', 'b2', 'c1', 'c2'],
  );
  const otras = paquete(datos.fichas.map((dato) => ({ ...dato, titular: 'no-publico' })));
  assert.deepEqual(
    informe(otras, 'gratis').noPublica.map(({ id }) => id),
    informe(datos).publica.map(({ id }) => id),
  );
});

test('el comparador conserva igualdad, antisimetría y transitividad en niveles y ausencias de horas', () => {
  const muestra = [
    curso({ nivel: 'iniciacion', horas: null }),
    curso({ nivel: 'A1', horas: null }),
    curso({ nivel: 'A1', horas: 0 }),
    curso({ nivel: 'A1', horas: 18.75 }),
    curso({ nivel: 'A2', horas: null }),
    curso({ nivel: 'C2', horas: 1 }),
  ];
  for (const a of muestra) {
    assert.equal(ordenAbierto(a, a), 0);
    for (const b of muestra) {
      assert.equal(Math.sign(ordenAbierto(a, b)) + Math.sign(ordenAbierto(b, a)), 0);
      for (const c of muestra) {
        if (ordenAbierto(a, b) <= 0 && ordenAbierto(b, c) <= 0) {
          assert.ok(ordenAbierto(a, c) <= 0);
        }
      }
    }
  }
  assert.equal(ordenAbierto(curso({ horas: null }), curso({ horas: null })), 0);
  assert.ok(ordenAbierto(curso({ titulo: 'Ñ' }), curso({ titulo: 'O' })) < 0);
});

test('las fichas se trasladan por lista blanca con los hechos originales y los nombres del informe', () => {
  const original = ficha({
    idioma: 'ca',
    traduccion_automatica: true,
    tema: 'ia',
    a_tu_ritmo: false,
    dirigido_a: 'mujeres',
    certificado: { emisor: 'Universidad', precio_eur: 20, ects: 1 },
  });
  const ampliada = { ...original, internoFuturo: 'no publicar' };
  const datos = paquete([ampliada]);
  const { area_digcomp: _area, inicio: _inicio, traduccion_automatica, a_tu_ritmo, dirigido_a, ...hechos } = original;
  assert.deepEqual(informe(datos), {
    publica: [{ ...hechos, traduccionAutomatica: traduccion_automatica, aTuRitmo: a_tu_ritmo, dirigidoA: dirigido_a }],
    noPublica: [],
    fuente: datos.fuente,
    criterio: datos.criterio,
  });
});

test('el Cibernàrium entra en ambos modos activos aunque no quede ninguna ficha abierta vigente', () => {
  for (const modo of ['publica', 'gratis'] as const) {
    const abierta = formacionAbiertaDelInforme(
      () => paquete([]),
      modo,
      HOY,
      () => BARCELONA,
    );
    assert.ok(abierta);
    assert.deepEqual(abierta.publica, []);
    assert.deepEqual(abierta.noPublica, []);
    assert.deepEqual(abierta.cibernarium, {
      formaciones: [
        {
          titulo: 'IA',
          enlace: `${BARCELONA.url_actividad}ia`,
          inicio: MANANA,
          fin: MANANA,
          modalidad: 'presencial',
        },
      ],
      fuente: BARCELONA.cita,
      consulta: HOY,
    });
  }
  assert.equal(
    formacionAbiertaDelInforme(() => paquete([]), 'publica', HOY),
    null,
  );
  assert.equal(
    formacionAbiertaDelInforme(
      () => paquete([]),
      'publica',
      MANANA,
      () => BARCELONA,
    ),
    null,
  );
});

test('cada lector activo se llama una vez y los datos y empates conservan su orden de entrada', () => {
  const datos = paquete([ficha({ id: 'segunda' }), ficha({ id: 'primera' })]);
  const antes = structuredClone(datos);
  for (const dato of datos.fichas) {
    Object.freeze(dato);
  }
  Object.freeze(datos.fichas);
  Object.freeze(datos);
  let lecturasAbierta = 0;
  let lecturasBarcelona = 0;
  const resultado = formacionAbiertaDelInforme(
    () => {
      lecturasAbierta += 1;
      return datos;
    },
    'publica',
    HOY,
    () => {
      lecturasBarcelona += 1;
      return BARCELONA;
    },
  );
  assert.ok(resultado);
  assert.equal(lecturasAbierta, 1);
  assert.equal(lecturasBarcelona, 1);
  assert.deepEqual(
    resultado.publica.map(({ id }) => id),
    ['segunda', 'primera'],
  );
  assert.deepEqual(datos, antes);
});

test('una fecha imposible o ajena a AAAA-MM-DD excluye la ficha sin normalizar el calendario', () => {
  for (const invalida of [
    '',
    'sin fecha',
    '2026-13-01',
    '2026-01-32',
    '2026-02-30',
    '2025-02-29',
    '1900-02-29',
    '2026-2-1',
    '2026/02/01',
    '2026-02-01T00:00:00Z',
    '2026-02-01\n',
  ]) {
    assert.equal(fichaVigente({ comprobado: invalida, fin: null }, '2026-03-01'), false, invalida);
    assert.equal(fichaVigente({ comprobado: '2026-02-01', fin: null }, invalida), false, invalida);
  }
  const invalida = paquete([ficha({ comprobado: '2026-02-30' })]);
  assert.equal(
    formacionAbiertaDelInforme(() => invalida, 'publica', '2026-03-01'),
    null,
  );
  assert.equal(
    formacionAbiertaDelInforme(() => invalida, 'gratis', '2026-03-01'),
    null,
  );
  assert.equal(fichaVigente({ comprobado: '2024-02-29', fin: null }, '2024-03-01'), true);
});
