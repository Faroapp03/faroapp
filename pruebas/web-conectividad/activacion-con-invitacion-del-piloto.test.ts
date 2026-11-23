/**
 * La activación de socios con el módulo real de la invitación del piloto (web/scripts/invitacion.js), en el orden real:
 * sitio.js lo carga, y su escucha de hashchange queda registrada antes que la de activar-acceso.js. Las dos usan la
 * marca #invitacion=; la de socio no es de participante y la invitación del piloto no la toca, ni al cargar ni al pegar
 * otro enlace en la pestaña abierta.
 */
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';

const VISTA = new URL('../../web/scripts/activar-acceso.js', import.meta.url);
const INVITACION_DEL_PILOTO = new URL('../../web/scripts/invitacion.js', import.meta.url);
const UUID = '11111111-1111-4111-8111-111111111111';
const LONGITUD_SECRETO = 43;
const INVITACION = `${UUID}.${'A'.repeat(LONGITUD_SECRETO)}`;
const MAX_TURNOS = 20;
class Elemento extends EventTarget {
  hidden = false;
  disabled = false;
  value = '';
  textContent = '';
  dateTime = '';
  removeAttribute() {}
  focus() {}
  select() {}
}
const campos = new Map<string, Elemento>();
function campo(id: string) {
  let valor = campos.get(id);
  if (!valor) {
    valor = new Elemento();
    campos.set(id, valor);
  }
  return valor;
}
const ubicacion = { hash: `#invitacion=${INVITACION}`, search: '', pathname: '/activar-acceso.html' };
const ventana = new EventTarget();
const historial = {
  replaceState: (_dato: unknown, _titulo: string, url: string) => {
    assert.equal(url, '/activar-acceso.html');
    ubicacion.hash = '';
    ubicacion.search = '';
  },
};
for (const [clave, valor] of Object.entries({
  window: ventana,
  location: ubicacion,
  history: historial,
  HTMLTimeElement: Elemento,
  HTMLButtonElement: Elemento,
  HTMLInputElement: Elemento,
  __campoActivacion: campo,
  navigator: { onLine: true },
  // Lo mínimo para evaluar invitacion.js de verdad: la raíz del documento que lee idioma.js al importarse.
  document: { documentElement: { lang: 'es', dataset: {} }, querySelector: () => null, querySelectorAll: () => [] },
  sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
})) {
  Object.defineProperty(globalThis, clave, { configurable: true, value: valor });
}
const ganchos = registerHooks({
  resolve(especificador, contexto, siguiente) {
    if (contexto.parentURL?.startsWith(VISTA.href)) {
      const fuentes: Record<string, string> = {
        // sitio.js importa la invitación del piloto: aquí, la real, como en la página.
        './sitio.js': `import ${JSON.stringify(INVITACION_DEL_PILOTO.href)};`,
        './dom.js': 'export const porId = (id) => globalThis.__campoActivacion(id);',
        './idioma.js': 'export const alCambiarIdioma = () => {};',
        './textos.js': "export const idiomaActual = () => 'es'; export const texto = (clave) => clave;",
      };
      if (Object.hasOwn(fuentes, especificador)) {
        return { url: `data:text/javascript,${encodeURIComponent(fuentes[especificador] ?? '')}`, shortCircuit: true };
      }
    }
    return siguiente(especificador, contexto);
  },
});
async function esperar(condicion: () => boolean) {
  for (let turno = 0; turno < MAX_TURNOS; turno++) {
    if (condicion()) {
      return;
    }
    await new Promise<void>((resolver) => setImmediate(resolver));
  }
  assert.ok(condicion(), 'el controlador alcanza su estado');
}

const HTTP_OK = 200;
let llamadas = 0;
const nombre = 'Institución de prueba';
async function responderVista(url: Parameters<typeof fetch>[0]) {
  assert.equal(ubicacion.hash, '', 'ninguna petición observa el fragmento');
  llamadas++;
  const activar = String(url).endsWith('/activar');
  const dato = activar
    ? {
        version: 1,
        client_id: `inst-${UUID}`,
        client_secret: 'A'.repeat(LONGITUD_SECRETO),
        token_endpoint: '/api/socios/v1/token',
        token_type: 'Bearer',
      }
    : { version: 1, institucion: { id: `inst-${UUID}`, nombre }, caducaEn: '2026-10-30T17:00:00.000Z' };
  return new Response(JSON.stringify(dato), {
    status: HTTP_OK,
    headers: { 'cache-control': 'no-store' },
  });
}

test('con la invitación del piloto cargada antes, la activación recibe su invitación al cargar y al pegar otro enlace', async (t) => {
  t.mock.method(globalThis, 'fetch', responderVista);
  try {
    // Primero la invitación del piloto, como en la página: su escucha de hashchange queda antes que la de la activación.
    const piloto = await import(INVITACION_DEL_PILOTO.href);
    piloto.iniciarInvitacion();
    await import(VISTA.href);
    await esperar(() => campo('activacion-estado').textContent === 'activacion.estado.preparada');
    assert.equal(llamadas, 1);
    // El enlace de socio pegado en la pestaña abierta llega a la activación aunque la otra escucha se ejecute antes.
    ubicacion.hash = `#invitacion=${INVITACION}`;
    ventana.dispatchEvent(new Event('hashchange'));
    await esperar(() => llamadas === 2);
    await esperar(() => campo('activacion-estado').textContent === 'activacion.estado.preparada');
    assert.equal(ubicacion.hash, '');
    ventana.dispatchEvent(new Event('pagehide'));
  } finally {
    ganchos.deregister();
  }
});
