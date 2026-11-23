import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// Cada lector de un archivo del paquete suelta su texto cuando ha guardado lo leído: si no, el texto se queda en memoria
// lo que dura el aislado. En el Worker los archivos llegan como bytes; aquí se reproduce igual con un gancho de módulos.

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
const PLAZO = 60_000;
const CARPETAS_DE_FUENTES = ['src', 'motores', 'compartido', 'herramientas', 'scripts'];
/** Las únicas fuentes que leen archivos del paquete; un lector nuevo se añade aquí a propósito, con su soltar. */
const LECTORES_ADMITIDOS = ['src/comun/nombres-propios.ts', 'src/plataforma/cloudflare/paquete.ts'];
/** Una importación, estática o dinámica, del módulo de lectura del paquete, con lo que importa. */
const IMPORTACION_DEL_PAQUETE =
  /import\s*(?:\(\s*|([^;]*?)\s*from\s*)['"][^'"]*archivo-del-paquete(?:\.[cm]?[jt]s)?['"]/gu;

function fuentes(carpeta: string): string[] {
  return readdirSync(join(RAIZ, carpeta), { recursive: true, withFileTypes: true })
    .filter((entrada) => entrada.isFile() && /\.(?:ts|js|mjs)$/.test(entrada.name))
    .map((entrada) => join(entrada.parentPath, entrada.name))
    .filter((ruta) => !/[\\/](?:node_modules|pruebas)[\\/]/.test(ruta));
}

/** El código sin sus comentarios: una llamada escrita en un comentario no cuenta. */
const sinComentarios = (codigo: string) => codigo.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/(^|[^:])\/\/.*$/gmu, '$1');

/** Si una importación del módulo de lectura trae `leerArchivoDelPaquete`, con o sin alias, o el módulo entero. */
const importaLaLectura = (clausula: string | undefined) =>
  clausula === undefined || /\bleerArchivoDelPaquete\b|\*\s*as\b/u.test(clausula);

test('solo leen el paquete las fuentes admitidas, y cada una suelta su texto', () => {
  const lectores = CARPETAS_DE_FUENTES.flatMap(fuentes)
    .map((ruta) => ({ ruta: relative(RAIZ, ruta), codigo: sinComentarios(readFileSync(ruta, 'utf8')) }))
    .filter(({ ruta }) => ruta !== 'src/comun/archivo-del-paquete.ts')
    .filter(({ codigo }) =>
      [...codigo.matchAll(IMPORTACION_DEL_PAQUETE)].some(([, clausula]) => importaLaLectura(clausula)),
    );
  assert.deepEqual(
    lectores.map(({ ruta }) => ruta).sort(),
    LECTORES_ADMITIDOS,
    'Un lector nuevo del paquete se añade a LECTORES_ADMITIDOS a propósito, con su soltar',
  );
  const sinSoltar = lectores
    .filter(({ codigo }) => !/\bsoltarArchivoDelPaquete\(/u.test(codigo))
    .map(({ ruta }) => ruta);
  assert.deepEqual(sinSoltar, []);
});

test('tras arrancar el Worker oficial y leer todo el paquete no queda ningún texto sin soltar', () => {
  const codigo = `
    import { registerHooks } from 'node:module';
    import { fileURLToPath } from 'node:url';
    const bytes = new Map();
    globalThis.__bytesDelPaquete = bytes;
    registerHooks({
      resolve(especificador, contexto, siguiente) {
        const resuelto = siguiente(especificador, contexto);
        if (/\\/datos\\/[^/]+\\.json$/.test(resuelto.url)) return { ...resuelto, importAttributes: {}, format: 'module' };
        return resuelto;
      },
      load(url, contexto, siguiente) {
        if (!/\\/datos\\/[^/]+\\.json$/.test(url)) return siguiente(url, contexto);
        const fuente = 'const leidos = (await import("node:fs")).readFileSync(' + JSON.stringify(fileURLToPath(url)) + ');'
          + 'const b = leidos.buffer.slice(leidos.byteOffset, leidos.byteOffset + leidos.byteLength);'
          + 'globalThis.__bytesDelPaquete.set(' + JSON.stringify(url) + ', b); export default b;';
        return { format: 'module', source: fuente, shortCircuit: true };
      },
    });
    await import('./src/plataforma/cloudflare/worker-oficial.ts');
    const { PAQUETE } = await import('./src/plataforma/cloudflare/paquete.ts');
    for (const parte of Object.keys(PAQUETE)) void PAQUETE[parte];
    const { leerArchivoDelPaquete } = await import('./src/comun/archivo-del-paquete.ts');
    const leidos = [...bytes].filter(([, b]) => b.detached);
    const sinSoltar = leidos.filter(([, b]) => { try { leerArchivoDelPaquete(b); return true; } catch { return false; } });
    console.log(JSON.stringify({ leidos: leidos.length, sinSoltar: sinSoltar.map(([url]) => url.replace(/^.*\\/datos\\//, 'datos/')) }));
  `;
  const resultado = spawnSync(process.execPath, ['--input-type=module', '-e', codigo], {
    cwd: RAIZ,
    encoding: 'utf8',
    timeout: PLAZO,
  });
  assert.equal(
    resultado.status,
    0,
    resultado.stderr || resultado.error?.message || 'El proceso no terminó correctamente',
  );
  const { leidos, sinSoltar } = JSON.parse(resultado.stdout.trim().split('\n').at(-1) ?? '{}');
  assert.ok(leidos > 1, 'el Worker leyó como bytes la lista de nombres y las partes del paquete');
  assert.deepEqual(sinSoltar, []);
});
