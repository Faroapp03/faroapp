// Pruebas del formato de los textos que ordenan y filtran las listas del recorrido (scripts/recorrido/formato.js).
// Se ejecutan con npm test o node --test pruebas/web-recorrido-api/*.test.ts desde la raíz del producto.

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { recortarEnPalabras as recorteDelMotor } from '../../src/comun/recorte.ts';
import {
  comparable,
  contarLetras,
  contienePalabra,
  fechaLocalDeHoy,
  normalizarTexto,
  ordenarPorTitulo,
  recortarEnPalabras,
} from '../../web/scripts/recorrido/formato.js';

/** Letras que cuentan en las frases de prueba y límites de recorte (en letras) de las citas. */
const LETRAS_DE_IR_A_LA_ITV = 8;
const LETRAS_DE_CONDUCIR_EL_AUTOBUS = 15;
const LIMITE_HOLGADO = 60;
const LIMITE_PARA_ADMINISTRATIVA = 50;
const LIMITE_PARA_TRES_PALABRAS = 8;
const LIMITE_PARA_UNA_COMA = 9;
const LIMITE_CON_ESPACIO_INICIAL = 10;
const LETRAS_DE_UNA_PALABRA_LARGA = 80;
/** Plazo del proceso hijo que comprueba el huso horario, para que uno colgado no bloquee npm test. */
const PLAZO_DEL_PROCESO_MS = 10_000;

const ejecutar = promisify(execFile);

test('el orden alfabético es el de un diccionario en castellano', () => {
  const titulos = ['Óptico', 'abogado', 'Ñandú', 'nadador'].map((titulo) => ({ titulo }));
  assert.deepEqual(
    ordenarPorTitulo(titulos).map(({ titulo }) => titulo),
    ['abogado', 'nadador', 'Ñandú', 'Óptico'],
  );
});

test('el filtro por palabra no distingue mayúsculas ni tildes', () => {
  assert.ok(contienePalabra('Conductor de autobús', 'AUTOBUS'));
  assert.ok(!contienePalabra('Conductor de tranvía', 'autobús'));
});

test('al comparar, un texto en otro alfabeto conserva sus letras: dos tareas distintas no son la misma', () => {
  assert.equal(comparable('Водій  автобуса!'), comparable('водій автобуса'));
  assert.notEqual(comparable('Водій автобуса'), comparable('Кухар'));
  assert.notEqual(comparable('سائق حافلة'), comparable('طباخ'));
  assert.notEqual(comparable('公交车司机'), comparable('厨师'));
  assert.equal(contienePalabra('Водій автобуса', 'кухар'), false);
  assert.equal(comparable('Diseñar, ¡planos!'), 'disenar planos');
});

test('normalizar deja el texto en minúsculas y con los espacios justos', () => {
  assert.equal(normalizarTexto('  Chofer   de BUS '), 'chofer de bus');
});

test('los mínimos se cuentan en letras de cualquier alfabeto: los emojis y las cifras no cuentan', () => {
  assert.equal(contarLetras('🚌🚌🚌'), 0);
  assert.equal(contarLetras('🚌🚌🚌🙂'), 0);
  assert.equal(contarLetras('112'), 0);
  assert.equal(contarLetras('Ir a la ITV'), LETRAS_DE_IR_A_LA_ITV);
  assert.equal(contarLetras('Conduïr l’autobús'), LETRAS_DE_CONDUCIR_EL_AUTOBUS);
  assert.equal(contarLetras('开车'), 2);
});

test('el recorte de la cita no parte palabras: corta en un espacio, sin la coma final, y marca con «…»', () => {
  const relato = 'curro de camarero en un bar, sirvo mesas, cobro y a veces ayudo en cocina';
  assert.equal(
    recortarEnPalabras(relato, LIMITE_HOLGADO),
    'curro de camarero en un bar, sirvo mesas, cobro y a veces…',
  );
  assert.equal(
    recortarEnPalabras('Trabajo de administrativa en una gestoría: atiendo a clientes', LIMITE_PARA_ADMINISTRATIVA),
    'Trabajo de administrativa en una gestoría…',
  );
  // Lo que cabe no cambia; una palabra que justo acaba en el límite tampoco se pierde.
  assert.equal(recortarEnPalabras('camarera de pisos', 60), 'camarera de pisos');
  assert.equal(recortarEnPalabras('uno dos tres', LIMITE_PARA_TRES_PALABRAS), 'uno dos…');
  // Una sola palabra más larga que todo se corta donde toque, sin pasar del máximo.
  assert.equal(
    recortarEnPalabras('a'.repeat(LETRAS_DE_UNA_PALABRA_LARGA), LIMITE_HOLGADO),
    `${'a'.repeat(LIMITE_HOLGADO - 1)}…`,
  );
});

test('la web recorta la palabra de la persona igual que el motor', () => {
  const casos = [
    ['curro de camarero en un bar, sirvo mesas, cobro y a veces ayudo en cocina', LIMITE_HOLGADO],
    ['uno dos tres', LIMITE_PARA_TRES_PALABRAS],
    ['uno dos, tres', LIMITE_PARA_UNA_COMA],
    ['a'.repeat(LETRAS_DE_UNA_PALABRA_LARGA), LIMITE_HOLGADO],
    [' empieza con espacio y sigue largo', LIMITE_CON_ESPACIO_INICIAL],
  ] as const;
  for (const [texto, maximo] of casos) {
    assert.equal(recortarEnPalabras(texto, maximo), recorteDelMotor(texto, maximo), JSON.stringify([texto, maximo]));
  }
});

test('la fecha del informe conserva el día de la persona, aunque UTC tenga otro día', async () => {
  const formato = new URL('../../web/scripts/recorrido/formato.js', import.meta.url).href;
  const programa = [
    `import { fechaLocalDeHoy } from ${JSON.stringify(formato)};`,
    "import { mock } from 'node:test';",
    "mock.timers.enable({ apis: ['Date'], now: Date.parse(process.env.AHORA_DE_LA_PRUEBA) });",
    'console.log(fechaLocalDeHoy());',
  ].join('\n');
  const casos = [
    { huso: 'America/Los_Angeles', ahora: '2026-10-10T00:30:00Z', fecha: '2026-10-09' },
    { huso: 'Asia/Tokyo', ahora: '2026-10-10T00:30:00Z', fecha: '2026-10-10' },
    // Aquí el día local es posterior al de UTC.
    { huso: 'Asia/Tokyo', ahora: '2026-10-10T23:30:00Z', fecha: '2026-10-11' },
  ];
  for (const caso of casos) {
    const { stdout } = await ejecutar(process.execPath, ['--input-type=module', '-e', programa], {
      env: { ...process.env, TZ: caso.huso, AHORA_DE_LA_PRUEBA: caso.ahora },
      timeout: PLAZO_DEL_PROCESO_MS,
    });
    assert.equal(stdout.trim(), caso.fecha, caso.huso);
  }
});

test('fechaLocalDeHoy toma la fecha del instante que se le da, en la hora local', () => {
  assert.equal(fechaLocalDeHoy(new Date('2026-01-05T23:59:00')), '2026-01-05');
  assert.equal(fechaLocalDeHoy(new Date('2026-12-31T00:00:00')), '2026-12-31');
});
