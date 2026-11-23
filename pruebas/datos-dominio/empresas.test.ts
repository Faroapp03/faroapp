import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { expresionesDeEmpresa, quitarEmpresas } from '../../src/seguridad/empresas.ts';

test('conserva el contexto español y catalán al quitar empresas presentadas', () => {
  assert.deepEqual(quitarEmpresas("Trabajo en la empresa Limpiezas Sol y a l'empresa Serveis Integrals."), {
    texto: "Trabajo en la empresa [empresa] y a l'empresa [empresa].",
    eliminados: 2,
  });
});

test('quita la forma jurídica sin absorber gramática y mantiene el punto de la frase', () => {
  assert.deepEqual(quitarEmpresas('En Acme S.L. limpio. Neteges del Vallès, SL. Fruites Puig SCCL.'), {
    texto: 'En [empresa] limpio. [empresa]. [empresa].',
    eliminados: 3,
  });
  assert.deepEqual(quitarEmpresas('Trabajo en Acme S.L. Limpio oficinas.'), {
    texto: 'Trabajo en [empresa]. Limpio oficinas.',
    eliminados: 1,
  });
});

test('preserva empresa sin presentación y nombres corrientes; distingue la forma jurídica en mayúsculas', () => {
  const texto = 'Trabajo en Mercadona y en una empresa Familiar. LA EMPRESA LIMPIEZAS SOL';
  assert.deepEqual(quitarEmpresas(texto), { texto, eliminados: 0 });
  assert.deepEqual(quitarEmpresas('TRABAJO EN MERCADONA S.A.'), {
    texto: 'TRABAJO EN [empresa].',
    eliminados: 1,
  });
});

test('saltarse un nombre corriente no pierde texto anterior y las llamadas no comparten cursor', () => {
  const texto = 'una empresa Familiar; la empresa Limpiezas Sol.';
  const esperado = { texto: 'una empresa Familiar; la empresa [empresa].', eliminados: 1 };
  assert.deepEqual(quitarEmpresas(texto), esperado);
  assert.deepEqual(quitarEmpresas(texto), esperado);
  assert.deepEqual(quitarEmpresas(esperado.texto), { texto: esperado.texto, eliminados: 0 });
});

test('las dos expresiones de referencia conservan sus huellas medidas', () => {
  const referencia = expresionesDeEmpresa((fuente) => `(?i:${fuente})`);
  assert.equal(
    createHash('sha256').update(referencia.presentada.source).digest('hex'),
    '01b6a8f58ddacb67e213c9a8062b3045d7dce4a82a0ef8d145ab081d75051611',
  );
  assert.equal(
    createHash('sha256').update(referencia.conForma.source).digest('hex'),
    'ea2da972370c0bf226e961f6f211e9e5c296c84b6191ec438c0dca9dab72600d',
  );
});
