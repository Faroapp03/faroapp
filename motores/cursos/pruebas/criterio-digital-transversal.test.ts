// Criterios versionados del bloque transversal: áreas, niveles y nombres completos, sin datos externos ni IA.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DatosFormacion } from '../../../compartido/contratos/tipos-formacion.ts';
import {
  ADENDA_DIGITAL_TRANSVERSAL,
  CRITERIO_DIGITAL_TRANSVERSAL,
  CRITERIO_VIGENTE,
  NIVELES_ACTIC_DEL_TRAMO,
  tramoDelBloque,
} from '../src/criterio-digital-transversal.ts';

function especialidad(nombre: string, nivel: string): DatosFormacion['especialidades'][string] {
  return { nombre, nivel, horas: '30', familia: '-', modalidad: 'Presencial', ocupaciones: [], ficha: '' };
}

function tramo(codigo: string, nombre: string, nivel: string) {
  return tramoDelBloque(codigo, especialidad(nombre, nivel), ADENDA_DIGITAL_TRANSVERSAL);
}

test('el criterio vigente es la adenda fechada y el original conserva su definición', () => {
  assert.equal(CRITERIO_VIGENTE, ADENDA_DIGITAL_TRANSVERSAL);
  assert.deepEqual(CRITERIO_DIGITAL_TRANSVERSAL, {
    area: 'CTRD',
    nombre: 'INTELIGENCIA ARTIFICIAL',
    niveles: ['1', '2'],
  });
  assert.deepEqual(ADENDA_DIGITAL_TRANSVERSAL, {
    fecha: '2026-10-06',
    areas: ['CTRD', 'IFCT'],
    nombres: ['INTELIGENCIA ARTIFICIAL', 'IA', 'CHATGPT', 'COPILOT'],
    niveles: ['1', '2'],
    nivelesParaIrMasAlla: ['3'],
  });
});

test('el original selecciona solo CTRD de inteligencia artificial de nivel 1 o 2', () => {
  for (const [codigo, nombre, nivel, esperado] of [
    ['CTRD0035', 'Inteligencia artificial', '1', 'para-empezar'],
    ['CTRD0042 (FCOI0042)', 'INTELIGENCIA ARTIFICIAL', '2', 'para-empezar'],
    ['IFCT0019', 'INTELIGENCIA ARTIFICIAL', '2', null],
    ['CTRD0042', 'CHATGPT', '2', null],
    ['CTRD0042', 'INTELIGENCIA ARTIFICIAL', '3', null],
  ] as const) {
    assert.equal(tramoDelBloque(codigo, especialidad(nombre, nivel), CRITERIO_DIGITAL_TRANSVERSAL), esperado);
  }
});

test('las herramientas y la IA entran por su nombre y su nivel, sin preferir una marca', () => {
  assert.equal(tramo('IFCT0253', 'USO DE CHATGPT EN LA ECONOMÍA SOCIAL', '2'), 'para-empezar');
  assert.equal(
    tramo('IFCT0115', 'ADMINISTRACIÓN Y AMPLIACIÓN DE MICROSOFT 365 COPILOT - MS-4017', '3'),
    'para-ir-mas-alla',
  );
  assert.equal(tramo('IFCT0002', 'EDGE COMPUTING Y EDGE IA', '3'), 'para-ir-mas-alla');
  assert.equal(tramo('CTRD0099', 'NOCIONES DE IA (INTELIGENCIA ARTIFICIAL)', '1'), 'para-empezar');
});

test('quedan fuera desarrollo, sectores, otros niveles y nombres que solo contienen las letras IA', () => {
  for (const [codigo, nombre, nivel] of [
    ['IFCD0099', 'INTELIGENCIA ARTIFICIAL GENERATIVA', '2'],
    ['ADGD0091', 'INTELIGENCIA ARTIFICIAL PARA EMPRESAS', '2'],
    ['CTRO0009', 'INTELIGENCIA ARTIFICIAL DE USO EN ORIENTACIÓN LABORAL', '2'],
    ['IFCT0019', 'INTELIGENCIA ARTIFICIAL', 'Sin especificar'],
    ['IFCT0001', 'DISEÑO MULTIMEDIA', '2'],
    ['IFCT0001', 'CHATGPT4', '2'],
    ['IFCT0001', 'COPILOTOS', '2'],
    ['IFCT0001', 'ÁIAÉ', '2'],
  ] as const) {
    assert.equal(tramo(codigo, nombre, nivel), null, nombre);
  }
});

test('la adenda normaliza mayúsculas y tildes y reconoce separadores sin cortar palabras Unicode', () => {
  for (const nombre of ['inteligéncia artificial', 'uso: ia.', 'IA_COPILOT', '(ChatGPT)', 'IA\u0301']) {
    assert.equal(tramo('IFCT0001', nombre, '2'), 'para-empezar', nombre);
  }
  assert.equal(tramo('ifct0001', 'IA', '2'), null, 'el código oficial no se normaliza');
});

test('los niveles ACTIC se asignan a cada tramo sin alterar el criterio de especialidades', () => {
  assert.deepEqual(NIVELES_ACTIC_DEL_TRAMO, {
    'para-empezar': ['basico'],
    'para-ir-mas-alla': ['medio', 'avanzado'],
  });
});
