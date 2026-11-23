// Concordancia, interpolación y espacios que usan los consumidores del informe en los dos idiomas.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FUENTE_DE_LA_OCUPACION, TEXTOS_INFORME_ES } from '../../src/dominio/textos-informe.ts';
import { TEXTOS_INFORME_CA } from '../../src/dominio/textos-informe-ca.ts';

const GRUPO = { isco08: '7512', tituloIsco: 'Grupo' };
const SECUNDARIO = { isco08: '5223', tituloIsco: 'Segundo' };

const CASOS_CONFIRMACION = [
  { secundario: null, tituloEsco: null, finalEs: 'o', finalCa: 't' },
  { secundario: null, tituloEsco: 'Oficio', finalEs: 'a', finalCa: 'da' },
  { secundario: SECUNDARIO, tituloEsco: null, finalEs: 'os', finalCa: 'ts' },
  { secundario: SECUNDARIO, tituloEsco: 'Oficio', finalEs: 'os', finalCa: 'ts' },
];
const NUMERO_PASOS_DEL_PLAN = 3;

test('una estimación no disponible conserva el texto aprobado en cada idioma', () => {
  assert.equal(TEXTOS_INFORME_ES.origen.estimacionNoDisponible, 'Estimación no disponible');
  assert.equal(TEXTOS_INFORME_CA.origen.estimacionNoDisponible, 'Estimació no disponible');
});

function gruposNombrados(secundario: typeof SECUNDARIO | null): { es: string; ca: string } {
  return {
    es: secundario ? 'Grupos 7512 · Grupo y 5223 · Segundo' : 'Grupo 7512 · Grupo',
    ca: secundario ? 'Grups 7512 · Grupo i 5223 · Segundo' : 'Grup 7512 · Grupo',
  };
}

test('la confirmación concuerda con grupo, ocupación o dos grupos', () => {
  for (const { secundario, tituloEsco, finalEs, finalCa } of CASOS_CONFIRMACION) {
    const datos = { grupo: GRUPO, secundario, tituloEsco, palabra: 'Palabra', propuestoPorIa: false };
    const grupos = gruposNombrados(secundario);
    const sujetoEs = tituloEsco ? `Ocupación «Oficio» · ${grupos.es}` : grupos.es;
    const sujetoCa = tituloEsco ? `Ocupació «Oficio» · ${grupos.ca}` : grupos.ca;
    assert.equal(
      TEXTOS_INFORME_ES.confirmacion(datos),
      `${sujetoEs}, confirmad${finalEs} por ti a partir de «Palabra»`,
    );
    assert.equal(TEXTOS_INFORME_CA.confirmacion(datos), `${sujetoCa}, confirma${finalCa} per tu a partir de «Palabra»`);
  }
});

test('la propuesta de IA habla del grupo y conserva la elección de la ocupación por la persona', () => {
  for (const { secundario, tituloEsco } of CASOS_CONFIRMACION) {
    const grupos = gruposNombrados(secundario);
    const finalIaEs = secundario ? 'os' : 'o';
    const finalIaCa = secundario ? 'ts' : 't';
    const escoEs = tituloEsco ? ' · Ocupación «Oficio», elegida por ti' : '';
    const escoCa = tituloEsco ? ' · Ocupació «Oficio», triada per tu' : '';
    const datos = { grupo: GRUPO, secundario, tituloEsco, palabra: 'Palabra', propuestoPorIa: true };
    assert.equal(
      TEXTOS_INFORME_ES.confirmacion(datos),
      `${grupos.es}, propuest${finalIaEs} por la IA de Faro y confirmad${finalIaEs} por ti a partir de «Palabra»${escoEs}`,
    );
    assert.equal(
      TEXTOS_INFORME_CA.confirmacion(datos),
      `${grupos.ca}, proposa${finalIaCa} per la IA de Faro i confirma${finalIaCa} per tu a partir de «Palabra»${escoCa}`,
    );
  }
});

test('una confirmación sin palabra ni ocupación omite los fragmentos opcionales', () => {
  const datos = { grupo: GRUPO, secundario: null, tituloEsco: null, palabra: null, propuestoPorIa: false };
  assert.equal(TEXTOS_INFORME_ES.confirmacion(datos), 'Grupo 7512 · Grupo, confirmado por ti');
  assert.equal(TEXTOS_INFORME_CA.confirmacion(datos), 'Grup 7512 · Grupo, confirmat per tu');
  assert.equal(
    TEXTOS_INFORME_ES.confirmacion({ ...datos, palabra: '', tituloEsco: '' }),
    TEXTOS_INFORME_ES.confirmacion(datos),
  );
  assert.equal(
    TEXTOS_INFORME_CA.confirmacion({ ...datos, palabra: '', tituloEsco: '' }),
    TEXTOS_INFORME_CA.confirmacion(datos),
  );
});

test('los caminos de cambio distinguen singular, plural y tiempo dedicado en los dos idiomas', () => {
  const casos = [
    [false, false, 'Tareas tiene un potencial de cambio alto.', 'Tasques té un potencial de canvi alt.'],
    [
      false,
      true,
      'Tareas tiene un potencial de cambio alto y le dedicas mucho tiempo.',
      'Tasques té un potencial de canvi alt i hi dediques molt de temps.',
    ],
    [true, false, 'Tareas tienen un potencial de cambio alto.', 'Tasques tenen un potencial de canvi alt.'],
    [
      true,
      true,
      'Tareas tienen un potencial de cambio alto y les dedicas mucho tiempo.',
      'Tasques tenen un potencial de canvi alt i hi dediques molt de temps.',
    ],
  ] as const;
  for (const [varias, dedicaMucho, esperadoEs, esperadoCa] of casos) {
    assert.equal(TEXTOS_INFORME_ES.caminos.porqueMasCambia('Tareas', varias, dedicaMucho), esperadoEs);
    assert.equal(TEXTOS_INFORME_CA.caminos.porqueMasCambia('Tasques', varias, dedicaMucho), esperadoCa);
  }
});

test('los caminos de exposición baja conservan singular y plural en los dos idiomas', () => {
  for (const varias of [false, true]) {
    assert.equal(
      TEXTOS_INFORME_ES.caminos.porqueSigueSiendoTuyo('Tareas', varias),
      `Tareas ${varias ? 'están' : 'está'} en la franja de exposición baja a la IA generativa.`,
    );
    assert.equal(
      TEXTOS_INFORME_CA.caminos.porqueSigueSiendoTuyo('Tasques', varias),
      `Tasques ${varias ? 'estan' : 'està'} a la franja d’exposició baixa a la IA generativa.`,
    );
  }
});

test('las citas interpolan los datos y conservan los espacios con que tareas y hallazgos unen fragmentos', () => {
  const cita = { cita: 'Texto «citado»', indice: 2, isco08: '1234', titulo: 'Grupo' };
  assert.equal(
    TEXTOS_INFORME_ES.origen.oficialDelGrupo(cita),
    'OIT 2025 · tarea oficial «Texto «citado»», tarea 2 del grupo 1234 · Grupo',
  );
  assert.equal(
    TEXTOS_INFORME_CA.origen.oficialDelGrupo(cita),
    'OIT 2025 · tasca oficial «Texto «citado»», tasca 2 del grup 1234 · Grupo',
  );
  for (const textos of [TEXTOS_INFORME_ES, TEXTOS_INFORME_CA]) {
    assert.ok(textos.origen.incierta.endsWith('. '));
    assert.ok(textos.hallazgos.deLasQueTienenDatos.startsWith(' '));
    assert.equal(textos.plan.length, NUMERO_PASOS_DEL_PLAN);
    assert.ok(textos.contexto.avisoCenso.includes('61,2\u00a0%'));
    assert.ok(textos.contexto.avisoCenso.includes('18,8\u00a0%'));
  }
  assert.deepEqual(FUENTE_DE_LA_OCUPACION, { contratos: 61.2, imputada: 18.8 });
});
