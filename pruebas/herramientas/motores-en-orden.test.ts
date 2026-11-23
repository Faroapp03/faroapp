// El orden de los motores del ensayo de navegadores, con un ejecutor doble: un fallo no detiene el siguiente motor;
// una interrupción guarda lo hecho y lo detiene. Sin navegadores.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ensayarEnOrden, type ResultadoDelMotor } from '../navegadores/motores-en-orden.ts';

const MOTORES = ['chromium', 'firefox', 'webkit'] as const;

test('un motor que falla no impide los siguientes y el resumen se guarda tras cada uno', async () => {
  const ejecutados: string[] = [];
  const guardados: (readonly ResultadoDelMotor[])[] = [];
  const resultados = await ensayarEnOrden(MOTORES, {
    preparar: () => undefined,
    ejecutar: async (motor) => {
      ejecutados.push(motor);
      if (motor === 'firefox') {
        throw new Error('Navegador firefox: termina con código 1');
      }
      return `${motor} correcto`;
    },
    guardarResumen: (hastaAhora) => guardados.push([...hastaAhora]),
  });
  assert.deepEqual(ejecutados, [...MOTORES]);
  assert.deepEqual(
    resultados.map(({ motor, correcto }) => [motor, correcto]),
    [
      ['chromium', true],
      ['firefox', false],
      ['webkit', true],
    ],
  );
  assert.deepEqual(
    guardados.map((resumen) => resumen.at(-1)?.motor),
    [...MOTORES],
  );
});

test('una interrupción guarda lo hecho y no lanza los motores siguientes', async () => {
  const ejecutados: string[] = [];
  const guardados: (readonly ResultadoDelMotor[])[] = [];
  await assert.rejects(
    ensayarEnOrden(MOTORES, {
      preparar: () => undefined,
      ejecutar: async (motor) => {
        ejecutados.push(motor);
        if (motor === 'firefox') {
          throw new Error('Comprobación interrumpida por SIGINT');
        }
        return `${motor} correcto`;
      },
      guardarResumen: (hastaAhora) => guardados.push([...hastaAhora]),
    }),
    /^Error: Comprobación interrumpida por SIGINT$/u,
  );
  assert.deepEqual(ejecutados, ['chromium', 'firefox']);
  assert.deepEqual(
    guardados.at(-1)?.map(({ motor, correcto }) => [motor, correcto]),
    [
      ['chromium', true],
      ['firefox', false],
    ],
  );
});

test('si no se puede preparar un motor, el ensayo se detiene y ese fallo no cuenta como del motor', async () => {
  const ejecutados: string[] = [];
  const guardados: (readonly ResultadoDelMotor[])[] = [];
  await assert.rejects(
    ensayarEnOrden(MOTORES, {
      preparar: (motor) => {
        if (motor === 'firefox') {
          throw new Error('EEXIST: la carpeta del motor ya existe');
        }
      },
      ejecutar: async (motor) => {
        ejecutados.push(motor);
        return `${motor} correcto`;
      },
      guardarResumen: (hastaAhora) => guardados.push([...hastaAhora]),
    }),
    /EEXIST/u,
  );
  assert.deepEqual(ejecutados, ['chromium']);
  assert.deepEqual(
    guardados.at(-1)?.map(({ motor }) => motor),
    ['chromium'],
  );
});
