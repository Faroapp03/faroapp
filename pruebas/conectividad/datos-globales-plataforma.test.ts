// Los lectores se comprueban con la captura canónica y transportes simulados, sin API ni web publicada.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mock, test } from 'node:test';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { IDENTIDAD_WEB } from '../../src/comun/identidad-web.ts';
import { type DatosGlobales, leerDatosGlobales } from '../../src/datos-globales/datos.ts';
import {
  cargarDatosGlobales,
  datosGlobalesDelTexto,
  RUTA_DATOS_GLOBALES,
} from '../../src/plataforma/datos-globales.ts';
import { cargarDatosGlobalesDeLaWeb } from '../../src/plataforma/node/datos-globales.ts';

const TEXTO = readFileSync(new URL('../../datos/globales/datos-globales.json', import.meta.url), 'utf8');
const GLOBALES = leerDatosGlobales(JSON.parse(TEXTO));
const RAIZ = new URL('https://asset.test/');
const PLAZO_ESPERADO_MS = 60_000;

/** Patrón de temporales del producto: cada caso crea y retira solo su árbol, sin depender del cwd. */
function conCarpeta(comprobar: (carpeta: string) => void): void {
  const carpeta = mkdtempSync(join(tmpdir(), 'Año 2026 # % globales-'));
  try {
    comprobar(carpeta);
  } finally {
    rmSync(carpeta, { recursive: true });
  }
}

test('el lector de texto conserva exactamente la fuente canónica y sus metadatos', () => {
  assert.deepEqual(datosGlobalesDelTexto(TEXTO), GLOBALES);
});

for (const [nombre, texto] of [
  ['JSON inválido', '{'],
  ['contrato inválido', '{}'],
] as const) {
  test(`${nombre} deja la instantánea indisponible sin inventar datos`, () => {
    assert.equal(datosGlobalesDelTexto(texto), null);
  });
}

test('Node lee la web resuelta: válido, ausente, inválido y error inesperado de archivo', () => {
  conCarpeta((web) => {
    assert.equal(cargarDatosGlobalesDeLaWeb(web), null);
    mkdirSync(join(web, 'datos'));
    const asset = join(web, RUTA_DATOS_GLOBALES);
    writeFileSync(asset, TEXTO);
    assert.deepEqual(cargarDatosGlobalesDeLaWeb(web), GLOBALES);
    writeFileSync(asset, '{');
    assert.equal(cargarDatosGlobalesDeLaWeb(web), null);
    assert.throws(() => cargarDatosGlobalesDeLaWeb(asset), { code: 'ENOTDIR' });
  });
});

test('el transporte local lee una vez la ruta fija con el perfil central y sin cabeceras del cliente', async () => {
  const pedidos: Request[] = [];
  const leidos = await cargarDatosGlobales(async (peticion) => {
    pedidos.push(peticion);
    return new Response(TEXTO);
  }, RAIZ);
  assert.deepEqual(leidos, GLOBALES);
  assert.equal(pedidos.length, 1);
  assert.equal(pedidos[0]?.url, new URL(RUTA_DATOS_GLOBALES, RAIZ).href);
  assert.deepEqual([...(pedidos[0]?.headers ?? [])], [...new Headers(IDENTIDAD_WEB)]);
});

test('asset ausente, inválido o abortado deja null; un fallo inesperado del transporte se propaga', async () => {
  assert.equal(
    await cargarDatosGlobales(async () => new Response(null, { status: ESTADO_HTTP.noEncontrado }), RAIZ),
    null,
  );
  assert.equal(await cargarDatosGlobales(async () => new Response('{'), RAIZ), null);
  assert.equal(
    await cargarDatosGlobales(async () => {
      throw new DOMException('ficticio', 'AbortError');
    }, RAIZ),
    null,
  );
  const inesperado = new Error('fallo ficticio inesperado del binding');
  await assert.rejects(
    cargarDatosGlobales(async () => {
      throw inesperado;
    }, RAIZ),
    (error) => error === inesperado,
  );
});

for (const cuerpoPendiente of [false, true]) {
  test(`plazo efectivo aunque ${cuerpoPendiente ? 'el cuerpo no termine' : 'el binding ignore la señal'}`, async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    let observado: DatosGlobales | null | undefined;
    let signal: AbortSignal | undefined;
    try {
      void cargarDatosGlobales((peticion) => {
        signal = peticion.signal;
        return cuerpoPendiente ? Promise.resolve(new Response(new ReadableStream())) : new Promise<Response>(() => {});
      }, RAIZ).then((valor) => {
        observado = valor;
      });
      await new Promise<void>((resolver) => setImmediate(resolver));
      mock.timers.tick(PLAZO_ESPERADO_MS);
      await new Promise<void>((resolver) => setImmediate(resolver));
      assert.equal(observado, null);
      assert.equal(signal?.aborted, true);
    } finally {
      mock.timers.reset();
    }
  });
}

test('el retorno normal limpia el temporizador y no aborta después una solicitud terminada', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  let signal: AbortSignal | undefined;
  try {
    const leidos = await cargarDatosGlobales(async (peticion) => {
      signal = peticion.signal;
      return new Response(TEXTO);
    }, RAIZ);
    assert.deepEqual(leidos, GLOBALES);
    mock.timers.tick(PLAZO_ESPERADO_MS);
    assert.equal(signal?.aborted, false);
  } finally {
    mock.timers.reset();
  }
});
