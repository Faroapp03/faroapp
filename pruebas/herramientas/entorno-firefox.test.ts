/** La batería de navegador prepara las carpetas de Firefox de cada ejecución (una por batería) sin abrir navegadores. */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { type TestContext, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  conFirefox,
  entornoParaLanzar,
  firefoxHeredado,
  prepararFirefox,
  retirarFirefox,
} from '../../scripts/entorno-firefox.ts';
import { FalloDeComprobacion } from '../../scripts/fallo-de-comprobacion.ts';
import {
  ejecutarPaso,
  listarPruebasNavegador,
  pasoPruebasNavegador,
  pruebasNavegadorPedidas,
} from '../../scripts/verificar.ts';

const PLAZO_MS = 30_000;
const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
const VARIABLES = ['MOZ_APP_DATA', 'MOZ_LOCAL_APP_DATA'] as const;

function areaDePrueba(contexto: TestContext): string {
  const area = mkdtempSync(join(realpathSync(tmpdir()), 'faro entorno firefox '));
  contexto.after(() => rmSync(area, { recursive: true, force: true }));
  return area;
}

/** Sustituye una variable de quien lanza durante el caso y la restituye después. */
function variableDeQuienLanza(contexto: TestContext, nombre: string, valor: string): void {
  const anterior = process.env[nombre];
  process.env[nombre] = valor;
  contexto.after(() => {
    if (anterior === undefined) {
      delete process.env[nombre];
    } else {
      process.env[nombre] = anterior;
    }
  });
}

test('cada ejecución recibe carpetas de Firefox nuevas, absolutas y ya creadas', (contexto) => {
  const area = areaDePrueba(contexto);
  const primera = prepararFirefox(area);
  const segunda = prepararFirefox(area);
  for (const carpetas of [primera, segunda]) {
    for (const variable of VARIABLES) {
      const ruta = carpetas.entorno[variable];
      assert.ok(isAbsolute(ruta), `${variable} absoluta`);
      assert.ok(ruta.startsWith(`${carpetas.raiz}/`), `${variable} dentro de su ejecución`);
      assert.ok(statSync(ruta).isDirectory(), `${variable} creada antes del lanzamiento`);
    }
    assert.notEqual(carpetas.entorno.MOZ_APP_DATA, carpetas.entorno.MOZ_LOCAL_APP_DATA);
  }
  assert.notEqual(primera.raiz, segunda.raiz, 'dos ejecuciones no comparten carpetas');
  retirarFirefox(primera);
  assert.equal(existsSync(primera.raiz), false);
  assert.ok(existsSync(segunda.raiz), 'retirar una ejecución no toca otra');
});

test('una carpeta base relativa se rechaza', () => {
  assert.throws(() => prepararFirefox('relativa'), /absoluta/);
});

test('el paso de navegador lleva las variables de Firefox, excluye CFFIXED_USER_HOME y conserva la precarga', (contexto) => {
  const area = areaDePrueba(contexto);
  const { entorno } = prepararFirefox(area);
  const paso = pasoPruebasNavegador([join(area, 'caso.test.mjs')], entorno);
  assert.equal(paso.entorno?.MOZ_APP_DATA, entorno.MOZ_APP_DATA);
  assert.equal(paso.entorno?.MOZ_LOCAL_APP_DATA, entorno.MOZ_LOCAL_APP_DATA);
  assert.equal(paso.entorno?.HOME, undefined);
  assert.equal(paso.entorno?.CFFIXED_USER_HOME, undefined);
  assert.deepEqual(paso.excluir, ['CFFIXED_USER_HOME']);
  assert.match(paso.entorno?.NODE_OPTIONS ?? '', /--import=.*sin-red\.ts/);
  assert.ok(paso.argumentos.includes('--test-concurrency=1'));
});

/** Lo que ve un proceso de las variables que decide la batería. */
const VISTAS = `[process.env.MOZ_APP_DATA, process.env.MOZ_LOCAL_APP_DATA, process.env.CFFIXED_USER_HOME ?? null, process.env.HOME]`;

test('en el hijo y en el nieto: MOZ_* preparadas, sin CFFIXED_USER_HOME heredada y con HOME', async (contexto) => {
  const area = areaDePrueba(contexto);
  variableDeQuienLanza(contexto, 'MOZ_APP_DATA', '/ajena/de/quien/lanza');
  variableDeQuienLanza(contexto, 'MOZ_LOCAL_APP_DATA', 'relativa-de-quien-lanza');
  variableDeQuienLanza(contexto, 'CFFIXED_USER_HOME', join(area, 'hogar-heredado'));
  const { entorno } = prepararFirefox(area);
  const nieto = `const { execFileSync } = require('node:child_process');
const propias = { hijo: ${VISTAS} };
propias.nieto = JSON.parse(execFileSync(process.execPath, ['-e', 'process.stdout.write(JSON.stringify(' + ${JSON.stringify(VISTAS)} + '))'], { encoding: 'utf8' }));
process.stdout.write(JSON.stringify(propias));`;
  // El mismo paso de la batería, con su entorno y sus exclusiones; solo cambia la orden que se ejecuta.
  const salida = await ejecutarPaso(
    { ...pasoPruebasNavegador([], entorno), nombre: 'Entorno de Firefox', argumentos: ['-e', nieto] },
    area,
    PLAZO_MS,
  );
  const esperado = [entorno.MOZ_APP_DATA, entorno.MOZ_LOCAL_APP_DATA, null, process.env.HOME];
  assert.ok(process.env.HOME, 'quien lanza tiene HOME');
  assert.deepEqual(JSON.parse(salida), { hijo: esperado, nieto: esperado });
});

test('sin exclusión, el mismo hijo sí heredaría CFFIXED_USER_HOME: la prueba anterior distingue', async (contexto) => {
  const area = areaDePrueba(contexto);
  const heredada = join(area, 'hogar-heredado');
  variableDeQuienLanza(contexto, 'CFFIXED_USER_HOME', heredada);
  const salida = await ejecutarPaso(
    {
      nombre: 'Sin exclusión',
      comando: process.execPath,
      argumentos: ['-e', `process.stdout.write(JSON.stringify(${VISTAS}))`],
    },
    area,
    PLAZO_MS,
  );
  assert.equal(JSON.parse(salida)[2], heredada);
});

test('una preparación que falla a medias no deja carpetas', (contexto) => {
  const area = areaDePrueba(contexto);
  const fallaEnCache = (ruta: string): void => {
    if (ruta.endsWith('cache')) {
      throw new Error('disco lleno simulado');
    }
    mkdirSync(ruta);
  };
  assert.throws(() => prepararFirefox(area, fallaEnCache), /No se pueden crear las carpetas de Firefox: disco lleno/);
  assert.deepEqual(readdirSync(area), []);
});

test('conFirefox retira las carpetas al terminar y devuelve el resultado', async (contexto) => {
  const area = areaDePrueba(contexto);
  const valor = await conFirefox(area, async (entorno) => {
    assert.ok(statSync(entorno.MOZ_APP_DATA).isDirectory());
    return 'hecho';
  });
  assert.equal(valor, 'hecho');
  assert.deepEqual(readdirSync(area), []);
});

test('si fallan la tarea y la limpieza, se conserva el fallo de la tarea con su código y la limpieza se avisa aparte', async (contexto) => {
  const area = areaDePrueba(contexto);
  const avisos: string[] = [];
  const codigoDelPaso = 7;
  const original = new FalloDeComprobacion('Pruebas de navegador: termina con código 7', { codigo: codigoDelPaso });
  await assert.rejects(
    conFirefox(
      area,
      async () => {
        throw original;
      },
      () => {
        throw new Error('carpeta ocupada');
      },
      (texto) => avisos.push(texto),
    ),
    (error) => error === original && original.codigo === codigoDelPaso,
  );
  assert.equal(avisos.length, 1);
  assert.match(avisos[0] ?? '', /No se pueden retirar las carpetas de Firefox .*carpeta ocupada/);
});

test('si solo falla la limpieza, la ejecución no se da por correcta', async (contexto) => {
  const area = areaDePrueba(contexto);
  await assert.rejects(
    conFirefox(
      area,
      async () => 'correcto',
      () => {
        throw new Error('carpeta ocupada');
      },
    ),
    (error) => error instanceof FalloDeComprobacion && /falla la limpieza.*carpeta ocupada/.test(error.message),
  );
});

test('los lanzamientos directos reciben MOZ_* propias del proceso, conservan HOME y no llevan CFFIXED_USER_HOME', (contexto) => {
  variableDeQuienLanza(contexto, 'CFFIXED_USER_HOME', '/hogar/heredado');
  variableDeQuienLanza(contexto, 'MOZ_APP_DATA', '/ajena/de/quien/lanza');
  const primero = entornoParaLanzar();
  const segundo = entornoParaLanzar();
  assert.equal(primero.CFFIXED_USER_HOME, undefined);
  assert.equal(primero.HOME, process.env.HOME);
  for (const variable of VARIABLES) {
    const ruta = primero[variable] ?? '';
    assert.ok(isAbsolute(ruta) && statSync(ruta).isDirectory(), variable);
    assert.equal(segundo[variable], ruta, 'una sola preparación por proceso');
  }
  assert.notEqual(primero.MOZ_APP_DATA, '/ajena/de/quien/lanza');
});

test('las pruebas sueltas usan el mismo lanzador y solo se admiten las de la suite de navegador', () => {
  const [primera] = listarPruebasNavegador(RAIZ);
  assert.ok(primera);
  assert.deepEqual(pruebasNavegadorPedidas(RAIZ, [primera]), [primera]);
  assert.throws(() => pruebasNavegadorPedidas(RAIZ, []), /ninguna indicada/);
  assert.throws(() => pruebasNavegadorPedidas(RAIZ, [join(RAIZ, 'package.json')]), /No son pruebas de navegador/);
});

test('solo se reutilizan unas MOZ_* heredadas si las dos son absolutas y existen', (contexto) => {
  const area = areaDePrueba(contexto);
  const { entorno } = prepararFirefox(area);
  assert.deepEqual(firefoxHeredado({ ...entorno }), entorno);
  assert.equal(firefoxHeredado({ MOZ_APP_DATA: entorno.MOZ_APP_DATA }), undefined);
  assert.equal(firefoxHeredado({ ...entorno, MOZ_LOCAL_APP_DATA: 'relativa' }), undefined);
  assert.equal(firefoxHeredado({ ...entorno, MOZ_APP_DATA: join(area, 'no-existe') }), undefined);
});

test('dentro de la batería, un lanzamiento directo reutiliza las MOZ_* del lanzador y no crea carpetas', (contexto) => {
  const deLaBateria = prepararFirefox(areaDePrueba(contexto)).entorno;
  variableDeQuienLanza(contexto, 'MOZ_APP_DATA', deLaBateria.MOZ_APP_DATA);
  variableDeQuienLanza(contexto, 'MOZ_LOCAL_APP_DATA', deLaBateria.MOZ_LOCAL_APP_DATA);
  const base = areaDePrueba(contexto);
  const entorno = entornoParaLanzar(base);
  assert.equal(entorno.MOZ_APP_DATA, deLaBateria.MOZ_APP_DATA);
  assert.equal(entorno.MOZ_LOCAL_APP_DATA, deLaBateria.MOZ_LOCAL_APP_DATA);
  assert.deepEqual(readdirSync(base), [], 'no hay carpetas propias que puedan quedar como restos');
});
