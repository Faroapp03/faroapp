/**
 * La invitación del piloto en la web (web/scripts/invitacion.js): llega en el fragmento, sale de la dirección, se guarda
 * solo en la pestaña, abre la encuesta al final del recorrido y desde el pie, y se olvida al responder o al borrarlo
 * todo. Las guardias de que el código no viaja al servidor están en pruebas/encuesta/invitacion.test.ts.
 */

import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { Nodo, pagina, prepararDom } from './dom.ts';

const CODIGO = 'PART-0123-4567-89AB-CDEF-GHJK-MNPQ-RSTV';
const PROFESIONAL = 'PROF-0123-4567-89AB-CDEF-GHJK-MNPQ-RSTV';

/**
 * Dos pestañas del mismo sitio: cada una con su almacenamiento, y la que está en uso es `actual`. La primera es la del
 * recorrido; la segunda, la de la encuesta, que se abre aparte.
 */
const pestanas = [new Map<string, string>(), new Map<string, string>()];
let actual = 0;
const pestana = pestanas[0] as Map<string, string>;
const almacen = () => pestanas[actual] as Map<string, string>;
const sesion = {
  getItem: (clave: string) => almacen().get(clave) ?? null,
  setItem: (clave: string, valor: string) => almacen().set(clave, String(valor)),
  removeItem: (clave: string) => almacen().delete(clave),
};
/**
 * Un BroadcastChannel entre las pestañas simuladas: cada canal es de la pestaña que lo abrió, y un mensaje llega a los
 * canales del mismo nombre de las demás pestañas, que lo atienden con su propio almacenamiento.
 */
class CanalEntrePestanas {
  static readonly abiertos = new Set<CanalEntrePestanas>();
  readonly pestana = actual;
  readonly escuchas: ((evento: { data: unknown }) => void)[] = [];
  readonly name: string;
  constructor(name: string) {
    this.name = name;
    CanalEntrePestanas.abiertos.add(this);
  }
  addEventListener(_tipo: string, escucha: (evento: { data: unknown }) => void) {
    this.escuchas.push(escucha);
  }
  postMessage(data: unknown) {
    const desde = actual;
    for (const canal of CanalEntrePestanas.abiertos) {
      if (canal.name === this.name && canal.pestana !== this.pestana) {
        actual = canal.pestana;
        for (const escucha of canal.escuchas) {
          escucha({ data });
        }
      }
    }
    actual = desde;
  }
  close() {
    CanalEntrePestanas.abiertos.delete(this);
  }
}
/** Lo que escucha la página: el cambio de fragmento cuando se pega un enlace en una pestaña ya abierta. */
const alCambiarElFragmento: (() => void)[] = [];
const reemplazos: string[] = [];
const direccion = { hash: '', pathname: '/inicio.html', search: '' };
Object.assign(globalThis, {
  BroadcastChannel: CanalEntrePestanas,
  window: {
    addEventListener: (tipo: string, escucha: () => void) =>
      tipo === 'hashchange' && alCambiarElFragmento.push(escucha),
  },
  location: direccion,
  history: { state: null, replaceState: (_estado: unknown, _titulo: string, nueva: string) => reemplazos.push(nueva) },
  sessionStorage: sesion,
});
// La espera del pensamiento de la vista final escucha en el documento; aquí no hay ningún pensamiento en curso.
Object.assign(pagina, { addEventListener: () => {}, removeEventListener: () => {} });

const invitacion = await import('../../web/scripts/invitacion.js');
const { avisarBorrado } = await import('../../web/scripts/aviso-de-borrado.js');
const { limpiarEntregaFinal, prepararEntregaFinal } = await import('../../web/scripts/recorrido/entrega-final.js');
const { politicaSeccionesInicial, VERSION_SECCIONES_PUBLICAS } = await import(
  '../../src/administracion/secciones-web.js'
);
const { actualizarSecciones } = await import('../../web/scripts/secciones.js');
/** La disponibilidad que publica la autoridad, sin copia guardada: `visible` es el interruptor de la Encuesta. */
async function publicarEncuesta(visible: boolean, revision: number) {
  const secciones = { ...politicaSeccionesInicial(), encuesta: visible };
  // La página de prueba solo necesita que el aviso «faro-secciones» y la ruta existan; no los comprueba aquí.
  Object.assign(document, { dispatchEvent: () => true });
  Object.assign(direccion, { href: `https://faro.invalid${direccion.pathname}` });
  Object.assign(globalThis, {
    caches: { open: async () => ({ match: async () => undefined, put: async () => undefined }) },
    fetch: async () =>
      Response.json({
        version: VERSION_SECCIONES_PUBLICAS,
        autoridad: '33333333-3333-4333-8333-333333333333',
        revision,
        secciones,
      }),
  });
  await actualizarSecciones();
}

/** Abre la página con `hash` y devuelve lo que recoge el módulo. @param {string} hash */
function llegarCon(hash: string, search = '') {
  Object.assign(direccion, { hash, search });
  reemplazos.length = 0;
  return invitacion.recogerInvitacion();
}

beforeEach(() => {
  actual = 0;
  for (const cada of pestanas) {
    cada.clear();
  }
  prepararDom();
  limpiarEntregaFinal();
});

test('la invitación sale de la dirección y se guarda solo en la pestaña', () => {
  assert.equal(llegarCon(`#invitacion=${CODIGO}`, '?idioma=ca'), CODIGO);
  assert.deepEqual(reemplazos, ['/inicio.html?idioma=ca']);
  assert.deepEqual([...pestana], [[invitacion.CLAVE_INVITACION, CODIGO]]);
  assert.equal(invitacion.invitacionGuardada(), CODIGO);
  // «Borrar todo» retira de la pestaña las claves que empiezan por «faro-» (pruebas/encuesta/invitacion.test.ts).
  assert.ok(invitacion.CLAVE_INVITACION.startsWith('faro-'));
});

test('una invitación de participante incompleta se ignora sin decir nada, y sale de la dirección', () => {
  for (const hash of [
    '#invitacion=PART-1234',
    `#invitacion=${CODIGO}x`,
    `#invitacion=${encodeURIComponent(CODIGO)}-X`,
  ]) {
    assert.equal(llegarCon(hash), null, hash);
    assert.deepEqual(reemplazos, ['/inicio.html'], hash);
    assert.equal(pestana.size, 0, hash);
  }
});

/** Los caracteres del secreto de una invitación de socio (43 en base64url, 256 bits). */
const LONGITUD_SECRETO_SOCIO = 43;
/** Una invitación de socio de activar-acceso.html: un identificador y un secreto, con la misma marca. */
const INVITACION_DE_SOCIO = `11111111-1111-4111-8111-111111111111.${'A'.repeat(LONGITUD_SECRETO_SOCIO)}`;

test('los demás fragmentos del sitio no se tocan: ni la dirección ni el almacenamiento', () => {
  for (const hash of [
    `#invitacion=${INVITACION_DE_SOCIO}`,
    `#invitacion=${PROFESIONAL}`,
    '#invitacion=%E0',
    `#invitacion=part-${CODIGO.slice('PART-'.length)}`,
    '#t-datos',
    '#pasar=ABCD-EFGH',
    `#codigo=${CODIGO}`,
    '',
  ]) {
    assert.equal(llegarCon(hash), null, hash);
    assert.deepEqual(reemplazos, [], hash);
    assert.equal(pestana.size, 0, hash);
    assert.equal(direccion.hash, hash, hash);
  }
});

test('al responder se olvida la invitación de ese código, y no la de otro', () => {
  llegarCon(`#invitacion=${CODIGO}`);
  invitacion.olvidarInvitacion(codigoDistinto());
  assert.equal(invitacion.invitacionGuardada(), CODIGO);
  invitacion.olvidarInvitacion(CODIGO);
  assert.equal(invitacion.invitacionGuardada(), null);
  assert.equal(pestana.size, 0);
});

function codigoDistinto() {
  return CODIGO.replace('RSTV', 'RSTW');
}

/** La vista final del recorrido, como la abre el paso 4. */
function abrirVistaFinal() {
  const paso = new Nodo('div');
  paso.id = 'paso-4';
  const mensaje = new Nodo('div');
  Object.defineProperty(mensaje, 'isConnected', { value: true });
  const carpeta = new Nodo('div');
  mensaje.append(carpeta);
  paso.append(mensaje);
  const conversacion = new Nodo('div');
  conversacion.id = 'rc-conversacion';
  pagina.body.append(conversacion, paso);
  pagina.body.dataset.paso = '4';
  prepararEntregaFinal({
    mensaje: mensaje as unknown as HTMLElement,
    carpeta: carpeta as unknown as HTMLElement,
    signal: new AbortController().signal,
    cursos: 1,
    hojaLista: true,
    sinEstimar: [],
  });
  return carpeta;
}

// Al volver a mostrarla, la prueba siguiente publica la Encuesta visible y el mismo código vuelve a ofrecerla.
test('con la encuesta oculta, la invitación se conserva y «Tus documentos» no la ofrece', async () => {
  llegarCon(`#invitacion=${CODIGO}`);
  await publicarEncuesta(false, 1);
  assert.equal(abrirVistaFinal().querySelector('.rc-entrega-encuesta'), null);
  assert.equal(invitacion.invitacionGuardada(), CODIGO);
});

test('con una invitación guardada, «Tus documentos» invita a responder y abre la encuesta con el código puesto', async () => {
  await publicarEncuesta(true, 2);
  llegarCon(`#invitacion=${CODIGO}`);
  const carpeta = abrirVistaFinal();
  const bloque = carpeta.querySelector('.rc-entrega-encuesta');
  assert.ok(bloque);
  assert.match(bloque.textContent, /Tu opinión sobre Faro/u);
  assert.match(bloque.textContent, /se responden en un minuto y la encuesta es anónima/u);
  const boton = bloque.querySelector('a') as unknown as { href: string; target: string; rel: string } | null;
  assert.ok(boton);
  // El código va en el fragmento, nunca en la consulta; la encuesta se abre en otra pestaña para no perder el recorrido.
  assert.equal(boton.href, `encuesta.html#codigo=${CODIGO}`);
  assert.equal(boton.target, '_blank');
  assert.equal(boton.rel, 'noopener');
  const nombre = (boton as unknown as { getAttribute(n: string): string | null }).getAttribute('aria-label');
  assert.match(nombre ?? '', /se abre en otra pestaña/u);
  // Al responder en esta pestaña, el bloque desaparece; desde otra, lo prueba «al responder en la pestaña de la encuesta…».
  invitacion.olvidarInvitacion(CODIGO);
  assert.equal(carpeta.querySelector('.rc-entrega-encuesta'), null);
});

test('sin invitación guardada, la vista final no muestra el bloque de la encuesta', () => {
  const carpeta = abrirVistaFinal();
  assert.equal(pagina.body.dataset.entrega, 'final');
  assert.equal(carpeta.querySelector('.rc-entrega-encuesta'), null);
});

test('con una invitación guardada, el pie lleva un enlace discreto a la encuesta, una sola vez', () => {
  const pie = new Nodo('footer');
  const enlaces = new Nodo('nav');
  pie.append(enlaces);
  pagina.body.append(pie);
  invitacion.iniciarInvitacion();
  assert.equal(enlaces.querySelector('.pie-encuesta'), null);
  llegarCon(`#invitacion=${CODIGO}`);
  invitacion.iniciarInvitacion();
  invitacion.iniciarInvitacion();
  const accesos = enlaces.querySelectorAll('.pie-encuesta') as unknown as { href: string; textContent: string }[];
  assert.equal(accesos.length, 1);
  assert.equal(accesos[0]?.href, `encuesta.html#codigo=${CODIGO}`);
  assert.equal(accesos[0]?.textContent, 'Encuesta del piloto');
  invitacion.olvidarInvitacion(CODIGO);
  assert.equal(enlaces.querySelector('.pie-encuesta'), null);
});

test('con la encuesta oculta, el pie dice que no está disponible ahora y la invitación sigue guardada', async () => {
  const VISIBLE_OTRA_VEZ = 4;
  await publicarEncuesta(false, VISIBLE_OTRA_VEZ - 1);
  const pie = new Nodo('footer');
  const enlaces = new Nodo('nav');
  pie.append(enlaces);
  pagina.body.append(pie);
  llegarCon(`#invitacion=${CODIGO}`);
  invitacion.iniciarInvitacion();
  const aviso = enlaces.querySelector('.pie-encuesta') as unknown as { tagName: string; textContent: string } | null;
  assert.equal(aviso?.tagName, 'SPAN');
  assert.equal(
    aviso?.textContent,
    'La encuesta no está disponible ahora. Tu invitación sigue guardada en esta pestaña.',
  );
  assert.equal(invitacion.invitacionGuardada(), CODIGO);
  invitacion.olvidarInvitacion(CODIGO);
  await publicarEncuesta(true, VISIBLE_OTRA_VEZ);
});

/** El pie de la página, donde va el enlace discreto a la encuesta. */
function pieDeLaPagina() {
  const pie = new Nodo('footer');
  const enlaces = new Nodo('nav');
  pie.append(enlaces);
  pagina.body.append(pie);
  return enlaces;
}

test('el enlace pegado en una pestaña que ya muestra la página también se recoge, aunque no recargue', () => {
  const enlaces = pieDeLaPagina();
  Object.assign(direccion, { hash: `#invitacion=${CODIGO}`, search: '' });
  reemplazos.length = 0;
  assert.equal(alCambiarElFragmento.length, 1);
  alCambiarElFragmento[0]?.();
  assert.deepEqual(reemplazos, ['/inicio.html']);
  assert.equal(invitacion.invitacionGuardada(), CODIGO);
  const acceso = enlaces.querySelector('.pie-encuesta') as unknown as { getAttribute(nombre: string): string | null };
  assert.match(acceso.getAttribute('aria-label') ?? '', /se abre en otra pestaña/u);
});

test('al responder en la pestaña de la encuesta, la del recorrido olvida la invitación por el aviso entre pestañas', () => {
  const enlaces = pieDeLaPagina();
  llegarCon(`#invitacion=${CODIGO}`);
  invitacion.iniciarInvitacion();
  assert.ok(enlaces.querySelector('.pie-encuesta'));
  // La encuesta se abre en otra pestaña, sin la invitación guardada: responde allí y avisa.
  actual = 1;
  invitacion.olvidarInvitacion(codigoDistinto());
  assert.equal(pestanas[0]?.get('faro-invitacion'), CODIGO, 'otro código no borra esta invitación');
  invitacion.olvidarInvitacion(CODIGO);
  assert.equal(pestanas[0]?.size, 0);
  assert.equal(enlaces.querySelector('.pie-encuesta'), null);
});

test('«Borrar todo» en otra pestaña retira la invitación de esta', () => {
  llegarCon(`#invitacion=${CODIGO}`);
  invitacion.iniciarInvitacion();
  actual = 1;
  avisarBorrado();
  assert.equal(pestanas[0]?.size, 0);
});
