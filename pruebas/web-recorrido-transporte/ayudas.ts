import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import type { TestContext } from 'node:test';
import { almacen, Nodo, navegador } from '../web-controles/ayudas.js';
import { fijarMotor } from './motor-local-doble.ts';

// Para probar sin compilar web/motor/, resuelve sus tres módulos de seguridad a las fuentes de src/seguridad/.
export const cargas: string[] = [];
registerHooks({
  resolve(spec, contexto, siguiente) {
    if (
      contexto.parentURL?.includes('/web/scripts/recorrido/api/transporte.js') &&
      spec === '../../motor-local/cliente.js'
    ) {
      return { url: new URL('./motor-local-doble.ts', import.meta.url).href, shortCircuit: true };
    }
    const catalogo = '/web/motor/src/catalogo-cursos/';
    if (spec.includes(catalogo)) {
      const nombre = spec.slice(spec.indexOf(catalogo) + catalogo.length);
      assert.ok(['calendarios.js', 'forma.js'].includes(nombre), nombre);
      return siguiente(
        new URL(`../../src/catalogo-cursos/${nombre.replace(/\.js$/, '.ts')}`, import.meta.url).href,
        contexto,
      );
    }
    const compilada = '/web/motor/src/seguridad/';
    if (spec.includes(compilada)) {
      const nombre = spec.slice(spec.indexOf(compilada) + compilada.length);
      assert.ok(['privacidad.js', 'avisos.js', 'limites.js'].includes(nombre), nombre);
      cargas.push(nombre);
      return siguiente(
        new URL(`../../src/seguridad/${nombre.replace(/\.js$/, '.ts')}`, import.meta.url).href,
        contexto,
      );
    }
    return siguiente(spec, contexto);
  },
});

export interface Peticion {
  ruta: string;
  opciones: RequestInit;
}
/** Worker simulado; la red está cerrada y no existe un proveedor ni un reto remoto. */
export async function preparar(
  contexto: TestContext,
  ajustes: { responder?: (peticion: Peticion) => Response | Promise<Response> } = {},
) {
  const peticiones: Peticion[] = [],
    locales: Peticion[] = [];
  const cabeza = new Nodo();
  navegador(contexto, {
    localStorage: almacen(),
    navigator: { onLine: false },
    document: { documentElement: { lang: 'es' } },
    fetch: async (destino: unknown) => {
      throw new Error(`Red no autorizada por la prueba: ${String(destino)}`);
    },
  });
  fijarMotor(async (ruta, opciones) => {
    const peticion = { ruta, opciones };
    locales.push(peticion);
    return (
      ajustes.responder?.(peticion) ??
      Response.json(ruta.startsWith('/api/grupos') ? { hijos: [] } : { html: '<p>Informe</p>' })
    );
  });
  const transporte = await import('../../web/scripts/recorrido/api/transporte.js');
  transporte.cancelarPeticiones();
  contexto.after(transporte.cancelarPeticiones);
  return { transporte, peticiones, locales, cabeza };
}
