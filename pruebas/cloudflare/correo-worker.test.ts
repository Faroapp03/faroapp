/**
 * El enlace `send_email` del entorno del Worker, con un enlace falso que captura el objeto que recibe `send`: con el
 * enlace presente y la dirección verificada el aviso sale; sin enlace no hay canal y no se intenta nada. Ningún correo
 * sale.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { prepararAvisoVigilante } from '../../src/administracion/aviso-vigilante.ts';
import type { DestinoAvisos } from '../../src/administracion/avisos-destino.ts';
import { canalCorreoDelEntorno, enlaceCorreoDelEntorno } from '../../src/administracion/envio-aviso-correo.ts';
import type { MensajeCorreo } from '../../src/administracion/mensaje-aviso-correo.ts';
import { crearAvisoProgramado } from '../../src/plataforma/aviso-programado.ts';

const ORIGEN = 'https://faro.example.org';
const VARIABLES = { FARO_AVISO_REMITENTE: 'avisos@faro.example.org' };
const DESTINO: DestinoAvisos = {
  version: 1,
  correo: 'persona@example.org',
  revision: 1,
  cambiadoEn: 1,
  verificacion: 'verificado',
};

/** El aviso diario montado como en el Worker, con lo que haya en `AVISOS_CORREO`. */
function avisoConEnlace(enlaceDelEntorno: unknown) {
  const canal = canalCorreoDelEntorno(VARIABLES, ORIGEN, enlaceCorreoDelEntorno(enlaceDelEntorno));
  return crearAvisoProgramado({
    autoridad: {
      prepararAvisoVigilante: async (panel) =>
        prepararAvisoVigilante(null, [{ clave: 'programador', motivo: 'evento_esperado_sin_registro' }], {
          ahora: Date.now(),
          panel,
        }),
      registrarEnvioAviso: async () => ({}),
    },
    destino: () => undefined,
    panel: `${ORIGEN}/administracion/`,
    ...(canal ? { correo: { canal, destino: async () => DESTINO } } : {}),
  });
}

test('Worker: con el enlace del entorno y la dirección verificada, send recibe el objeto plano', async () => {
  const enviados: MensajeCorreo[] = [];
  const enlace = {
    send: async (mensaje: MensajeCorreo) => {
      enviados.push(mensaje);
      return { messageId: 'falso' };
    },
  };
  assert.equal(await avisoConEnlace(enlace)(), 'enviado');
  assert.equal(enviados.length, 1);
  assert.deepEqual(Object.keys(enviados[0] ?? {}).sort(), ['from', 'subject', 'text', 'to']);
  assert.equal(enviados[0]?.to, DESTINO.correo);
  assert.equal(enviados[0]?.from, VARIABLES.FARO_AVISO_REMITENTE);
});

test('Worker: sin enlace en el entorno, o con algo que no es un enlace, no hay canal y no se intenta nada', async () => {
  for (const valor of [undefined, null, 'AVISOS_CORREO', {}, { send: 'no' }]) {
    assert.equal(enlaceCorreoDelEntorno(valor), undefined);
    assert.equal(await avisoConEnlace(valor)(), 'no-configurados');
  }
});
