// Ensayo: un JavaScript alterado en el servidor no se ejecuta. Sobre la construcción servida por fixture.ts, se alteran
// en memoria (los archivos no cambian) la entrada de la página del recorrido, que lleva SRI, un trozo estático de esa
// página y un trozo del motor del dispositivo. En cada caso se comprueba que el código añadido no corre y que la página
// no funciona con él: la conversación no arranca, o el motor se declara no disponible (Faro lo dice a la persona en
// pocos segundos, sin seguir diciendo que se prepara, y no lo vuelve a intentar). El motor se altera de tres maneras:
// en el servidor antes de la primera visita (la copia completa lo precarga, así que la instalación del service worker
// falla: aviso de la primera visita sin nada que ofrecer, ningún service worker activo y nada guardado; al reponer el
// motor correcto, la instalación y el recorrido funcionan); en la copia ya guardada en el dispositivo (el service
// worker responde 500, Faro ofrece «Reparar Faro» y, al pulsarlo, el recorrido funciona y los datos de la persona
// siguen); y en la copia guardada con el servidor también alterado (tras reparar, el aviso de la primera visita, y los
// datos siguen). La reparación se ensaya además interrumpida a mitad: con la red cortada cuando ya ha bajado una parte, y
// con el propio service worker detenido (el navegador entero cerrado con un perfil persistente y vuelto a abrir), con
// dos pestañas que reparan a la vez, con la pregunta del navegador al salir rechazada, con una página que el servidor ya
// entrega de otra versión, y desde el informe de un resultado recibido de otro dispositivo. La copia del paquete de
// datos se ensaya también interrumpida, con el navegador entero cerrado a mitad (paquete-interrumpido): al volver, sigue
// donde se quedó (reanudación por archivos); y con dos pestañas que la piden a la vez (paquete-dos-pestanas): cada
// archivo se pide al servidor una sola vez. La entrada y el trozo se repiten sin su atributo `integrity`: el mapa de
// integridad de la página los
// sigue rechazando, con su error de integridad en la consola. Un control sin ninguna integridad ni CSP tiene que
// ejecutar el código añadido: si no lo hiciera, el ensayo no estaría viendo nada.
//
// Con --comprimido, el servidor del ensayo del presupuesto (presupuesto-servidor.mjs: HTTPS, Brotli o gzip según lo
// que acepte el navegador) va delante del fixture, como el alojamiento; el caso «sin-conexion» comprueba entonces que lo
// guardado se lee sin red con los bytes de su huella.
//
//   node pruebas/navegadores/modulo-alterado.mjs --artefacto <dist> [--motor chromium …] [--caso <caso> …]
//     [--comprimido] [--salida <carpeta>]
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { setTimeout as esperar } from 'node:timers/promises';
import { listasDelCatalogo, valoresDelServicio } from '../../herramientas/web/servicio/servicio-publicado.ts';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { IDENTIDAD_WEB } from '../../src/comun/identidad-web.ts';
import { TEXTOS_RECORRIDO as CA } from '../../web/idiomas/ca/recorrido.js';
import { TEXTOS_RECORRIDO as ES } from '../../web/idiomas/es/recorrido.js';
import { codificar } from '../../web/scripts/otro-dispositivo/formato.js';
import { crearFixture } from './fixture.ts';
import {
  abrirPerfil,
  argumentos,
  arrancar,
  construccionEnsayada,
  contextoDelRecorrido,
  esperarServiceWorkerActivado,
  PLAZO_MS,
  PRIMER_MENSAJE,
  preferenciasDelRecorrido,
  primerMensaje,
  recortar,
  servible,
  ultimoDeFaro,
} from './paquete-comun.mjs';
import { crearServidorDelEnsayo } from './presupuesto-servidor.mjs';

const PAGINA = 'web/recorrido.html';
const MOTOR = 'web/motor/src/plataforma/navegador/motor.js';
/** Lo que espera la página a que arranque con un módulo alterado. */
const ESPERA_MS = 15_000;
/** Lo que puede tardar Faro en decir que el motor no se puede usar: pocos segundos, no los 60 reintentos de 3 s. */
const AVISO_MS = 20_000;
/** Lo que se sigue mirando tras el aviso: más de tres esperas entre reintentos (ocupacion-local.js, 3 s). */
const SIN_REINTENTOS_MS = 10_000;
/** Un texto del recorrido en los dos idiomas. */
const enLosDosIdiomas = (clave) => [ES[clave], CA[clave]];
/**
 * Los dos avisos del motor que no es de esta versión: el de la copia guardada (con «Reparar Faro») y el de la primera
 * visita, cuando la instalación falla (sin nada que reparar); el de la preparación y «Volver a intentarlo».
 */
const AVISO_DE_LA_COPIA = enLosDosIdiomas('recorrido.error.motor-no-coincide');
const AVISO_DE_LA_INSTALACION = enLosDosIdiomas('recorrido.error.instalacion-no-coincide');
const AVISO = [...AVISO_DE_LA_COPIA, ...AVISO_DE_LA_INSTALACION];
const PREPARANDO = enLosDosIdiomas('recorrido.local.preparando');
const REINTENTAR = enLosDosIdiomas('recorrido.reintentar');
const REPARAR = enLosDosIdiomas('recorrido.reparar');
const REPARANDO = enLosDosIdiomas('recorrido.reparando');
const AVISO_SIN_REPARAR = enLosDosIdiomas('recorrido.error.reparar-sin-completar');
const AVISO_SIN_REPARAR_NO_COINCIDE = enLosDosIdiomas('recorrido.error.reparar-no-coincide');
/** Lo que dice Faro al abrir un resultado recibido de otro dispositivo. */
const RESULTADO_RECIBIDO = enLosDosIdiomas('recorrido.pasar.recibido');
/** Lo que no tiene que decir Faro tras el aviso: que se recargue la página (no lo arregla). */
const RECARGAR = /recarga|torna a carregar|recarrega/iu;
/**
 * Los datos de la persona que la reparación tiene que conservar: una marca en localStorage, otra en IndexedDB y sus
 * preferencias reales, el tema (tema.js) y el idioma (idioma.js).
 */
const DATOS_DE_PRUEBA = {
  clave: 'faro-ensayo-reparar',
  base: 'faro-ensayo-reparar',
  marca: 'sigue-aqui',
  preferencias: [
    ['faro-tema', 'oscuro'],
    ['faro-idioma', 'es'],
  ],
};
/** Lo que se espera de los datos de prueba mientras siguen: todo en su sitio. */
const DATOS_INTACTOS = {
  localStorage: true,
  preferencias: { 'faro-tema': true, 'faro-idioma': true },
  indexedDb: true,
};
/**
 * Cuántas respuestas de la reparación deja pasar el servidor antes de cortar la red o de retener la siguiente: unas
 * pocas de las más de cien de lo imprescindible, para que una parte llegue a la copia provisional y quede mucho por
 * bajar.
 */
const DEJA_PASAR = 20;
/** Cuántos archivos del principio de lo imprescindible se marcan en la copia para ver si la reparación los sustituye. */
const MARCADOS = 8;
/** Lo que se añade al final de un archivo marcado en la copia, según su tipo, sin cambiar lo que hace. */
const MARCA_EN_LA_COPIA = {
  '.html': '<!-- faro-ensayo-marca -->',
  '.css': '/* faro-ensayo-marca */',
  '.js': '// faro-ensayo-marca',
};
/** Lo que solo adorna (service-worker.js, SOLO_ADORNO): no es imprescindible y la reparación no lo baja. */
const SOLO_ADORNO = /^(tipografias|imagenes|recursos)\//u;
/** Lo que deja el motor cuando responde: una propuesta para elegir o las tareas (sus preguntas, en las sugerencias). */
const ELECCION_DEL_MOTOR = '.rc-eleccion-acciones > button.rc-boton-principal:visible, .rc-cuerpo[data-paso="3"]';
/** La copia de la web en el dispositivo y la constancia de una instalación que no coincide (service-worker.js). */
const PREFIJO_DE_LAS_COPIAS = 'faro:';
const CONSTANCIA = { copia: 'faro-estado:', clave: 'service-worker/instalacion.json' };
/** El aviso con que el service worker cuenta a las páginas abiertas que su instalación no coincide. */
const AVISO_DEL_SERVICE_WORKER = 'INSTALACION_QUE_NO_COINCIDE';
/** Lo que entrega el service worker en lugar de un archivo comprobado que no es de esta versión. */
const NO_ES_DE_ESTA_VERSION = 'El archivo del motor del dispositivo no es el de esta versión.';
/** El error de integridad de un módulo rechazado: «integrity» en Chromium y en WebKit. */
const ERROR_DE_INTEGRIDAD = /integrity/iu;

/** El código que se añade: deja una marca en su ámbito global y pide una dirección que el servidor anota. */
const anadido = (caso) =>
  `\n;globalThis.__faroAlterado=(globalThis.__faroAlterado??[]).concat(${JSON.stringify(caso)});` +
  `fetch('/__alterado/${caso}').catch(()=>{});\n`;

/** La entrada y el primer trozo estático de la página, leídos de su HTML. */
function piezasDeLaPagina(artefacto) {
  const html = artefacto.leer(PAGINA).toString('utf8');
  const entrada = /<script type="module" src="([^"]+)" integrity="/u.exec(html)?.[1];
  const trozo = /<link rel="modulepreload" href="([^"]+)" integrity="/u.exec(html)?.[1];
  assert.ok(entrada && trozo, 'La página del recorrido declara su entrada y sus trozos con integrity');
  return { entrada: `web/${entrada}`, trozo: `web/${trozo}` };
}

/**
 * La misma construcción, con los bytes de una ruta alterados al servirla mientras `estado.alterado` sea cierto. Con
 * `estado.limite` «contar», desde que se fija (cortarOretener) el servidor lo entrega todo y lo anota. Con «cortar» o
 * «retener», entrega `DEJA_PASAR` respuestas y después: con «cortar», ninguna más (la red se corta: el fixture
 * responde 500); con «retener», a la siguiente no le llega nunca el cuerpo (la petición queda a medias, sin completarse). Lo entregado, lo rechazado y lo
 * retenido desde entonces queda en `estado.tras`.
 */
function conAlteracion(artefacto, ruta, caso, estado = { alterado: true }) {
  const alterado = Buffer.concat([artefacto.leer(ruta), Buffer.from(anadido(caso))]);
  const leer = (pedida) => {
    const bytes = pedida === ruta && estado.alterado ? alterado : deEstaUOtraVersion(artefacto, pedida, estado);
    if (!estado.limite) {
      return bytes;
    }
    if (estado.limite === 'contar' || estado.tras.servidas.length < DEJA_PASAR) {
      estado.tras.servidas.push(pedida);
      return bytes;
    }
    if (estado.limite === 'cortar') {
      estado.tras.rechazadas.push(pedida);
      throw new Error('Red cortada por el ensayo');
    }
    estado.tras.retenidas.push(pedida);
    estado.tras.alRetener();
    return new ReadableStream({ start: (controlador) => void estado.tras.controladores.push(controlador) });
  };
  return { ...artefacto, leer };
}

/** Una página que el servidor entrega como si ya publicara otra versión (conAlteracion, con `estado.otraVersion`). */
const PAGINA_DE_OTRA_VERSION = 'web/inicio.html';
/** Lo que distingue esa página de la de esta versión: una línea más al final, sin cambiar lo que hace. */
const DE_OTRA_VERSION = '\n<!-- faro-ensayo-otra-version -->\n';

/** Los bytes de `pedida`; con `estado.otraVersion`, los de PAGINA_DE_OTRA_VERSION son los de otra versión. */
function deEstaUOtraVersion(artefacto, pedida, estado) {
  const bytes = artefacto.leer(pedida);
  return estado.otraVersion && pedida === PAGINA_DE_OTRA_VERSION
    ? Buffer.concat([bytes, Buffer.from(DE_OTRA_VERSION)])
    : bytes;
}

/** Empieza a contar lo que entrega el servidor (conAlteracion) y fija qué hace al llegar a DEJA_PASAR. */
function cortarOretener(estado, limite) {
  const retenida = Promise.withResolvers();
  estado.tras = { servidas: [], rechazadas: [], retenidas: [], controladores: [], alRetener: retenida.resolve };
  estado.limite = limite;
  return retenida.promise;
}

/** Deja de contar y suelta, con un error, lo que el servidor tenía retenido (conAlteracion). */
function servirConNormalidad(estado) {
  estado.limite = undefined;
  for (const controlador of estado.tras?.controladores ?? []) {
    controlador.error(new Error('Fin del ensayo'));
  }
}

/** Las listas de la copia que salen del CATALOGO del service worker de la construcción (listasDelCatalogo). */
function listasDeLaConstruccion(carpeta) {
  return listasDelCatalogo(valoresDelServicio(readFileSync(join(carpeta, 'web/service-worker.js'), 'utf8')).CATALOGO);
}

/** La huella de cada archivo de ARCHIVOS y BAJO_DEMANDA de la construcción (HUELLAS_DE_ARCHIVOS), por su ruta. */
function huellasDeLaConstruccion(carpeta) {
  return new Map(listasDeLaConstruccion(carpeta).HUELLAS_DE_ARCHIVOS);
}

/** Los primeros archivos de lo imprescindible de la construcción, de los que admiten una marca (MARCA_EN_LA_COPIA). */
function primerosDeLaCopia(carpeta) {
  const { ARCHIVOS: archivos } = listasDeLaConstruccion(carpeta);
  return archivos
    .filter(
      (archivo) => !SOLO_ADORNO.test(archivo) && Object.keys(MARCA_EN_LA_COPIA).some((fin) => archivo.endsWith(fin)),
    )
    .slice(0, MARCADOS);
}

/** Quita el atributo integrity del elemento que carga `ruta` (y, con `todo`, toda integridad y la CSP de la página). */
function sinIntegridad(html, ruta, todo) {
  const relativa = ruta.slice('web/'.length);
  if (!todo) {
    const patron = new RegExp(
      `((?:src|href)="${relativa.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}") integrity="[^"]*"`,
      'u',
    );
    assert.match(html, patron);
    return html.replace(patron, '$1');
  }
  return html
    .replace(/ integrity="[^"]*"/gu, '')
    .replace(/(<script type="importmap">)([\s\S]*?)(<\/script>)/u, (_t, abre, mapa, cierra) => {
      const { integrity: _quitada, ...resto } = JSON.parse(mapa);
      return `${abre}${JSON.stringify(resto)}${cierra}`;
    });
}

const CASOS = [
  { caso: 'entrada', pieza: 'entrada', motor: false },
  { caso: 'trozo-de-pagina', pieza: 'trozo', motor: false },
  { caso: 'entrada-sin-atributo', pieza: 'entrada', motor: false, html: 'atributo' },
  { caso: 'trozo-sin-atributo', pieza: 'trozo', motor: false, html: 'atributo' },
  { caso: 'motor-al-instalar', pieza: 'motor', motor: 'instalar' },
  { caso: 'copia-del-motor', pieza: 'motor', motor: 'copia', variante: 'reparar' },
  { caso: 'copia-y-servidor', pieza: 'motor', motor: 'copia', variante: 'servidor' },
  { caso: 'red-durante-reparacion', pieza: 'motor', motor: 'copia', variante: 'red' },
  { caso: 'cierre-durante-reparacion', pieza: 'motor', motor: 'copia', variante: 'cierre' },
  { caso: 'servicio-interrumpido', pieza: 'motor', motor: 'copia', variante: 'interrupcion', perfil: true },
  { caso: 'dos-pestanas', pieza: 'motor', motor: 'copia', variante: 'pestanas' },
  { caso: 'salida-rechazada', pieza: 'motor', motor: 'copia', variante: 'rechazar' },
  { caso: 'informe-recibido', pieza: 'motor', motor: 'copia', variante: 'informe' },
  { caso: 'pagina-de-otra-version', pieza: 'motor', motor: 'copia', variante: 'otra' },
  { caso: 'sin-conexion', pieza: 'motor', motor: 'sin-red' },
  { caso: 'paquete-interrumpido', pieza: 'motor', motor: 'paquete', perfil: true },
  { caso: 'paquete-dos-pestanas', pieza: 'motor', motor: 'paquete', variante: 'pestanas' },
  { caso: 'control-sin-integridad', pieza: 'entrada', motor: false, html: 'todo', control: true },
];

/** Sirve la página del recorrido sin el atributo integrity de `ruta` o, con «todo», sin integridad ni CSP. */
function servirSinIntegridad(contexto, origen, ruta, modo) {
  return contexto.route(`${origen}/recorrido.html`, async (peticion) => {
    const respuesta = await peticion.fetch();
    const cabeceras = { ...respuesta.headers() };
    if (modo === 'todo') {
      delete cabeceras['content-security-policy'];
    }
    const cuerpo = sinIntegridad(await respuesta.text(), ruta, modo === 'todo');
    await peticion.fulfill({ status: respuesta.status(), headers: cabeceras, body: cuerpo });
  });
}

/** Las veces que el servidor ha entregado `ruta`. */
const vecesServida = (fixture, ruta) => fixture.peticiones.filter((p) => p.ruta === ruta).length;

/** Lo que queda en la página tras el aviso: si el motor ha respondido, qué dice y qué ofrece la conversación. */
async function loQueQueda(pagina) {
  const conversacion = (await pagina.locator('#conversacion').textContent()) ?? '';
  const botones = await pagina.locator('button:visible').allTextContents();
  const sugerencias = await pagina.locator('#sugerencias:not([hidden]) .rc-sugerencia:visible').allTextContents();
  const ultimo = (await ultimoDeFaro(pagina)) ?? '';
  return {
    // El motor ha respondido si ha dejado algo suyo para elegir o si lo último de Faro no es el aviso.
    respondio: (await pagina.locator(ELECCION_DEL_MOTOR).count()) > 0 || !AVISO.some((texto) => ultimo.includes(texto)),
    diceQueSePrepara: PREPARANDO.some((texto) => conversacion.includes(texto)),
    ofreceReintentar: botones.some((boton) => REINTENTAR.some((texto) => boton.includes(texto))),
    pideRecargar: RECARGAR.test(ultimo),
    sugerencias: sugerencias.map((texto) => texto.trim()),
    ultimoDeFaro: recortar(ultimo),
  };
}

/**
 * Pulsa la primera sugerencia («Reparar Faro» o «Volver a intentarlo») y responde a la pregunta del navegador al salir
 * como esté fijado para la página (responderALosDialogos: la acepta, si no se ha dicho otra cosa). Con `recarga`,
 * espera a que la página se recargue y dice si lo ha hecho.
 */
async function pulsarLaSugerencia(pagina, recarga) {
  responderALosDialogos(pagina);
  const boton = pagina.locator('#sugerencias:not([hidden]) .rc-sugerencia:visible').first();
  if (!(await boton.count())) {
    return { pulsada: null, recargada: false };
  }
  const pulsada = ((await boton.textContent()) ?? '').trim();
  if (!recarga) {
    await boton.click();
    return { pulsada, recargada: false };
  }
  const recargada = await Promise.all([pagina.waitForEvent('load', { timeout: PLAZO_MS }), boton.click()]).then(
    () => true,
    () => false,
  );
  return { pulsada, recargada };
}

/** Lo que se hace en cada página con la pregunta del navegador al salir y cuántas veces ha preguntado: un oyente. */
const dialogosDe = new WeakMap();
/**
 * Responde en `pagina` a la pregunta del navegador al salir: la acepta o, con «rechazar», la rechaza (la persona se
 * queda). Sin `modo`, sigue como estuviera (aceptar, la primera vez). Devuelve la cuenta de preguntas de la página.
 */
function responderALosDialogos(pagina, modo) {
  const conocidos = dialogosDe.get(pagina);
  if (conocidos) {
    conocidos.modo = modo ?? conocidos.modo;
    return conocidos;
  }
  const nuevos = { modo: modo ?? 'aceptar', vistos: 0 };
  dialogosDe.set(pagina, nuevos);
  pagina.on('dialog', (dialogo) => {
    nuevos.vistos += 1;
    // Otra pregunta de la misma salida ya respondida no tiene nada que responder.
    void (nuevos.modo === 'aceptar' ? dialogo.accept() : dialogo.dismiss()).catch(() => {});
  });
  return nuevos;
}

/** Si la conversación ya ha empezado: está el primer mensaje de la persona. */
const conversacionEmpezada = async (pagina) =>
  ((await pagina.locator('#conversacion').textContent()) ?? '').includes(PRIMER_MENSAJE);

/** Si Faro sigue diciendo que se está reparando. */
const diceQueRepara = async (pagina) => {
  const conversacion = (await pagina.locator('#conversacion').textContent()) ?? '';
  return REPARANDO.some((texto) => conversacion.includes(texto));
};

/** Espera a que Faro diga uno de `textos`; devuelve si lo ha dicho a tiempo. */
const llegaElAviso = (pagina, textos) =>
  pagina
    .waitForFunction(
      (buscados) => buscados.some((texto) => document.querySelector('#conversacion')?.textContent?.includes(texto)),
      textos,
      { timeout: AVISO_MS },
    )
    .then(
      () => true,
      () => false,
    );

/** Tras una reparación que ha salido bien (la página recargada): el service worker, el motor y la copia. */
async function trasReparar(pagina) {
  await pagina.locator('#conversacion .rc-mensaje').first().waitFor({ timeout: PLAZO_MS });
  const empezada = await conversacionEmpezada(pagina);
  return {
    conversacionReiniciada: !empezada,
    serviceWorker: await esperarServiceWorkerActivado(pagina).catch((error) => String(error).split('\n')[0]),
    ...(await primerMensaje(pagina).then(
      (texto) => ({ respondio: true, texto: recortar(texto) }),
      (error) => ({ respondio: false, texto: recortar(String(error).split('\n')[0]) }),
    )),
    guardado: await loGuardado(pagina),
  };
}

/** Tras una reparación que ha fallado: el aviso, que no se recarga, que no sigue «reparando» y lo que ofrece. */
async function trasFallar(pagina, textos) {
  const aviso = await llegaElAviso(pagina, textos);
  const sugerencias = await pagina.locator('#sugerencias:not([hidden]) .rc-sugerencia:visible').allTextContents();
  return {
    aviso,
    conversacionSigue: await conversacionEmpezada(pagina),
    diceQueRepara: await diceQueRepara(pagina),
    sugerencias: sugerencias.map((texto) => texto.trim()),
  };
}

/** Guarda los datos de prueba de la persona (DATOS_DE_PRUEBA) o, con `leer`, dice si siguen. */
function datosDePrueba(pagina, leer = false) {
  return pagina.evaluate(
    async ({ clave, base, marca, preferencias, solo }) => {
      const abrir = () =>
        new Promise((ok, fallo) => {
          const peticion = indexedDB.open(base, 1);
          peticion.onupgradeneeded = () => peticion.result.createObjectStore('marcas');
          peticion.onsuccess = () => ok(peticion.result);
          peticion.onerror = () => fallo(peticion.error);
        });
      const bd = await abrir();
      const enIdb = await new Promise((ok, fallo) => {
        const almacen = bd.transaction('marcas', solo ? 'readonly' : 'readwrite').objectStore('marcas');
        const peticion = solo ? almacen.get('marca') : almacen.put(marca, 'marca');
        peticion.onsuccess = () => ok(solo ? peticion.result : marca);
        peticion.onerror = () => fallo(peticion.error);
      });
      bd.close();
      if (!solo) {
        localStorage.setItem(clave, marca);
        for (const preferencia of preferencias) {
          localStorage.setItem(...preferencia);
        }
      }
      // El guion del ensayo vuelve a fijar el idioma en cada carga (paquete-comun.mjs, preferenciasDelRecorrido): al
      // leer cuenta también lo que había justo antes de esa última carga.
      const alCargar = globalThis.__faroPreferenciasAlCargar ?? {};
      const sigue = ([nombre, valor]) =>
        localStorage.getItem(nombre) === valor && (!solo || !(nombre in alCargar) || alCargar[nombre] === valor);
      return {
        localStorage: localStorage.getItem(clave) === marca,
        preferencias: Object.fromEntries(preferencias.map((preferencia) => [preferencia[0], sigue(preferencia)])),
        indexedDb: enIdb === marca,
      };
    },
    { ...DATOS_DE_PRUEBA, solo: leer },
  );
}

/**
 * Lo que guarda el navegador: el service worker activo, las copias de la web (sin la provisional de una instalación) y
 * la constancia que deja una instalación que ha fallado porque un archivo comprobado no es el de esta versión.
 */
function loGuardado(pagina) {
  return pagina.evaluate(
    async ({ prefijo, constancia }) => {
      const base = new URL('./', location.href).href;
      const registro = await navigator.serviceWorker.getRegistration();
      const copias = (await caches.keys()).filter(
        (n) => n.startsWith(`${prefijo}${base}:`) && !n.endsWith(':provisional'),
      );
      const guardada = await caches.match(new URL(constancia.clave, base).href, {
        cacheName: `${constancia.copia}${base}`,
      });
      return {
        activo: registro?.active?.state ?? null,
        copias: copias.length,
        constancia: guardada ? await guardada.json() : null,
        avisos: globalThis.__avisosDelServiceWorker ?? [],
      };
    },
    { prefijo: PREFIJO_DE_LAS_COPIAS, constancia: CONSTANCIA },
  );
}

/** Cambia los bytes del motor en la copia guardada de la web, como podría hacerlo un guion con CacheStorage. */
function alterarLaCopia(pagina, rutaDelMotor, caso) {
  return pagina.evaluate(
    async ({ ruta, prefijo, texto }) => {
      const base = new URL('./', location.href).href;
      const nombre = (await caches.keys()).find(
        (n) => n.startsWith(`${prefijo}${base}:`) && !n.endsWith(':provisional'),
      );
      const copia = await caches.open(nombre);
      const direccion = new URL(ruta.slice(1), base).href;
      const guardada = await copia.match(direccion);
      const cuerpo = `${await guardada.text()}${texto}`;
      await copia.put(direccion, new Response(cuerpo, { headers: guardada.headers }));
      return nombre;
    },
    { ruta: rutaDelMotor, prefijo: PREFIJO_DE_LAS_COPIAS, texto: anadido(caso) },
  );
}

/** Añade su marca (MARCA_EN_LA_COPIA) a cada uno de `archivos` en la copia guardada de la web. */
function marcarEnLaCopia(pagina, archivos) {
  return pagina.evaluate(
    async ({ archivos, prefijo, marcas }) => {
      const base = new URL('./', location.href).href;
      const nombre = (await caches.keys()).find(
        (n) => n.startsWith(`${prefijo}${base}:`) && !n.endsWith(':provisional') && !n.endsWith(':reparacion'),
      );
      const copia = await caches.open(nombre);
      const marcados = [];
      for (const archivo of archivos) {
        const direccion = new URL(archivo, base).href;
        const guardada = await copia.match(direccion);
        const marca = Object.entries(marcas).find(([fin]) => archivo.endsWith(fin))?.[1];
        if (guardada && marca) {
          await copia.put(direccion, new Response(`${await guardada.text()}${marca}`, { headers: guardada.headers }));
          marcados.push(archivo);
        }
      }
      return marcados;
    },
    { archivos, prefijo: PREFIJO_DE_LAS_COPIAS, marcas: MARCA_EN_LA_COPIA },
  );
}

/**
 * Lo que hay en la copia de la web: las copias de esta web (sin provisionales), las provisionales de una reparación
 * con sus entradas (y lo guardado en ellas, como lo pide el servidor), si el motor sigue alterado y cuáles de
 * `marcados` conservan su marca.
 */
function laCopia(pagina, rutaDelMotor, caso, marcados = []) {
  return pagina.evaluate(
    async ({ ruta, prefijo, texto, marcados, marcas }) => {
      const base = new URL('./', location.href).href;
      const deLaWeb = (await caches.keys()).filter((n) => n.startsWith(`${prefijo}${base}:`));
      const copias = deLaWeb.filter((n) => !n.endsWith(':provisional') && !n.endsWith(':reparacion'));
      const provisionales = {};
      const enLaProvisional = [];
      for (const nombre of deLaWeb.filter((n) => n.endsWith(':reparacion'))) {
        const claves = await (await caches.open(nombre)).keys();
        provisionales[nombre.slice(base.length + prefijo.length)] = claves.length;
        enLaProvisional.push(...claves.map((peticion) => `web/${peticion.url.slice(base.length)}`));
      }
      const copia = copias.length === 1 ? await caches.open(copias[0]) : null;
      const motor = await copia?.match(new URL(ruta.slice(1), base).href);
      const conMarca = [];
      for (const archivo of marcados) {
        const marca = Object.entries(marcas).find(([fin]) => archivo.endsWith(fin))?.[1];
        const guardada = await copia?.match(new URL(archivo, base).href);
        if (guardada && (await guardada.text()).endsWith(marca)) {
          conMarca.push(archivo);
        }
      }
      return {
        copias: copias.length,
        provisionales,
        enLaProvisional,
        motorAlterado: motor ? (await motor.text()).endsWith(texto) : null,
        conMarca,
      };
    },
    { ruta: rutaDelMotor, prefijo: PREFIJO_DE_LAS_COPIAS, texto: anadido(caso), marcados, marcas: MARCA_EN_LA_COPIA },
  );
}

/** Las copias del paquete de datos (faro-paquete-*): cada nombre con su número de entradas. */
function lasDelPaquete(pagina) {
  return pagina.evaluate(async () => {
    const nombres = (await caches.keys()).filter((nombre) => nombre.startsWith('faro-paquete-')).sort();
    return Object.fromEntries(
      await Promise.all(nombres.map(async (nombre) => [nombre, (await (await caches.open(nombre)).keys()).length])),
    );
  });
}

/**
 * La persona escribe su primer mensaje con el motor alterado: cuánto tarda Faro en decir que no puede usar el motor, si
 * lo vuelve a pedir después y qué queda en la conversación.
 */
async function observarElAviso(pagina, fixture, rutaDelMotor, textos) {
  await pagina.locator('#mensaje').fill(PRIMER_MENSAJE);
  const inicio = Date.now();
  await pagina.locator('#mensaje').press('Enter');
  const avisoEnMs = await pagina
    .waitForFunction(
      (buscados) => buscados.some((texto) => document.querySelector('#conversacion')?.textContent?.includes(texto)),
      textos,
      { timeout: AVISO_MS },
    )
    .then(
      () => Date.now() - inicio,
      () => null,
    );
  const servidaAlAvisar = vecesServida(fixture, rutaDelMotor);
  await pagina.waitForTimeout(SIN_REINTENTOS_MS);
  const servidaDespues = vecesServida(fixture, rutaDelMotor);
  return { avisoEnMs, servidaAlAvisar, servidaDespues, ...(await loQueQueda(pagina)) };
}

/** Lo que entrega a la página la dirección del motor: el service worker, si hay uno activo, o el servidor. */
async function loQueEntrega(pagina, rutaDelMotor) {
  const r = await pagina.evaluate(async (direccion) => {
    const respuesta = await fetch(direccion);
    return { estado: respuesta.status, cuerpo: await respuesta.text() };
  }, rutaDelMotor);
  return { estado: r.estado, cuerpo: recortar(r.cuerpo) };
}

/**
 * El motor alterado en el servidor antes de la primera visita: la instalación del service worker falla, Faro lo dice y
 * no reintenta, y no queda nada guardado. Después se repone el motor correcto y se vuelve a abrir el recorrido: la
 * instalación y el recorrido funcionan.
 */
async function probarAlInstalar(pagina, fixture, estado) {
  const rutaDelMotor = `/${MOTOR.slice('web/'.length)}`;
  await pagina.locator('#conversacion .rc-mensaje').first().waitFor({ timeout: PLAZO_MS });
  const aviso = await observarElAviso(pagina, fixture, rutaDelMotor, AVISO_DE_LA_INSTALACION);
  const guardado = await loGuardado(pagina);
  estado.alterado = false;
  assert.equal((await pagina.goto(`${fixture.origen}/recorrido.html`))?.status(), ESTADO_HTTP.correcto);
  await pagina.locator('#conversacion .rc-mensaje').first().waitFor({ timeout: PLAZO_MS });
  const serviceWorker = await esperarServiceWorkerActivado(pagina).catch((error) => String(error).split('\n')[0]);
  const respuesta = await primerMensaje(pagina).then(
    (texto) => ({ respondio: true, texto: recortar(texto) }),
    (error) => ({ respondio: false, texto: recortar(String(error).split('\n')[0]) }),
  );
  return { ...aviso, guardado, repuesto: { serviceWorker, ...respuesta, guardado: await loGuardado(pagina) } };
}

/**
 * Con el service worker activo y los datos de la persona guardados (una marca en localStorage, sus preferencias y una
 * marca en IndexedDB), el motor responde una vez con la copia buena (así la copia del paquete de datos ya está
 * guardada) y después se alteran en la copia el motor y, con una marca, los primeros archivos de lo imprescindible
 * (`primeros`). La página queda lista para recargarse: acepta la pregunta del navegador al salir.
 */
async function prepararLaCopiaAlterada(pagina, caso, primeros) {
  const rutaDelMotor = `/${MOTOR.slice('web/'.length)}`;
  await pagina.locator('#conversacion .rc-mensaje').first().waitFor({ timeout: PLAZO_MS });
  const serviceWorker = await esperarServiceWorkerActivado(pagina);
  await pagina.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: PLAZO_MS });
  const datosAntes = await datosDePrueba(pagina);
  await primerMensaje(pagina);
  const paquetesAntes = await lasDelPaquete(pagina);
  const copia = await alterarLaCopia(pagina, rutaDelMotor, caso);
  const marcados = await marcarEnLaCopia(pagina, primeros);
  responderALosDialogos(pagina, 'aceptar');
  return { serviceWorker, copia, datosAntes, paquetesAntes, marcados };
}

/** Lo que queda al final de una reparación que ha salido bien: los datos, la copia y la del paquete. */
async function alTerminar(pagina, rutaDelMotor, caso, marcados) {
  return {
    datosDespues: await datosDePrueba(pagina, true),
    paquetesDespues: await lasDelPaquete(pagina),
    copiaDespues: await laCopia(pagina, rutaDelMotor, caso, marcados),
  };
}

/**
 * El motor alterado en la copia guardada del dispositivo (prepararLaCopiaAlterada): el service worker lo rechaza (500),
 * Faro lo dice, no reintenta y ofrece «Reparar Faro». Al pulsarlo, según `variante`:
 * - «reparar»: el servidor entrega el motor correcto; la página se recarga, la conversación vuelve a empezar y el
 *   recorrido funciona, con todo lo imprescindible repuesto;
 * - «servidor»: el servidor también entrega un motor que no es de esta versión: Faro dice que no ha podido repararse,
 *   ofrece volver a intentarlo, no recarga y la conversación sigue;
 * - «red»: la red se corta cuando la reparación ya ha bajado DEJA_PASAR archivos: lo mismo, con su aviso, y la copia
 *   sigue entera como estaba (todo o nada), con lo ya bajado en la provisional; al volver la red, «Volver a
 *   intentarlo» repara bajando solo lo que faltaba;
 * - «cierre»: la página se cierra en plena reparación y se abre otra: el recorrido funciona, o se vuelve a ofrecer
 *   «Reparar Faro» y, al pulsarlo, funciona;
 * - «pestanas»: dos pestañas piden la reparación a la vez: las dos terminan bien, con una sola copia y sin provisional;
 * - «rechazar»: la persona rechazaría la pregunta del navegador al salir: tras la reparación, la página se recarga igual
 *   (no se queda en «Faro ya está reparado.»);
 * - «informe»: la página se abre con un resultado recibido de otro dispositivo: el informe no se puede rehacer, Faro
 *   ofrece «Reparar Faro» y, al pulsarlo, repara y el resultado se vuelve a abrir;
 * - «otra»: el servidor entrega una página de lo imprescindible de otra versión: la reparación dice que no coincide y la
 *   copia sigue entera como estaba, con lo ya bajado en la provisional; con el servidor bien, «Volver a intentarlo»
 *   repara bajando solo lo que faltaba.
 * En todos, los datos de la persona y la copia del paquete siguen.
 */
async function probarLaCopia(pagina, fixture, { caso, estado, variante, primeros }) {
  const rutaDelMotor = `/${MOTOR.slice('web/'.length)}`;
  const preparada = await prepararLaCopiaAlterada(pagina, caso, primeros);
  if (variante === 'informe') {
    return { ...preparada, ...(await probarElInformeRecibido(pagina, fixture, { caso, preparada })) };
  }
  await pagina.reload();
  await pagina.locator('#conversacion .rc-mensaje').first().waitFor({ timeout: PLAZO_MS });
  const aviso = await observarElAviso(pagina, fixture, rutaDelMotor, AVISO_DE_LA_COPIA);
  const desdeElServiceWorker = await loQueEntrega(pagina, rutaDelMotor);
  const base = { ...preparada, ...aviso, desdeElServiceWorker };
  if (variante === 'reparar') {
    const reparar = await pulsarLaSugerencia(pagina, true);
    const tras = await trasReparar(pagina);
    return { ...base, reparar, tras, ...(await alTerminar(pagina, rutaDelMotor, caso, preparada.marcados)) };
  }
  if (variante === 'servidor' || variante === 'red' || variante === 'otra') {
    return { ...base, ...(await probarElFallo(pagina, { caso, estado, variante, marcados: preparada.marcados })) };
  }
  if (variante === 'pestanas') {
    return { ...base, ...(await probarDosPestanas(pagina, fixture, { caso, marcados: preparada.marcados })) };
  }
  if (variante === 'rechazar') {
    const preguntas = responderALosDialogos(pagina, 'rechazar');
    const reparar = await pulsarLaSugerencia(pagina, true);
    const tras = reparar.recargada
      ? await trasReparar(pagina)
      : { diceQueRepara: await diceQueRepara(pagina), ultimoDeFaro: recortar((await ultimoDeFaro(pagina)) ?? '') };
    const final = reparar.recargada ? await alTerminar(pagina, rutaDelMotor, caso, preparada.marcados) : {};
    return { ...base, reparar, preguntas: preguntas.vistos, tras, ...final };
  }
  const cierre = await probarElCierre(pagina, fixture);
  const resultado = { ...base, ...cierre, paquetesDespues: await lasDelPaquete(cierre.paginaFinal) };
  Object.defineProperty(resultado, 'paginaFinal', { value: cierre.paginaFinal, enumerable: false });
  return resultado;
}

/**
 * «servidor» y «red»: la reparación falla (lo que llega no es de esta versión, o la red se corta cuando ya ha bajado
 * DEJA_PASAR archivos); se mira el aviso, la copia, la del paquete y los datos, y con el servidor de nuevo bien,
 * «Volver a intentarlo» repara.
 */
async function probarElFallo(pagina, { caso, estado, variante, marcados }) {
  const rutaDelMotor = `/${MOTOR.slice('web/'.length)}`;
  estado.alterado = variante === 'servidor';
  estado.otraVersion = variante === 'otra';
  if (variante === 'red') {
    void cortarOretener(estado, 'cortar');
  }
  const reparar = await pulsarLaSugerencia(pagina, false);
  const fallo = await trasFallar(pagina, variante === 'red' ? AVISO_SIN_REPARAR : AVISO_SIN_REPARAR_NO_COINCIDE);
  const servidor = estado.tras
    ? {
        servidas: estado.tras.servidas.length,
        rechazadas: estado.tras.rechazadas.length,
        primeras: estado.tras.servidas.slice(0, MARCADOS),
        marcadosServidos: marcados.filter((archivo) => estado.tras.servidas.includes(`web/${archivo}`)),
      }
    : null;
  const copiaTrasFallar = await laCopia(pagina, rutaDelMotor, caso, marcados);
  const paquetesTrasFallar = await lasDelPaquete(pagina);
  const datosTrasFallar = await datosDePrueba(pagina, true);
  const paginaDeOtraVersionEnLaCopia = await laPaginaDeOtraVersionEstaEnLaCopia(pagina);
  estado.alterado = false;
  estado.otraVersion = false;
  servirConNormalidad(estado);
  void cortarOretener(estado, 'contar');
  const reintento = await pulsarLaSugerencia(pagina, true);
  const pedidasAlReintentar = [...estado.tras.servidas];
  estado.limite = undefined;
  const tras = await trasReparar(pagina);
  return {
    reparar,
    fallo,
    servidor,
    pedidasAlReintentar,
    copiaTrasFallar,
    paquetesTrasFallar,
    datosTrasFallar,
    paginaDeOtraVersionEnLaCopia,
    reintento,
    tras,
    ...(await alTerminar(pagina, rutaDelMotor, caso, marcados)),
  };
}

/** Si la copia de la web guarda ya la página de otra versión (PAGINA_DE_OTRA_VERSION). */
function laPaginaDeOtraVersionEstaEnLaCopia(pagina) {
  return pagina.evaluate(
    async ({ prefijo, ruta, marca }) => {
      const base = new URL('./', location.href).href;
      const nombre = (await caches.keys()).find(
        (n) => n.startsWith(`${prefijo}${base}:`) && !n.endsWith(':provisional') && !n.endsWith(':reparacion'),
      );
      const guardada = nombre ? await (await caches.open(nombre)).match(new URL(ruta, base).href) : undefined;
      return guardada ? (await guardada.text()).endsWith(marca) : null;
    },
    { prefijo: PREFIJO_DE_LAS_COPIAS, ruta: PAGINA_DE_OTRA_VERSION.slice('web/'.length), marca: DE_OTRA_VERSION },
  );
}

/**
 * «pestanas»: una segunda pestaña del mismo navegador llega también al aviso, y las dos pulsan «Reparar Faro» a la
 * vez; el service worker hace una reparación detrás de otra y cada pestaña recibe la suya.
 */
async function probarDosPestanas(pagina, fixture, { caso, marcados }) {
  const rutaDelMotor = `/${MOTOR.slice('web/'.length)}`;
  const segunda = await pagina.context().newPage();
  responderALosDialogos(segunda, 'aceptar');
  assert.equal((await segunda.goto(`${fixture.origen}/recorrido.html`))?.status(), ESTADO_HTTP.correcto);
  await segunda.locator('#conversacion .rc-mensaje').first().waitFor({ timeout: PLAZO_MS });
  const avisoDeLaSegunda = await observarElAviso(segunda, fixture, rutaDelMotor, AVISO_DE_LA_COPIA);
  const [reparar, repararLaSegunda] = await Promise.all([
    pulsarLaSugerencia(pagina, true),
    pulsarLaSugerencia(segunda, true),
  ]);
  await pagina.bringToFront();
  const tras = await trasReparar(pagina);
  await segunda.bringToFront();
  const trasLaSegunda = await trasReparar(segunda);
  return {
    avisoDeLaSegunda: { sugerencias: avisoDeLaSegunda.sugerencias, avisoEnMs: avisoDeLaSegunda.avisoEnMs },
    reparar,
    repararLaSegunda,
    tras,
    trasLaSegunda,
    datosDeLaSegunda: await datosDePrueba(segunda, true),
    ...(await alTerminar(pagina, rutaDelMotor, caso, marcados)),
  };
}

/**
 * «informe»: la página se abre con un resultado de otro dispositivo (#pasar=<código>, otro-dispositivo/recibir.js);
 * con la copia del motor alterada, el informe no se puede rehacer: Faro lo dice con el aviso de la copia y ofrece
 * «Reparar Faro»; al pulsarlo, repara y la página se vuelve a abrir con el mismo resultado, que el motor ya puede
 * rehacer, y el código vuelve a salir de la barra.
 */
async function probarElInformeRecibido(pagina, fixture, { caso, preparada }) {
  const rutaDelMotor = `/${MOTOR.slice('web/'.length)}`;
  const codigo = codificar({
    idioma: 'es',
    isco08: '8331',
    fecha: new Date().toISOString().slice(0, 10),
    tareas: [{ tareaOit: '8331-1', tiempo: 'algo' }],
    sinViajar: 0,
  });
  // Desde otra página: a la misma, solo con otro fragmento, el navegador no la volvería a cargar.
  await pagina.goto('about:blank');
  assert.equal((await pagina.goto(`${fixture.origen}/recorrido.html#pasar=${codigo}`))?.status(), ESTADO_HTTP.correcto);
  const aviso = await llegaElAviso(pagina, AVISO_DE_LA_COPIA);
  const sugerencias = await pagina.locator('#sugerencias:not([hidden]) .rc-sugerencia:visible').allTextContents();
  const informe = {
    aviso,
    sugerencias: sugerencias.map((texto) => texto.trim()),
    ultimoDeFaro: recortar((await ultimoDeFaro(pagina)) ?? ''),
  };
  const historialAntes = await pagina.evaluate(() => history.length);
  const reparar = await pulsarLaSugerencia(pagina, true);
  const tras = {
    historial: { antes: historialAntes, despues: await pagina.evaluate(() => history.length) },
    reabierto: await llegaElAviso(pagina, RESULTADO_RECIBIDO),
    fragmento: await pagina.evaluate(() => location.hash),
    ultimoDeFaro: recortar((await ultimoDeFaro(pagina)) ?? ''),
    guardado: await loGuardado(pagina),
  };
  return { informe, reparar, tras, ...(await alTerminar(pagina, rutaDelMotor, caso, preparada.marcados)) };
}

/**
 * «cierre»: se pulsa «Reparar Faro» y se cierra la página sin esperar; después, una página nueva del mismo navegador.
 * Devuelve también esa página (`paginaFinal`, que no va al registro) para las comprobaciones que siguen.
 */
async function probarElCierre(pagina, fixture) {
  const reparar = await pulsarLaSugerencia(pagina, false);
  const contexto = pagina.context();
  await pagina.close();
  const nueva = await contexto.newPage();
  responderALosDialogos(nueva, 'aceptar');
  await nueva.goto(`${fixture.origen}/recorrido.html`);
  await nueva.locator('#conversacion .rc-mensaje').first().waitFor({ timeout: PLAZO_MS });
  const primeraVez = await primerMensaje(nueva, AVISO_MS).then(
    () => 'responde',
    async () => ((await llegaElAviso(nueva, AVISO_DE_LA_COPIA)) ? 'ofrece-reparar' : 'ni-responde-ni-avisa'),
  );
  const segunda = primeraVez === 'ofrece-reparar' ? await pulsarLaSugerencia(nueva, true) : null;
  const tras =
    primeraVez === 'responde' ? { respondio: true, guardado: await loGuardado(nueva) } : await trasReparar(nueva);
  const datosDespues = await datosDePrueba(nueva, true);
  const resultado = { reparar, primeraVez, segunda, tras, datosDespues };
  Object.defineProperty(resultado, 'paginaFinal', { value: nueva, enumerable: false });
  return resultado;
}

/** Lo que el service worker cuenta a la página, para saber por dónde le llega cada respuesta y cada aviso. */
function contarLosAvisosDelServiceWorker() {
  globalThis.__avisosDelServiceWorker = [];
  navigator.serviceWorker?.addEventListener('message', ({ data }) => {
    globalThis.__avisosDelServiceWorker.push(data?.type);
  });
}

/** El perfil persistente del ensayo (abrirPerfil), con las preferencias del recorrido y los avisos anotados. */
async function abrirElPerfilDelEnsayo(motor, carpeta, origen) {
  const contexto = await abrirPerfil(motor, carpeta, origen);
  await contexto.addInitScript(preferenciasDelRecorrido);
  await contexto.addInitScript(contarLosAvisosDelServiceWorker);
  return contexto;
}

/** La página de un perfil recién abierto, con su consola anotada en `consola`. */
async function paginaDelPerfil(contexto, consola) {
  const pagina = contexto.pages()[0] ?? (await contexto.newPage());
  pagina.on('console', (m) => consola.push(recortar(`${m.type()}: ${m.text()}`)));
  pagina.on('pageerror', (e) => consola.push(recortar(`pageerror: ${String(e)}`)));
  return pagina;
}

/**
 * «interrupcion»: el propio service worker se detiene a mitad de la reparación. Con un perfil persistente, se pulsa
 * «Reparar Faro»; el servidor entrega DEJA_PASAR archivos y retiene el siguiente sin completarlo nunca, y con la
 * reparación así, a medias, se cierra el navegador entero (no una pestaña: el service worker se detiene con él). Se
 * vuelve a abrir el mismo perfil y se mira que la copia anterior (con el motor alterado y las marcas), la del paquete y
 * los datos siguen, y lo ya bajado también, en la provisional; que se vuelve a ofrecer «Reparar Faro», y que la
 * reparación termina bien, con una sola copia y sin provisional.
 */
async function probarLaInterrupcion({ motor, artefacto, caso, primeros }) {
  const estado = { alterado: false };
  const fixture = await crearFixture(conAlteracion(artefacto, MOTOR, caso.caso, estado));
  const carpeta = mkdtempSync(join(realpathSync(tmpdir()), `faro-interrumpido-${motor}-`));
  mkdirSync(join(carpeta, 'app'));
  mkdirSync(join(carpeta, 'cache'));
  const sesion = { motor, carpeta, fixture, estado, caso: caso.caso, consola: [], contexto: null };
  try {
    const antes = await interrumpirLaReparacion(sesion, primeros);
    const despues = await volverAAbrir(sesion, antes.marcados);
    return {
      caso: caso.caso,
      ruta: MOTOR,
      ...antes,
      ...despues,
      consola: sesion.consola.filter((linea) => /integrity|digest|integridad|huella|comprobad|motor/iu.test(linea)),
    };
  } finally {
    servirConNormalidad(estado);
    await sesion.contexto?.close();
    await fixture.cerrar();
    rmSync(carpeta, { recursive: true, force: true });
  }
}

/**
 * La primera parte de «interrupcion»: con el perfil abierto, la copia alterada y el aviso, se pulsa «Reparar Faro», se
 * espera a que el servidor retenga una petición de la reparación y se cierra el navegador entero.
 */
async function interrumpirLaReparacion(sesion, primeros) {
  const { motor, carpeta, fixture, estado, caso, consola } = sesion;
  const rutaDelMotor = `/${MOTOR.slice('web/'.length)}`;
  sesion.contexto = await abrirElPerfilDelEnsayo(motor, carpeta, fixture.origen);
  const pagina = await paginaDelPerfil(sesion.contexto, consola);
  assert.equal((await pagina.goto(`${fixture.origen}/recorrido.html`))?.status(), ESTADO_HTTP.correcto);
  const preparada = await prepararLaCopiaAlterada(pagina, caso, primeros);
  await pagina.reload();
  await pagina.locator('#conversacion .rc-mensaje').first().waitFor({ timeout: PLAZO_MS });
  const aviso = await observarElAviso(pagina, fixture, rutaDelMotor, AVISO_DE_LA_COPIA);
  const desdeElServiceWorker = await loQueEntrega(pagina, rutaDelMotor);
  const retenida = cortarOretener(estado, 'retener');
  const reparar = await pulsarLaSugerencia(pagina, false);
  const llegoALaRetenida = await Promise.race([retenida.then(() => true), esperar(PLAZO_MS, false, { ref: false })]);
  const antesDelCierre = {
    llegoALaRetenida,
    servidas: estado.tras.servidas.length,
    retenidas: estado.tras.retenidas.length,
    respuestas: await pagina.evaluate(
      () => globalThis.__avisosDelServiceWorker.filter((tipo) => tipo === 'COPIA_REPARADA').length,
    ),
    diceQueRepara: await diceQueRepara(pagina),
    copia: await laCopia(pagina, rutaDelMotor, caso, preparada.marcados),
  };
  const marcadosServidos = preparada.marcados.filter((archivo) => estado.tras.servidas.includes(`web/${archivo}`));
  await sesion.contexto.close();
  sesion.contexto = null;
  // Lo retenido no se llegó a entregar: se suelta ya con el navegador cerrado.
  const retenidasSinCompletar = estado.tras.retenidas.length;
  servirConNormalidad(estado);
  return {
    ...preparada,
    ...aviso,
    desdeElServiceWorker,
    reparar,
    antesDelCierre,
    marcadosServidos,
    retenidasSinCompletar,
  };
}

/**
 * La segunda parte de «interrupcion»: el mismo perfil, otra vez abierto. Lo que sigue guardado, el aviso, y la
 * reparación hasta el final.
 */
async function volverAAbrir(sesion, marcados) {
  const { motor, carpeta, fixture, caso, consola } = sesion;
  const rutaDelMotor = `/${MOTOR.slice('web/'.length)}`;
  sesion.contexto = await abrirElPerfilDelEnsayo(motor, carpeta, fixture.origen);
  const pagina = await paginaDelPerfil(sesion.contexto, consola);
  responderALosDialogos(pagina, 'aceptar');
  // Un navegador recién abierto aún no tiene la credencial Basic del fixture, y la navegación al recorrido la pide el
  // service worker en su nombre, sin poder contestar a la pregunta del servidor. Antes, desde un archivo de la raíz que
  // el service worker no atiende (fuera de la copia, rutaFueraDeLaCopia), la página pide el recorrido sin navegar
  // (tampoco lo atiende): el navegador contesta con la credencial y la recuerda para todo el origen. El estado del
  // archivo no se mira: según el navegador, esa primera respuesta es aún la pregunta del servidor (401).
  await pagina.goto(`${fixture.origen}/llms.txt`);
  assert.equal(await pagina.evaluate(async () => (await fetch('/recorrido.html')).status), ESTADO_HTTP.correcto);
  assert.equal((await pagina.goto(`${fixture.origen}/recorrido.html`))?.status(), ESTADO_HTTP.correcto);
  await pagina.locator('#conversacion .rc-mensaje').first().waitFor({ timeout: PLAZO_MS });
  const alVolver = {
    copia: await laCopia(pagina, rutaDelMotor, caso, marcados),
    paquetes: await lasDelPaquete(pagina),
    datos: await datosDePrueba(pagina, true),
  };
  const avisoAlVolver = await observarElAviso(pagina, fixture, rutaDelMotor, AVISO_DE_LA_COPIA);
  const reintento = await pulsarLaSugerencia(pagina, true);
  const tras = await trasReparar(pagina);
  const marcas = await pagina.evaluate(() => globalThis.__faroAlterado ?? []);
  return {
    alVolver,
    avisoAlVolver: { sugerencias: avisoAlVolver.sugerencias, avisoEnMs: avisoAlVolver.avisoEnMs },
    reintento,
    tras,
    ...(await alTerminar(pagina, rutaDelMotor, caso, marcados)),
    ejecutada: marcas.includes(caso) || fixture.peticiones.some((p) => p.ruta === `/__alterado/${caso}`),
    servida: fixture.peticiones.some((p) => p.ruta === rutaDelMotor),
  };
}

/** Los archivos de datos del paquete publicado, sin su manifiesto, como los pide el servidor (conElPaqueteRetenido). */
const DATOS_DEL_PAQUETE = /^web\/paquete\/[0-9a-f]{16}\/(?!manifiesto\.json$)[a-z0-9-]+\.json$/u;
/** Cuántos archivos de datos del paquete entrega el servidor antes de retener los siguientes: unos pocos de sus 37. */
const DEJA_PASAR_DEL_PAQUETE = 10;

/**
 * La misma construcción, con la copia del paquete parada a mitad según `estado.modo`: el servidor entrega
 * DEJA_PASAR_DEL_PAQUETE archivos de datos del paquete y, de los siguientes, con «retener», solo la primera mitad, sin
 * acabarlos nunca, como descargas en curso; con «pausar», nada hasta soltarlos (soltarElPaquete), y entonces enteros.
 * Lo entregado y lo retenido quedan en `estado`; sin modo, todo se sirve como siempre.
 */
function conElPaqueteRetenido(artefacto, estado) {
  const leer = (pedida) => {
    const bytes = artefacto.leer(pedida);
    if (!estado.modo || !DATOS_DEL_PAQUETE.test(pedida)) {
      return bytes;
    }
    if (estado.servidos.length < DEJA_PASAR_DEL_PAQUETE) {
      estado.servidos.push(pedida);
      return bytes;
    }
    estado.retenidos.push(pedida);
    estado.alRetener();
    const retener = estado.modo === 'retener';
    return new ReadableStream({
      start: (controlador) => {
        if (retener) {
          controlador.enqueue(new Uint8Array(bytes.subarray(0, Math.floor(bytes.length / 2))));
        }
        estado.controladores.push({ controlador, bytes, retener });
      },
    });
  };
  return { ...artefacto, leer };
}

/**
 * Deja de parar el paquete (conElPaqueteRetenido): lo pausado se entrega entero, y lo retenido a medias acaba con un
 * error, como una descarga cortada.
 */
function soltarElPaquete(estado) {
  estado.modo = null;
  for (const { controlador, bytes, retener } of estado.controladores.splice(0)) {
    if (retener) {
      controlador.error(new Error('Fin del ensayo'));
    } else {
      controlador.enqueue(new Uint8Array(bytes));
      controlador.close();
    }
  }
}

/** Lo que guarda la copia del paquete: sus nombres de copia, el nombre de cada archivo y si está su manifiesto. */
function laCopiaDelPaquete(pagina) {
  return pagina.evaluate(async () => {
    const copias = (await caches.keys()).filter((nombre) => nombre.startsWith('faro-paquete-'));
    const claves = copias.length === 1 ? await (await caches.open(copias[0])).keys() : [];
    const archivos = claves.map((clave) => new URL(clave.url).pathname.split('/').at(-1)).sort();
    return { copias, archivos, conManifiesto: archivos.includes('manifiesto.json') };
  });
}

/** La base de una huella escrita en hexadecimal y sus cifras por byte. */
const HEXADECIMAL = { base: 16, cifras: 2 };

/**
 * Los archivos del manifiesto de la copia completa del paquete que faltan o no cuadran con su huella, calculada en la
 * página como la calcula el service worker, y cuántos nombra.
 */
function loQueNoCuadra(pagina) {
  return pagina.evaluate(async ({ base, cifras }) => {
    const [nombre] = (await caches.keys()).filter((n) => n.startsWith('faro-paquete-'));
    const copia = await caches.open(nombre);
    const manifiesto = (await copia.keys()).find((clave) => clave.url.endsWith('/manifiesto.json'));
    const entradas = Object.entries(await (await copia.match(manifiesto)).json());
    const noCuadran = [];
    for (const [archivo, { sha256 }] of entradas) {
      const guardado = await copia.match(new URL(archivo, manifiesto.url).href);
      const bytes = guardado ? new Uint8Array(await crypto.subtle.digest('SHA-256', await guardado.arrayBuffer())) : [];
      const huella = Array.from(bytes, (byte) => byte.toString(base).padStart(cifras, '0')).join('');
      if (huella !== sha256) {
        noCuadran.push(archivo);
      }
    }
    return { delManifiesto: entradas.length, noCuadran };
  }, HEXADECIMAL);
}

/**
 * Lo que el servidor ha entregado de cada archivo del paquete desde la petición `desde` (fixture.peticiones): su ruta,
 * cuántas veces y los bytes servidos. El fixture no comprime: lo servido son los bytes sin comprimir del archivo.
 */
function descargasDelPaquete(fixture, artefacto, desde = 0) {
  const descargas = {};
  for (const { ruta } of fixture.peticiones.slice(desde)) {
    if (ruta.startsWith('/paquete/')) {
      const archivo = ruta.split('/').at(-1);
      const anterior = descargas[archivo] ?? { ruta, veces: 0, bytesServidos: 0 };
      const bytes = artefacto.leer(`web${ruta}`).length;
      descargas[archivo] = { ...anterior, veces: anterior.veces + 1, bytesServidos: anterior.bytesServidos + bytes };
    }
  }
  return descargas;
}

/** Por qué se vuelve a pedir un archivo del paquete al reabrir, según cómo quedó al cerrar (cerrarConElPaqueteAMedias). */
function motivoDeLaDescarga(archivo, antes) {
  if (archivo === 'manifiesto.json') {
    return 'el manifiesto se pide en cada intento: se guarda el último, cuando la copia está completa';
  }
  if (antes.antesDelCierre.archivos.includes(archivo)) {
    return 'ya estaba guardado y comprobado: no tendría que pedirse';
  }
  return antes.retenidos.includes(archivo)
    ? 'se quedó a medias al cerrar: no se guardó y se baja entero'
    : 'no se había empezado a bajar';
}

/** Cada cuánto se vuelve a mirar la copia mientras se espera (hastaQue). */
const CADA_MS = 500;

/** Espera, mirándolo cada CADA_MS hasta PLAZO_MS, a que se cumpla `comprobar`; devuelve lo último que ha leído. */
async function hastaQue(leer, comprobar) {
  const hasta = Date.now() + PLAZO_MS;
  let leido = await leer();
  while (!comprobar(leido) && Date.now() < hasta) {
    await esperar(CADA_MS);
    leido = await leer();
  }
  return leido;
}

/**
 * «paquete-interrumpido»: la copia del paquete de datos se interrumpe con el navegador entero cerrado a mitad. Con un
 * perfil persistente se abre Faro; el servidor entrega DEJA_PASAR_DEL_PAQUETE archivos del paquete y retiene los
 * siguientes a medias (conElPaqueteRetenido). Cuando lo entregado está guardado, se cierra el navegador. Al volver a
 * abrir el mismo perfil, la página vuelve a pedir la copia y esta sigue donde se quedó: lo guardado no se vuelve a
 * pedir, lo que estaba a medias no se guardó, y al final cada archivo de la copia cuadra con su manifiesto.
 */
async function probarElPaqueteInterrumpido({ motor, artefacto }) {
  const retenido = Promise.withResolvers();
  const estado = { modo: 'retener', servidos: [], retenidos: [], controladores: [], alRetener: retenido.resolve };
  const fixture = await crearFixture(conElPaqueteRetenido(artefacto, estado));
  const carpeta = mkdtempSync(join(realpathSync(tmpdir()), `faro-paquete-interrumpido-${motor}-`));
  mkdirSync(join(carpeta, 'app'));
  mkdirSync(join(carpeta, 'cache'));
  const sesion = { motor, carpeta, fixture, estado, retenido: retenido.promise, consola: [], contexto: null };
  try {
    const antes = await cerrarConElPaqueteAMedias(sesion);
    const despues = await volverAlPaquete(sesion, artefacto);
    const otraVez = Object.entries(despues.descargasAlVolver).map(([archivo, descarga]) => ({
      archivo,
      ...descarga,
      motivo: motivoDeLaDescarga(archivo, antes),
    }));
    return {
      caso: 'paquete-interrumpido',
      ...antes,
      ...despues,
      conservados: { cuantos: antes.antesDelCierre.archivos.length, cuales: antes.antesDelCierre.archivos },
      otraVez,
      ejecutada: fixture.peticiones.some((p) => p.ruta.startsWith('/__alterado/')),
      consola: sesion.consola.filter((linea) => /paquete|copia|huella|error/iu.test(linea)),
    };
  } finally {
    soltarElPaquete(estado);
    await sesion.contexto?.close();
    await fixture.cerrar();
    rmSync(carpeta, { recursive: true, force: true });
  }
}

/**
 * La primera parte de «paquete-interrumpido»: abre Faro, espera a que el servidor retenga el paquete y a que lo
 * entregado esté guardado, y cierra el navegador entero. Lo retenido se suelta ya con el navegador cerrado.
 */
async function cerrarConElPaqueteAMedias(sesion) {
  const { motor, carpeta, fixture, estado } = sesion;
  sesion.contexto = await abrirElPerfilDelEnsayo(motor, carpeta, fixture.origen);
  const pagina = await paginaDelPerfil(sesion.contexto, sesion.consola);
  assert.equal((await pagina.goto(`${fixture.origen}/inicio.html`))?.status(), ESTADO_HTTP.correcto);
  const llegoALoRetenido = await Promise.race([
    sesion.retenido.then(() => true),
    esperar(PLAZO_MS, false, { ref: false }),
  ]);
  const antesDelCierre = await hastaQue(
    () => laCopiaDelPaquete(pagina),
    (copia) => copia.archivos.length >= estado.servidos.length,
  );
  const retenidos = estado.retenidos.map((ruta) => ruta.split('/').at(-1));
  await sesion.contexto.close();
  sesion.contexto = null;
  soltarElPaquete(estado);
  return { llegoALoRetenido, servidos: estado.servidos.length, retenidos, antesDelCierre };
}

/**
 * La segunda parte de «paquete-interrumpido»: el mismo perfil, otra vez abierto en Faro, hasta que la copia del paquete
 * tiene su manifiesto; lo que se ha pedido al servidor desde entonces y si cada archivo cuadra.
 */
async function volverAlPaquete(sesion, artefacto) {
  const { motor, carpeta, fixture } = sesion;
  const desde = fixture.peticiones.length;
  sesion.contexto = await abrirElPerfilDelEnsayo(motor, carpeta, fixture.origen);
  const pagina = await paginaDelPerfil(sesion.contexto, sesion.consola);
  // La credencial Basic del fixture y la página, como al volver a abrir en «interrupcion» (volverAAbrir).
  await pagina.goto(`${fixture.origen}/llms.txt`);
  assert.equal(await pagina.evaluate(async () => (await fetch('/recorrido.html')).status), ESTADO_HTTP.correcto);
  assert.equal((await pagina.goto(`${fixture.origen}/recorrido.html`))?.status(), ESTADO_HTTP.correcto);
  const copia = await hastaQue(
    () => laCopiaDelPaquete(pagina),
    (leida) => leida.conManifiesto,
  );
  const alVolver = { ...copia, ...(copia.conManifiesto ? await loQueNoCuadra(pagina) : {}) };
  return { alVolver, descargasAlVolver: descargasDelPaquete(fixture, artefacto, desde) };
}

/**
 * «paquete-interrumpido»: se cerró a mitad (había archivos guardados y otros a medias, sin manifiesto); al volver, la
 * copia está completa y cuadra con su manifiesto, lo guardado no se volvió a pedir y lo que faltaba se pidió una vez.
 */
function comprobarElPaqueteInterrumpido(r) {
  const { antesDelCierre: antes, alVolver } = r;
  assert.ok(r.llegoALoRetenido && r.retenidos.length > 0, 'El navegador se cierra con descargas del paquete a medias');
  assert.equal(antes.conManifiesto, false, 'Al cerrar, la copia del paquete está a medias');
  assert.ok(antes.archivos.length >= DEJA_PASAR_DEL_PAQUETE, `Al cerrar hay archivos guardados: ${antes.archivos}`);
  assert.deepEqual(
    r.retenidos.filter((archivo) => antes.archivos.includes(archivo)),
    [],
    'Lo que se quedó a medias no entra en la copia',
  );
  assert.equal(alVolver.conManifiesto, true, 'Al volver, la copia se completa');
  assert.deepEqual(alVolver.noCuadran, [], 'Cada archivo de la copia cuadra con su manifiesto');
  assert.equal(alVolver.archivos.length, alVolver.delManifiesto + 1, 'La copia tiene sus archivos y su manifiesto');
  const otraVez = antes.archivos.filter((archivo) => r.descargasAlVolver[archivo]);
  assert.deepEqual(otraVez, [], 'Lo guardado antes del cierre no se vuelve a pedir');
  const faltaban = alVolver.archivos.filter((archivo) => !antes.archivos.includes(archivo));
  assert.deepEqual(
    faltaban.filter((archivo) => r.descargasAlVolver[archivo]?.veces !== 1),
    [],
    `Lo que faltaba se pide una vez: ${JSON.stringify(r.otraVez)}`,
  );
}

/** Cuenta en la página las veces que pide la copia del paquete a su service worker (PREPARAR_PAQUETE), latido incluido. */
function contarLasPeticionesDelPaquete() {
  globalThis.__peticionesDelPaquete = 0;
  if (typeof ServiceWorker === 'undefined') {
    return;
  }
  const enviar = ServiceWorker.prototype.postMessage;
  ServiceWorker.prototype.postMessage = function (mensaje, ...resto) {
    if (mensaje?.type === 'PREPARAR_PAQUETE') {
      globalThis.__peticionesDelPaquete += 1;
    }
    return enviar.call(this, mensaje, ...resto);
  };
}

/** Lo que espera una página hasta que el service worker le cuenta cómo ha quedado la copia del paquete. */
const hastaElEstadoDelPaquete = (pagina) =>
  pagina.waitForFunction(() => globalThis.__avisosDelServiceWorker.includes('ESTADO_DEL_PAQUETE'), undefined, {
    timeout: PLAZO_MS,
  });

/**
 * «paquete-dos-pestanas»: dos pestañas de Faro piden la copia del paquete mientras se prepara. La primera abre Faro;
 * el servidor entrega DEJA_PASAR_DEL_PAQUETE archivos y pausa los siguientes (conElPaqueteRetenido); con la copia así,
 * a medias, se abre la segunda y se espera a que también la pida. Al soltar el paquete, las dos reciben cómo ha
 * quedado y el registro del servidor dice cuántas veces se ha pedido cada archivo. La pausa es mucho más corta que el
 * plazo con que el service worker corta una descarga parada (DESCARGA_PARADA_MS, 20 s).
 */
async function probarElPaqueteEnDosPestanas({ navegador, artefacto }) {
  const pausado = Promise.withResolvers();
  const estado = { modo: 'pausar', servidos: [], retenidos: [], controladores: [], alRetener: pausado.resolve };
  const fixture = await crearFixture(conElPaqueteRetenido(artefacto, estado));
  const contexto = await contextoDelRecorrido(navegador, fixture.origen);
  try {
    await contexto.addInitScript(contarLosAvisosDelServiceWorker);
    await contexto.addInitScript(contarLasPeticionesDelPaquete);
    const primera = await contexto.newPage();
    assert.equal((await primera.goto(`${fixture.origen}/inicio.html`))?.status(), ESTADO_HTTP.correcto);
    const pausada = await Promise.race([pausado.promise.then(() => true), esperar(PLAZO_MS, false, { ref: false })]);
    const segunda = await contexto.newPage();
    assert.equal((await segunda.goto(`${fixture.origen}/inicio.html`))?.status(), ESTADO_HTTP.correcto);
    await segunda.waitForFunction(() => globalThis.__peticionesDelPaquete > 0, undefined, { timeout: PLAZO_MS });
    const aMedias = await laCopiaDelPaquete(primera);
    soltarElPaquete(estado);
    await Promise.all([hastaElEstadoDelPaquete(primera), hastaElEstadoDelPaquete(segunda)]);
    const copia = await laCopiaDelPaquete(primera);
    const peticionesDeLasPestanas = await Promise.all(
      [primera, segunda].map((pagina) => pagina.evaluate(() => globalThis.__peticionesDelPaquete)),
    );
    return {
      caso: 'paquete-dos-pestanas',
      pausada,
      retenidos: estado.retenidos.length,
      aMedias,
      copia: { ...copia, ...(copia.conManifiesto ? await loQueNoCuadra(primera) : {}) },
      peticionesDeLasPestanas,
      descargas: descargasDelPaquete(fixture, artefacto),
      ejecutada: fixture.peticiones.some((p) => p.ruta.startsWith('/__alterado/')),
    };
  } finally {
    soltarElPaquete(estado);
    await contexto.close();
    await fixture.cerrar();
  }
}

/** «paquete-dos-pestanas»: las dos pidieron la copia a medias, la copia cuadra y cada archivo se pidió una sola vez. */
function comprobarElPaqueteEnDosPestanas(r) {
  assert.ok(r.pausada && r.retenidos > 0, 'El paquete se para a mitad');
  assert.equal(r.aMedias.conManifiesto, false, 'La segunda pestaña pide la copia mientras se prepara');
  assert.ok(
    r.peticionesDeLasPestanas.every((veces) => veces > 0),
    `Las dos pestañas piden la copia: ${r.peticionesDeLasPestanas}`,
  );
  assert.equal(r.copia.conManifiesto, true, 'La copia se completa');
  assert.deepEqual(r.copia.noCuadran, [], 'Cada archivo de la copia cuadra con su manifiesto');
  assert.equal(
    Object.keys(r.descargas).length,
    r.copia.delManifiesto + 1,
    'Se piden todos los archivos y el manifiesto',
  );
  const repetidos = Object.entries(r.descargas).filter(([, { veces }]) => veces !== 1);
  assert.deepEqual(repetidos, [], 'Cada archivo del paquete se pide al servidor una sola vez en total');
}

/** Sin el motor: si la conversación llega a arrancar. */
async function arrancaLaConversacion(pagina) {
  const arranca = await pagina
    .locator('#conversacion .rc-mensaje')
    .first()
    .waitFor({ timeout: ESPERA_MS })
    .then(
      () => true,
      () => false,
    );
  return { conversacion: arranca };
}

/**
 * «sin-conexion»: con la copia de esta versión guardada, sin red, la página lee lo guardado (las páginas, los estilos y
 * los primeros de lo imprescindible) con los bytes de su huella. Se anota también con qué codificación declarada quedó
 * cada entrada en la copia: con --comprimido, el servidor las entregó con Brotli o gzip.
 */
async function probarSinConexion(pagina, { primeros, huellas }) {
  await pagina.locator('#conversacion .rc-mensaje').first().waitFor({ timeout: PLAZO_MS });
  await esperarServiceWorkerActivado(pagina);
  await pagina.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: PLAZO_MS });
  const archivos = ['inicio.html', 'estilos/base.css', ...primeros].filter((archivo) => huellas.has(archivo));
  const enLaCopia = await pagina.evaluate(
    async ({ prefijo, archivos }) => {
      const base = new URL('./', location.href).href;
      const nombre = (await caches.keys()).find(
        (n) => n.startsWith(`${prefijo}${base}:`) && !n.endsWith(':provisional') && !n.endsWith(':reparacion'),
      );
      const copia = await caches.open(nombre);
      return Promise.all(
        archivos.map(async (archivo) => {
          const guardada = await copia.match(new URL(archivo, base).href);
          return { archivo, codificacion: guardada?.headers.get('content-encoding') ?? null };
        }),
      );
    },
    { prefijo: PREFIJO_DE_LAS_COPIAS, archivos },
  );
  await pagina.context().setOffline(true);
  try {
    const leidos = await pagina.evaluate(async (rutas) => {
      const HEXADECIMAL = 16;
      const hex = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(HEXADECIMAL).padStart(2, '0')).join('');
      return Promise.all(
        rutas.map(async (archivo) => {
          const respuesta = await fetch(archivo).catch((error) => ({ status: String(error), arrayBuffer: null }));
          const bytes = respuesta.arrayBuffer ? await respuesta.arrayBuffer() : new ArrayBuffer(0);
          return { archivo, estado: respuesta.status, huella: hex(await crypto.subtle.digest('SHA-256', bytes)) };
        }),
      );
    }, archivos);
    return {
      enLaCopia,
      leidos: leidos.map(({ archivo, estado, huella }) => ({
        archivo,
        estado,
        cuadra: huella === huellas.get(archivo),
      })),
    };
  } finally {
    await pagina.context().setOffline(false);
  }
}

/** «sin-conexion»: sin red, cada archivo se lee de la copia, entero y con los bytes de su huella. */
function comprobarSinConexion(r) {
  assert.ok(r.leidos.length >= 2, `Se leen varios archivos de la copia: ${JSON.stringify(r.leidos)}`);
  for (const { archivo, estado, cuadra } of r.leidos) {
    assert.equal(estado, ESTADO_HTTP.correcto, `${archivo} se sirve sin red desde la copia`);
    assert.equal(cuadra, true, `${archivo} llega con los bytes de su huella`);
  }
}

/** El servidor del presupuesto delante del fixture (--comprimido), sin latencia ni límite de bajada. */
function delanteComprimido(fixture) {
  return crearServidorDelEnsayo({
    origenDeArriba: fixture.origen,
    condicion: { latenciaMs: 0 },
    identidad: IDENTIDAD_WEB,
    bytesPorSegundo: null,
  });
}

/**
 * Las opciones del contexto detrás del servidor del ensayo: su certificado sintético y, con `--codificacion gzip`, que
 * el navegador pida solo gzip (el servidor elige Brotli si se acepta, y los tres motores lo aceptan).
 */
function opcionesDetras() {
  const gzip = opciones.codificacion === 'gzip' ? { 'accept-encoding': 'gzip' } : {};
  return { ignoreHTTPSErrors: true, extraHTTPHeaders: { ...IDENTIDAD_WEB, ...gzip } };
}

/** Cuántas respuestas del servidor del ensayo salieron con cada codificación. */
function resumenDeLaCompresion(registro) {
  const cuenta = { br: 0, gzip: 0, sinComprimir: 0 };
  for (const { codificacion } of registro) {
    cuenta[codificacion ?? 'sinComprimir'] += 1;
  }
  return cuenta;
}

/** Lo que se observa en cada caso: con el motor, cómo se recupera la página; si no, si la conversación arranca. */
function observar(caso, pagina, fixture, { estado, primeros, huellas }) {
  if (caso.motor === 'instalar') {
    return probarAlInstalar(pagina, fixture, estado);
  }
  if (caso.motor === 'sin-red') {
    return probarSinConexion(pagina, { primeros, huellas });
  }
  return caso.motor === 'copia'
    ? probarLaCopia(pagina, fixture, { caso: caso.caso, estado, variante: caso.variante, primeros })
    : arrancaLaConversacion(pagina);
}

/**
 * Los casos que abren su propia sesión del navegador (la copia del paquete y la reparación con perfil persistente), o
 * null para los demás.
 */
function probarConSuSesion({ navegador, motor, artefacto, primeros, caso }) {
  if (caso.motor === 'paquete') {
    return caso.variante === 'pestanas'
      ? probarElPaqueteEnDosPestanas({ navegador, artefacto })
      : probarElPaqueteInterrumpido({ motor, artefacto });
  }
  return caso.perfil ? probarLaInterrupcion({ motor, artefacto, caso, primeros }) : null;
}

async function probarCaso({ navegador, motor, artefacto, piezas, primeros, huellas, caso }) {
  const conSuSesion = probarConSuSesion({ navegador, motor, artefacto, primeros, caso });
  if (conSuSesion) {
    return conSuSesion;
  }
  const ruta = caso.pieza === 'motor' ? MOTOR : piezas[caso.pieza];
  // En la copia, el servidor entrega el motor correcto y se altera lo guardado en el dispositivo; sin red, nada.
  const estado = { alterado: caso.motor !== 'copia' && caso.motor !== 'sin-red' };
  const deArriba = await crearFixture(conAlteracion(artefacto, ruta, caso.caso, estado));
  const delante = opciones.comprimido ? await delanteComprimido(deArriba) : null;
  // El mismo fixture, visto por el origen del servidor del ensayo si va delante.
  const fixture = delante ? { ...deArriba, origen: delante.origen } : deArriba;
  const contexto = await contextoDelRecorrido(navegador, fixture.origen, delante ? opcionesDetras() : {});
  const consola = [];
  try {
    if (caso.html) {
      await servirSinIntegridad(contexto, fixture.origen, ruta, caso.html);
    }
    await contexto.addInitScript(contarLosAvisosDelServiceWorker);
    const pagina = await contexto.newPage();
    pagina.on('console', (m) => consola.push(recortar(`${m.type()}: ${m.text()}`)));
    pagina.on('pageerror', (e) => consola.push(recortar(`pageerror: ${String(e)}`)));
    assert.equal((await pagina.goto(`${fixture.origen}/recorrido.html`))?.status(), ESTADO_HTTP.correcto);
    const observado = await observar(caso, pagina, fixture, { estado, primeros, huellas });
    const final = observado.paginaFinal ?? pagina;
    const marcas = await final.evaluate(() => globalThis.__faroAlterado ?? []);
    return {
      caso: caso.caso,
      ruta,
      ...observado,
      ejecutada: marcas.includes(caso.caso) || fixture.peticiones.some((p) => p.ruta === `/__alterado/${caso.caso}`),
      servida: fixture.peticiones.some((p) => p.ruta === `/${ruta.slice('web/'.length)}`),
      consola: consola.filter((linea) => /integrity|digest|integridad|huella|comprobad|motor/iu.test(linea)),
      ...(delante ? { compresion: resumenDeLaCompresion(delante.registro), erroresDelServidor: delante.errores } : {}),
    };
  } finally {
    await contexto.close();
    await delante?.cerrar();
    await deArriba.cerrar();
  }
}

/** Con el motor alterado: Faro lo dice a tiempo, no reintenta, no dice que se prepara ni pide recargar. */
function comprobarElAviso(r) {
  assert.equal(r.respondio, false, 'Con un trozo del motor alterado, el motor no responde');
  assert.ok(r.avisoEnMs !== null, 'Faro dice a tiempo (AVISO_MS) que no puede usar el motor, con el aviso de su caso');
  assert.equal(r.servidaDespues, r.servidaAlAvisar, 'Tras el aviso, no se vuelve a pedir el motor');
  assert.equal(r.diceQueSePrepara, false, 'La conversación ya no dice que Faro se está preparando');
  assert.equal(r.ofreceReintentar, false, 'No ofrece «Volver a intentarlo»');
  assert.equal(r.pideRecargar, false, `No pide recargar la página: ${r.ultimoDeFaro}`);
}

/**
 * La instalación con el motor alterado: el aviso de la primera visita, sin nada que ofrecer (no hay nada guardado que
 * reparar ni borrar), ningún service worker activo, nada guardado en la copia y el motivo contado a la página; con el
 * motor repuesto, el service worker se activa, el motor responde y la constancia desaparece.
 */
function comprobarLaInstalacion(r) {
  assert.deepEqual(r.sugerencias, [], 'En la primera visita no ofrece nada: ni reparar ni borrar');
  assert.equal(r.guardado.activo, null, 'Con la instalación fallida no queda ningún service worker activo');
  assert.equal(r.guardado.copias, 0, 'No queda nada guardado en la copia de la web');
  // El motivo llega a la página por el aviso del service worker o por su constancia. WebKit vacía lo que escribe una
  // instalación que falla, así que en él solo queda el aviso: se registran los dos y se exige al menos uno.
  assert.ok(
    r.guardado.constancia?.motivo === 'no-coincide' || r.guardado.avisos.includes(AVISO_DEL_SERVICE_WORKER),
    `Queda constancia o aviso de por qué ha fallado: ${JSON.stringify(r.guardado)}`,
  );
  assert.equal(r.repuesto.serviceWorker, 'activated', 'Con el motor correcto, el service worker se activa');
  assert.equal(r.repuesto.respondio, true, `Con el motor correcto, el motor responde: ${r.repuesto.texto}`);
  assert.equal(r.repuesto.guardado.copias, 1, 'Con el motor correcto, se guarda la copia de la web');
  assert.equal(r.repuesto.guardado.constancia, null, 'La constancia del fallo desaparece al activarse');
}

/** Tras una reparación que ha salido bien: conversación de nuevo, service worker activado, motor y copia nueva. */
function comprobarLaReparacion(tras, reiniciada = true) {
  if (reiniciada) {
    assert.equal(tras.conversacionReiniciada, true, 'Al completar la reparación, la conversación vuelve a empezar');
  }
  assert.equal(tras.respondio, true, `Tras reparar, el motor responde: ${tras.texto}`);
  assert.equal(tras.guardado.copias, 1, 'con su copia de la web');
}

/** Hay copia del paquete de datos y sigue igual: las mismas copias con el mismo número de entradas. */
function comprobarElPaquete(antes, despues, cuando) {
  assert.ok(
    Object.keys(antes).length >= 1 && Object.values(antes).every((entradas) => entradas > 0),
    `Antes de reparar hay copia del paquete de datos: ${JSON.stringify(antes)}`,
  );
  assert.deepEqual(despues, antes, `La copia del paquete conserva nombres y entradas ${cuando}`);
}

/** La copia de la web tal como estaba antes de reparar: una sola, con el motor alterado y las marcas. */
function comprobarLaCopiaAnterior(copia, marcados, cuando) {
  assert.equal(copia.copias, 1, `La copia de la web sigue ${cuando}`);
  assert.equal(copia.motorAlterado, true, `Todo o nada: el motor de la copia sigue como estaba ${cuando}`);
  assert.deepEqual(copia.conMarca, marcados, `Todo o nada: ningún archivo de la copia se ha sustituido ${cuando}`);
}

/** Tras una reparación que ha salido bien: una sola copia, sin provisional y con todo lo imprescindible repuesto. */
function comprobarLaCopiaRepuesta(r) {
  assert.equal(r.copiaDespues.copias, 1, 'Tras reparar, una sola copia de la web');
  assert.deepEqual(r.copiaDespues.provisionales, {}, 'Tras reparar, ninguna copia provisional de la reparación');
  assert.equal(r.copiaDespues.motorAlterado, false, 'Tras reparar, el motor de la copia es el de esta versión');
  assert.deepEqual(r.copiaDespues.conMarca, [], 'Tras reparar, lo imprescindible marcado se ha repuesto');
  assert.deepEqual(r.datosDespues, DATOS_INTACTOS, 'Los datos y las preferencias siguen después de reparar');
}

/**
 * «red» y «otra»: lo bajado y comprobado antes del fallo se queda en la provisional, y «Volver a intentarlo» solo pide
 * al servidor lo que faltaba (pedidasAlReintentar, anotado por el fixture).
 */
function comprobarLoQueSeReanuda(r, cuando) {
  const { provisionales, enLaProvisional } = r.copiaTrasFallar;
  assert.ok(
    Object.values(provisionales).some((entradas) => entradas >= 1),
    `Lo bajado se queda en la provisional ${cuando}: ${JSON.stringify(provisionales)}`,
  );
  const otraVez = r.pedidasAlReintentar.filter((pedida) => enLaProvisional.includes(pedida));
  assert.deepEqual(otraVez, [], 'Al volver a intentarlo, no se vuelve a bajar lo que ya estaba en la provisional');
  assert.ok(r.pedidasAlReintentar.length >= 1, 'y se baja lo que faltaba');
}

/** «red»: el corte llega a mitad, con archivos ya bajados, y la copia, la del paquete y los datos siguen como estaban. */
function comprobarElCorte(r) {
  assert.equal(
    r.servidor.servidas,
    DEJA_PASAR,
    `El servidor entrega una parte antes del corte: ${JSON.stringify(r.servidor)}`,
  );
  assert.ok(r.servidor.rechazadas >= 1, 'y la red se corta con la reparación a medias');
  assert.ok(r.servidor.marcadosServidos.length >= 1, 'Entre lo entregado hay archivos marcados en la copia');
  comprobarLaCopiaAnterior(r.copiaTrasFallar, r.marcados, 'tras el corte');
  comprobarLoQueSeReanuda(r, 'tras el corte');
  comprobarElPaquete(r.paquetesAntes, r.paquetesTrasFallar, 'tras el corte');
  assert.deepEqual(
    r.datosTrasFallar,
    DATOS_INTACTOS,
    'Un corte de la reparación no toca los datos ni las preferencias',
  );
}

/**
 * «interrupcion»: el service worker se ha detenido con la reparación a medias (había bajado una parte, la petición
 * retenida no se completó y la página no recibió respuesta), y al volver todo sigue y la reparación termina bien.
 */
function comprobarLaInterrupcion(r) {
  const { antesDelCierre: cierre } = r;
  assert.equal(cierre.llegoALaRetenida, true, 'La reparación llega a la petición que el servidor retiene');
  assert.equal(cierre.servidas, DEJA_PASAR, 'con una parte ya entregada');
  assert.ok(r.marcadosServidos.length >= 1, 'Entre lo entregado hay archivos marcados en la copia');
  assert.ok(r.retenidasSinCompletar >= 1, 'Lo retenido no se completa antes de cerrar');
  assert.ok(
    Object.values(cierre.copia.provisionales).some((entradas) => entradas >= 1),
    `Al cerrar, una parte ya está en la copia provisional: ${JSON.stringify(cierre.copia.provisionales)}`,
  );
  assert.equal(cierre.respuestas, 0, 'Al cerrar el navegador, la reparación no ha terminado: no ha respondido');
  assert.equal(cierre.diceQueRepara, true, 'Al cerrar, Faro sigue diciendo que se está reparando');
  comprobarLaCopiaAnterior(r.alVolver.copia, r.marcados, 'al volver a abrir el navegador');
  // La copia sigue estropeada: la sonda no borra la provisional, porque hay algo que reanudar (borrarLaProvisionalSinUso).
  assert.ok(
    Object.values(r.alVolver.copia.provisionales).some((entradas) => entradas >= 1),
    `Al volver, lo bajado sigue en la provisional para reanudar: ${JSON.stringify(r.alVolver.copia.provisionales)}`,
  );
  comprobarElPaquete(r.paquetesAntes, r.alVolver.paquetes, 'al volver a abrir el navegador');
  assert.deepEqual(r.alVolver.datos, DATOS_INTACTOS, 'Al volver, los datos y las preferencias siguen');
  assert.ok(
    r.avisoAlVolver.sugerencias.length === 1 && REPARAR.includes(r.avisoAlVolver.sugerencias[0]),
    `Al volver, se vuelve a ofrecer «Reparar Faro»: ${r.avisoAlVolver.sugerencias}`,
  );
  assert.ok(r.reintento.recargada, 'y la reparación termina y recarga');
}

/** «informe»: el informe recibido con la copia alterada dice que hay que reparar, solo ofrece reparar y repara. */
function comprobarElInformeRecibido(r) {
  assert.equal(r.informe.aviso, true, `El informe recibido dice que hay que reparar: ${r.informe.ultimoDeFaro}`);
  assert.ok(
    r.informe.sugerencias.length === 1 && REPARAR.includes(r.informe.sugerencias[0]),
    `Solo ofrece reparar: ${r.informe.sugerencias}`,
  );
  assert.ok(r.reparar.recargada, '«Reparar Faro» acaba recargando la página');
  assert.equal(r.tras.reabierto, true, `Tras reparar, el resultado se vuelve a abrir solo: ${r.tras.ultimoDeFaro}`);
  assert.equal(r.tras.fragmento, '', 'y el código vuelve a salir de la barra');
  assert.equal(r.tras.historial.despues, r.tras.historial.antes, 'sin otra entrada en el historial');
  assert.equal(r.tras.guardado.copias, 1, 'con su copia de la web');
}

/**
 * Con la copia guardada del motor alterada: el service worker la rechaza (500), solo se ofrece «Reparar Faro», y la
 * reparación cumple lo que promete el texto según la variante (probarLaCopia): los datos y las preferencias siguen, la
 * copia del paquete también, la conversación solo vuelve a empezar al completarse, «reparando» no se queda y, si
 * falla, ofrece volver a intentarlo. Lo que tiene que sobrevivir a un corte o a una interrupción se mira primero.
 */
function comprobarLaCopia(r, variante) {
  assert.deepEqual(r.datosAntes, DATOS_INTACTOS);
  LO_QUE_SOBREVIVE[variante]?.(r);
  if (variante === 'informe') {
    comprobarElInformeRecibido(r);
    comprobarElPaquete(r.paquetesAntes, r.paquetesDespues, 'tras reparar');
    comprobarLaCopiaRepuesta(r);
    return;
  }
  LO_QUE_PIDE_LA_VARIANTE[variante]?.(r);
  comprobarElAviso(r);
  assert.equal(r.desdeElServiceWorker.estado, ESTADO_HTTP.errorInterno, 'La copia alterada no es de paso: 500');
  assert.equal(r.desdeElServiceWorker.cuerpo, NO_ES_DE_ESTA_VERSION);
  assert.ok(r.sugerencias.length === 1 && REPARAR.includes(r.sugerencias[0]), `Solo ofrece reparar: ${r.sugerencias}`);
  if (variante === 'cierre') {
    assert.deepEqual(r.datosDespues, DATOS_INTACTOS, 'Los datos y las preferencias siguen después de reparar');
    assert.notEqual(r.primeraVez, 'ni-responde-ni-avisa', 'Tras cerrar en plena reparación, responde u ofrece reparar');
    comprobarLaReparacion(r.tras, r.primeraVez === 'ofrece-reparar');
    comprobarElPaquete(r.paquetesAntes, r.paquetesDespues, 'tras reparar');
    return;
  }
  comprobarLaReparacion(r.tras);
  comprobarElPaquete(r.paquetesAntes, r.paquetesDespues, 'tras reparar');
  comprobarLaCopiaRepuesta(r);
}

/** «servidor» y «red»: Faro dice que no ha podido repararse, sin reiniciar la conversación, y el reintento repara. */
function comprobarElFalloYElReintento(r) {
  assert.ok(r.fallo.aviso, 'Faro dice que no ha podido repararse');
  assert.equal(r.fallo.diceQueRepara, false, 'Ya no dice que se está reparando');
  assert.equal(r.fallo.conversacionSigue, true, 'La conversación no vuelve a empezar si la reparación no se completa');
  assert.ok(
    r.fallo.sugerencias.length === 1 && REINTENTAR.includes(r.fallo.sugerencias[0]),
    `Ofrece volver a intentarlo: ${r.fallo.sugerencias}`,
  );
  assert.deepEqual(r.datosTrasFallar, DATOS_INTACTOS, 'Un fallo de la reparación no toca los datos');
  assert.ok(r.reintento.recargada, 'Volver a intentarlo, ya con el servidor bien, repara y recarga');
}

/** «pestanas»: las dos pestañas ofrecen reparar, terminan su reparación y conservan los datos. */
function comprobarLasDosPestanas(r) {
  assert.ok(r.reparar.recargada && r.repararLaSegunda.recargada, 'Las dos pestañas terminan su reparación');
  assert.ok(
    r.avisoDeLaSegunda.sugerencias.length === 1 && REPARAR.includes(r.avisoDeLaSegunda.sugerencias[0]),
    'La segunda pestaña también ofrece reparar',
  );
  comprobarLaReparacion(r.trasLaSegunda);
  assert.deepEqual(r.datosDeLaSegunda, DATOS_INTACTOS);
}

/** Lo que tiene que sobrevivir a un corte o a una interrupción: se mira antes que nada. */
const LO_QUE_SOBREVIVE = { red: comprobarElCorte, interrupcion: comprobarLaInterrupcion };
/** Lo propio de cada variante que termina reparando (probarLaCopia): se mira antes que el aviso común. */
const LO_QUE_PIDE_LA_VARIANTE = {
  reparar: (r) =>
    assert.ok(r.reparar.recargada, `«Reparar Faro» acaba recargando la página: ${JSON.stringify(r.reparar)}`),
  rechazar: (r) =>
    assert.ok(r.reparar.recargada, `Aunque se rechazara la pregunta al salir, se recarga: ${JSON.stringify(r.tras)}`),
  pestanas: comprobarLasDosPestanas,
  servidor: comprobarElFalloYElReintento,
  red: comprobarElFalloYElReintento,
  otra: (r) => {
    comprobarLaCopiaAnterior(r.copiaTrasFallar, r.marcados, 'con una página de otra versión');
    comprobarLoQueSeReanuda(r, 'con una página de otra versión');
    assert.equal(r.paginaDeOtraVersionEnLaCopia, false, 'La página de otra versión no entra en la copia');
    comprobarElFalloYElReintento(r);
  },
  interrupcion: () => {},
};

/** Los casos con una comprobación solo suya, por su `motor`: sin red y la copia del paquete (por su variante). */
const COMPROBACION_PROPIA = {
  'sin-red': () => comprobarSinConexion,
  paquete: ({ variante }) =>
    variante === 'pestanas' ? comprobarElPaqueteEnDosPestanas : comprobarElPaqueteInterrumpido,
};

/** Lo que se exige en cada caso. */
function comprobarCaso(caso, r) {
  if (caso.control) {
    assert.equal(r.ejecutada, true, 'Sin integridad, el código añadido se ejecuta: el ensayo lo ve');
    return;
  }
  assert.equal(r.ejecutada, false, `${caso.caso}: el código alterado no se ejecuta`);
  if (caso.html === 'atributo') {
    // Sin el atributo, lo rechaza el mapa de integridad de la página, con su error de integridad.
    assert.ok(
      r.consola.some((linea) => ERROR_DE_INTEGRIDAD.test(linea)),
      `${caso.caso}: la consola cuenta el error de integridad`,
    );
  }
  if (r.compresion) {
    assert.ok(
      r.compresion.br + r.compresion.gzip > 0,
      `El servidor del ensayo comprime: ${JSON.stringify(r.compresion)}`,
    );
  }
  if (!caso.motor) {
    assert.equal(r.conversacion, false, `${caso.caso}: la página no arranca con el módulo alterado`);
    return;
  }
  const propia = COMPROBACION_PROPIA[caso.motor]?.(caso);
  if (propia) {
    propia(r);
    return;
  }
  if (caso.motor === 'instalar') {
    comprobarElAviso(r);
    comprobarLaInstalacion(r);
    return;
  }
  comprobarLaCopia(r, caso.variante);
}

const opciones = argumentos({
  'worker-privado': { type: 'string' },
  caso: { type: 'string', multiple: true },
  comprimido: { type: 'boolean' },
  codificacion: { type: 'string' },
});
/** Los casos que se prueban: todos, o los que nombra --caso. */
const ELEGIDOS = CASOS.filter(({ caso }) => !opciones.caso || opciones.caso.includes(caso));
assert.ok(ELEGIDOS.length, `Casos: ${CASOS.map(({ caso }) => caso).join(', ')}`);
const registro = {};
after(() => {
  if (opciones.salida) {
    mkdirSync(opciones.salida, { recursive: true });
    writeFileSync(join(opciones.salida, 'modulo-alterado.json'), `${JSON.stringify(registro, null, 1)}\n`);
  }
});

for (const { nombre, carpeta } of opciones.artefactos) {
  registro.construcciones = { ...registro.construcciones, [nombre]: construccionEnsayada(carpeta) };
  const { artefacto } = await servible(carpeta, opciones['worker-privado']);
  const piezas = piezasDeLaPagina(artefacto);
  const primeros = primerosDeLaCopia(carpeta);
  const huellas = huellasDeLaConstruccion(carpeta);
  for (const motor of opciones.motores) {
    test(`módulo alterado en ${nombre} con ${motor}: no se ejecuta`, async (t) => {
      // Detrás del servidor del ensayo (HTTPS con un certificado sintético), Chromium solo registra el service worker si
      // arranca aceptándolo (presupuesto-condiciones.mjs, arrancarCon).
      const sesion = await arrancar(
        motor,
        opciones.comprimido ? { otrosDeChromium: ['--ignore-certificate-errors'] } : {},
      );
      registro[`${nombre} · ${motor}`] = {};
      try {
        for (const caso of ELEGIDOS) {
          await t.test(caso.caso, async () => {
            const r = await probarCaso({
              navegador: sesion.navegador,
              motor,
              artefacto,
              piezas,
              primeros,
              huellas,
              caso,
            });
            registro[`${nombre} · ${motor}`][caso.caso] = r;
            comprobarCaso(caso, r);
          });
        }
      } finally {
        await sesion.cerrar();
      }
    });
  }
}
