// La bolsa reúne cursos de seis fuentes, respeta sus condiciones y ordena primero lo que se puede empezar.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Datos } from '../../../src/dominio/tipos-paquete.ts';
import { cargarDatos } from '../../../src/plataforma/node/datos.ts';
import { bolsaDeCursos, type CursoDeLaBolsa } from '../src/bolsa-de-cursos.ts';

const HOY = '2026-10-21';
const CIFRAS_SHA256 = 64;
const ACTIVIDADES_CIBERNARIUM = 3;
const contacto = {
  entidad: 'Entidad sintética',
  municipio: 'Cornellà',
  web: 'https://entidad.example/',
  correo: null,
  telefono: null,
  contacto_oficial: null,
};
const cursoSoc = {
  nombre: 'Curso sintético',
  especialidades: ['PRUEBA'],
  modalidad: 'presencial',
  municipio: 'Cornellà',
  inicio: '2026-10-01',
  fin: '2026-10-31',
  horas: '10',
  estado: 'en inscripció',
  centro: 'Centro sintético',
  enlace: 'https://soc.example/curso',
};
const citilab = {
  titulo: 'Curso sintético',
  enlace: 'https://citilab.example/curso',
  modificado: '2026-10-01',
  publico: ['adults'],
  temas: ['digital'],
  trata_ia: false,
  modalidad: 'presencial' as const,
  requisitos: null,
  horas: 10,
  sesiones: 2,
  inicio: '2026-10-01',
  fin: '2026-10-31',
  horario: null,
  periodico: false,
  coste: { gratuito: true, precio_eur: 0, carnet_citilaber: false, descuento_paro_pct: null },
  lugar: null,
};
const abierta = {
  titulo: 'Curso abierto sintético',
  entidad: 'Entidad sintética',
  titular: 'publico' as const,
  enlace: 'https://abierta.example/curso',
  idioma: 'es' as const,
  traduccion_automatica: false,
  tema: 'digital' as const,
  area_digcomp: null,
  nivel: 'iniciacion' as const,
  horas: 10,
  a_tu_ritmo: true,
  inicio: '2026-01-01',
  fin: null,
  dirigido_a: null,
  certificado: null,
  comprobado: '2026-10-01',
};
const edicionCibernarium = {
  idFuente: 'abierta',
  identidadInterna: 'identidad-sintetica',
  vinculacion: 'id-edicion-publicado' as const,
  modalidad: 'en-linea' as const,
  sincronia: 'a-tu-ritmo' as const,
  horas: 10,
  duracionPublicada: '10 horas',
  idioma: 'ca',
  disponibilidad: { desde: '2026-10-01', hasta: '2026-10-31' },
  sesiones: [],
  inscripcion: { continuaDeclarada: null, apertura: null, botonVisible: true, estado: 'abierta' as const },
  plazas: null,
  evidencia: {
    url: 'https://cibernarium.example/curso',
    observadoUTC: '2026-10-21T10:00:00Z',
    origenFechaObservacion: 'consulta-http' as const,
    sha256Captura: 'a'.repeat(CIFRAS_SHA256),
    normalizacionFechas: 'intervalo-publicado' as const,
    localizador: 'curso',
  },
};
const DATOS: Datos = {
  esco: { competencias: [], ocupaciones: {} },
  oit: { fuente: { cita: 'OIT', aviso_adaptacion: '' }, ocupaciones: {}, tareas: {} },
  clasificaciones: { cno11: {}, isco08_es: {}, isco08_a_cno11: {} },
  cambra: {
    fuente: '',
    genero: { mujeres_exposicion_media_o_alta: 0, hombres_exposicion_media_o_alta: 0, pagina_impresa: 0 },
  },
  textos: { tareas: {}, competencias_por_ocupacion: {}, aviso_traduccion: '' },
  formacion: {
    fuentes: { sepe: 'SEPE', soc: 'SOC', eures: 'EURES' },
    fecha_cursos: HOY,
    cobertura: {},
    ocupaciones: {},
    especialidades: {},
    cursos: [
      { ...cursoSoc, id: 'empezado' },
      { ...cursoSoc, id: 'futuro', inicio: '2026-11-01', fin: '2026-11-30' },
      { ...cursoSoc, id: 'terminado', fin: '2026-10-20' },
      { ...cursoSoc, id: 'desfasado', nombre: 'Curso sobre covid', inicio: '2026-11-01', fin: '2026-11-30' },
    ],
  },
  consorci: {
    fuente: 'Fuente sintética',
    fecha_copia: HOY,
    actualizado: HOY,
    buscador: 'https://consorci.example/',
    ediciones: [
      {
        id: 'empezado',
        nombre: 'Curso sintético',
        certificado: null,
        modulo: null,
        especialidad: 'PRUEBA',
        modalidad: 'presencial',
        a_distancia: false,
        inicio: '2026-10-01',
        fin: '2026-10-31',
        horas: '10',
        ...contacto,
      },
    ],
    entidades: { entidad: contacto },
    previstas: {
      PREVISTA: { nombre: 'Curso previsto', acciones: [{ entidad: 'entidad', modalidad: 'presencial', horas: '10' }] },
    },
    programadas_sin_fecha: {},
  },
  citilab: {
    fuente: 'Fuente sintética',
    copia: HOY,
    listado: 'https://citilab.example/',
    cursos: [
      { ...citilab, id: 1 },
      { ...citilab, id: 2, coste: { ...citilab.coste, gratuito: false, precio_eur: 20 } },
    ],
  },
  fundae: {
    cita: 'Fuente sintética',
    consulta: HOY,
    buscador: 'https://fundae.example/',
    condiciones: 'https://fundae.example/',
    ediciones: [
      {
        id: 'prueba',
        especialidad: 'PRUEBA',
        nombre: 'Curso sintético',
        horas: 10,
        nivel_digital: 'Intermedio',
        entidad: 'Entidad sintética',
        preinscripcion: { inicio: '2026-10-01', fin: '2026-10-31' },
        colectivos: ['asalariados', 'autonomos'],
        sector: 'INTERSECTORIAL',
        programa: 'https://fundae.example/programa',
      },
    ],
  },
  formacionAbierta: {
    fuente: 'Fuente sintética',
    criterio: 'Cursos abiertos',
    revision: HOY,
    fichas: [
      { ...abierta, id: 'publica' },
      { ...abierta, id: 'terminada', fin: '2026-10-20' },
      { ...abierta, id: 'privada', titular: 'no-publico' },
    ],
  },
  barcelonaActiva: {
    cita: 'Fuente sintética',
    consulta: HOY,
    url_ficha: 'https://ocupaciones.example/',
    url_actividad: 'https://cibernarium.example/curso?id=',
    ocupaciones: {},
    cibernarium: [
      {
        id: 'abierta',
        titulo: 'IA abierta',
        inicio: '2026-10-01',
        fin: '2026-10-31',
        modalidad: 'en-linea',
        edicion: edicionCibernarium,
      },
      { id: 'futura', titulo: 'IA futura', inicio: '2026-11-01', fin: '2026-11-30', modalidad: 'presencial' },
      {
        id: 'sin-confirmar',
        titulo: 'IA sin confirmar',
        inicio: '2026-10-01',
        fin: '2026-10-31',
        modalidad: 'en-linea',
        edicion: {
          ...edicionCibernarium,
          idFuente: 'sin-confirmar',
          inscripcion: { ...edicionCibernarium.inscripcion, botonVisible: false, estado: null },
        },
      },
    ],
  },
};
const BOLSA = bolsaDeCursos(DATOS, HOY);
const FUENTES: readonly CursoDeLaBolsa['fuente'][] = ['soc', 'consorci', 'fundae', 'citilab', 'cibernarium', 'abierta'];
const deLaFuente = (fuente: CursoDeLaBolsa['fuente'], bolsa = BOLSA) => bolsa.filter((c) => c.fuente === fuente);
const ficha = (id: string, bolsa = BOLSA) => {
  const curso = bolsa.find((c) => c.id === id);
  assert.ok(curso, id);
  return curso;
};
const aviso = {
  es: 'Ya ha empezado. Consulta con el centro si aún admite inscripciones.',
  ca: 'Ja ha començat. Consulta amb el centre si encara admet inscripcions.',
};

test('bolsa: las seis fuentes, una ficha por identificador y ningún programa del catálogo', () => {
  assert.deepEqual([...new Set(BOLSA.map((c) => c.fuente))].sort(), [...FUENTES].sort());
  assert.ok(BOLSA.every((c) => c.tipo === 'curso' || c.tipo === 'prevista'));
  assert.equal(new Set(BOLSA.map((c) => c.id)).size, BOLSA.length);
  for (const c of BOLSA) {
    assert.ok(c.id.startsWith(`${c.fuente}:`) || c.id.startsWith('consorci-prevista:'), c.id);
    assert.ok(c.nombre, c.id);
  }
});

test('bolsa: el momento sale del calendario y la inscripción, de su evidencia; lo terminado, fuera', () => {
  for (const id of ['soc:empezado', 'consorci:empezado', 'citilab:1']) {
    const c = ficha(id);
    assert.equal(c.momento, 'iniciado');
    assert.equal(c.inscripcion, 'sin-verificar');
    assert.equal(c.conFecha, false);
    assert.equal(c.plazo, null);
    assert.deepEqual(c.aviso, aviso);
  }
  assert.equal(ficha('soc:futuro').momento, 'por-iniciar');
  assert.equal(ficha('consorci-prevista:PREVISTA').momento, 'sin-fecha');
  assert.ok(!BOLSA.some((c) => c.id === 'soc:terminado'));
  assert.ok(!bolsaDeCursos(DATOS, '2099-01-01').some((c) => c.id === 'soc:empezado'));
  assert.ok(BOLSA.filter((c) => c.momento !== 'iniciado').every((c) => c.aviso === undefined));
});

test('bolsa: una inscripción confirmada no se degrada al empezar; sin confirmar, no se presenta como inscribible', () => {
  const confirmada = ficha('cibernarium:abierta');
  assert.equal(confirmada.momento, 'iniciado');
  assert.equal(confirmada.inscripcion, 'confirmada');
  assert.equal(confirmada.conFecha, true);
  assert.equal(confirmada.aviso, undefined);
  for (const c of BOLSA.filter((x) => x.momento === 'iniciado' && x.inscripcion !== 'confirmada')) {
    assert.equal(c.conFecha, false, c.id);
  }
});

test('bolsa: lo con fecha, antes; lo empezado sin confirmar, al final, sin desplazar a lo que admite inscripción', () => {
  const primeraSinFecha = BOLSA.findIndex((c) => !c.conFecha);
  assert.ok(primeraSinFecha > 0);
  assert.ok(BOLSA.slice(primeraSinFecha).every((c) => !c.conFecha));
  const primeraConAviso = BOLSA.findIndex((c) => c.aviso !== undefined);
  assert.ok(primeraConAviso > primeraSinFecha);
  assert.ok(BOLSA.slice(primeraConAviso).every((c) => c.aviso !== undefined));
  assert.ok(BOLSA.slice(0, primeraConAviso).some((c) => c.momento === 'por-iniciar'));
});

test('bolsa: FUNDAE, a distancia, con su plazo y a quién admite, mientras la preinscripción está abierta', () => {
  const c = ficha('fundae:prueba');
  assert.equal(deLaFuente('fundae').length, 1);
  assert.equal(c.nombre, 'Curso sintético');
  assert.equal(c.especialidad, 'PRUEBA');
  assert.equal(c.aDistancia, true);
  assert.equal(c.conFecha, true);
  assert.equal(c.plazo, '2026-10-31');
  assert.equal(c.paraQuien, 'Para personas asalariadas y autónomas');
  assert.equal(c.enlace, 'https://experienciafundae.es/ficha-curso/oferta/2/PRUEBA');
  assert.equal(c.enlaceEs, 'curso');
  assert.equal(deLaFuente('fundae', bolsaDeCursos(DATOS, '2026-09-30')).length, 0);
  assert.equal(deLaFuente('fundae', bolsaDeCursos(DATOS, '2026-11-01')).length, 0);
});

test('bolsa: cada enlace dice qué abre; el del Consorci es la web de la primera entidad, nunca el curso', () => {
  for (const c of BOLSA) {
    assert.equal(c.enlaceEs === null, c.enlace === null, c.id);
  }
  const consorci = deLaFuente('consorci').filter((c) => c.enlace);
  assert.equal(consorci.length, 2);
  for (const c of consorci) {
    assert.equal(c.enlaceEs, 'entidad', c.id);
    assert.deepEqual(c.entidades, ['Entidad sintética']);
    assert.equal(c.enlace, 'https://entidad.example/');
  }
  for (const fuente of ['soc', 'fundae', 'cibernarium', 'abierta'] as const) {
    assert.ok(
      deLaFuente(fuente).every((c) => c.enlaceEs === 'curso'),
      fuente,
    );
  }
});

test('bolsa: la oferta del despliegue decide la formación abierta y los cursos de pago de Citilab', () => {
  assert.deepEqual(
    deLaFuente('abierta').map((c) => c.id),
    ['abierta:publica'],
  );
  assert.ok(deLaFuente('abierta').every((c) => c.aDistancia && c.conFecha));
  const sinAbierta = bolsaDeCursos(DATOS, HOY, { formacionAbierta: 'no', citilabDePago: false });
  assert.equal(deLaFuente('abierta', sinAbierta).length, 0);
  assert.deepEqual(
    deLaFuente('abierta', bolsaDeCursos(DATOS, '2027-03-01')).map((c) => c.id),
    ['abierta:publica'],
  );
  assert.deepEqual(
    deLaFuente('citilab').map((c) => c.id),
    ['citilab:1'],
  );
  const conPago = bolsaDeCursos(DATOS, HOY, { formacionAbierta: 'publica', citilabDePago: true });
  assert.deepEqual(
    deLaFuente('citilab', conPago)
      .map((c) => c.id)
      .sort(),
    ['citilab:1', 'citilab:2'],
  );
  const gratis = bolsaDeCursos(DATOS, HOY, { formacionAbierta: 'gratis', citilabDePago: false });
  assert.deepEqual(
    deLaFuente('abierta', gratis)
      .map((c) => c.id)
      .sort(),
    ['abierta:privada', 'abierta:publica'],
  );
});

test('bolsa: el Cibernàrium, todo de IA; con fecha lo que no ha empezado o tiene hoy la inscripción abierta', () => {
  const cibernarium = deLaFuente('cibernarium');
  assert.equal(cibernarium.length, ACTIVIDADES_CIBERNARIUM);
  assert.ok(cibernarium.every((c) => c.conIa && c.enlace?.startsWith('https://cibernarium.')));
  for (const c of cibernarium) {
    const confirmada = c.edicion?.inscripcion.botonVisible === true && c.edicion.inscripcion.estado === 'abierta';
    assert.equal(c.inscripcion, confirmada ? 'confirmada' : 'sin-verificar', c.id);
    assert.equal(c.conFecha, c.momento === 'por-iniciar' || confirmada, c.id);
  }
  assert.equal(ficha('cibernarium:futura').conFecha, true);
  assert.equal(ficha('cibernarium:sin-confirmar').conFecha, false);
  assert.ok(BOLSA.every((c) => !/covid/iu.test(c.nombre)));
});

function comprobarEntradaBasica(datos: Datos, c: CursoDeLaBolsa): void {
  if (c.fuente === 'soc') {
    const entrada = datos.formacion?.cursos.find((v) => `soc:${v.id}` === c.id);
    assert.ok(entrada, c.id);
    assert.equal(c.inicio, entrada.inicio, c.id);
    assert.equal(c.fin, entrada.fin, c.id);
    assert.equal(c.inscripcion, 'sin-verificar', c.id);
  } else if (c.fuente === 'citilab') {
    const entrada = datos.citilab?.cursos.find((v) => `citilab:${v.id}` === c.id);
    assert.ok(entrada, c.id);
    assert.equal(entrada.coste.gratuito, true, c.id);
    assert.equal(c.fin, entrada.fin, c.id);
  } else if (c.fuente === 'abierta') {
    const entrada = datos.formacionAbierta?.fichas.find((v) => `abierta:${v.id}` === c.id);
    assert.ok(entrada, c.id);
    assert.equal(entrada.titular, 'publico', c.id);
    assert.equal(c.fin, entrada.fin, c.id);
    assert.equal(c.inscripcion, 'confirmada', c.id);
  }
}

function comprobarEntradaRestante(datos: Datos, c: CursoDeLaBolsa, hoy: string): void {
  if (c.fuente === 'fundae') {
    const entrada = datos.fundae?.ediciones.find((v) => `fundae:${v.id}` === c.id);
    assert.ok(entrada, c.id);
    assert.ok(entrada.preinscripcion.inicio <= hoy && hoy <= entrada.preinscripcion.fin, c.id);
    assert.equal(c.plazo, entrada.preinscripcion.fin, c.id);
  } else if (c.fuente === 'cibernarium') {
    assert.ok(
      datos.barcelonaActiva?.cibernarium.some((v) => `cibernarium:${v.id}` === c.id),
      c.id,
    );
    assert.equal(c.conIa, true, c.id);
  } else if (c.fuente === 'consorci' && c.tipo === 'prevista') {
    assert.ok(datos.consorci?.previstas[c.especialidad], c.id);
    assert.equal(c.inicio, null, c.id);
    assert.equal(c.fin, null, c.id);
  } else if (c.fuente === 'consorci') {
    const entrada = datos.consorci?.ediciones.find((v) => `consorci:${v.id}` === c.id);
    assert.ok(entrada, c.id);
    assert.equal(c.inicio, entrada.inicio, c.id);
    assert.equal(c.fin, entrada.fin, c.id);
    assert.equal(c.inscripcion, 'sin-verificar', c.id);
  }
}

test('bolsa: el paquete real conserva las invariantes para sus ofertas vigentes', () => {
  const datos = cargarDatos(fileURLToPath(new URL('../../../datos/', import.meta.url)));
  const fechas = [
    datos.formacion?.fecha_cursos,
    datos.consorci?.fecha_copia,
    datos.citilab?.copia,
    datos.fundae?.consulta,
    datos.formacionAbierta?.revision,
    datos.barcelonaActiva?.consulta,
  ].filter((fecha): fecha is string => typeof fecha === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(fecha));
  const hoy = fechas.sort().at(-1);
  assert.ok(hoy, 'El paquete conserva la fecha de alguna copia de formación');
  const bolsa = bolsaDeCursos(datos, hoy);
  assert.equal(new Set(bolsa.map((c) => c.id)).size, bolsa.length);
  for (const c of bolsa) {
    assert.ok(FUENTES.includes(c.fuente), c.id);
    assert.ok(c.id.startsWith(`${c.fuente}:`) || c.id.startsWith('consorci-prevista:'), c.id);
    assert.ok(c.nombre, c.id);
    assert.ok(c.tipo === 'curso' || c.tipo === 'prevista', c.id);
    assert.equal(c.enlaceEs === null, c.enlace === null, c.id);
    assert.ok(!c.fin || c.fin >= hoy, c.id);
    assert.ok(!/covid/iu.test(c.nombre), c.id);
    comprobarEntradaBasica(datos, c);
    comprobarEntradaRestante(datos, c, hoy);
    if (c.fuente === 'consorci' && c.enlace) {
      assert.equal(c.enlaceEs, 'entidad', c.id);
      assert.ok(c.entidades.length > 0, c.id);
    }
    if (c.inscripcion === 'confirmada') {
      assert.equal(c.conFecha, true, c.id);
      assert.equal(c.aviso, undefined, c.id);
    } else if (c.momento === 'iniciado') {
      assert.equal(c.conFecha, false, c.id);
      assert.deepEqual(c.aviso, aviso, c.id);
    }
  }
});
