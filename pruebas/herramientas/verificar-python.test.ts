// El control Python usa unittest real, sin aceptar suites vacías como comprobación del producto.

import assert from 'node:assert/strict';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type TestContext, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ejecutarPaso, probarPython } from '../../scripts/verificar.ts';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));

/** Copia únicamente el descubridor y una suite artificial; reutiliza el intérprete instalado para la prueba. */
function prepararSuite(contexto: TestContext, codigo: string): string {
  const area = mkdtempSync(join(tmpdir(), 'pruebas Python Año 2026 '));
  contexto.after(() => rmSync(area, { recursive: true, force: true }));
  const pruebas = join(area, 'plataforma_datos', 'orquestacion', 'pruebas');
  mkdirSync(pruebas, { recursive: true });
  mkdirSync(join(area, 'scripts'));
  writeFileSync(join(area, 'plataforma_datos', '__init__.py'), '');
  symlinkSync(join(RAIZ, '.venv'), join(area, '.venv'), 'dir');
  copyFileSync(join(RAIZ, 'scripts/pruebas_python.py'), join(area, 'scripts/pruebas_python.py'));
  // El lanzador carga su guardia de red desde la carpeta hermana: se copia con él, como en una instalación.
  cpSync(join(RAIZ, 'scripts/sin_red'), join(area, 'scripts/sin_red'), { recursive: true });
  writeFileSync(join(area, 'plataforma_datos', 'orquestacion', '__init__.py'), '');
  writeFileSync(join(pruebas, '__init__.py'), '');
  writeFileSync(join(pruebas, 'test_caso.py'), codigo);
  return area;
}

const CASO_CORRECTO =
  'import unittest\nclass Caso(unittest.TestCase):\n    def test_caso(self): self.assertEqual(2, 2)\n';

test('el paso Python ejecuta una suite real en una carpeta con espacios y acentos', async (contexto) => {
  const salida = await probarPython(prepararSuite(contexto, CASO_CORRECTO));
  assert.match(salida, /Ran 1 test/);
  assert.match(salida, /\bOK\b/);
});

test('el descubridor Python no depende del directorio de trabajo', async (contexto) => {
  const area = prepararSuite(contexto, CASO_CORRECTO);
  const salida = await ejecutarPaso(
    {
      nombre: 'Python desde otra carpeta',
      comando: join(RAIZ, '.venv/bin/python'),
      argumentos: [join(area, 'scripts/pruebas_python.py')],
    },
    '/',
  );
  assert.match(salida, /Ran 1 test/);
});

test('el descubridor usa un temporal canónico cuando TMPDIR es un enlace del sistema', async (contexto) => {
  const codigo = `import os, tempfile, unittest
from pathlib import Path
class Caso(unittest.TestCase):
    def test_temporal(self):
        temporal = Path(tempfile.gettempdir())
        self.assertEqual(temporal, temporal.resolve())
        self.assertEqual(Path(os.environ['TMPDIR']), temporal)
`;
  const area = prepararSuite(contexto, codigo);
  const real = join(area, 'temporal-real');
  const alias = join(area, 'temporal-enlazado');
  mkdirSync(real);
  symlinkSync(real, alias, 'dir');
  const salida = await ejecutarPaso(
    {
      nombre: 'Python con temporal enlazado',
      comando: join(RAIZ, '.venv/bin/python'),
      argumentos: [join(area, 'scripts/pruebas_python.py')],
      entorno: { TMPDIR: alias },
    },
    area,
  );
  assert.match(salida, /Ran 1 test/);
  assert.match(salida, /\bOK\b/);
});

test('una suite Python vacía no hace pasar la verificación', async (contexto) => {
  await assert.rejects(probarPython(prepararSuite(contexto, '')), /No hay pruebas Python ejecutadas/);
});

test('una suite Python totalmente omitida tampoco hace pasar la verificación', async (contexto) => {
  const codigo = CASO_CORRECTO.replace('class Caso', '@unittest.skip("omitida")\nclass Caso');
  await assert.rejects(probarPython(prepararSuite(contexto, codigo)), /No hay pruebas Python ejecutadas/);
});

const SUBCASOS_OMITIDOS = `import unittest
class Caso(unittest.TestCase):
    def test_subcasos(self):
        for indice in range(2):
            with self.subTest(indice=indice):
                self.skipTest("subcaso omitido")
`;

test('los subcasos Python omitidos no cuentan como éxitos efectivos', async (contexto) => {
  await assert.rejects(probarPython(prepararSuite(contexto, SUBCASOS_OMITIDOS)), /No hay pruebas Python ejecutadas/);
});

test('un caso Python correcto cuenta aunque otra prueba omita varios subcasos', async (contexto) => {
  const codigo = `${SUBCASOS_OMITIDOS}    def test_correcto(self): self.assertEqual(2, 2)\n`;
  assert.match(await probarPython(prepararSuite(contexto, codigo)), /\bOK\b/);
});

test('un subcaso Python aprobado cuenta aunque su mismo método omita otros', async (contexto) => {
  const codigo = SUBCASOS_OMITIDOS.replace(
    'self.skipTest("subcaso omitido")',
    'if indice == 0: self.skipTest("subcaso omitido")\n                self.assertEqual(2, 2)',
  );
  assert.match(await probarPython(prepararSuite(contexto, codigo)), /\bOK\b/);
});

const FALLO_ESPERADO = `import unittest
class Caso(unittest.TestCase):
    @unittest.expectedFailure
    def test_previsto(self):
        with self.subTest(indice=0): self.assertEqual(2, 2)
        with self.subTest(indice=1): self.fail("fallo previsto")
`;

test('los subcasos de un fallo esperado no sustituyen una prueba Python aprobada', async (contexto) => {
  await assert.rejects(probarPython(prepararSuite(contexto, FALLO_ESPERADO)), /No hay pruebas Python ejecutadas/);
});

test('un fallo esperado no anula otros métodos Python aprobados', async (contexto) => {
  const codigo = `${FALLO_ESPERADO}    def test_correcto(self): self.assertEqual(2, 2)\n`;
  assert.match(await probarPython(prepararSuite(contexto, codigo)), /\bOK\b/);
});

test('un fallo Python conserva su causa y hace fallar el paso requerido', async (contexto) => {
  const codigo = CASO_CORRECTO.replace('self.assertEqual(2, 2)', 'self.fail("fallo reproducible")');
  await assert.rejects(probarPython(prepararSuite(contexto, codigo)), /fallo reproducible/);
});

test('un error al importar pruebas Python impide aprobar el control', async (contexto) => {
  const codigo = 'raise RuntimeError("error al importar caso")\n';
  await assert.rejects(probarPython(prepararSuite(contexto, codigo)), /error al importar caso/);
});

test('la ausencia del descubridor Python no se ignora', async (contexto) => {
  const area = prepararSuite(contexto, CASO_CORRECTO);
  rmSync(join(area, 'scripts/pruebas_python.py'));
  await assert.rejects(probarPython(area), /Pruebas Python: termina con código/);
});

/** Añade una suite del dominio Cursos para comprobar el descubrimiento de la plataforma. */
function agregarPruebasPlataforma(area: string, codigo: string): void {
  const dominio = join(area, 'plataforma_datos', 'cursos');
  const pruebas = join(dominio, 'pruebas');
  mkdirSync(pruebas, { recursive: true });
  writeFileSync(join(dominio, '__init__.py'), '');
  writeFileSync(join(pruebas, '__init__.py'), '');
  writeFileSync(join(pruebas, 'test_plataforma.py'), codigo);
}

test('el descubridor incluye Cursos junto con las pruebas de la cadena', async (contexto) => {
  const area = prepararSuite(contexto, CASO_CORRECTO);
  agregarPruebasPlataforma(area, CASO_CORRECTO);
  assert.match(await probarPython(area), /Ran 2 tests/);
});

test('un fallo de la plataforma no queda oculto por una cadena correcta', async (contexto) => {
  const area = prepararSuite(contexto, CASO_CORRECTO);
  agregarPruebasPlataforma(area, CASO_CORRECTO.replace('self.assertEqual(2, 2)', 'self.fail("fallo de Cursos")'));
  await assert.rejects(probarPython(area), /fallo de Cursos/);
});

test('una plataforma ausente no se omite silenciosamente', async (contexto) => {
  const area = prepararSuite(contexto, CASO_CORRECTO);
  rmSync(join(area, 'plataforma_datos'), { recursive: true });
  await assert.rejects(probarPython(area), /plataforma_datos/);
});

const MODULO_CON_FIXTURES = `import json, os, socket, tempfile, unittest
from pathlib import Path
import guardia_red
def anotar(evento):
    with Path(__file__).with_suffix('.registro').open('a') as f:
        print(json.dumps([evento, os.getpid(), tempfile.gettempdir()]), file=f)
def setUpModule(): anotar('preparar módulo')
def tearDownModule(): anotar('cerrar módulo')
class Caso(unittest.TestCase):
    @classmethod
    def setUpClass(cls): anotar('preparar clase')
    @classmethod
    def tearDownClass(cls): anotar('cerrar clase')
    def test_a(self):
        anotar('a')
        self.assertEqual(Path(os.environ['TMPDIR']), Path(tempfile.gettempdir()).resolve())
        with self.assertRaises(guardia_red.ConexionExternaProhibida): socket.getaddrinfo('externo.invalid', 443)
    def test_b(self): anotar('b')
`;

function prepararLotes(t: TestContext, codigoCursos = MODULO_CON_FIXTURES) {
  const area = prepararSuite(t, MODULO_CON_FIXTURES);
  agregarPruebasPlataforma(area, codigoCursos);
  const directorio = (dominio: string) => join(area, 'plataforma_datos', dominio, 'pruebas');
  writeFileSync(join(directorio('cursos'), 'test_otro.py'), codigoCursos);
  writeFileSync(join(directorio('orquestacion'), 'test_otro.py'), MODULO_CON_FIXTURES);
  const registros = [
    join(directorio('cursos'), 'test_plataforma.registro'),
    join(directorio('cursos'), 'test_otro.registro'),
    join(directorio('orquestacion'), 'test_caso.registro'),
    join(directorio('orquestacion'), 'test_otro.registro'),
  ] as const;
  return { area, registros };
}

/** Emula la capacidad declarada por el sistema; intérpretes, recibos, guardia y unittest son los reales. */
async function ejecutarConCpu(area: string, dos: boolean, secuencial = false): Promise<string> {
  const orden = `import sys
sys.path.insert(0, sys.argv[1])
import pruebas_python as pruebas
pruebas.admite_dos_procesos = lambda: ${dos ? 'True' : 'False'}
sys.exit(pruebas.principal(secuencial=${secuencial ? 'True' : 'False'}))`;
  return ejecutarPaso(
    {
      nombre: 'Pruebas Python',
      comando: join(area, '.venv/bin/python'),
      argumentos: ['-c', orden, join(area, 'scripts')],
    },
    area,
  );
}

for (const [modo, dos, secuencial] of [
  ['dos CPU', true, false],
  ['una CPU', false, false],
  ['secuencial en dos CPU', true, true],
] as const) {
  test(`el lote Python conserva los métodos, fixtures, temporales y guardias con ${modo}`, async (t) => {
    const { area, registros } = prepararLotes(t);
    const salida = await ejecutarConCpu(area, dos, secuencial);
    const procesos = dos && !secuencial ? 2 : 1;
    assert.match(salida, procesos === 2 ? /2 procesos, Cursos 4 casos y general 4 casos/ : /1 proceso, 8 casos/);
    assert.match(salida, /Ran 8 tests/);
    const pids = new Set<number>();
    const temporales = new Set<string>();
    for (const registro of registros) {
      const datos = readFileSync(registro, 'utf8')
        .trim()
        .split('\n')
        .map((linea) => JSON.parse(linea) as [string, number, string]);
      assert.deepEqual(
        datos.map(([evento]) => evento),
        ['preparar módulo', 'preparar clase', 'a', 'b', 'cerrar clase', 'cerrar módulo'],
      );
      assert.equal(new Set(datos.map(([, pid]) => pid)).size, 1, 'El módulo entero usa un proceso');
      for (const [, pid, temporal] of datos) {
        pids.add(pid);
        temporales.add(temporal);
      }
    }
    assert.equal(pids.size, procesos);
    assert.equal(temporales.size, procesos);
  });
}

test('el fallo de un fixture del hijo conserva su causa aunque el lote general apruebe', async (t) => {
  const { area } = prepararLotes(
    t,
    `${MODULO_CON_FIXTURES}\ndef setUpModule(): raise RuntimeError("fallo al preparar Cursos")\n`,
  );
  await assert.rejects(ejecutarConCpu(area, true), /fallo al preparar Cursos/);
});

test('un proceso de Cursos interrumpido tampoco hace pasar la verificación', async (t) => {
  const { area } = prepararLotes(t, `${MODULO_CON_FIXTURES}\ndef setUpModule(): os._exit(7)\n`);
  await assert.rejects(ejecutarConCpu(area, true), /código 7 sin entregar su resultado/);
});

test('un corte en un fixture identifica el módulo y retira el temporal de ambos lotes', async (t) => {
  const codigo = `${MODULO_CON_FIXTURES}
def setUpModule():
    import signal
    Path(__file__).with_suffix('.registro').write_text(str(Path(tempfile.gettempdir()).parent))
    os.kill(os.getppid(), signal.SIGTERM)
    signal.pause()
`;
  const { area, registros } = prepararLotes(t, codigo);
  await assert.rejects(ejecutarConCpu(area, true), (error: Error) => {
    assert.match(error.message, /termina con código 143/);
    assert.match(error.message, /2 procesos, Cursos 4 casos y general 4 casos/);
    assert.match(error.message, /empieza plataforma_datos\.cursos\.pruebas\.test_otro/);
    return true;
  });
  const temporal = readFileSync(registros[1], 'utf8');
  assert.equal(existsSync(temporal), false);
});

test('un lote de Cursos omitido conserva su recuento y los éxitos del lote general', async (t) => {
  const omitida = MODULO_CON_FIXTURES.replace('class Caso(', '@unittest.skip("solo para este lote")\nclass Caso(');
  const { area } = prepararLotes(t, omitida);
  assert.match(await ejecutarConCpu(area, true), /Ran 8 tests.*omitidos=4/);
});

test('la cuota de CPU efectiva contempla el grupo y los límites de sus antecesores', async (t) => {
  const codigo = `import tempfile, unittest
from pathlib import Path
from pruebas_python import cuotas_linux_suficientes
class Cuota(unittest.TestCase):
    def test_versiones_del_controlador(self):
        with tempfile.TemporaryDirectory() as t:
            raiz = Path(t)
            grupo = raiz / 'grupo'
            grupo.write_text('0::/agente/trabajo\\n')
            local = raiz / 'agente' / 'trabajo'
            local.mkdir(parents=True)
            (raiz / 'cpu.max').write_text('max 100000')
            (local / 'cpu.max').write_text('200000 100000')
            self.assertTrue(cuotas_linux_suficientes(raiz, grupo))
            (local.parent / 'cpu.max').write_text('150000 100000')
            self.assertFalse(cuotas_linux_suficientes(raiz, grupo))
            grupo.write_text('2:cpu,cpuacct:/agente\\n')
            hijo = raiz / 'cpu,cpuacct' / 'agente'
            hijo.mkdir(parents=True)
            (hijo / 'cpu.cfs_period_us').write_text('100000')
            (hijo / 'cpu.cfs_quota_us').write_text('90000')
            self.assertFalse(cuotas_linux_suficientes(raiz, grupo))
            (hijo / 'cpu.cfs_quota_us').write_text('-1')
            self.assertTrue(cuotas_linux_suficientes(raiz, grupo))
`;
  assert.match(await probarPython(prepararSuite(t, codigo)), /Ran 1 test/);
});

test('una suite devuelta por load_tests conserva su ejecución propia', async (t) => {
  const codigo = `${MODULO_CON_FIXTURES}
class Propia(unittest.TestSuite):
    def run(self, result, debug=False):
        print('Se ejecutó el contenedor propio', flush=True)
        return super().run(result, debug)
def load_tests(loader, tests, patron): return Propia(tests)
`;
  const { area } = prepararLotes(t, codigo);
  const salida = await ejecutarConCpu(area, true);
  assert.match(salida, /1 proceso, 8 casos/);
  assert.equal(salida.split('Se ejecutó el contenedor propio').length - 1, 2);
});
