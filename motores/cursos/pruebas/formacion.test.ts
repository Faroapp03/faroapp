// Formación ocupacional y por grupo: selección oficial, sugerencias, convocatorias y límites sin datos externos.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type {
  Correspondencia,
  DatosConsorci,
  DatosFormacion,
  EspecialidadRelacionada,
} from '../../../compartido/contratos/tipos-formacion.ts';
import casosRelaciones from '../../../plataforma_datos/cursos/pruebas/casos-relaciones-formacion.json' with {
  type: 'json',
};
import { cuantizar, normalizarVector, type VectoresGuardados } from '../../../src/comun/vectores.ts';
import { InvarianteRoto } from '../../../src/dominio/errores.ts';
import {
  cursosOfrecidos,
  fichaDeEspecialidad,
  formacionDelGrupo,
  formacionPara,
  porEspecialidadElegida,
} from '../src/formacion.ts';

const HOY = '2026-10-13';
const CODIGO_OCUPACION = '12345678';
const GRUPO = '1234';
const VECTOR_CONSULTA = normalizarVector([1, 0]);
const VECTOR_S2 = [1, 1 / 2] as const;
const VECTOR_S3 = [1, 1] as const;
const VECTOR_S4 = [1, Math.SQRT2] as const;
const VECTOR_S5 = VECTOR_S4;
const PRECISION_PARECIDO = 1000;
const MIN_OFICIALES_SIN_SUGERENCIAS = 3;

/** Registro oficial mínimo de una especialidad. */
function ficha(nombre: string, ocupaciones: string[] = [CODIGO_OCUPACION]): DatosFormacion['especialidades'][string] {
  return { nombre, nivel: '1', horas: '40', familia: 'Familia', modalidad: 'Presencial', ocupaciones, ficha: '' };
}

/** Catálogo con una correspondencia exacta y sin cursos. */
function catalogo(especialidades: DatosFormacion['especialidades']): DatosFormacion {
  return {
    fuentes: { sepe: 'SEPE', soc: 'SOC', eures: 'EURES' },
    fecha_cursos: HOY,
    cobertura: {},
    ocupaciones: { ocupacion: [[CODIGO_OCUPACION, 'exacta', 'Ocupación publicada']] },
    especialidades,
    cursos: [],
  };
}

/** Índice pequeño que pasa por la cuantización y carga reales. */
function vectores(registros: Record<string, readonly number[]>): VectoresGuardados {
  const { bytes, escalas } = cuantizar(Object.values(registros));
  return {
    modelo: 'prueba',
    dimensiones: VECTOR_CONSULTA.length,
    ids: Object.keys(registros),
    escalas,
    datos: Buffer.from(bytes).toString('base64'),
  };
}

/** Convocatoria del SOC con fechas futuras. */
function curso(id: string, especialidades: string[]): DatosFormacion['cursos'][number] {
  return {
    id,
    nombre: '',
    especialidades,
    modalidad: 'Teleformació',
    municipio: 'Cornellà',
    inicio: '2026-11-01',
    fin: '2026-12-01',
    horas: '40',
    estado: 'en inscripción',
    centro: 'Centro publicado',
    enlace: 'https://exemple.cat/curso',
  };
}

/** Las claves en el orden que ofrece el dominio. */
function codigos(datos: DatosFormacion): string[] {
  return formacionPara(datos, 'ocupacion', HOY).especialidades.map(({ codigo }) => codigo);
}

/** Marca de sugerencia sin correspondencia y medida redondeada a tres decimales. */
function esSugerenciaRedondeada({ relacion, correspondencia, parecido }: EspecialidadRelacionada): boolean {
  return (
    relacion === 'sugerencia' &&
    correspondencia === null &&
    parecido !== undefined &&
    parecido === Math.round(parecido * PRECISION_PARECIDO) / PRECISION_PARECIDO
  );
}

test('la relación oficial prevalece sobre el nombre y se elige el mejor de todos los enlaces', () => {
  const datos = catalogo({
    variante: ficha('A variante', ['99990001']),
    grupo: ficha('B grupo', ['12349999']),
    incluye: ficha('C incluye', ['56780001']),
    ocupacion: ficha('Z ocupación', ['99990001', CODIGO_OCUPACION]),
  });
  datos.ocupaciones.ocupacion = [
    ['99990001', 'estrecha', 'BOMBERO DE BUQUE'],
    ['56780001', 'amplia', 'OCUPACIÓN GENERAL'],
    [CODIGO_OCUPACION, 'cercana', 'Ocupación publicada'],
    [CODIGO_OCUPACION, 'exacta', 'Ocupación publicada'],
  ];
  const resultado = formacionPara(datos, 'ocupacion', HOY);
  assert.deepEqual(
    resultado.especialidades.map(({ codigo }) => codigo),
    ['ocupacion', 'incluye', 'grupo', 'variante'],
  );
  assert.deepEqual(
    resultado.especialidades.map(({ relacion, correspondencia, ocupacionOficial }) => ({
      relacion,
      correspondencia,
      ocupacionOficial,
    })),
    [
      { relacion: 'ocupacion', correspondencia: 'exacta', ocupacionOficial: undefined },
      { relacion: 'incluye', correspondencia: 'amplia', ocupacionOficial: 'Ocupación general' },
      { relacion: 'grupo', correspondencia: 'exacta', ocupacionOficial: undefined },
      { relacion: 'variante', correspondencia: 'estrecha', ocupacionOficial: 'Bombero de buque' },
    ],
  );
});

for (const correspondencia of ['exacta', 'cercana', 'amplia', 'estrecha'] satisfies Correspondencia[]) {
  test(`la correspondencia ${correspondencia} conserva su código directo y solo abre el grupo si corresponde`, () => {
    const datos = catalogo({ directa: ficha('Directa'), grupo: ficha('Grupo', ['12349999']) });
    datos.ocupaciones.ocupacion = [[CODIGO_OCUPACION, correspondencia, 'Ocupación oficial']];
    assert.deepEqual(codigos(datos), correspondencia === 'estrecha' ? ['directa'] : ['directa', 'grupo']);
  });
}

// El mismo banco comprueba la cobertura de la cadena Python y la selección del dominio.
for (const caso of casosRelaciones) {
  test(`contrato de formación compartido: ${caso.id}`, () => {
    const { relacion } = caso;
    assert.ok(relacion === 'exacta' || relacion === 'cercana' || relacion === 'amplia' || relacion === 'estrecha');
    const datos = catalogo({ especialidad: ficha('Especialidad', [caso.ocupacion_sepe]) });
    datos.ocupaciones.ocupacion = [[caso.cosispe, relacion, 'Ocupación oficial']];
    assert.deepEqual(codigos(datos), caso.esperado ? ['especialidad'] : []);
  });
}

test('la formación del grupo usa el INE, conserva sus niveles y no cita EURES', () => {
  const datos = catalogo({ especialidad: ficha('Grupo') });
  for (const [tipo, correspondencia] of [
    ['1:1', 'exacta'],
    ['n:1', 'amplia'],
    ['1:n', 'estrecha'],
    ['n:m', 'cercana'],
  ]) {
    const resultado = formacionDelGrupo(datos, [{ cno11: GRUPO, tipo: tipo ?? '' }], HOY);
    assert.equal(resultado.nivel, 'grupo');
    assert.deepEqual(resultado.fuentes, ['SEPE', 'SOC']);
    assert.equal(resultado.especialidades[0]?.relacion, 'grupo');
    assert.equal(resultado.especialidades[0]?.correspondencia, correspondencia);
  }
});

test('los grupos repetidos conservan la correspondencia más fiable independientemente del orden', () => {
  const datos = catalogo({ especialidad: ficha('Grupo') });
  const correspondencias = [
    { cno11: GRUPO, tipo: 'n:1' },
    { cno11: GRUPO, tipo: '1:1' },
  ];
  const antes = formacionDelGrupo(datos, correspondencias, HOY);
  assert.equal(antes.especialidades[0]?.correspondencia, 'exacta');
  assert.deepEqual(formacionDelGrupo(datos, correspondencias.toReversed(), HOY), antes);
});

test('en un empate de enlaces oficiales conserva la primera ocupación publicada', () => {
  const datos = catalogo({ especialidad: ficha('Programa') });
  datos.ocupaciones.ocupacion = [
    [CODIGO_OCUPACION, 'amplia', 'Primera ocupación'],
    [CODIGO_OCUPACION, 'amplia', 'Segunda ocupación'],
  ];
  assert.equal(formacionPara(datos, 'ocupacion', HOY).especialidades[0]?.ocupacionOficial, 'Primera ocupación');
  datos.ocupaciones.ocupacion.reverse();
  assert.equal(formacionPara(datos, 'ocupacion', HOY).especialidades[0]?.ocupacionOficial, 'Segunda ocupación');
});

test('un tipo desconocido del INE rompe el invariante aunque exista en el prototipo de Object', () => {
  const datos = catalogo({ especialidad: ficha('Grupo') });
  for (const tipo of ['desconocida', 'constructor', '__proto__', 'toString']) {
    assert.throws(() => formacionDelGrupo(datos, [{ cno11: GRUPO, tipo }], HOY), InvarianteRoto);
  }
});

test('el comparador canónico selecciona una medida negativa antes que una ausencia al recortar', () => {
  const datos = catalogo({ ausente: ficha('A ausente'), medida: ficha('Z medida') });
  const resultado = formacionPara(datos, 'ocupacion', HOY, {
    maxEspecialidades: 1,
    relevancia: { especialidades: vectores({ medida: [-1, 0] }), consulta: VECTOR_CONSULTA },
  });
  assert.equal(resultado.totalEspecialidades, 2);
  assert.equal(resultado.especialidades[0]?.codigo, 'medida');
  assert.equal(resultado.especialidades[0]?.parecido, -1);
});

test('el comparador canónico decide qué código conserva un nombre duplicado antes de limitarlo', () => {
  const datos = catalogo({ ausente: ficha('MISMO PROGRAMA'), medida: ficha('Mismo programa') });
  const resultado = formacionPara(datos, 'ocupacion', HOY, {
    relevancia: { especialidades: vectores({ medida: [-1, 0] }), consulta: VECTOR_CONSULTA },
  });
  assert.equal(resultado.totalEspecialidades, 1);
  assert.deepEqual(
    resultado.especialidades.map(({ codigo }) => codigo),
    ['medida'],
  );
});

test('la formación por grupo usa el mismo comparador canónico al deduplicar y recortar', () => {
  const datos = catalogo({ ausente: ficha('Mismo programa'), medida: ficha('MISMO PROGRAMA') });
  const resultado = formacionDelGrupo(datos, [{ cno11: GRUPO, tipo: '1:1' }], HOY, {
    maxEspecialidades: 1,
    relevancia: { especialidades: vectores({ medida: [-1, 0] }), consulta: VECTOR_CONSULTA },
  });
  assert.equal(resultado.totalEspecialidades, 1);
  assert.equal(resultado.especialidades[0]?.codigo, 'medida');
  assert.equal(resultado.especialidades[0]?.parecido, -1);
});

test('los cursos conservan especialidades ocultas por nombre repetido o por el tope de fichas', () => {
  const datos = catalogo({ A: ficha('Mismo nombre'), B: ficha('MISMO NOMBRE'), C: ficha('Otro nombre') });
  datos.cursos = [curso('de-B', ['B']), curso('de-C', ['C'])];
  const resultado = formacionPara(datos, 'ocupacion', HOY, { maxEspecialidades: 0, maxCursos: 1 });
  assert.equal(resultado.especialidades.length, 0);
  assert.equal(resultado.totalEspecialidades, 2);
  assert.deepEqual(
    resultado.cursos.map(({ id, especialidad }) => ({ id, especialidad })),
    [{ id: 'de-B', especialidad: 'B' }],
  );
});

test('las sugerencias respetan umbral, límite, deduplicación, redondeo y la marca de los cursos', () => {
  const datos = catalogo({
    oficial: ficha('Nombre repetido'),
    repetida: ficha('NOMBRE REPETIDO', []),
    S1: ficha('Primera sugerencia', []),
    S2: ficha('Segunda sugerencia', []),
    S3: ficha('Tercera sugerencia', []),
    S4: ficha('Cuarta sugerencia', []),
    S5: ficha('Quinta sugerencia', []),
    inferior: ficha('Inferior al umbral', []),
  });
  datos.cursos = [curso('sugerido', ['S1']), curso('fuera', ['S5'])];
  const resultado = formacionPara(datos, 'ocupacion', HOY, {
    relevancia: {
      especialidades: vectores({
        repetida: [1, 0],
        S1: [1, 0],
        S2: VECTOR_S2,
        S3: VECTOR_S3,
        S4: VECTOR_S4,
        S5: VECTOR_S5,
        inferior: [0, 1],
      }),
      consulta: VECTOR_CONSULTA,
    },
  });
  assert.deepEqual(
    resultado.especialidades.map(({ codigo }) => codigo),
    ['oficial', 'S1', 'S2', 'S3', 'S4'],
  );
  assert.equal(resultado.totalEspecialidades, resultado.especialidades.length);
  assert.ok(resultado.especialidades.slice(1).every(esSugerenciaRedondeada));
  assert.equal(resultado.especialidades[0]?.correspondencia, 'exacta');
  assert.deepEqual(
    resultado.cursos.map(({ id, sugerencia }) => ({ id, sugerencia })),
    [{ id: 'sugerido', sugerencia: true }],
  );
});

test('el JSON expresa ausencia de correspondencia en sugerencias y conserva la correspondencia oficial', () => {
  const datos = catalogo({ O: ficha('Oficial'), S: ficha('Sugerencia', []) });
  const resultado = formacionPara(datos, 'ocupacion', HOY, {
    relevancia: { especialidades: vectores({ S: [1, 0] }), consulta: VECTOR_CONSULTA },
  });
  assert.deepEqual(
    resultado.especialidades.map(({ codigo, relacion, correspondencia }) => ({ codigo, relacion, correspondencia })),
    [
      { codigo: 'O', relacion: 'ocupacion', correspondencia: 'exacta' },
      { codigo: 'S', relacion: 'sugerencia', correspondencia: null },
    ],
  );
  assert.ok(JSON.stringify(resultado).includes('"correspondencia":null'));
});

test('tres nombres oficiales bastan para que no se añadan sugerencias aunque su parecido sea mayor', () => {
  const datos = catalogo({ A: ficha('Uno'), B: ficha('Dos'), C: ficha('Tres'), S: ficha('Sugerencia', []) });
  const resultado = formacionPara(datos, 'ocupacion', HOY, {
    relevancia: { especialidades: vectores({ S: [1, 0] }), consulta: VECTOR_CONSULTA },
  });
  assert.equal(resultado.totalEspecialidades, MIN_OFICIALES_SIN_SUGERENCIAS);
  assert.ok(resultado.especialidades.every(({ relacion }) => relacion !== 'sugerencia'));
});

test('el selector compartido usa el primer código elegido que cita el curso y deja fuera los ajenos', () => {
  const especialidades = new Map([
    ['A', { codigo: 'A', nombre: 'Primera', programa: null, sugerencia: false }],
    ['B', { codigo: 'B', nombre: 'Segunda', programa: null, sugerencia: true }],
  ]);
  const seleccionar = porEspecialidadElegida(especialidades, ({ sugerencia }) => sugerencia);
  assert.equal(seleccionar(curso('mezcla', ['fuera', 'B', 'A']))?.especialidad.codigo, 'B');
  assert.equal(seleccionar(curso('mezcla', ['fuera', 'B', 'A']))?.sugerencia, true);
  assert.equal(seleccionar(curso('ajeno', ['fuera'])), undefined);
});

test('el SOC filtra por fechas y elección y proyecta la ficha sin copiar campos internos', () => {
  const datos = catalogo({ A: ficha('Nombre del programa') });
  datos.cursos = [
    { ...curso('terminado', ['A']), inicio: '2026-09-01', fin: '2026-10-12' },
    curso('futuro', ['A']),
    { ...curso('en-curso', ['A']), inicio: '2026-10-01' },
    curso('ajeno', ['B']),
  ];
  const especialidad = fichaDeEspecialidad('A', ficha('Nombre del programa'), undefined);
  const resultado = cursosOfrecidos(
    datos,
    HOY,
    porEspecialidadElegida(new Map([['A', especialidad]]), () => false),
  );
  assert.deepEqual(
    resultado.map(({ id }) => id),
    ['futuro', 'en-curso'],
  );
  assert.equal(resultado[0]?.nombre, 'Nombre del programa');
  assert.equal(resultado[0]?.aDistancia, true);
  assert.equal(resultado[0]?.destinatarios, null);
  assert.equal(resultado[0]?.inscripcion, 'sin-verificar');
  assert.equal(Object.hasOwn(resultado[0] ?? {}, 'estado'), false);
});

test('el Consorci acompaña todas las especialidades elegidas incluso con cero fichas visibles', () => {
  const datos = catalogo({ 'A (B)': ficha('Primera especialidad') });
  const consorci: DatosConsorci = {
    fuente: 'Consorci',
    fecha_copia: HOY,
    actualizado: HOY,
    buscador: 'https://exemple.cat/buscador',
    entidades: {},
    previstas: {},
    programadas_sin_fecha: {},
    ediciones: [
      {
        id: 'edicion',
        nombre: 'Edició',
        certificado: null,
        modulo: null,
        especialidad: 'A',
        modalidad: 'Presencial',
        a_distancia: false,
        municipio: 'Cornellà',
        inicio: '2026-11-01',
        fin: '2026-12-01',
        horas: '40',
        entidad: 'Entidad',
        web: null,
        correo: null,
        telefono: null,
        contacto_oficial: null,
      },
    ],
  };
  const resultado = formacionPara(datos, 'ocupacion', HOY, { consorci, maxEspecialidades: 0 });
  assert.equal(resultado.especialidades.length, 0);
  assert.deepEqual(
    resultado.consorci?.ediciones.map(({ especialidad }) => especialidad),
    ['A (B)'],
  );
  assert.deepEqual(resultado.fuentes, ['SEPE', 'SOC', 'EURES', 'Consorci']);
  assert.equal(resultado.consorci?.ediciones[0]?.sugerencia, false);
});

test('una ocupación sin enlaces ni relevancia conserva un resultado vacío y no muta el catálogo', () => {
  const datos = catalogo({ A: ficha('Programa') });
  const antes = structuredClone(datos);
  assert.equal(formacionPara(datos, 'desconocida', HOY).totalEspecialidades, 0);
  assert.deepEqual(datos, antes);
});
