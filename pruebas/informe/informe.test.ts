// Composición autónoma del informe: contratos, orden, tiempos, idiomas y procedencia; sin API ni red.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formacionDeLaOcupacion as formacionDe } from '../../motores/cursos/src/index.ts';
import { MAX_TAREAS_INFORME } from '../../src/comun/protocolo-web.ts';
import { EntradaInvalida } from '../../src/dominio/errores.ts';
import { PESOS } from '../../src/dominio/franjas.ts';
import { prepararEstimacionesParaInforme } from '../../src/dominio/tareas.ts';
import type { Entrada, TareaEntrada } from '../../src/dominio/tipos-entrada.ts';
import { VERSION_INFORME } from '../../src/dominio/tipos-informe.ts';
import type { Datos } from '../../src/dominio/tipos-paquete.ts';
import { construirInformeConFormacion as construirInforme } from '../ayudas/informe-con-formacion.ts';
import { datosMinimos, ocupacion, tarea } from '../fixtures/datos-referencias-grupos.ts';

const VERSION_CATALOGO = 3;
const FECHA = '2026-10-13';
const GRUPO = '4226';
const SECUNDARIO = '4311';
const NOTAS = { baja: 0.2, media: 0.5, alta: 0.8, mayor: 0.9, fuera: 1.1 } as const;
const SEMANA = { alta: 55, media: 20, baja: 10, sinDatos: 15, pesoTotal: 11 } as const;
const POSICION = { masAltas: 1, total: 3 } as const;
const SIN_IA = { tareasPropias: 1 } as const;

/** Catálogo mínimo admitido para construir secciones completas, sin fuentes opcionales. */
function datos(): Datos {
  return datosMinimos({
    esco: { competencias: [], ocupaciones: { propia: ocupacion(GRUPO, 'Ocupación principal') } },
    oit: {
      fuente: { cita: 'OIT', aviso_adaptacion: 'Adaptación' },
      ocupaciones: {
        [GRUPO]: { titulo_en: 'Principal', media: 0, sd: null, gradiente: null },
        [SECUNDARIO]: { titulo_en: 'Second', media: NOTAS.media, sd: null, gradiente: null },
        '9999': { titulo_en: 'Empate', media: 0, sd: null, gradiente: null },
        '9998': { titulo_en: 'Sin nota', media: null, sd: null, gradiente: null },
      },
      tareas: { oficial: tarea(GRUPO, NOTAS.media, 'Official task') },
    },
    clasificaciones: {
      cno11: {},
      isco08_es: { [GRUPO]: 'Grupo principal', [SECUNDARIO]: 'Grupo secundario' },
      isco08_a_cno11: { [GRUPO]: [{ cno11: '1234', tipo: '1:1' }] },
    },
    textos: {
      aviso_traduccion: 'Traducción',
      tareas: {
        oficial: {
          corto: 'Oficial',
          texto_es: 'Official task',
          ia_podria: 'Ayudar',
          lo_tuyo: 'Decidir',
          estado: 'redacción manual',
        },
      },
      competencias_por_ocupacion: {},
    },
  });
}

/** Entrada de una ocupación ESCO, con las tareas y el tiempo confirmados. */
function entrada(tareas: TareaEntrada[], cambios: Partial<Entrada> = {}): Entrada {
  return { ocupacionEsco: 'propia', fecha: FECHA, tareas, ...cambios };
}

/** Tarea propia con nota interna; las de ejemplo no atribuyen sus frases a IA. */
function estimada(id: string, valor: number, tiempo: TareaEntrada['tiempo'] = 'algo'): TareaEntrada {
  return { id, texto: id, tiempo, estimacion: { valor, margen: [0, 1], origen: 'ejemplo' } };
}

/** Conserva el tipo y el texto concreto de un error de entrada. */
function errorDeEntrada(mensaje: string): (error: unknown) => boolean {
  return (error) => {
    assert.ok(error instanceof EntradaInvalida);
    assert.equal(error.message, mensaje);
    return true;
  };
}

test('compone Informe 2 y catálogo 3 sin fuentes opcionales ni mutación de entrada o paquete', () => {
  const paquete = datos();
  const confirmada = entrada([{ id: 'propia', texto: 'Mi tarea', tiempo: 'algo' }]);
  const antes = structuredClone({ paquete, confirmada });
  const informe = construirInforme(confirmada, paquete);
  assert.equal(informe.version, VERSION_INFORME);
  assert.equal(informe.aprendizaje.version, VERSION_CATALOGO);
  assert.equal(informe.idioma, undefined);
  assert.equal(informe.sinTraducir, undefined);
  assert.equal(informe.ocupacion.confirmada, undefined);
  assert.equal(informe.formacion, null);
  assert.equal(informe.formacionTransversal, null);
  assert.equal(informe.tareas[0]?.valor, null);
  assert.equal(informe.tareas[0]?.texto, 'Mi tarea');
  assert.ok(informe.marcaIa);
  assert.equal(informe.marcaIa.modo, 'sin-ia');
  assert.deepEqual(informe.marcaIa.conIa, []);
  assert.deepEqual({ paquete, confirmada }, antes);
  assert.deepEqual(construirInforme(confirmada, paquete), informe);
});

test('ordena por franja, tiempo y nota, conserva empates y reparte los pesos de todas las tareas', () => {
  const confirmada = entrada([
    { id: 'sin', texto: 'Sin nota', tiempo: 'algo' },
    estimada('baja', NOTAS.baja, 'poco'),
    estimada('alta-menor', NOTAS.alta, 'poco'),
    estimada('media', NOTAS.media, 'algo'),
    estimada('alta-mayor', NOTAS.mayor, 'poco'),
    estimada('alta-empate', NOTAS.mayor, 'poco'),
    estimada('alta-tiempo', NOTAS.alta, 'mucho'),
  ]);
  const informe = construirInforme(confirmada, datos());
  assert.deepEqual(
    informe.tareas.map(({ id }) => id),
    ['alta-tiempo', 'alta-mayor', 'alta-empate', 'alta-menor', 'media', 'baja', 'sin'],
  );
  assert.deepEqual(informe.semana, SEMANA);
  assert.deepEqual(
    confirmada.tareas.map(({ id }) => id),
    ['sin', 'baja', 'alta-menor', 'media', 'alta-mayor', 'alta-empate', 'alta-tiempo'],
  );
});

test('mantiene prioridad de validación y errores de tareas vacías, repetidas y exceso del límite', () => {
  const paquete = datos();
  assert.throws(
    () => construirInforme(entrada([], { ocupacionEsco: 'ausente' }), paquete),
    errorDeEntrada('Ocupación ESCO desconocida: ausente'),
  );
  assert.throws(() => construirInforme(entrada([]), paquete), errorDeEntrada('No hay tareas confirmadas'));
  const propia: TareaEntrada = { id: 'repetida', texto: 'Texto', tiempo: 'algo' };
  assert.throws(() => construirInforme(entrada([propia, propia]), paquete), errorDeEntrada('Hay tareas repetidas'));
  const limite = Array.from({ length: MAX_TAREAS_INFORME }, (_, indice) => ({ ...propia, id: `${indice}` }));
  assert.equal(construirInforme(entrada(limite), paquete).tareas.length, MAX_TAREAS_INFORME);
  assert.throws(
    () => construirInforme(entrada([...limite, propia]), paquete),
    errorDeEntrada(`Hay más de ${MAX_TAREAS_INFORME} tareas`),
  );
});

test('la ausencia de aporte inferido cuenta tareas propias y se descarta ante una estimación o un grupo propuesto', () => {
  const paquete = datos();
  const tareas: TareaEntrada[] = [
    { id: 'oficial', texto: 'Oficial', tiempo: 'poco', referencia: { tareaOit: 'oficial', relacion: 'propia' } },
    { id: 'propia', texto: 'Propia', tiempo: 'algo' },
  ];
  assert.deepEqual(construirInforme(entrada(tareas, { sinIa: true }), paquete).sinIa, SIN_IA);
  assert.equal(construirInforme(entrada(tareas, { sinIa: true, grupoPropuestoPorIa: true }), paquete).sinIa, undefined);
  assert.equal(
    construirInforme(entrada([estimada('estimada', NOTAS.media)], { sinIa: true }), paquete).sinIa,
    undefined,
  );
  assert.equal(construirInforme(entrada(tareas), paquete).sinIa, undefined);
});

test('descartar una estimación conserva tareas y tiempos sin atribuir ausencia de aporte inferido', () => {
  const paquete = datos();
  const original = entrada([estimada('retirada', NOTAS.fuera, 'mucho')], { sinIa: true });
  assert.throws(() => construirInforme(original, paquete), errorDeEntrada('Estimación fuera de su margen: retirada'));
  const preparada = prepararEstimacionesParaInforme(original);
  const informe = construirInforme(preparada.entrada, paquete, { tareasSinEstimacion: preparada.tareasSinEstimacion });
  assert.equal(informe.sinIa, undefined);
  assert.equal(informe.tareas[0]?.id, 'retirada');
  assert.equal(informe.tareas[0]?.tiempo, 'mucho');
  assert.equal(informe.tareas[0]?.motivoSinNota, 'estimacion-no-disponible');
  assert.equal(informe.tareas[0]?.valor, null);
  assert.equal(informe.semana.pesoTotal, PESOS.mucho);
  assert.equal(original.tareas[0]?.estimacion?.valor, NOTAS.fuera);
});

test('la marca catalana atribuye traducciones por original e ID tras ordenar y admite colisiones de textos', () => {
  const baja = estimada('baja', NOTAS.baja);
  const alta = estimada('alta', NOTAS.alta);
  assert.ok(baja.estimacion && alta.estimacion);
  baja.estimacion = { ...baja.estimacion, origen: 'faro', iaPodria: 'Original A' };
  alta.estimacion = { ...alta.estimacion, origen: 'faro', iaPodria: 'Texto B' };
  const informe = construirInforme(entrada([baja, alta]), datos(), {
    idioma: 'ca',
    frasesTraducidas: new Map([['Original A', 'Texto B']]),
  });
  assert.deepEqual(
    informe.tareas.map(({ id, iaPodria }) => ({ id, iaPodria })),
    [
      { id: 'alta', iaPodria: 'Texto B' },
      { id: 'baja', iaPodria: 'Texto B' },
    ],
  );
  assert.ok(informe.marcaIa);
  assert.deepEqual(
    informe.marcaIa.conIa.filter(({ accion }) => accion === 'traducido').map(({ campo, modo }) => ({ campo, modo })),
    [{ campo: '/tareas/1/iaPodria', modo: null }],
  );
  assert.equal(informe.idioma, 'ca');
  assert.ok(informe.sinTraducir?.some(({ texto, idioma }) => texto === 'Texto B' && idioma === 'es'));
});

test('conserva la posición OIT con cero y empates y confirma grupo, palabra y segundo grupo', () => {
  const paquete = datos();
  const confirmada = entrada([{ id: 'propia', texto: 'Propia', tiempo: 'poco' }], {
    ocupacionEsco: undefined,
    isco08: GRUPO,
    isco08Secundario: SECUNDARIO,
    ocupacionPersona: 'Mi oficio',
  });
  const informe = construirInforme(confirmada, paquete);
  assert.equal(informe.ocupacion.esco, null);
  assert.equal(informe.ocupacion.media, 0);
  assert.deepEqual(informe.ocupacion.posicion, POSICION);
  assert.equal(informe.ocupacion.confirmada?.palabra, 'Mi oficio');
  assert.deepEqual(informe.ocupacion.confirmada?.secundario, { isco08: SECUNDARIO, tituloIsco: 'Grupo secundario' });
  const sinMedia = datos();
  delete sinMedia.oit.ocupaciones[GRUPO];
  assert.equal(construirInforme(confirmada, sinMedia).ocupacion.posicion, null);
});

test('reúne fuentes únicas del plan y registra formación en orden antes de sus citas', () => {
  const paquete = datos();
  paquete.formacion = {
    fuentes: { sepe: 'SEPE', soc: 'SOC', eures: 'EURES' },
    fecha_cursos: FECHA,
    cobertura: {},
    ocupaciones: { propia: [['12340001', 'exacta', 'Ocupación oficial']] },
    especialidades: {
      PROGRAMA: {
        nombre: 'Programa',
        nivel: '1',
        horas: '20',
        familia: 'Familia',
        modalidad: 'Presencial',
        ocupaciones: ['12340001'],
        ficha: '',
      },
    },
    cursos: [],
  };
  const informe = construirInforme(entrada([{ id: 'propia', texto: 'Propia', tiempo: 'poco' }]), paquete, {
    idioma: 'ca',
  });
  assert.deepEqual(
    informe.formacion?.especialidades.map(({ codigo }) => codigo),
    ['PROGRAMA'],
  );
  const textos = informe.sinTraducir?.map(({ texto }) => texto) ?? [];
  assert.ok(textos.includes('Programa') && textos.includes('SEPE'));
  assert.ok(textos.indexOf('Programa') < textos.indexOf('SEPE'));
  const fuentes = informe.aprendizaje.fuentes;
  assert.equal(new Set(fuentes.map(({ texto }) => texto)).size, fuentes.length);
  assert.deepEqual(
    fuentes.filter(({ texto }) => ['SEPE', 'SOC', 'EURES'].includes(texto)),
    [
      { texto: 'SEPE', idioma: 'es' },
      { texto: 'SOC', idioma: 'es' },
      { texto: 'EURES', idioma: 'es' },
    ],
  );
  assert.equal(formacionDe(datos(), { esco: null, isco08: GRUPO, secundario: null }, FECHA), null);
});
