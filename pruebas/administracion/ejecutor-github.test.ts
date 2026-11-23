import assert from 'node:assert/strict';
import test from 'node:test';
import { crearDespachadorGitHub, type SolicitudActualizacion } from '../../src/administracion/ejecutor-github.ts';
import { IDENTIDAD_WEB } from '../../src/comun/identidad-web.ts';

const DESTINO = { propietario: 'Entidad', repositorio: 'herramienta', workflow: 'actualizar.yml', ref: 'v1.0.0' };
const SOLICITUD = {
  solicitudId: '73ec9063-301a-4e09-9a51-8ca7438e7cec',
  accion: 'actualizar-datos',
  revisionReserva: 1,
} as const;
const TOKEN = 'credencial-sintetica-nunca-publica';
const BYTES_EXCESIVOS = 4097;
const BYTE_UTF8_INVALIDO = 0xff;
const recibo = (id = 123) => ({
  workflow_run_id: id,
  run_url: `https://api.github.com/repos/entidad/herramienta/actions/runs/${id}`,
  html_url: `https://github.com/entidad/herramienta/actions/runs/${id}`,
});
const senal = () => new AbortController().signal;

test('despacha una vez al workflow fijo, con identidad discreta e inputs cerrados', async () => {
  const llamadas: Request[] = [];
  const destino = { ...DESTINO };
  const despachar = crearDespachadorGitHub({
    destino,
    obtenerToken: async () => TOKEN,
    pedir: async (entrada) => {
      assert.ok(entrada instanceof Request);
      llamadas.push(entrada);
      return Response.json(recibo());
    },
  });
  destino.repositorio = 'otro';
  const resultado = await despachar(SOLICITUD, senal());
  assert.deepEqual(resultado, { estado: 'despachada', runId: '123' });
  assert.equal(llamadas.length, 1);
  const peticion = llamadas[0];
  assert.ok(peticion);
  assert.equal(
    peticion.url,
    'https://api.github.com/repos/Entidad/herramienta/actions/workflows/actualizar.yml/dispatches',
  );
  assert.equal(peticion.method, 'POST');
  assert.equal(peticion.redirect, 'manual');
  assert.equal(peticion.headers.get('user-agent'), IDENTIDAD_WEB['User-Agent']);
  assert.equal(peticion.headers.get('authorization'), `Bearer ${TOKEN}`);
  assert.equal(peticion.headers.get('x-github-api-version'), '2026-03-10');
  assert.deepEqual(await peticion.json(), {
    ref: 'v1.0.0',
    inputs: { solicitud_id: SOLICITUD.solicitudId, accion: SOLICITUD.accion, revision_reserva: '1' },
    return_run_details: true,
  });
  assert.equal(JSON.stringify(resultado).includes(TOKEN), false);
});

test('configuración y solicitud defectuosas no alcanzan la red', async () => {
  let llamadas = 0;
  const opciones = {
    obtenerToken: async () => TOKEN,
    pedir: async () => {
      llamadas++;
      return Response.json(recibo());
    },
  };
  for (const delta of [
    { propietario: '../entidad' },
    { repositorio: 'repo?token=x' },
    { workflow: '../actualizar.yml' },
    { ref: '-opcion' },
    { ref: 'rama..vieja' },
    { ref: 'rama//sub' },
    { ref: 'rama.lock' },
    { ref: 'rama/.oculta' },
    { ref: 'rama.' },
  ]) {
    assert.throws(() => crearDespachadorGitHub({ ...opciones, destino: { ...DESTINO, ...delta } }));
  }
  const despachar = crearDespachadorGitHub({ ...opciones, destino: DESTINO });
  for (const entrada of [
    { ...SOLICITUD, solicitudId: '../orden' },
    { ...SOLICITUD, accion: 'publicar' },
    { ...SOLICITUD, revisionReserva: 0 },
    { ...SOLICITUD, revisionReserva: -1 },
    { ...SOLICITUD, revisionReserva: Number.MAX_SAFE_INTEGER + 1 },
    { ...SOLICITUD, revisionReserva: Number.NaN },
  ]) {
    await assert.rejects(despachar(entrada as SolicitudActualizacion, senal()));
  }
  assert.equal(llamadas, 0);
});

test('204, rechazo, fallo remoto y recibo inválido nunca se convierten en ejecución terminada', async () => {
  const casos: [() => Response, string][] = [
    [() => new Response(null, { status: 204 }), 'incierta'],
    [() => new Response('secreto-remoto', { status: 401 }), 'rechazada'],
    [() => new Response(null, { status: 403 }), 'rechazada'],
    [() => new Response(null, { status: 404 }), 'rechazada'],
    [() => new Response(null, { status: 422 }), 'rechazada'],
    [() => new Response(null, { status: 500 }), 'incierta'],
    [() => new Response(null, { status: 429 }), 'incierta'],
    [() => Response.json({ ...recibo(), workflow_run_id: Number.MAX_SAFE_INTEGER + 1 }), 'incierta'],
    [() => Response.json({ ...recibo(), run_url: 'https://ajeno.example/123' }), 'incierta'],
    [() => Response.json({ ...recibo(), html_url: `${recibo().html_url}?token=x` }), 'incierta'],
    [() => Response.json({}), 'incierta'],
    [() => new Response('<html>error</html>'), 'incierta'],
  ];
  for (const [respuesta, estado] of casos) {
    let llamadas = 0;
    const ejecutar = crearDespachadorGitHub({
      destino: DESTINO,
      obtenerToken: async () => TOKEN,
      pedir: async () => {
        llamadas++;
        return respuesta();
      },
    });
    assert.deepEqual(await ejecutar(SOLICITUD, senal()), { estado });
    assert.equal(llamadas, 1);
  }
});

test('respuesta excesiva o UTF-8 inválido se descarta y cancela el cuerpo', async () => {
  let canceladas = 0;
  for (const bytes of [new TextEncoder().encode(' '.repeat(BYTES_EXCESIVOS)), Uint8Array.of(BYTE_UTF8_INVALIDO)]) {
    const cuerpo = new ReadableStream<Uint8Array>({
      start(control) {
        control.enqueue(bytes);
      },
      cancel() {
        canceladas++;
      },
    });
    const ejecutar = crearDespachadorGitHub({
      destino: DESTINO,
      obtenerToken: async () => TOKEN,
      pedir: async () => new Response(cuerpo, { headers: { 'content-type': 'application/json' } }),
    });
    assert.deepEqual(await ejecutar(SOLICITUD, senal()), { estado: 'incierta' });
  }
  assert.equal(canceladas, 2);
});

test('cancelación previa o credencial ausente no envía; cancelación tras enviar deja resultado incierto', async () => {
  let llamadas = 0;
  for (const token of ['', 'con espacio', 'x\nAuthorization:otro']) {
    const ejecutar = crearDespachadorGitHub({
      destino: DESTINO,
      obtenerToken: async () => token,
      pedir: async () => {
        llamadas++;
        return Response.json(recibo());
      },
    });
    assert.deepEqual(await ejecutar(SOLICITUD, senal()), { estado: 'rechazada' });
  }
  const anterior = new AbortController();
  anterior.abort();
  const previo = crearDespachadorGitHub({
    destino: DESTINO,
    obtenerToken: async () => TOKEN,
    pedir: async () => {
      llamadas++;
      return Response.json(recibo());
    },
  });
  assert.deepEqual(await previo(SOLICITUD, anterior.signal), { estado: 'rechazada' });
  assert.equal(llamadas, 0);

  const control = new AbortController();
  const posterior = crearDespachadorGitHub({
    destino: DESTINO,
    obtenerToken: async () => TOKEN,
    pedir: async () => {
      llamadas++;
      control.abort();
      throw new Error(TOKEN);
    },
  });
  assert.deepEqual(await posterior(SOLICITUD, control.signal), { estado: 'incierta' });
  assert.equal(llamadas, 1);
});

test('el plazo termina aunque un transporte defectuoso ignore la cancelación, sin repetir el POST', async () => {
  let llamadas = 0;
  // Se conserva la petición entera, no solo su señal: una petición que nadie guarda puede retirarse de la memoria
  // durante la espera, y entonces su señal ya no recibe la cancelación.
  let recibida: Request | undefined;
  const ejecutar = crearDespachadorGitHub({
    destino: DESTINO,
    obtenerToken: async () => TOKEN,
    pedir: async (peticion) => {
      assert.ok(peticion instanceof Request);
      llamadas++;
      recibida = peticion;
      return new Promise<Response>(() => {});
    },
  });
  assert.deepEqual(await ejecutar(SOLICITUD, senal()), { estado: 'incierta' });
  assert.equal(llamadas, 1);
  assert.equal(recibida?.signal.aborted, true);
});

test('una credencial que llega después de cancelar no provoca una llamada tardía', async () => {
  let resolver!: (token: string) => void;
  const token = new Promise<string>((resolve) => {
    resolver = resolve;
  });
  const control = new AbortController();
  let llamadas = 0;
  const ejecutar = crearDespachadorGitHub({
    destino: DESTINO,
    obtenerToken: () => {
      control.abort();
      return token;
    },
    pedir: async () => {
      llamadas++;
      return Response.json(recibo());
    },
  });
  assert.deepEqual(await ejecutar(SOLICITUD, control.signal), { estado: 'rechazada' });
  resolver(TOKEN);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(llamadas, 0);
});
