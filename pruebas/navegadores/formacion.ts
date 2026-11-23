/**
 * Recorrido completo de formación en ES/CA con textos largos: descripción del trabajo → ocupación → tareas (con una
 * tarea propia larga, con «l·l» y «’») → «Sí, avancemos» → preferencias → propuesta con cursos del catálogo publicado
 * → «Guardar esta hoja de ruta» → «Tu carpeta» → documento de dos hojas → imprimir/PDF (la hoja y «Guardar los dos»),
 * entero en las páginas A4 que necesite y con el folio real en cada página.
 * Después se apaga el servidor y se comprueba la página de estado sin conexión de la instalación privada.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'playwright-core';
import type { EntregaCatalogo, OfertaCatalogo } from '../../src/catalogo-cursos/contrato.ts';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { IDENTIDAD_WEB } from '../../src/comun/identidad-web.ts';
import { diaDeCursoEnFrase, fechaDeCursoEnFrase } from '../../web/scripts/catalogo-cursos/fechas-de-curso.js';
import { fechaCorta, partesEnZona, ZONA_BARCELONA } from '../../web/scripts/fechas.js';
import { type Artefacto, huella } from './artefacto.ts';
import type { EntornoObservacion } from './csp-panel.ts';
import type { Fixture } from './fixture.ts';
import { estabilizar } from './observacion.ts';
import {
  comprobarContextosEnPantalla,
  comprobarLetraDelPdf,
  comprobarPaginasConCuerpo,
  elegirOcupacionEnElChat,
  faltanEnElPapel,
  HOJAS_DEL_INFORME,
  type Idioma,
  leerPdf,
  type PaginaPdf,
  PIE_DEL_INFORME,
  papelSinFolio,
  prepararCopia,
  recargarSinRedTrasElPortal,
  SOLO_EN_PANTALLA,
  serieAnualEnPantalla,
  serieAnualEnPapel,
  textosDeLectoresImpresos,
  textoVisible,
} from './recorrido.ts';

const PLAZO_PROPUESTA_MS = 90_000;
const PLAZO_INACCESIBILIDAD_MS = 1000;
const CABECERA_PDF = '%PDF-';
const TOLERANCIA_PX = 1;
const HOJAS_DE_LA_HOJA = 2;
/** Lo que la hoja de ruta muestra en pantalla y no va al papel: sus dos folios de pantalla (documento-hoja.css). */
const SOLO_EN_PANTALLA_DE_LA_HOJA = ['.hd[data-plan-elegido] .hd-pie', '.pe-calendario-exportar'];
const INDICES_TAREAS = [0, 1];
/** La etapa y las condiciones con más cursos acreditados del catálogo: el caso más largo del documento. */
const ETAPA = 'intermedio';
const ACEPTA_CUENTA = 'si';
const MIN_LETRAS_DESCRIPCION = 800;
const MIN_LETRAS_TAREA = 250;
const MAX_LETRAS_TAREA = 300;

/** Lo que dice la persona y lo que tiene que decir Faro, en cada idioma (textos visibles de web/idiomas). */
const TEXTOS: Record<Idioma, { descripcion: string; tarea: string; si: string; titulo: string; folio: string }> = {
  es: {
    descripcion: [
      'Soy conductor de autobús urbano.',
      'Trabajo en turnos de mañana y de noche en una línea que cruza la ciudad de punta a punta, con paradas en',
      'hospitales, escuelas y mercados. Antes de salir reviso el vehículo, compruebo los frenos, las luces y las',
      'puertas, y anoto cualquier incidencia en el parte del día. Durante el servicio atiendo a las personas',
      'viajeras, les explico los transbordos y las tarifas, ayudo a subir a quien va en silla de ruedas o con',
      'carrito y mantengo la calma cuando hay retenciones, obras o desvíos que obligan a cambiar el itinerario.',
      'Al terminar el turno entrego la recaudación, comento con el equipo de tráfico lo que ha pasado y dejo el',
      'autobús preparado para el siguiente conductor. También participo en la revisión de horarios con los',
      'compañeros y en las sesiones de seguridad vial que organiza la empresa cada trimestre, donde comentamos',
      'los incidentes del periodo, las quejas recibidas y las mejoras que podríamos proponer para el servicio.',
    ].join(' '),
    tarea:
      'Revisar con los compañeros la colección de horarios del servicio nocturno, comparar los tiempos reales de cada parada con los publicados, anotar los retrasos que se repiten por obras o por tráfico y proponer al equipo de planificación una versión más clara para las personas viajeras',
    si: 'Sí, avancemos',
    titulo: 'Tu plan de formación',
    folio: 'Hoja 1 de 2',
  },
  ca: {
    descripcion: [
      'Sóc conductor d’autobús urbà.',
      'Treballo en torns de matí i de nit en una línia que travessa la ciutat d’una punta a l’altra, amb parades',
      'a hospitals, escoles i mercats. Abans de sortir reviso el vehicle, comprovo els frens, els llums i les',
      'portes, i anoto qualsevol incidència al comunicat del dia. Durant el servei atenc les persones viatgeres,',
      'els explico els transbordaments i les tarifes, ajudo a pujar qui va amb cadira de rodes o amb cotxet i',
      'mantinc la calma quan hi ha retencions, obres o desviaments que obliguen a canviar l’itinerari. En acabar',
      'el torn lliuro la recaptació, comento amb l’equip de trànsit el que ha passat i deixo l’autobús a punt per',
      'al conductor següent. També participo en la revisió d’horaris amb els companys i en les sessions de',
      'seguretat viària que organitza l’empresa cada trimestre, on parlem de la col·laboració entre torns, de les',
      'queixes rebudes i de les millores que podríem proposar perquè el servei sigui més puntual i més amable.',
    ].join(' '),
    tarea:
      'Revisar amb els companys la col·lecció d’horaris del servei nocturn, comparar els temps reals de cada parada amb els publicats, anotar els retards que es repeteixen per obres o per trànsit i proposar a l’equip de planificació una versió més clara per a les persones viatgeres',
    si: 'Sí, avancem',
    titulo: 'El teu pla de formació',
    folio: 'Full 1 de 2',
  },
};

for (const textos of Object.values(TEXTOS)) {
  assert(textos.descripcion.length >= MIN_LETRAS_DESCRIPCION, 'La descripción del caso largo es larga');
  assert(textos.tarea.length >= MIN_LETRAS_TAREA && textos.tarea.length <= MAX_LETRAS_TAREA, 'Tarea larga y admitida');
}

/** Las opciones de cada bloque, con el identificador de su radio, su resumen y el enlace a la ficha oficial. */
async function cursosDeLaPropuesta(pagina: Page) {
  const propuesta = pagina.locator('section.rc-hoja:not(.rc-hoja-cerrada)').last();
  return propuesta.locator('.rc-hoja-curso').evaluateAll((tarjetas) =>
    tarjetas.map((tarjeta) => {
      const entrada = tarjeta.querySelector<HTMLInputElement>('input[type=radio]');
      const enlace = tarjeta.querySelector<HTMLAnchorElement>('a');
      return {
        id: entrada?.id ?? '',
        bloque: entrada?.name.split('-').at(-1) ?? '',
        unidadId: entrada?.value ?? '',
        nombre: tarjeta.querySelector('label')?.textContent ?? '',
        resumen: tarjeta.querySelector('.rc-curso-resumen')?.textContent ?? '',
        enlace: enlace?.textContent ?? '',
        url: enlace?.getAttribute('href') ?? '',
        destino: enlace?.getAttribute('target'),
        rel: enlace?.getAttribute('rel'),
      };
    }),
  );
}

const PROPUESTA_ABIERTA = 'section.rc-hoja:not(.rc-hoja-cerrada) .rc-hoja-pie';

async function esperarPropuesta(pagina: Page): Promise<void> {
  await pagina.locator(PROPUESTA_ABIERTA).last().waitFor({ state: 'visible', timeout: PLAZO_PROPUESTA_MS });
}

/**
 * Permite confirmar los requisitos disponibles antes de seleccionar dos cursos con nombres largos.
 */
async function confirmarRequisitos(pagina: Page): Promise<void> {
  await pagina.locator(`${PROPUESTA_ABIERTA} .rc-boton-secundario`).last().click();
  const revision = pagina.locator('form.rc-hoja-pregunta').last();
  await revision.waitFor({ state: 'visible' });
  const requisitos = await revision.locator('input[type=checkbox][id^="requisito-"]').all();
  for (const requisito of requisitos) {
    await requisito.check();
  }
  await revision.locator('[type=submit]').click();
  await esperarPropuesta(pagina);
}

type Seleccion = 'primera' | 'maxima';

/** Completa explícitamente niveles, disponibilidad y preferencias de la persona. */
async function completarPreferencias(pagina: Page, tarea: string | null): Promise<string> {
  const preferencias = pagina.locator('form.rc-hoja-pregunta').last();
  await preferencias.waitFor({ state: 'visible' });
  await preferencias.locator('select[id$="-etapa"]').selectOption(ETAPA);
  await preferencias.locator('select[id$="-agenda.nivel-digital"]').selectOption(ETAPA);
  for (const dia of ['1', '3', '5']) {
    await preferencias.locator(`input[id^="dia-"][id$="-${dia}"]`).check();
  }
  await preferencias.locator('input[id^="minutos-"]').fill('60');
  const inicio = await pagina.evaluate(() => {
    const partes = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Madrid',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    const valor = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? '';
    const fecha = new Date(`${valor('year')}-${valor('month')}-${valor('day')}T12:00:00Z`);
    fecha.setUTCDate(fecha.getUTCDate() + 2);
    return fecha.toISOString().slice(0, 10);
  });
  await preferencias.locator('input[id^="inicio-"]').fill(inicio);
  const selectorTarea = preferencias.locator('select[id^="tarea-"]');
  const objetivo = tarea ?? (await selectorTarea.locator('option:not([value=""])').first().innerText());
  await selectorTarea.selectOption({ label: objetivo });
  for (const lengua of await preferencias.locator('input[type=checkbox][id^="idioma-"]').all()) {
    await lengua.check();
  }
  await preferencias.locator('select[id$="-registro"]').selectOption(ACEPTA_CUENTA);
  await preferencias.locator('[type=submit]').click();
  return objetivo;
}

/** Añade el relato largo que usa el ensayo de informe. */
async function anadirTareaPropia(pagina: Page, tarea: string): Promise<void> {
  await pagina.locator('#boton-anadir').click();
  await pagina.locator('#mensaje').fill(tarea);
  await pagina.locator('#mensaje').press('Enter');
  const propia = pagina.locator('#lista-tareas li input[type=text]');
  await propia.first().waitFor({ state: 'visible' });
  assert.equal(await propia.first().inputValue(), tarea, 'La tarea propia se conserva entera');
}

/**
 * Desde la primera frase hasta la propuesta de formación abierta, con las preferencias del caso largo.
 */
async function hastaLaPropuesta(
  pagina: Page,
  idioma: Idioma,
  seleccion: Seleccion,
  { alVer, soloOficiales = false }: { alVer?: (fase: string) => Promise<void>; soloOficiales?: boolean } = {},
): Promise<string> {
  const textos = TEXTOS[idioma];
  await pagina.locator('#conversacion .rc-mensaje').first().waitFor();
  await pagina.locator('#mensaje').fill(textos.descripcion);
  await pagina.locator('#mensaje').press('Enter');
  await elegirOcupacionEnElChat(pagina, () => alVer?.('ocupacion') ?? Promise.resolve());
  const oficiales = pagina.locator('#bloques-oficiales input[type=checkbox]');
  await oficiales.first().waitFor({ state: 'visible' });
  await alVer?.('tareas');
  for (const indice of INDICES_TAREAS) {
    await oficiales.nth(indice).check();
  }
  if (!soloOficiales) {
    await anadirTareaPropia(pagina, textos.tarea);
  }
  for (const fila of await pagina.locator('[data-tarea]:visible').all()) {
    await fila.locator('input[type=radio][value="mucho"]').check();
  }
  await pagina.locator('#form-tareas [type=submit]').click();
  await pagina.locator('#sugerencias .rc-sugerencia').filter({ hasText: textos.si }).click();
  const objetivo = await completarPreferencias(pagina, soloOficiales ? null : textos.tarea);
  await esperarPropuesta(pagina);
  await alVer?.('propuesta');
  if (seleccion === 'maxima') {
    await confirmarRequisitos(pagina);
  }
  return objetivo;
}

/**
 * Captura de la vista. En WebKit, la captura de Playwright inserta un <style> en la página que la CSP real bloquea
 * (style-src-elem inline): se omite allí para no atribuir a Faro un bloqueo que provoca el ensayo.
 */
async function capturar(pagina: Page, ruta: string): Promise<void> {
  if (pagina.context().browser()?.browserType().name() !== 'webkit') {
    await pagina.screenshot({ path: ruta, caret: 'initial' });
  }
}

/** Datos visibles del plan impreso: dos fichas, sus fuentes y la agenda elegida. */
async function leerDocumento(pagina: Page) {
  return pagina.locator('#hoja-de-ruta .hd[data-plan-elegido]').evaluate((raiz) => ({
    idioma: raiz.getAttribute('lang'),
    hojas: raiz.querySelectorAll('.hd-hoja').length,
    titulo: raiz.querySelector('#hd-titulo')?.textContent ?? '',
    folio: raiz.querySelector('.hd-banda span:last-child')?.textContent ?? '',
    objetivo: raiz.querySelector('.pe-objetivo')?.textContent ?? '',
    agenda: raiz.querySelector('.pe-tabla-agenda')?.textContent ?? '',
    fichas: [...raiz.querySelectorAll('.pe-ficha-compacta')].map((ficha) => ({
      texto: ficha.textContent ?? '',
      titulo: ficha.querySelector('h4')?.textContent ?? '',
      url: ficha.querySelector('a.pe-enlace')?.getAttribute('href') ?? '',
      rel: ficha.querySelector('a.pe-enlace')?.getAttribute('rel') ?? '',
    })),
  }));
}

/**
 * Sin red, el navegador escribe «Failed to load resource» (o su equivalente) por las peticiones que la web hace a la red
 * a propósito y que maneja: la política de secciones (secciones.js conserva la última recibida), /api/salud
 * (acceso.js no renueva nada sin respuesta) y la recarga del recorrido detrás del portal, que el service worker
 * contesta con su página de estado y un 503 (recargarSinRedTrasElPortal). Solo esas rutas del propio origen y solo sin
 * red; cualquier otro error de consola, conectado o sin red, hace fallar la guardia.
 */
const SIN_RED_A_PROPOSITO = new Set(['/secciones.json', '/api/salud', '/recorrido.html']);
/**
 * WebKit rechaza las reglas de especulación (reglas-de-especulacion.json) en un origen sin HTTPS; el servidor de este
 * ensayo es HTTP en 127.0.0.1 y una instalación real sirve HTTPS. Solo ese texto exacto, sin URL, en ese origen.
 */
const PREFETCH_SIN_HTTPS = 'Prefetch request denied: URL must be secure (HTTPS)';
// En WebKitGTK la directiva de teclado de Android se ignora; el recorrido usa visualViewport en ese motor.
const AVISO_TECLADO_WEBKIT = 'Viewport argument key "interactive-widget" not recognized and ignored.';
export interface MensajeDeConsola {
  fase: 'conectada' | 'sin-red';
  tipo: string;
  texto: string;
  url: string;
}

export function comprobarConsolaDeFormacion(
  consola: readonly MensajeDeConsola[],
  origen: string,
  motor: EntornoObservacion['motor'],
  plataforma: NodeJS.Platform = process.platform,
) {
  const http = new URL(origen).protocol === 'http:';
  const reconocidos = consola.filter((mensaje) => {
    if (mensaje.texto === AVISO_TECLADO_WEBKIT) {
      return (
        motor === 'webkit' &&
        plataforma === 'linux' &&
        mensaje.fase === 'conectada' &&
        mensaje.tipo === 'error' &&
        mensaje.url === `${origen}/recorrido.html`
      );
    }
    const url = URL.canParse(mensaje.url) ? new URL(mensaje.url) : null;
    const prefetch = http && mensaje.texto === PREFETCH_SIN_HTTPS && mensaje.url === '';
    return prefetch || (mensaje.fase === 'sin-red' && url?.origin === origen && SIN_RED_A_PROPOSITO.has(url.pathname));
  });
  const errores = consola.filter((mensaje) => !reconocidos.includes(mensaje));
  assert.deepEqual(errores, [], 'El recorrido de formación escribió errores en la consola');
  return reconocidos;
}

/** Las veces que la página ha pedido imprimir, contadas en lugar del diálogo del sistema. */
type ConImpresiones = { impresiones: number };

/** Cada hoja del documento de formación medida en el medio de impresión, con sus recortes. */
async function medirHojasDeFormacion(pagina: Page) {
  return pagina.locator('#hoja-de-ruta .hd-hoja').evaluateAll(
    (elementos, tolerancia) =>
      elementos.map((hoja) => ({
        alto: hoja.clientHeight,
        ancho: hoja.clientWidth,
        contenidoAncho: hoja.scrollWidth,
        finDelCuerpo: hoja.querySelector('.hd-cuerpo')?.getBoundingClientRect().bottom,
        principioDelPie: (() => {
          const pie = hoja.querySelector('.hd-pie');
          return pie && getComputedStyle(pie).display !== 'none' ? pie.getBoundingClientRect().top : null;
        })(),
        // Las cajas que recortan lo que llevan dentro (overflow hidden o clip con más contenido que caja).
        recortes: [hoja, ...hoja.querySelectorAll('*')]
          .filter((caja) => {
            const estilo = getComputedStyle(caja);
            return (
              /hidden|clip/u.test(`${estilo.overflowX} ${estilo.overflowY}`) &&
              (caja.scrollHeight > caja.clientHeight + tolerancia || caja.scrollWidth > caja.clientWidth + tolerancia)
            );
          })
          .map((caja) => `${caja.tagName.toLowerCase()}.${caja.className}`),
      })),
    TOLERANCIA_PX,
  );
}

/**
 * Al imprimir, cada hoja crece con su contenido y sigue en la página siguiente: lo que tiene que caber es el ancho,
 * nada queda recortado y el pie va detrás del cuerpo. Que todo el texto llegue al papel lo comprueba pdfDe sobre el PDF.
 */
async function comprobarHojasDeFormacion(pagina: Page): Promise<void> {
  const hojas = await medirHojasDeFormacion(pagina);
  assert.equal(hojas.length, HOJAS_DE_LA_HOJA, 'La hoja de ruta conserva sus dos hojas');
  for (const [indice, hoja] of hojas.entries()) {
    const medidas = `hoja ${indice + 1}: ${JSON.stringify(hoja)}`;
    assert(hoja.alto > 0, `La hoja se compone al imprimir (${medidas})`);
    assert(hoja.contenidoAncho <= hoja.ancho + TOLERANCIA_PX, `Los nombres y enlaces caben en el ancho (${medidas})`);
    assert.deepEqual(hoja.recortes, [], `Nada queda recortado (${medidas})`);
    assert(hoja.finDelCuerpo !== undefined, medidas);
    if (hoja.principioDelPie !== null) {
      assert(hoja.finDelCuerpo <= hoja.principioDelPie + TOLERANCIA_PX, `El pie va detrás del cuerpo (${medidas})`);
    }
  }
}

const HOJA_DE_RUTA = '#hoja-de-ruta .hd';

/**
 * El folio exacto con que empieza cada página del PDF («N / M» de @page informe y @page formacion, sin espacios, con el
 * total del PDF), para unas páginas que empiezan en la página `desde` (contada desde 0): se exige en cada página y se
 * quita para leer seguido un párrafo que pasa de página.
 */
const folioDelPdf =
  (total: number, desde = 0) =>
  (indice: number) =>
    `${desde + indice + 1}/${total}`;

/** Cada página del PDF empieza por su folio con el total real. */
function comprobarFolios(paginas: readonly PaginaPdf[], destino: string): void {
  const folio = folioDelPdf(paginas.length);
  for (const [indice, { texto }] of paginas.entries()) {
    assert(
      texto.normalize('NFC').replace(/\s+/gu, '').startsWith(folio(indice)),
      `La página ${indice + 1} empieza por su folio «${indice + 1} / ${paginas.length}» (${destino})`,
    );
  }
}

/** Los trozos que unas páginas no llevan tantas veces como la pantalla (faltanEnElPapel). */
function faltanEn(paginas: readonly PaginaPdf[], trozos: readonly string[], folio: (indice: number) => string | null) {
  return faltanEnElPapel(
    papelSinFolio(
      paginas.map(({ texto }) => texto),
      folio,
    ),
    trozos,
  );
}

/**
 * El texto del informe tal como se ve en pantalla. En la vista de la hoja de ruta el informe no está a la vista: se
 * enseña un momento como lo hace «Leer el informe» (documento-informe.js, sin data-vista en #paso-4), se lee y se
 * devuelve #paso-4 a la vista que tenía.
 */
async function textoDelInformeEnPantalla(pagina: Page): Promise<{ texto: string[]; pies: string[]; serie: boolean }> {
  const vista = await pagina.evaluate(() => {
    const paso = document.querySelector<HTMLElement>('#paso-4');
    const anterior = paso?.dataset.vista ?? null;
    delete paso?.dataset.vista;
    return anterior;
  });
  await estabilizar(pagina);
  await comprobarContextosEnPantalla(pagina);
  const serie = await serieAnualEnPantalla(pagina);
  const texto = await textoVisible(pagina, '#informe', SOLO_EN_PANTALLA);
  const pies = await textoVisible(pagina, '#informe', SOLO_EN_PANTALLA, PIE_DEL_INFORME);
  await pagina.evaluate((anterior) => {
    const paso = document.querySelector<HTMLElement>('#paso-4');
    if (paso && anterior !== null) {
      paso.dataset.vista = anterior;
    }
  }, vista);
  await estabilizar(pagina);
  return { texto, pies, serie };
}

/**
 * Las páginas del informe en «los dos»: exactamente dos páginas, todo lo que muestra su pantalla, letra no menor que la
 * de la hoja aprobada (salvo los textos para lectores de pantalla que se imprimen, `lectores`) y, en cada página, algo
 * más que su folio y su pie.
 */
function comprobarInformeDelante(
  paginas: readonly PaginaPdf[],
  folio: (indice: number) => string,
  informe: { texto: string[]; pies: string[]; lectores: readonly string[] },
  destino: string,
): void {
  assert.equal(paginas.length, HOJAS_DEL_INFORME, `El informe ocupa exactamente dos páginas (${destino})`);
  assert.deepEqual(faltanEn(paginas, informe.texto, folio), [], 'El informe va entero delante de la hoja de ruta');
  comprobarLetraDelPdf(paginas, folio, informe.lectores);
  comprobarPaginasConCuerpo(
    paginas.map(({ texto }) => texto),
    folio,
    informe.pies,
  );
}

/**
 * Las páginas de la hoja de ruta al final del PDF: las últimas que contienen todo su texto de pantalla, exactamente dos
 * páginas, con la letra de la hoja aprobada (salvo los textos para lectores de pantalla que se imprimen, `lectores`) y
 * cuerpo en cada una. Devuelve el índice de su primera página.
 */
function comprobarHojaAlFinal(
  paginas: readonly PaginaPdf[],
  hoja: { texto: string[]; pies: string[]; lectores: readonly string[] },
  destino: string,
): number {
  const total = paginas.length;
  let inicio = total;
  while (inicio > 0 && faltanEn(paginas.slice(inicio), hoja.texto, folioDelPdf(total, inicio)).length > 0) {
    inicio -= 1;
  }
  const deLaHoja = paginas.slice(inicio);
  const folio = folioDelPdf(total, inicio);
  assert.deepEqual(faltanEn(deLaHoja, hoja.texto, folio), [], 'La hoja de ruta está entera en el PDF');
  assert.equal(deLaHoja.length, HOJAS_DE_LA_HOJA, `La formación ocupa exactamente dos páginas (${destino})`);
  comprobarLetraDelPdf(deLaHoja, folio, hoja.lectores);
  comprobarPaginasConCuerpo(
    deLaHoja.map(({ texto }) => texto),
    folio,
    hoja.pies,
  );
  return inicio;
}

/** Exige el total físico al imprimir formación sola o los dos documentos. */
export function comprobarTotalDePaginas(total: number, conInforme: boolean): void {
  assert.equal(
    total,
    conInforme ? HOJAS_DEL_INFORME + HOJAS_DE_LA_HOJA : HOJAS_DE_LA_HOJA,
    conInforme ? 'El PDF combinado ocupa cuatro páginas' : 'El PDF de formación ocupa dos páginas',
  );
}

/**
 * La hoja de ruta sola: exactamente dos páginas, con todo el texto que muestra la pantalla salvo sus folios de
 * pantalla, letra no menor que la de la hoja aprobada y cuerpo en cada página. Los dos: el informe con sus páginas reales
 * (exactamente dos páginas, todo lo que muestra su pantalla, letra no menor que la de la hoja aprobada y texto legible en
 * cada página) y, detrás, la hoja de ruta igual que sola. Las páginas de la hoja de ruta son las últimas que contienen
 * todo su texto; las de delante son del informe. Cada página del PDF empieza por su folio con el total real y lleva algo
 * más que su folio y su pie. Devuelve, entre otras medidas, las páginas de la hoja de ruta.
 */
async function pdfDe(pagina: Page, destino: string, conInforme: boolean) {
  const hojaDeRuta = await textoVisible(pagina, HOJA_DE_RUTA, SOLO_EN_PANTALLA_DE_LA_HOJA);
  const piesDeLaHoja = await textoVisible(pagina, HOJA_DE_RUTA, SOLO_EN_PANTALLA_DE_LA_HOJA, '.hd-pie');
  const informe = conInforme ? await textoDelInformeEnPantalla(pagina) : { texto: [], pies: [], serie: false };
  await pagina.emulateMedia({ media: 'print' });
  // Como en el informe (recorrido.ts, imprimir): se mide la composición de impresión ya recalculada.
  await estabilizar(pagina);
  await comprobarHojasDeFormacion(pagina);
  const lectores = await textosDeLectoresImpresos(pagina);
  const tablaAnual = await serieAnualEnPapel(pagina, informe.serie);
  await pagina.pdf({ path: destino, format: 'A4', printBackground: true });
  await pagina.emulateMedia({ media: null });
  const bytes = readFileSync(destino);
  assert.equal(bytes.subarray(0, CABECERA_PDF.length).toString(), CABECERA_PDF);
  assert(bytes.includes(Buffer.from('%%EOF')), 'El PDF debe estar terminado');
  const paginas = leerPdf(bytes);
  comprobarFolios(paginas, destino);
  const total = paginas.length;
  comprobarTotalDePaginas(total, conInforme);
  const inicioDeLaHoja = comprobarHojaAlFinal(paginas, { texto: hojaDeRuta, pies: piesDeLaHoja, lectores }, destino);
  const paginasDelInforme = paginas.slice(0, inicioDeLaHoja);
  if (conInforme) {
    comprobarInformeDelante(paginasDelInforme, folioDelPdf(total), { ...informe, lectores }, destino);
    assert.deepEqual(
      faltanEn(paginasDelInforme, tablaAnual, folioDelPdf(total)),
      [],
      'La tabla anual completa llega al PDF combinado',
    );
  } else {
    assert.equal(paginasDelInforme.length, 0, `El PDF de la hoja de ruta no lleva otras páginas (${destino})`);
  }
  return {
    archivo: destino,
    bytes: bytes.length,
    sha256: huella(bytes),
    paginas: total,
    paginasDelInforme: paginasDelInforme.length,
    paginasDeLaHoja: total - inicioDeLaHoja,
  };
}

/** «Guardar en PDF o imprimir» de la hoja y «Guardar los dos»: piden imprimir sin aviso de bloqueo; en Chromium, PDF. */
async function imprimirFormacion(pagina: Page, salida: string, nombre: string) {
  await pagina.evaluate(() => {
    const ventana = window as unknown as ConImpresiones & Window;
    ventana.impresiones = 0;
    ventana.print = () => {
      ventana.impresiones += 1;
    };
  });
  const chromium = pagina.context().browser()?.browserType().name() === 'chromium';
  const clases = () => pagina.evaluate(() => document.documentElement.className);
  const bloqueo = () => pagina.locator('#hd-error-impresion').allInnerTexts();
  await pagina.locator('#conversacion .rc-documento-hoja button.rc-boton-secundario').last().click();
  assert.deepEqual(await bloqueo(), [], 'La hoja vigente se puede imprimir');
  assert.match(await clases(), /\bimprimir-hoja\b/u, 'Se imprime solo la hoja de ruta');
  if (await pagina.locator('#volver-documentos').count()) {
    await pagina.locator('#conversacion .rc-documento-hoja a.rc-boton-principal').last().click();
  }
  const hoja = chromium ? await pdfDe(pagina, join(salida, `${nombre}-hoja.pdf`), false) : null;
  if (await pagina.locator('#volver-documentos').isVisible()) {
    await pagina.locator('#volver-documentos').click();
  }
  await pagina.locator('#conversacion .rc-carpeta-los-dos').last().click();
  assert.deepEqual(await bloqueo(), [], 'Los dos documentos se pueden imprimir');
  assert.match(await clases(), /\bimprimir-los-dos\b/u, 'Se imprimen el informe y la hoja seguidos');
  if (await pagina.locator('#volver-documentos').count()) {
    await pagina.locator('#conversacion .rc-documento-hoja a.rc-boton-principal').last().click();
  }
  const dos = chromium ? await pdfDe(pagina, join(salida, `${nombre}-los-dos.pdf`), true) : null;
  if (await pagina.locator('#volver-documentos').isVisible()) {
    await pagina.locator('#volver-documentos').click();
  }
  const impresiones = await pagina.evaluate(() => (window as unknown as ConImpresiones).impresiones);
  assert.equal(impresiones, 2, 'Los dos botones de la carpeta llaman a window.print');
  return { impresiones, hoja, losDos: dos };
}

/** Elige una oferta real por bloque; en el caso extenso usa los nombres más largos. */
async function elegirDosCursos(pagina: Page, seleccion: Seleccion, enElCatalogo: CatalogoDelEnsayo) {
  const disponibles = await cursosDeLaPropuesta(pagina);
  const elegir = (bloque: 'ia' | 'digital') => {
    const candidatas = disponibles.filter((c) => c.bloque === bloque);
    assert(candidatas.length > 0, `Hay al menos una oferta disponible en ${bloque}`);
    if (seleccion === 'maxima') {
      candidatas.sort((a, b) => b.nombre.length - a.nombre.length);
    }
    const curso = candidatas[0];
    assert(curso?.id, `La oferta de ${bloque} tiene un radio identificable`);
    return curso;
  };
  const elegidas = [elegir('ia'), elegir('digital')];
  assert.notEqual(elegidas[0]?.id, elegidas[1]?.id, 'Se escogen dos ofertas distintas');
  const cursos = [];
  for (const curso of elegidas) {
    assert(curso.nombre.trim() && curso.resumen.trim(), 'Cada curso tiene nombre y resumen visibles');
    assert(curso.enlace.trim(), 'El enlace a la ficha oficial tiene texto');
    assert.equal(new URL(curso.url).protocol, 'https:', `Enlace seguro: ${curso.url}`);
    assert.equal(curso.destino, '_blank');
    assert.equal(curso.rel, 'noopener noreferrer');
    assert(enElCatalogo(curso.url), `El curso está en el catálogo publicado: ${curso.url}`);
    const dato = enElCatalogo.buscar(curso.unidadId);
    assert(dato, 'La unidad elegida existe en el catálogo publicado');
    assert.equal(dato.oferta.url, curso.url);
    assert.equal(dato.oferta.titulo_programa, curso.nombre);
    // La fila compacta dice primero quién imparte el curso, con el nombre del catálogo publicado.
    assert(curso.resumen.startsWith(`${dato.proveedor} · `), `La fila dice quién imparte: ${curso.resumen}`);
    cursos.push({ ...curso, proveedor: dato.proveedor });
    const radio = pagina.locator(`#${curso.id}`);
    const grupo = radio.locator('xpath=ancestor::fieldset');
    for (let intento = 0; !(await radio.isVisible()) && intento < disponibles.length; intento += 1) {
      const siguiente = grupo.locator('.rc-plan-paginas button').last();
      assert(
        (await siguiente.isVisible()) && (await siguiente.isEnabled()),
        `La oferta ${curso.id} debe aparecer al paginar`,
      );
      await siguiente.click();
    }
    await radio.check();
  }
  const elegidos = pagina.locator('section.rc-hoja:not(.rc-hoja-cerrada) input[type=radio]:checked');
  assert.equal(await elegidos.count(), 2, 'Hay exactamente dos elecciones explícitas');
  return cursos;
}

/**
 * El día de un instante en hora de Barcelona, como lo escribe el aviso del enlace: «25 oct. 2026». El módulo de fechas
 * de la web escribe lo mismo en los tres navegadores (pruebas/navegadores/fechas.test.mjs), así que lo esperado es fijo.
 */
function enBarcelona(instante: string, idioma: Idioma): string {
  return fechaCorta(partesEnZona(instante, ZONA_BARCELONA), idioma);
}

/**
 * Coteja la ficha con los hechos del catálogo, sin tratar el límite como una fecha de matrícula. Cada fecha se coteja
 * hasta el punto que cierra su frase: una hora o un texto de más detrás de la fecha no se da por bueno.
 */
export function comprobarDatosDeFicha(texto: string, oferta: OfertaCatalogo, idioma: Idioma): void {
  const ca = idioma === 'ca';
  const comprobada = ca ? 'Faro va comprovar l’oferta' : 'Faro comprobó la oferta';
  assert(
    texto.includes(`${comprobada} ${diaDeCursoEnFrase(oferta.comprobado_el, idioma, 'el')}.`),
    'La ficha conserva la comprobación de la oferta',
  );
  const publicadaHasta = ca ? 'està publicada' : 'está publicada';
  if (oferta.cierra_el) {
    assert(
      texto.includes(`${publicadaHasta} ${fechaDeCursoEnFrase(oferta.cierra_el, idioma, 'hasta')}.`),
      'La ficha conserva el límite publicado aplicable',
    );
  } else {
    assert(!texto.includes(publicadaHasta), 'Sin límite publicado, la ficha no presenta ninguno');
  }
  const modalidad = oferta.hechos.modalidad;
  const nombres: Record<string, Record<Idioma, string>> = {
    'en-linea': { es: 'En línea', ca: 'En línia' },
    presencial: { es: 'Presencial', ca: 'Presencial' },
    mixta: { es: 'Mixta', ca: 'Mixta' },
  };
  const nombre = typeof modalidad.valor === 'string' ? nombres[modalidad.valor]?.[idioma] : undefined;
  if (modalidad.motivo === 'conocido' && nombre) {
    assert(texto.includes(nombre), 'La modalidad procede del catálogo');
  }
  if (oferta.incidencia_enlace_el) {
    assert(
      texto.includes(`(${enBarcelona(oferta.incidencia_enlace_el, idioma)})`),
      'La incidencia observada conserva su fecha',
    );
  }
}

/** Comprueba que el informe se abre desde la entrega y permite volver a ella. */
async function comprobarInformeEnEntrega(pagina: Page): Promise<void> {
  await pagina.locator('.rc-cuerpo[data-entrega="final"]').waitFor({ state: 'visible', timeout: 15_000 });
  const carpeta = pagina.locator('.rc-entrega-final .rc-carpeta');
  await carpeta.locator('.rc-documento:not(.rc-documento-hoja) a.rc-boton-principal').click();
  await pagina.locator('#paso-4 #informe .informe-breve').waitFor({ state: 'visible' });
  await pagina.locator('#volver-documentos').click();
  await carpeta.waitFor({ state: 'visible' });
}

/** Cancela el reinicio y comprueba que volver a tareas conserva la navegación. */
export async function comprobarSalidaFinal(pagina: Page): Promise<void> {
  const carpeta = pagina.locator('.rc-entrega-final .rc-carpeta');
  await carpeta.locator('[data-nueva-conversacion]').click();
  const dialogo = pagina.locator('#dialogo-nueva');
  assert.equal(await dialogo.evaluate((d) => (d as HTMLDialogElement).open), true);
  await dialogo.evaluate((d) => (d as HTMLDialogElement).close());
  assert.equal(await carpeta.isVisible(), true, 'Cancelar conserva la carpeta');
  await carpeta.locator('[data-volver="3"]').click();
  assert.equal(await pagina.locator('.rc-cuerpo').getAttribute('data-entrega'), null);
  await pagina.locator('#tarjeta-tareas').waitFor({ state: 'visible' });
  assert.equal(await pagina.locator('#volver-documentos').count(), 0);
  await pagina.locator('[data-nueva-conversacion]:visible').first().click();
  await pagina.locator('#confirmar-dialogo-nueva').click();
  await pagina.locator('.rc-cuerpo[data-paso="1"]').waitFor({ state: 'visible' });
  assert.equal(await pagina.locator('#volver-documentos').count(), 0);
}

/** Selecciona solo una acreditación realmente ofrecida; si no existe, deja constancia. */
async function esperarEntregaDeFormacion(pagina: Page, acreditacion: 'primera' | 'omitir') {
  const eleccion = pagina.locator('#conversacion .rc-acreditaciones').last();
  const tarjeta = pagina.locator('#conversacion .rc-documento-hoja').last();
  await pagina.locator('#conversacion .rc-acreditaciones, #conversacion .rc-documento-hoja').last().waitFor({
    state: 'visible',
    timeout: PLAZO_PROPUESTA_MS,
  });
  let certificado: { codigo: string; nombre: string } | null = null;
  if (await eleccion.isVisible()) {
    if (acreditacion === 'primera') {
      const opcion = eleccion.locator('button.rc-acreditacion-opcion').first();
      const codigoVisible = (await opcion.locator('.rc-acreditacion-codigo').innerText()).trim();
      const codigo = /[A-Z]{4}\d{4}$/u.exec(codigoVisible)?.[0];
      const nombre = (await opcion.locator('.rc-acreditacion-nombre').innerText()).trim();
      assert(codigo && nombre, 'La tarjeta ofrece el código y el nombre del certificado');
      certificado = { codigo, nombre };
      await opcion.click();
    } else {
      await eleccion.locator('button.rc-boton-secundario').click();
    }
  }
  return { tarjeta, certificado };
}

/** Comprueba en el documento y su PDF la identidad elegida de la lista real. */
async function comprobarCertificado(pagina: Page, archivo: string, certificado: { codigo: string; nombre: string }) {
  const normalizar = (s: string) => s.normalize('NFC').replace(/\s+/gu, '').toLocaleLowerCase('es');
  const pantalla = normalizar((await pagina.locator('#hoja-de-ruta .pe-acreditacion').textContent()) ?? '');
  const papel = normalizar(
    leerPdf(readFileSync(archivo))
      .map((p) => p.texto)
      .join(' '),
  );
  for (const valor of [certificado.codigo, certificado.nombre]) {
    assert(pantalla.includes(normalizar(valor)), `El documento conserva ${valor}`);
    assert(papel.includes(normalizar(valor)), `El PDF conserva ${valor}`);
  }
}

/** Las fichas siguen siendo las dos elecciones y proceden del catálogo del artefacto. */
function comprobarFichasElegidas(
  documento: Awaited<ReturnType<typeof leerDocumento>>,
  cursos: Awaited<ReturnType<typeof elegirDosCursos>>,
  enElCatalogo: CatalogoDelEnsayo,
  idioma: Idioma,
): void {
  for (const [indice, curso] of cursos.entries()) {
    const ficha = documento.fichas[indice];
    assert(ficha, `Existe la ficha del curso ${indice + 1}`);
    assert(ficha.titulo.includes(curso.nombre) && ficha.texto.includes(curso.proveedor));
    assert.equal(ficha.url, curso.url, 'La ficha conserva la URL exacta de la elección');
    assert.equal(ficha.rel, 'noopener noreferrer');
    const datos = enElCatalogo.buscar(curso.unidadId);
    assert(datos);
    comprobarDatosDeFicha(ficha.texto, datos.oferta, idioma);
  }
}

/** Propuesta → confirmación → carpeta → documento abierto; comprueba lo que ve la persona en cada punto. */
export async function recorrerFormacion(opciones: {
  pagina: Page;
  idioma: Idioma;
  enElCatalogo: CatalogoDelEnsayo;
  salida: string;
  nombre: string;
  seleccion: Seleccion;
  alVer?: (fase: string) => Promise<void>;
  probarEntregaFinal?: boolean;
  acreditacion?: 'primera' | 'omitir';
  soloOficiales?: boolean;
}) {
  const { pagina, idioma, enElCatalogo, salida, nombre } = opciones;
  const textos = TEXTOS[idioma];
  const objetivo = await hastaLaPropuesta(pagina, idioma, opciones.seleccion, opciones);
  const cursos = await elegirDosCursos(pagina, opciones.seleccion, enElCatalogo);
  await pagina.locator(`${PROPUESTA_ABIERTA} .rc-boton-principal`).last().click();
  const { tarjeta, certificado } = await esperarEntregaDeFormacion(pagina, opciones.acreditacion ?? 'omitir');
  await tarjeta.waitFor({ state: 'visible', timeout: PLAZO_PROPUESTA_MS });
  if (opciones.probarEntregaFinal) {
    await comprobarInformeEnEntrega(pagina);
  }
  await opciones.alVer?.('entrega');
  const resumen = await tarjeta.innerText();
  assert.match(resumen, /\b2\b/u, 'La carpeta cuenta los dos cursos elegidos');
  await tarjeta.locator('a.rc-boton-principal').click();
  await pagina.locator('#paso-4[data-vista="hoja"] #hoja-de-ruta .hd[data-plan-elegido]').waitFor({ state: 'visible' });
  await estabilizar(pagina);
  const documento = await leerDocumento(pagina);
  assert.equal(documento.idioma, idioma, 'El documento declara el idioma del recorrido');
  assert.equal(documento.hojas, HOJAS_DE_LA_HOJA);
  assert.equal(documento.titulo, textos.titulo);
  assert.equal(documento.folio, textos.folio);
  assert.equal(documento.objetivo, objetivo, 'El objetivo conserva la tarea elegida');
  assert(documento.agenda.trim(), 'La hoja refleja la agenda personal');
  assert.equal(documento.fichas.length, 2, 'El documento contiene solo las dos ofertas elegidas');
  comprobarFichasElegidas(documento, cursos, enElCatalogo, idioma);
  await capturar(pagina, join(salida, `${nombre}.png`));
  const acreditacionEnPantalla = certificado
    ? await pagina.locator('#hoja-de-ruta .pe-acreditacion').innerText()
    : null;
  if (await pagina.locator('#volver-documentos').isVisible()) {
    await pagina.locator('#volver-documentos').click();
  }
  const impresion = await imprimirFormacion(pagina, salida, nombre);
  if (certificado && impresion.hoja) {
    await comprobarCertificado(pagina, impresion.hoja.archivo, certificado);
  }
  const nombreMasLargo = Math.max(...cursos.map((curso) => curso.nombre.length));
  return { cursos, documento, impresion, nombreMasLargo, certificado, acreditacionEnPantalla };
}

/** Consulta de las ofertas exactas de la construcción ensayada. */
export type CatalogoDelEnsayo = ((url: string) => boolean) & {
  buscar: (id: string) => { oferta: OfertaCatalogo; proveedor: string } | null;
};
/** Construye el cotejo desde los bytes del catálogo, tanto en local como en el ensayo remoto. */
export function consultaDelCatalogo(catalogo: EntregaCatalogo): CatalogoDelEnsayo {
  const proveedor = new Map(catalogo.proveedores.map((p) => [p.id, p.nombre]));
  const buscar = (id: string) => {
    const oferta = catalogo.ofertas.find((o) => o.unidad.id === id);
    if (!oferta) {
      return null;
    }
    const nombre = proveedor.get(oferta.proveedor_id);
    return nombre ? { oferta, proveedor: nombre } : null;
  };
  return Object.assign((url: string) => catalogo.ofertas.some((o) => o.url === url), { buscar });
}
/** Lee el catálogo que contiene exactamente la construcción bajo ensayo. */
export function catalogoPublicado(artefacto: Artefacto): CatalogoDelEnsayo {
  const archivos = [...artefacto.fichas.keys()].filter((ruta) =>
    /^web\/datos\/catalogo-cursos\/[^/]+\.json$/u.test(ruta),
  );
  assert.equal(archivos.length, 1, 'La construcción publica un catálogo de cursos');
  const ruta = archivos[0];
  assert(ruta);
  return consultaDelCatalogo(JSON.parse(artefacto.leer(ruta).toString('utf8')) as EntregaCatalogo);
}

/**
 * Apaga el servidor propio y recarga: detrás del portal de la construcción privada, la página de estado de Faro con su
 * 503 (recargarSinRedTrasElPortal), nunca la web guardada. La copia sin red de una instalación pública la prueban las
 * del service worker (pruebas/web-service-worker/recorrido-sin-red.test.ts).
 */
async function sinRed(pagina: Page, fixture: Fixture, idioma: Idioma) {
  await fixture.apagar();
  await assert.rejects(
    fetch(`${fixture.origen}/recorrido.html`, {
      headers: { ...IDENTIDAD_WEB },
      signal: AbortSignal.timeout(PLAZO_INACCESIBILIDAD_MS),
    }),
  );
  return recargarSinRedTrasElPortal(pagina, idioma, fixture.origen);
}

/** Recarga con el servidor encendido, para empezar otro recorrido de formación desde el principio. */
async function recargar(pagina: Page, idioma: Idioma): Promise<void> {
  assert.equal((await pagina.reload({ waitUntil: 'load' }))?.status(), ESTADO_HTTP.correcto);
  await pagina.waitForFunction((elegido) => document.documentElement.lang === elegido, idioma);
}

/**
 * Caso de nombres largos con requisitos confirmados: el documento debe ocupar dos páginas sin perder contenido. Se completa aunque falle, para conservar la evidencia (cursos, aviso visible, captura, medidas);
 * quien llama convierte `fallo` en una guardia fallida.
 */
async function seleccionMaxima(opciones: Parameters<typeof recorrerFormacion>[0]) {
  const { pagina, salida, nombre } = opciones;
  try {
    const visto = await recorrerFormacion(opciones);
    return { correcto: true, cursos: visto.cursos.length, fallo: '', aviso: [] as string[] };
  } catch (error) {
    await capturar(pagina, join(salida, `${nombre}-fallo.png`));
    return {
      correcto: false,
      cursos: await pagina.locator('#hoja-de-ruta .pe-ficha-compacta').count(),
      fallo: String(error),
      aviso: await pagina.locator('#hd-error-impresion').allInnerTexts(),
      medidas: await medirHojasEnImpresion(pagina),
    };
  }
}

/** Enseña la hoja de ruta para medirla en papel aunque esté bloqueada por vigencia; devuelve si lo estaba. */
function prepararMedida(pagina: Page): Promise<boolean> {
  return pagina.evaluate(() => {
    const raiz = document.documentElement;
    const bloqueada = raiz.classList.contains('formacion-no-imprimible');
    raiz.classList.remove('formacion-no-imprimible');
    raiz.classList.add('imprimir-hoja');
    return bloqueada;
  });
}

/** Deja las clases de <html> como estaban antes de prepararMedida. */
async function restaurar(pagina: Page, bloqueada: boolean): Promise<void> {
  await pagina.evaluate((estaba) => {
    const raiz = document.documentElement;
    raiz.classList.remove('imprimir-hoja');
    raiz.classList.toggle('formacion-no-imprimible', estaba);
  }, bloqueada);
}

/**
 * Diagnóstico de un fallo: cada hoja en el medio de impresión (alto, ancho, recortes, cuerpo y pie) y lo que ocupa cada
 * parte, aunque la hoja esté bloqueada por vigencia.
 */
async function medirHojasEnImpresion(pagina: Page) {
  await pagina.emulateMedia({ media: 'print' });
  const bloqueada = await prepararMedida(pagina);
  try {
    await estabilizar(pagina);
    const hojas = await medirHojasDeFormacion(pagina);
    const partes = await pagina.locator('#hoja-de-ruta .hd-hoja').evaluateAll((elementos) =>
      elementos.map((hoja) =>
        [...hoja.querySelectorAll('.hd-cuerpo > *')].map((parte) => ({
          parte: `${parte.className} ${parte.querySelector('h3')?.textContent ?? ''}`.trim(),
          alto: Math.round(parte.getBoundingClientRect().height),
        })),
      ),
    );
    return hojas.map((hoja, indice) => ({ ...hoja, partes: partes[indice] ?? [] }));
  } finally {
    await restaurar(pagina, bloqueada);
    await pagina.emulateMedia({ media: 'screen' });
  }
}

function registrarConsola(pagina: Page) {
  const registro = { fase: 'conectada' as MensajeDeConsola['fase'], consola: [] as MensajeDeConsola[] };
  pagina.on('console', (mensaje) => {
    if (mensaje.type() === 'error') {
      const { fase } = registro;
      registro.consola.push({ fase, tipo: mensaje.type(), texto: mensaje.text(), url: mensaje.location().url });
    }
  });
  return registro;
}

export async function probarFormacion(opciones: {
  pagina: Page;
  fixture: Fixture;
  idioma: Idioma;
  salida: string;
  enElCatalogo: CatalogoDelEnsayo;
}) {
  const { pagina, fixture, idioma } = opciones;
  const registro = registrarConsola(pagina);
  await pagina.addInitScript((elegido) => {
    localStorage.setItem('faro-idioma', elegido);
    localStorage.setItem('faro-modo-elegido', 'ia-off');
  }, idioma);
  assert.equal((await pagina.goto(`${fixture.origen}/recorrido.html`))?.status(), ESTADO_HTTP.correcto);
  await pagina.waitForFunction((elegido) => document.documentElement.lang === elegido, idioma);
  await prepararCopia(pagina);
  const comun = { ...opciones, seleccion: 'primera' as const };
  const conectada = await recorrerFormacion({ ...comun, nombre: `${idioma}-formacion` });
  await recargar(pagina, idioma);
  const maxima = await seleccionMaxima({ ...comun, seleccion: 'maxima', nombre: `${idioma}-formacion-maxima` });
  registro.fase = 'sin-red';
  const desconectada = await sinRed(pagina, fixture, idioma);
  return {
    idioma,
    etapa: ETAPA,
    cursos: conectada.cursos.length,
    nombreMasLargo: conectada.nombreMasLargo,
    letrasDescripcion: TEXTOS[idioma].descripcion.length,
    letrasTarea: TEXTOS[idioma].tarea.length,
    conectada: { documento: conectada.documento, impresion: conectada.impresion },
    sinRed: desconectada,
    seleccionMaxima: maxima,
    consola: registro.consola,
  };
}
