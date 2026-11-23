import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';

test('una lista de nombres con forma defectuosa falla al cargar y señala el archivo del producto', async () => {
  const archivo = new URL('../../datos/nombres.json', import.meta.url).href;
  const enganche = registerHooks({
    load(url, contexto, continuar) {
      if (url !== archivo) {
        return continuar(url, contexto);
      }
      const lista = { nombres: 'Laura', apellidos: [], tambien_oficio: [], oficios: [], palabras_corrientes: [] };
      return { format: 'json', source: JSON.stringify(lista), shortCircuit: true };
    },
  });
  try {
    await assert.rejects(import('../../src/comun/nombres-propios.ts'), {
      name: 'ListaDeNombresMalFormada',
      message: 'datos/nombres.json no tiene la forma de la lista de nombres',
    });
  } finally {
    enganche.deregister();
  }
});
