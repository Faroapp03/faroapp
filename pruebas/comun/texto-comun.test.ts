// Contratos autónomos de las utilidades de texto: orden UTF-16, caracteres invisibles, traducción de expresiones,
// títulos visibles y accesibles, y recorrido de árboles JSON. Sin paquete, red ni lectura de archivos.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { INVISIBLES } from '../../src/comun/legible.ts';
import { estaEnLosOrdenados, ListaOrdenada, textosOrdenados } from '../../src/comun/lista-ordenada.ts';
import { sinDistinguirMayusculas } from '../../src/comun/sin-distinguir-mayusculas.ts';
import { conTextosCompartidos, LARGO_MAXIMO_COMPARTIDO } from '../../src/comun/textos-compartidos.ts';
import {
  dosFormasDelTitulo,
  formasDeTituloBreve,
  formasLeidas,
  nombreAccesible,
  tituloDoble,
  tituloEnUnaFrase,
  tituloParaVer,
} from '../../src/comun/titulo-breve.js';

/** Entradas de la lista, con cadena vacía, palabra astral y sustituto suelto. */
const TEXTOS = ['', 'Ana', 'ana', '\ud800', '😀', '￿'];
/** Profundidad suficiente para superar el límite de recursión ordinario. */
const PROFUNDIDAD = 20_000;
/** El umbral del contrato de compartir textos, en unidades UTF-16. */
const UMBRAL = 64;

function consultarComoSet(textos: readonly string[], consultas: readonly string[]): void {
  const conjunto = new Set(textos);
  const ordenados = textosOrdenados(textos);
  const unidos = new ListaOrdenada(ordenados);
  for (const consulta of consultas) {
    assert.equal(estaEnLosOrdenados(ordenados, consulta), conjunto.has(consulta), consulta);
    assert.equal(unidos.has(consulta), conjunto.has(consulta), consulta);
  }
}

test('ordena por unidades UTF-16, quita repetidos y conserva la entrada', () => {
  const entrada = ['￿', 'ana', '😀', 'Ana', '\ud800', '', 'ana', ''];
  const copia = [...entrada];
  assert.deepEqual(textosOrdenados(entrada), TEXTOS);
  assert.deepEqual(entrada, copia);
});

test('las búsquedas distinguen mayúsculas, prefijos y sustitutos UTF-16', () => {
  consultarComoSet(TEXTOS, [...TEXTOS, 'ANa', 'an', 'anaa', '\ud801', '\ud83d', '😁', '\ufffe']);
});

test('las dos búsquedas admiten lista vacía, una entrada y la cadena vacía', () => {
  for (const textos of [[], ['ana'], [''], ['', 'ana']]) {
    consultarComoSet(textos, ['', 'a', 'ana', 'z']);
  }
});

test('ListaOrdenada conserva los errores originales de orden y duplicados', () => {
  for (const textos of [
    ['b', 'a'],
    ['a', 'a'],
    ['￿', '😀'],
  ]) {
    assert.throws(() => new ListaOrdenada(textos), {
      name: 'Error',
      message: `La lista no está ordenada y sin repetir: ${JSON.stringify(textos)}`,
    });
  }
});

test('el separador interno se rechaza, pero tabuladores y retornos siguen siendo texto', () => {
  assert.throws(() => new ListaOrdenada(['a\nb']), {
    name: 'Error',
    message: 'Un texto de la lista lleva el separador: "a\\nb"',
  });
  consultarComoSet(['a\tb', 'a\rb'], ['a\tb', 'a\rb', 'ab']);
});

test('INVISIBLES no incluye los selectores de variante, que la limpieza de datos personales trata aparte', () => {
  assert.equal('\ufe0f'.search(INVISIBLES), -1);
});

test('la traducción conserva la fuente de grupos, clases, cuantificadores y escapes', () => {
  assert.equal(sinDistinguirMayusculas('es|és'), '(?:[eE][sSſ]|[éÉ][sSſ])');
  assert.equal(sinDistinguirMayusculas("l['’]"), "(?:[lL]['’])");
  assert.equal(sinDistinguirMayusculas('t[ií]o\\s+(?<x>a){0,2}\\.?'), '(?:[tT][iIíÍ][oO]\\s+(?<x>[aA]){0,2}\\.?)');
  assert.equal(sinDistinguirMayusculas(''), '(?:)');
});

test('el plegado incluye s larga y Kelvin, y respeta la i sin punto y eszett', () => {
  for (const [letra, aceptadas, rechazadas] of [
    ['s', ['s', 'S', 'ſ'], ['ß']],
    ['k', ['k', 'K', 'K'], ['κ']],
    ['ı', ['ı'], ['i', 'I']],
    ['ß', ['ß', 'ẞ'], ['SS']],
  ] as const) {
    const patron = new RegExp(`^${sinDistinguirMayusculas(letra)}$`, 'u');
    for (const texto of aceptadas) {
      assert.equal(patron.test(texto), true, texto);
    }
    for (const texto of rechazadas) {
      assert.equal(patron.test(texto), false, texto);
    }
  }
});

test('el trozo traducido no vuelve insensibles las propiedades de fuera', () => {
  const patron = new RegExp(`^${sinDistinguirMayusculas('soy')} \\p{Lu}\\p{Ll}+$`, 'u');
  assert.equal(patron.test('SOY Laura'), true);
  assert.equal(patron.test('soy laura'), false);
});

test('la traducción rechaza sintaxis sin equivalencia exacta y caracteres fuera del intervalo', () => {
  for (const fuente of ['\\p{Lu}', '\\w', '\\b', '[a-z]', '[^a]', '\\1', 'Ѐx', '[ab', '(?i:a)', '😀', '\ud800']) {
    assert.throws(() => sinDistinguirMayusculas(fuente), /sinDistinguirMayusculas/, fuente);
  }
});

test('una expresión fallida no altera la traducción posterior', () => {
  assert.throws(() => sinDistinguirMayusculas('a\\w'));
  assert.equal(sinDistinguirMayusculas('a\\s+a'), '(?:[aA]\\s+[aA])');
  assert.equal(sinDistinguirMayusculas('a\\s+a'), '(?:[aA]\\s+[aA])');
});

test('un título con dos formas sale con la masculina delante', () => {
  const titulo = 'bombero de brigada acuática/bombera de brigada acuática';
  assert.equal(tituloParaVer(titulo, 'es'), 'Bombero/a de brigada acuática');
  assert.deepEqual(dosFormasDelTitulo(titulo, 'es'), ['bombero de brigada acuática', 'bombera de brigada acuática']);
  assert.deepEqual(formasDeTituloBreve('bombero/a de brigada acuática', 'es'), [
    'bombero de brigada acuática',
    'bombera de brigada acuática',
  ]);
  assert.equal(formasLeidas(titulo, 'es'), 'bombero o bombera de brigada acuática');
  assert.equal(tituloDoble(titulo, 'es'), 'Bombero de brigada acuática / bombera de brigada acuática');
  assert.equal(tituloParaVer('metge/metgessa', 'ca'), 'Metge/essa');
  assert.equal(formasLeidas('metge/metgessa', 'ca'), 'metge o metgessa');
});

test('los títulos conservan sus formas breves españolas y catalanas y se deshacen', () => {
  for (const [idioma, titulo, visto] of [
    ['es', 'capitán de buque/capitana de buque', 'Capitán/a de buque'],
    ['es', 'bombero-conductor/bombera-conductora', 'Bombero/a-conductor/a'],
    ['es', 'redactor/a de revista', 'Redactor/a de revista'],
    ['ca', 'metge/metgessa', 'Metge/essa'],
    ['ca', 'funcionari/funcionària', 'Funcionari/ària'],
    ['ca', 'advocat/advocada', 'Advocat/ada'],
  ] as const) {
    assert.equal(tituloParaVer(titulo, idioma), visto);
    assert.deepEqual(formasDeTituloBreve(tituloEnUnaFrase(titulo, idioma), idioma), dosFormasDelTitulo(titulo, idioma));
  }
});

test('los títulos dudosos y la pareja invertida conservan sus formas enteras', () => {
  for (const [idioma, titulo, visto] of [
    ['es', 'actor/actriz', 'Actor / actriz'],
    ['ca', 'biòleg/biòloga', 'Biòleg / biòloga'],
    ['ca', 'advocada/advocat', 'Advocada / advocat'],
    ['es', 'bombera/bombero', 'Bombera / bombero'],
  ] as const) {
    assert.equal(tituloEnUnaFrase(titulo, idioma), visto.charAt(0).toLowerCase() + visto.slice(1));
    assert.equal(tituloParaVer(titulo, idioma), visto);
    assert.equal(formasLeidas(titulo, idioma), null);
    assert.equal(nombreAccesible(titulo, idioma), visto);
  }
});

test('la etiqueta accesible contiene el título visible y las formas enteras', () => {
  const titulo = 'operario/operaria de blanqueo';
  assert.equal(nombreAccesible(titulo, 'es'), 'Operario/a de blanqueo (operario u operaria de blanqueo)');
  assert.equal(nombreAccesible('metge/metgessa', 'ca'), 'Metge/essa (metge o metgessa)');
  assert.equal(tituloDoble(titulo, 'es'), 'Operario de blanqueo / operaria de blanqueo');
  assert.equal(tituloEnUnaFrase(titulo, 'es'), 'operario/a de blanqueo');
});

test('las formas repetidas, espacios y tres alternativas mantienen su tratamiento', () => {
  assert.equal(tituloParaVer(' cap de cuina / cap de cuina / ', 'ca'), 'Cap de cuina');
  assert.deepEqual(dosFormasDelTitulo(' Inspector   de sanidad / inspectora de sanidad ', 'es'), [
    'inspector de sanidad',
    'inspectora de sanidad',
  ]);
  assert.equal(dosFormasDelTitulo('a/b/c', 'es'), null);
  assert.equal(tituloParaVer('a/b/c', 'es'), 'A / b / c');
});

test('los límites de la inversa conservan la lectura actual de la primera terminación', () => {
  assert.equal(formasDeTituloBreve('', 'es'), null);
  assert.equal(formasDeTituloBreve('bombero', 'es'), null);
  assert.equal(formasDeTituloBreve('bombero/', 'es'), null);
  assert.deepEqual(formasDeTituloBreve('bombero/a/otra', 'es'), ['bombero', 'bombera']);
});

test('el título mantiene mayúsculas por unidades UTF-16 y no normaliza Unicode', () => {
  for (const titulo of ['', '😀 oficio', '\ud800oficio', 'e\u0301lectricista']) {
    assert.equal(tituloEnUnaFrase(titulo, 'es'), titulo);
    assert.equal(tituloParaVer(titulo, 'es'), titulo.charAt(0).toUpperCase() + titulo.slice(1));
  }
});

test('compartir textos conserva identidad, valores y JSON en los límites de longitud UTF-16', () => {
  assert.equal(LARGO_MAXIMO_COMPARTIDO, UMBRAL);
  const limite = 'a'.repeat(UMBRAL);
  const fuera = `${limite}a`;
  const astral = '😀'.repeat(UMBRAL / 2);
  const valor = { lista: [limite, fuera, astral, astral, '', '\ud800'], anidado: { limite, fuera } };
  const antes = JSON.stringify(valor);
  assert.equal(conTextosCompartidos(valor), valor);
  assert.equal(JSON.stringify(valor), antes);
});

test('compartir textos conserva propiedades __proto__ y no entra en otras clases', () => {
  class Ficha {
    nombre = 'x';
  }
  const ficha = new Ficha();
  const enteros = new Int32Array([1, 2]);
  const sinPrototipo: Record<string, unknown> = Object.create(null);
  sinPrototipo.texto = 'x';
  const valor = { ficha, enteros, sinPrototipo, nulo: null, numero: 1, cierto: true };
  assert.equal(conTextosCompartidos(valor), valor);
  assert.equal(valor.ficha, ficha);
  assert.equal(valor.enteros, enteros);
  assert.equal(Object.getPrototypeOf(valor.sinPrototipo), null);
  const propio = JSON.parse('{"__proto__":"x","otra":"x"}') as Record<string, unknown>;
  conTextosCompartidos(propio);
  assert.equal(Object.getPrototypeOf(propio), Object.prototype);
  assert.equal(Object.getOwnPropertyDescriptor(propio, '__proto__')?.value, 'x');
});

test('compartir textos admite valores simples y árboles profundos sin recursión', () => {
  for (const valor of ['x', null, 1, true, undefined]) {
    assert.equal(conTextosCompartidos(valor), valor);
  }
  let anidado: unknown[] = ['fondo'];
  for (let i = 0; i < PROFUNDIDAD; i++) {
    anidado = [anidado, 'x'];
  }
  assert.equal(conTextosCompartidos(anidado), anidado);
});
