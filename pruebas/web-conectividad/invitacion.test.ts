import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ActivacionNoDisponible,
  crearActivacion,
  esInvitacion,
  leerClaveActivada,
  leerVistaInvitacion,
  recogerInvitacion,
} from '../../web/scripts/conectividad/invitacion.js';
import { CABECERA_CONTRATO, CONTRATO_API } from '../../web/scripts/protocolo-web.js';

const UUID = '11111111-1111-4111-8111-111111111111';
const LONGITUD_SECRETO = 43;
const CASOS_FRAGMENTO = 7;
const SECRETO = 'A'.repeat(LONGITUD_SECRETO);
const INVITACION = `${UUID}.${SECRETO}`;
const VISTA = {
  version: 1,
  institucion: { id: `inst-${UUID}`, nombre: 'Institución de prueba' },
  caducaEn: '2026-10-30T17:00:00.000Z',
};
const CLAVE = {
  version: 1,
  client_id: VISTA.institucion.id,
  client_secret: SECRETO,
  token_endpoint: '/api/socios/v1/token',
  token_type: 'Bearer',
};
const respuesta = (dato: unknown) => new Response(JSON.stringify(dato), { headers: { 'cache-control': 'no-store' } });
type Estado = Parameters<Parameters<typeof crearActivacion>[0]['alCambiar']>[0];

test('retira fragmento y query antes de entregar la invitación canónica, sin descodificar alias', () => {
  const historial: unknown[][] = [];
  const recoger = (hash: string, search = '') =>
    recogerInvitacion(
      { hash, search, pathname: '/activar-acceso.html' },
      { replaceState: (...args) => historial.push(args) },
    );
  assert.equal(recoger(`#invitacion=${INVITACION}`), INVITACION);
  assert.deepEqual(historial[0], [null, '', '/activar-acceso.html']);
  for (const hash of [
    '',
    `#${INVITACION}`,
    `#invitacion=${INVITACION}&extra=1`,
    `#invitacion=${UUID}.%41`,
    `#invitacion=${UUID}.${'A'.repeat(LONGITUD_SECRETO - 1)}B`,
  ]) {
    assert.equal(recoger(hash), null);
  }
  assert.equal(recoger(`#invitacion=${INVITACION}`, '?invitacion=otro'), null);
  assert.equal(historial.length, CASOS_FRAGMENTO);
  assert.equal(esInvitacion(`pub-${INVITACION}`), false);
  assert.equal(
    recogerInvitacion(
      { hash: `#invitacion=${INVITACION}`, search: '', pathname: '/activar-acceso.html' },
      {
        replaceState: () => {
          throw new DOMException('No permitido', 'SecurityError');
        },
      },
    ),
    null,
  );
});

test('valida el contrato cerrado y exige que la clave pertenezca a la institución consultada', () => {
  assert.deepEqual(leerVistaInvitacion(VISTA), VISTA);
  assert.deepEqual(leerClaveActivada(CLAVE, VISTA.institucion.id), CLAVE);
  for (const valor of [
    { ...VISTA, caducaEn: '2026-02-30T17:00:00.000Z' },
    { ...VISTA, institucion: { ...VISTA.institucion, nombre: '<script>\n' } },
    { ...VISTA, extra: true },
  ]) {
    assert.throws(() => leerVistaInvitacion(valor), ActivacionNoDisponible);
  }
  for (const valor of [
    { ...CLAVE, client_id: `inst-${UUID.replace(/^1/u, '2')}` },
    { ...CLAVE, client_secret: `${'A'.repeat(LONGITUD_SECRETO - 1)}B` },
    { ...CLAVE, token_endpoint: 'https://example.test/token' },
    { ...CLAVE, extra: true },
  ]) {
    assert.throws(() => leerClaveActivada(valor, VISTA.institucion.id), ActivacionNoDisponible);
  }
});

test('consulta no consumidora y activación única: POST propio, contrato, no-store, con credenciales del mismo origen y sin redirecciones', async () => {
  const llamadas: string[] = [];
  const estados: Estado[] = [];
  const flujo = crearActivacion({
    invitacion: INVITACION,
    alCambiar: (e) => estados.push(e),
    pedir: (async (url, opciones) => {
      const ruta = new URL(String(url));
      llamadas.push(ruta.pathname.slice(ruta.pathname.lastIndexOf('/api/')));
      assert.equal(ruta.search, '');
      assert.equal(ruta.hash, '');
      assert.equal(opciones?.method, 'POST');
      assert.equal(opciones.cache, 'no-store');
      assert.equal(opciones.credentials, 'same-origin');
      assert.equal(opciones.redirect, 'error');
      assert.deepEqual(JSON.parse(String(opciones.body)), { invitacion: INVITACION });
      assert.equal(new Headers(opciones.headers).get(CABECERA_CONTRATO), String(CONTRATO_API));
      return respuesta(ruta.pathname.endsWith('/consultar') ? VISTA : CLAVE);
    }) as typeof fetch,
  });
  await flujo.activar();
  assert.equal(llamadas.length, 0);
  await flujo.consultar();
  assert.equal(estados.at(-1)?.estado, 'preparada');
  await Promise.all([flujo.activar(), flujo.activar()]);
  await flujo.consultar();
  await flujo.activar();
  assert.deepEqual(llamadas, ['/api/socios/v1/invitacion/consultar', '/api/socios/v1/invitacion/activar']);
  assert.deepEqual(estados.at(-1), { estado: 'clave', clave: CLAVE });
  flujo.retirar();
  assert.deepEqual(estados.at(-1), { estado: 'retirada' });
});

test('una respuesta perdida no repite la generación ni permite volver a consultar el secreto', async () => {
  let llamadas = 0;
  const estados: Estado[] = [];
  const flujo = crearActivacion({
    invitacion: INVITACION,
    alCambiar: (e) => estados.push(e),
    pedir: (async () => {
      llamadas++;
      if (llamadas === 1) {
        return respuesta(VISTA);
      }
      throw new TypeError('Respuesta perdida');
    }) as typeof fetch,
  });
  await flujo.consultar();
  await flujo.activar();
  await flujo.activar();
  await flujo.consultar();
  assert.equal(llamadas, 2);
  assert.deepEqual(estados.at(-1), { estado: 'error', motivo: 'resultado-desconocido', reintentar: false });
});

test('offline en consulta permite comprobar de nuevo, y un enlace usado/caducado no se reintenta solo', async () => {
  let intento = 0;
  const estados: Estado[] = [];
  const flujo = crearActivacion({
    invitacion: INVITACION,
    alCambiar: (e) => estados.push(e),
    enLinea: () => false,
    pedir: (async () => {
      if (++intento === 1) {
        throw new TypeError('Sin conexión');
      }
      return new Response('{}', { status: 410 });
    }) as typeof fetch,
  });
  await flujo.consultar();
  assert.deepEqual(estados.at(-1), { estado: 'error', motivo: 'sin-conexion', reintentar: true });
  assert.equal(intento, 1);
  await flujo.consultar();
  assert.deepEqual(estados.at(-1), { estado: 'error', motivo: 'invitacion-no-disponible', reintentar: false });
});

test('retirar la página aborta y descarta una clave tardía incluso si el transporte ignora el aborto', async () => {
  let liberar = (_r: Response) => {};
  let senal: AbortSignal | undefined;
  let intento = 0;
  const pendiente = new Promise<Response>((resolver) => {
    liberar = resolver;
  });
  const estados: Estado[] = [];
  const flujo = crearActivacion({
    invitacion: INVITACION,
    alCambiar: (e) => estados.push(e),
    pedir: (async (_url, opciones) => {
      if (++intento === 1) {
        return respuesta(VISTA);
      }
      senal = opciones?.signal ?? undefined;
      return pendiente;
    }) as typeof fetch,
  });
  await flujo.consultar();
  const generacion = flujo.activar();
  flujo.retirar();
  assert.equal(senal?.aborted, true);
  liberar(respuesta(CLAVE));
  await generacion;
  assert.deepEqual(estados.at(-1), { estado: 'retirada' });
  assert.ok(!estados.some((e) => e.estado === 'clave'));
});

test('la respuesta cacheable no acredita invitación y los errores internos siguen rechazándose', async () => {
  const estados: Estado[] = [];
  const flujo = crearActivacion({
    invitacion: INVITACION,
    alCambiar: (e) => estados.push(e),
    pedir: (async () => new Response(JSON.stringify(VISTA))) as typeof fetch,
  });
  await flujo.consultar();
  assert.deepEqual(estados.at(-1), { estado: 'error', motivo: 'respuesta-invalida', reintentar: false });
  const interno = new Error('Defecto interno');
  const roto = crearActivacion({
    invitacion: INVITACION,
    alCambiar: () => {},
    pedir: (async () => {
      throw interno;
    }) as typeof fetch,
  });
  await assert.rejects(roto.consultar(), (e) => e === interno);
});
