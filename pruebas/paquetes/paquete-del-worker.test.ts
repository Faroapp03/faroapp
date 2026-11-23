import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { basename } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ERRATAS_ESCO } from '../../src/dominio/erratas-esco.ts';
import type { Datos } from '../../src/dominio/tipos-paquete.ts';
import { ARCHIVO_DE_CADA_PARTE, PARTES, prepararParte } from '../../src/plataforma/archivos-del-paquete.ts';

/** Los módulos JSON se simulan como bytes de Cloudflare; no se toca el paquete oficial. */
const carpetaDatos = new URL('../../datos/', import.meta.url);
const porArchivo = new Map<string, string>(
  Object.entries(ARCHIVO_DE_CADA_PARTE).map(([parte, archivo]) => [archivo, parte]),
);
const importados = new Map<string, string>();
const primeraErrata = ERRATAS_ESCO[0];
assert.ok(primeraErrata);
const errata = primeraErrata;
const fixtureEsco = {
  competencias: [['competencia:0', 'Atender personas', 'skill']],
  ocupaciones: {
    '0001': { uri: 'ocupacion:0', titulo: 'Ocupación sintética', isco08: '0001', competencias: [[0, 'e']] },
    [errata.esco]: { uri: errata.uri, titulo: 'Título anterior', isco08: '5329', competencias: [] },
  },
};

function fixture(parte: string): unknown {
  if (parte === 'esco') {
    return fixtureEsco;
  }
  if (parte === 'vectoresFormacion') {
    const vectores = { modelo: 'modelo sintético', dimensiones: 1, ids: ['x'], datos: 'AQ==', escalas: [1] };
    return { especialidades: vectores, ocupaciones: vectores };
  }
  if (parte === 'catalan') {
    // Con la forma del catalán real: al leerlo se le aplica la fe de erratas de los títulos (catalanConErratas).
    return {
      parte,
      texto: 'Texto corto compartido',
      otro: 'Texto corto compartido',
      ocupaciones: { [errata.esco]: 'Títol anterior' },
    };
  }
  if (parte === 'tich') {
    // Con el año de su edición: al cargarlo se exige la forma del dato (dominio/forma-del-dato-tich.ts).
    return { parte, texto: 'Texto corto compartido', otro: 'Texto corto compartido', anio: '2025' };
  }
  return { parte, texto: 'Texto corto compartido', otro: 'Texto corto compartido' };
}

// La resolución es controlada solo para estos imports de datos. La fuente y sus dependencias se cargan normalmente.
const hooks = registerHooks({
  resolve(entrada, contexto, continuar) {
    if (contexto.parentURL?.endsWith('/cloudflare/paquete.ts') && entrada.endsWith('.json')) {
      const archivo = basename(entrada);
      assert.ok(porArchivo.has(archivo));
      assert.equal(entrada, `../../../datos/${archivo}`);
      return { url: new URL(archivo, carpetaDatos).href, shortCircuit: true };
    }
    return continuar(entrada, contexto);
  },
  load(url, contexto, continuar) {
    if (!url.startsWith(carpetaDatos.href)) {
      return continuar(url, contexto);
    }
    const archivo = basename(fileURLToPath(url));
    const parte = porArchivo.get(archivo);
    assert.ok(parte);
    const contenido = JSON.stringify(fixture(parte));
    importados.set(archivo, contenido);
    const bytes = [...new TextEncoder().encode(contenido)];
    return {
      format: 'module',
      source: `export default new Uint8Array(${JSON.stringify(bytes)}).buffer;`,
      shortCircuit: true,
    };
  },
});
let datos: Datos;
try {
  ({ PAQUETE: datos } = await import('../../src/plataforma/cloudflare/paquete.ts'));
} finally {
  hooks.deregister();
}

test('el Worker importa solo las partes de la tabla y conserva su lectura única, orden e identidad', () => {
  assert.deepEqual(Object.keys(datos), PARTES);
  assert.deepEqual([...importados.keys()].sort(), Object.values(ARCHIVO_DE_CADA_PARTE).sort());
  for (const parte of PARTES) {
    assert.equal(typeof Object.getOwnPropertyDescriptor(datos, parte)?.get, 'function');
  }
  for (const parte of PARTES) {
    const lectura = datos[parte];
    const descriptor = Object.getOwnPropertyDescriptor(datos, parte);
    assert.ok(descriptor && 'value' in descriptor);
    assert.equal(descriptor.writable, false);
    assert.equal(descriptor.configurable, true);
    assert.equal(descriptor.enumerable, true);
    assert.equal(datos[parte], lectura, 'una segunda lectura usa el resultado y no los bytes ya transferidos');
    assert.deepEqual(
      lectura,
      prepararParte(parte, structuredClone(fixture(parte)), parte === 'catalan' ? datos.esco : undefined),
    );
  }
  assert.deepEqual([...(datos.esco.ocupaciones['0001']?.competencias ?? [])], [[0, 'e']]);
  assert.equal(datos.catalan?.ocupaciones[errata.esco], errata.tituloCa);
});
