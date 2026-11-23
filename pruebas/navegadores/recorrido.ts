/**
 * Receta pública de ocupación → tareas → informe breve → imprimir/PDF en ES/CA y, con el servidor físicamente apagado,
 * la recarga: detrás del portal de la construcción privada, la página de estado de Faro con 503 y sus textos aprobados,
 * nunca el error del navegador ni el informe. La copia sin red de una instalación pública la prueban las del service
 * worker (pruebas/web-service-worker/recorrido-sin-red.test.ts). La ocupación se elige dentro de la conversación;
 * «Imprimir o guardar en PDF» (en el informe y en su tarjeta de la conversación) llama a window.print, y el PDF lo
 * genera el propio motor del navegador (solo Chromium).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import type { Page } from 'playwright-core';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { IDENTIDAD_WEB } from '../../src/comun/identidad-web.ts';
import { TEXTOS_INSTALACION as INSTALACION_CA } from '../../web/idiomas/ca/instalacion.js';
import { TEXTOS_INSTALACION as INSTALACION_ES } from '../../web/idiomas/es/instalacion.js';
import { apartadoCensalDelEjemplo } from './apartado-censal.ts';
import { huella } from './artefacto.ts';
import type { Fixture } from './fixture.ts';
import { estabilizar } from './observacion.ts';

const TEXTOS_INSTALACION = { es: INSTALACION_ES, ca: INSTALACION_CA };

const PLAZO_PAQUETE_MS = 90_000;
const PLAZO_INACCESIBILIDAD_MS = 1000;
const CABECERA_PDF = '%PDF-';
/** Las hojas del informe breve en pantalla (section.hoja): al imprimir, cada una empieza página. */
export const HOJAS_DEL_INFORME = 2;
const INDICES_TAREAS = [0, 1];
const PASO_TAREAS = '3';
const MAX_RESPUESTAS_OCUPACION = 10;
export type Idioma = 'es' | 'ca';

/** El paso en curso del recorrido (<div class="rc-cuerpo" data-paso>, navegacion.js). */
function pasoEnCurso(pagina: Page): Promise<string | undefined> {
  return pagina.evaluate(() => document.querySelector<HTMLElement>('.rc-cuerpo')?.dataset.paso);
}

/** Lo que puede pulsar la persona en el paso de la ocupación, del más concreto al más general. */
const CONTINUAR_PROPUESTA = '.rc-eleccion-acciones > button.rc-boton-principal:not([disabled]):visible';
const CONTINUAR_TARJETA = '.rc-acciones > button.rc-boton-principal[type="submit"]:not([disabled]):visible';
const RESPUESTA_RAPIDA = '#sugerencias:not([hidden]) .rc-sugerencia:not([disabled]):visible';
/** «Ahora no, solo el informe» (recorrido.agente.solo-informe), en cada idioma. */
const SOLO_EL_INFORME: Record<Idioma, string> = { es: 'Ahora no, solo el informe', ca: 'Ara no, només l’informe' };
/** La ocupación que tiene que proponer Faro para «Soy conductor de autobús urbano»: su grupo de la CIUO-08. */
const GRUPO_ESPERADO = '8331';
const ESCO_DEL_GRUPO = /ESCO 8331\.\d+/;

/**
 * La ocupación se elige dentro de la conversación (ocupacion-local.js y paso-ocupacion.js). Después del pensamiento
 * de Faro, el motor del dispositivo pregunta, con respuestas rápidas debajo, o propone: tarjetas que se eligen dentro
 * del mensaje, con la más parecida ya elegida, y su «Continuar». Antes de continuar se comprueba que la elegida es la
 * del conductor de autobús (grupo 8331, con su ocupación ESCO). Si sale la tarjeta de la ocupación concreta, su
 * «Continuar»; ante una pregunta, la primera respuesta rápida. Así hasta llegar a las tareas.
 */
export async function elegirOcupacionEnElChat(pagina: Page, alVerOcupacion?: () => Promise<void>): Promise<void> {
  let elegida = '';
  for (let vuelta = 0; vuelta < MAX_RESPUESTAS_OCUPACION && (await pasoEnCurso(pagina)) !== PASO_TAREAS; vuelta += 1) {
    const siguiente = pagina.locator(`${CONTINUAR_PROPUESTA}, ${CONTINUAR_TARJETA}, ${RESPUESTA_RAPIDA}`).first();
    await pagina
      .locator(`${CONTINUAR_PROPUESTA}, ${CONTINUAR_TARJETA}, ${RESPUESTA_RAPIDA}, .rc-cuerpo[data-paso="3"]`)
      .first()
      .waitFor({ state: 'visible', timeout: PLAZO_PAQUETE_MS });
    if ((await pasoEnCurso(pagina)) === PASO_TAREAS) {
      break;
    }
    const deLaPropuesta = await siguiente.evaluate((boton) => boton.closest('.rc-eleccion-bloque') !== null);
    if (deLaPropuesta) {
      await alVerOcupacion?.();
      elegida = await siguiente.evaluate(
        (boton) =>
          boton
            .closest('.rc-eleccion-bloque')
            ?.querySelector('.rc-eleccion-casilla:checked')
            ?.closest('.rc-eleccion-opcion')?.textContent ?? '',
      );
      assert.ok(elegida.includes(GRUPO_ESPERADO), `Ocupación propuesta: ${elegida}`);
      assert.match(elegida, ESCO_DEL_GRUPO, `Ocupación propuesta: ${elegida}`);
    }
    await siguiente.click();
  }
  await pagina.waitForFunction(
    (paso) => document.querySelector<HTMLElement>('.rc-cuerpo')?.dataset.paso === paso,
    PASO_TAREAS,
  );
  assert.ok(elegida, 'Faro ha propuesto una ocupación y se ha elegido en sus tarjetas');
}

export async function informe(pagina: Page, idioma: Idioma): Promise<void> {
  await pagina.locator('#conversacion .rc-mensaje').first().waitFor();
  // La bienvenida mantiene la presentación sobre papel y permite contar cualquier ocupación.
  const aspecto = await pagina.locator('.rc-cuerpo .rc').evaluate((hilo) => getComputedStyle(hilo).backgroundImage);
  assert.equal(aspecto, 'none', 'El hilo no vuelve a la trama anterior');
  // El nombre conserva su texto propio; la bienvenida lo presenta en mayúsculas mediante CSS.
  const autor = pagina.locator('#conversacion .rc-autor').first();
  assert.equal((await autor.textContent())?.trim(), 'Faro');
  assert.equal((await autor.innerText()).trim(), 'FARO');
  assert.equal(await pagina.locator('.rc-demo-guiada, .rc-demo-bloqueada').count(), 0);
  assert.ok(await pagina.locator('#mensaje').isEditable(), 'La ocupación se escribe libremente');
  await pagina
    .locator('#mensaje')
    .fill(idioma === 'es' ? 'Soy conductor de autobús urbano' : 'Sóc conductor d’autobús urbà');
  await pagina.locator('#mensaje').press('Enter');
  await elegirOcupacionEnElChat(pagina);
  const tareas = pagina.locator('#bloques-oficiales input[type=checkbox]');
  await tareas.first().waitFor({ state: 'visible' });
  for (const indice of INDICES_TAREAS) {
    await tareas.nth(indice).check();
  }
  for (const fila of await pagina.locator('[data-tarea]:visible').all()) {
    await fila.locator('input[type=radio][value="mucho"]').check();
  }
  await pagina.locator('#form-tareas [type=submit]').click();
  // Faro encarga el informe y ofrece la hoja de ruta: «Ahora no, solo el informe» entrega el informe como documento
  // de la conversación, y su «Leer el informe» lo abre en la página (documento-informe.js).
  await pagina.locator(RESPUESTA_RAPIDA).filter({ hasText: SOLO_EL_INFORME[idioma] }).click();
  const leer = pagina.locator('#conversacion .rc-documento a.rc-boton-principal');
  await leer.waitFor({ state: 'visible', timeout: PLAZO_PAQUETE_MS });
  await leer.click();
  await pagina.locator('#informe [data-titulo-pdf]').waitFor({ state: 'visible' });
  await estabilizar(pagina);
}

/** Las veces que la página ha pedido imprimir, contadas en lugar del diálogo del sistema. */
type ConImpresiones = { impresiones: number };

/**
 * Al imprimir, cada hoja crece con su contenido y sigue en la página siguiente: lo que tiene que caber es el ancho, y el
 * pie no puede tapar el cuerpo. El último bloque de la hoja va en el cierre, con el pie (piezas.ts, cierre()): se mide
 * ese cuerpo, el que queda justo encima del pie. Que todo el texto llegue al papel lo comprueba comprobarPdfDelInforme
 * sobre el PDF.
 */
export async function comprobarHojasImpresas(pagina: Page): Promise<void> {
  const hojas = await pagina.locator('#informe section.hoja').evaluateAll((elementos) =>
    elementos.map((hoja) => {
      const cuerpo = hoja.querySelector('.ib-final > .ib-cuerpo');
      const pie = hoja.querySelector('.ib-final > .hoja-pie');
      return {
        ancho: hoja.clientWidth,
        contenidoAncho: hoja.scrollWidth,
        finDelCuerpo: cuerpo?.getBoundingClientRect().bottom,
        principioDelPie: pie?.getBoundingClientRect().top,
      };
    }),
  );
  assert.equal(hojas.length, HOJAS_DEL_INFORME, 'El informe breve conserva sus dos hojas');
  for (const [indice, hoja] of hojas.entries()) {
    const medidas = `hoja ${indice + 1}: ${JSON.stringify(hoja)}`;
    assert(hoja.contenidoAncho <= hoja.ancho + 1, `La tabla y sus fechas caben en el ancho de la hoja (${medidas})`);
    assert(hoja.finDelCuerpo !== undefined && hoja.principioDelPie !== undefined, medidas);
    assert(hoja.finDelCuerpo <= hoja.principioDelPie + 1, `El pie no tapa el cuerpo ni las fuentes (${medidas})`);
  }
}

/** El pie de cada hoja del informe (piezas.ts, cierre()): su texto no cuenta como contenido de una página. */
export const PIE_DEL_INFORME = '.hoja-pie';

/**
 * Cada página lleva algo más que su folio y el pie de una hoja: al menos 20 caracteres de otro texto. Una página con
 * solo el pie (o en blanco) es la que deja una hoja que no cabe y cuyo pie o su aire pasan solos a la siguiente.
 */
export function comprobarPaginasConCuerpo(
  paginas: readonly string[],
  folio: (indice: number) => string | null,
  pies: readonly string[],
): void {
  const piezasDelPie = [...new Set(pies)].sort((a, b) => b.length - a.length);
  for (const [indice, texto] of compactos(paginas).entries()) {
    const suyo = folio(indice);
    let cuerpo = suyo !== null && texto.startsWith(suyo) ? texto.slice(suyo.length) : texto;
    for (const pieza of piezasDelPie) {
      cuerpo = cuerpo.replaceAll(pieza, '');
    }
    assert(
      cuerpo.length >= CARACTERES_DE_CUERPO,
      `La página ${indice + 1} lleva más que su folio y su pie (${cuerpo.length} caracteres: «${cuerpo}»)`,
    );
  }
}
const CARACTERES_DE_CUERPO = 20;

const CONTEXTOS_SOLO_EN_PANTALLA = ['.ib-contexto', '#contexto-ia', '#indicadores-de-ia'];

/** Los controles, folios, contextos y gráfico anual reservados a la pantalla. */
export const SOLO_EN_PANTALLA = [
  '.ib-cierre',
  '.ib-folio-hoja',
  '.hoja-pie-folio',
  ...CONTEXTOS_SOLO_EN_PANTALLA,
  '.ib-figura-ancha',
];

/**
 * El texto que se ve de un documento, en trozos sin espacios: uno por nodo de texto que se pinta, con su
 * text-transform. Por nodo y no por línea, porque el papel añade entre nodos lo que pone el CSS (separadores «·» o «;»
 * en ::before y ::after), que no es texto del documento. Con los desplegables abiertos, como los deja impresion.js al
 * imprimir, y sin los rótulos de lectores de pantalla ni lo que `fuera` nombra. Con `dentro`, solo el texto que ese
 * selector nombra. Los contextos y el gráfico anual se cotejan por separado con la tabla de papel.
 */
export async function textoVisible(
  pagina: Page,
  raiz: string,
  fuera: readonly string[] = [],
  dentro: string | null = null,
): Promise<string[]> {
  const trozos = await pagina.locator(raiz).evaluate(
    (documento, [selectores, solo]) => {
      const cerrados = [...documento.querySelectorAll('details:not([open])')] as HTMLDetailsElement[];
      const excluidos = ['.solo-lectores', ...selectores].join(', ');
      for (const desplegable of cerrados) {
        desplegable.open = true;
      }
      const transformar: Record<string, (texto: string) => string> = {
        uppercase: (texto) => texto.toUpperCase(),
        lowercase: (texto) => texto.toLowerCase(),
      };
      const pintado = (padre: Element | null): padre is Element =>
        padre?.checkVisibility({ visibilityProperty: true }) === true &&
        padre.closest(excluidos) === null &&
        (solo === null || padre.closest(solo) !== null);
      const recorrido = document.createTreeWalker(documento, NodeFilter.SHOW_TEXT);
      const vistos: string[] = [];
      for (let nodo = recorrido.nextNode(); nodo; nodo = recorrido.nextNode()) {
        const padre = nodo.parentElement;
        if (pintado(padre)) {
          const estilo = getComputedStyle(padre).textTransform;
          vistos.push((transformar[estilo] ?? ((texto: string) => texto))(nodo.textContent ?? ''));
        }
      }
      for (const desplegable of cerrados) {
        desplegable.open = false;
      }
      return vistos;
    },
    [fuera, dentro] as const,
  );
  return compactos(trozos).filter(Boolean);
}

/** Sin espacios: el PDF de Chromium coloca cada letra por su cuenta y no conserva los espacios de la pantalla. */
function compactos(textos: readonly string[]): string[] {
  return textos.map((texto) => texto.normalize('NFC').replace(/\s+/gu, ''));
}

/** Cuántas veces aparece un trozo en un texto, sin solaparse. */
function apariciones(texto: string, trozo: string): number {
  let veces = 0;
  for (let desde = texto.indexOf(trozo); desde >= 0; desde = texto.indexOf(trozo, desde + trozo.length)) {
    veces += 1;
  }
  return veces;
}

/**
 * Los trozos de la pantalla que el papel no lleva tantas veces como la pantalla: ocultar unas filas o un apartado
 * entero da rojo aunque su título, o el mismo texto en otra hoja, siga impreso.
 */
export function faltanEnElPapel(papel: string, trozos: readonly string[]): string[] {
  const enPantalla = new Map<string, number>();
  for (const trozo of trozos) {
    enPantalla.set(trozo, (enPantalla.get(trozo) ?? 0) + 1);
  }
  return [...enPantalla]
    .map(([trozo, veces]) => ({ trozo, veces, impresas: apariciones(papel, trozo) }))
    .filter(({ veces, impresas }) => impresas < veces)
    .map(({ trozo, veces, impresas }) => `${trozo} (${impresas} de ${veces})`);
}

/** El texto de unas páginas sin espacios y sin el folio exacto con que empieza cada una, si lo lleva. */
export function papelSinFolio(paginas: readonly string[], folio: (indice: number) => string | null): string {
  return compactos(paginas)
    .map((texto, indice) => {
      const suyo = folio(indice);
      return suyo !== null && texto.startsWith(suyo) ? texto.slice(suyo.length) : texto;
    })
    .join('');
}

/**
 * Las páginas reales del informe impreso: exactamente dos páginas; cada página empieza por su folio con el total real
 * («N / M», @page informe en informe-breve.css); y en el conjunto, cada trozo del texto de la pantalla, tantas veces
 * como sale en ella. Devuelve el número de páginas.
 */
export function comprobarPdfDelInforme(paginas: readonly string[], pantalla: readonly string[]): number {
  const total = paginas.length;
  assert.equal(total, HOJAS_DEL_INFORME, `El informe ocupa exactamente ${HOJAS_DEL_INFORME} páginas`);
  for (const [indice, texto] of compactos(paginas).entries()) {
    assert(
      texto.startsWith(`${indice + 1}/${total}`),
      `La página ${indice + 1} empieza por su folio «${indice + 1} / ${total}»`,
    );
  }
  // Sin el folio de cada página: un párrafo que pasa de una página a la siguiente se lee seguido.
  const papel = papelSinFolio(paginas, (indice) => `${indice + 1}/${total}`);
  assert.deepEqual(faltanEnElPapel(papel, pantalla), [], 'Todo el texto que muestra la pantalla está en el PDF');
  return total;
}

interface ObjetoPdf {
  diccionario: string;
  flujo: Buffer | null;
}

/** Bases de los números de un PDF: hexadecimal de las cadenas <…>, octal de los escapes y el valor de un byte. */
const HEXADECIMAL = 16;
const OCTAL = 8;
const VALORES_DE_UN_BYTE = 256;
/** Cifras hexadecimales de una unidad UTF-16 en un ToUnicode. */
const CIFRAS_UTF16 = 4;
/** Cifras, como mucho, de un escape octal «\ddd». */
const CIFRAS_OCTALES = 3;

/** Los objetos «N 0 obj … endobj» de un PDF sin cifrar ni flujos de objetos, con sus flujos ya descomprimidos. */
function objetosDelPdf(bytes: Buffer): Map<number, ObjetoPdf> {
  const latin = bytes.toString('latin1');
  const objetos = new Map<number, ObjetoPdf>();
  const cabecera = /(\d+) 0 obj\b/gu;
  for (let encontrado = cabecera.exec(latin); encontrado; encontrado = cabecera.exec(latin)) {
    const inicio = encontrado.index + encontrado[0].length;
    const fin = latin.indexOf('endobj', inicio);
    const cuerpo = latin.slice(inicio, fin);
    const marca = cuerpo.indexOf('stream');
    let flujo: Buffer | null = null;
    if (marca >= 0) {
      let desde = inicio + marca + 'stream'.length;
      desde += latin.startsWith('\r\n', desde) ? 2 : 1;
      const crudo = bytes.subarray(desde, latin.lastIndexOf('endstream', fin));
      flujo = cuerpo.slice(0, marca).includes('/FlateDecode') ? inflateSync(crudo) : crudo;
    }
    objetos.set(Number(encontrado[1]), { diccionario: marca >= 0 ? cuerpo.slice(0, marca) : cuerpo, flujo });
    cabecera.lastIndex = fin;
  }
  return objetos;
}

function referencia(diccionario: string, clave: string): number | null {
  const encontrada = new RegExp(`/${clave}\\s+(\\d+) 0 R`, 'u').exec(diccionario);
  return encontrada ? Number(encontrada[1]) : null;
}

interface MapaUnicode {
  bytes: number;
  textos: Map<number, string>;
}

const hexadecimal = (cifras: string) => Number.parseInt(cifras, HEXADECIMAL);
const utf16 = (cifras: string) =>
  String.fromCharCode(...(cifras.match(new RegExp(`.{${CIFRAS_UTF16}}`, 'gu')) ?? []).map(hexadecimal));

/** Un tramo «<desde> <hasta> <destino>» o «<desde> <hasta> [<destino> …]» de un bfrange. */
function tramoUnicode(textos: Map<number, string>, desde: number, hasta: number, destino: string): void {
  if (destino.startsWith('[')) {
    for (const [indice, cifras] of [...destino.matchAll(/<([0-9a-fA-F]+)>/gu)].entries()) {
      textos.set(desde + indice, utf16(cifras[1] ?? ''));
    }
    return;
  }
  const base = destino.slice(1, -1);
  const prefijo = utf16(base.slice(0, -CIFRAS_UTF16));
  const ultimo = hexadecimal(base.slice(-CIFRAS_UTF16));
  for (let codigo = desde; codigo <= hasta; codigo += 1) {
    textos.set(codigo, prefijo + String.fromCharCode(ultimo + codigo - desde));
  }
}

/** El ToUnicode de una fuente (bfchar y bfrange): de cada código de glifo, su texto; y los bytes de cada código. */
function mapaUnicode(cmap: string): MapaUnicode {
  const textos = new Map<number, string>();
  const pares = [...cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/gu)].map(([, bloque]) => bloque ?? '').join('\n');
  for (const [, codigo, texto] of pares.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/gu)) {
    textos.set(hexadecimal(codigo ?? ''), utf16(texto ?? ''));
  }
  for (const [, tramos] of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/gu)) {
    for (const [, desde, hasta, destino] of (tramos ?? '').matchAll(
      /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<[0-9a-fA-F]+>|\[[^\]]*\])/gu,
    )) {
      tramoUnicode(textos, hexadecimal(desde ?? ''), hexadecimal(hasta ?? ''), destino ?? '');
    }
  }
  const espacio = /begincodespacerange\s*<([0-9a-fA-F]+)>/u.exec(cmap);
  return { bytes: (espacio?.[1]?.length ?? 2) / 2, textos };
}

const ESCAPES_PDF: Record<string, number> = Object.fromEntries(
  [...'nrtbf()\\'].map((letra, indice) => [letra, '\n\r\t\b\f()\\'.charCodeAt(indice)]),
);

/** Un escape «\…» de una cadena literal: su byte (ninguno si es un salto de línea escapado) y lo que ocupa. */
function escapePdf(contenido: string, posicion: number): { byte: number | null; largo: number } {
  const siguiente = contenido.charAt(posicion + 1);
  const conocido = ESCAPES_PDF[siguiente];
  if (conocido !== undefined) {
    return { byte: conocido, largo: 2 };
  }
  const octal = /^[0-7]+/u.exec(contenido.slice(posicion + 1, posicion + 1 + CIFRAS_OCTALES));
  if (octal) {
    return { byte: Number.parseInt(octal[0], OCTAL) % VALORES_DE_UN_BYTE, largo: 1 + octal[0].length };
  }
  return { byte: /^[\r\n]?$/u.test(siguiente) ? null : siguiente.charCodeAt(0), largo: 2 };
}

/** Los bytes de una cadena literal «(…)» de un contenido de página, con sus escapes, y dónde termina. */
function cadenaLiteral(contenido: string, inicio: number): { bytes: number[]; fin: number } {
  const bytes: number[] = [];
  let profundidad = 1;
  let posicion = inicio + 1;
  while (posicion < contenido.length) {
    const letra = contenido.charAt(posicion);
    if (letra === '\\') {
      const { byte, largo } = escapePdf(contenido, posicion);
      if (byte !== null) {
        bytes.push(byte);
      }
      posicion += largo;
      continue;
    }
    if (letra === '(') {
      profundidad += 1;
    } else if (letra === ')') {
      profundidad -= 1;
    }
    if (profundidad === 0) {
      return { bytes, fin: posicion + 1 };
    }
    bytes.push(letra.charCodeAt(0));
    posicion += 1;
  }
  return { bytes, fin: posicion };
}

const PIEZA_DE_CONTENIDO = /\s+|\(|<(?!<)[0-9a-fA-F\s]*>|\[|\]|<<|>>|\/[^\s/[\]()<>{}%]+|[^\s/[\]()<>{}%]+/uy;
/** Los operadores que pintan cadenas y los que mueven el texto (separan con un espacio lo de antes y lo de después). */
const PINTAN_TEXTO = new Set(['Tj', 'TJ', "'", '"']);
const MUEVEN_EL_TEXTO = new Set(['Td', 'TD', 'Tm', 'T*', 'BT', 'ET']);

/** Una matriz de transformación de PDF [a b c d e f]. */
type Matriz = readonly [number, number, number, number, number, number];
const IDENTIDAD: Matriz = [1, 0, 0, 1, 0, 0];

/** m × n, en el orden de PDF: primero m, luego n. */
function multiplicar(m: Matriz, n: Matriz): Matriz {
  return [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5],
  ];
}

/** Lo que se va leyendo de un contenido de página: fuente y tamaño en uso, matrices, operandos y lo pintado. */
interface Lectura {
  fuentes: Map<string, MapaUnicode>;
  fuente: MapaUnicode | undefined;
  tamano: number;
  nombre: string;
  numeros: number[];
  cadenas: number[][];
  pila: Matriz[];
  ctm: Matriz;
  tm: Matriz;
  salida: string;
  /** Caracteres pintados por tamaño efectivo en puntos (redondeado a centésimas). */
  letra: Map<number, number>;
  /** El texto pintado en cada tamaño efectivo, para decir qué texto incumple. */
  textos: Map<number, string>;
}

/** Una página leída: su texto, cuántos caracteres hay de cada tamaño de letra efectivo y qué texto lleva cada uno. */
export interface PaginaPdf {
  texto: string;
  letra: Map<number, number>;
  textos: Map<number, string>;
}

/** Una cadena de bytes con el ToUnicode de la fuente en uso (códigos de 1 o 2 bytes). */
function traducir(fuente: MapaUnicode | undefined, bytes: readonly number[]): string {
  let texto = '';
  const ancho = fuente?.bytes ?? 1;
  for (let indice = 0; fuente && indice + ancho <= bytes.length; indice += ancho) {
    const codigo = bytes.slice(indice, indice + ancho).reduce((valor, byte) => valor * VALORES_DE_UN_BYTE + byte, 0);
    texto += fuente.textos.get(codigo) ?? '';
  }
  return texto;
}

const CENTESIMAS = 100;
/** Seis operandos: una matriz. */
const matriz = (numeros: readonly number[]): Matriz => {
  const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = numeros.slice(-IDENTIDAD.length);
  return [a, b, c, d, e, f];
};

/** Lo que pinta un operador de texto: su texto y, por tamaño efectivo (Tf × escala de Tm × escala de la CTM), sus letras. */
function pintar(lectura: Lectura): void {
  const texto = lectura.cadenas.map((cadena) => traducir(lectura.fuente, cadena)).join('');
  const total = multiplicar(lectura.tm, lectura.ctm);
  const puntos = Math.round(
    lectura.tamano * Math.sqrt(Math.abs(total[0] * total[3] - total[1] * total[2])) * CENTESIMAS,
  );
  const letras = texto.replace(/\s+/gu, '').length;
  lectura.letra.set(puntos / CENTESIMAS, (lectura.letra.get(puntos / CENTESIMAS) ?? 0) + letras);
  lectura.textos.set(puntos / CENTESIMAS, `${lectura.textos.get(puntos / CENTESIMAS) ?? ''} ${texto}`);
  lectura.salida += texto;
}

/** Los operadores que cambian el estado gráfico o el de texto y que importan para leer el texto y su tamaño. */
const OPERADORES: Record<string, (lectura: Lectura) => void> = {
  q: (lectura) => lectura.pila.push(lectura.ctm),
  Q: (lectura) => {
    lectura.ctm = lectura.pila.pop() ?? IDENTIDAD;
  },
  cm: (lectura) => {
    lectura.ctm = multiplicar(matriz(lectura.numeros), lectura.ctm);
  },
  Tm: (lectura) => {
    lectura.tm = matriz(lectura.numeros);
    lectura.salida += ' ';
  },
  BT: (lectura) => {
    lectura.tm = IDENTIDAD;
    lectura.salida += ' ';
  },
  Tf: (lectura) => {
    lectura.fuente = lectura.fuentes.get(lectura.nombre);
    lectura.tamano = lectura.numeros.at(-1) ?? 0;
  },
};

/** Una pieza del contenido que no es una cadena literal: número, nombre, cadena hexadecimal u operador. */
function leerPieza(lectura: Lectura, pieza: string): void {
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)$/u.test(pieza)) {
    lectura.numeros.push(Number(pieza));
    return;
  }
  if (pieza.startsWith('<') && pieza !== '<<') {
    const cifras = pieza.slice(1, -1).replace(/\s/gu, '');
    lectura.cadenas.push((cifras.match(/.{1,2}/gu) ?? []).map((par) => hexadecimal(par.padEnd(2, '0'))));
    return;
  }
  if (pieza.startsWith('/')) {
    lectura.nombre = pieza.slice(1);
    return;
  }
  if (!/^[A-Za-z*'"]+$/u.test(pieza)) {
    return;
  }
  if (PINTAN_TEXTO.has(pieza)) {
    pintar(lectura);
  } else if (MUEVEN_EL_TEXTO.has(pieza)) {
    lectura.salida += ' ';
  }
  OPERADORES[pieza]?.(lectura);
  lectura.cadenas = [];
  lectura.numeros = [];
}

/** El texto que pinta un contenido de página (Tf, Tj, TJ, ' y "), en el orden de pintado, y sus tamaños de letra. */
function leerContenido(contenido: string, fuentes: Map<string, MapaUnicode>): PaginaPdf {
  const lectura: Lectura = {
    fuentes,
    fuente: undefined,
    tamano: 0,
    nombre: '',
    numeros: [],
    cadenas: [],
    pila: [],
    ctm: IDENTIDAD,
    tm: IDENTIDAD,
    salida: '',
    letra: new Map(),
    textos: new Map(),
  };
  let posicion = 0;
  while (posicion < contenido.length) {
    PIEZA_DE_CONTENIDO.lastIndex = posicion;
    const pieza = PIEZA_DE_CONTENIDO.exec(contenido)?.[0] ?? contenido.charAt(posicion);
    if (pieza === '(') {
      const literal = cadenaLiteral(contenido, posicion);
      lectura.cadenas.push(literal.bytes);
      posicion = literal.fin;
    } else {
      leerPieza(lectura, pieza);
      posicion += pieza.length;
    }
  }
  const textos = new Map([...lectura.textos].map(([puntos, texto]) => [puntos, texto.replace(/\s+/gu, ' ').trim()]));
  return { texto: lectura.salida.replace(/\s+/gu, ' ').trim(), letra: lectura.letra, textos };
}

/** Las fuentes de una página con su ToUnicode, por el nombre con que las usa su contenido. */
function fuentesDeLaPagina(objetos: Map<number, ObjetoPdf>, pagina: ObjetoPdf): Map<string, MapaUnicode> {
  const recursos = referencia(pagina.diccionario, 'Resources');
  const diccionario = recursos === null ? pagina.diccionario : (objetos.get(recursos)?.diccionario ?? '');
  const lista = /\/Font\s*<<([\s\S]*?)>>/u.exec(diccionario)?.[1] ?? '';
  const fuentes = new Map<string, MapaUnicode>();
  for (const [, nombre, numero] of lista.matchAll(/\/([^\s/]+)\s+(\d+) 0 R/gu)) {
    const unicode = referencia(objetos.get(Number(numero))?.diccionario ?? '', 'ToUnicode');
    const cmap = unicode === null ? null : objetos.get(unicode)?.flujo;
    if (cmap) {
      fuentes.set(nombre ?? '', mapaUnicode(cmap.toString('latin1')));
    }
  }
  return fuentes;
}

/**
 * Cada página de un PDF de Chromium (Skia: sin cifrar y sin flujos de objetos), sin dependencias: sigue el árbol de
 * páginas, descomprime cada contenido, traduce sus cadenas con el ToUnicode de su fuente y mide su letra efectiva.
 * Límites, sin efecto con los PDF de Skia de hoy: no entra en Form XObjects (Do), no aplica la FontMatrix de las
 * fuentes Type3 (Skia la normaliza: 6,84 pt medidos = 1,15cqi teóricos) ni lee PDF cifrados o con flujos de objetos.
 * Con un PDF que los use leería menos texto (el cotejo daría rojo) o tamaños sin esa matriz.
 */
export function leerPdf(bytes: Buffer): PaginaPdf[] {
  const objetos = objetosDelPdf(bytes);
  const raiz = [...objetos.values()].find(
    (objeto) => /\/Type\s*\/Pages\b/u.test(objeto.diccionario) && !/\/Parent\b/u.test(objeto.diccionario),
  );
  assert(raiz, 'El PDF tiene árbol de páginas');
  const paginas: PaginaPdf[] = [];
  const recorrer = (nodo: ObjetoPdf) => {
    const hijos = /\/Kids\s*\[([^\]]*)\]/u.exec(nodo.diccionario);
    if (hijos) {
      for (const [, numero] of (hijos[1] ?? '').matchAll(/(\d+) 0 R/gu)) {
        const hijo = objetos.get(Number(numero));
        assert(hijo, `El PDF tiene el objeto ${numero} de su árbol de páginas`);
        recorrer(hijo);
      }
      return;
    }
    const contenidos = /\/Contents\s*(\[[^\]]*\]|\d+ 0 R)/u.exec(nodo.diccionario)?.[1] ?? '';
    const contenido = [...contenidos.matchAll(/(\d+) 0 R/gu)]
      .map(([, numero]) => objetos.get(Number(numero))?.flujo?.toString('latin1') ?? '')
      .join('\n');
    paginas.push(leerContenido(contenido, fuentesDeLaPagina(objetos, nodo)));
  };
  recorrer(raiz);
  return paginas;
}

/** La letra más pequeña de la hoja de impresión aprobada: el monoespaciado de la banda, 1,15cqi de la hoja A4 (6,846 pt). */
export const LETRA_MINIMA_PT = 6.84;
/**
 * La única letra menor que la mínima que admite el PDF: la del texto para lectores de pantalla, que no se ve:
 * web/estilos/informe/pantallas-e-impresion.css lo imprime a propósito transparente y en 0,0625 rem (1 px, 0,75 pt) para
 * que el PDF etiquetado lo conserve. Hasta 1 pt, y solo con los textos de los `.solo-lectores` que se imprimen; nada
 * entre 1 pt y la letra mínima.
 */
export const LETRA_DE_LECTORES_MAX_PT = 1;
const CARACTERES_DE_UN_TAMANO = 20;

/** Sin espacios: así se comparan los textos de la página con los del PDF, que no conserva los de la pantalla. */
const sinEspacios = (texto: string): string => texto.replace(/\s+/gu, '');

/**
 * Los textos para lectores de pantalla que se imprimen: los `.solo-lectores` con caja en el medio de impresión, sin
 * espacios. Se leen con el medio de impresión ya aplicado y recompuesto, antes de generar el PDF.
 */
export async function textosDeLectoresImpresos(pagina: Page): Promise<string[]> {
  const textos = await pagina.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.solo-lectores')]
      .filter((elemento) => elemento.getClientRects().length > 0)
      .map((elemento) => elemento.innerText),
  );
  return textos.map(sinEspacios).filter((texto) => texto.length > 0);
}

/** Cuántas letras iniciales comparten dos textos. */
function principioComun(a: string, b: string): number {
  let iguales = 0;
  while (iguales < a.length && iguales < b.length && a[iguales] === b[iguales]) {
    iguales += 1;
  }
  return iguales;
}

/**
 * Las letras de un texto para lectores recortado que se admiten como mínimo: cada `.solo-lectores` mide 1 px de ancho y
 * el navegador puede pintar solo su principio. Es lo medido: Chromium deja «Tu» de «Tu recorrido con Faro» y WebKit
 * lo pinta entero; un texto que empezara por un signo más ancho que la caja dejaría una sola letra y fallaría aquí.
 */
const PRINCIPIO_MINIMO_DE_LECTORES = 2;

/**
 * Lo que queda de un texto en letra de lectores (hasta 1 pt) al ir quitándole, desde el principio, textos para lectores
 * que se imprimen: cada uno una sola vez, entero o su principio de al menos dos letras, el que más letras comparta. En
 * cuanto lo que queda no empieza así, todo ello es ajeno y se devuelve tal cual. Vacío si todo es texto para lectores.
 */
function noDeLectores(texto: string, lectores: readonly string[]): string {
  const pendientes = [...lectores];
  let resto = sinEspacios(texto);
  while (resto.length > 0) {
    // Lo que cada texto pendiente explica del principio de lo que queda: él entero, o un principio de dos letras o más.
    const comunes = pendientes.map((conocido) => {
      const comun = principioComun(resto, conocido);
      return comun === conocido.length || comun >= PRINCIPIO_MINIMO_DE_LECTORES ? comun : 0;
    });
    const pintado = Math.max(0, ...comunes);
    if (pintado === 0) {
      return resto;
    }
    pendientes.splice(comunes.indexOf(pintado), 1);
    resto = resto.slice(pintado);
  }
  return '';
}

/**
 * Los tamaños de letra de cada página que bajan de la letra mínima de la hoja aprobada, con cualquier número de
 * caracteres visibles: «página N: tamaño pt, caracteres: texto». Hasta 1 pt solo se admite el texto para lectores de
 * pantalla que se imprime (`lectores`, sin espacios); cualquier otro texto a ese tamaño incumple.
 */
export function letraPequenaDelPdf(paginas: readonly PaginaPdf[], lectores: readonly string[]): string[] {
  return paginas.flatMap(({ letra, textos }, indice) =>
    [...letra]
      .filter(([puntos, caracteres]) => caracteres > 0 && puntos < LETRA_MINIMA_PT)
      .flatMap(([puntos, caracteres]) => {
        const texto = textos.get(puntos) ?? '';
        if (puntos > LETRA_DE_LECTORES_MAX_PT) {
          return [`página ${indice + 1}: ${puntos} pt, ${caracteres} caracteres: «${texto}»`];
        }
        const resto = noDeLectores(texto, lectores);
        return resto ? [`página ${indice + 1}: ${puntos} pt sin ser texto para lectores de pantalla: «${resto}»`] : [];
      }),
  );
}

/**
 * En cada página, ningún carácter visible queda por debajo de la letra de la hoja aprobada (hasta 1 pt solo el texto
 * para lectores de pantalla que se imprime, `lectores`), y cada página lleva al menos 20 caracteres legibles (a ese
 * tamaño o más) además de su folio: ninguna sale solo con el folio o con texto de lectores de pantalla. `folio` da el
 * folio de cada página, si lo lleva.
 */
export function comprobarLetraDelPdf(
  paginas: readonly PaginaPdf[],
  folio: (indice: number) => string | null,
  lectores: readonly string[],
): void {
  assert.deepEqual(letraPequenaDelPdf(paginas, lectores), [], `Ningún texto del PDF baja de ${LETRA_MINIMA_PT} pt`);
  for (const [indice, { letra }] of paginas.entries()) {
    const legibles = [...letra].filter(([puntos]) => puntos >= LETRA_MINIMA_PT).reduce((suma, [, n]) => suma + n, 0);
    const propias = legibles - (folio(indice)?.length ?? 0);
    assert(propias >= CARACTERES_DE_UN_TAMANO, `La página ${indice + 1} lleva texto legible (${propias} caracteres)`);
  }
}

/** Coteja cada año y cada cifra de las columnas con la tabla que se imprime. */
export function comprobarCorrespondenciaAnual(
  etiquetas: readonly string[],
  valores: readonly string[],
  grafico: readonly string[],
): void {
  assert(etiquetas.length > 0 && etiquetas.length === valores.length, 'La serie tiene años y cifras');
  for (const [i, etiqueta] of etiquetas.entries()) {
    assert.equal(grafico[i * 2 + 1]?.trim(), etiqueta.trim(), `Año de la columna ${i + 1}`);
    assert.equal(grafico[i * 2]?.trim(), valores[i]?.replace(/\*$/u, '').trim(), `Cifra de la columna ${i + 1}`);
  }
}
/** Captura el gráfico visible y comprueba su equivalencia con la tabla preparada para papel. */
export async function serieAnualEnPantalla(pagina: Page): Promise<boolean> {
  const figura = pagina.locator('#informe .ib-figura-ancha');
  if ((await figura.count()) === 0) {
    return false;
  }
  assert(await figura.isVisible(), 'El gráfico anual está visible en pantalla');
  const serie = await pagina.locator('#informe').evaluate((informe) => ({
    grafico: [...informe.querySelectorAll('.ib-figura-ancha svg text')].map((n) => n.textContent ?? ''),
    etiquetas: [...informe.querySelectorAll('.ib-serie-papel thead th')].map((n) => n.textContent ?? ''),
    valores: [...informe.querySelectorAll('.ib-serie-papel tbody td')].map((n) => n.textContent ?? ''),
  }));
  comprobarCorrespondenciaAnual(serie.etiquetas, serie.valores, serie.grafico);
  return true;
}
/** En medio de impresión, exige la tabla visible y devuelve su texto para cotejarlo con el PDF. */
export async function serieAnualEnPapel(pagina: Page, presente: boolean): Promise<string[]> {
  if (!presente) {
    return [];
  }
  assert.equal(await pagina.locator('#informe .ib-figura-ancha').isVisible(), false, 'El gráfico no se imprime');
  assert(await pagina.locator('#informe .ib-serie-papel').isVisible(), 'La tabla anual se imprime');
  const tabla = await textoVisible(pagina, '#informe', [], '.ib-serie-papel');
  assert(tabla.length > 0, 'La tabla anual conserva texto');
  return tabla;
}

/** Los contextos se conservan en pantalla aunque se excluyan de la hoja impresa. */
export async function comprobarContextosEnPantalla(pagina: Page): Promise<void> {
  for (const contexto of await pagina.locator('#informe').locator(CONTEXTOS_SOLO_EN_PANTALLA.join(', ')).all()) {
    assert(await contexto.isVisible(), 'El contexto sigue visible en pantalla');
  }
}

/** Verifica que el texto íntegro de la tabla de impresión llegó a las páginas del PDF. */
function comprobarTablaEnPdf(paginas: readonly PaginaPdf[], tabla: readonly string[], total: number): void {
  const papel = papelSinFolio(
    paginas.map(({ texto }) => texto),
    (indice) => `${indice + 1}/${total}`,
  );
  assert.deepEqual(faltanEnElPapel(papel, tabla), [], 'La tabla anual completa llega al PDF');
}

/** Lo que se mide del corchete del gráfico de columnas en el navegador, en unidades del SVG. */
interface MedidaDelCorchete {
  rects: number;
  ancho: number;
  izquierda: number;
  derecha: number;
  arriba: number;
  base: number;
  linea: number;
  patillas: number[];
}

/** Coteja la serie del ejemplo y su sustitución al imprimir. */
async function comprobarTablaDelEjemplo(ejemplo: Page): Promise<void> {
  const serie = await ejemplo.locator('main').evaluate((informe) => ({
    grafico: [...informe.querySelectorAll('.ib-figura-ancha svg text')].map((n) => n.textContent ?? ''),
    etiquetas: [...informe.querySelectorAll('.ib-serie-papel thead th')].map((n) => n.textContent ?? ''),
    valores: [...informe.querySelectorAll('.ib-serie-papel tbody td')].map((n) => n.textContent ?? ''),
  }));
  comprobarCorrespondenciaAnual(serie.etiquetas, serie.valores, serie.grafico);
  await ejemplo.emulateMedia({ media: 'print' });
  await estabilizar(ejemplo);
  assert.equal(await ejemplo.locator('main .ib-figura-ancha').isVisible(), false);
  assert(await ejemplo.locator('main .ib-serie-papel').isVisible());
}

/**
 * El gráfico de contratos por año con caída, dibujado en pantalla: sin nada pintado
 * encima del corchete (ningún rect), con su línea y sus dos patillas, y el rótulo dentro del gráfico y con su base al
 * menos 3 unidades por encima de la línea. Se mide en el ejemplo publicado (informe-ejemplo.html, caída del −8 %), en
 * otra pestaña del mismo contexto: la ocupación del recorrido tiene el máximo en el último año y no dibuja corchete.
 */
async function corcheteDelEjemplo(pagina: Page, origen: string): Promise<Record<string, MedidaDelCorchete>> {
  const ejemplo = await pagina.context().newPage();
  const medidas: Record<string, MedidaDelCorchete> = {};
  try {
    assert.equal((await ejemplo.goto(`${origen}/informe-ejemplo.html`))?.status(), ESTADO_HTTP.correcto);
    for (const media of ['screen'] as const) {
      await ejemplo.emulateMedia({ media });
      await estabilizar(ejemplo);
      const medida = await ejemplo.locator('main .ib-columnas-v2').evaluate((grafico): MedidaDelCorchete => {
        const svg = grafico as SVGSVGElement;
        const trazo = svg.querySelector<SVGPathElement>('path[fill="none"]');
        const rotulo = [...svg.querySelectorAll<SVGTextElement>('text')].find((t) => t.textContent?.includes('%'));
        const puntos = (trazo?.getAttribute('d')?.match(/-?[\d.]+/gu) ?? []).map(Number);
        const caja = rotulo?.getBBox();
        const linea = puntos[3] ?? Number.NaN;
        return {
          rects: svg.querySelectorAll('rect').length,
          ancho: svg.viewBox.baseVal.width,
          izquierda: caja?.x ?? Number.NaN,
          derecha: (caja?.x ?? Number.NaN) + (caja?.width ?? 0),
          arriba: caja?.y ?? Number.NaN,
          base: Number(rotulo?.getAttribute('y')),
          linea,
          patillas: [(puntos[1] ?? Number.NaN) - linea, (puntos[7] ?? Number.NaN) - linea],
        };
      });
      const donde = `ejemplo, ${media}: ${JSON.stringify(medida)}`;
      assert.equal(medida.rects, 0, `Nada tapa el corchete (${donde})`);
      assert(
        medida.patillas.every((largo) => largo > 0),
        `El corchete tiene sus dos patillas (${donde})`,
      );
      assert(medida.izquierda >= 0 && medida.derecha <= medida.ancho && medida.arriba >= 0, `Rótulo dentro (${donde})`);
      assert(medida.linea - medida.base >= LINEA_BAJO_EL_ROTULO, `Rótulo por encima de la línea (${donde})`);
      medidas[media] = medida;
    }
    await comprobarTablaDelEjemplo(ejemplo);
  } finally {
    await ejemplo.close();
  }
  return medidas;
}
/** La base del rótulo de la caída, al menos 3 unidades por encima de la línea del corchete. */
const LINEA_BAJO_EL_ROTULO = 3;

async function imprimir(pagina: Page, destino: string) {
  await pagina.evaluate(() => {
    const ventana = window as unknown as ConImpresiones & Window;
    ventana.impresiones = 0;
    ventana.print = () => {
      ventana.impresiones += 1;
    };
  });
  await pagina.locator('#informe #imprimir').click();
  await pagina.locator('#conversacion .rc-documento button').click();
  const impresiones = await pagina.evaluate(() => (window as unknown as ConImpresiones).impresiones);
  assert.equal(impresiones, 2, 'Los dos «Imprimir o guardar en PDF» llaman a window.print');
  if (pagina.context().browser()?.browserType().name() !== 'chromium') {
    return { archivo: null, bytes: 0, sha256: null, impresiones, paginas: 0 };
  }
  await comprobarContextosEnPantalla(pagina);
  const serie = await serieAnualEnPantalla(pagina);
  const pantalla = await textoVisible(pagina, '#informe', SOLO_EN_PANTALLA);
  const pies = await textoVisible(pagina, '#informe', SOLO_EN_PANTALLA, PIE_DEL_INFORME);
  await pagina.emulateMedia({ media: 'print' });
  // Las unidades de contenedor de la hoja (cqi) se recalculan un fotograma después del cambio de medio: medir antes
  // da la composición de pantalla a medias (unos 34 px de más en la segunda hoja) y no la que imprime el navegador.
  await estabilizar(pagina);
  await comprobarHojasImpresas(pagina);
  const lectores = await textosDeLectoresImpresos(pagina);
  const tablaAnual = await serieAnualEnPapel(pagina, serie);
  await pagina.pdf({ path: destino, format: 'A4', printBackground: true });
  await pagina.emulateMedia({ media: null });
  const bytes = readFileSync(destino);
  assert.equal(bytes.subarray(0, CABECERA_PDF.length).toString(), CABECERA_PDF);
  assert(bytes.includes(Buffer.from('%%EOF')), 'El PDF debe estar terminado');
  const leido = leerPdf(bytes);
  const paginas = comprobarPdfDelInforme(
    leido.map(({ texto }) => texto),
    pantalla,
  );
  comprobarTablaEnPdf(leido, tablaAnual, paginas);
  comprobarLetraDelPdf(leido, (indice) => `${indice + 1}/${paginas}`, lectores);
  comprobarPaginasConCuerpo(
    leido.map(({ texto }) => texto),
    (indice) => `${indice + 1}/${paginas}`,
    pies,
  );
  return { archivo: destino, bytes: bytes.length, sha256: huella(bytes), impresiones, paginas };
}

/**
 * Los mensajes de la copia entre la página y el service worker (src/service-worker/paquete.js): la petición de
 * prepararla y el estado con que responde a la página que la pide.
 */
const MENSAJES_DE_LA_COPIA = { preparar: 'PREPARAR_PAQUETE', estado: 'ESTADO_DEL_PAQUETE' };

/** En la página: pide la copia al service worker activo, por su protocolo, y espera el estado con que responde. */
async function copiaCompleta(mensajes: typeof MENSAJES_DE_LA_COPIA): Promise<boolean> {
  const contenedor = navigator.serviceWorker;
  const registro = await contenedor.ready;
  const estado = await new Promise<{ completo?: unknown }>((responder) => {
    const escuchar = ({ data }: MessageEvent) => {
      if (data?.type === mensajes.estado) {
        contenedor.removeEventListener('message', escuchar);
        responder(data);
      }
    };
    contenedor.addEventListener('message', escuchar);
    contenedor.startMessages();
    registro.active?.postMessage({ type: mensajes.preparar });
  });
  return estado.completo === true;
}

/** La copia sin conexión completa, según el service worker publicado; la página no publica su módulo por separado. */
export async function prepararCopia(pagina: Page): Promise<void> {
  await pagina.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
    timeout: PLAZO_PAQUETE_MS,
  });
  await pagina.waitForFunction(copiaCompleta, MENSAJES_DE_LA_COPIA, { timeout: PLAZO_PAQUETE_MS });
}

async function contenidoInforme(pagina: Page) {
  const texto = await pagina.locator('#informe').innerText();
  const estilos = await pagina.locator('#informe').evaluate((informe) => {
    const campos = [
      'display',
      'color',
      'background-color',
      'font-family',
      'font-size',
      'line-height',
      'padding',
      'margin',
      'border',
      'width',
      'height',
    ];
    return [...informe.querySelectorAll('h1,h2,.semana,.franja,.segmento,.tarjeta')].map((elemento) => {
      const css = getComputedStyle(elemento);
      return {
        etiqueta: elemento.tagName,
        clase: elemento.className,
        css: Object.fromEntries(campos.map((campo) => [campo, css.getPropertyValue(campo)])),
      };
    });
  });
  assert(texto.trim().length > 0 && estilos.length > 0, 'Informe materializado y con estilos computados');
  return { texto, estilos };
}

/**
 * Recarga con el servidor apagado detrás del portal de la construcción privada: el service worker responde con su página
 * de estado y un 503, con el título, el aviso de acceso y el enlace aprobados en el idioma del caso, y nada de la web
 * guardada.
 */
export async function recargarSinRedTrasElPortal(pagina: Page, idioma: Idioma, origen: string) {
  const recarga = await pagina.reload({ waitUntil: 'load' });
  assert.equal(recarga?.status(), ESTADO_HTTP.noDisponible, 'Sin red, detrás del portal, la página da 503');
  const parte = pagina.locator(`main > section[lang="${idioma}"]`);
  const enlace = parte.locator('a');
  const sinRed = {
    estado: recarga?.status(),
    titulo: await parte.locator('h1').innerText(),
    parrafos: await parte.locator('p').allInnerTexts(),
    destino: new URL((await enlace.getAttribute('href')) ?? '', pagina.url()).pathname,
    webGuardada: await pagina.locator('#informe, #hoja-de-ruta, #conversacion').count(),
  };
  const textos = TEXTOS_INSTALACION[idioma];
  assert.deepEqual(
    sinRed,
    {
      estado: ESTADO_HTTP.noDisponible,
      titulo: textos['sin-conexion.titulo-principal'],
      parrafos: [textos['servicio.acceso-sin-conexion'], textos['sin-conexion.volver']],
      destino: new URL('inicio.html', `${origen}/`).pathname,
      webGuardada: 0,
    },
    'Sin red, detrás del portal, la página de estado de Faro: su título, el aviso de acceso y su enlace aprobados',
  );
  return sinRed;
}

export async function probarRecorrido(opciones: {
  pagina: Page;
  fixture: Fixture;
  idioma: Idioma;
  salida: string;
  /** Lo que se comprueba en la página del recorrido ya abierta, con el servidor apagado y antes de recargarla. */
  sinServidor?: (pagina: Page) => Promise<unknown>;
}) {
  const { pagina, fixture, idioma, salida } = opciones;
  await pagina.addInitScript((elegido) => {
    localStorage.setItem('faro-idioma', elegido);
    localStorage.setItem('faro-modo-elegido', 'ia-off');
  }, idioma);
  assert.equal((await pagina.goto(`${fixture.origen}/recorrido.html`))?.status(), ESTADO_HTTP.correcto);
  await pagina.waitForFunction((elegido) => document.documentElement.lang === elegido, idioma);
  await prepararCopia(pagina);
  await informe(pagina, idioma);
  const titulo = await pagina.locator('#informe [data-titulo-pdf]').innerText();
  assert(titulo.trim().length > 0);
  await contenidoInforme(pagina);
  const online = await imprimir(pagina, join(salida, `${idioma}-online.pdf`));
  const corchete = await corcheteDelEjemplo(pagina, fixture.origen);
  const censal = await apartadoCensalDelEjemplo(pagina, fixture.origen, idioma, paginasDelPdf);
  await fixture.apagar();
  await assert.rejects(
    fetch(`${fixture.origen}/inicio.html`, {
      headers: { ...IDENTIDAD_WEB },
      signal: AbortSignal.timeout(PLAZO_INACCESIBILIDAD_MS),
    }),
  );
  const sinServidor = await opciones.sinServidor?.(pagina);
  const sinRed = await recargarSinRedTrasElPortal(pagina, idioma, fixture.origen);
  return { idioma, titulo, online, corchete, censal, sinRed, sinServidor, servidorApagado: true };
}

/** Las páginas del PDF de una página impresa ahora, o null si el motor no saca PDF (solo Chromium con Playwright). */
export async function paginasDelPdf(pagina: Page): Promise<number | null> {
  if (pagina.context().browser()?.browserType().name() !== 'chromium') {
    return null;
  }
  return leerPdf(await pagina.pdf({ format: 'A4', printBackground: true })).length;
}
