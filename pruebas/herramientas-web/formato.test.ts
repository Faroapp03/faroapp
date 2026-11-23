// El formateador usa el proyecto de su módulo, también desde otro cwd y una copia con espacios y Unicode.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, parse } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
const TEMPORAL = mkdtempSync(join(tmpdir(), 'formato-portable-'));
const COPIA = join(TEMPORAL, 'Mis documentos', 'Año 2026');
const TEXTO = "export const dato={texto:'Año 2026 · Catalunya',valor:1}";
const ESPERADO = "export const dato = { texto: 'Año 2026 · Catalunya', valor: 1 };\n";
/** El proceso padre deja margen al límite de treinta segundos del formateador. */
const PLAZO_PROCESO_MS = 35_000;

mkdirSync(join(COPIA, 'herramientas', 'comun'), { recursive: true });
mkdirSync(join(COPIA, 'web', 'scripts'), { recursive: true });
for (const archivo of ['herramientas/comun/archivos.ts', 'biome.json', 'package.json']) {
  copyFileSync(join(RAIZ, archivo), join(COPIA, archivo));
}
// Reutiliza la instalación local: el helper y la configuración sí pertenecen a la copia aislada.
symlinkSync(join(RAIZ, 'node_modules'), join(COPIA, 'node_modules'), 'dir');
after(() => rmSync(TEMPORAL, { recursive: true, force: true }));

/** Un proceso separado evita cambiar el cwd de otras pruebas del mismo ejecutor. */
function formatearDesde(cwd: string, archivo: string, raiz = COPIA, texto = TEXTO): string {
  const helper = pathToFileURL(join(raiz, 'herramientas', 'comun', 'archivos.ts')).href;
  const codigo =
    `import { formatearTextoConBiome } from ${JSON.stringify(helper)};` +
    "import { readFileSync } from 'node:fs';" +
    `process.stdout.write(formatearTextoConBiome(readFileSync(0, 'utf8'), ${JSON.stringify(archivo)}));`;
  return execFileSync(process.execPath, ['--input-type=module', '--eval', codigo], {
    cwd,
    input: texto,
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: PLAZO_PROCESO_MS,
  });
}

test('el JSON publicado conserva sus bytes al formatearlo desde un cwd ajeno', () => {
  const archivo = join(RAIZ, 'web', 'recursos', 'globo', 'fronteras.json');
  const texto = readFileSync(archivo, 'utf8');
  assert.equal(formatearDesde(parse(TEMPORAL).root, archivo, RAIZ, texto), texto);
});

for (const archivo of ['web/scripts/prueba.js', join(COPIA, 'web', 'scripts', 'prueba.js')]) {
  test(`formato idéntico con ruta ${archivo.startsWith(COPIA) ? 'absoluta' : 'relativa'} desde la copia y cwd ajeno`, () => {
    assert.equal(formatearDesde(COPIA, archivo), ESPERADO);
    assert.equal(formatearDesde(parse(TEMPORAL).root, archivo), ESPERADO);
  });
}
