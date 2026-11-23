// Catálogo autónomo: identidad semántica, orden, ámbitos, límites, fuentes y ausencia de mutaciones.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formacionDelInforme } from '../../motores/cursos/src/index.ts';
import type { Idioma } from '../../src/comun/idioma.ts';
import { type ContextoDelCatalogo, catalogoAprendizaje } from '../../src/dominio/aprendizaje.ts';
import { InvarianteRoto } from '../../src/dominio/errores.ts';
import type { Entrada } from '../../src/dominio/tipos-entrada.ts';
import type { CatalogoAprendizaje, Competencia, TareaInforme } from '../../src/dominio/tipos-informe.ts';
import type { Datos } from '../../src/dominio/tipos-paquete.ts';
import {
  contextoAprendizaje,
  cursoAprendizaje,
  edicionAprendizaje,
  especialidadAprendizaje,
  FECHA_APRENDIZAJE,
  tareaAprendizaje,
} from '../fixtures/datos-aprendizaje.ts';
import { datosMinimos } from '../fixtures/datos-referencias-grupos.ts';

const COMPETENCIAS: Competencia[] = [
  { uri: 'esco:z', titulo: 'Z', relacion: 'opcional' },
  { uri: 'esco:a', titulo: 'A', relacion: 'esencial' },
];
const TOTAL_CONVOCATORIAS = 8;
const EN_EL_PLAN = 6;

function entradaDe(tareas: TareaInforme[]): Entrada {
  return {
    fecha: FECHA_APRENDIZAJE,
    tareas: tareas.map(({ id, texto, tiempo }) => ({ id, texto, tiempo })),
  };
}

function catalogo(
  contexto: ContextoDelCatalogo,
  entrada = entradaDe(contexto.tareas),
  datos = datosMinimos(),
  idioma: Idioma = 'es',
): CatalogoAprendizaje {
  return catalogoAprendizaje(entrada, datos, contexto, idioma);
}

function firma(contexto: ContextoDelCatalogo, entrada = entradaDe(contexto.tareas)): string | undefined {
  return catalogo(contexto, entrada).objetivos[0]?.huella;
}

test('sin formación el catálogo conserva versión, idioma y fechas con opciones y fuentes vacías', () => {
  assert.deepEqual(catalogo(contextoAprendizaje(), undefined, undefined, 'ca'), {
    version: 3,
    idioma: 'ca',
    fecha: FECHA_APRENDIZAJE,
    fechaCursos: null,
    objetivos: [],
    opciones: [],
    fuentes: [],
  });
});

test('cada tarea produce profesional e IA en el orden confirmado, aunque el informe cambie su orden', () => {
  const primero = tareaAprendizaje('primera', COMPETENCIAS);
  const segundo = tareaAprendizaje('segunda');
  const resultado = catalogo(contextoAprendizaje([segundo, primero]), entradaDe([primero, segundo]));
  assert.deepEqual(
    resultado.objetivos.map(({ id }) => id),
    ['primera:profesional', 'primera:ia', 'segunda:profesional', 'segunda:ia'],
  );
  assert.deepEqual(resultado.objetivos[0]?.competencias, COMPETENCIAS);
  assert.deepEqual(resultado.objetivos[1]?.competencias, []);
  assert.deepEqual(resultado.objetivos[0]?.ambitos, ['7512']);
  assert.deepEqual(resultado.objetivos[1]?.ambitos, ['7512', 'transversal']);
});

test('la huella no cambia con idioma, título de competencia, orden de competencias ni atributos personales', () => {
  const tarea = tareaAprendizaje('tarea', COMPETENCIAS);
  const contexto = contextoAprendizaje([tarea]);
  const entrada = entradaDe([tarea]);
  const traducida = {
    ...tarea,
    texto: 'Text traduït',
    competencias: COMPETENCIAS.toReversed().map((c) => ({ ...c, titulo: 'Traducció' })),
  };
  const enCa = catalogo(
    { ...contexto, tareas: [traducida] },
    { ...entrada, ocupacionPersona: 'Nombre de prueba' },
    undefined,
    'ca',
  );
  assert.equal(enCa.objetivos[0]?.huella, firma(contexto, entrada));
  assert.notEqual(enCa.objetivos[0]?.titulo, catalogo(contexto).objetivos[0]?.titulo);
});

test('la huella cambia con texto propio, ocupación, segundo grupo o evidencia de competencia', () => {
  const tarea = tareaAprendizaje('tarea', COMPETENCIAS);
  const contexto = contextoAprendizaje([tarea]);
  const original = firma(contexto);
  const segunda = COMPETENCIAS[1];
  assert.ok(segunda);
  assert.notEqual(
    firma(contexto, { ...entradaDe([tarea]), tareas: [{ id: tarea.id, texto: 'Otra tarea', tiempo: 'algo' }] }),
    original,
  );
  for (const ocupacion of [
    { esco: 'esco:ocupacion', isco08: '7512', secundario: null },
    { esco: null, isco08: '5223', secundario: null },
    { esco: null, isco08: '7512', secundario: '5223' },
  ]) {
    assert.notEqual(firma({ ...contexto, ocupacion }), original);
  }
  for (const competencia of [
    { uri: 'esco:nueva', titulo: 'Z', relacion: 'opcional' },
    { uri: 'esco:z', titulo: 'Z', relacion: 'esencial' },
    { uri: 'esco:z', titulo: 'Z', relacion: 'opcional', alcance: 'grupo' },
  ] satisfies Competencia[]) {
    assert.notEqual(firma({ ...contexto, tareas: [{ ...tarea, competencias: [competencia, segunda] }] }), original);
  }
});

test('la referencia oficial sustituye al texto para la identidad y conserva su grupo propio', () => {
  const tarea = {
    ...tareaAprendizaje('oficial'),
    referencia: { tareaOit: '5223-1', isco08: '5223', ocupacion: 'Venta', relacion: 'equivalente' as const },
  };
  const contexto = contextoAprendizaje([tarea]);
  const referencia = { tareaOit: '5223-1', relacion: 'equivalente' as const };
  const entrada: Entrada = {
    fecha: FECHA_APRENDIZAJE,
    tareas: [{ id: tarea.id, texto: 'Texto', tiempo: 'algo', referencia }],
  };
  const conOtroTexto = { ...entrada, tareas: entrada.tareas.map((original) => ({ ...original, texto: 'Traducció' })) };
  assert.equal(firma(contexto, entrada), firma(contexto, conOtroTexto));
  assert.deepEqual(
    catalogo(contexto, entrada).objetivos.map(({ grupo, ambitos }) => ({ grupo, ambitos })),
    [
      { grupo: '5223', ambitos: ['5223'] },
      { grupo: '5223', ambitos: ['5223', 'transversal'] },
    ],
  );
});

test('una tarea confirmada sin informe produce un error explícito', () => {
  const entrada: Entrada = { fecha: FECHA_APRENDIZAJE, tareas: [{ id: 'ausente', texto: 'Texto', tiempo: 'algo' }] };
  assert.throws(() => catalogo(contextoAprendizaje(), entrada), InvarianteRoto);
});

test('la oferta ocupacional conserva fuentes y orden, con seis convocatorias por fuente', () => {
  const contexto = contextoAprendizaje();
  contexto.formacion = {
    especialidades: [especialidadAprendizaje('PROGRAMA')],
    totalEspecialidades: 1,
    cursos: Array.from({ length: TOTAL_CONVOCATORIAS }, (_, i) => cursoAprendizaje(`soc-${i}`)),
    fechaCursos: FECHA_APRENDIZAJE,
    copiaAntigua: false,
    fuentes: ['SEPE', 'SOC', 'SEPE'],
    consorci: {
      ediciones: Array.from({ length: TOTAL_CONVOCATORIAS }, (_, i) => edicionAprendizaje(`edicion-${i}`)),
      previstas: [],
      fechaCopia: FECHA_APRENDIZAJE,
      copiaAntigua: false,
      buscador: '',
    },
  };
  const resultado = catalogo(contexto);
  assert.deepEqual(
    resultado.opciones.map(({ id }) => id),
    [
      '7512:sepe:PROGRAMA',
      ...Array.from({ length: EN_EL_PLAN }, (_, i) => `7512:soc:soc-${i}`),
      ...Array.from({ length: EN_EL_PLAN }, (_, i) => `7512:consorci:edicion-${i}`),
    ],
  );
  assert.deepEqual(resultado.fuentes, [
    { texto: 'SEPE', idioma: 'es' },
    { texto: 'SOC', idioma: 'es' },
  ]);
  const edicion = resultado.opciones.find(({ fuente }) => fuente === 'consorci');
  assert.equal(edicion?.enlace, null);
  assert.equal(edicion?.contactoOficial, 'https://example.test/contacto-oficial');
  assert.equal(edicion?.correo, null);
  assert.equal(edicion?.centro, null);
  assert.equal(edicion?.coste, null);
});

test('la oferta transversal conserva ambos tramos completos y deja las opciones externas detrás', () => {
  const contexto = contextoAprendizaje();
  contexto.transversal = {
    especialidades: [especialidadAprendizaje('BASICA')],
    cursos: Array.from({ length: TOTAL_CONVOCATORIAS }, (_, i) => cursoAprendizaje(`digital-${i}`)),
    ediciones: [],
    previstas: [],
    programadasSinFecha: 0,
    paraIrMasAlla: {
      especialidades: [especialidadAprendizaje('AVANZADA')],
      cursos: [],
      ediciones: [],
      previstas: [],
      programadasSinFecha: 0,
    },
    certificacion: null,
    fuenteConsorci: null,
    buscadorConsorci: null,
  };
  const resultado = catalogo(contexto);
  assert.deepEqual(
    resultado.opciones.map(({ relacion }) => relacion),
    ['transversal', ...Array.from({ length: TOTAL_CONVOCATORIAS }, () => 'transversal'), 'transversal-mas-alla'],
  );
  const ultima = resultado.opciones.at(-1);
  assert.ok(ultima);
  contexto.otrasOpciones = [{ ...ultima, id: 'externa' }];
  assert.equal(catalogo(contexto).opciones.at(-1)?.id, 'externa');
});

test('el segundo grupo obtiene formación por correspondencia oficial sin programas opcionales', () => {
  const contexto = contextoAprendizaje();
  contexto.ocupacion.secundario = '5223';
  const datos: Datos = datosMinimos({
    clasificaciones: { cno11: {}, isco08_es: {}, isco08_a_cno11: { '5223': [{ cno11: '5220', tipo: '1:1' }] } },
    formacion: {
      fuentes: { sepe: 'SEPE', soc: 'SOC', eures: 'EURES' },
      fecha_cursos: FECHA_APRENDIZAJE,
      cobertura: {},
      ocupaciones: {},
      cursos: [],
      especialidades: {
        VENTA: {
          nombre: 'Venta',
          nivel: '1',
          horas: '20',
          familia: 'Comercio',
          modalidad: 'Presencial',
          ocupaciones: ['5220'],
          ficha: '',
        },
      },
    },
  });
  // La formación de los otros grupos la calcula el motor de cursos y llega al catálogo como dato.
  const peticion = { ocupacion: contexto.ocupacion, otrosGrupos: ['5223'], hoy: FECHA_APRENDIZAJE };
  contexto.otrosGrupos = formacionDelInforme(datos, peticion).otrosGrupos;
  assert.deepEqual(
    catalogo(contexto, undefined, datos).opciones.map(({ id }) => id),
    ['5223:sepe:VENTA'],
  );
});

test('construir el catálogo no cambia entrada, tareas ni formación', () => {
  const contexto = contextoAprendizaje([tareaAprendizaje('tarea', structuredClone(COMPETENCIAS))]);
  const entrada = entradaDe(contexto.tareas);
  const antes = structuredClone({ contexto, entrada });
  Object.freeze(contexto.tareas[0]?.competencias);
  Object.freeze(contexto.tareas);
  Object.freeze(entrada.tareas);
  catalogo(contexto, entrada);
  assert.deepEqual({ contexto, entrada }, antes);
});
