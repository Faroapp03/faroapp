// La medida de un escenario del presupuesto de rendimiento (presupuesto-rendimiento.mjs). Cuatro hitos por escenario,
// en ms desde la navegación y con lo pedido y servido hasta cada uno:
// - interfaz usable: la página pintada e interactiva; en los recorridos, el primer mensaje de Faro visible y lo que
//   se puede hacer a continuación listo (el campo de texto), sin
//   esperar al motor;
// - primer análisis completo (solo los recorridos): la primera respuesta entera del motor del dispositivo al primer
//   mensaje, el hito de descargas-js.mjs;
// - copia web lista: el service worker activado (su instalación guarda la web, scripts, estilos, tipografías e
//   imágenes, antes de activarse);
// - copia completa lista: además, el paquete de datos del motor guardado.
// En la condición «segunda visita», todo se mide en la recarga, tras una primera visita con la copia completa.
// Todas las esperas de un escenario caben en el límite total de la condición (presupuesto-plazo.mjs); lo que no llega
// antes de que venza consta como pendiente y la medida, «no completada dentro del plazo», con todo lo observado.

import { autenticarEnChromium } from './cache-fiel.mjs';
import { PRIMER_MENSAJE, RESPUESTA_DEL_MOTOR, respuestaDeFaro } from './paquete-comun.mjs';
import { cifrasDelRegistro } from './presupuesto-cifras.mjs';
import { contextoDelEnsayo, identidadDe, limitarCpu } from './presupuesto-condiciones.mjs';
import { esJavaScriptDelContexto, esJavaScriptDelServidor } from './presupuesto-criterios.mjs';
import { cerrarAcotado, crearPlazoTotal, ESTADO, MARGEN_DE_CIERRE_MS } from './presupuesto-plazo.mjs';
import { ahora, crearServidorDelEnsayo } from './presupuesto-servidor.mjs';

/** Tras el hito, lo que se espera a que una página sin service worker pudiera registrarlo (como descargas-js.mjs). */
const ESPERA_SIN_SERVICE_WORKER_MS = 1500;
/** Sin ninguna respuesta en curso ni petición nueva durante este tiempo, el tráfico del escenario ha terminado. */
const SILENCIO_MS = 3000;
const SONDEO_MS = 250;
const MS_POR_SEGUNDO = 1000;
const DE_FARO = '#conversacion .rc-mensaje[data-autor="faro"]';

/**
 * El idioma de la página ya aplicado: su diccionario se ha cargado. La espera empieza al confirmarse la navegación,
 * antes de que exista el documento: hasta entonces no hay `documentElement`.
 */
async function idiomaAplicado(pagina, plazo) {
  await pagina.waitForFunction(
    () => document.documentElement?.lang === 'es' && document.readyState === 'complete',
    undefined,
    { timeout: plazo },
  );
}

/** Recorrido real usable: el primer mensaje de Faro a la vista y el campo de texto listo para escribir. */
async function conversacionLista(pagina, plazo) {
  await pagina.locator(DE_FARO).first().waitFor({ state: 'visible', timeout: plazo });
  await pagina.waitForFunction(
    () => {
      const campo = document.querySelector('#mensaje');
      return Boolean(campo && !campo.disabled && !campo.readOnly && campo.getClientRects().length);
    },
    undefined,
    { timeout: plazo },
  );
}

/** Recorrido real: la persona escribe su primer mensaje y el motor del dispositivo responde entero. */
async function primerAnalisisReal(pagina, plazo) {
  const antes = await pagina.locator(DE_FARO).count();
  await pagina.locator('#mensaje').fill(PRIMER_MENSAJE);
  await pagina.locator('#mensaje').press('Enter');
  await pagina.locator(RESPUESTA_DEL_MOTOR).first().waitFor({ state: 'visible', timeout: plazo });
  await respuestaDeFaro(pagina, antes, plazo);
}

export const ESCENARIOS = [
  {
    nombre: 'portada',
    ruta: '/',
    oficial: true,
    serviceWorker: false,
    interfaz: (p, plazo) => p.locator('.acceso a').waitFor({ timeout: plazo }),
  },
  {
    nombre: 'acceso',
    ruta: '/acceso-web',
    oficial: true,
    serviceWorker: false,
    interfaz: (p, plazo) => p.locator('h1').waitFor({ timeout: plazo }),
  },
  { nombre: 'inicio', ruta: '/inicio.html', serviceWorker: true, interfaz: idiomaAplicado },
  {
    nombre: 'recorrido real',
    ruta: '/recorrido.html',
    serviceWorker: true,
    interfaz: conversacionLista,
    analisis: primerAnalisisReal,
  },
  {
    nombre: 'informe',
    ruta: '/informe-ejemplo.html',
    serviceWorker: true,
    interfaz: (p, plazo) => p.locator('#contenido').first().waitFor({ state: 'visible', timeout: plazo }),
  },
];

/** Un paso del escenario y cuándo se cumplió, en ms desde `t0`; si no se cumple en el plazo, el motivo. */
async function cronometrar(paso, t0) {
  try {
    await paso();
    return { alcanzado: true, ms: ahora() - t0 };
  } catch (error) {
    return { alcanzado: false, ms: ahora() - t0, error: String(error).split('\n')[0] };
  }
}

/** Un hito que aún no ha llegado: así consta en lo escrito mientras se mide y si el límite total lo corta. */
const PENDIENTE = Object.freeze({ alcanzado: false, ms: null, pendiente: true });

/** Una visita sin nada medido aún: se completa a medida que llegan los hitos y la copia. */
function visitaNueva(escenario, t0) {
  return {
    t0,
    hitos: { interfaz: PENDIENTE, analisis: escenario.analisis ? PENDIENTE : null },
    copia: escenario.serviceWorker
      ? { aplica: true, terminada: false, pendiente: true, webMs: null, paqueteMs: null, completaMs: null }
      : { aplica: false, pendiente: true },
    calma: null,
    estadoNavegacion: undefined,
  };
}

/**
 * Los hitos de la página: interfaz usable y, en los recorridos y si la interfaz llegó, el primer análisis. Cada
 * espera recibe lo que queda del límite total, con el plazo de la condición como techo.
 */
async function medirHitos(pagina, { escenario, condicion, plazoTotal, visita, avisar }) {
  const { t0 } = visita;
  visita.hitos.interfaz = await cronometrar(() => escenario.interfaz(pagina, plazoTotal.para(condicion.plazoMs)), t0);
  avisar();
  if (!escenario.analisis) {
    return;
  }
  visita.hitos.analisis = visita.hitos.interfaz.alcanzado
    ? await cronometrar(() => escenario.analisis(pagina, plazoTotal.para(condicion.plazoMs)), t0)
    : { alcanzado: false, ms: null, error: 'la interfaz no llegó a estar usable' };
  avisar();
}

/**
 * La copia sin conexión: el service worker activado y la respuesta del paquete de datos (marcas que deja la página,
 * presupuesto-condiciones.mjs), en ms desde la navegación. En una página sin service worker, se comprueba (como
 * descargas-js.mjs) que no registra ninguno.
 */
async function medirCopia(pagina, { escenario, condicion, plazoTotal, visita, avisar }) {
  const { t0 } = visita;
  if (!escenario.serviceWorker) {
    await pagina.waitForTimeout(Math.min(ESPERA_SIN_SERVICE_WORKER_MS, plazoTotal.para(condicion.plazoMs)));
    const registros = await pagina.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length);
    visita.copia = { aplica: false, registros };
    avisar();
    return;
  }
  const fallo = await pagina
    .waitForFunction(() => window.__presupuesto?.activado && window.__presupuesto?.paquete, undefined, {
      timeout: plazoTotal.para(condicion.plazoMs),
      polling: SONDEO_MS,
    })
    .then(
      () => null,
      (error) => String(error).split('\n')[0],
    );
  const terminada = fallo === null;
  const marcas = await pagina.evaluate(() => window.__presupuesto);
  const webMs = marcas.activado ? marcas.activado - t0 : null;
  const paqueteMs = marcas.paquete ? marcas.paquete.t - t0 : null;
  const completa = terminada && marcas.paquete.completo;
  visita.copia = {
    aplica: true,
    terminada,
    ...(terminada ? {} : { error: fallo }),
    webMs,
    paqueteMs,
    paqueteCompleto: marcas.paquete?.completo ?? null,
    versionDelPaquete: marcas.paquete?.version ?? null,
    avisosDeProgreso: marcas.progresos,
    completaMs: completa ? Math.max(webMs, paqueteMs) : null,
  };
  avisar();
}

/** En Chromium, lo que ve el propio contexto (incluye lo que el service worker entrega desde su copia). */
function anotarContraste(contexto, motor) {
  if (motor !== 'chromium') {
    return null;
  }
  const vistas = [];
  contexto.on('request', (peticion) => {
    const ruta = new URL(peticion.url()).pathname;
    const desde = peticion.serviceWorker() ? 'service worker' : 'página o Worker';
    vistas.push({ ruta, tipo: peticion.resourceType(), metodo: peticion.method(), desde, llegada: ahora() });
  });
  return vistas;
}

/** El contraste de Chromium entre `desde` y `corte`: lo GET y el JavaScript del contexto, como descargas-js.mjs. */
function contraste(vistas, desde, corte) {
  if (!vistas) {
    return 'el contexto no ve las peticiones del service worker en este motor';
  }
  const get = vistas.filter((v) => v.metodo === 'GET' && v.llegada >= desde && v.llegada <= corte);
  const js = get.filter(esJavaScriptDelContexto);
  const cuenta = (lista) => ({ peticiones: lista.length, direcciones: new Set(lista.map((v) => v.ruta)).size });
  const desdeElServiceWorker = get.filter((v) => v.desde === 'service worker').length;
  return { todo: cuenta(get), javascript: cuenta(js), desdeElServiceWorker };
}

/** Las peticiones del registro, con sus tiempos en ms desde la navegación. */
const peticionesRelativas = (registro, t0) =>
  registro.map(({ llegada, fin, ...resto }) => ({ ...resto, llegadaMs: llegada - t0, finMs: fin ? fin - t0 : null }));

/**
 * Pone en marcha los dos servidores (el de arriba y el del ensayo) y el contexto del escenario, en `en`: cada uno se
 * anota en `recursos` al crearse, para que el cierre acotado lo alcance aunque el límite total venza a mitad.
 */
async function preparar({ sesion, motor, condicion, arriba }, { en, registrar, piezas }) {
  en.servidorDeArriba = await arriba();
  registrar('servidor de arriba', () => en.servidorDeArriba.cerrar());
  en.servidor = await crearServidorDelEnsayo({
    origenDeArriba: en.servidorDeArriba.origen,
    condicion,
    identidad: identidadDe(condicion),
    bytesPorSegundo: condicion.bytesPorSegundo,
  });
  registrar('servidor del ensayo', () => en.servidor.cerrar());
  en.contexto = await piezas.contextoDelEnsayo(sesion, { motor, condicion, origen: en.servidor.origen });
  registrar('contexto', () => en.contexto.close());
  en.vistas = anotarContraste(en.contexto, motor);
}

/** Lo pedido y servido hasta un momento (época, ms): peticiones llegadas y bytes de las respuestas ya terminadas. */
function acumulado(entradas, momento) {
  const llegadas = entradas.filter((e) => e.llegada <= momento);
  const terminadas = entradas.filter((e) => e.fin && e.fin <= momento);
  const suma = (lista, campo) => lista.reduce((total, e) => total + (e[campo] ?? 0), 0);
  return {
    peticiones: llegadas.length,
    bytesServidos: suma(terminadas, 'servidos'),
    bytesSinComprimir: suma(terminadas, 'sinComprimir'),
  };
}

/** Los cuatro hitos con su tiempo y lo acumulado hasta cada uno. */
function hitosConAcumulado(entradas, { t0, hitos, copia }) {
  const con = (ms, alcanzado = ms !== null) => ({
    alcanzado,
    ms,
    ...(Number.isFinite(ms) ? acumulado(entradas, t0 + ms) : {}),
  });
  return {
    interfaz: { ...hitos.interfaz, ...con(hitos.interfaz.ms, hitos.interfaz.alcanzado) },
    analisis: hitos.analisis ? { ...hitos.analisis, ...con(hitos.analisis.ms, hitos.analisis.alcanzado) } : null,
    copiaWeb: copia.aplica ? con(copia.webMs) : null,
    copiaCompleta: copia.aplica ? con(copia.completaMs) : null,
  };
}

/**
 * Las cifras del escenario a partir de lo observado en la visita medida (las entradas desde `desde`) hasta `momento`:
 * también de una visita a medias, con los hitos que aún no han llegado como pendientes.
 */
function resultado({ servidorDeArriba, servidor, vistas }, visita, { desde, condicion, primera, momento }) {
  const { t0, hitos, copia, calma, cpu, estadoNavegacion } = visita;
  // Una respuesta aún en curso cuenta lo que lleva escrito y lo dice; terminada, el registro ya lo trae.
  const entradas = servidor.registro
    .slice(desde)
    .map((e) => (e.fin ? e : { ...e, servidos: e.envio?.bytes ?? 0, enCurso: true }));
  const sinSw = copia.aplica || hitos.interfaz.ms === null ? 0 : hitos.interfaz.ms + ESPERA_SIN_SERVICE_WORKER_MS;
  const ultimoHito = Math.max(hitos.interfaz.ms ?? 0, hitos.analisis?.ms ?? 0, copia.webMs ?? 0, sinSw);
  // Con algún hito pendiente, la visita sigue: el corte es el momento de la medida.
  const pendiente = hitos.interfaz.pendiente || hitos.analisis?.pendiente || copia.pendiente;
  const corte = pendiente ? momento : t0 + ultimoHito;
  const cifras = cifrasDelRegistro(entradas, corte);
  const delFixture = servidorDeArriba.peticiones;
  return {
    estadoNavegacion,
    cpu,
    hitos: hitosConAcumulado(entradas, visita),
    copia,
    primeraVisita: primera,
    traficoTerminadoMs: calma ? Math.max(...entradas.map((e) => e.fin ?? 0)) - t0 : null,
    servidor: cifras,
    cotaMs: condicion.bytesPorSegundo ? (cifras.get.bytesServidos / condicion.bytesPorSegundo) * MS_POR_SEGUNDO : null,
    fixture: { peticiones: delFixture.length, coincide: delFixture.length === servidor.registro.length },
    javascriptDelFixture: delFixture.filter((p) => p.metodo === 'GET' && esJavaScriptDelServidor(p)).length,
    contraste: contraste(vistas, servidor.registro[desde]?.llegada ?? t0, corte),
    errores: [...servidor.errores, ...(servidorDeArriba.errores ?? [])],
    servidoPor: servidorDeArriba.procedencia ?? null,
    peticiones: peticionesRelativas(entradas, t0),
  };
}

/**
 * Una visita: navega, espera los hitos de la página y la copia a la vez, y después a que el tráfico termine, todo
 * dentro del límite total. Lo medido se va dejando en `progreso.visita`.
 */
async function visitar(pagina, progreso, { escenario, condicion, plazoTotal, navegar, avisar }) {
  const visita = visitaNueva(escenario, ahora());
  progreso.visita = visita;
  const respuesta = await navegar();
  visita.estadoNavegacion = respuesta?.status();
  avisar();
  const estado = { escenario, condicion, plazoTotal, visita, avisar };
  await Promise.all([medirHitos(pagina, estado), medirCopia(pagina, estado)]);
  visita.calma = await progreso.en.servidor.esperarCalma(SILENCIO_MS, plazoTotal.para(condicion.plazoMs));
  return visita;
}

/** Lo que el límite total y el cierre dejan en cada medida. */
function plazoDeLaMedida(plazoTotal, condicion) {
  return {
    limiteTotalMs: plazoTotal.limiteTotalMs,
    techoPorEsperaMs: condicion.plazoMs,
    anticipacionMs: plazoTotal.anticipacionMs,
    margenDeCierreMs: MARGEN_DE_CIERRE_MS,
    margenDeCierreDelEscenarioMs: plazoTotal.margenDeCierreMs,
    usadoMs: Math.round(plazoTotal.usadoMs()),
  };
}

/**
 * La medida con lo observado hasta ahora, con su estado; antes de navegar, con los hitos pendientes desde el inicio
 * del plazo, y sin servidor del ensayo aún, solo el estado y el plazo.
 */
function medidaDe(progreso, { escenario, condicion, plazoTotal, estado }) {
  const { en } = progreso;
  const plazo = plazoDeLaMedida(plazoTotal, condicion);
  if (!(en.servidor && en.servidorDeArriba)) {
    return { estado, fase: progreso.fase, plazo };
  }
  const visita = progreso.visita ?? visitaNueva(escenario, plazoTotal.inicio);
  const medida = resultado(
    en,
    { ...visita, cpu: progreso.cpu },
    { desde: progreso.desde, condicion, primera: progreso.primera, momento: ahora() },
  );
  return { estado, fase: progreso.fase, plazo, ...medida };
}

/** Las piezas con navegador de medir(); las pruebas sin navegador las sustituyen. */
const PIEZAS = { contextoDelEnsayo };

/** La medida entera dentro del límite total: arranque del contexto, la primera visita si la hay y la visita medida. */
async function medirDentro({ motor, escenario, condicion, plazoTotal }, progreso, avisar) {
  const { en } = progreso;
  const pagina = await en.contexto.newPage();
  progreso.cpu = await limitarCpu(en.contexto, pagina, { motor, condicion });
  await autenticarEnChromium(en.contexto, pagina, { motor, origen: en.servidor.origen });
  const opciones = () => ({ waitUntil: 'commit', timeout: plazoTotal.para(condicion.plazoMs) });
  const ir = () => pagina.goto(`${en.servidor.origen}${escenario.ruta}`, opciones());
  const datos = { escenario, condicion, plazoTotal, avisar };
  if (condicion.segundaVisita) {
    progreso.fase = 'primera visita';
    const previa = await visitar(pagina, progreso, { ...datos, navegar: ir });
    const { get } = cifrasDelRegistro(en.servidor.registro, Number.POSITIVE_INFINITY);
    progreso.primera = { copiaCompletaMs: previa.copia.completaMs ?? null, ...get };
    progreso.desde = en.servidor.registro.length;
    progreso.fase = 'visita medida';
    await visitar(pagina, progreso, { ...datos, navegar: () => pagina.reload(opciones()) });
  } else {
    await visitar(pagina, progreso, { ...datos, navegar: ir });
  }
}

/**
 * Mide un escenario en una condición con un navegador ya arrancado. `arriba` crea el servidor de arriba: el fixture o,
 * en la portada y el acceso, el Worker oficial del artefacto medido (servidorOficialDe() de presupuesto-servidor.mjs).
 * Todas las esperas caben en `plazoTotal` (presupuesto-plazo.mjs; por omisión, el límite total de la condición): si
 * alguna no termina antes, la medida consta «no completada dentro del plazo» con todo lo observado hasta entonces. Lo
 * medido se pasa a `alAvanzar` tras cada hito y al vencer el límite, para escribirlo en disco antes de cerrar.
 * Contexto y servidores se cierran dentro del margen del plazo; lo que no cierra a tiempo se dice en `cierre`.
 */
export async function medir(opciones, piezas = PIEZAS) {
  const { escenario, condicion, alAvanzar = () => undefined } = opciones;
  const plazoTotal = opciones.plazoTotal ?? crearPlazoTotal(condicion.limiteTotalMs ?? condicion.plazoMs);
  const recursos = [];
  let cerrando = false;
  const registrar = (nombre, cerrar) => {
    recursos.push([nombre, cerrar]);
    if (cerrando) {
      void cerrarAcotado([[nombre, cerrar]], plazoTotal.margenDeCierreMs);
    }
  };
  const progreso = { en: {}, visita: null, fase: 'visita medida', desde: 0, primera: null, cpu: null };
  const avisar = () => {
    if (!cerrando) {
      alAvanzar(medidaDe(progreso, { escenario, condicion, plazoTotal, estado: ESTADO.enCurso }));
    }
  };
  const trabajo = (async () => {
    await preparar(opciones, { en: progreso.en, registrar, piezas });
    await medirDentro({ ...opciones, plazoTotal }, progreso, avisar);
  })();
  // Si vence el límite, el trabajo se abandona: lo que rechace después, al cerrarse lo suyo, ya no importa.
  trabajo.catch(() => undefined);
  let medida;
  try {
    const terminado = await Promise.race([trabajo.then(() => true), plazoTotal.vencimiento.then(() => false)]);
    const estado = terminado && !plazoTotal.agotado() ? ESTADO.completa : ESTADO.fueraDePlazo;
    medida = medidaDe(progreso, { escenario, condicion, plazoTotal, estado });
    if (!terminado) {
      alAvanzar(medida);
    }
  } finally {
    cerrando = true;
    plazoTotal.detener();
    const cierre = await cerrarAcotado(recursos, plazoTotal.margenDeCierreMs);
    if (medida) {
      medida.cierre = cierre;
    }
  }
  return medida;
}
