/** La v6 añade los cambios retenidos con un contrato cerrado; un estado v5 ya guardado se sigue leyendo igual. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { leerEstadoDatosPanel } from '../../src/administracion/estado-datos.js';
import type { CambioRetenidoDatos, RetenidosDatos } from '../../src/administracion/retenidos-datos.js';
import { instantaneaSalud } from '../ayudas/salud-datos.ts';

const NO_VALIDO = { message: 'Estado de datos del panel no válido' };
const VERSION_RETENIDOS = 6;
const VERSION_GUARDADA = 5;
const VERSION_DESCONOCIDA = 7;
const CIFRAS_SHA = 64;
const HUELLA_VIGENTE = 'b'.repeat(CIFRAS_SHA);
const HUELLA_EXPORTADA = 'c'.repeat(CIFRAS_SHA);

function cambio(cambios: Partial<CambioRetenidoDatos> = {}): CambioRetenidoDatos {
  return {
    archivo: 'cursos.json',
    grupo: ['cursos.json', 'cursos_indice.json'],
    perdidas: [
      { medida: 'entradas', antes: 1000, despues: 700 },
      { medida: 'cursos-soc', antes: 400, despues: 250 },
    ],
    desdeUtc: '2026-11-20T04:15:00Z',
    ultimaUtc: '2026-11-22T04:15:00.123456Z',
    vigenteSha256: HUELLA_VIGENTE,
    exportadoSha256: HUELLA_EXPORTADA,
    aceptadaUtc: null,
    ...cambios,
  };
}
function retenidos(): RetenidosDatos {
  return {
    cuarentena: { lectura: 'leida', cambios: [cambio()] },
    censoSoc: {
      lectura: 'leida',
      pendiente: { cursosOferta: 120, cursosCopia: 300, huella: HUELLA_VIGENTE, consultadoEn: '2026-11-22T04:20:00Z' },
    },
  };
}
/** Un estado v6 a partir del v5 de las pruebas, con el bloque nuevo al final, como lo escribe la plataforma. */
function estadoV6(bloque: unknown = retenidos()) {
  return { ...instantaneaSalud(), version: VERSION_RETENIDOS, retenidos: bloque };
}
/** El bloque con una parte cambiada a mano, sin pasar por los tipos: así se ensayan las formas que no valen. */
function conParte(parte: 'cuarentena' | 'censoSoc', valor: unknown) {
  return estadoV6({ ...retenidos(), [parte]: valor });
}

test('un estado v6 con un cambio retenido y el censo del SOC pendiente se lee completo e inmutable', () => {
  const entrada = estadoV6();
  const observacion = leerEstadoDatosPanel(entrada);
  assert.equal(observacion.version, VERSION_RETENIDOS);
  assert.ok(observacion.version === VERSION_RETENIDOS);
  assert.deepEqual(observacion, entrada);
  assert.deepEqual(Object.keys(observacion).at(-1), 'retenidos');
  assert.ok(Object.isFrozen(observacion.retenidos));
  assert.ok(Object.isFrozen(observacion.retenidos.cuarentena.cambios?.[0]?.perdidas));
  const aceptado = estadoV6({
    ...retenidos(),
    cuarentena: { lectura: 'leida', cambios: [cambio({ aceptadaUtc: '2026-11-21T09:00:00Z' })] },
  });
  assert.deepEqual(leerEstadoDatosPanel(aceptado), aceptado);
});

test('sin nada retenido y con partes ilegibles, el bloque se lee tal cual: «ilegible» no es «nada retenido»', () => {
  const vacio = estadoV6({
    cuarentena: { lectura: 'leida', cambios: [] },
    censoSoc: { lectura: 'leida', pendiente: null },
  });
  assert.deepEqual(leerEstadoDatosPanel(vacio), vacio);
  const ilegible = estadoV6({
    cuarentena: { lectura: 'ilegible', cambios: null },
    censoSoc: { lectura: 'ilegible', pendiente: null },
  });
  assert.deepEqual(leerEstadoDatosPanel(ilegible), ilegible);
  assert.throws(() => leerEstadoDatosPanel(conParte('cuarentena', { lectura: 'ilegible', cambios: [] })), NO_VALIDO);
  assert.throws(() => leerEstadoDatosPanel(conParte('cuarentena', { lectura: 'leida', cambios: null })), NO_VALIDO);
  const censoIlegible = { lectura: 'ilegible', pendiente: retenidos().censoSoc.pendiente };
  assert.throws(() => leerEstadoDatosPanel(conParte('censoSoc', censoIlegible)), NO_VALIDO);
});

test('un campo de más o de menos en cualquier nivel del bloque nuevo se rechaza', () => {
  assert.throws(() => leerEstadoDatosPanel(estadoV6({ ...retenidos(), otro: null })), NO_VALIDO);
  const { censoSoc: _censo, ...sinCenso } = retenidos();
  assert.throws(() => leerEstadoDatosPanel(estadoV6(sinCenso)), NO_VALIDO);
  const conCampo = { ...cambio(), motivo: 'caída' };
  assert.throws(
    () => leerEstadoDatosPanel(conParte('cuarentena', { lectura: 'leida', cambios: [conCampo] })),
    NO_VALIDO,
  );
  const perdidaConCampo = cambio({ perdidas: [{ medida: 'entradas', antes: 10, despues: 5, ruta: 'x' }] as never });
  const conPerdida = { lectura: 'leida', cambios: [perdidaConCampo] };
  assert.throws(() => leerEstadoDatosPanel(conParte('cuarentena', conPerdida)), NO_VALIDO);
  const pendiente = { ...retenidos().censoSoc.pendiente, archivo: 'oferta.json' };
  assert.throws(() => leerEstadoDatosPanel(conParte('censoSoc', { lectura: 'leida', pendiente })), NO_VALIDO);
  const { retenidos: _bloque, ...sinBloque } = estadoV6();
  assert.throws(() => leerEstadoDatosPanel(sinBloque), NO_VALIDO);
});

test('un tipo incorrecto, un valor fuera de lista o una cronología imposible se rechazan', () => {
  const invalidos: Partial<CambioRetenidoDatos>[] = [
    { perdidas: [{ medida: 'entradas', antes: '1000' as never, despues: 700 }] },
    { perdidas: [{ medida: 'cursos' as never, antes: 1000, despues: 700 }] },
    { perdidas: [{ medida: 'entradas', antes: -1, despues: 0 }] },
    { perdidas: [] },
    {
      perdidas: [
        { medida: 'entradas', antes: 10, despues: 5 },
        { medida: 'entradas', antes: 10, despues: 4 },
      ],
    },
    { archivo: '../cursos.json' },
    { grupo: ['cursos_indice.json', 'cursos.json'] },
    { grupo: ['cursos_indice.json'] },
    { desdeUtc: '2026-11-23T00:00:00Z' },
    { aceptadaUtc: '2026-11-19T00:00:00Z' },
    { desdeUtc: '2026-11-20T04:15:00+01:00' },
    { vigenteSha256: 'B'.repeat(CIFRAS_SHA) },
  ];
  for (const fila of invalidos) {
    const bloque = { lectura: 'leida', cambios: [cambio(fila)] };
    assert.throws(() => leerEstadoDatosPanel(conParte('cuarentena', bloque)), NO_VALIDO, JSON.stringify(fila));
  }
  const desordenados = { lectura: 'leida', cambios: [cambio({ archivo: 'cursos_indice.json' }), cambio()] };
  assert.throws(() => leerEstadoDatosPanel(conParte('cuarentena', desordenados)), NO_VALIDO);
  const sinPerdida = {
    cursosOferta: 300,
    cursosCopia: 300,
    huella: HUELLA_VIGENTE,
    consultadoEn: '2026-11-22T04:20:00Z',
  };
  assert.throws(
    () => leerEstadoDatosPanel(conParte('censoSoc', { lectura: 'leida', pendiente: sinPerdida })),
    NO_VALIDO,
  );
  assert.throws(() => leerEstadoDatosPanel(conParte('censoSoc', { lectura: 'quizas', pendiente: null })), NO_VALIDO);
});

test('un estado v5 ya guardado se lee como antes y no admite el bloque de la v6', () => {
  const guardado = instantaneaSalud();
  const observacion = leerEstadoDatosPanel(guardado);
  assert.equal(observacion.version, VERSION_GUARDADA);
  assert.deepEqual(observacion, guardado);
  assert.equal(Object.hasOwn(observacion, 'retenidos'), false);
  assert.throws(() => leerEstadoDatosPanel({ ...guardado, retenidos: retenidos() }), NO_VALIDO);
  assert.throws(
    () => leerEstadoDatosPanel({ ...guardado, version: VERSION_DESCONOCIDA, retenidos: retenidos() }),
    NO_VALIDO,
  );
});
