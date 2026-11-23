// Contratos del bloque transversal con catálogo y convocatorias sintéticos: selección, fechas, fuentes y ACTIC.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type {
  DatosActic,
  DatosConsorci,
  DatosFormacion,
  EdicionConsorciOficial,
} from '../../../compartido/contratos/tipos-formacion.ts';
import { InvarianteRoto } from '../../../src/dominio/errores.ts';
import { CRITERIO_DIGITAL_TRANSVERSAL } from '../src/criterio-digital-transversal.ts';
import { formacionDigitalTransversal } from '../src/formacion-transversal.ts';

const HOY = '2026-10-10';
const BASICA = 'CTRD0042 (FCOI0042)';
const AVANZADA = 'IFCT0115';
const PROGRAMADAS = 7;
const MINUTOS_BASICOS = 120;
const MINUTOS_MEDIOS = 100;
const MINUTOS_AVANZADOS = 90;

function especialidad(nombre = 'INTELIGENCIA ARTIFICIAL', nivel = '2'): DatosFormacion['especialidades'][string] {
  return { nombre, nivel, horas: '30', familia: '-', modalidad: 'Presencial', ocupaciones: [], ficha: '' };
}

const FORMACION: DatosFormacion = {
  fuentes: { sepe: 'SEPE', soc: 'SOC', eures: 'EURES' },
  fecha_cursos: HOY,
  cobertura: {},
  ocupaciones: {},
  especialidades: {
    [AVANZADA]: especialidad('MICROSOFT 365 COPILOT', '3'),
    IFCT0003: especialidad('IA SIN OFERTA', '3'),
    IFCT0004: especialidad('IA SOLO PROGRAMADA', '3'),
    IFCT0253: especialidad('CHATGPT'),
    [BASICA]: especialidad(),
    IFCD0001: especialidad(),
  },
  cursos: [],
};

const CONSORCI: DatosConsorci = {
  fuente: 'Consorci · datos de prueba',
  fecha_copia: HOY,
  actualizado: HOY,
  buscador: 'https://example.test/buscador',
  ediciones: [],
  previstas: {},
  entidades: {},
  programadas_sin_fecha: {},
};

const ACTIC: DatosActic = {
  enlace: 'https://actic.example.test/',
  fuentes: { actic: 'DOGC · datos de prueba' },
  niveles: [
    { clave: 'avanzado', nivel: 3, es: 'Avanzado', ca: 'Avançat', minutos: MINUTOS_AVANZADOS },
    { clave: 'basico', nivel: 1, es: 'Básico', ca: 'Bàsic', minutos: MINUTOS_BASICOS },
    { clave: 'medio', nivel: 2, es: 'Medio', ca: 'Mitjà', minutos: MINUTOS_MEDIOS },
  ],
  areas: [{ area: 1 }, { area: 2 }],
  prueba: { exencion: ['desempleo'] },
  modelo: { vigente_desde: '2026-09-15' },
};

function curso(id: string, cambios: Partial<DatosFormacion['cursos'][number]> = {}): DatosFormacion['cursos'][number] {
  return {
    id,
    nombre: 'Curs',
    especialidades: ['CTRD0042'],
    modalidad: 'Presencial',
    municipio: 'Reus',
    inicio: '2026-10-20',
    fin: '2026-11-20',
    horas: '30',
    estado: 'En inscripción',
    centro: 'Centre',
    enlace: `https://example.test/${id}`,
    ...cambios,
  };
}

function edicion(id: string, cambios: Partial<EdicionConsorciOficial> = {}): EdicionConsorciOficial {
  return {
    id,
    nombre: 'Edició',
    certificado: null,
    modulo: null,
    especialidad: AVANZADA,
    modalidad: 'Presencial',
    a_distancia: false,
    municipio: 'Reus',
    inicio: '2026-10-20',
    fin: '2026-11-20',
    horas: '30',
    entidad: 'Entidad',
    web: null,
    correo: null,
    telefono: null,
    contacto_oficial: null,
    ...cambios,
  };
}

function conPrevista(codigo = AVANZADA): DatosConsorci {
  return {
    ...CONSORCI,
    previstas: {
      [codigo]: { nombre: 'Curs previst', acciones: [{ entidad: 'e001', modalidad: 'Teleformació', horas: '30' }] },
    },
    entidades: {
      e001: { entidad: 'Entidad', municipio: 'Reus', web: null, correo: null, telefono: null, contacto_oficial: null },
    },
    programadas_sin_fecha: { CTRD0042: PROGRAMADAS, [codigo]: PROGRAMADAS, IFCT0004: PROGRAMADAS },
  };
}

test('sin opciones se ordenan las especialidades por código, sin sugerencias ni segundo tramo sin oferta', () => {
  const bloque = formacionDigitalTransversal(FORMACION, HOY);
  assert.deepEqual(
    bloque.especialidades.map(({ codigo }) => codigo),
    [BASICA, 'IFCT0253'],
  );
  assert.equal(bloque.especialidades[1]?.nombre, 'ChatGPT');
  assert.ok(bloque.especialidades.every(({ programa }) => programa === null));
  assert.deepEqual([bloque.cursos, bloque.ediciones, bloque.previstas], [[], [], []]);
  assert.equal(bloque.programadasSinFecha, 0);
  assert.equal(bloque.paraIrMasAlla, null);
  assert.equal(bloque.certificacion, null);
  assert.equal(bloque.fuenteConsorci, null);
  assert.equal(bloque.buscadorConsorci, null);
});

test('el criterio original no recibe las especialidades ni el segundo tramo de la adenda', () => {
  const bloque = formacionDigitalTransversal(FORMACION, HOY, { criterio: CRITERIO_DIGITAL_TRANSVERSAL });
  assert.deepEqual(
    bloque.especialidades.map(({ codigo }) => codigo),
    [BASICA],
  );
  assert.equal(bloque.paraIrMasAlla, null);
});

test('el orden por código usa unidades UTF-16 y conserva los nombres repetidos de códigos distintos', () => {
  const formacion = {
    ...FORMACION,
    especialidades: {
      IFCT0001a: especialidad(),
      IFCT0001A: especialidad(),
    },
  };
  const bloque = formacionDigitalTransversal(formacion, HOY);
  assert.deepEqual(
    bloque.especialidades.map(({ codigo }) => codigo),
    ['IFCT0001A', 'IFCT0001a'],
  );
});

test('los cursos SOC reconocen el primer código, conservan el nombre oficial y usan las fechas', () => {
  const formacion = {
    ...FORMACION,
    cursos: [
      curso('sin-fecha', { inicio: null, fin: null }),
      curso('terminado', { fin: '2026-10-09' }),
      curso('hoy', { inicio: HOY, fin: HOY }),
      curso('futuro'),
    ],
  };
  const bloque = formacionDigitalTransversal(formacion, HOY);
  assert.deepEqual(
    bloque.cursos.map(({ id, momento }) => [id, momento]),
    [
      ['futuro', 'por-iniciar'],
      ['hoy', 'iniciado'],
      ['sin-fecha', 'sin-fecha'],
    ],
  );
  for (const ofrecido of bloque.cursos) {
    assert.equal(ofrecido.especialidad, BASICA);
    assert.equal(ofrecido.sugerencia, false);
    assert.equal(ofrecido.nombre, 'Curs');
    assert.equal(ofrecido.inscripcion, 'sin-verificar');
    assert.equal(ofrecido.comprobado, HOY);
  }
});

test('el segundo tramo exige oferta SOC o Consorci; solo programadas sin fecha no lo hacen entrar', () => {
  const consorci = conPrevista();
  const bloque = formacionDigitalTransversal(FORMACION, HOY, { consorci });
  assert.deepEqual(
    bloque.paraIrMasAlla?.especialidades.map(({ codigo }) => codigo),
    [AVANZADA],
  );
  assert.equal(bloque.paraIrMasAlla?.previstas[0]?.especialidad, AVANZADA);
  assert.equal(bloque.paraIrMasAlla?.programadasSinFecha, PROGRAMADAS);
  assert.equal(bloque.programadasSinFecha, PROGRAMADAS);
  assert.equal(bloque.fuenteConsorci, CONSORCI.fuente);
  assert.equal(bloque.buscadorConsorci, CONSORCI.buscador);
});

test('un curso o una edición vigente también admiten el segundo tramo y sus terminadas quedan fuera', () => {
  const formacion = { ...FORMACION, cursos: [curso('avanzado', { especialidades: [AVANZADA] })] };
  assert.equal(formacionDigitalTransversal(formacion, HOY).paraIrMasAlla?.cursos[0]?.id, 'avanzado');
  const consorci = { ...CONSORCI, ediciones: [edicion('avanzada'), edicion('terminada', { fin: '2026-10-09' })] };
  const bloque = formacionDigitalTransversal(FORMACION, HOY, { consorci });
  assert.deepEqual(
    bloque.paraIrMasAlla?.ediciones.map(({ id }) => id),
    ['avanzada'],
  );
  assert.equal(bloque.fuenteConsorci, CONSORCI.fuente);
  assert.equal(formacionDigitalTransversal(FORMACION, '2026-11-21', { consorci }).paraIrMasAlla, null);
});

test('sin oferta del Consorci se conserva el buscador pero no se cita su fuente', () => {
  const bloque = formacionDigitalTransversal(FORMACION, HOY, { consorci: CONSORCI });
  assert.equal(bloque.fuenteConsorci, null);
  assert.equal(bloque.buscadorConsorci, CONSORCI.buscador);
});

test('los programas comprobados acompañan especialidades, cursos, ediciones y previstas', () => {
  const programas = { comprobado: HOY, candidatas: 2, codigos: [BASICA, AVANZADA] };
  const formacion = { ...FORMACION, cursos: [curso('oficial')] };
  const consorci = { ...conPrevista(), ediciones: [edicion('oficial')] };
  const bloque = formacionDigitalTransversal(formacion, HOY, { consorci, programas });
  const programaBasico = bloque.especialidades[0]?.programa;
  const programaAvanzado = bloque.paraIrMasAlla?.especialidades[0]?.programa;
  assert.ok(programaBasico);
  assert.ok(programaAvanzado);
  assert.deepEqual(bloque.cursos[0]?.programa, programaBasico);
  assert.deepEqual(bloque.paraIrMasAlla?.ediciones[0]?.programa, programaAvanzado);
  assert.deepEqual(bloque.paraIrMasAlla?.previstas[0]?.programa, programaAvanzado);
});

test('ACTIC conserva orden de niveles y datos oficiales y mide el máximo de cada tramo', () => {
  const { certificacion } = formacionDigitalTransversal(FORMACION, HOY, { actic: ACTIC });
  assert.ok(certificacion);
  assert.deepEqual(
    certificacion.paraEmpezar.niveles.map(({ clave }) => clave),
    ['basico'],
  );
  assert.deepEqual(
    certificacion.paraIrMasAlla.niveles.map(({ clave }) => clave),
    ['avanzado', 'medio'],
  );
  assert.equal(certificacion.paraEmpezar.minutos, MINUTOS_BASICOS);
  assert.equal(certificacion.paraIrMasAlla.minutos, MINUTOS_MEDIOS);
  assert.equal(certificacion.areas, ACTIC.areas.length);
  assert.equal(certificacion.vigenteDesde, ACTIC.modelo.vigente_desde);
  assert.equal(certificacion.exencionDesempleo, true);
  assert.equal(certificacion.enlace, ACTIC.enlace);
  assert.equal(certificacion.fuente, ACTIC.fuentes.actic);
});

test('ACTIC no cambia especialidades ni convocatorias, tampoco sin oferta en el segundo tramo', () => {
  const { certificacion, ...con } = formacionDigitalTransversal(FORMACION, HOY, { actic: ACTIC });
  const { certificacion: sin, ...sinActic } = formacionDigitalTransversal(FORMACION, HOY);
  assert.ok(certificacion);
  assert.equal(sin, null);
  assert.equal(con.paraIrMasAlla, null);
  assert.deepEqual(con, sinActic);
  const actic = { ...ACTIC, prueba: { exencion: [] } };
  assert.equal(formacionDigitalTransversal(FORMACION, HOY, { actic }).certificacion?.exencionDesempleo, false);
});

test('ACTIC sin ningún nivel de un tramo lanza un invariante en lugar de minutos -Infinity', () => {
  for (const clave of ['basico', 'medio'] as const) {
    const actic = { ...ACTIC, niveles: ACTIC.niveles.filter((nivel) => nivel.clave === clave) };
    assert.throws(() => formacionDigitalTransversal(FORMACION, HOY, { actic }), InvarianteRoto);
  }
});

test('la construcción no modifica ni reordena el catálogo ni las convocatorias recibidas', () => {
  const formacion = { ...FORMACION, cursos: [curso('segunda'), curso('primera', { inicio: '2026-10-11' })] };
  const consorci = { ...conPrevista(), ediciones: [edicion('segunda'), edicion('primera', { inicio: '2026-10-11' })] };
  const antes = structuredClone({ formacion, consorci, actic: ACTIC });
  Object.freeze(formacion.cursos);
  Object.freeze(formacion.especialidades);
  Object.freeze(consorci.ediciones);
  Object.freeze(ACTIC.niveles);
  formacionDigitalTransversal(formacion, HOY, { consorci, actic: ACTIC });
  assert.deepEqual({ formacion, consorci, actic: ACTIC }, antes);
});
