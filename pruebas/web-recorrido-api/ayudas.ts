import '../web-recorrido-transporte/ayudas.ts';
import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { CABECERA_CONTRATO, CONTRATO_API } from '../../web/scripts/protocolo-web.js';
import { fijarMotor } from '../web-recorrido-transporte/motor-local-doble.ts';

const { cancelarPeticiones } = await import('../../web/scripts/recorrido/api/transporte.js');

import { olvidarTraducciones } from '../../web/scripts/recorrido/datos-traducidos.js';
import { olvidarLlamadas } from '../../web/scripts/recorrido/memoria-llamadas.js';
import { fijarIdioma } from '../../web/scripts/textos.js';
import { almacen, navegador } from '../web-controles/ayudas.js';

export interface Peticion {
  ruta: string;
  opciones: RequestInit;
}
export type Responder = (peticion: Peticion) => Response | Promise<Response>;
export const OCUPACION = {
  isco08: '4226',
  esco: '4226.1.1',
  isco08Secundario: '4229',
  palabra: 'recepcionista',
  titulo: 'Recepcionistas',
  origen: 'ia' as const,
};
export const FECHA = '2026-10-14';
export const HTML = '<article lang="es"><h1>Informe ficticio</h1></article>';
export function respuesta(datos: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set(CABECERA_CONTRATO, String(CONTRATO_API));
  return Response.json(datos, { ...init, headers });
}
export function cuerpo(opciones: RequestInit): Record<string, unknown> {
  assert.ok(typeof opciones.body === 'string');
  return JSON.parse(opciones.body) as Record<string, unknown>;
}
export async function prepararApi(t: TestContext, responder: Responder) {
  const peticiones: Peticion[] = [];
  navegador(t, {
    localStorage: almacen(),
    navigator: { onLine: true },
    fetch: async () => {
      throw new Error('Las peticiones del recorrido no usan red');
    },
  });
  fijarMotor(async (ruta, opciones) => {
    assert.ok(ruta.startsWith('/api/'));
    const peticion = { ruta, opciones };
    peticiones.push(peticion);
    return responder(peticion);
  });
  cancelarPeticiones();
  olvidarLlamadas();
  olvidarTraducciones();
  fijarIdioma('es');
  t.after(() => {
    cancelarPeticiones();
    olvidarLlamadas();
    olvidarTraducciones();
    fijarIdioma('es');
  });
  return peticiones;
}
