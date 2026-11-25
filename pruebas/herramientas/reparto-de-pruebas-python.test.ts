// Las pruebas Python de los datos se reparten en procesos (scripts/reparto-de-pruebas-python.ts) sin perder ni repetir
// módulos, siempre igual para la misma lista, y un fallo en cualquier proceso hace fallar la comprobación con su salida.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  DURACIONES_PYTHON,
  leerDuracionesPython,
  PROCESOS_DE_PYTHON,
  repartirPruebasPython,
} from '../../scripts/reparto-de-pruebas-python.ts';
import {
  concluirProcesosDePython,
  probarPythonEnProcesos,
  pruebasPythonDeDatos,
} from '../../scripts/verificar-datos.ts';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
const VERDE =
  '..\n----------------------------------------------------------------------\nRan 2 tests in 0.01s\n\nOK\n';

/** Los lotes como conjuntos, para comparar repartos sin depender del orden de la lista de entrada. */
function comoConjuntos(lotes: readonly { modulos: readonly string[] }[]): string[][] {
  return lotes.map((lote) => [...lote.modulos].sort());
}

test('cada módulo Python que ejecuta el ciclo tiene su duración medida, y no sobra ninguna', () => {
  const { origen, segundos } = leerDuracionesPython(RAIZ);
  const modulos = pruebasPythonDeDatos(RAIZ);
  assert.ok(origen.trim().length > 0, `${DURACIONES_PYTHON} dice de dónde salen sus cifras`);
  assert.deepEqual(
    modulos.filter((modulo) => !Object.hasOwn(segundos, modulo)),
    [],
    `Mide estos módulos y añade su duración a ${DURACIONES_PYTHON}`,
  );
  assert.deepEqual(
    Object.keys(segundos).filter((modulo) => !modulos.includes(modulo)),
    [],
    `Retira de ${DURACIONES_PYTHON} los módulos que el ciclo ya no ejecuta`,
  );
  assert.ok(Object.values(segundos).every((valor) => Number.isFinite(valor) && valor >= 0));
});

test('el reparto del ciclo ejecuta cada módulo una sola vez, en tres procesos y siempre igual', () => {
  const modulos = pruebasPythonDeDatos(RAIZ);
  const { segundos } = leerDuracionesPython(RAIZ);
  const reparto = repartirPruebasPython(modulos, segundos);
  const repartidos = reparto.lotes.flatMap((lote) => lote.modulos);
  assert.equal(reparto.lotes.length, PROCESOS_DE_PYTHON);
  assert.equal(repartidos.length, modulos.length, 'ningún módulo se repite');
  assert.deepEqual([...repartidos].sort(), [...modulos].sort(), 'ningún módulo se pierde');
  for (const lote of reparto.lotes) {
    assert.deepEqual(
      lote.modulos,
      modulos.filter((modulo) => lote.modulos.includes(modulo)),
      'cada proceso conserva el orden de un solo proceso',
    );
  }
  assert.deepEqual(repartirPruebasPython(modulos, segundos), reparto, 'la misma lista da el mismo reparto');
  assert.deepEqual(
    comoConjuntos(repartirPruebasPython([...modulos].reverse(), segundos).lotes),
    comoConjuntos(reparto.lotes),
    'el reparto no depende del orden de la lista',
  );
});

test('el módulo más largo va primero al proceso menos cargado, y un empate lo decide el nombre', () => {
  const reparto = repartirPruebasPython(['a', 'b', 'c', 'd', 'e'], { a: 10, b: 9, c: 8, d: 1, e: 1 });
  assert.deepEqual(reparto.lotes, [
    { modulos: ['a'], segundos: 10 },
    { modulos: ['b', 'e'], segundos: 10 },
    { modulos: ['c', 'd'], segundos: 9 },
  ]);
  assert.deepEqual(
    repartirPruebasPython(['y', 'x'], { x: 5, y: 5 }, 2).lotes.map((lote) => lote.modulos),
    [['x'], ['y']],
  );
});

test('un módulo sin duración medida pesa la mediana y se avisa; nunca queda un proceso sin módulos', () => {
  const medidos = { a: 2, b: 4, c: 9 };
  const reparto = repartirPruebasPython(['a', 'b', 'c', 'nuevo'], medidos);
  assert.deepEqual(reparto.sinDuracion, ['nuevo']);
  assert.equal(reparto.mediana, medidos.b, 'la mediana de 2, 4 y 9 s');
  assert.equal(
    reparto.lotes.reduce((suma, lote) => suma + lote.segundos, 0),
    medidos.a + medidos.b + medidos.c + medidos.b,
    'el módulo nuevo suma la mediana a la carga',
  );
  assert.deepEqual(
    repartirPruebasPython(['solo'], {}).lotes,
    [{ modulos: ['solo'], segundos: 1 }],
    'unittest sin nombres descubriría todas las pruebas: un proceso vacío no se lanza',
  );
});

test('los procesos cuentan como uno: suman sus casos y cualquier fallo u omisión detiene la orden con su salida', () => {
  const bien: PromiseSettledResult<string> = { status: 'fulfilled', value: VERDE };
  const tres = [bien, bien, bien];
  assert.equal(concluirProcesosDePython(tres), tres.length * Number(/Ran (\d+) tests/.exec(VERDE)?.[1]));
  const fallo: PromiseSettledResult<string> = {
    status: 'rejected',
    reason: new Error('termina con código 1\nFAIL: test_marca (modulo.Caso)\nAssertionError: dato roto'),
  };
  assert.throws(
    () => concluirProcesosDePython([bien, fallo, bien]),
    (error: Error) => /proceso 2 de 3:\n.*FAIL: test_marca.*dato roto/s.test(error.message),
  );
  const omitido: PromiseSettledResult<string> = {
    status: 'fulfilled',
    value: 'Ran 2 tests in 0.01s\n\nOK (skipped=1)\n',
  };
  assert.throws(
    () => concluirProcesosDePython([bien, bien, omitido]),
    (error: Error) =>
      /proceso 3 de 3: .*omitieron alguna\nRan 2 tests in 0\.01s\n\nOK \(skipped=1\)/s.test(error.message),
  );
});

/** Una raíz con la .venv real, la guardia sin red y unos módulos de prueba que exigen un temporal solo suyo. */
function raizDeEnsayo(): { raiz: string; modulos: string[] } {
  const raiz = mkdtempSync(join(tmpdir(), 'faro-reparto-python-'));
  mkdirSync(join(raiz, '.venv/bin'), { recursive: true });
  symlinkSync(join(RAIZ, '.venv/bin/python'), join(raiz, '.venv/bin/python'));
  mkdirSync(join(raiz, 'scripts'));
  symlinkSync(join(RAIZ, 'scripts/sin_red'), join(raiz, 'scripts/sin_red'));
  mkdirSync(join(raiz, 'ensayo'));
  writeFileSync(join(raiz, 'ensayo/__init__.py'), '');
  const modulos = ['ensayo.test_uno', 'ensayo.test_dos', 'ensayo.test_roto'];
  // Un nombre fijo creado en exclusiva: dos procesos con el mismo temporal chocarían aquí.
  const propio = [
    'import os, tempfile, unittest',
    'class Caso(unittest.TestCase):',
    '    def test_temporal_propio(self):',
    '        self.assertRegex(tempfile.gettempdir(), r"proceso-\\d+$")',
    '        os.close(os.open(os.path.join(tempfile.gettempdir(), "comun"), os.O_CREAT | os.O_EXCL))',
    '',
  ].join('\n');
  writeFileSync(join(raiz, 'ensayo/test_uno.py'), propio);
  writeFileSync(join(raiz, 'ensayo/test_dos.py'), propio);
  writeFileSync(
    join(raiz, 'ensayo/test_roto.py'),
    'import unittest\nclass Caso(unittest.TestCase):\n    def test_marca(self):\n        self.fail("dato roto del ensayo")\n',
  );
  writeFileSync(
    join(raiz, DURACIONES_PYTHON),
    JSON.stringify({
      origen: 'ensayo',
      segundos: { 'ensayo.test_uno': 2, 'ensayo.test_dos': 1, 'ensayo.test_roto': 1 },
    }),
  );
  return { raiz, modulos };
}

test('con procesos de verdad, cada uno tiene su temporal y el fallo de uno hace fallar la orden con su salida', async () => {
  const { raiz, modulos } = raizDeEnsayo();
  try {
    assert.equal(await probarPythonEnProcesos(raiz, modulos.slice(0, 2), 2), 2);
    await assert.rejects(probarPythonEnProcesos(raiz, modulos, 2), (error: Error) =>
      /proceso 2 de 2:\n.*FAIL: test_marca \(ensayo\.test_roto\.Caso.*dato roto del ensayo/s.test(error.message),
    );
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});
