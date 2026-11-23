// Contrato autónomo de nombres, partes obligatorias y preparación de datos en memoria.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cargarIndice, type VectoresGuardados } from '../../src/comun/vectores.ts';
import type { DatosEsco } from '../../src/dominio/tipos-paquete.ts';
import {
  ARCHIVO_DE_CADA_PARTE,
  esObligatoria,
  MANIFIESTO,
  PARTES,
  prepararParte,
} from '../../src/plataforma/archivos-del-paquete.ts';

const ARCHIVOS = [
  'esco.json',
  'oit.json',
  'clasificaciones.json',
  'exposicion-cambra.json',
  'textos.json',
  'vectores-oit.json',
  'correspondencia-eures.json',
  'formacion.json',
  'consorci.json',
  'enlaces-comprobados.json',
  'citilab.json',
  'formacion-abierta.json',
  'barcelonactiva.json',
  'fundae.json',
  'comarcas.json',
  'temarios.json',
  'vectores-formacion.json',
  'cataluna.json',
  'ocupados.json',
  'censo.json',
  'tich.json',
  'salarios.json',
  'observatori.json',
  'mercado.json',
  'empresas.json',
  'sectores.json',
  'metodos.json',
  'catalan.json',
  'acreditacion.json',
  'perfiles-sepe.json',
  'certificados-sepe-2016.json',
  'sepe-necesidades.json',
  'actic.json',
];
const DIMENSIONES = 2;
const ESCALA = 0.5;

/** Un vector de dos int8, con escala y base64 canónico. */
function vectores(id: string, datos: string): VectoresGuardados {
  return { modelo: 'modelo-autónomo', dimensiones: DIMENSIONES, ids: [id], escalas: [ESCALA], datos };
}

test('la tabla conserva nombres, orden de carga y las cinco partes obligatorias', () => {
  assert.equal(MANIFIESTO, 'manifiesto.json');
  assert.deepEqual(PARTES, Object.keys(ARCHIVO_DE_CADA_PARTE));
  assert.deepEqual(
    PARTES.map((parte) => ARCHIVO_DE_CADA_PARTE[parte]),
    ARCHIVOS,
  );
  assert.equal(new Set(ARCHIVOS).size, ARCHIVOS.length);
  assert.deepEqual(PARTES.filter(esObligatoria), ['esco', 'oit', 'clasificaciones', 'cambra', 'textos']);
});

test('las partes que no se compactan conservan exactamente su identidad', () => {
  const originales = {
    oit: { fuente: { cita: 'OIT', aviso_adaptacion: 'Adaptación' }, ocupaciones: {}, tareas: {} },
    clasificaciones: { cno11: {}, isco08_es: {}, isco08_a_cno11: {} },
    textos: { tareas: {}, competencias_por_ocupacion: {}, aviso_traduccion: 'Aviso' },
    vectores: vectores('oficial', 'AX8='),
  };
  assert.equal(prepararParte('oit', originales.oit), originales.oit);
  assert.equal(prepararParte('clasificaciones', originales.clasificaciones), originales.clasificaciones);
  assert.equal(prepararParte('textos', originales.textos), originales.textos);
  assert.equal(prepararParte('vectores', originales.vectores), originales.vectores);
});

test('preparar ESCO conserva metadatos y pares en una vista nueva sin mutar lo leído', () => {
  const original: DatosEsco = {
    competencias: [['uri:cero', 'Competencia', 'skill']],
    ocupaciones: { propia: { uri: 'uri:propia', titulo: 'Propia', isco08: '4226', competencias: [[0, 'o']] } },
  };
  const antes = structuredClone(original);
  const preparado = prepararParte('esco', original);
  assert.notEqual(preparado, original);
  assert.equal(preparado.competencias, original.competencias);
  const propia = preparado.ocupaciones.propia;
  assert.ok(propia);
  assert.deepEqual([...propia.competencias], [[0, 'o']]);
  assert.deepEqual(original, antes);
});

test('los vectores de formación comparten sus índices y serializan los mismos bytes sin modificar la entrada', () => {
  const original = { especialidades: vectores('especialidad', 'AX8='), ocupaciones: vectores('ocupacion', '/4E=') };
  const antes = structuredClone(original);
  const preparado = prepararParte('vectoresFormacion', original);
  assert.ok(preparado);
  assert.notEqual(preparado, original);
  for (const parte of ['especialidades', 'ocupaciones'] as const) {
    assert.notEqual(preparado[parte], original[parte]);
    assert.equal(preparado[parte].ids, original[parte].ids);
    assert.equal(preparado[parte].escalas, original[parte].escalas);
    assert.equal(cargarIndice(preparado[parte]), cargarIndice(original[parte]));
    assert.equal(typeof Object.getOwnPropertyDescriptor(preparado[parte], 'datos')?.get, 'function');
    assert.equal(Object.getOwnPropertyDescriptor(original[parte], 'datos')?.get, undefined);
  }
  assert.equal(JSON.stringify(preparado), JSON.stringify(original));
  assert.deepEqual(original, antes);
});
