// Contratos visibles del formato ES/CA: cifras, espacios, listas y calendario, sin consultar el reloj.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fechaConBarras, fechaLarga, frase, lista, mesEnIdioma, numero, porcentaje } from '../../src/comun/formato.ts';

const SIN_AGRUPAR = 999;
const MIL = 1000;
const CON_DECIMALES = 1234.5;
const BORDE_DE_FRANJA = 0.599;
const REDONDEO_A_ENTERO = 9.999;
const DECIMALES_NOTA = 3;
const PORCENTAJE_EJEMPLO = 12.5;
const DECIMALES_FUERA_DE_INTL = 101;

const CIFRAS = [
  [0, 0, '0'],
  [-0, 1, '-0,0'],
  [SIN_AGRUPAR, 0, '999'],
  [MIL, 0, '1.000'],
  [CON_DECIMALES, 2, '1.234,50'],
  [-CON_DECIMALES, 1, '-1.234,5'],
  [BORDE_DE_FRANJA, DECIMALES_NOTA, '0,599'],
  [REDONDEO_A_ENTERO, 2, '10,00'],
] as const;
const MESES = [
  ['01', 'enero', 'gener', 'de gener'],
  ['02', 'febrero', 'febrer', 'de febrer'],
  ['03', 'marzo', 'març', 'de març'],
  ['04', 'abril', 'abril', 'd’abril'],
  ['05', 'mayo', 'maig', 'de maig'],
  ['06', 'junio', 'juny', 'de juny'],
  ['07', 'julio', 'juliol', 'de juliol'],
  ['08', 'agosto', 'agost', 'd’agost'],
  ['09', 'septiembre', 'setembre', 'de setembre'],
  ['10', 'octubre', 'octubre', 'd’octubre'],
  ['11', 'noviembre', 'novembre', 'de novembre'],
  ['12', 'diciembre', 'desembre', 'de desembre'],
] as const;
const DECIMALES_EXTREMO_DOCUMENTADO = 20;
const DECIMALES_INVALIDOS = [-1, DECIMALES_FUERA_DE_INTL, Infinity, -Infinity];
const CONJUNCIONES = [
  ['informática', 'e'],
  ['Índice', 'e'],
  ['Hija', 'e'],
  ['hidratar', 'e'],
  ['IA', 'e'],
  ['hierro', 'y'],
  ['hielo', 'y'],
  ['hiato', 'y'],
  ['hiératico', 'y'],
  ['cobre', 'y'],
  [' informática', 'y'],
] as const;

test('numero conserva miles, coma decimal, relleno y redondeo de Intl con idioma es-ES', () => {
  for (const [valor, decimales, esperado] of CIFRAS) {
    assert.equal(numero(valor, decimales), esperado);
  }
  assert.equal(numero(MIL), '1.000');
  assert.equal(numero(1, DECIMALES_EXTREMO_DOCUMENTADO), '1,00000000000000000000');
});

test('porcentaje usa puntos porcentuales y exactamente un NBSP antes del signo', () => {
  assert.equal(porcentaje(PORCENTAJE_EJEMPLO), '12,5\u00a0%');
  assert.equal(porcentaje(1), '1,0\u00a0%');
  assert.equal(porcentaje(0, 0), '0\u00a0%');
  assert.equal(porcentaje(-0), '-0,0\u00a0%');
});

test('los formatos numéricos propagan RangeError de Intl sin sustituir la cifra', () => {
  for (const decimales of DECIMALES_INVALIDOS) {
    assert.throws(() => numero(1, decimales), RangeError);
    assert.throws(() => porcentaje(1, decimales), RangeError);
  }
});

test('las listas conservan vacío, elemento único, orden y puntuación ES/CA', () => {
  for (const idioma of ['es', 'ca'] as const) {
    assert.equal(lista([], idioma), '');
    assert.equal(lista(['  Único,  '], idioma), '  Único,  ');
  }
  const partes = Object.freeze(['a', 'b', 'c']);
  assert.equal(lista(partes), 'a, b y c');
  assert.equal(lista(partes, 'ca'), 'a, b i c');
  assert.deepEqual(partes, ['a', 'b', 'c']);
});

test('la conjunción castellana sigue la escritura inicial y la catalana siempre es i', () => {
  for (const [siguiente, conjuncion] of CONJUNCIONES) {
    assert.equal(lista(['a', siguiente]), `a ${conjuncion} ${siguiente}`);
    assert.equal(lista(['a', siguiente], 'ca'), `a i ${siguiente}`);
  }
});

test('los elementos vacíos se conservan en la lista sin eliminar posiciones', () => {
  assert.equal(lista(['a', '']), 'a y ');
  assert.equal(lista(['', '', '']), ',  y ');
});

test('frase baja todas las letras y sube solo la primera unidad del texto unido', () => {
  assert.equal(frase([]), '');
  assert.equal(frase(['Atender llamadas', 'Informar a clientes']), 'Atender llamadas e informar a clientes');
  assert.equal(frase(['ÚS D’EXCEL', 'IA'], 'ca'), 'Ús d’excel i ia');
  assert.equal(frase(['IA', 'Excel']), 'Ia y excel');
  assert.equal(frase(['  IA']), '  ia');
  assert.equal(frase(['😀EXCEL']), '😀excel');
});

test('fechaLarga conserva los doce meses y las elisiones catalanas sin depender del huso', () => {
  for (const [mes, castellano, , catalanConDe] of MESES) {
    const fecha = `2026-${mes}-07`;
    assert.equal(fechaLarga(fecha), `7 de ${castellano} de 2026`);
    assert.equal(fechaLarga(fecha, 'ca'), `7 ${catalanConDe} del 2026`);
    assert.equal(fechaConBarras(fecha), `07/${mes}/2026`);
  }
});

test('las fechas conservan día bisiesto y año escrito al convertir sus componentes', () => {
  assert.equal(fechaLarga('2000-02-29'), '29 de febrero de 2000');
  assert.equal(fechaLarga('0000-01-01'), '1 de enero de 0');
  assert.equal(fechaLarga('9999-12-31', 'ca'), '31 de desembre del 9999');
  assert.equal(fechaConBarras('0000-01-01'), '01/01/0000');
});

test('mesEnIdioma traduce meses reconocidos y conserva texto desconocido o castellano', () => {
  for (const [, castellano, catalan] of MESES) {
    assert.equal(mesEnIdioma(castellano.toUpperCase(), 'ca'), catalan);
    assert.equal(mesEnIdioma(castellano.toUpperCase(), 'es'), castellano.toUpperCase());
  }
  assert.equal(mesEnIdioma(' MARZO ', 'ca'), ' MARZO ');
  assert.equal(mesEnIdioma('març', 'ca'), 'març');
  assert.equal(mesEnIdioma('Sept', 'ca'), 'Sept');
  assert.equal(mesEnIdioma('', 'ca'), '');
});
