/**
 * Transcripción de la portada y de la pantalla de acceso, en catalán y en castellano, servidas con su política de
 * seguridad real: título de la pestaña, textos visibles y los aria-label, title y alt, en el orden del documento; en el
 * acceso, también los dos pasos del formulario, cada aviso de error, el aviso mientras se entra, la página sin
 * JavaScript y la página cuyo guion bloquea la política de seguridad. La tabla de abajo es la única copia de los textos
 * aprobados en las pruebas: las demás solo comprueban comportamiento.
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { chromium } from 'playwright-core';
import * as accesoWeb from '../../src/plataforma/cloudflare/acceso-web-pagina.ts';
import worker from '../../src/plataforma/cloudflare/worker-oficial.ts';
import { cerrarServidor, cerrarSinSustituir, lanzarConPlazo, recursosDelCaso } from './recursos-del-caso.mjs';

const ORIGEN = 'https://ejemplo.invalid';
const PROHIBIDO = 403;
const DEMASIADOS = 429;
const NO_DISPONIBLE = 503;
const RED_CORTADA = 'red cortada';
const CAUSAS = [PROHIBIDO, DEMASIADOS, NO_DISPONIBLE, RED_CORTADA];
const { paginaAcceso } = accesoWeb;
/** Plazo corto con el que se sustituye el de la pantalla para no esperar el real en la prueba. */
const PLAZO_DE_PRUEBA_MS = 300;

const CABECERA_PORTADA = {
  ca: [
    'aria-label: Faro',
    'texto: FARO',
    'aria-label: Canvia l’idioma al castellà',
    'title: Canvia l’idioma al castellà',
  ],
  es: [
    'aria-label: Faro',
    'texto: FARO',
    'aria-label: Cambiar el idioma al catalán',
    'title: Cambiar el idioma al catalán',
  ],
};
const CABECERA_ACCESO = {
  ca: ['aria-label: Faro, torna a la portada', 'texto: FARO', ...CABECERA_PORTADA.ca.slice(2)],
  es: ['aria-label: Faro, volver a la portada', 'texto: FARO', ...CABECERA_PORTADA.es.slice(2)],
};

const ANUNCIOS = [
  {
    instante: '2026-11-30T22:59:58Z',
    ca: [
      'texto: La demo privada comença d’aquí a',
      'aria-label: La demo privada comença d’aquí a',
      'texto: 00',
      'texto: dies',
      'texto: 00',
      'texto: hores',
      'texto: 00',
      'texto: minuts',
      'texto: 02',
      'texto: segons',
      'texto: 1 de desembre de 2026 · 00:00 Madrid',
    ],
    es: [
      'texto: La demo privada comienza en',
      'aria-label: La demo privada comienza en',
      'texto: 00',
      'texto: días',
      'texto: 00',
      'texto: horas',
      'texto: 00',
      'texto: minutos',
      'texto: 02',
      'texto: segundos',
      'texto: 1 de diciembre de 2026 · 00:00 Madrid',
    ],
  },
  {
    instante: '2026-11-30T23:00:00Z',
    ca: ['texto: La demo privada ha començat'],
    es: ['texto: La demo privada ha comenzado'],
  },
];

/** Tabla de textos aprobada para las dos pantallas. */
const ESPERADO = {
  portada: {
    ca: (anuncio) => [
      'pestaña: Faro',
      ...CABECERA_PORTADA.ca,
      'alt: Far de Trwyn Du a Penmon, Gal·les, envoltat pel mar en calma.',
      'texto: FARO',
      'texto: Descobreix com la IA pot canviar la feina i decideix en què et vols formar.',
      ...anuncio,
      'texto: Entra',
      'texto: Accés privat',
      'texto: © 2026 Faro',
    ],
    es: (anuncio) => [
      'pestaña: Faro',
      ...CABECERA_PORTADA.es,
      'alt: Faro de Trwyn Du en Penmon, Gales, rodeado por el mar en calma.',
      'texto: FARO',
      'texto: Descubre cómo la IA puede cambiar el trabajo y decide en qué quieres formarte.',
      ...anuncio,
      'texto: Entrar',
      'texto: Acceso privado',
      'texto: © 2026 Faro',
    ],
  },
  acceso: {
    ca: [
      'pestaña: Faro · Accés privat',
      ...CABECERA_ACCESO.ca,
      'texto: Accés privat',
      'texto: Escriu el teu usuari i la contrasenya per entrar.',
      'texto: Usuari',
      'texto: Continua',
      'paso 2',
      'pestaña: Faro · Accés privat',
      ...CABECERA_ACCESO.ca,
      'texto: Accés privat',
      'texto: Escriu el teu usuari i la contrasenya per entrar.',
      'texto: Contrasenya',
      'texto: Entra',
      'texto: Canvia d’usuari',
      'error 403: L’usuari o la contrasenya no són correctes. Comprova’ls i torna-ho a provar.',
      'error 429: Has fet molts intents seguits. Espera un quart d’hora i torna-ho a provar.',
      'error 503: Ara no es pot entrar a Faro. Torna-ho a provar d’aquí a una estona.',
      'error red cortada: Ara no es pot entrar a Faro. Torna-ho a provar d’aquí a una estona.',
    ],
    es: [
      'pestaña: Faro · Acceso privado',
      ...CABECERA_ACCESO.es,
      'texto: Acceso privado',
      'texto: Escribe tu usuario y tu contraseña para entrar.',
      'texto: Usuario',
      'texto: Continuar',
      'paso 2',
      'pestaña: Faro · Acceso privado',
      ...CABECERA_ACCESO.es,
      'texto: Acceso privado',
      'texto: Escribe tu usuario y tu contraseña para entrar.',
      'texto: Contraseña',
      'texto: Entrar',
      'texto: Cambiar de usuario',
      'error 403: El usuario o la contraseña no son correctos. Compruébalos y vuelve a intentarlo.',
      'error 429: Has hecho muchos intentos seguidos. Espera un cuarto de hora y vuelve a intentarlo.',
      'error 503: Ahora no se puede entrar en Faro. Vuelve a intentarlo dentro de un rato.',
      'error red cortada: Ahora no se puede entrar en Faro. Vuelve a intentarlo dentro de un rato.',
    ],
  },
  sinJavaScript: [
    'pestaña: Faro · Accés privat',
    ...CABECERA_ACCESO.ca,
    'texto: Accés privat',
    'texto: Escriu el teu usuari i la contrasenya per entrar.',
    'texto: Usuari',
    'texto: Continua',
    'texto: Per entrar, activa el JavaScript al navegador.',
    'texto: Para entrar, activa JavaScript en tu navegador.',
  ],
  guionBloqueado: [
    'pestaña: Faro · Accés privat',
    ...CABECERA_ACCESO.ca,
    'texto: Accés privat',
    'texto: Escriu el teu usuari i la contrasenya per entrar.',
    'texto: Usuari',
    'texto: Continua',
    'texto: L’accés no s’ha pogut carregar. Torna a carregar la pàgina per tornar-ho a provar.',
    'texto: El acceso no se ha podido cargar. Recarga la página para volver a intentarlo.',
  ],
  progreso: { ca: 'Entrant…', es: 'Entrando…' },
  servicio: { ca: 'Ara no es pot entrar a Faro. Torna-ho a provar d’aquí a una estona.' },
};

/** Respuesta de prueba a partir de una respuesta del servidor real, con sus cabeceras (CSP incluida). */
async function cumplir(route, respuesta) {
  return route.fulfill({
    status: respuesta.status,
    headers: Object.fromEntries(respuesta.headers),
    body: await respuesta.text(),
  });
}

/** Sirve la portada con el Worker oficial, el acceso con su página y cada envío con la causa siguiente. */
async function servir(page) {
  let envio = 0;
  await page.route(`${ORIGEN}/**`, async (route) => {
    const request = route.request();
    const ruta = new URL(request.url()).pathname;
    if (ruta === '/acceso-web/entrar') {
      const causa = CAUSAS[envio++ % CAUSAS.length];
      return causa === RED_CORTADA ? route.abort('internetdisconnected') : route.fulfill({ status: causa, body: '' });
    }
    const peticion = new Request(request.url(), { method: request.method(), headers: await request.allHeaders() });
    return cumplir(route, ruta === '/' ? await worker.fetch(peticion, {}) : paginaAcceso(peticion));
  });
}

/** Título y textos visibles con sus atributos accesibles, en el orden del documento. */
function transcribir(page) {
  return page.evaluate(() => {
    const salida = [`pestaña: ${document.title}`];
    const atributos = (elemento) =>
      ['aria-label', 'title', 'alt']
        .filter((atributo) => elemento.getAttribute(atributo))
        .map((atributo) => `${atributo}: ${elemento.getAttribute(atributo)}`);
    const conTexto = (elemento) =>
      [...elemento.childNodes].some((nodo) => nodo.nodeType === Node.TEXT_NODE && nodo.textContent.trim() !== '');
    const recorrer = (elemento) => {
      if (!elemento.checkVisibility()) {
        return;
      }
      salida.push(...atributos(elemento));
      if (conTexto(elemento) || elemento.matches('[role="timer"] strong')) {
        salida.push(`texto: ${elemento.textContent.replace(/\s+/g, ' ').trim()}`);
        return;
      }
      for (const hijo of elemento.children) {
        recorrer(hijo);
      }
    };
    recorrer(document.body);
    return salida;
  });
}

/** Los dos pasos del formulario y el aviso de cada causa de rechazo, en el idioma que se muestra. */
async function transcribirAcceso(page) {
  const salida = await transcribir(page);
  await page.locator('#campo-usuario').fill('Faro');
  await page.locator('#campo-usuario').press('Enter');
  salida.push('paso 2', ...(await transcribir(page)));
  for (const causa of CAUSAS) {
    await page.locator('#campo-clave').fill('clave-sintetica');
    await page.locator('#campo-clave').press('Enter');
    await page.waitForFunction(
      () => !document.getElementById('error-acceso').hidden && !document.getElementById('entrar').disabled,
    );
    salida.push(`error ${causa}: ${await page.locator('#error-acceso').textContent()}`);
  }
  await page.locator('#volver-usuario').click();
  return salida;
}

test('la portada dice los textos aprobados antes y después del estreno en catalán y en castellano', async (t) => {
  const recursos = recursosDelCaso(t);
  const navegador = await lanzarConPlazo(chromium, { headless: true }, t.name, { recursos });
  try {
    const page = await navegador.newPage({ locale: 'es-ES', reducedMotion: 'reduce' });
    await servir(page);
    for (const anuncio of ANUNCIOS) {
      await page.clock.setFixedTime(new Date(anuncio.instante));
      await page.goto(`${ORIGEN}/`);
      assert.deepEqual(await transcribir(page), ESPERADO.portada.ca(anuncio.ca));
      await page.locator('#idioma-entrada').click();
      assert.deepEqual(await transcribir(page), ESPERADO.portada.es(anuncio.es));
    }
  } finally {
    await cerrarSinSustituir(() => recursos.cerrar(navegador), 'el navegador no se cerró');
  }
});

test('el acceso dice los textos aprobados en los dos pasos y en cada aviso, en catalán y en castellano', async (t) => {
  const recursos = recursosDelCaso(t);
  const navegador = await lanzarConPlazo(chromium, { headless: true }, t.name, { recursos });
  try {
    const page = await navegador.newPage({ locale: 'ca-ES', reducedMotion: 'reduce' });
    await servir(page);
    await page.goto(`${ORIGEN}/acceso-web`);
    assert.deepEqual(await transcribirAcceso(page), ESPERADO.acceso.ca);
    await page.locator('#idioma-entrada').click();
    assert.deepEqual(await transcribirAcceso(page), ESPERADO.acceso.es);
  } finally {
    await cerrarSinSustituir(() => recursos.cerrar(navegador), 'el navegador no se cerró');
  }
});

test('sin JavaScript, el acceso muestra el catalán inicial y el aviso en los dos idiomas', async (t) => {
  const recursos = recursosDelCaso(t);
  const navegador = await lanzarConPlazo(chromium, { headless: true }, t.name, { recursos });
  try {
    const contexto = await navegador.newContext({ javaScriptEnabled: false });
    const page = await contexto.newPage();
    await servir(page);
    await page.goto(`${ORIGEN}/acceso-web`);
    assert.deepEqual(await transcribir(page), ESPERADO.sinJavaScript);
  } finally {
    await cerrarSinSustituir(() => recursos.cerrar(navegador), 'el navegador no se cerró');
  }
});

/** Sirve la pantalla de acceso real y entrega cada envío del formulario a la función indicada. */
async function servirAcceso(page, alEnviar, alterar = (html) => html) {
  await page.route(`${ORIGEN}/**`, async (route) => {
    const request = route.request();
    if (new URL(request.url()).pathname === '/acceso-web/entrar') {
      return alEnviar(route);
    }
    const respuesta = paginaAcceso(
      new Request(request.url(), { method: request.method(), headers: await request.allHeaders() }),
    );
    return route.fulfill({
      status: respuesta.status,
      headers: Object.fromEntries(respuesta.headers),
      body: alterar(await respuesta.text()),
    });
  });
}

/**
 * Sustituye en la página el plazo del envío por el de prueba y apunta, del lado de la prueba, cada plazo pedido y cada
 * plazo anulado antes de vencer. Cubre las dos formas de programarlo, un temporizador o AbortSignal.timeout, para que la
 * prueba juzgue la conducta y no la técnica. El registro vive fuera de la página porque el guion de arranque vuelve a
 * ejecutarse en cada documento: tras entrar, la página nueva empezaría sin él.
 */
async function acortarPlazo(page) {
  const plazos = { pedidos: [], anulados: [] };
  await page.exposeFunction('apuntarPlazo', (suceso, milisegundos) => {
    plazos[suceso].push(milisegundos);
  });
  await page.addInitScript(
    ({ real, corto }) => {
      const temporizador = window.setTimeout.bind(window);
      const anular = window.clearTimeout.bind(window);
      const pendientes = new Set();
      window.setTimeout = (accion, milisegundos, ...resto) => {
        if (milisegundos !== real) {
          return temporizador(accion, milisegundos, ...resto);
        }
        const id = temporizador(() => {
          pendientes.delete(id);
          accion(...resto);
        }, corto);
        pendientes.add(id);
        window.apuntarPlazo('pedidos', milisegundos);
        return id;
      };
      window.clearTimeout = (id) => {
        if (pendientes.delete(id)) {
          window.apuntarPlazo('anulados', real);
        }
        anular(id);
      };
      const senal = AbortSignal.timeout.bind(AbortSignal);
      AbortSignal.timeout = (milisegundos) => {
        window.apuntarPlazo('pedidos', milisegundos);
        return senal(milisegundos === real ? corto : milisegundos);
      };
    },
    { real: accesoWeb.PLAZO_ENTRADA_MS, corto: PLAZO_DE_PRUEBA_MS },
  );
  return plazos;
}

/** Lleva el formulario al paso de la contraseña y lo envía. */
async function enviarClave(page) {
  await page.locator('#campo-usuario').fill('Faro');
  await page.locator('#campo-usuario').press('Enter');
  await page.locator('#campo-clave').fill('clave-sintetica');
  await page.locator('#campo-clave').press('Enter');
}

/** Estado accesible del envío: el aviso de progreso y el botón. */
function estadoDelEnvio(page) {
  return page.evaluate(() => {
    const progreso = document.getElementById('progreso-acceso');
    const boton = document.getElementById('entrar');
    return {
      progreso: progreso?.textContent ?? null,
      papel: progreso?.getAttribute('role') ?? null,
      vivo: progreso?.getAttribute('aria-live') ?? null,
      ocupado: boton.getAttribute('aria-busy'),
      desactivado: boton.disabled,
      volverDesactivado: document.getElementById('volver-usuario').disabled,
    };
  });
}

const LIBRE = { ocupado: null, desactivado: false, volverDesactivado: false, progreso: '' };

test('mientras se entra, el acceso lo anuncia en una región de estado y marca el botón ocupado', async (t) => {
  const recursos = recursosDelCaso(t);
  const navegador = await lanzarConPlazo(chromium, { headless: true }, t.name, { recursos });
  try {
    const page = await navegador.newPage({ locale: 'ca-ES', reducedMotion: 'reduce' });
    let soltar = () => undefined;
    let avisarLlegada = () => undefined;
    const llegada = new Promise((resolver) => {
      avisarLlegada = resolver;
    });
    await servirAcceso(page, async (route) => {
      const respuesta = new Promise((resolver) => {
        soltar = resolver;
      });
      avisarLlegada();
      await respuesta;
      await route.fulfill({ status: PROHIBIDO, body: '' });
    });
    await page.goto(`${ORIGEN}/acceso-web`);
    const { papel, vivo, ...enReposo } = await estadoDelEnvio(page);
    assert.deepEqual({ papel, vivo, ...enReposo }, { papel: 'status', vivo: 'polite', ...LIBRE });
    await enviarClave(page);
    await llegada;
    const enviando = { ocupado: 'true', desactivado: true, volverDesactivado: true };
    assert.deepEqual(await estadoDelEnvio(page), { papel, vivo, ...enviando, progreso: ESPERADO.progreso.ca });
    await page.locator('#idioma-entrada').click();
    assert.deepEqual(await estadoDelEnvio(page), { papel, vivo, ...enviando, progreso: ESPERADO.progreso.es });
    soltar();
    await page.waitForFunction(() => !document.getElementById('error-acceso').hidden);
    assert.deepEqual(await estadoDelEnvio(page), { papel, vivo, ...LIBRE });
    assert.equal(await page.locator('#progreso-acceso').evaluate((nodo) => nodo.getAnimations().length), 0);
  } finally {
    await cerrarSinSustituir(() => recursos.cerrar(navegador), 'el navegador no se cerró');
  }
});

test('si el servidor no contesta en su plazo, avisa del servicio y reactiva el botón sin envíos duplicados', async (t) => {
  const recursos = recursosDelCaso(t);
  const navegador = await lanzarConPlazo(chromium, { headless: true }, t.name, { recursos });
  try {
    const page = await navegador.newPage({ locale: 'ca-ES', reducedMotion: 'reduce' });
    const plazos = await acortarPlazo(page);
    let envios = 0;
    await servirAcceso(page, () => {
      envios++;
    });
    await page.goto(`${ORIGEN}/acceso-web`);
    await enviarClave(page);
    await page.locator('#campo-clave').press('Enter');
    await page.waitForFunction(() => !document.getElementById('error-acceso').hidden);
    assert.equal(await page.locator('#error-acceso').textContent(), ESPERADO.servicio.ca);
    assert.deepEqual(await estadoDelEnvio(page), { papel: 'status', vivo: 'polite', ...LIBRE });
    assert.equal(envios, 1);
    assert.deepEqual(plazos, { pedidos: [accesoWeb.PLAZO_ENTRADA_MS], anulados: [] });
    await page.locator('#campo-clave').press('Enter');
    await page.waitForFunction(() => document.getElementById('error-acceso').hidden);
    await page.waitForFunction(() => !document.getElementById('error-acceso').hidden);
    assert.equal(await page.locator('#entrar').isDisabled(), false);
    assert.equal(envios, 2);
    assert.deepEqual(plazos, { pedidos: [accesoWeb.PLAZO_ENTRADA_MS, accesoWeb.PLAZO_ENTRADA_MS], anulados: [] });
  } finally {
    await cerrarSinSustituir(() => recursos.cerrar(navegador), 'el navegador no se cerró');
  }
});

test('si la política de seguridad bloquea el guion, el acceso avisa en los dos idiomas de que no ha cargado', async (t) => {
  const recursos = recursosDelCaso(t);
  const navegador = await lanzarConPlazo(chromium, { headless: true }, t.name, { recursos });
  try {
    const page = await navegador.newPage({ locale: 'ca-ES', reducedMotion: 'reduce' });
    const bloqueos = [];
    page.on('console', (mensaje) => {
      if (/Content Security Policy/i.test(mensaje.text())) {
        bloqueos.push(mensaje.text());
      }
    });
    // Un guion alterado ya no coincide con su huella: el navegador no lo ejecuta, como en un despliegue dañado.
    await servirAcceso(
      page,
      (route) => route.abort(),
      (html) => html.replace('<script>', '<script> '),
    );
    await page.goto(`${ORIGEN}/acceso-web`);
    assert.ok(bloqueos.length > 0, 'la política de seguridad no ha bloqueado el guion alterado');
    assert.deepEqual(await transcribir(page), ESPERADO.guionBloqueado);
    assert.equal(await page.locator('#continuar').isDisabled(), true);
  } finally {
    await cerrarSinSustituir(() => recursos.cerrar(navegador), 'el navegador no se cerró');
  }
});

test('con el guion sano, el aviso de carga fallida no llega a pintarse', async (t) => {
  const recursos = recursosDelCaso(t);
  const navegador = await lanzarConPlazo(chromium, { headless: true }, t.name, { recursos });
  try {
    const page = await navegador.newPage({ locale: 'ca-ES', reducedMotion: 'reduce' });
    await page.addInitScript(() => {
      window.avisoAlInsertarse = [];
      new MutationObserver((cambios) => {
        for (const nodo of cambios.flatMap((cambio) => [...cambio.addedNodes])) {
          if (nodo.id === 'aviso-carga') {
            window.avisoAlInsertarse.push(getComputedStyle(nodo).display);
          }
        }
      }).observe(document, { childList: true, subtree: true });
    });
    await servirAcceso(page, (route) => route.abort());
    await page.goto(`${ORIGEN}/acceso-web`);
    assert.deepEqual(await page.evaluate(() => window.avisoAlInsertarse), ['none']);
    assert.equal(await page.locator('#aviso-carga').isVisible(), false);
    assert.equal(await page.locator('#continuar').isDisabled(), false);
  } finally {
    await cerrarSinSustituir(() => recursos.cerrar(navegador), 'el navegador no se cerró');
  }
});

const OK = 200;
const MITAD = 2;
const TRES_VECES = 3;
/** Pausa de la prueba, en milisegundos. */
const esperar = (milisegundos) => new Promise((resolver) => setTimeout(resolver, milisegundos));
/** Las cabeceras del 200 llegan antes del plazo de prueba y el cuerpo, bastante después. */
const CABECERAS_A_LOS_MS = PLAZO_DE_PRUEBA_MS / MITAD;
const CUERPO_A_LOS_MS = PLAZO_DE_PRUEBA_MS * TRES_VECES;

/**
 * Servidor local que necesita esta prueba: una ruta interceptada entrega la respuesta entera de una vez, y aquí las
 * cabeceras y el cuerpo tienen que llegar por separado.
 */
async function servidorConCuerpoLento() {
  const servidor = createServer(async (peticion, respuesta) => {
    const ruta = new URL(peticion.url ?? '/', 'http://127.0.0.1').pathname;
    if (ruta === '/acceso-web/entrar') {
      await esperar(CABECERAS_A_LOS_MS);
      respuesta.writeHead(OK, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      respuesta.flushHeaders();
      await esperar(CUERPO_A_LOS_MS);
      respuesta.end('{"ok":true}');
      return;
    }
    if (ruta === '/acceso-web') {
      const pagina = paginaAcceso(new Request(`${ORIGEN}/acceso-web`, { headers: { accept: 'text/html' } }));
      respuesta.writeHead(pagina.status, Object.fromEntries(pagina.headers));
      respuesta.end(await pagina.text());
      return;
    }
    respuesta.writeHead(OK, { 'content-type': 'text/html; charset=utf-8' });
    respuesta.end('<!doctype html><title>dentro</title>');
  });
  await new Promise((resolver) => servidor.listen(0, '127.0.0.1', resolver));
  return servidor;
}

test('un 200 que llega antes del plazo entra aunque su cuerpo tarde más: el plazo no corta la lectura', async (t) => {
  const recursos = recursosDelCaso(t);
  const servidor = await recursos.abrir('el servidor de ensayo', servidorConCuerpoLento, cerrarServidor);
  const navegador = await lanzarConPlazo(chromium, { headless: true }, t.name, { recursos });
  try {
    const page = await navegador.newPage({ locale: 'ca-ES', reducedMotion: 'reduce' });
    const plazos = await acortarPlazo(page);
    const { port } = servidor.address();
    await page.goto(`http://127.0.0.1:${port}/acceso-web`);
    const destino = page.waitForURL(`http://127.0.0.1:${port}/inicio.html`);
    await enviarClave(page);
    await destino;
    assert.deepEqual(plazos, { pedidos: [accesoWeb.PLAZO_ENTRADA_MS], anulados: [accesoWeb.PLAZO_ENTRADA_MS] });
    assert.equal(await page.title(), 'dentro');
  } finally {
    await cerrarSinSustituir(() => recursos.cerrar(navegador), 'el navegador no se cerró');
    await cerrarSinSustituir(() => recursos.cerrar(servidor), 'el servidor de ensayo no se cerró');
  }
});
