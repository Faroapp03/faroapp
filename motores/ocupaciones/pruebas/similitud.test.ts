// La similitud de tareas (herramientas/similitud.ts) calcula el IDF al elegir las tareas representativas. Usarla antes
// es un error de uso, y tiene que fallar con un mensaje claro, no devolver parecidos a cero en silencio.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TareaTexto } from '../herramientas/similitud.ts';

const tarea = (id: string, palabras: string[]): TareaTexto => ({ id, indice: 1, palabras, es: id, ca: id });

test('parecido sin el IDF calculado falla con un mensaje claro', async () => {
  // Un módulo recién cargado, sin tareasRepresentativas() todavía.
  const { parecido } = await import(`../herramientas/similitud.ts?sin-idf=${Date.now()}`);
  const a = tarea('a', ['archivar', 'documentos']);
  assert.throws(() => parecido(a, a), /falta el IDF/);
});

test('con el IDF calculado, una tarea se parece del todo a sí misma', async () => {
  const { parecido, tareasRepresentativas } = await import(`../herramientas/similitud.ts?con-idf=${Date.now()}`);
  const a = tarea('a', ['archivar', 'documentos']);
  const b = tarea('b', ['conducir', 'camion']);
  tareasRepresentativas(
    new Map([
      ['1111', [a]],
      ['2222', [b]],
    ]),
  );
  const PRECISION = 1e6;
  assert.equal(Math.round(parecido(a, a) * PRECISION) / PRECISION, 1);
});
