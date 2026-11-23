import assert from 'node:assert/strict';
import { test } from 'node:test';
import { leerSeleccion } from '../../web/scripts/recorrido/formacion/cliente.js';
import { casoDeFormacion } from '../fixtures/seleccion-formacion.ts';

const calendarios = [
  ['calendario_matricula', { tipo: 'matricula', inicio: '2026-11-01', fin: '2026-11-30' }],
  ['calendario_formacion', { tipo: 'periodo-formativo', inicio: '2026-11-01', fin: null }],
  [
    'calendario_formacion',
    { tipo: 'sesiones', sesiones: [{ inicio: '2026-11-01T10:00:00Z', fin: '2026-11-01T11:00:00Z' }] },
  ],
  ['calendario_aula', { tipo: 'ventana-acceso', inicio: null, fin: '2026-11-30' }],
] as const;
function conHecho(campo: string, valor: unknown) {
  const seleccion = structuredClone(casoDeFormacion().seleccion);
  const oferta = seleccion.camino?.recursos[0]?.oferta;
  assert.ok(oferta);
  const hecho = {
    valor,
    motivo: 'conocido',
    unidad: null,
    moneda: null,
    alcance: 'edicion',
    vigencia: { comprobado_el: '2026-10-22T10:00:00Z' },
  };
  Object.assign(oferta.unidad, { tipo: 'edicion' });
  Object.assign(oferta.hechos, { [campo]: hecho });
  return seleccion;
}
test('acepta calendarios de los tres hechos y conserva los valores sin modificaciones', () => {
  for (const [campo, calendario] of calendarios) {
    const seleccion = conHecho(campo, calendario);
    const antes = structuredClone(seleccion);
    assert.deepEqual(leerSeleccion(seleccion), antes);
    assert.deepEqual(seleccion, antes);
  }
});
test('rechaza calendarios malformados, campo equivocado y objetos en otros hechos', () => {
  for (const [campo, valor] of [
    ['calendario_formacion', { tipo: 'periodo-formativo', inicio: '2026-02-30', fin: null }],
    ['calendario_formacion', { tipo: 'sesiones', sesiones: [] }],
    ['calendario_matricula', { tipo: 'ventana-acceso', inicio: '2026-11-01', fin: null }],
    ['modalidad', { tipo: 'periodo-formativo', inicio: '2026-11-01', fin: null }],
  ] as const) {
    assert.throws(() => leerSeleccion(conHecho(campo, valor)), /Respuesta de formación incompatible/u);
  }
});

test('rechaza un calendario con metadatos de hecho incompletos o unidad incompatible', () => {
  const valor = { tipo: 'matricula', inicio: '2026-11-01', fin: null };
  for (const cambio of [
    { motivo: 'no_consta_en_evidencia' },
    { alcance: 'unidad' },
    { vigencia: null },
    { vigencia: { comprobado_el: 'fecha inválida' } },
    { unidad: 'h' },
    { extra: true },
  ]) {
    const seleccion = conHecho('calendario_matricula', valor);
    const hecho = seleccion.camino?.recursos[0]?.oferta.hechos.calendario_matricula;
    assert.ok(hecho);
    Object.assign(hecho, cambio);
    assert.throws(() => leerSeleccion(seleccion), /Respuesta de formación incompatible/u);
  }
  const seleccion = conHecho('calendario_matricula', valor);
  const unidad = seleccion.camino?.recursos[0]?.oferta.unidad;
  assert.ok(unidad);
  Object.assign(unidad, { tipo: 'recurso' });
  assert.throws(() => leerSeleccion(seleccion), /Respuesta de formación incompatible/u);
});
