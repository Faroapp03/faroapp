/**
 * En la entrada oficial, /encuesta/responder queda tras la puerta del portal, como la página que la usa: sin sesión del
 * portal, el envío no llega al punto de la encuesta ni a su almacén. Tras la puerta, la aplicación unificada sí lo
 * lleva al punto (encuesta.test.ts, «el Worker unificado lleva la ruta de la encuesta a su punto»).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { codigoNuevo } from '../../src/encuesta/codigos.ts';
import { PAGINA_ACCESO_WEB } from '../../src/plataforma/cloudflare/acceso-web-pagina.ts';
import oficial from '../../src/plataforma/cloudflare/worker-oficial.ts';
import { PARTICIPANTE_COMPLETO } from './montaje.ts';

const PROHIBIDO = 403;

function entorno() {
  const rutasDurables: string[] = [];
  const registro = {
    idFromName: () => 'id',
    get: () => ({
      fetch: async (peticion: Request) => {
        rutasDurables.push(new URL(peticion.url).pathname);
        return Response.json({ error: 'no_esperado' }, { status: 500 });
      },
    }),
  };
  return {
    rutasDurables,
    env: {
      FARO_CLAVE_GENERAL: 'clave-general-sintetica',
      FARO_SESION_PORTAL: 'firma-sintetica-independiente-de-mas-de-32-bytes',
      FARO_LIMITE_PORTAL: 'limite-sintetico-independiente-de-mas-de-32-bytes',
      REGISTRO_SOCIOS: registro,
      ASSETS: { fetch: async () => new Response('recurso protegido') },
    },
  };
}

test('sin sesión del portal, la entrada oficial no deja pasar ningún envío a la encuesta', async () => {
  const { env, rutasDurables } = entorno();
  const cuerpo = JSON.stringify({ codigo: codigoNuevo('participante'), respuestas: PARTICIPANTE_COMPLETO });
  for (const cabeceras of [
    { 'content-type': 'application/json' },
    { 'content-type': 'application/json', cookie: '__Host-faro-portal=1.falsa.firma' },
    { 'content-type': 'application/json', 'sec-fetch-mode': 'navigate' },
  ]) {
    const respuesta = await oficial.fetch(
      new Request('https://faro.example/encuesta/responder', { method: 'POST', headers: cabeceras, body: cuerpo }),
      env as never,
    );
    assert.equal(respuesta.status, PROHIBIDO, JSON.stringify(cabeceras));
    assert.doesNotMatch(await respuesta.text(), /codigo_no_valido|registrada/);
  }
  assert.ok(!rutasDurables.includes('/encuesta/responder'), rutasDurables.join(','));
});

/** Un elemento cualquiera de la pantalla de acceso: su guion solo escribe textos y atributos, y escucha eventos. */
class ElementoDeAcceso {
  dataset: Record<string, string> = { es: 'bandera-es', ca: 'bandera-ca' };
  textContent = '';
  hidden = false;
  disabled = false;
  required = false;
  type = '';
  value = '';
  src = '';
  readonly atributos = new Map<string, string>();
  readonly escuchas = new Map<string, (evento: unknown) => unknown>();
  setAttribute(nombre: string, valor: string) {
    this.atributos.set(nombre, valor);
  }
  hasAttribute(nombre: string) {
    return this.atributos.has(nombre);
  }
  removeAttribute(nombre: string) {
    this.atributos.delete(nombre);
  }
  addEventListener(tipo: string, escucha: (evento: unknown) => unknown) {
    this.escuchas.set(tipo, escucha);
  }
  focus() {}
  querySelector() {
    return new ElementoDeAcceso();
  }
}

/** Entra en la pantalla de acceso abierta con `invitacion` en el fragmento: adónde vuelve y qué envía. */
async function entrarEnElAcceso(invitacion: string) {
  const guion = [...PAGINA_ACCESO_WEB.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(([, texto]) => texto ?? '');
  assert.equal(guion.length, 1);
  const elementos = new Map<string, ElementoDeAcceso>();
  const destinos: string[] = [];
  const envios: string[] = [];
  runInNewContext(guion[0] ?? '', {
    URL,
    URLSearchParams,
    AbortController,
    document: {
      documentElement: new ElementoDeAcceso(),
      title: '',
      getElementById: (id: string) => {
        const elemento = elementos.get(id) ?? new ElementoDeAcceso();
        elementos.set(id, elemento);
        return elemento;
      },
      querySelector: () => new ElementoDeAcceso(),
    },
    location: {
      href: `https://faro.example/acceso-web?volver=%2Finicio.html${invitacion}`,
      search: '?volver=%2Finicio.html',
      hash: invitacion,
      assign: (direccion: string) => destinos.push(direccion),
    },
    history: { state: null, replaceState: () => {} },
    localStorage: { getItem: () => null, setItem: () => {} },
    navigator: { languages: ['es'] },
    setTimeout: () => 0,
    clearTimeout: () => {},
    fetch: async (ruta: string, inicio: RequestInit) => {
      envios.push(`${ruta} ${String(inicio.body)}`);
      return Response.json({ ok: true });
    },
    FormData: class {
      *[Symbol.iterator]() {}
    },
  });
  const formulario = elementos.get('formulario-acceso');
  const enviar = formulario?.escuchas.get('submit');
  assert.ok(formulario && enviar);
  formulario.dataset.volver = '/inicio.html';
  // El primer envío pasa del usuario a la clave; el segundo entra.
  await enviar({ preventDefault: () => {} });
  await enviar({ preventDefault: () => {} });
  return { destinos, envios };
}

test('la invitación del fragmento sobrevive a la contraseña del portal y no viaja en la entrada', async () => {
  const invitacion = `#invitacion=${codigoNuevo('participante')}`;
  // Sin sesión, la navegación va a la pantalla de acceso con la ruta en la consulta y sin fragmento: el navegador
  // conserva el suyo al seguir la redirección, porque la dirección nueva no trae otro.
  const { env } = entorno();
  const ida = await oficial.fetch(
    new Request('https://faro.example/inicio.html', { headers: { 'sec-fetch-mode': 'navigate' } }),
    env as never,
  );
  const destino = ida.headers.get('location') ?? '';
  assert.match(destino, /^\/acceso-web\?volver=%2Finicio\.html$/);
  // En la pantalla de acceso, al entrar, vuelve a la ruta pedida con el mismo fragmento.
  const { destinos, envios } = await entrarEnElAcceso(invitacion);
  assert.deepEqual(destinos, [`/inicio.html${invitacion}`]);
  assert.equal(envios.length, 1);
  assert.ok(!envios.some((envio) => envio.includes(invitacion.slice(1)) || envio.includes('PART-')));
});
