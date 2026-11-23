// La marca de comparabilidad del medidor (`origen_bancos` y `comparable_con_la_referencia` en `base`): solo los
// bancos de referencia, con sus huellas, sus claves de ruido y sus nombres, dan una medición comparable byte a byte con
// la referencia de banco/README.md. El nombre del banco va en cada resultado; la ruta de la carpeta, no.

import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { type Banco, bancosDe, leerCasos } from '../herramientas/medicion/bancos.ts';
import { leerOpciones, type Opciones } from '../herramientas/medicion/opciones.ts';
import { procedencia } from '../herramientas/medicion/procedencia.ts';
import type { DatosDelPaquete, Motor } from '../herramientas/medicion/tipos.ts';

const HERRAMIENTAS = fileURLToPath(new URL('../herramientas/', import.meta.url));
const BANCOS = fileURLToPath(new URL('../banco/', import.meta.url));
const DATOS: DatosDelPaquete = { esco: { ocupaciones: {} } };

const sinUso = (): never => {
  throw new Error('la procedencia no ejecuta el motor');
};
/** Un motor que solo da lo que lee la procedencia: la huella del clasificador. */
const MOTOR: Motor = {
  datos: DATOS,
  atributos: { grupos: {}, tareas: {} },
  pasoDePantalla: sinUso,
  buscar: sinUso,
  previaCalibrada: sinUso,
  textoParaVectores: undefined,
  entradaDelClasificador: sinUso,
  vectores: null,
  clasificador: null,
  huellaDelClasificador: null,
};

/** La variante normal de la referencia: --traza, con vectores y sin ruido. */
const NORMAL = leerOpciones(['--traza'], HERRAMIENTAS);

function marca(bancos: readonly Banco[], opciones: Opciones = NORMAL): { origen: unknown; comparable: unknown } {
  const base: Readonly<Record<string, unknown>> = {
    ...procedencia(opciones, MOTOR, bancos, { segundos: 0, medidor: '' }),
  };
  return { origen: base.origen_bancos, comparable: base.comparable_con_la_referencia };
}

/** Una copia entera de la carpeta de bancos en un directorio temporal, con `cambiar` aplicado a su manifiesto. */
function conCopia(cambiar: (manifiesto: string) => string, usar: (carpeta: string) => void): void {
  const carpeta = mkdtempSync(join(tmpdir(), 'bancos-'));
  try {
    cpSync(BANCOS, carpeta, { recursive: true });
    const manifiesto = join(carpeta, 'bancos.json');
    writeFileSync(manifiesto, cambiar(readFileSync(manifiesto, 'utf8')));
    usar(carpeta);
  } finally {
    rmSync(carpeta, { recursive: true, force: true });
  }
}

test('los bancos del manifiesto son los de referencia y la medición es comparable', () => {
  assert.deepEqual(marca(bancosDe(BANCOS)), { origen: 'original', comparable: true });
});

test('con otro nombre de banco cambia el campo banco de los resultados y la medición deja de ser comparable', () => {
  const bancos = bancosDe(BANCOS);
  const renombrados = bancos.map((b, i) => (i === 0 ? { ...b, nombre: 'otro-nombre' } : b));
  const [original] = leerCasos(DATOS, bancos, NORMAL);
  const [renombrado] = leerCasos(DATOS, renombrados, NORMAL);
  assert.equal(original?.banco, 'banco-100');
  assert.equal(renombrado?.banco, 'otro-nombre');
  assert.deepEqual({ ...renombrado, banco: original?.banco }, original, 'solo cambia el campo banco');
  const { origen, comparable } = marca(renombrados);
  assert.equal(comparable, false);
  assert.equal(origen, 'derivado');
});

test('los mismos bancos en otra carpeta, con los mismos nombres y claves, siguen siendo comparables', () => {
  conCopia(
    (manifiesto) => manifiesto,
    (carpeta) => {
      const opciones = leerOpciones(['--traza', '--bancos', carpeta], HERRAMIENTAS);
      assert.notEqual(bancosDe(carpeta)[0]?.archivo, bancosDe(BANCOS)[0]?.archivo, 'otra ruta');
      assert.deepEqual(marca(bancosDe(carpeta), opciones), { origen: 'original', comparable: true });
    },
  );
});

test('con otra clave de ruido la medición deja de ser comparable', () => {
  conCopia(
    (manifiesto) => manifiesto.replace('"clave_de_ruido": "propios-12"', '"clave_de_ruido": "otra-clave"'),
    (carpeta) => {
      const opciones = leerOpciones(['--traza', '--bancos', carpeta], HERRAMIENTAS);
      assert.equal(bancosDe(carpeta)[1]?.claveDeRuido, 'otra-clave');
      assert.deepEqual(marca(bancosDe(carpeta), opciones), { origen: 'derivado', comparable: false });
    },
  );
});
