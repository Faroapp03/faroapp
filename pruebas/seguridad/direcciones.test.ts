import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { expresionDeDireccion, quitarDirecciones } from '../../src/seguridad/direcciones.ts';
import type { Limpieza } from '../../src/seguridad/limpieza.ts';

test('quita dirección con piso y población, conservando el resto de la frase', () => {
  const resultado: Limpieza = quitarDirecciones('Vivo en calle Mayor, 5, 3º 2ª, 28001 Madrid. Limpio oficinas.');
  assert.deepEqual(resultado, { texto: 'Vivo en [dirección eliminada]. Limpio oficinas.', eliminados: 1 });
});

test('reconoce vías catalanas, abreviatura pegada y código postal anunciado', () => {
  assert.deepEqual(quitarDirecciones('c/Mayor 5; Avinguda Diagonal 640; codi postal: 08028'), {
    texto: '[dirección eliminada]; [dirección eliminada]; [dirección eliminada]',
    eliminados: 3,
  });
});

test('preserva cantidades, vías sin portal, minúsculas y palabras que empiezan como un tipo de vía', () => {
  const texto = 'VIAJES IBERIA 3. PLAZAS DISPONIBLES 3. calle Mayor; calle mayor 5; Paseo Marítimo 2 veces al día';
  assert.deepEqual(quitarDirecciones(texto), { texto, eliminados: 0 });
});

test('una nueva llamada no hereda el cursor y la marca no se limpia otra vez', () => {
  const texto = 'Carrer de Pi i Margall 12.';
  const esperado = { texto: '[dirección eliminada].', eliminados: 1 };
  assert.deepEqual(quitarDirecciones(texto), esperado);
  assert.deepEqual(quitarDirecciones(texto), esperado);
  assert.deepEqual(quitarDirecciones(esperado.texto), { texto: esperado.texto, eliminados: 0 });
});

test('el patrón de referencia conserva la huella medida y corregida del tipo de vía', () => {
  const referencia = expresionDeDireccion((fuente) => `(?i:${fuente})`);
  assert.equal(
    createHash('sha256').update(referencia.source).digest('hex'),
    '308521c57699418def7e1265819a56eb791db3818eb065ab4f3204191f614559',
  );
});
