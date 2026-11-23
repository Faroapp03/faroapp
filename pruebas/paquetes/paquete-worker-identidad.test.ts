import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { basename } from 'node:path';
import { test } from 'node:test';
import { ERRATAS_ESCO } from '../../src/dominio/erratas-esco.ts';
import type { Datos } from '../../src/dominio/tipos-paquete.ts';
import { ARCHIVO_DE_CADA_PARTE } from '../../src/plataforma/archivos-del-paquete.ts';

const primeraErrata = ERRATAS_ESCO[0];
assert.ok(primeraErrata);
const errata = primeraErrata;
const datos = new URL('../../datos/', import.meta.url);
const entradas = new Set(Object.values(ARCHIVO_DE_CADA_PARTE));
async function cargar(uri: string, caso: string): Promise<Datos> {
  const hooks = registerHooks({
    resolve(entrada, contexto, continuar) {
      if (
        contexto.parentURL &&
        new URL(contexto.parentURL).pathname.endsWith('/cloudflare/paquete.ts') &&
        entrada.endsWith('.json')
      ) {
        const archivo = basename(entrada);
        assert.ok(entradas.has(archivo as (typeof ARCHIVO_DE_CADA_PARTE)[keyof Datos]));
        return { url: new URL(`${archivo}?caso=${caso}`, datos).href, shortCircuit: true };
      }
      return continuar(entrada, contexto);
    },
    load(url, contexto, continuar) {
      if (!url.startsWith(datos.href)) {
        return continuar(url, contexto);
      }
      const archivo = basename(new URL(url).pathname);
      let valor: object = {};
      if (archivo === 'esco.json') {
        valor = {
          competencias: [],
          ocupaciones: { [errata.esco]: { uri, titulo: 'Original', isco08: '0000', competencias: [] } },
        };
      } else if (archivo === 'catalan.json') {
        valor = { ocupaciones: { [errata.esco]: 'Original' } };
      }
      const bytes = [...new TextEncoder().encode(JSON.stringify(valor))];
      return {
        format: 'module',
        source: `export default new Uint8Array(${JSON.stringify(bytes)}).buffer;`,
        shortCircuit: true,
      };
    },
  });
  try {
    const ruta = new URL(`../../src/plataforma/cloudflare/paquete.ts?caso=${caso}`, import.meta.url);
    const { PAQUETE } = (await import(ruta.href)) as { PAQUETE: Datos };
    return PAQUETE;
  } finally {
    hooks.deregister();
  }
}

test('pedir catalán primero carga una vez ESCO para comprobar su identidad, sin despertar otras partes', async () => {
  const paquete = await cargar(errata.uri, 'coincide');
  assert.equal(typeof Object.getOwnPropertyDescriptor(paquete, 'esco')?.get, 'function');
  assert.equal(typeof Object.getOwnPropertyDescriptor(paquete, 'oit')?.get, 'function');
  const catalan = paquete.catalan;
  assert.equal(catalan?.ocupaciones[errata.esco], errata.tituloCa);
  assert.ok('value' in (Object.getOwnPropertyDescriptor(paquete, 'esco') ?? {}));
  assert.equal(typeof Object.getOwnPropertyDescriptor(paquete, 'oit')?.get, 'function');
  assert.equal(paquete.catalan, catalan);
});

test('con URI distinta el Worker conserva el título catalán original', async () => {
  const paquete = await cargar('otra-uri', 'distinta');
  assert.equal(paquete.catalan?.ocupaciones[errata.esco], 'Original');
  assert.equal(paquete.esco.ocupaciones[errata.esco]?.uri, 'otra-uri');
});
