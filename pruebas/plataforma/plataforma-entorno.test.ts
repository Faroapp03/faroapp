// Arranque del entorno Node en instalaciones aisladas: ningún perfil ni secreto de la máquina se lee.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PLAZO_MS = 5000;
const MAX_PERFIL_BYTES = 65_536;
const temporal = mkdtempSync(join(tmpdir(), 'entorno-c26-'));
const raiz = join(temporal, 'Mis documentos', 'Año 2026');
const fuente = fileURLToPath(new URL('../../src/', import.meta.url));
const destino = join(raiz, 'src', 'plataforma', 'node');
mkdirSync(destino, { recursive: true });
writeFileSync(join(raiz, 'package.json'), '{"type":"module"}');
after(() => rmSync(temporal, { recursive: true, force: true }));

/** Copia solo el adaptador y enlaza dependencias de código; los perfiles se crean dentro de esta instalación. */
function instalar(): void {
  for (const entrada of readdirSync(fuente)) {
    if (entrada !== 'plataforma') {
      symlinkSync(join(fuente, entrada), join(raiz, 'src', entrada));
    }
  }
  copyFileSync(
    join(fuente, 'plataforma', 'variables-del-servicio.ts'),
    join(raiz, 'src', 'plataforma', 'variables-del-servicio.ts'),
  );
  symlinkSync(join(fuente, 'plataforma', 'configuracion.ts'), join(raiz, 'src', 'plataforma', 'configuracion.ts'));
  for (const archivo of ['entorno.ts', 'rutas.ts', 'lectura-configuracion.ts']) {
    copyFileSync(join(fuente, 'plataforma', 'node', archivo), join(destino, archivo));
  }
}
instalar();

/** El hijo termina siempre antes de devolver resultado, con ambiente sintético y directorio de trabajo ajeno. */
function ejecutar(codigo: string, entorno: Record<string, string> = {}): string {
  const modulo = pathToFileURL(join(destino, 'entorno.ts')).href;
  const rutas = pathToFileURL(join(destino, 'rutas.ts')).href;
  const programa = `import * as e from ${JSON.stringify(modulo)}; import { RUTAS } from ${JSON.stringify(rutas)}; ${codigo}`;
  const resultado = spawnSync(process.execPath, ['--input-type=module', '-e', programa], {
    cwd: temporal,
    env: { ...entorno, TMPDIR: temporal },
    encoding: 'utf8',
    timeout: PLAZO_MS,
  });
  assert.equal(resultado.status, 0, resultado.stderr);
  return resultado.stdout.trim();
}

test('rutas de datos, código y perfiles dependen de la instalación con espacios y Unicode, no de cwd', () => {
  writeFileSync(join(raiz, '.dev.vars.sintetico'), 'FARO_MCP="no"\n');
  const texto = ejecutar(
    'console.log(JSON.stringify([RUTAS.raiz,RUTAS.codigo,RUTAS.paquete,e.leerEntorno("sintetico")]));',
  );
  assert.deepEqual(JSON.parse(texto), [
    `${realpathSync(raiz)}/`,
    `${realpathSync(join(raiz, 'src'))}/`,
    `${join(realpathSync(raiz), 'datos')}/`,
    { FARO_MCP: 'no' },
  ]);
});

test('un perfil desmesurado se rechaza antes de cargar sus variables', () => {
  writeFileSync(join(raiz, '.dev.vars.grande'), `FARO_MCP=${'x'.repeat(MAX_PERFIL_BYTES)}\n`);
  assert.equal(
    ejecutar('try { e.leerEntorno("grande"); console.log("aceptado"); } catch { console.log("rechazado"); }'),
    'rechazado',
  );
});

test('el nombre del perfil no admite separadores de ruta ni NUL', () => {
  for (const nombre of ['../x', 'x/y', 'x\\y', 'x\0y']) {
    const codigo = `try { e.leerEntornoSiExiste(${JSON.stringify(nombre)}); console.log("aceptado"); } catch { console.log("rechazado"); }`;
    assert.equal(ejecutar(codigo), 'rechazado', nombre);
  }
});

test('el perfil del servidor se lee desde su instalación y no mezcla variables del proceso', () => {
  writeFileSync(join(raiz, '.dev.vars.servidor'), 'FARO_MCP=no\nFARO_A2A=no\n');
  const codigo = `const s=e.leerEntornoDelServidor(); console.log(JSON.stringify([s.variables,Object.keys(s)]));`;
  assert.deepEqual(
    JSON.parse(
      ejecutar(codigo, {
        FARO_PERFIL: 'servidor',
        FARO_MCP: 'si',
        FARO_A2A: 'si',
        FARO_SECRETO_FIRMA: 'secreto-sintetico-del-proceso-no-debe-mezclarse',
      }),
    ),
    [{ FARO_MCP: 'no', FARO_A2A: 'no' }, ['variables']],
  );
});

test('la cifra de A2A se conserva también al habilitarlo y no permite ignorar otras opciones con cifras', () => {
  writeFileSync(join(raiz, '.dev.vars.agentes'), 'FARO_A2A=si\nFARO_ADMINISTRACION=si\n');
  assert.deepEqual(JSON.parse(ejecutar('console.log(JSON.stringify(e.leerEntorno("agentes")));')), {
    FARO_A2A: 'si',
    FARO_ADMINISTRACION: 'si',
  });
  writeFileSync(join(raiz, '.dev.vars.desconocido'), 'FARO_CAMPO2=valor-sintetico\n');
  assert.equal(
    ejecutar('try { e.leerEntorno("desconocido"); console.log("aceptado"); } catch { console.log("rechazado"); }'),
    'rechazado',
  );
});

test('una opción desconocida del archivo impide arrancar sin exponer su valor', () => {
  writeFileSync(join(raiz, '.dev.vars.invalido'), 'FARO_OPCION_DESCONOCIDA=valor-confidencial-sintetico\n');
  const texto = ejecutar(
    'try { e.leerEntorno("invalido"); console.log("aceptado"); } catch (error) { console.log(error.message); }',
  );
  assert.notEqual(texto, 'aceptado');
  assert.doesNotMatch(texto, /FARO_OPCION_DESCONOCIDA|valor-confidencial-sintetico/);
});

test('los perfiles mantienen nombres con puntos, espacios y acentos, y vacío elige el perfil por defecto', () => {
  for (const nombre of ['', 'local.v1', 'Año 2026']) {
    writeFileSync(
      join(raiz, nombre ? `.dev.vars.${nombre}` : '.dev.vars'),
      '# comentario\nFARO_MCP="no"\nFARO_A2A=\'no\'\n',
    );
    const codigo = `console.log(JSON.stringify(e.leerEntorno(${JSON.stringify(nombre)})));`;
    assert.deepEqual(JSON.parse(ejecutar(codigo)), { FARO_MCP: 'no', FARO_A2A: 'no' });
  }
});
