// Contratos de Consorci con datos autónomos y fecha inyectada: selección, contacto, equivalencias y previstas.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type {
  DatosConsorci,
  EdicionConsorciOficial,
  EntidadConsorciOficial,
  ProgramaOficial,
} from '../../../compartido/contratos/tipos-formacion.ts';
import {
  edicionesDelConsorci,
  entidadesQueLaOfrecen,
  ordenDePrevistas,
  porPrimerCodigo,
  previstasDelConsorci,
  primerCodigo,
  programadasSinFecha,
} from '../src/formacion-consorci.ts';

const HOY = '2026-10-10';
const ELEGIDA = 'ADGD0061';
const OTRA = 'IFCT0022';
const PREVISTAS_DE_DOS_CODIGOS = 4;
const PROGRAMADAS_DE_PRUEBA = 7;
const PROGRAMADAS_CON_CLAVE_PROPIA = 3;
const PROGRAMA: ProgramaOficial = { enlace: 'https://example.test/programa.pdf', comprobado: '2026-10-06' };
const DATOS: DatosConsorci = {
  fuente: 'Consorci · datos de prueba',
  fecha_copia: '2026-10-06',
  actualizado: '2026-10-05',
  buscador: 'https://example.test/buscador',
  ediciones: [],
  previstas: {},
  entidades: {},
  programadas_sin_fecha: {},
};

function entidad(nombre: string | null = 'Entidad'): EntidadConsorciOficial {
  return {
    entidad: nombre,
    municipio: 'Reus',
    web: 'https://example.test/entidad',
    correo: 'cursos@example.test',
    telefono: '930000000',
    contacto_oficial: null,
  };
}

function edicion(id: string, cambios: Partial<EdicionConsorciOficial> = {}): EdicionConsorciOficial {
  return {
    ...entidad(),
    id,
    nombre: `Edició ${id}`,
    certificado: null,
    modulo: null,
    especialidad: ELEGIDA,
    modalidad: 'Presencial',
    a_distancia: false,
    inicio: '2026-10-20',
    fin: '2026-11-20',
    horas: '30',
    ...cambios,
  };
}

function accion(entidad: string, modalidad = 'Presencial', horas = '10') {
  return { entidad, modalidad, horas };
}

function datosCon(ediciones: EdicionConsorciOficial[]): DatosConsorci {
  return { ...DATOS, ediciones };
}

function elegidas() {
  return porPrimerCodigo([{ codigo: ELEGIDA, relacion: 'ocupacion', programa: PROGRAMA }]);
}

test('el primer código es lo anterior al primer espacio ASCII, sin normalizar el texto', () => {
  for (const [codigo, esperado] of [
    ['CTRD0046 (FCOI0046)', 'CTRD0046'],
    [ELEGIDA, ELEGIDA],
    ['', ''],
    [' CTRD0046', ''],
    ['CTRD0046  (FCOI0046)', 'CTRD0046'],
    ['CTRD0046\t(FCOI0046)', 'CTRD0046\t(FCOI0046)'],
    ['CTRD0046\u00a0(FCOI0046)', 'CTRD0046\u00a0(FCOI0046)'],
  ]) {
    assert.equal(primerCodigo(codigo ?? ''), esperado);
  }
});

test('dos especialidades con el mismo primer código conservan la primera y su programa', () => {
  const especialidadDe = porPrimerCodigo([
    { codigo: 'CTRD0046 (FCOI0046)', relacion: 'ocupacion', programa: PROGRAMA },
    { codigo: 'CTRD0046', relacion: 'sugerencia', programa: null },
  ]);
  assert.deepEqual(especialidadDe('CTRD0046'), {
    codigo: 'CTRD0046 (FCOI0046)',
    sugerencia: false,
    programa: PROGRAMA,
  });
  assert.equal(especialidadDe('CTRD0046 (FCOI0046)'), undefined);
  assert.equal(especialidadDe('NO-EXISTE'), undefined);
});

test('las ediciones no terminadas conservan todos los campos publicados de contacto y formación', () => {
  const resultado = edicionesDelConsorci(datosCon([edicion('oficial')]), elegidas(), HOY);
  assert.deepEqual(resultado, {
    ediciones: [
      {
        id: 'oficial',
        nombre: 'Edició oficial',
        especialidad: ELEGIDA,
        modalidad: 'Presencial',
        aDistancia: false,
        municipio: 'Reus',
        inicio: '2026-10-20',
        fin: '2026-11-20',
        horas: '30',
        sugerencia: false,
        momento: 'por-iniciar',
        destinatarios: 'personas-ocupadas',
        comprobado: DATOS.fecha_copia,
        contacto: {
          entidad: 'Entidad',
          web: 'https://example.test/entidad',
          correo: 'cursos@example.test',
          telefono: '930000000',
          contacto_oficial: null,
        },
        inscripcion: 'con-la-entidad',
        programa: PROGRAMA,
      },
    ],
    previstas: [],
    fechaCopia: DATOS.fecha_copia,
    copiaAntigua: false,
    buscador: DATOS.buscador,
  });
});

test('las terminadas y las de otra especialidad quedan fuera; el inicio y el fin de hoy permanecen iniciados', () => {
  const datos = datosCon([
    edicion('hoy', { inicio: HOY, fin: HOY }),
    edicion('terminada', { inicio: '2026-09-01', fin: '2026-10-09' }),
    edicion('otra', { especialidad: OTRA }),
    edicion('futura'),
    edicion('iniciada', { inicio: '2026-10-01' }),
  ]);
  assert.deepEqual(
    edicionesDelConsorci(datos, elegidas(), HOY).ediciones.map(({ id, momento }) => [id, momento]),
    [
      ['futura', 'por-iniciar'],
      ['iniciada', 'iniciado'],
      ['hoy', 'iniciado'],
    ],
  );
});

test('la marca de distancia y el municipio de una edición se copian sin deducirlos de la modalidad', () => {
  const datos = datosCon([
    edicion('marcada', { a_distancia: true, municipio: 'Girona' }),
    edicion('sin-marca', { modalidad: 'Teleformació', a_distancia: false }),
  ]);
  assert.deepEqual(
    edicionesDelConsorci(datos, elegidas(), HOY).ediciones.map(({ id, aDistancia, municipio }) => [
      id,
      aDistancia,
      municipio,
    ]),
    [
      ['marcada', true, 'Girona'],
      ['sin-marca', false, 'Reus'],
    ],
  );
});

test('una sugerencia conserva su marca y se ordena por fecha como la formación oficial', () => {
  const datos = datosCon([edicion('oficial'), edicion('sugerida', { especialidad: OTRA, inicio: '2026-10-11' })]);
  const especialidadDe = porPrimerCodigo([
    { codigo: ELEGIDA, relacion: 'ocupacion', programa: null },
    { codigo: OTRA, relacion: 'sugerencia', programa: null },
  ]);
  assert.deepEqual(
    edicionesDelConsorci(datos, especialidadDe, HOY).ediciones.map(({ id, sugerencia }) => [id, sugerencia]),
    [
      ['sugerida', true],
      ['oficial', false],
    ],
  );
});

test('las previstas conservan la primera acción de cada código completo, entidad y modalidad', () => {
  const datos: DatosConsorci = {
    ...DATOS,
    previstas: {
      CTRD0046: {
        nombre: 'Curso',
        acciones: [accion('e1', 'Presencial', '10'), accion('e1', 'Presencial', '20'), accion('e1', 'Mixta', '30')],
      },
    },
    entidades: { e1: entidad() },
  };
  assert.deepEqual(
    previstasDelConsorci(datos, ['CTRD0046 (FCOI0046)', 'CTRD0046 (FCOI0046)']).map(({ modalidad, horas }) => [
      modalidad,
      horas,
    ]),
    [
      ['Mixta', '30'],
      ['Presencial', '10'],
    ],
  );
  assert.equal(previstasDelConsorci(datos, ['CTRD0046', 'CTRD0046 (FCOI0046)']).length, PREVISTAS_DE_DOS_CODIGOS);
});

test('las previstas van por curso, entidad publicada, modalidad y municipio, dejando entidades sin nombre al final', () => {
  const datos: DatosConsorci = {
    ...DATOS,
    previstas: {
      B: { nombre: 'Curs B', acciones: [accion('sin-nombre'), accion('zeta'), accion('alfa')] },
      A: { nombre: 'Curs A', acciones: [accion('zeta')] },
    },
    entidades: { 'sin-nombre': entidad(null), zeta: entidad('Zeta'), alfa: entidad('Alfa') },
  };
  const previstas = previstasDelConsorci(datos, ['B', 'A']);
  assert.deepEqual(previstas, previstas.toSorted(ordenDePrevistas));
  assert.deepEqual(
    previstas.map(({ nombre, contacto }) => [nombre, contacto.entidad]),
    [
      ['Curs A', 'Zeta'],
      ['Curs B', 'Alfa'],
      ['Curs B', 'Zeta'],
      ['Curs B', null],
    ],
  );
  const primera = previstas[0];
  assert.ok(primera);
  assert.ok(ordenDePrevistas({ ...primera, modalidad: 'Mixta' }, primera) < 0);
  assert.ok(ordenDePrevistas({ ...primera, municipio: 'Alcanar' }, primera) < 0);
  assert.equal(ordenDePrevistas(primera, { ...primera }), 0);
});

test('una prevista conserva el contacto, la distancia por modalidad y el programa opcional de su especialidad', () => {
  const datos: DatosConsorci = {
    ...DATOS,
    previstas: { ADGD0061: { nombre: 'Curso', acciones: [accion('e1', 'Teleformació')] } },
    entidades: { e1: entidad() },
  };
  const [prevista] = previstasDelConsorci(datos, [ELEGIDA], elegidas());
  assert.deepEqual(prevista, {
    especialidad: ELEGIDA,
    nombre: 'Curso',
    modalidad: 'Teleformació',
    horas: '10',
    municipio: 'Reus',
    aDistancia: true,
    contacto: {
      entidad: 'Entidad',
      web: 'https://example.test/entidad',
      correo: 'cursos@example.test',
      telefono: '930000000',
      contacto_oficial: null,
    },
    programa: PROGRAMA,
  });
  assert.equal(previstasDelConsorci(datos, [ELEGIDA])[0]?.programa, null);
  assert.deepEqual(edicionesDelConsorci(datos, elegidas(), HOY, [ELEGIDA]).previstas, [prevista]);
});

test('sin códigos no hay previstas y una acción sin entidad registrada se omite sin perder otras', () => {
  const datos: DatosConsorci = {
    ...DATOS,
    previstas: { ADGD0061: { nombre: 'Curso', acciones: [accion('ausente'), accion('e1')] } },
    entidades: { e1: entidad() },
  };
  assert.deepEqual(previstasDelConsorci(datos, []), []);
  assert.deepEqual(previstasDelConsorci(datos, ['NO-EXISTE']), []);
  assert.equal(previstasDelConsorci(datos, [ELEGIDA]).length, 1);
  // El recuento mide los identificadores de las acciones, incluso cuando falta su ficha de contacto.
  assert.equal(entidadesQueLaOfrecen(datos, ELEGIDA), 2);
});

test('los recuentos reconocen equivalencias, cuentan entidades distintas y devuelven cero sin oferta', () => {
  const datos: DatosConsorci = {
    ...DATOS,
    previstas: { CTRD0046: { nombre: 'Curso', acciones: [accion('e1'), accion('e1', 'Mixta'), accion('e2')] } },
    programadas_sin_fecha: { CTRD0046: PROGRAMADAS_DE_PRUEBA },
  };
  assert.equal(entidadesQueLaOfrecen(datos, 'CTRD0046 (FCOI0046)'), 2);
  assert.equal(programadasSinFecha(datos, 'CTRD0046 (FCOI0046)'), PROGRAMADAS_DE_PRUEBA);
  assert.equal(entidadesQueLaOfrecen(datos, 'NO-EXISTE'), 0);
  assert.equal(programadasSinFecha(datos, 'NO-EXISTE'), 0);
});

test('el resultado respeta la vigencia canónica de la copia, incluidas las fechas imposibles', () => {
  assert.equal(edicionesDelConsorci(DATOS, elegidas(), '2026-11-05').copiaAntigua, false);
  assert.equal(edicionesDelConsorci(DATOS, elegidas(), '2026-11-06').copiaAntigua, true);
  assert.equal(edicionesDelConsorci({ ...DATOS, fecha_copia: '2026-02-30' }, elegidas(), HOY).copiaAntigua, true);
});

test('la selección no cambia ni reordena los datos recibidos', () => {
  const datos: DatosConsorci = {
    ...datosCon([edicion('segunda'), edicion('primera', { inicio: '2026-10-11' })]),
    previstas: { ADGD0061: { nombre: 'Curso', acciones: [accion('e1')] } },
    entidades: { e1: entidad() },
  };
  const antes = structuredClone(datos);
  Object.freeze(datos.ediciones);
  Object.freeze(datos.previstas.ADGD0061?.acciones);
  Object.freeze(datos.entidades.e1);
  Object.freeze(datos.previstas);
  Object.freeze(datos.entidades);
  Object.freeze(datos);
  edicionesDelConsorci(datos, elegidas(), HOY, [ELEGIDA]);
  assert.deepEqual(datos, antes);
});

test('un código ausente con nombre de propiedad heredada no es una oferta ni un recuento', () => {
  for (const codigo of ['constructor', 'toString', '__proto__']) {
    assert.deepEqual(previstasDelConsorci(DATOS, [codigo]), []);
    assert.equal(entidadesQueLaOfrecen(DATOS, codigo), 0);
  }
});

test('un recuento ausente con nombre heredado devuelve cero, nunca una función u objeto', () => {
  for (const codigo of ['constructor', 'toString', '__proto__']) {
    assert.equal(programadasSinFecha(DATOS, codigo), 0);
  }
});

test('las propiedades propias con esos mismos nombres sí se consultan', () => {
  for (const codigo of ['constructor', 'toString', '__proto__']) {
    const contacto = entidad();
    const datos: DatosConsorci = {
      ...DATOS,
      previstas: { [codigo]: { nombre: 'Curso', acciones: [accion(codigo)] } },
      entidades: { [codigo]: contacto },
      programadas_sin_fecha: { [codigo]: PROGRAMADAS_CON_CLAVE_PROPIA },
    };
    assert.equal(previstasDelConsorci(datos, [codigo]).length, 1);
    assert.deepEqual(previstasDelConsorci(datos, [codigo])[0]?.contacto, {
      entidad: contacto.entidad,
      web: contacto.web,
      correo: contacto.correo,
      telefono: contacto.telefono,
      contacto_oficial: contacto.contacto_oficial,
    });
    assert.equal(entidadesQueLaOfrecen(datos, codigo), 1);
    assert.equal(programadasSinFecha(datos, codigo), PROGRAMADAS_CON_CLAVE_PROPIA);
  }
});

test('una entidad ausente cuyo nombre coincide con una propiedad heredada no inventa un contacto', () => {
  for (const id of ['constructor', 'toString', '__proto__']) {
    const datos: DatosConsorci = {
      ...DATOS,
      previstas: { CURSO: { nombre: 'Curso', acciones: [accion(id)] } },
    };
    assert.deepEqual(previstasDelConsorci(datos, ['CURSO']), []);
    assert.equal(entidadesQueLaOfrecen(datos, 'CURSO'), 1);
  }
});

test('los registros de prototipo nulo conservan sus entradas propias', () => {
  const datos: DatosConsorci = {
    ...DATOS,
    previstas: { CURSO: { nombre: 'Curso', acciones: [accion('e001')] } },
    entidades: { e001: entidad() },
    programadas_sin_fecha: { CURSO: 0 },
  };
  Object.setPrototypeOf(datos.previstas, null);
  Object.setPrototypeOf(datos.entidades, null);
  Object.setPrototypeOf(datos.programadas_sin_fecha, null);
  assert.equal(previstasDelConsorci(datos, ['CURSO']).length, 1);
  assert.equal(entidadesQueLaOfrecen(datos, 'CURSO'), 1);
  assert.equal(programadasSinFecha(datos, 'CURSO'), 0);
});
