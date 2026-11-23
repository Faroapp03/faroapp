// La comprobación de los datos del ciclo (scripts/verificar-datos.ts) conserva lo que protege el paquete: si alguien
// saca del conjunto una comprobación o una prueba que lo abre, o un dato corrompido deja de pararla, esto falla.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { esFotoDelPaquete, FIXTURE_FECHADO } from '../../scripts/fotos-del-paquete.ts';
import {
  archivoDelModulo,
  LISTA_MEDIDA,
  type ListaMedida,
  modulosDePruebasPython,
} from '../../scripts/medir-pruebas-de-datos.ts';
import { listarPruebas, listarPruebasNavegador } from '../../scripts/verificar.ts';
import {
  abreUnNavegador,
  cierreDeLaPrueba,
  exigirPythonSinOmisiones,
  HUMO_DE_DATOS,
  leeLosDatosDelPaquete,
  pasosDeDatos,
  pruebasNodeDeDatos,
  pruebasPythonDeDatos,
} from '../../scripts/verificar-datos.ts';
import { REFERENCIA } from '../../web/scripts/catalogo-cursos/referencia.js';
import { exigirElPaqueteDeLaFoto } from '../ayudas/foto-del-paquete.ts';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
const INTEGRIDAD = 'pruebas/paquetes/paquete-integridad.test.ts';

test('la comprobación de los datos ejecuta los controles que leen datos/ y web/datos/', () => {
  const programas = pasosDeDatos().map(({ argumentos }) => argumentos[0]);
  assert.deepEqual(programas, [
    'herramientas/vectores-movil/empaquetar.ts',
    'herramientas/clasificador-movil/empaquetar.ts',
    'herramientas/web/informe-ejemplo.ts',
    'herramientas/web/datos-globales.ts',
    'herramientas/web/lecturas.ts',
    'herramientas/cloudflare/comprobar-construccion.ts',
  ]);
});

test('la comprobación de los datos elige las pruebas que abren el paquete real, sin navegadores', () => {
  const node = pruebasNodeDeDatos(RAIZ).map((archivo) => relative(RAIZ, archivo).split(sep).join('/'));
  for (const protectora of [
    INTEGRIDAD,
    'pruebas/paquetes/paquete-del-worker.test.ts',
    'pruebas/cloudflare/cloudflare-cursos.test.ts',
    'pruebas/informe/informe-breve.test.ts',
    'pruebas/web-copia/version-catalogo.test.ts',
    'motores/cursos/pruebas/catalogo-de-cursos.test.ts',
    'motores/ocupaciones/pruebas/recorrido-preguntas.test.ts',
  ]) {
    assert.ok(node.includes(protectora), `Falta ${protectora}`);
  }
  const navegador = new Set(listarPruebasNavegador(RAIZ));
  assert.deepEqual(
    pruebasNodeDeDatos(RAIZ).filter((archivo) => navegador.has(archivo)),
    [],
  );
  // Lee la web construida, pero abre Chromium y WebKit: sigue en la batería completa, no en el ciclo.
  assert.ok(!node.includes('pruebas/web-publicacion/barrera-descarga.test.ts'));
  const python = pruebasPythonDeDatos(RAIZ);
  for (const protectora of [
    'plataforma_datos.cursos.pruebas.test_contrato_clasificacion',
    'plataforma_datos.orquestacion.pruebas.test_catalogo_de_datos',
    'plataforma_datos.biblioteca.pruebas.test_lecturas',
  ]) {
    assert.ok(python.includes(protectora), `Falta ${protectora}`);
  }
});

const CONTRATO_PYTHON = 'plataforma_datos.cursos.pruebas.test_contrato_clasificacion';
const COPIAR = Symbol('copiar');
type Cambio = string | null | typeof COPIAR;

/** Convierte en carpeta real una carpeta enlazada de la copia, con cada entrada enlazada al original. */
function materializar(copia: string, carpeta: string): void {
  if (carpeta === '.') {
    return;
  }
  // Primero sus carpetas superiores: a través de un enlace, la carpeta parecería real y sería la del original.
  materializar(copia, dirname(carpeta));
  const destino = join(copia, carpeta);
  const actual = lstatSync(destino, { throwIfNoEntry: false });
  if (actual?.isDirectory() && !actual.isSymbolicLink()) {
    return;
  }
  if (actual) {
    unlinkSync(destino);
  }
  mkdirSync(destino);
  for (const nombre of readdirSync(join(RAIZ, carpeta))) {
    symlinkSync(join(RAIZ, carpeta, nombre), join(destino, nombre));
  }
}

/**
 * Una copia del producto hecha de enlaces, salvo las rutas cambiadas: se copian (las pruebas, para que lean la copia),
 * se escriben con otro contenido o se quitan. Solo se escribe lo cambiado; el resto del paquete no se duplica.
 */
function conUnaCopia(cambios: Readonly<Record<string, Cambio>>, uso: (copia: string) => number | null): number | null {
  const copia = mkdtempSync(join(tmpdir(), 'faro-datos-corrompidos-'));
  try {
    for (const nombre of readdirSync(RAIZ)) {
      symlinkSync(join(RAIZ, nombre), join(copia, nombre));
    }
    for (const [ruta, cambio] of Object.entries(cambios)) {
      materializar(copia, dirname(ruta));
      // Nunca se cambia nada a través de un enlace: la carpeta del archivo tiene que ser de la copia.
      assert.ok(realpathSync(join(copia, dirname(ruta))).startsWith(realpathSync(copia)), `${ruta} no es de la copia`);
      rmSync(join(copia, ruta), { force: true });
      if (cambio === COPIAR) {
        copyFileSync(join(RAIZ, ruta), join(copia, ruta));
      } else if (cambio !== null) {
        writeFileSync(join(copia, ruta), cambio);
      }
    }
    return uso(copia);
  } finally {
    rmSync(copia, { recursive: true, force: true });
  }
}

/** Sin NODE_TEST_CONTEXT, el proceso hijo es una batería propia y su código de salida refleja sus fallos. */
function integridad(cambios: Readonly<Record<string, Cambio>>): number | null {
  const { NODE_TEST_CONTEXT: _contexto, ...entorno } = process.env;
  return conUnaCopia({ [INTEGRIDAD]: COPIAR, ...cambios }, (copia) => {
    return spawnSync(process.execPath, ['--test', join(copia, INTEGRIDAD)], { cwd: copia, env: entorno }).status;
  });
}

/** La prueba del contrato del catálogo de Cursos sobre la copia, con la misma guardia sin red que el ciclo. */
function contratoDelCatalogo(cambios: Readonly<Record<string, Cambio>>): number | null {
  const prueba = `${CONTRATO_PYTHON.split('.').join('/')}.py`;
  const entorno = { ...process.env, PYTHONPATH: join(RAIZ, 'scripts/sin_red'), FARO_PRUEBAS_SIN_RED: '1' };
  return conUnaCopia({ [prueba]: COPIAR, ...cambios }, (copia) => {
    const python = join(RAIZ, '.venv/bin/python');
    return spawnSync(python, ['-B', '-m', 'unittest', CONTRATO_PYTHON], { cwd: copia, env: entorno }).status;
  });
}

/** El catálogo de Cursos publicado, con su ruta, para alterarlo. */
function catalogoDeCursos(): { ruta: string; entrega: { ofertas: Record<string, unknown>[] } } {
  const carpeta = 'web/datos/catalogo-cursos';
  const [nombre] = readdirSync(join(RAIZ, carpeta)).filter((archivo) => archivo.endsWith('.json'));
  assert.ok(nombre, 'Hay un catálogo de Cursos publicado');
  const ruta = `${carpeta}/${nombre}`;
  return { ruta, entrega: JSON.parse(readFileSync(join(RAIZ, ruta), 'utf8')) };
}

test('un archivo de datos/ con un campo de más o que falta detiene la comprobación de integridad del paquete', () => {
  assert.ok(pruebasNodeDeDatos(RAIZ).includes(join(RAIZ, INTEGRIDAD)));
  assert.equal(integridad({}), 0, 'Sin cambios, la copia pasa: lo que falle después lo causa el dato alterado');
  const nombres = JSON.parse(readFileSync(join(RAIZ, 'datos/nombres.json'), 'utf8')) as Record<string, unknown>;
  assert.notEqual(
    integridad({ 'datos/nombres.json': JSON.stringify({ ...nombres, campoDeMas: true }) }),
    0,
    `Una huella que no coincide la detiene ${INTEGRIDAD}`,
  );
  assert.notEqual(
    integridad({ 'datos/oit.json': null }),
    0,
    `Un archivo del paquete que falta lo detiene ${INTEGRIDAD}`,
  );
});

test('un curso sin identificador o con un valor fuera de vocabulario detiene el contrato del catálogo de Cursos', () => {
  assert.ok(pruebasPythonDeDatos(RAIZ).includes(CONTRATO_PYTHON));
  const { ruta, entrega } = catalogoDeCursos();
  assert.equal(
    contratoDelCatalogo({}),
    0,
    'Sin cambios, la copia pasa: lo que falle después lo causa el dato alterado',
  );
  const [primera, ...resto] = entrega.ofertas;
  assert.ok(primera);
  const { id: _id, ...unidadSinId } = primera.unidad as Record<string, unknown>;
  const sinIdentificador = { ...entrega, ofertas: [{ ...primera, unidad: unidadSinId }, ...resto] };
  assert.notEqual(
    contratoDelCatalogo({ [ruta]: JSON.stringify(sinIdentificador) }),
    0,
    `Un curso sin identificador lo detiene ${CONTRATO_PYTHON} (contrato_entrega_catalogo.validar_publico)`,
  );
  const fueraDeVocabulario = { ...entrega, ofertas: [{ ...primera, tipo_unidad: 'inventado' }, ...resto] };
  assert.notEqual(
    contratoDelCatalogo({ [ruta]: JSON.stringify(fueraDeVocabulario) }),
    0,
    `Un tipo de unidad fuera de su vocabulario lo detiene ${CONTRATO_PYTHON} (contrato_entrega_catalogo.validar_publico)`,
  );
});

test('las pruebas Python de los datos no pasan por buenas si omiten casos o no ejecutan ninguno', () => {
  exigirPythonSinOmisiones(
    '...\n----------------------------------------------------------------------\nRan 74 tests in 8.498s\n\nOK\n',
  );
  for (const salida of [
    'Ran 74 tests in 8.498s\n\nOK (skipped=3)\n',
    'Ran 0 tests in 0.000s\n\nOK\n',
    'Ran 74 tests in 8.498s\n\nFAILED (failures=1)\n',
  ]) {
    assert.throws(() => exigirPythonSinOmisiones(salida), /no se ejecutaron todas/);
  }
});

test('toda prueba que la medición vio leer el paquete está en lo que ejecuta el ciclo', () => {
  assert.ok(
    existsSync(join(RAIZ, LISTA_MEDIDA)),
    `Falta la lista medida ${LISTA_MEDIDA}: con la web local construida (npm run web:preparar), ejecuta ` +
      'npm run verificar:datos -- --medir. Sin ella no se puede afirmar que la selección del ciclo no deja ninguna fuera.',
  );
  const medida = JSON.parse(readFileSync(join(RAIZ, LISTA_MEDIDA), 'utf8')) as ListaMedida;
  const node = new Set(pruebasNodeDeDatos(RAIZ).map((archivo) => relative(RAIZ, archivo).split(sep).join('/')));
  // Las que abren un navegador no pueden ir en el ciclo: las cubre el humo en Chromium y, en tres motores, publicar.
  const fueraNode = medida.node.filter((prueba) => !node.has(prueba) && !abreUnNavegador(RAIZ, join(RAIZ, prueba)));
  assert.deepEqual(fueraNode, [], `La selección del ciclo deja fuera pruebas Node que leen el paquete`);
  const python = new Set(pruebasPythonDeDatos(RAIZ));
  const fueraPython = medida.python.filter((modulo) => !python.has(modulo));
  assert.deepEqual(fueraPython, [], `La selección del ciclo deja fuera módulos Python que leen el paquete`);
  const fotos = [
    ...medida.node.filter((prueba) => esFotoDelPaquete(join(RAIZ, prueba))),
    ...medida.python.filter((modulo) => esFotoDelPaquete(archivoDelModulo(RAIZ, modulo))),
  ];
  assert.deepEqual(fotos, [], 'La medición no puede meter una foto del paquete en el ciclo');
});

/** Las fotos del paquete del árbol: fijan cifras del paquete de una fecha (scripts/fotos-del-paquete.ts). */
const FOTOS = [
  'pruebas/formacion/seleccion-formacion-idioma-foto.test.ts',
  'pruebas/formacion/seleccion-formacion-por-confirmar-foto.test.ts',
  'pruebas/herramientas/foto-clasificacion.test.ts',
];

test('una foto del paquete no entra en lo que ejecuta el ciclo, y la batería completa sí la ejecuta', () => {
  const ciclo = new Set(pruebasNodeDeDatos(RAIZ));
  const bateria = new Set(listarPruebas(RAIZ));
  for (const foto of FOTOS) {
    assert.ok(esFotoDelPaquete(join(RAIZ, foto)), `${foto} declara su paquete con su marca`);
    assert.ok(bateria.has(join(RAIZ, foto)), `${foto} sigue en la batería completa`);
    assert.ok(!ciclo.has(join(RAIZ, foto)), `${foto} no entra en el ciclo`);
  }
  assert.deepEqual(
    [...ciclo].filter((archivo) => esFotoDelPaquete(archivo)),
    [],
  );
  // Sus invariantes sí: leen el catálogo publicado con cualquier paquete.
  for (const invariante of [
    'pruebas/formacion/seleccion-formacion-idioma.test.ts',
    'pruebas/formacion/seleccion-formacion-por-confirmar.test.ts',
    'pruebas/herramientas/foto-clasificacion-invariantes.test.ts',
  ]) {
    assert.ok(ciclo.has(join(RAIZ, invariante)), `Falta ${invariante}`);
  }
});

/** Las fotos del paquete en Python: módulos que decoran sus casos con el decorador de la foto. */
const FOTOS_PYTHON = ['plataforma_datos.cursos.pruebas.test_clasificacion_paridad_foto'];

test('una foto de Python no entra en lo que ejecuta el ciclo, y la batería completa sí la ejecuta', () => {
  const ciclo = new Set(pruebasPythonDeDatos(RAIZ));
  const bateria = new Set(modulosDePruebasPython(RAIZ));
  for (const foto of FOTOS_PYTHON) {
    assert.ok(esFotoDelPaquete(archivoDelModulo(RAIZ, foto)), `${foto} declara su paquete con su marca`);
    assert.ok(bateria.has(foto), `${foto} sigue en la batería completa`);
    assert.ok(!ciclo.has(foto), `${foto} no entra en el ciclo`);
  }
  assert.deepEqual(
    [...ciclo].filter((modulo) => esFotoDelPaquete(archivoDelModulo(RAIZ, modulo))),
    [],
  );
  // Lo que vale con cualquier catálogo sí: el registro y la emisión de la clasificación.
  assert.ok(ciclo.has('plataforma_datos.cursos.pruebas.test_clasificacion_emision'));
});

test('una foto de Python tampoco entra en el ciclo aunque figure en la lista medida', () => {
  const raiz = mkdtempSync(join(tmpdir(), 'faro-foto-python-'));
  try {
    mkdirSync(join(raiz, 'plataforma_datos/modulo'), { recursive: true });
    mkdirSync(join(raiz, 'scripts'));
    const foto = ['@foto_del_paquete(catalogo="0" * 64, regenerar="la orden")', 'class Casos: ...', ''].join('\n');
    writeFileSync(join(raiz, 'plataforma_datos/modulo/test_foto.py'), foto);
    writeFileSync(join(raiz, 'plataforma_datos/modulo/test_invariante.py'), 'class Casos: ...\n');
    const medidos = ['plataforma_datos.modulo.test_foto', 'plataforma_datos.modulo.test_invariante'];
    writeFileSync(join(raiz, LISTA_MEDIDA), JSON.stringify({ node: [], python: medidos }));
    assert.deepEqual(pruebasPythonDeDatos(raiz), ['plataforma_datos.modulo.test_invariante']);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test('ninguna prueba que ejecuta el ciclo compara el paquete con un fixture fechado', () => {
  // Un fixture fechado como entrada propia de una prueba de código no compara nada con el paquete; con los datos del
  // paquete, sí.
  const conFixtureFechado = pruebasNodeDeDatos(RAIZ).filter(
    (archivo) =>
      leeLosDatosDelPaquete(RAIZ, archivo) &&
      [...cierreDeLaPrueba(RAIZ, archivo).values()].some((codigo) => FIXTURE_FECHADO.test(codigo)),
  );
  assert.deepEqual(
    conFixtureFechado.map((archivo) => relative(RAIZ, archivo).split(sep).join('/')),
    [],
    'Una prueba del ciclo que lee un fixture fechado es una foto: márcala con su paquete o escribe el invariante',
  );
});

/** Una huella SHA-256 que no es la de ningún paquete. */
const HUELLA_AJENA = '0000000000000000000000000000000000000000000000000000000000000000';

test('una foto contra un paquete que no es el suyo falla diciendo cuál es el suyo y cómo regenerarla', () => {
  const otra = { catalogo: HUELLA_AJENA, regenerar: 'la orden de la foto' };
  assert.throws(
    () => exigirElPaqueteDeLaFoto(otra),
    (error: Error) =>
      error.message.includes(`foto del paquete con el catálogo ${HUELLA_AJENA}`) &&
      error.message.includes(`catálogo ${REFERENCIA.sha256}`) &&
      error.message.includes('regenera la foto: la orden de la foto'),
  );
  const conDatos = { ...otra, catalogo: REFERENCIA.sha256, datos: { 'formacion.json': HUELLA_AJENA } };
  assert.throws(() => exigirElPaqueteDeLaFoto(conDatos), /foto del paquete/);
  exigirElPaqueteDeLaFoto({ catalogo: REFERENCIA.sha256, regenerar: 'la orden de la foto' });
});

test('el ciclo ejecuta el humo de datos en Chromium, que sí abre un navegador', () => {
  assert.ok(abreUnNavegador(RAIZ, join(RAIZ, HUMO_DE_DATOS)));
  assert.ok(!pruebasNodeDeDatos(RAIZ).includes(join(RAIZ, HUMO_DE_DATOS)), 'Va aparte, detrás de FARO_HUMO_CHROMIUM');
});
