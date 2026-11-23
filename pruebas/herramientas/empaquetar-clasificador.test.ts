// El control histórico comprueba paridad; nunca se genera con el consumidor de TypeScript.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { comprobarExportacion, comprobarParidad } from '../../herramientas/clasificador-movil/empaquetar.ts';

const leer = (ruta: string): Buffer => readFileSync(new URL(`../../datos/${ruta}`, import.meta.url));
const modelo = leer('clasificador-movil.json');
const control = leer('fuentes/clasificador/control.json');
const huellas = leer('fuentes/clasificador/huellas.json');
const CASOS_HISTORICOS = 305;
const TOP = 5;
const NEGATIVA = -0.1;
const MAYOR_QUE_UNO = 1.1;
const PROBABILIDADES_INVALIDAS = [NaN, Infinity, NEGATIVA, MAYOR_QUE_UNO, '0.5'];
const casos = JSON.parse(control.toString('utf8'));

test('los 305 casos exactos conservan sus huellas y predicciones Python', () => {
  assert.equal(comprobarExportacion(modelo, control, huellas), CASOS_HISTORICOS);
});

test('una alteración del modelo o del control falla antes de la paridad', () => {
  assert.throws(() => comprobarExportacion(Buffer.concat([modelo, Buffer.from(' ')]), control, huellas), /huellas/);
  assert.throws(() => comprobarExportacion(modelo, Buffer.concat([control, Buffer.from(' ')]), huellas), /huellas/);
});

test('no se admiten controles vacíos ni esquemas o probabilidades inválidos', () => {
  const frase = casos[0];
  const grupo = frase.top5[0];
  for (const invalido of [
    [],
    null,
    {},
    [null],
    [{ ...frase, texto: ' ' }],
    [{ ...frase, top5: [] }],
    [{ ...frase, top5: Array(TOP).fill(grupo) }],
    [{ ...frase, top5: [['no-es-grupo', grupo[1]], ...frase.top5.slice(1)] }],
    ...PROBABILIDADES_INVALIDAS.map((p) => [{ ...frase, top5: [[grupo[0], p], ...frase.top5.slice(1)] }]),
  ]) {
    assert.throws(() => comprobarParidad(modelo, invalido), /control no vacío/);
  }
});

test('expectativas válidas pero equivocadas fallan la paridad', () => {
  const frase = structuredClone(casos[0]);
  const a = frase.top5[0][0];
  frase.top5[0][0] = frase.top5[1][0];
  frase.top5[1][0] = a;
  assert.throws(() => comprobarParidad(modelo, [frase]), /no coinciden/);
});

test('probabilidades no finitas del modelo tampoco acreditan paridad', () => {
  const alterado = JSON.parse(modelo.toString('utf8'));
  alterado.intercepto_b64 = Buffer.from(new Float32Array(alterado.clases.length).fill(NaN).buffer).toString('base64');
  const frase = { texto: 'control', top5: alterado.clases.slice(0, TOP).map((grupo: string) => [grupo, 0]) };
  assert.throws(() => comprobarParidad(Buffer.from(JSON.stringify(alterado)), [frase]), /no coinciden/);
});
