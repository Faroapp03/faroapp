// Contratos medidos de nombres: contexto, conservación del oficio y normalización previa de privacidad.
// Casos sintéticos portables; la lista operativa de nombres forma parte del producto.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DENOMINACIONES_DE_DICCIONARIO } from '../../motores/ocupaciones/src/index.ts';
import { segunLaLista } from '../../src/comun/nombres-propios.ts';
import {
  quitarNombresDeLaLista,
  quitarNombresDeLosPatrones,
  quitarNombresDeOtrasPersonas,
} from '../../src/seguridad/nombres-de-persona.ts';
import { papelesDeOtrasPersonas } from '../../src/seguridad/otras-personas.ts';
import { limpiarDatosPersonales } from '../../src/seguridad/privacidad.ts';

const NOMBRE = '[nombre eliminado]';

/** Cada caso conserva texto, puntuación y número exacto de nombres sustituidos. */
function comprobarCasos(casos: readonly (readonly [string, string])[]): void {
  for (const [texto, esperado] of casos) {
    assert.deepEqual(limpiarDatosPersonales(texto), { texto: esperado, eliminados: 1 }, texto);
  }
}

test('las presentaciones ES/CA conservan oficio y partículas al quitar el nombre entero', () => {
  comprobarCasos([
    ['me llamo laura pérez', `me llamo ${NOMBRE}`],
    ['soy laura pérez garcía, enfermera', `soy ${NOMBRE}, enfermera`],
    ['Em dic en Jordi', `Em dic en ${NOMBRE}`],
    ['Sóc na Maria', `Sóc na ${NOMBRE}`],
    ['Me llamo María del Carmen López de la Fuente y limpio', `Me llamo ${NOMBRE} y limpio`],
    ['Em dic Jordi Puig i Ferrer, sóc fuster', `Em dic ${NOMBRE}, sóc fuster`],
    ['Soy Fatima El Amrani, enfermera', `Soy ${NOMBRE}, enfermera`],
    ['Atiendo al Sr. García del Hospital del Mar.', `Atiendo al Sr. ${NOMBRE} del Hospital del Mar.`],
  ]);
});

test('un nombre fuera de la lista conserva el mismo trabajo que uno de la lista', () => {
  for (const nombre of ['Nkechi', 'Oluwaseun', 'Hanwen']) {
    assert.equal(segunLaLista(nombre).dePila, false, nombre);
    comprobarCasos([[`Soy ${nombre} Okafor, enfermera`, `Soy ${NOMBRE}, enfermera`]]);
  }
  comprobarCasos([['Soy Laura Okafor, enfermera', `Soy ${NOMBRE}, enfermera`]]);
});

test('los nombres ambiguos y los oficios se conservan cuando el contexto no asegura un nombre', () => {
  for (const texto of [
    'soy pastora',
    'soy clara con los clientes y les explico todo',
    'soy laura mesa de la cocina',
    'soy laura de la mañana y repongo',
    'Soy Responsable de calidad',
    'Soy Glovo y reparto en bicicleta',
    'Soy Laura de la Guardia Civil',
  ]) {
    const esperado = texto === 'Soy Laura de la Guardia Civil' ? `Soy ${NOMBRE} de la Guardia Civil` : texto;
    assert.deepEqual(limpiarDatosPersonales(texto), { texto: esperado, eliminados: esperado === texto ? 0 : 1 });
  }
});

test('los oficios del diccionario que también son nombres se conservan tras «soy» y «sóc»; un nombre seguro, no', () => {
  for (const texto of ['soy rider', 'Soy Rider', 'sóc manyà', 'sóc mossa', 'soy MIR', 'soy urbano']) {
    assert.deepEqual(limpiarDatosPersonales(texto), { texto, eliminados: 0 }, texto);
  }
  comprobarCasos([
    ['soy kelly', `soy ${NOMBRE}`],
    ['me llamo Rider Pérez', `me llamo ${NOMBRE}`],
    ['Sóc la Mossa', `Sóc la ${NOMBRE}`],
  ]);
});

/** Nombres del diccionario que la limpieza sigue quitando a propósito: son nombres de pila frecuentes. */
const NOMBRES_ANTES_QUE_OFICIOS = new Set(['kelly']);
/** El diccionario tiene más de doscientos nombres de una palabra: si la cuenta baja de aquí, la prueba no mira nada. */
const MINIMO_DE_NOMBRES_SUELTOS = 100;

test('todo nombre de una palabra del diccionario de Faro sobrevive a la limpieza tras «soy» y «sóc»', () => {
  const sueltos = [...DENOMINACIONES_DE_DICCIONARIO.values()]
    .flatMap((d) => [...d.es, ...d.ca])
    .map((n) => n.trim().toLowerCase())
    .filter((n) => n && !/\s/u.test(n) && !NOMBRES_ANTES_QUE_OFICIOS.has(n));
  assert.ok(sueltos.length > MINIMO_DE_NOMBRES_SUELTOS);
  for (const nombre of sueltos) {
    for (const texto of [`soy ${nombre}`, `sóc ${nombre}`]) {
      assert.equal(limpiarDatosPersonales(texto).texto, texto, texto);
    }
  }
});

test('los papeles conservan posiciones UTF-16 y contexto de artículo, complemento y lengua', () => {
  assert.deepEqual(papelesDeOtrasPersonas('👩 mi jefe, en Jordi'), [
    { desde: '👩 mi jefe, en '.length, contexto: { cualquierOrigen: false, minusculas: true, llamado: false } },
  ]);
  assert.deepEqual(papelesDeOtrasPersonas('los profesores de colegio Montessori'), [
    {
      desde: 'los profesores de colegio '.length,
      contexto: { cualquierOrigen: false, minusculas: false, llamado: false },
    },
  ]);
  assert.deepEqual(papelesDeOtrasPersonas('los mares Mediterráneo y unos pares Nike'), []);
  assert.deepEqual(papelesDeOtrasPersonas('els meus pares Joan i Maria'), [
    { desde: 'els meus pares '.length, contexto: { cualquierOrigen: false, minusculas: false, llamado: false } },
  ]);
});

test('otras personas se quitan tras el rol y la serie conserva el límite medido de cuatro nombres', () => {
  comprobarCasos([
    ['Mi jefe juan me dice qué preparar', `Mi jefe ${NOMBRE} me dice qué preparar`],
    ['La clienta Marta me pide ayuda', `La clienta ${NOMBRE} me pide ayuda`],
    ['El meu cap, en Jordi, em diu què preparar', `El meu cap, en ${NOMBRE}, em diu què preparar`],
  ]);
  assert.deepEqual(quitarNombresDeOtrasPersonas('Mis compañeros Laura, Juan, Jordi, Maria y Ngozi trabajan'), {
    texto: `Mis compañeros ${NOMBRE}, ${NOMBRE}, ${NOMBRE}, ${NOMBRE} y Ngozi trabajan`,
    eliminados: 4,
  });
  const sinNombre = 'los clientes an dejao de llamar';
  assert.deepEqual(quitarNombresDeOtrasPersonas(sinNombre), { texto: sinNombre, eliminados: 0 });
});

test('la privacidad compone NFD y retira ocultación antes de leer nombres', () => {
  for (const texto of [
    'Me llamo José',
    'Me llamo Jose\u0301',
    'Me llamo \u202eJosé\u202c',
    'Me llamo Jo\ufe0fsé',
    'Me llamo Ｊｏｓｅ\u0301',
    'Me llаmo José',
  ]) {
    assert.deepEqual(limpiarDatosPersonales(texto), { texto: `Me llamo ${NOMBRE}`, eliminados: 1 }, texto);
  }
  const relato = 'Uso m² y ℃; hablo русский y ελληνικά; café';
  assert.deepEqual(limpiarDatosPersonales(relato.normalize('NFD')), { texto: relato, eliminados: 0 });
});

test('los patrones y la lista no vuelven a contar las marcas y no guardan posición entre llamadas', () => {
  const texto = 'Em dic la Montse i netejo oficines';
  const esperado = { texto: `Em dic la ${NOMBRE} i netejo oficines`, eliminados: 1 };
  assert.deepEqual(quitarNombresDeLosPatrones(texto), esperado);
  assert.deepEqual(quitarNombresDeLaLista(texto), esperado);
  const yaLimpio = { texto: esperado.texto, eliminados: 0 };
  assert.deepEqual(quitarNombresDeLaLista(esperado.texto), yaLimpio);
  assert.deepEqual(quitarNombresDeOtrasPersonas('Mi jefe Juan'), { texto: `Mi jefe ${NOMBRE}`, eliminados: 1 });
  assert.deepEqual(quitarNombresDeOtrasPersonas('sin nombres'), { texto: 'sin nombres', eliminados: 0 });
  assert.deepEqual(quitarNombresDeLosPatrones(texto), esperado);
  assert.deepEqual(quitarNombresDeOtrasPersonas('Mi jefe Juan'), { texto: `Mi jefe ${NOMBRE}`, eliminados: 1 });
});
