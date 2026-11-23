/**
 * Plazos del aviso desde el evento programado: preparar, enviar y registrar tienen cada uno el suyo, para que un envío
 * aceptado quede registrado siempre que la autoridad responda. Relojes simulados; ningún transporte sale a la red.
 */
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import type { AvisoPreparado } from '../../src/administracion/aviso-vigilante.ts';
import { PLAZO_AVISO_MS } from '../../src/administracion/envio-aviso.ts';
import { PLAZO_PANEL_MS } from '../../src/administracion/http.ts';
import { crearAvisoProgramado, PLAZO_REGISTRO_AVISO_MS } from '../../src/plataforma/aviso-programado.ts';
import { atenderEventoProgramado } from '../../src/plataforma/cloudflare/programada-worker.ts';
import { CONFIG_VIGILANTE } from '../ayudas/vigilante.ts';

const PASO_MS = 100;
const MARGEN_MS = 2 * PASO_MS;
const PANEL = 'https://panel.example/administracion/';
const VARIABLES = { FARO_VIGILANTE: JSON.stringify(CONFIG_VIGILANTE) };
const PREPARADO = {
  cuerpo: { tipo: 'nuevo' },
  siguiente: { estado: 'abierto' },
} as unknown as AvisoPreparado;

/** Avanza el reloj simulado en pasos cortos, dejando correr las promesas entre paso y paso. */
async function avanzar(t: TestContext, ms: number) {
  for (let hecho = 0; hecho < ms; hecho += PASO_MS) {
    t.mock.timers.tick(PASO_MS);
    await new Promise<void>((resolver) => setImmediate(resolver));
  }
}
const tras = <T>(ms: number, valor: T) => new Promise<T>((resolver) => setTimeout(() => resolver(valor), ms));

function montaje(registrar: () => Promise<unknown>, registrados: unknown[]) {
  const avisar = crearAvisoProgramado({
    autoridad: {
      prepararAvisoVigilante: () => tras(PLAZO_PANEL_MS - MARGEN_MS, PREPARADO),
      registrarEnvioAviso: async (entrada) => {
        registrados.push(entrada.envio);
        return registrar();
      },
    },
    destino: () => new URL('https://avisos.example/faro'),
    panel: PANEL,
    pedir: async () => tras(PLAZO_AVISO_MS - MARGEN_MS, new Response(null, { status: 204 })),
  });
  return {
    obtenerPanel: async () => assert.fail('con la programación apagada no se prepara la actualización'),
    prepararAviso: async () => avisar,
  };
}
async function atenderConRelojes(t: TestContext, registrar: () => Promise<unknown>) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const registro = t.mock.method(console, 'error', () => {});
  const registrados: unknown[] = [];
  const evento = { scheduledTime: Date.now(), cron: '0 3 * * *' };
  const pendiente = atenderEventoProgramado(evento, VARIABLES, montaje(registrar, registrados));
  await avanzar(t, PLAZO_PANEL_MS + PLAZO_AVISO_MS + PLAZO_REGISTRO_AVISO_MS);
  await pendiente;
  return { registrados, errores: registro.mock.calls.map((c) => c.arguments) };
}

test('una preparación y un envío lentos, cada uno dentro de su plazo, dejan el envío aceptado registrado', async (t) => {
  const { registrados, errores } = await atenderConRelojes(t, async () => ({ estado: 'registrado' }));
  assert.deepEqual(registrados, [{ resultado: 'enviado' }]);
  assert.deepEqual(errores, []);
});

test('si lo que falla es el registro de un envío aceptado, el registro de Cloudflare lo dice así', async (t) => {
  const { registrados, errores } = await atenderConRelojes(t, () => new Promise<never>(() => {}));
  assert.deepEqual(registrados, [{ resultado: 'enviado' }]);
  assert.deepEqual(errores, [
    ['Faro: el envío del aviso del vigilante no se ha podido registrar.', { fase: 'aviso', envio: 'enviado' }],
  ]);
});
