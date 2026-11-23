/**
 * El canal de avisos por correo con un enlace `send_email` falso que captura el objeto que recibe `send`: ningún
 * correo sale. Cubre el mensaje campo a campo, el destino que no está confirmado, la inyección de saltos de línea, el
 * enlace ausente o que falla con cada código, el registro compartido de lo avisado y la guardia de que la dirección
 * solo va dentro del mensaje.
 */
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import {
  type CuerpoAvisoVigilante,
  type EstadoAvisoVigilante,
  prepararAvisoVigilante,
} from '../../src/administracion/aviso-vigilante.ts';
import type { DestinoAvisos } from '../../src/administracion/avisos-destino.ts';
import type { ResultadoEnvioAviso } from '../../src/administracion/envio-aviso.ts';
import {
  type CanalCorreo,
  canalCorreoDelEntorno,
  enviarAvisoPorCorreo,
  motivoDelRechazo,
  remitenteAvisoDelEntorno,
} from '../../src/administracion/envio-aviso-correo.ts';
import {
  ASUNTO_ATENCION,
  ASUNTO_RESUELTO,
  CabeceraNoAdmitida,
  type MensajeCorreo,
  mensajeParaElEnlace,
  textoDelAviso,
} from '../../src/administracion/mensaje-aviso-correo.ts';
import { PlazoAgotado } from '../../src/api/errores.ts';
import { crearAvisoProgramado } from '../../src/plataforma/aviso-programado.ts';

const CORREO = 'persona@example.org';
const REMITENTE = 'avisos@faro.example.org';
const ORIGEN = 'https://faro.example.org';
const PANEL = `${ORIGEN}/administracion/`;
const AHORA = Date.parse('2026-11-22T04:15:00Z');
const UN_SEGUNDO_MS = 1000;
/** Lo que se enseña de una salida si la guardia falla: basta para saber cuál es. */
const MUESTRA = 200;
const VERIFICADO: DestinoAvisos = {
  version: 1,
  correo: CORREO,
  revision: 2,
  cambiadoEn: AHORA,
  verificacion: 'verificado',
};
const CUERPO: CuerpoAvisoVigilante = {
  version: 1,
  origen: 'faro-vigilante',
  tipo: 'nuevo',
  evaluadoEn: new Date(AHORA).toISOString(),
  desde: new Date(AHORA).toISOString(),
  panel: PANEL,
  decisiones: [
    { clave: 'programador', motivo: 'evento_esperado_sin_registro', desde: new Date(AHORA).toISOString() },
    { clave: 'vigilante', motivo: 'configuracion_no_valida', desde: new Date(AHORA).toISOString() },
  ],
};

/** El enlace falso: guarda cada objeto; `fallo` hace que `send` rechace con un error que cita la dirección. */
function enlaceFalso(fallo?: () => Error) {
  const enviados: MensajeCorreo[] = [];
  const canal: CanalCorreo = {
    remitente: REMITENTE,
    enlace: {
      send: async (mensaje) => {
        if (fallo) {
          throw fallo();
        }
        enviados.push(mensaje);
        return { messageId: 'falso' };
      },
    },
  };
  return { canal, enviados };
}
const conCodigo = (code: string) => Object.assign(new Error(`rechazado: ${CORREO}`), { code });

test('destino verificado: send recibe el objeto plano, campo a campo, con las frases del panel', async () => {
  const { canal, enviados } = enlaceFalso();
  assert.deepEqual(await enviarAvisoPorCorreo(canal, VERIFICADO, CUERPO), { resultado: 'enviado' });
  assert.equal(enviados.length, 1);
  const [mensaje] = enviados;
  assert.ok(mensaje);
  assert.deepEqual(Object.keys(mensaje).sort(), ['from', 'subject', 'text', 'to']);
  assert.equal(mensaje.to, CORREO);
  assert.equal(mensaje.from, REMITENTE);
  assert.equal(mensaje.subject, ASUNTO_ATENCION);
  const { text } = mensaje;
  assert.ok(text.includes('La actualización de Faro necesita atención.'));
  assert.ok(text.includes('22 de noviembre de 2026'));
  assert.ok(text.includes('- No consta el evento esperado.'));
  assert.ok(text.includes('- Hay una incidencia que requiere revisión.'));
  assert.ok(text.includes(PANEL));
  for (const interno of ['evento_esperado_sin_registro', 'configuracion_no_valida', 'programador', CORREO]) {
    assert.ok(!text.includes(interno), interno);
  }
});

test('resuelto: asunto propio y una frase sin incidencias', () => {
  const texto = textoDelAviso({ ...CUERPO, tipo: 'resuelto', decisiones: [] });
  assert.equal(texto.asunto, ASUNTO_RESUELTO);
  assert.ok(texto.lineas.some((l) => l.startsWith('La actualización de Faro vuelve a estar bien')));
});

test('sin destino o sin verificar: motivo propio y el enlace no se usa', async () => {
  const { canal, enviados } = enlaceFalso();
  const sin: DestinoAvisos = { version: 1, correo: null, revision: 0, cambiadoEn: null, verificacion: 'sin_destino' };
  const pendiente: DestinoAvisos = { ...VERIFICADO, verificacion: 'pendiente' };
  assert.deepEqual(await enviarAvisoPorCorreo(canal, sin, CUERPO), { resultado: 'no-enviado', motivo: 'sin-destino' });
  assert.deepEqual(await enviarAvisoPorCorreo(canal, pendiente, CUERPO), {
    resultado: 'no-enviado',
    motivo: 'destino-sin-verificar',
  });
  assert.equal(enviados.length, 0);
});

test('inyección: un salto de línea o un carácter de control en to, from o subject no llega al enlace', async () => {
  const { canal, enviados } = enlaceFalso();
  for (const correo of [
    `${CORREO}\r\nBcc: otra@example.org`,
    `${CORREO}\nBcc: otra@example.org`,
    'pérez@example.org',
  ]) {
    assert.deepEqual(await enviarAvisoPorCorreo(canal, { ...VERIFICADO, correo }, CUERPO), {
      resultado: 'no-enviado',
      motivo: 'destino-no-admitido',
    });
  }
  assert.equal(enviados.length, 0);
  const texto = textoDelAviso(CUERPO);
  const sobre = { remitente: REMITENTE, destino: CORREO };
  const salto = '\r\nBcc: otra@example.org';
  for (const [cambioTexto, cambioSobre] of [
    [{}, { remitente: `${REMITENTE}${salto}` }],
    [{}, { destino: `${CORREO}${salto}` }],
    [{ asunto: `${ASUNTO_ATENCION}${salto}` }, {}],
    [{ asunto: `${ASUNTO_ATENCION}\u0000` }, {}],
    [{ asunto: '' }, {}],
  ] as const) {
    assert.throws(
      () => mensajeParaElEnlace({ ...texto, ...cambioTexto }, { ...sobre, ...cambioSobre }),
      CabeceraNoAdmitida,
    );
  }
  // Los datos del cuerpo del aviso (panel, motivo, clave, fechas) solo viajan en `text`, nunca en otro campo.
  const cuerpo: CuerpoAvisoVigilante = {
    ...CUERPO,
    panel: `${PANEL}${salto}`,
    decisiones: [{ clave: `programador${salto}`, motivo: `x${salto}`, desde: `y${salto}` }],
  };
  assert.deepEqual(await enviarAvisoPorCorreo(canal, VERIFICADO, cuerpo), { resultado: 'enviado' });
  const [mensaje] = enviados;
  assert.ok(mensaje);
  assert.deepEqual([mensaje.to, mensaje.from, mensaje.subject], [CORREO, REMITENTE, ASUNTO_ATENCION]);
});

test('remitente y enlace del entorno: sin enlace o sin remitente del dominio no hay canal', () => {
  const { canal } = enlaceFalso();
  assert.equal(canalCorreoDelEntorno({ FARO_AVISO_REMITENTE: REMITENTE }, ORIGEN, undefined), undefined);
  assert.equal(canalCorreoDelEntorno({}, ORIGEN, canal.enlace), undefined);
  assert.equal(canalCorreoDelEntorno({ FARO_AVISO_REMITENTE: REMITENTE }, ORIGEN, canal.enlace)?.remitente, REMITENTE);
  for (const remitente of [
    'persona@example.org',
    `${REMITENTE}\r\nBcc: x@example.org`,
    'avisos@otrofaro.example.org',
  ]) {
    assert.deepEqual(remitenteAvisoDelEntorno({ FARO_AVISO_REMITENTE: remitente }, ORIGEN), {
      estado: 'remitente-no-admitido',
    });
  }
  assert.deepEqual(remitenteAvisoDelEntorno({}, ORIGEN), { estado: 'no-configurado' });
});

test('rechazos: cada código conocido da su motivo agrupado; cualquier otro, o sin código, el genérico', () => {
  const esperados: Record<string, string> = {
    E_SENDER_NOT_VERIFIED: 'remitente-no-configurado',
    E_SENDER_DOMAIN_NOT_AVAILABLE: 'remitente-no-configurado',
    E_SENDER_DOMAIN_NOT_CONFIGURED: 'remitente-no-configurado',
    E_EMAIL_SENDING_NOT_READY: 'remitente-no-configurado',
    E_ACCOUNT_SUSPENDED: 'remitente-no-configurado',
    E_RECIPIENT_NOT_ALLOWED: 'destinatario-no-permitido',
    E_RECIPIENT_PLAN_RESTRICTED: 'destinatario-no-permitido',
    E_RECIPIENT_SUPPRESSED: 'destinatario-no-permitido',
    E_RATE_LIMIT_EXCEEDED: 'limite-alcanzado',
    E_DAILY_LIMIT_EXCEEDED: 'limite-alcanzado',
    E_DELIVERY_FAILED: 'rechazo-del-destino',
    E_INTERNAL_SERVER_ERROR: 'error-temporal',
    E_VALIDATION_ERROR: 'envio-rechazado',
    E_CODIGO_NUEVO: 'envio-rechazado',
  };
  for (const [codigo, motivo] of Object.entries(esperados)) {
    assert.equal(motivoDelRechazo(conCodigo(codigo)), motivo, codigo);
  }
  // El código solo cuenta en `code`: en el mensaje no se busca, y un TypeError sin código es el genérico.
  assert.equal(motivoDelRechazo(new Error('E_RATE_LIMIT_EXCEEDED')), 'envio-rechazado');
  assert.equal(motivoDelRechazo(new TypeError('to is required')), 'envio-rechazado');
  assert.equal(motivoDelRechazo('E_RATE_LIMIT_EXCEEDED'), 'envio-rechazado');
  assert.equal(motivoDelRechazo(new PlazoAgotado()), 'plazo-agotado');
});

/** Una autoridad falsa con el registro de lo avisado de verdad: `prepararAvisoVigilante` decide qué toca enviar. */
function autoridadConRegistro(incidencias: () => { clave: string; motivo: string }[]) {
  let avisado: EstadoAvisoVigilante | null = null;
  let instante = AHORA;
  const registrados: ResultadoEnvioAviso[] = [];
  return {
    registrados,
    avanzar: (ms: number) => {
      instante += ms;
    },
    autoridad: {
      prepararAvisoVigilante: async (panel: string) =>
        prepararAvisoVigilante(avisado, incidencias(), { ahora: instante, panel }),
      registrarEnvioAviso: async ({
        envio,
        siguiente,
      }: {
        envio: ResultadoEnvioAviso;
        siguiente: EstadoAvisoVigilante;
      }) => {
        registrados.push(envio);
        if (envio.resultado === 'enviado') {
          avisado = siguiente;
        }
        return {};
      },
    },
  };
}
function capturarConsola(t: TestContext): string[] {
  const salidas: string[] = [];
  for (const nombre of ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const) {
    t.mock.method(console, nombre, (...args: unknown[]) => {
      salidas.push(
        args.map((a) => (a instanceof Error ? `${a.message} ${String(a.cause)}` : JSON.stringify(a))).join(' '),
      );
    });
  }
  return salidas;
}

test('registro compartido: no se repite lo avisado y la resolución se avisa una vez', async () => {
  let actuales = [{ clave: 'programador', motivo: 'evento_esperado_sin_registro' }];
  const { canal, enviados } = enlaceFalso();
  const r = autoridadConRegistro(() => actuales);
  const avisar = crearAvisoProgramado({
    autoridad: r.autoridad,
    destino: () => undefined,
    panel: PANEL,
    correo: { canal, destino: async () => VERIFICADO },
  });
  assert.equal(await avisar(), 'enviado');
  assert.equal(await avisar(), 'sin-aviso');
  actuales = [];
  r.avanzar(UN_SEGUNDO_MS);
  assert.equal(await avisar(), 'enviado');
  assert.equal(await avisar(), 'sin-aviso');
  assert.deepEqual(
    enviados.map((m) => m.subject),
    [ASUNTO_ATENCION, ASUNTO_RESUELTO],
  );
});

test('convivencia: con la URL también configurada, basta una entrega y el correo va primero', async () => {
  const actuales = [{ clave: 'programador', motivo: 'evento_esperado_sin_registro' }];
  const { canal, enviados } = enlaceFalso();
  const r = autoridadConRegistro(() => actuales);
  const pedidas: string[] = [];
  const avisar = crearAvisoProgramado({
    autoridad: r.autoridad,
    destino: () => new URL('https://avisos.example.org/entrada'),
    panel: PANEL,
    pedir: async (entrada) => {
      pedidas.push(entrada instanceof Request ? entrada.url : String(entrada));
      return new Response(null, { status: 500 });
    },
    correo: { canal, destino: async () => VERIFICADO },
  });
  assert.equal(await avisar(), 'enviado');
  assert.equal(enviados.length, 1);
  assert.equal(pedidas.length, 1);
  assert.deepEqual(r.registrados, [{ resultado: 'enviado' }]);
  assert.equal(await avisar(), 'sin-aviso');
});

test('enlace ausente o destino sin confirmar: sin canal, «no-configurados» y nada registrado', async () => {
  const r = autoridadConRegistro(() => [{ clave: 'programador', motivo: 'evento_esperado_sin_registro' }]);
  const { canal, enviados } = enlaceFalso();
  assert.equal(
    await crearAvisoProgramado({ autoridad: r.autoridad, destino: () => undefined, panel: PANEL })(),
    'no-configurados',
  );
  const pendiente = {
    canal,
    destino: async (): Promise<DestinoAvisos> => ({ ...VERIFICADO, verificacion: 'pendiente' }),
  };
  assert.equal(
    await crearAvisoProgramado({ autoridad: r.autoridad, destino: () => undefined, panel: PANEL, correo: pendiente })(),
    'no-configurados',
  );
  assert.equal(enviados.length, 0);
  assert.deepEqual(r.registrados, []);
});

test('guardia: un fallo del enlace queda anotado y la dirección solo está dentro del mensaje', async (t) => {
  const consola = capturarConsola(t);
  const actuales = [{ clave: 'programador', motivo: 'evento_esperado_sin_registro' }];
  const r = autoridadConRegistro(() => actuales);
  const resultados: unknown[] = [];
  for (const fallo of [() => conCodigo('E_RECIPIENT_NOT_ALLOWED'), () => new TypeError(`to: ${CORREO}`)]) {
    const falla = enlaceFalso(fallo);
    const correo = { canal: falla.canal, destino: async () => VERIFICADO };
    resultados.push(
      await crearAvisoProgramado({ autoridad: r.autoridad, destino: () => undefined, panel: PANEL, correo })(),
    );
  }
  assert.deepEqual(r.registrados, [
    { resultado: 'fallido', motivo: 'respuesta-no-admitida' },
    { resultado: 'fallido', motivo: 'respuesta-no-admitida' },
  ]);
  const bien = enlaceFalso();
  const segundo = crearAvisoProgramado({
    autoridad: r.autoridad,
    destino: () => undefined,
    panel: PANEL,
    correo: { canal: bien.canal, destino: async () => VERIFICADO },
  });
  resultados.push(
    await segundo(),
    await enviarAvisoPorCorreo(bien.canal, { ...VERIFICADO, correo: `${CORREO}\n` }, CUERPO),
  );
  const emitido = JSON.stringify({ resultados, registrados: r.registrados, consola });
  assert.ok(!emitido.includes('@example.org'), emitido.slice(0, MUESTRA));
  // Control positivo: el objeto que recibe el enlace sí lleva la dirección.
  assert.ok(bien.enviados.some((m) => m.to === CORREO));
});
