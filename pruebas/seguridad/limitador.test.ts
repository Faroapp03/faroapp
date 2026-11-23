import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BARRIDOS_FORZADOS_POR_VENTANA,
  claveDeRed,
  crearLimitador,
  crearLimitadores,
  VENTANA_LIMITADOR_MS,
} from '../../src/seguridad/limitador.ts';

const MAX_PETICIONES = 2;
const VENTANA = 1_000;
const TOPE_CLIENTES = 2;
const FRACCION_MS = 0.5;

test('ventana deslizante, clientes independientes y recuperación en el borde exacto', () => {
  let ahora = 0;
  const limitar = crearLimitador(MAX_PETICIONES, VENTANA, () => ahora);
  assert.equal(limitar('a'), true);
  assert.equal(limitar('a'), true);
  assert.equal(limitar('a'), false);
  assert.equal(limitar('b'), true);
  ahora = VENTANA - 1;
  assert.equal(limitar('a'), false);
  ahora++;
  assert.equal(limitar('a'), true);
});

test('el máximo de clientes barre antes de rechazar y conserva clientes conocidos', () => {
  let ahora = 0;
  const limitar = crearLimitador(MAX_PETICIONES, VENTANA, () => ahora, TOPE_CLIENTES);
  assert.equal(limitar('a'), true);
  assert.equal(limitar('b'), true);
  assert.equal(limitar('nuevo'), false);
  assert.equal(limitar('a'), true);
  ahora = VENTANA;
  assert.equal(limitar('nuevo'), true);
});

test('lleno, un cliente nuevo solo fuerza un barrido por fracción de ventana, no uno en cada petición', () => {
  const intervalo = VENTANA / BARRIDOS_FORZADOS_POR_VENTANA;
  const antesDeCaducar = VENTANA - intervalo / 2;
  let ahora = 0;
  const limitar = crearLimitador(MAX_PETICIONES, VENTANA, () => ahora, TOPE_CLIENTES);
  assert.equal(limitar('a'), true);
  ahora = 1;
  assert.equal(limitar('b'), true);
  ahora = antesDeCaducar;
  assert.equal(limitar('c'), false);
  // a y b ya han caducado, pero el último barrido forzado es reciente: se rechaza sin recorrer la memoria.
  ahora = VENTANA + 1;
  assert.equal(limitar('d'), false);
  ahora = antesDeCaducar + intervalo;
  assert.equal(limitar('d'), true);
});

test('las lecturas conservan 1800 peticiones por red y recuperan su ventana exacta', async () => {
  const lecturasPorRed = 1800;
  let ahora = 0;
  const limites = crearLimitadores(() => ahora);
  assert.deepEqual(Object.keys(limites), ['lecturas']);
  for (let turno = 0; turno < lecturasPorRed; turno++) {
    assert.equal(await limites.lecturas('aula'), true);
  }
  assert.equal(await limites.lecturas('aula'), false);
  assert.equal(await limites.lecturas('otra'), true);
  ahora = VENTANA_LIMITADOR_MS - 1;
  assert.equal(await limites.lecturas('aula'), false);
  ahora++;
  assert.equal(await limites.lecturas('aula'), true);
});

test('una ventana cero, negativa o no finita no puede configurar el limitador', () => {
  for (const ventana of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.throws(() => crearLimitador(1, ventana, () => 0), RangeError);
  }
});

test('cero sigue cerrando y una ventana positiva fraccionaria conserva su borde', () => {
  assert.equal(crearLimitador(0, VENTANA, () => 0)('cliente'), false);
  assert.equal(crearLimitador(1, VENTANA, () => 0, 0)('cliente'), false);
  let ahora = 0;
  const limitar = crearLimitador(1, FRACCION_MS, () => ahora);
  assert.equal(limitar('a'), true);
  assert.equal(limitar('a'), false);
  ahora = FRACCION_MS;
  assert.equal(limitar('a'), true);
});

test('claveDeRed conserva IPv4, agrupa /64, elimina zona y devuelve formas no reconocidas', () => {
  const casos = [
    [' 198.51.100.7 ', '198.51.100.7'],
    ['::ffff:198.51.100.7', '198.51.100.7'],
    // La misma IPv4 escrita en hexadecimal no puede caer en la red común 0:0:0:0::/64 de todas las demás.
    ['::ffff:c633:6407', '198.51.100.7'],
    ['::FFFF:0:1', '0.0.0.1'],
    ['2001:0DB8:0001:0002::1%eth0', '2001:db8:1:2::/64'],
    ['2001:db8:1:2:3:4:5:6', '2001:db8:1:2::/64'],
    ['::1', '0:0:0:0::/64'],
    ['mal::formado::x', 'mal::formado::x'],
    ['texto%zona', 'texto'],
    ['', ''],
  ] as const;
  for (const [ip, esperada] of casos) {
    assert.equal(claveDeRed(ip), esperada);
  }
});

test('las representaciones equivalentes de IPv4 mapeada comparten clave sin agrupar IPv4 distintas', () => {
  for (const ip of [
    '::ffff:c633:6407',
    '0:0:0:0:0:ffff:c633:6407',
    '0:0:0:0::ffff:c633:6407',
    '::ffff:198.51.100.7',
    '0:0:0:0:0:ffff:198.51.100.7',
    '0:0:0:0::ffff:198.51.100.7',
  ]) {
    assert.equal(claveDeRed(ip), '198.51.100.7', ip);
  }
  assert.equal(claveDeRed('0:0:0:0:0:ffff:c633:6408'), '198.51.100.8');
  assert.notEqual(claveDeRed('0:0:0:0:0:ffff:c633:6407'), claveDeRed('0:0:0:0:0:ffff:c633:6408'));
  assert.equal(claveDeRed('2001:db8:1:2::1'), '2001:db8:1:2::/64');
  assert.equal(claveDeRed('2001:db8:1:2::2'), '2001:db8:1:2::/64');
  assert.equal(claveDeRed('2001:db8:1:3::1'), '2001:db8:1:3::/64');
  assert.equal(claveDeRed('2001:db8::192.0.2.1'), '2001:db8:0:0::/64');
  assert.equal(claveDeRed('2001:db8::c000:201'), '2001:db8:0:0::/64');
  assert.equal(claveDeRed('2001:db8::192.0.2.2'), '2001:db8:0:0::/64');
  assert.equal(claveDeRed('2001:db8:0:1::192.0.2.1'), '2001:db8:0:1::/64');
  assert.notEqual(claveDeRed('2001:db8::192.0.2.1'), claveDeRed('2001:db8:0:1::192.0.2.1'));
  assert.equal(claveDeRed('::ffff:256.51.100.7'), '::ffff:256.51.100.7');
  assert.equal(claveDeRed('::ffff:198.51.100.7:1'), '::ffff:198.51.100.7:1');
});
