import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';

const VISTA = new URL('../../web/scripts/activar-acceso.js', import.meta.url);
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
})) {
  Object.defineProperty(globalThis, clave, { configurable: true, value: valor });
}
const ganchos = registerHooks({
  resolve(especificador, contexto, siguiente) {
    if (contexto.parentURL?.startsWith(VISTA.href)) {
      const fuentes: Record<string, string> = {
        './sitio.js': '',
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

const HTTP_GASTADA = 410;
const HTTP_OK = 200;
let llamadas = 0;
let usada = false;
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
  return new Response(JSON.stringify(usada ? { error: 'invitacion_no_disponible' } : dato), {
    status: usada ? HTTP_GASTADA : HTTP_OK,
    headers: { 'cache-control': 'no-store' },
  });
}

test('la vista real limpia el fragmento, descarta la clave al salir y atiende otro enlace sin recargar módulos', async (t) => {
  t.mock.method(globalThis, 'fetch', responderVista);
  try {
    await import(VISTA.href);
    await esperar(() => campo('activacion-estado').textContent === 'activacion.estado.preparada');
    assert.equal(ubicacion.hash, '');
    assert.equal(llamadas, 1);
    campo('activacion-generar').dispatchEvent(new Event('click'));
    await esperar(() => !campo('activacion-credenciales').hidden);
    assert.equal(campo('activacion-secreto').value, 'A'.repeat(LONGITUD_SECRETO));
    ventana.dispatchEvent(new Event('pagehide'));
    assert.equal(campo('activacion-secreto').value, '');
    assert.equal(campo('activacion-cliente').value, '');
    usada = true;
    ubicacion.hash = `#invitacion=${INVITACION}`;
    ventana.dispatchEvent(new Event('hashchange'));
    await esperar(() => campo('activacion-estado').textContent === 'activacion.estado.invitacion-no-disponible');
    assert.equal(ubicacion.hash, '');
    assert.equal(llamadas, 2 + 1);
    assert.equal(campo('activacion-generar').hidden, true);
    assert.equal(campo('activacion-credenciales').hidden, true);
    usada = false;
    ubicacion.hash = `#invitacion=${INVITACION}`;
    ventana.dispatchEvent(new Event('hashchange'));
    await esperar(() => campo('activacion-estado').textContent === 'activacion.estado.preparada');
    assert.equal(llamadas, 2 + 2);
    assert.equal(campo('activacion-secreto').value, '');
    ventana.dispatchEvent(new Event('pagehide'));
  } finally {
    ganchos.deregister();
  }
});
