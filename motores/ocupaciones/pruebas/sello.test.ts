// El sello del motor de ocupaciones (motores/ocupaciones/sello.json): cada archivo de ejecución del motor tiene la
// huella SHA-256 sellada, ni uno más ni uno menos. Si esta prueba falla, algún archivo del motor ha cambiado, ha
// aparecido o ha desaparecido: no se sella de nuevo sin la autorización explícita y la medición del banco de 2.473
// personas
// (motores/ocupaciones/README.md, «El sello»).

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { SELLO, type Sello, selloActual, textoDelSello } from '../herramientas/sellar.ts';

const sellado = JSON.parse(readFileSync(SELLO, 'utf8')) as Sello;
/** Menos archivos sellados que estos querría decir que el sello no cubre el motor entero. */
const MINIMO_DE_ARCHIVOS = 40;

test('cada archivo de ejecución del motor de ocupaciones tiene la huella sellada', () => {
  const actual = selloActual();
  assert.equal(sellado.algoritmo, 'sha256');
  assert.ok(Object.keys(sellado.archivos).length > MINIMO_DE_ARCHIVOS, 'el sello cubre el motor entero');
  assert.ok('src/index.ts' in sellado.archivos, 'la entrada pública está sellada');
  assert.ok('modelos/modelo-lexico.json' in sellado.archivos, 'los modelos están sellados');
  assert.deepEqual(Object.keys(actual.archivos), Object.keys(sellado.archivos), 'los mismos archivos');
  for (const [ruta, huella] of Object.entries(sellado.archivos)) {
    assert.equal(actual.archivos[ruta], huella, `${ruta} ha cambiado desde que se selló`);
  }
  assert.equal(readFileSync(SELLO, 'utf8'), textoDelSello(sellado), 'el sello se guarda en su forma');
});

test('el sello detecta un byte cambiado, un archivo nuevo y uno que falta', () => {
  const motor = mkdtempSync(join(tmpdir(), 'sello-ocupaciones-'));
  try {
    mkdirSync(join(motor, 'src'));
    mkdirSync(join(motor, 'modelos'));
    writeFileSync(join(motor, 'src/a.ts'), 'export const a = 1;\n');
    writeFileSync(join(motor, 'src/README.md'), 'No se ejecuta.\n');
    writeFileSync(join(motor, 'modelos/m.json'), '{}\n');
    const antes = selloActual(motor);
    assert.deepEqual(Object.keys(antes.archivos), ['modelos/m.json', 'src/a.ts'], 'sin la documentación');
    writeFileSync(join(motor, 'src/a.ts'), 'export const a = 2;\n');
    assert.notEqual(selloActual(motor).archivos['src/a.ts'], antes.archivos['src/a.ts']);
    writeFileSync(join(motor, 'src/b.ts'), 'export const b = 1;\n');
    assert.ok('src/b.ts' in selloActual(motor).archivos);
    rmSync(join(motor, 'modelos/m.json'));
    assert.ok(!('modelos/m.json' in selloActual(motor).archivos));
  } finally {
    rmSync(motor, { recursive: true });
  }
});
