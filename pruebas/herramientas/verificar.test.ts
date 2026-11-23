// Contratos del verificador: éxito real, fallos de herramientas/procesos y suites vacías.
// Los dobles se crean bajo tmpdir; ningún caso escribe en el producto ni consulta la red.

import assert from 'node:assert/strict';
import { type SpawnSyncReturns, spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { type TestContext, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { pruebasMjsAusentes } from '../../scripts/pruebas-mjs.ts';
import {
  aprobadasPorArchivo,
  OMISIONES_DE_LA_GLOBAL,
  OMISIONES_SIN_EXTENSIONES,
} from '../../scripts/resumen-pruebas.ts';
import {
  ejecutarPaso,
  exigirPruebasEjecutadas,
  exigirPruebasNavegadorEjecutadas,
  exigirVersionNode,
  FalloDeComprobacion,
  listarPruebas,
  listarPruebasNavegador,
  type Paso,
  pasoPruebasDeUnidad,
  pasosDeCodigo,
} from '../../scripts/verificar.ts';
import { EXTENSIONES } from '../../src/plataforma/extensiones.ts';
import { leerIdentidades, terminarSiSiguen } from '../ayudas/procesos-de-prueba.ts';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
const MODULO_PROCESOS = new URL('../ayudas/procesos-de-prueba.ts', import.meta.url).href;
const REPORTERO = new URL('../../scripts/registro-pruebas.ts', import.meta.url).href;
/** Prólogo de un hijo `python -I`: `-I` ignora PYTHONPATH y, con él, la guardia de red heredada; se la pone él mismo. */
const GUARDIA_RED_HIJO_AISLADO = `import sys
sys.path.insert(0, ${JSON.stringify(join(RAIZ, 'scripts/sin_red'))})
import guardia_red
guardia_red.aplicar()
del sys.path[0]
`;
/** Margen para procesos locales cortos sin depender del límite de producción. */
const PLAZO_DE_PRUEBA_MS = 5000;
const PLAZO_CORTO_MS = 200;

/** Un área con espacios en su nombre que se elimina aunque falle una afirmación. */
function areaDePrueba(contexto: TestContext): string {
  const area = mkdtempSync(join(tmpdir(), 'faro verificar #% '));
  contexto.after(() => rmSync(area, { recursive: true, force: true }));
  return area;
}

/** Un proceso Node propio que no depende de un ejecutable del PATH. */
function pasoDeCodigo(codigo: string): Paso {
  return { nombre: 'Caso local', comando: process.execPath, argumentos: ['--input-type=module', '--eval', codigo] };
}

/** Una suite en disco, ejecutada con el mismo reportero estructurado que usa el verificador. */
function suiteEn(area: string, codigo: string): Paso {
  const archivo = join(area, 'caso.test.js');
  writeFileSync(archivo, codigo);
  return {
    nombre: 'Suite local',
    comando: process.execPath,
    argumentos: ['--test', `--test-reporter=${REPORTERO}`, archivo],
  };
}

/** El inventario de la suite de `suiteEn`: su único archivo, sin omisiones admitidas. */
function inventarioDe(area: string, archivos = [join(area, 'caso.test.js')]) {
  return { raiz: area, archivos, admitidas: {} };
}

test('un paso correcto se ejecuta desde una ruta con espacios y conserva su salida', async (contexto) => {
  const area = areaDePrueba(contexto);
  const salida = await ejecutarPaso(pasoDeCodigo('console.log(process.cwd())'), area, PLAZO_DE_PRUEBA_MS);
  assert.equal(salida.trim(), realpathSync(area));
});

test('un diagnóstico externo no corrompe la salida estructurada ni se pierde', async (contexto) => {
  const area = areaDePrueba(contexto);
  let diagnosticos = '';
  contexto.mock.method(process.stderr, 'write', (texto: string) => {
    diagnosticos += texto;
    return true;
  });
  const paso = {
    ...pasoDeCodigo('console.error("aviso del entorno"); console.log(JSON.stringify({ correcto: true }));'),
    diagnosticosSeparados: true,
  };
  const salida = await ejecutarPaso(paso, area, PLAZO_DE_PRUEBA_MS);
  assert.deepEqual(JSON.parse(salida), { correcto: true });
  assert.match(diagnosticos, /aviso del entorno/);
});

test('una herramienta ausente falla con el nombre del control', async (contexto) => {
  const area = areaDePrueba(contexto);
  const paso = { nombre: 'Herramienta requerida', comando: join(area, 'no-existe'), argumentos: [] };
  await assert.rejects(ejecutarPaso(paso, area, PLAZO_DE_PRUEBA_MS), /Herramienta requerida: no se puede ejecutar/);
});

test('un código no cero conserva el fallo del proceso y su salida', async (contexto) => {
  const area = areaDePrueba(contexto);
  const paso = pasoDeCodigo("console.error('fallo de herramienta'); process.exit(7)");
  await assert.rejects(ejecutarPaso(paso, area, PLAZO_DE_PRUEBA_MS), /código 7\nfallo de herramienta/);
});

test('un proceso terminado por señal nunca se cuenta como éxito', async (contexto) => {
  const area = areaDePrueba(contexto);
  const paso = pasoDeCodigo("process.kill(process.pid, 'SIGTERM')");
  await assert.rejects(ejecutarPaso(paso, area, PLAZO_DE_PRUEBA_MS), /señal SIGTERM/);
});

test('un paso que supera su plazo se detiene y falla', async (contexto) => {
  const area = areaDePrueba(contexto);
  const paso = pasoDeCodigo('setInterval(() => {}, 1000)');
  await assert.rejects(ejecutarPaso(paso, area, PLAZO_CORTO_MS), /supera el plazo/);
});

test('un plazo inválido no lanza un proceso', (contexto) => {
  const area = areaDePrueba(contexto);
  assert.throws(() => ejecutarPaso(pasoDeCodigo('process.exit(0)'), area, 0), /entero positivo/);
});

test('una salida sin límite se detiene y da error', async (contexto) => {
  const area = areaDePrueba(contexto);
  const paso = pasoDeCodigo("console.log('x'.repeat(2000000))");
  await assert.rejects(ejecutarPaso(paso, area, PLAZO_DE_PRUEBA_MS), /salida supera el límite/);
});

test('una carpeta de pruebas vacía no produce una verificación verde', (contexto) => {
  const area = areaDePrueba(contexto);
  mkdirSync(join(area, 'pruebas'));
  assert.throws(() => listarPruebas(area), FalloDeComprobacion);
});

test('el descubrimiento incluye pruebas anidadas y descarta archivos ajenos a la suite', (contexto) => {
  const area = areaDePrueba(contexto);
  const carpeta = join(area, 'pruebas');
  mkdirSync(join(carpeta, 'grupo'), { recursive: true });
  const archivo = join(carpeta, 'grupo', 'caso.test.ts');
  writeFileSync(archivo, '');
  writeFileSync(join(carpeta, 'ejemplo.ts'), '');
  assert.deepEqual(listarPruebas(area), [archivo]);
});

test('un archivo de suite sin casos se rechaza aunque Node termine con código cero', async (contexto) => {
  const area = areaDePrueba(contexto);
  const salida = await ejecutarPaso(suiteEn(area, ''), area, PLAZO_DE_PRUEBA_MS);
  assert.throws(() => exigirPruebasEjecutadas(salida, inventarioDe(area)), FalloDeComprobacion);
});

test('una suite con un caso real supera el control de ejecución', async (contexto) => {
  const area = areaDePrueba(contexto);
  const codigo = "import { test } from 'node:test'; test('el caso pasa', () => {});";
  const salida = await ejecutarPaso(suiteEn(area, codigo), area, PLAZO_DE_PRUEBA_MS);
  assert.doesNotThrow(() => exigirPruebasEjecutadas(salida, inventarioDe(area)));
});

test('una omisión inesperada en un archivo de unidad hace fallar la suite aunque haya casos aprobados', async (contexto) => {
  const area = areaDePrueba(contexto);
  const codigo = "import { test } from 'node:test'; test('pasa', () => {}); test.skip('se salta', () => {});";
  const salida = await ejecutarPaso(suiteEn(area, codigo), area, PLAZO_DE_PRUEBA_MS);
  const archivos = [join(area, 'caso.test.js')];
  assert.throws(() => exigirPruebasEjecutadas(salida, { raiz: area, archivos, admitidas: {} }), FalloDeComprobacion);
  const admitidas = { 'caso.test.js': { omitidas: 1, motivo: 'Omisión de la prueba' } };
  assert.doesNotThrow(() => exigirPruebasEjecutadas(salida, { raiz: area, archivos, admitidas }));
});

test('la suite de unidad exige un resumen por archivo y solo las omisiones de la lista, con su número', () => {
  const ADMITIDAS = 2;
  const resumen = (entryFile: string | undefined, passed: number, skipped = 0) =>
    JSON.stringify({
      type: 'test:summary',
      data: {
        ...(entryFile ? { entryFile } : {}),
        success: true,
        counts: { passed, skipped, failed: 0, cancelled: 0, todo: 0, tests: passed + skipped },
      },
    });
  const [a, b, c] = ['/r/pruebas/a.test.ts', '/r/pruebas/b.test.ts', '/r/pruebas/c.test.ts'];
  const inventario = {
    raiz: '/r',
    archivos: [a, b],
    admitidas: { 'pruebas/b.test.ts': { omitidas: ADMITIDAS, motivo: 'Omisión de la prueba' } },
  };
  const comprobar =
    (...resumenes: string[]) =>
    () =>
      exigirPruebasEjecutadas(resumenes.join('\n'), inventario);
  const global = resumen(undefined, ADMITIDAS, ADMITIDAS);
  assert.throws(comprobar(resumen(a, 1, 1), resumen(b, 1, ADMITIDAS), global), /Omisión inesperada en .*a\.test/);
  assert.throws(comprobar(resumen(a, 1), resumen(b, 1, 1), global), /1 omitidas \(admitidas: 2\)/);
  assert.throws(comprobar(resumen(a, 1), resumen(b, ADMITIDAS), global), /0 omitidas \(admitidas: 2\)/);
  assert.throws(comprobar(resumen(a, 1), global), /Faltan resúmenes de unidad/);
  assert.throws(comprobar(resumen(a, 1), resumen(c, 1), global), /Resumen de unidad inesperado/);
  assert.doesNotThrow(comprobar(resumen(a, 1), resumen(b, 1, ADMITIDAS), global));
});

const CASOS_DEL_MOTOR_EMPAQUETADO = 12;

test('la global solo admite las 12 omisiones del motor empaquetado; sin extensiones, además las marcadas', () => {
  assert.deepEqual(
    Object.entries(OMISIONES_DE_LA_GLOBAL).map(([archivo, { omitidas }]) => [archivo, omitidas]),
    [['pruebas/web-recorrido-integral/motor-empaquetado.test.ts', CASOS_DEL_MOTOR_EMPAQUETADO]],
  );
  // Cada omisión sin extensiones es un caso marcado con su condición en la fuente, ni uno más ni uno menos.
  const marca = /skip: (?:SIN_EXTENSIONES|EXTENSION === undefined)\b/g;
  const marcadas = Object.fromEntries(
    listarPruebas(RAIZ)
      .map((archivo) => [relative(RAIZ, archivo).split(sep).join('/'), readFileSync(archivo, 'utf8').match(marca)])
      .filter(([, coincidencias]) => coincidencias)
      .map(([archivo, coincidencias]) => [archivo, (coincidencias as RegExpMatchArray).length]),
  );
  const sinExtensiones = Object.entries(OMISIONES_SIN_EXTENSIONES).filter(
    ([archivo]) => !OMISIONES_DE_LA_GLOBAL[archivo],
  );
  assert.deepEqual(Object.fromEntries(sinExtensiones.map(([archivo, { omitidas }]) => [archivo, omitidas])), marcadas);
});

test('la suite de unidad no hereda FARO_CONSTRUCCION: la global omite igual el motor empaquetado', async (contexto) => {
  const anterior = process.env.FARO_CONSTRUCCION;
  process.env.FARO_CONSTRUCCION = areaDePrueba(contexto);
  contexto.after(() => {
    if (anterior === undefined) {
      delete process.env.FARO_CONSTRUCCION;
    } else {
      process.env.FARO_CONSTRUCCION = anterior;
    }
  });
  // El entorno y las exclusiones del paso real, con una orden que dice lo que recibe.
  const paso = {
    ...pasoPruebasDeUnidad([]),
    ...pasoDeCodigo('console.log(JSON.stringify(process.env.FARO_CONSTRUCCION ?? null))'),
  };
  const salida = await ejecutarPaso(paso, RAIZ, PLAZO_DE_PRUEBA_MS);
  assert.equal(JSON.parse(salida), null);
});

test('los aprobados por archivo salen de sus resúmenes: omitidos y pendientes no cuentan', () => {
  const resumen = (entryFile: string, passed: number, skipped: number) =>
    JSON.stringify({
      type: 'test:summary',
      data: {
        entryFile,
        success: true,
        counts: { passed, skipped, failed: 0, cancelled: 0, todo: 0, tests: passed + skipped },
      },
    });
  const aprobadas = aprobadasPorArchivo([resumen('/a.test.ts', 1, 1), resumen('/b.test.ts', 0, 2)].join('\n'));
  assert.deepEqual(
    [...aprobadas],
    [
      ['/a.test.ts', 1],
      ['/b.test.ts', 0],
    ],
  );
});

test('una suite cuyos casos están todos omitidos no satisface el control', async (contexto) => {
  const area = areaDePrueba(contexto);
  const codigo = "import { test } from 'node:test'; test.skip('caso omitido', () => {});";
  const salida = await ejecutarPaso(suiteEn(area, codigo), area, PLAZO_DE_PRUEBA_MS);
  assert.throws(() => exigirPruebasEjecutadas(salida, inventarioDe(area)), FalloDeComprobacion);
});

test('un error real de tipos se propaga como fallo de herramienta', async (contexto) => {
  const area = areaDePrueba(contexto);
  const archivo = join(area, 'contrato.ts');
  writeFileSync(archivo, 'export const cantidad: number = "incorrecta";\n');
  const paso = {
    nombre: 'TypeScript',
    comando: process.execPath,
    // Solo el archivo del área: tsc 7 buscaría un tsconfig.json en las carpetas superiores del área temporal.
    argumentos: [join(RAIZ, 'node_modules/typescript/bin/tsc'), '--ignoreConfig', '--noEmit', archivo],
  };
  await assert.rejects(
    ejecutarPaso(paso, area, PLAZO_DE_PRUEBA_MS),
    (error: unknown) => error instanceof FalloDeComprobacion && error.message.includes('TS2322'),
  );
});

test('un defecto real de estilo se propaga como fallo de herramienta', async (contexto) => {
  const area = areaDePrueba(contexto);
  const archivo = join(area, 'incorrecto.js');
  writeFileSync(archivo, 'var nombre="texto"\n');
  writeFileSync(join(area, 'biome.json'), readFileSync(join(RAIZ, 'biome.json')));
  const paso = {
    nombre: 'Biome',
    comando: process.execPath,
    argumentos: [join(RAIZ, 'node_modules/@biomejs/biome/bin/biome'), 'check', `--config-path=${area}`, archivo],
  };
  await assert.rejects(
    ejecutarPaso(paso, area, PLAZO_DE_PRUEBA_MS),
    (error: unknown) => error instanceof FalloDeComprobacion && /lint\/style\/noVar|format/.test(error.message),
  );
});

test('una suite cuyos casos son TODO no satisface el control', async (contexto) => {
  const area = areaDePrueba(contexto);
  const codigo = "import { test } from 'node:test'; test.todo('caso pendiente');";
  const salida = await ejecutarPaso(suiteEn(area, codigo), area, PLAZO_DE_PRUEBA_MS);
  assert.throws(() => exigirPruebasEjecutadas(salida, inventarioDe(area)), FalloDeComprobacion);
});

test('Biome comprueba el código sin reformatear los datos operativos de una copia sin Git', async (contexto) => {
  const area = areaDePrueba(contexto);
  const datos = join(area, 'var/actualizacion/validados/fuente');
  mkdirSync(datos, { recursive: true });
  const original = '{ "valores" : [1,2,3] }\n';
  writeFileSync(join(datos, 'fuente.json'), original);
  writeFileSync(join(area, 'biome.json'), readFileSync(join(RAIZ, 'biome.json')));
  const fuente = join(area, 'fuente.ts');
  writeFileSync(fuente, "export const etiqueta = 'Faro';\n");
  const paso = {
    nombre: 'Biome con datos operativos',
    comando: process.execPath,
    argumentos: [join(RAIZ, 'node_modules/@biomejs/biome/bin/biome'), 'check', '--error-on-warnings', '.'],
  };
  await ejecutarPaso(paso, area, PLAZO_DE_PRUEBA_MS);
  assert.equal(readFileSync(join(datos, 'fuente.json'), 'utf8'), original);
  writeFileSync(fuente, 'var etiqueta="texto"\n');
  await assert.rejects(ejecutarPaso(paso, area, PLAZO_DE_PRUEBA_MS), /format|noVar/);
});

test('la salida UTF-8 conserva un carácter dividido entre escrituras', async (contexto) => {
  const area = areaDePrueba(contexto);
  const codigo =
    'process.stdout.write(Buffer.from([226]));' + 'setTimeout(() => process.stdout.write(Buffer.from([130,172])), 20);';
  const salida = await ejecutarPaso(pasoDeCodigo(codigo), area, PLAZO_DE_PRUEBA_MS);
  assert.equal(salida, '€');
});

test('el plazo detiene también un nieto arrancado que comparte el grupo del paso', async (contexto) => {
  const area = areaDePrueba(contexto);
  const marca = join(area, 'nieto-arrancado.txt');
  // El nieto escribe su identidad (PID y hora de inicio) de una vez, mientras vive, y no termina por sí mismo: mantiene
  // los pipes abiertos, así que el paso solo se cierra si el plazo detiene todo su grupo, no solo al padre.
  const nieto =
    `import(${JSON.stringify(MODULO_PROCESOS)})` +
    '.then(({ escribirIdentidades }) => escribirIdentidades(process.argv[1], [process.pid]));' +
    'setInterval(() => {}, 1000);';
  const codigo =
    "import { spawn } from 'node:child_process';" +
    `spawn(process.execPath, ['--eval', ${JSON.stringify(nieto)}, ${JSON.stringify(marca)}],` +
    "{ stdio: ['ignore', 'inherit', 'inherit'] }); setInterval(() => {}, 1000);";
  // El plazo es holgado para que el nieto arranque antes aunque la máquina vaya cargada; su marca lo confirma antes de
  // que venza. Si el grupo no se detuviera, el nieto se detiene al acabar la prueba, solo si sigue siendo el mismo.
  const arranque = esperarMarca(marca, PLAZO_DE_PRUEBA_MS).then(async () => {
    const [visto] = (await leerIdentidades(marca)) ?? [];
    const pid = visto?.pid ?? Number.NaN;
    assert.ok(Number.isSafeInteger(pid) && pid > 0, 'la marca confirma el PID del nieto arrancado');
    contexto.after(() => terminarSiSiguen(visto ? [visto] : []));
    return pid;
  });
  const [pid] = await Promise.all([
    arranque,
    assert.rejects(ejecutarPaso(pasoDeCodigo(codigo), area, PLAZO_DE_PRUEBA_MS), /supera el plazo/),
  ]);
  assert.ok(!sigueEnEjecucion(pid), 'el nieto no queda en ejecución');
});

/** Si el PID sigue ejecutándose. Un zombi ya ha terminado: el sistema puede recogerlo después de cerrar los pipes. */
function sigueEnEjecucion(pid: number): boolean {
  const estado = spawnSync('ps', ['-p', String(pid), '-o', 'stat='], { encoding: 'utf8' });
  return estado.status === 0 && !/^Z/.test(estado.stdout.trim());
}

/** Lo que se espera por defecto a que un proceso de prueba confirme su arranque. */
const TOPE_DE_ARRANQUE_MS = 1000;

/** Espera acotada de una marca escrita por el proceso que ya ha arrancado. */
async function esperarMarca(archivo: string, topeMs = TOPE_DE_ARRANQUE_MS): Promise<void> {
  const pausaMs = 10;
  const maxIntentos = Math.ceil(topeMs / pausaMs);
  for (let intento = 0; intento < maxIntentos; intento += 1) {
    if (existsSync(archivo)) {
      return;
    }
    await new Promise((resolver) => setTimeout(resolver, pausaMs));
  }
  throw new Error('El proceso de prueba no confirma su arranque');
}

/** Confirma que un PID recién creado por el caso no queda ejecutándose. */
function confirmarTerminado(marca: string): void {
  const pid = Number(readFileSync(marca, 'utf8'));
  assert.ok(Number.isSafeInteger(pid) && pid > 0);
  const estado = spawnSync('ps', ['-p', String(pid), '-o', 'stat='], { encoding: 'utf8' });
  assert.ok(estado.status === 1 || /^Z/.test(estado.stdout.trim()), 'el proceso propio termina');
}

for (const senal of ['SIGINT', 'SIGTERM'] as const) {
  test(`interrumpir por ${senal} limpia el grupo del paso que ha arrancado`, async (contexto) => {
    const area = areaDePrueba(contexto);
    const marca = join(area, 'paso-arrancado.txt');
    const codigoPaso =
      `require('node:fs').writeFileSync(${JSON.stringify(marca)}, String(process.pid));` +
      'setInterval(() => {}, 1000);';
    const modulo = new URL('../../scripts/verificar.ts', import.meta.url).href;
    const paso = { nombre: 'Paso largo', comando: process.execPath, argumentos: ['--eval', codigoPaso] };
    const codigo =
      `import { ejecutarPaso } from ${JSON.stringify(modulo)};` +
      `try { await ejecutarPaso(${JSON.stringify(paso)}, ${JSON.stringify(area)}, 5000); }` +
      'catch { process.exitCode = 1; }';
    const proceso = spawn(process.execPath, ['--input-type=module', '--eval', codigo], { stdio: 'ignore' });
    contexto.after(() => {
      if (proceso.exitCode === null && proceso.signalCode === null) {
        proceso.kill('SIGTERM');
      }
    });
    const cierre = once(proceso, 'exit');
    await esperarMarca(marca);
    assert.ok(proceso.pid !== undefined);
    proceso.kill(senal);
    const [codigoFinal] = await cierre;
    assert.equal(codigoFinal, 1);
    confirmarTerminado(marca);
  });
}

test('una mezcla de archivo vacío y casos omitidos no equivale a pruebas ejecutadas', async (contexto) => {
  const area = areaDePrueba(contexto);
  const vacio = join(area, 'vacio.test.js');
  const omitido = join(area, 'omitido.test.js');
  writeFileSync(vacio, '');
  writeFileSync(omitido, "import { test } from 'node:test'; test.skip('caso omitido', () => {});");
  const paso = {
    nombre: 'Suite mixta',
    comando: process.execPath,
    argumentos: ['--test', `--test-reporter=${REPORTERO}`, vacio, omitido],
  };
  const salida = await ejecutarPaso(paso, area, PLAZO_DE_PRUEBA_MS);
  assert.throws(() => exigirPruebasEjecutadas(salida, inventarioDe(area, [vacio, omitido])), FalloDeComprobacion);
});

test('un caso real cuyo título acaba en test.ts se cuenta sin heurística de nombres', async (contexto) => {
  const area = areaDePrueba(contexto);
  const codigo = "import { test } from 'node:test'; test('caso.test.ts', () => {});";
  const salida = await ejecutarPaso(suiteEn(area, codigo), area, PLAZO_DE_PRUEBA_MS);
  assert.doesNotThrow(() => exigirPruebasEjecutadas(salida, inventarioDe(area)));
});

test('un error al cargar el módulo conserva su causa concreta en el rechazo', async (contexto) => {
  const area = areaDePrueba(contexto);
  const paso = suiteEn(area, "throw new Error('causa concreta al cargar módulo');");
  await assert.rejects(
    ejecutarPaso(paso, area, PLAZO_DE_PRUEBA_MS),
    (error: unknown) =>
      error instanceof FalloDeComprobacion && error.message.includes('causa concreta al cargar módulo'),
  );
});

test('el requisito de Node acepta desde 24.22.3 en la rama 24 y rechaza el resto con diagnóstico', () => {
  for (const version of ['24.22.3', '24.22.10', '24.23.0', '24.99.0']) {
    assert.doesNotThrow(() => exigirVersionNode(version));
  }
  for (const version of [
    '24.22.0',
    '24.22.1',
    '24.22.2',
    '24.21.0',
    '24.21.9',
    '24.20.0',
    '24.19.9',
    '23.99.0',
    '23.22.1',
    '25.0.0',
    '25.22.1',
    '26.0.0',
    '24.22',
    '24.22.3-rc.1',
    'incorrecta',
  ]) {
    assert.throws(() => exigirVersionNode(version), /Se requiere Node >=24\.22\.3 <25/);
  }
});

test('la salida y los diagnósticos de una suite aprobada no sustituyen sus resúmenes', async (contexto) => {
  const area = areaDePrueba(contexto);
  const codigo =
    "import { test } from 'node:test'; console.log('salida real');" +
    "test('caso con diagnóstico', (t) => { t.diagnostic('detalle real'); });";
  const salida = await ejecutarPaso(suiteEn(area, codigo), area, PLAZO_DE_PRUEBA_MS);
  assert.match(salida, /salida real/);
  assert.match(salida, /detalle real/);
  assert.doesNotThrow(() => exigirPruebasEjecutadas(salida, inventarioDe(area)));
});

test('un fallo de caso conserva también su cadena de causas', async (contexto) => {
  const area = areaDePrueba(contexto);
  const codigo =
    "import { test } from 'node:test';" +
    "test('fallo con causa', () => { throw new Error('externa', { cause: new Error('causa interior') }); });";
  await assert.rejects(
    ejecutarPaso(suiteEn(area, codigo), area, PLAZO_DE_PRUEBA_MS),
    (error: unknown) => error instanceof FalloDeComprobacion && error.message.includes('causa interior'),
  );
});

test('los argumentos CLI incorrectos terminan con código de uso y diagnóstico', () => {
  const resultado = spawnSync(process.execPath, [join(RAIZ, 'scripts/verificar.ts'), '--desconocido'], {
    encoding: 'utf8',
    timeout: PLAZO_DE_PRUEBA_MS,
  });
  const codigoDeUso = 2;
  assert.equal(resultado.status, codigoDeUso);
  assert.match(resultado.stderr, /Uso: npm run verificar/);
});

test('la verificación comprueba los tipos de cada extensión instalada exactamente una vez', () => {
  for (const { proyectoTypeScript, carpetaDePruebas } of EXTENSIONES) {
    for (const proyecto of [proyectoTypeScript.proyecto, `${carpetaDePruebas}/tsconfig.json`]) {
      const pasos = pasosDeCodigo(RAIZ).filter((paso) => paso.argumentos.includes(proyecto));
      assert.equal(pasos.length, 1, proyecto);
      assert.equal(pasos[0]?.comando, process.execPath);
      assert.deepEqual(pasos[0]?.argumentos, [join(RAIZ, 'node_modules/typescript/bin/tsc'), '--project', proyecto]);
    }
  }
});

test('la verificación exige cada empaquetador una sola vez y en modo sin escritura', () => {
  const pasos = pasosDeCodigo(RAIZ);
  for (const recurso of ['vectores-movil', 'clasificador-movil']) {
    const herramienta = `herramientas/${recurso}/empaquetar.ts`;
    const coincidentes = pasos.filter((paso) => paso.argumentos.includes(herramienta));
    assert.equal(coincidentes.length, 1, herramienta);
    assert.equal(coincidentes[0]?.comando, process.execPath);
    assert.deepEqual(coincidentes[0]?.argumentos, [herramienta, '--comprobar']);
  }
});

test('el paso de versión Python rechaza 3.12.14 y otras ramas', () => {
  const paso = pasosDeCodigo(RAIZ).find((entrada) => entrada.nombre.startsWith('Python'));
  assert.ok(paso);
  const ejecutar = `${GUARDIA_RED_HIJO_AISLADO}import json,runpy,sys
sys.version_info=tuple(json.loads(sys.argv[1]))
argumentos=sys.argv[2:]
if argumentos[0]=='-c':
    exec(argumentos[1])
else:
    runpy.run_path(argumentos[-1],run_name='__main__')
`;
  for (const [version, estado, esperado] of [
    ['3.12.14', 'final', 1],
    ['3.12.0', 'final', 1],
    ['3.12.15', 'final', 0],
    ['3.12.16', 'final', 0],
    ['3.11.99', 'final', 1],
    ['3.13.0', 'final', 1],
    ['3.14.0', 'final', 1],
    ['3.12.15', 'candidate', 1],
  ] as const) {
    const versionInfo = [...version.split('.').map(Number), estado, estado === 'final' ? 0 : 1];
    const resultado: SpawnSyncReturns<string> = spawnSync(
      paso.comando,
      ['-I', '-B', '-c', ejecutar, JSON.stringify(versionInfo), ...paso.argumentos],
      {
        cwd: RAIZ,
        encoding: 'utf8',
        timeout: PLAZO_DE_PRUEBA_MS,
      },
    );
    assert.equal(resultado.status, esperado, `${version}.${estado}: ${resultado.stderr}`);
    if (esperado !== 0) {
      assert.match(resultado.stderr, /Se requiere Python 3\.12 desde 3\.12\.15/);
    }
  }
});

test('descubrimiento incluye los módulos mjs de pruebas sin mezclar navegador con unidad', (contexto) => {
  const area = areaDePrueba(contexto);
  const carpeta = join(area, 'pruebas', 'navegadores');
  mkdirSync(carpeta, { recursive: true });
  const unidad = join(carpeta, 'remoto-ayudas.test.mjs');
  const navegador = join(carpeta, 'portada-publica.test.mjs');
  writeFileSync(unidad, '');
  writeFileSync(navegador, '');
  assert.deepEqual(listarPruebas(area), [unidad]);
  assert.deepEqual(listarPruebasNavegador(area), [navegador]);
  writeFileSync(join(carpeta, 'nuevo.test.mjs'), '');
  assert.throws(() => listarPruebas(area), /sin clasificar/);
});

test('la clasificación mjs solo declara pruebas que existen, y falla al cargarse si declara una que no', (contexto) => {
  assert.deepEqual(pruebasMjsAusentes(RAIZ), []);
  const area = areaDePrueba(contexto);
  const carpeta = join(area, 'pruebas', 'navegadores');
  mkdirSync(join(area, 'scripts'));
  mkdirSync(carpeta, { recursive: true });
  const modulo = join(area, 'scripts', 'pruebas-mjs.ts');
  copyFileSync(join(RAIZ, 'scripts', 'pruebas-mjs.ts'), modulo);
  writeFileSync(join(carpeta, 'remoto-ayudas.test.mjs'), '');
  mkdirSync(join(carpeta, 'portada-publica.test.mjs'));
  const ausentes = pruebasMjsAusentes(area);
  assert.equal(ausentes.includes('pruebas/navegadores/remoto-ayudas.test.mjs'), false);
  assert.equal(ausentes.includes('pruebas/navegadores/portada-publica.test.mjs'), true, 'una carpeta no es la prueba');
  const cargar = () => spawnSync(process.execPath, [modulo], { encoding: 'utf8', timeout: PLAZO_DE_PRUEBA_MS });
  const fallido = cargar();
  assert.notEqual(fallido.status, 0);
  assert.match(fallido.stderr, /Prueba mjs clasificada que no existe: .*portada-publica\.test\.mjs/);
  rmSync(join(carpeta, 'portada-publica.test.mjs'), { recursive: true });
  for (const ruta of ausentes) {
    writeFileSync(join(area, ruta), '');
  }
  assert.deepEqual(pruebasMjsAusentes(area), []);
  assert.equal(cargar().status, 0, 'con todas las pruebas presentes el módulo carga');
});

test('la suite de navegador exige que cada archivo ejecute sus casos sin omitidos ni pendientes', () => {
  const resumen = (entryFile: string | undefined, passed: number, skipped = 0) =>
    JSON.stringify({
      type: 'test:summary',
      data: {
        ...(entryFile ? { entryFile } : {}),
        success: true,
        counts: { passed, skipped, failed: 0, cancelled: 0, todo: 0, tests: passed + skipped },
      },
    });
  const verde = resumen('/a.test.mjs', 1);
  const omitido = resumen('/b.test.mjs', 0, 1);
  const global = resumen(undefined, 1, 1);
  assert.throws(() =>
    exigirPruebasNavegadorEjecutadas([verde, omitido, global].join('\n'), ['/a.test.mjs', '/b.test.mjs']),
  );
  assert.throws(() =>
    exigirPruebasNavegadorEjecutadas([verde, resumen(undefined, 1)].join('\n'), ['/a.test.mjs', '/b.test.mjs']),
  );
  assert.doesNotThrow(() =>
    exigirPruebasNavegadorEjecutadas([verde, resumen('/b.test.mjs', 1), resumen(undefined, 2)].join('\n'), [
      '/a.test.mjs',
      '/b.test.mjs',
    ]),
  );
});
