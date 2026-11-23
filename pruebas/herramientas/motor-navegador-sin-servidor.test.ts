// El motor que se compila para el navegador (tsconfig.navegador.json) no alcanza código privado del servidor: la
// administración, la API de socios, A2A ni los controles administrativos. Se recorre el grafo de importaciones que
// llega al navegador desde las entradas declaradas: las importaciones estáticas y los import() literales. Las de solo
// tipos no cuentan, porque desaparecen al compilar.
//
// Contrato del motor del dispositivo: las rutas locales de la API que monta src/plataforma/navegador/api-local.ts
// (src/api/rutas, http, cuerpo-local, contexto-api y estado-conectividad) y el MCP local (src/api/mcp) forman parte
// del motor y se quedan. Con ellas el dispositivo responde sus propias consultas, y WebMCP ofrece al navegador las
// mismas herramientas que el servidor MCP.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build, type Metafile } from 'esbuild';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
const CONFIGURACION = 'tsconfig.navegador.json';
const PRIVADOS: readonly RegExp[] = [
  /^src\/administracion\//u,
  /^src\/api\/socios\//u,
  /^src\/api\/a2a\//u,
  /^src\/api\/controles-administrativos\.ts$/u,
];
const CONTRATO_DEL_DISPOSITIVO = [
  'src/plataforma/navegador/api-local.ts',
  'src/api/rutas/ocupaciones.ts',
  'src/api/http.ts',
  'src/api/cuerpo-local.ts',
  'src/api/mcp/servidor-mcp.ts',
  'src/api/mcp/herramientas.ts',
];
// esbuild no sigue estas formas de cargar código; si apareciera alguna, el recorrido dejaría de ser completo.
const CARGAS_QUE_NO_SE_SIGUEN = /\bimport\.meta\.url\b|\bimportScripts\s*\(/u;

function entradasDelMotor(): string[] {
  const texto = readFileSync(join(RAIZ, CONFIGURACION), 'utf8').replace(/^\s*\/\/.*$/gmu, '');
  const configuracion: unknown = JSON.parse(texto);
  assert.ok(configuracion !== null && typeof configuracion === 'object' && 'files' in configuracion);
  const { files } = configuracion;
  assert.ok(Array.isArray(files) && files.length > 0, `${CONFIGURACION} declara sus entradas en «files»`);
  return files.map((archivo: unknown) => {
    assert.equal(typeof archivo, 'string');
    return String(archivo);
  });
}

async function grafoDelMotor(entradas: readonly string[]): Promise<Metafile> {
  const { metafile } = await build({
    absWorkingDir: RAIZ,
    entryPoints: [...entradas],
    tsconfig: CONFIGURACION,
    bundle: true,
    splitting: true,
    format: 'esm',
    platform: 'browser',
    outdir: 'salida-no-escrita',
    write: false,
    metafile: true,
    logLevel: 'silent',
  });
  return metafile;
}

/** De qué módulo llega cada uno, en el primer camino desde las entradas. */
function procedencias(grafo: Metafile, entradas: readonly string[]): Map<string, string | null> {
  const origen = new Map<string, string | null>(entradas.map((entrada) => [entrada, null]));
  const pendientes = [...entradas];
  for (let actual = pendientes.shift(); actual !== undefined; actual = pendientes.shift()) {
    for (const { path } of grafo.inputs[actual]?.imports ?? []) {
      if (!origen.has(path) && path in grafo.inputs) {
        origen.set(path, actual);
        pendientes.push(path);
      }
    }
  }
  return origen;
}

function camino(origen: ReadonlyMap<string, string | null>, archivo: string): string {
  const tramos = [archivo];
  for (let padre = origen.get(archivo); padre; padre = origen.get(padre)) {
    tramos.unshift(padre);
  }
  return tramos.join(' → ');
}

const esPrivado = (archivo: string) => PRIVADOS.some((patron) => patron.test(archivo));

test('el motor del navegador no alcanza la administración, la API de socios, A2A ni los controles', async () => {
  const entradas = entradasDelMotor();
  const grafo = await grafoDelMotor(entradas);
  const origen = procedencias(grafo, entradas);
  const alcanzados = Object.keys(grafo.inputs).filter(esPrivado).sort();
  assert.deepEqual(
    alcanzados,
    [],
    `El motor del navegador arrastra código privado del servidor:\n${alcanzados
      .map((archivo) => `  ${camino(origen, archivo)}`)
      .join('\n')}`,
  );
});

test('el recorrido parte de las entradas declaradas y conserva el contrato del motor del dispositivo', async () => {
  const entradas = entradasDelMotor();
  const grafo = await grafoDelMotor(entradas);
  for (const archivo of [...entradas, ...CONTRATO_DEL_DISPOSITIVO]) {
    assert.ok(archivo in grafo.inputs, `${archivo} está en el motor del navegador`);
  }
  const sinSeguir = Object.keys(grafo.inputs).filter(
    (archivo) =>
      /\.[cm]?[jt]s$/u.test(archivo) && CARGAS_QUE_NO_SE_SIGUEN.test(readFileSync(join(RAIZ, archivo), 'utf8')),
  );
  assert.deepEqual(sinSeguir, [], 'Ningún módulo del motor carga código por una vía que el recorrido no sigue');
});

test('la lista de privados distingue el servidor de las rutas locales', () => {
  const privados = [
    'src/administracion/accesos.ts',
    'src/api/socios/oauth.ts',
    'src/api/a2a/tarjeta.ts',
    'src/api/controles-administrativos.ts',
  ];
  const permitidos = [
    'src/api/controles-administrativos-locales.ts',
    'src/api/mcp/servidor-mcp.ts',
    'src/api/rutas/ocupaciones.ts',
    'src/plataforma/administracion.ts',
  ];
  assert.deepEqual([...privados, ...permitidos].filter(esPrivado), privados);
});
