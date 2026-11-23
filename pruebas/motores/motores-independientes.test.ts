// Los dos motores de Faro son independientes de verdad (motores/ocupaciones/README.md y motores/cursos/README.md):
// - ningún archivo de un motor llega al otro por ninguna cadena de imports, ni siquiera de tipos ni pasando por src/:
//   los dos importan sus contratos de compartido/;
// - fuera del motor de ocupaciones solo se importa su entrada pública (motores/ocupaciones/src/index.ts), salvo sus
//   propias pruebas y herramientas;
// - si falla un archivo de datos de cursos (formacion.json), el motor de ocupaciones responde igual: la correspondencia
//   EURES que lee la búsqueda va en su propio archivo del núcleo (correspondencia-eures.json).

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buscarOcupaciones,
  comprobarAtributos,
  pasoDePantalla,
  prepararBuscador,
} from '../../motores/ocupaciones/src/index.ts';
import type { Datos } from '../../src/dominio/tipos-paquete.ts';
import { cargarDatos } from '../../src/plataforma/node/datos.ts';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
const OCUPACIONES = 'motores/ocupaciones/';
const CURSOS = 'motores/cursos/';
const ENTRADA_DE_OCUPACIONES = 'motores/ocupaciones/src/index.ts';
/** La tabla de atributos del motor de preguntas: un dato que solo carga el motor del dispositivo, sin la entrada. */
const ATRIBUTOS = 'motores/ocupaciones/src/recorrido/preguntas/atributos.json';
/** La única entrada en el motor que no es su entrada pública: la tabla de atributos, en el motor del dispositivo. */
const SIN_LA_ENTRADA = [`src/plataforma/navegador/motor.ts → ${ATRIBUTOS}`];
/** Lo que puede usar los archivos internos del motor de ocupaciones: el propio motor, sus pruebas y sus herramientas. */
const DENTRO_DE_OCUPACIONES = [
  'motores/ocupaciones/src/',
  'motores/ocupaciones/pruebas/',
  'motores/ocupaciones/herramientas/',
];
/** Menos archivos de código que estos en un motor querría decir que la prueba no mira donde debe. */
const MINIMO_DE_OCUPACIONES = 30;
/** Las carpetas del producto con código que podría importar un motor. */
const CONSUMIDORES = ['src', 'compartido', 'motores', 'herramientas', 'scripts', 'pruebas', 'web/scripts'];

/**
 * Cualquier ruta de módulo de un texto: import y export con `from` (también de tipos), import solo por sus efectos,
 * import() dinámico y `new URL('…', import.meta.url)`, que es como se cargan los trabajadores.
 */
const RUTA =
  /\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(?\s*['"]([^'"]+)['"]|\bnew URL\(\s*['"]([^'"]+)['"],\s*import\.meta\.url/gu;

/** Los archivos .ts y .js de una carpeta, en absoluto; sin node_modules. */
function archivosDe(carpeta: string): string[] {
  if (!existsSync(carpeta)) {
    return [];
  }
  return readdirSync(carpeta, { recursive: true, withFileTypes: true })
    .filter((entrada) => entrada.isFile() && /\.(?:ts|js|mjs)$/u.test(entrada.name))
    .map((entrada) => join(entrada.parentPath, entrada.name))
    .filter((archivo) => !archivo.split(/[\\/]/u).includes('node_modules'));
}

/** Los archivos de código y de datos JSON del repositorio a los que apunta un archivo de código, en absoluto. */
function destinosDe(archivo: string): string[] {
  if (archivo.endsWith('.json')) {
    return [];
  }
  const destinos: string[] = [];
  for (const [, de, importado, url] of readFileSync(archivo, 'utf8').matchAll(RUTA)) {
    const ruta = de ?? importado ?? url ?? '';
    if (ruta.startsWith('.')) {
      const destino = resolve(dirname(archivo), ruta);
      // Un JSON cuenta si se importa como módulo; leerlo con new URL y readFileSync no lo carga como código.
      const modulo = url === undefined ? /\.(?:ts|js|mjs|json)$/u : /\.(?:ts|js|mjs)$/u;
      if (existsSync(destino) && modulo.test(destino)) {
        destinos.push(destino);
      }
    }
  }
  return destinos;
}

/**
 * Las cadenas de imports por las que se llega, desde los archivos de `raices`, a un archivo cuya ruta (desde `raiz`)
 * empieza por `prohibido`. Sigue todas las aristas, también las de tipos y las que pasan por src/.
 */
function cadenasHacia(raiz: string, raices: readonly string[], prohibido: string): string[] {
  const relativa = (archivo: string) => relative(raiz, archivo).split('\\').join('/');
  const padre = new Map<string, string | null>(raices.map((archivo) => [archivo, null]));
  const cola = [...raices];
  for (let archivo = cola.shift(); archivo; archivo = cola.shift()) {
    for (const destino of destinosDe(archivo)) {
      if (!padre.has(destino)) {
        padre.set(destino, archivo);
        cola.push(destino);
      }
    }
  }
  return [...padre.keys()]
    .filter((archivo) => relativa(archivo).startsWith(prohibido))
    .map((archivo) => {
      const pasos: string[] = [];
      for (let actual: string | null | undefined = archivo; actual; actual = padre.get(actual)) {
        pasos.unshift(relativa(actual));
      }
      return pasos.join(' → ');
    });
}

test('ningún archivo del motor de ocupaciones llega al de cursos, ni por tipos ni pasando por src/', () => {
  const raices = archivosDe(join(RAIZ, OCUPACIONES, 'src'));
  assert.ok(raices.length > MINIMO_DE_OCUPACIONES, 'el motor de ocupaciones tiene sus archivos');
  assert.deepEqual(cadenasHacia(RAIZ, raices, CURSOS), []);
});

test('ningún archivo del motor de cursos llega al de ocupaciones, ni por tipos ni pasando por src/', () => {
  const raices = archivosDe(join(RAIZ, CURSOS, 'src'));
  assert.ok(raices.includes(join(RAIZ, CURSOS, 'src/index.ts')), 'se comprueba la entrada real del motor de cursos');
  assert.deepEqual(cadenasHacia(RAIZ, raices, OCUPACIONES), []);
});

test('la comprobación detecta un import de un motor desde el otro, también de tipos y a través de src/', () => {
  const raiz = mkdtempSync(join(tmpdir(), 'motores-independientes-'));
  try {
    const escribir = (ruta: string, texto: string) => {
      mkdirSync(dirname(join(raiz, ruta)), { recursive: true });
      writeFileSync(join(raiz, ruta), texto);
    };
    escribir('motores/cursos/src/index.ts', 'export const curso = 1;\n');
    escribir('src/dominio/tipos.ts', "export type { X } from '../../motores/cursos/src/index.ts';\n");
    escribir('motores/ocupaciones/src/a.ts', "import type { X } from '../../../src/dominio/tipos.ts';\n");
    escribir('motores/ocupaciones/src/b.ts', "export const b = () => import('../../cursos/src/index.ts');\n");
    escribir('motores/ocupaciones/src/c.ts', 'export const c = 3;\n');
    const desde = (nombre: string) => cadenasHacia(raiz, [join(raiz, 'motores/ocupaciones/src', nombre)], CURSOS);
    assert.deepEqual(desde('a.ts'), [
      'motores/ocupaciones/src/a.ts → src/dominio/tipos.ts → motores/cursos/src/index.ts',
    ]);
    assert.deepEqual(desde('b.ts'), ['motores/ocupaciones/src/b.ts → motores/cursos/src/index.ts']);
    assert.deepEqual(desde('c.ts'), []);
  } finally {
    rmSync(raiz, { recursive: true });
  }
});

/** Los imports de un archivo de fuera del motor de ocupaciones que entran en el motor por otro sitio que su entrada. */
function importsInternos(archivo: string): string[] {
  const desde = relative(RAIZ, archivo).split('\\').join('/');
  if (DENTRO_DE_OCUPACIONES.some((prefijo) => desde.startsWith(prefijo))) {
    return [];
  }
  return destinosDe(archivo)
    .map((destino) => relative(RAIZ, destino).split('\\').join('/'))
    .filter((hacia) => hacia.startsWith(OCUPACIONES) && hacia !== ENTRADA_DE_OCUPACIONES)
    .map((hacia) => `${desde} → ${hacia}`);
}

test('fuera del motor de ocupaciones solo se importa su entrada pública', () => {
  const archivos = CONSUMIDORES.flatMap((carpeta) => archivosDe(join(RAIZ, carpeta)));
  const internos = archivos.flatMap(importsInternos);
  assert.deepEqual(
    internos.filter((arista) => !SIN_LA_ENTRADA.includes(arista)),
    [],
  );
  assert.deepEqual(
    internos.filter((arista) => SIN_LA_ENTRADA.includes(arista)),
    SIN_LA_ENTRADA,
    'la excepción sigue siendo necesaria',
  );
});

/** Frases de prueba del recorrido, en castellano y en catalán, con títulos del SEPE y oficios de la calle. */
const FRASES: readonly [string, 'es' | 'ca'][] = [
  ['ingeniero planificador de tráfico', 'es'],
  ['primer oficial de puente de buque mercante', 'es'],
  ['trabajo de recepcionista en un hotel', 'es'],
  ['soy enfermera en un hospital', 'es'],
  ['camarero', 'es'],
  ['conductor de autobús', 'es'],
  ['administrativa en una gestoría', 'es'],
  ['programador web', 'es'],
  ['cuido a personas mayores en su casa', 'es'],
  ['treballo de cambrera en un bar', 'ca'],
  ['sóc mestra d’escola', 'ca'],
  ['electricista', 'ca'],
];

test('sin formacion.json, la búsqueda de ocupaciones y el recorrido responden igual', () => {
  const datos = cargarDatos(join(RAIZ, 'datos'));
  assert.ok(datos.formacion && datos.eures, 'el paquete trae las dos');
  const { formacion: _formacion, ...sinFormacion } = datos;
  const atributos = comprobarAtributos(JSON.parse(readFileSync(join(RAIZ, ATRIBUTOS), 'utf8')));
  // Cada búsqueda con su propio índice: prepararBuscador lo guarda por objeto de datos.
  prepararBuscador(datos);
  prepararBuscador(sinFormacion);
  for (const [texto, idioma] of FRASES) {
    assert.deepEqual(buscarOcupaciones(sinFormacion, texto), buscarOcupaciones(datos, texto), texto);
    const paso = (de: Datos) => pasoDePantalla(de, atributos, { texto, idioma, respuestas: [] });
    assert.deepEqual(paso(sinFormacion), paso(datos), `${texto} (${idioma})`);
  }
});

test('la búsqueda lee de verdad la correspondencia EURES de su archivo: sin ella, un título del SEPE no se encuentra', () => {
  const datos = cargarDatos(join(RAIZ, 'datos'));
  const { eures: _eures, ...sinEures } = datos;
  prepararBuscador(datos);
  prepararBuscador(sinEures);
  const delSepe = 'ingeniero planificador de tráfico';
  assert.notDeepEqual(buscarOcupaciones(sinEures, delSepe), buscarOcupaciones(datos, delSepe));
});

test('correspondencia-eures.json trae la misma correspondencia y la misma cita que formacion.json', () => {
  const leer = (archivo: string) => JSON.parse(readFileSync(join(RAIZ, 'datos', archivo), 'utf8'));
  const eures = leer('correspondencia-eures.json');
  const formacion = leer('formacion.json');
  assert.deepEqual(Object.keys(eures), ['fuente', 'ocupaciones']);
  assert.equal(eures.fuente, formacion.fuentes.eures);
  assert.deepEqual(eures.ocupaciones, formacion.ocupaciones);
});
