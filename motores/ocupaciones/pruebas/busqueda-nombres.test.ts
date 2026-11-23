// La lista de nombres no puntúa como oficio, y el índice catalán solo responde a textos en catalán (o a la página en
// catalán): un texto castellano no recibe las candidatas de otra lengua. El índice catalán
// se prepara al arrancar, con el castellano, y ninguna búsqueda lo construye.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Datos } from '../../../src/dominio/tipos-paquete.ts';
import { cargarDatos } from '../../../src/plataforma/node/datos.ts';
import { buscarOcupaciones, prepararBuscador } from '../src/busqueda/ocupaciones.ts';
import { palabrasDeNombre } from '../src/busqueda/palabras-de-nombre.ts';

/** Cuántas candidatas se comparan por búsqueda. */
const CANDIDATAS = 3;

const datos = cargarDatos(fileURLToPath(new URL('../../../datos/', import.meta.url)));
const { catalan: _catalan, ...sinCatalan } = datos;
/**
 * Textos en castellano que el índice castellano no encuentra y cuyas palabras («casas», «particulares», «tuberías»)
 * también están en títulos catalanes: si el índice catalán los recibiera, propondría oficios ajenos («profesor
 * particular», «vigilante de casas»).
 */
const CASTELLANO_SIN_COINCIDENCIAS = Object.freeze([
  'Limpio casas particulares, por horas',
  'Arreglo grifos y cambio tuberías en casas',
  'Plancho camisas en una tintoreria, nueve oras al dia',
  'Hago la contabilidad de varias pequeñas empresas',
]);
/** Textos en catalán que solo encuentra el índice catalán, con el grupo ISCO-08 de su oficio. */
const CATALAN: readonly [string, string][] = [
  ['Sóc forner', '7512'],
  ['sóc infermera', '2221'], // sin dominio/erratas-esco.ts daría 5329 («enfermero» del flebotomista)
  ['treballo de fuster', '7115'],
  ['Em dic Laura i sóc caixera', '5230'],
  ['Sóc cambrera', '5131'],
];

/** Los grupos ISCO-08 de las candidatas de un texto, en su orden. */
function grupos(conDatos: Datos, texto: string): string[] {
  return buscarOcupaciones(conDatos, texto).map((candidata) => candidata.isco08);
}

test('un nombre seguido de coma no cambia las candidatas del oficio', () => {
  const referencia = buscarOcupaciones(datos, 'cajera de supermercado', CANDIDATAS).map(({ esco }) => esco);
  for (const nombre of ['Nieves', 'Pastora', 'Florin', 'Laura']) {
    const buscadas = buscarOcupaciones(datos, `Soy ${nombre}, cajera de supermercado`, CANDIDATAS).map(
      ({ esco }) => esco,
    );
    assert.deepEqual(buscadas, referencia, nombre);
  }
  assert.equal(buscarOcupaciones(datos, 'Soy pastora y cuido ovejas', 1)[0]?.isco08, '6121');
});

test('un texto en castellano no recibe candidatas del catalán', () => {
  // «En casas» es el lugar de trabajo (contexto.ts) y pesa poco: «Arreglo grifos y cambio tuberías»
  // ya encuentra algo en castellano. Lo que se comprueba es que el índice catalán no añade nada.
  for (const texto of CASTELLANO_SIN_COINCIDENCIAS) {
    assert.deepEqual(grupos(datos, texto), grupos(sinCatalan, texto), texto);
  }
});

test('el índice catalán encuentra los oficios escritos en catalán', () => {
  // Algunos también los encuentra el castellano por la tolerancia a faltas («cambrera» → «camarera»).
  for (const [texto, isco] of CATALAN) {
    assert.equal(grupos(datos, texto)[0], isco, texto);
  }
  assert.deepEqual(grupos(sinCatalan, 'Sóc forner'), [], 'Sóc forner: el índice castellano ya lo encuentra');
});

test('el nombre de la persona no decide si se busca en catalán', () => {
  // «Pau», «Jordi» o «Montse» son nombres catalanes, y «Pau» es además una palabra catalana: no hacen catalán un texto.
  for (const texto of CASTELLANO_SIN_COINCIDENCIAS) {
    for (const nombre of ['Pau', 'Jordi', 'Montse', 'Laura', 'Fatima']) {
      const conNombre = `${nombre}, ${texto.toLowerCase()}`;
      assert.deepEqual(grupos(datos, conNombre), grupos(sinCatalan, conNombre), conNombre);
    }
  }
});

test('el índice catalán se prepara con el buscador: ninguna búsqueda lo construye', () => {
  // Una copia de los datos que cuenta cuántas veces se leen sus traducciones al catalán.
  let lecturas = 0;
  const contados: Datos = { ...datos };
  Object.defineProperty(contados, 'catalan', {
    get: () => {
      lecturas += 1;
      return datos.catalan;
    },
  });
  prepararBuscador(contados);
  assert.ok(lecturas > 0, 'prepararBuscador no ha preparado el índice catalán');
  lecturas = 0;
  assert.equal(buscarOcupaciones(contados, 'Sóc forner', 1)[0]?.isco08, '7512');
  assert.equal(lecturas, 0, 'la primera búsqueda ha construido el índice catalán');
});

test('el detector conserva nombres compuestos por letras y marcas en NFC y NFD', () => {
  const texto = 'Soy María, cajera de supermercado';
  const enNfc = palabrasDeNombre(texto.normalize('NFC'));
  const enNfd = palabrasDeNombre(texto.normalize('NFD'));
  assert.deepEqual([...enNfc.probables], ['maria']);
  assert.deepEqual([...enNfc.sinValor], ['maria']);
  assert.deepEqual(enNfd, enNfc);
});

test('la forma Unicode del nombre conserva todas las candidatas, sus puntos y su orden', () => {
  const texto = 'Soy María, cajera de supermercado';
  const enNfc = buscarOcupaciones(datos, texto.normalize('NFC'));
  const enNfd = buscarOcupaciones(datos, texto.normalize('NFD'));
  assert.ok(enNfc.length);
  assert.deepEqual(enNfd, enNfc);
});
