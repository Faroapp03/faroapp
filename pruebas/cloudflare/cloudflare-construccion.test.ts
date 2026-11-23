import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  comprobarConstruccionCloudflare,
  comprobarPlantillaCloudflare,
  conConstruccionCloudflare,
} from '../../herramientas/cloudflare/comprobar-construccion.ts';
import { RUTAS } from '../../src/plataforma/node/rutas.ts';
import { contextoConstruido } from '../ayudas/web-construida.ts';

function plantilla() {
  return JSON.parse(readFileSync(new URL('../../config/cloudflare/wrangler.example.jsonc', import.meta.url), 'utf8'));
}
const HUELLA_BASE64 = 43;
test('la plantilla exige fetch público sin habilitar el acceso directo al origen privado', () => {
  for (const flags of [undefined, [], ['global_fetch_private_origin']]) {
    const valor = plantilla();
    if (flags === undefined) {
      delete valor.compatibility_flags;
    } else {
      valor.compatibility_flags = flags;
    }
    assert.throws(() => comprobarPlantillaCloudflare(valor));
  }
});
test('plantilla impide servir panel antes del Worker o reescribir sus recursos privados', () => {
  comprobarPlantillaCloudflare(plantilla());
  for (const cambio of [
    { run_worker_first: false },
    { html_handling: 'auto-trailing-slash' },
    { not_found_handling: 'single-page-application' },
    { directory: '../..' },
  ]) {
    const valor = plantilla();
    Object.assign(valor.assets, cambio);
    assert.throws(() => comprobarPlantillaCloudflare(valor));
  }
});
test('Data y SQLite son requisitos de construcción, sin cuentas o secretos de una instalación', () => {
  for (const modificar of [
    (v: ReturnType<typeof plantilla>) => {
      v.rules = [];
    },
    (v: ReturnType<typeof plantilla>) => {
      v.account_id = 'no-transferir';
    },
    (v: ReturnType<typeof plantilla>) => {
      v.migrations[0].new_sqlite_classes.pop();
    },
    (v: ReturnType<typeof plantilla>) => {
      v.durable_objects.bindings[0].class_name = 'ContadorGasto';
    },
  ]) {
    const valor = plantilla();
    modificar(valor);
    assert.throws(() => comprobarPlantillaCloudflare(valor));
  }
});
test('orden de claves y bindings no cambia la validez semántica de la plantilla', () => {
  const valor = plantilla();
  valor.rules[0] = { fallthrough: true, globs: valor.rules[0].globs, type: 'Data' };
  valor.durable_objects.bindings.reverse();
  valor.migrations[0].new_sqlite_classes.reverse();
  comprobarPlantillaCloudflare(valor);
});
test('la identidad de la construcción exige el binding oficial con su nombre exacto', () => {
  for (const metadatos of [undefined, null, {}, { binding: 'OTRO' }, { binding: 'CF_VERSION_METADATA', extra: true }]) {
    const valor = plantilla();
    if (metadatos === undefined) {
      delete valor.version_metadata;
    } else {
      valor.version_metadata = metadatos;
    }
    assert.throws(() => comprobarPlantillaCloudflare(valor));
  }
});
test('bundle real conserva JSON externos, exporta Worker y clases, y mide sin acreditar Workers', async () => {
  const resultado = await comprobarConstruccionCloudflare(contextoConstruido());
  assert.ok(resultado.datos.some((d) => d.ruta === 'datos/nombres.json'));
  // Derechos se entrega en el paquete público y no forma parte del Worker.
  assert.equal(
    resultado.datos.some((d) => d.ruta === 'datos/derechos.json'),
    false,
  );
  assert.ok(resultado.datos.some((d) => d.ruta === 'datos/esco.json'));
  assert.ok(resultado.codigoBytes < resultado.datos.reduce((total, d) => total + d.bytes, 0));
  assert.ok(resultado.assets.archivos > 0);
  assert.equal(resultado.workersEnsayado, false);
});
test('callback recibe bytes reales y la misma selección ordenada que las métricas, con limpieza al terminar', async () => {
  let temporal = '';
  const contexto = contextoConstruido();
  const entregado = await conConstruccionCloudflare(async (directorio, resultado, rutasAssets) => {
    temporal = directorio;
    assert.equal(readFileSync(join(directorio, 'worker.mjs')).byteLength, resultado.codigoBytes);
    for (const dato of resultado.datos) {
      const contenido = readFileSync(join(directorio, dato.ruta));
      assert.equal(contenido.byteLength, dato.bytes);
      assert.equal(createHash('sha256').update(contenido).digest('hex'), dato.sha256);
    }
    assert.ok(Object.isFrozen(rutasAssets));
    assert.deepEqual(rutasAssets, [...rutasAssets].sort());
    assert.equal(rutasAssets.length, resultado.assets.archivos);
    const tamanos = rutasAssets.map((ruta) => readFileSync(join(contexto.web, ruta)).byteLength);
    assert.equal(
      tamanos.reduce((total, bytes) => total + bytes, 0),
      resultado.assets.bytes,
    );
    assert.equal(Math.max(...tamanos), resultado.assets.mayorBytes);
    assert.ok(rutasAssets.includes('firmas/manifiesto.json'));
    const derechos = rutasAssets.filter((ruta) => /^paquete\/[^/]+\/derechos\.json$/u.test(ruta));
    assert.equal(derechos.length, 1);
    assert.equal(
      readFileSync(join(contexto.web, derechos[0] ?? '')).compare(readFileSync(join(RUTAS.paquete, 'derechos.json'))),
      0,
    );
    return 'entregado';
  }, contexto);
  assert.equal(entregado, 'entregado');
  assert.ok(temporal);
  assert.equal(existsSync(temporal), false);
});
test('un callback que falla conserva su error y retira el temporal construido', async () => {
  let temporal = '';
  const error = new Error('Fallo del consumidor');
  await assert.rejects(
    conConstruccionCloudflare(async (directorio) => {
      temporal = directorio;
      assert.ok(existsSync(join(directorio, 'worker.mjs')));
      throw error;
    }, contextoConstruido()),
    (recibido) => recibido === error,
  );
  assert.ok(temporal);
  assert.equal(existsSync(temporal), false);
});
test('una raíz web enlazada se rechaza antes de recorrer sus archivos o construir', async () => {
  const carpeta = mkdtempSync(join(tmpdir(), 'cloudflare-raiz-'));
  const raiz = Object.getOwnPropertyDescriptor(RUTAS, 'raiz');
  const web = Object.getOwnPropertyDescriptor(RUTAS, 'web');
  assert.ok(raiz && web);
  try {
    mkdirSync(join(carpeta, 'config/cloudflare'), { recursive: true });
    mkdirSync(join(carpeta, 'web-ajena'));
    symlinkSync(join(carpeta, 'web-ajena'), join(carpeta, 'web'));
    writeFileSync(join(carpeta, 'config/cloudflare/wrangler.example.jsonc'), JSON.stringify(plantilla()));
    Object.defineProperty(RUTAS, 'raiz', { ...raiz, value: `${carpeta}/` });
    Object.defineProperty(RUTAS, 'web', { ...web, value: `${join(carpeta, 'web')}/` });
    const enlazada = {
      web: join(carpeta, 'web'),
      paquete: RUTAS.paquete,
      motor: new Map<string, Uint8Array>(),
      huellaMapaModulos: `'sha256-${'A'.repeat(HUELLA_BASE64)}='`,
    };
    await assert.rejects(
      conConstruccionCloudflare(async () => assert.fail('No debe entregar un bundle de una raíz enlazada'), enlazada),
      /La raíz web debe ser un directorio regular/,
    );
  } finally {
    Object.defineProperty(RUTAS, 'raiz', raiz);
    Object.defineProperty(RUTAS, 'web', web);
    rmSync(carpeta, { recursive: true });
  }
});

test('las plantillas de entrada oficial y privada no se intercambian', () => {
  const privada = plantilla();
  const oficial = JSON.parse(
    readFileSync(new URL('../../config/cloudflare/wrangler.unificado.example.jsonc', import.meta.url), 'utf8'),
  );
  comprobarPlantillaCloudflare(privada, 'privado');
  comprobarPlantillaCloudflare(oficial, 'oficial');
  assert.throws(() => comprobarPlantillaCloudflare(privada, 'oficial'));
  assert.throws(() => comprobarPlantillaCloudflare(oficial, 'privado'));
});
