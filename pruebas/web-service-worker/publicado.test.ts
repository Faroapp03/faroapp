// El service worker publicado es un solo guion construido desde src/service-worker/: no carga guiones, lleva la
// política de su fuente única y web:comprobar exige que sea, byte a byte, el que da la construcción con sus valores.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { comprobarServiceWorker, generarCatalogos } from '../../herramientas/web/copia-sin-conexion.ts';
import { comprobarCspScript } from '../../herramientas/web/csp.ts';
import { textoPoliticaCache } from '../../herramientas/web/politica-cache.ts';
import { comprobarServicio } from '../../herramientas/web/servicio/construir-servicio.ts';
import {
  lineaDelValor,
  ServicioIlegible,
  servicioConValores,
  valoresDelServicio,
} from '../../herramientas/web/servicio/servicio-publicado.ts';
import { servicioPublicado } from '../ayudas/web-construida.ts';
import { servicio } from './ayudas.ts';

const SERVICE_WORKER = 'service-worker.js';
/** La huella del mapa con que se preparan y se comprueban estas candidatas: la misma en las dos. */
const HUELLA_DEL_MAPA = "'sha256-prueba'";
const PUBLICADOS = [SERVICE_WORKER, 'p.html'];
const DERIVADO = servicioPublicado();
const NEUTRO = await servicioConValores();
const NO_CONSTRUIDO = /no es el que se construye desde src\/service-worker\//;
const CIFRAS_SHA256 = 64;

/** Una web mínima propia, con su paquete de datos vacío, retirada incluso si una guarda falla. */
async function conWeb(
  entrada: string,
  usar: (web: string, contexto: { web: string; paquete: string; motor: Map<string, Uint8Array> }) => Promise<void>,
): Promise<void> {
  const web = mkdtempSync(join(tmpdir(), 'sw publicado Año 2026-'));
  try {
    writeFileSync(join(web, SERVICE_WORKER), entrada);
    writeFileSync(join(web, 'p.html'), '<p>Público</p>');
    const paquete = join(web, 'datos-origen');
    mkdirSync(paquete);
    writeFileSync(join(paquete, 'manifiesto.json'), '{}');
    await usar(web, { web, paquete, motor: new Map<string, Uint8Array>() });
  } finally {
    rmSync(web, { recursive: true, force: true });
  }
}

test('el service worker publicado no carga guiones, no evalúa código ni crea políticas de Trusted Types', () => {
  for (const texto of [DERIVADO, NEUTRO]) {
    assert.doesNotThrow(() => comprobarServicio(texto));
    assert.doesNotMatch(texto, /\bimportScripts\b|\bcreatePolicy\b|\beval\s*\(|\bnew\s+Function\b/);
    assert.deepEqual(comprobarCspScript(SERVICE_WORKER, texto), []);
  }
  assert.equal(DERIVADO.split('\n').length, NEUTRO.split('\n').length, 'los valores solo ocupan sus líneas');
});

for (const [variante, texto] of [
  ['neutro', NEUTRO],
  ['publicado', DERIVADO],
] as const) {
  test(`una carga de guiones añadida al service worker ${variante} no pasa ninguna guardia`, () => {
    const extra = `${texto}\nimportScripts('ajeno.js');`;
    assert.throws(() => comprobarServicio(extra), /importScripts|carga/);
    assert.match(comprobarCspScript(SERVICE_WORKER, extra).join('\n'), /carga guiones/);
    assert.throws(() => comprobarServicio(`${texto}\ntrustedTypes.createPolicy('ajena', {});`));
  });
}

test('cada valor generado está una sola vez en su línea: duplicados, ausencias y código no se leen', () => {
  assert.equal(valoresDelServicio(DERIVADO).FIRMAS.length, 0);
  const linea = DERIVADO.match(lineaDelValor('CATALOGO'))?.[0] ?? '';
  assert.ok(linea, 'el service worker declara CATALOGO en su línea');
  for (const candidato of [
    DERIVADO.replace(linea, `${linea}\n${linea}`),
    DERIVADO.replace(linea, ''),
    DERIVADO.replace(linea, 'var CATALOGO = [self.location.href];'),
    DERIVADO.replace(linea, 'var CATALOGO = "inicio.html";'),
  ]) {
    assert.throws(() => valoresDelServicio(candidato), ServicioIlegible);
  }
});

test('cada valor generado tiene la forma de la plantilla, elemento a elemento', () => {
  const huella = 'a'.repeat(CIFRAS_SHA256);
  const conLinea = (nombre: Parameters<typeof lineaDelValor>[0], literal: string) => {
    const linea = DERIVADO.match(lineaDelValor(nombre))?.[0] ?? '';
    assert.ok(linea, `el service worker declara ${nombre} en su línea`);
    return DERIVADO.replace(linea, `var ${nombre} = ${literal};`);
  };
  for (const [nombre, literal] of [
    ['CATALOGO', '[1]'],
    ['CATALOGO', '[["a.json", 7, "comprobado"]]'],
    ['CATALOGO', '[["a.json", "no-es-una-huella", "comprobado"]]'],
    ['CATALOGO', `[["a.json", "${huella}", "comprobado", "sobra"]]`],
    ['CATALOGO', '[["a.js"]]'],
    ['CATALOGO', `[["a.js", "${huella}"]]`],
    ['CATALOGO', '["a.html"]'],
    ['CATALOGO', `[["a.html", "${huella}", 2]]`],
    ['CATALOGO', `[["a.html", "${huella}", "otra"]]`],
    ['CATALOGO', `[["a.html", "${huella}", "instalar"], ["a.html", "${huella}", "seccion"]]`],
    ['FIRMAS', '["firma"]'],
    ['TAMANOS_DEL_PAQUETE', '"[]"'],
    ['TAMANOS_DEL_PAQUETE', '\'{"a.json":-1}\''],
    ['TAMANOS_DEL_PAQUETE', '\'{"a.json":"7"}\''],
    ['TAMANOS_DEL_PAQUETE', '"no es JSON"'],
    ['VERSION', '7'],
  ] as const) {
    assert.throws(
      () => valoresDelServicio(conLinea(nombre, literal)),
      (error: unknown) => error instanceof ServicioIlegible && error.message.includes(nombre),
      `${nombre} = ${literal}`,
    );
  }
  // Las formas buenas, también con listas vacías, se leen.
  const bueno = conLinea('CATALOGO', `[["a.json", "${huella}", "comprobado"], ["a.html", "${huella}", "seccion"]]`);
  assert.deepEqual(valoresDelServicio(bueno).CATALOGO, [
    ['a.json', huella, 'comprobado'],
    ['a.html', huella, 'seccion'],
  ]);
  assert.deepEqual(valoresDelServicio(conLinea('TAMANOS_DEL_PAQUETE', "'{}'")).TAMANOS_DEL_PAQUETE, '{}');
});

test('una mutación del código o de un valor del service worker publicado no pasa la comprobación', async () => {
  await conWeb('', async (web, contexto) => {
    await generarCatalogos(PUBLICADOS, HUELLA_DEL_MAPA, contexto);
    assert.deepEqual(await comprobarServiceWorker(PUBLICADOS, HUELLA_DEL_MAPA, contexto), []);
    const generado = readFileSync(join(web, SERVICE_WORKER), 'utf8');
    assert.equal(generado.includes('faro-estado:'), true);
    const version = valoresDelServicio(generado).VERSION;
    for (const [candidato, motivo] of [
      [generado.replace('faro-estado:', 'faro-ajeno:'), NO_CONSTRUIDO],
      [`${generado}\n`, NO_CONSTRUIDO],
      [generado.replace(`var VERSION = "${version}";`, `var VERSION = "${'0'.repeat(version.length)}";`), /VERSION/],
      [generado.replace('var FIRMAS = [];', `var FIRMAS = [["a.json", "${'0'.repeat(CIFRAS_SHA256)}"]];`), /FIRMAS/],
    ] as const) {
      assert.notEqual(candidato, generado);
      writeFileSync(join(web, SERVICE_WORKER), candidato);
      assert.match((await comprobarServiceWorker(PUBLICADOS, HUELLA_DEL_MAPA, contexto)).join('\n'), motivo);
    }
    rmSync(join(web, SERVICE_WORKER));
    assert.match((await comprobarServiceWorker(PUBLICADOS, HUELLA_DEL_MAPA, contexto)).join('\n'), /falta el service/);
  });
});

test('la política del service worker es la de su fuente única y una política alterada no pasa', async () => {
  const politica = textoPoliticaCache();
  for (const nombre of ['rutaFueraDeLaCopia', 'claveDeCopia', 'paginaDeLaRuta', 'consultarAutoridadSecciones']) {
    assert.ok(politica.includes(`function ${nombre}(`), `la fuente única declara ${nombre}`);
    assert.match(DERIVADO, new RegExp(`\\bfunction ${nombre}\\(`), `el service worker lleva ${nombre}`);
  }
  assert.throws(() => servicio('https://ejemplo.invalid/', { politica: `${politica}\n` }), /fuente única/);
  await conWeb('', async (web, contexto) => {
    await generarCatalogos(PUBLICADOS, HUELLA_DEL_MAPA, contexto);
    const generado = readFileSync(join(web, SERVICE_WORKER), 'utf8');
    const operativas = /var RUTAS_OPERATIVAS = \/\^\(\?:api\|/;
    assert.match(generado, operativas);
    writeFileSync(
      join(web, SERVICE_WORKER),
      generado.replace(operativas, (rutas) => rutas.replace('api|', 'apx|')),
    );
    assert.match((await comprobarServiceWorker(PUBLICADOS, HUELLA_DEL_MAPA, contexto)).join('\n'), NO_CONSTRUIDO);
  });
});

test('la generación no toma el service worker de la candidata como autoridad: lo reconstruye desde sus fuentes', async () => {
  const resultados: string[] = [];
  for (const candidata of [
    '',
    'const AJENO = 1;',
    DERIVADO.replace('var FIRMAS = [];', 'var FIRMAS = [["a", "b"]];'),
  ]) {
    await conWeb(candidata, async (web, contexto) => {
      await generarCatalogos(PUBLICADOS, HUELLA_DEL_MAPA, contexto);
      assert.deepEqual(await comprobarServiceWorker(PUBLICADOS, HUELLA_DEL_MAPA, contexto), []);
      resultados.push(readFileSync(join(web, SERVICE_WORKER), 'utf8'));
    });
  }
  assert.equal(new Set(resultados).size, 1, 'el mismo service worker, sea cual sea el de partida');
  assert.equal(valoresDelServicio(resultados[0] ?? '').FIRMAS.length, 0);
});

test('las páginas reactivables se cotejan con HTML final y no admiten omisiones ni huellas sustituidas', async () => {
  await conWeb('', async (web, contexto) => {
    const html = '<p>Biblioteca: información pública</p>';
    writeFileSync(join(web, 'biblioteca.html'), html);
    const publicados = [...PUBLICADOS, 'biblioteca.html'];
    await generarCatalogos(publicados, HUELLA_DEL_MAPA, contexto);
    assert.deepEqual(await comprobarServiceWorker(publicados, HUELLA_DEL_MAPA, contexto), []);
    const ruta = join(web, SERVICE_WORKER);
    const generado = readFileSync(ruta, 'utf8');
    const huella = createHash('sha256').update(html).digest('hex');
    const linea = generado.match(lineaDelValor('CATALOGO'))?.[0] ?? '';
    const entrada = `["biblioteca.html", "${huella}", "seccion"]`;
    assert.ok(linea.includes(entrada));
    for (const [candidato, motivo] of [
      [generado.replace(linea, linea.replace(huella, '0'.repeat(huella.length))), /PAGINAS_DE_SECCIONES/],
      [
        generado.replace(linea, linea.replace(entrada, `["biblioteca.html", "${huella}", "instalar"]`)),
        /PAGINAS_DE_SECCIONES/,
      ],
      [generado.replace(linea, linea.replace('[[', `[${entrada}, [`)), /CATALOGO/],
    ] as const) {
      assert.notEqual(candidato, generado);
      writeFileSync(ruta, candidato);
      assert.match((await comprobarServiceWorker(publicados, HUELLA_DEL_MAPA, contexto)).join('\n'), motivo);
    }
    writeFileSync(ruta, generado);
    writeFileSync(join(web, 'biblioteca.html'), '<p>Otra edición</p>');
    assert.match(
      (await comprobarServiceWorker(publicados, HUELLA_DEL_MAPA, contexto)).join('\n'),
      /huella.*PAGINAS_DE_SECCIONES/,
    );
  });
});
