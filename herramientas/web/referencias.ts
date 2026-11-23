// Las referencias locales de la web llevan a algo que se publica: los href, src, poster y srcset de las páginas (con
// su id si apuntan a uno), los url() de las hojas, las importaciones de los scripts y las rutas del manifiesto.
// La construcción comprueba esos destinos. La función de uso se prueba por separado: busca referencias entrantes,
// no recorre el alcance desde páginas raíz ni constituye una guardia de la construcción. Las páginas se leen con
// el analizador de etiquetas común (etiquetas.ts), el mismo que usa la CSP.

import { posix } from 'node:path';
import { PORTADA } from '../../src/plataforma/cabeceras-web.ts';
import { importacionesJs, sinComentariosJs } from './comentarios-js.ts';
import { aperturas, etiquetasDe, sinComentariosHtml } from './etiquetas.ts';
import { referenciasCss } from './referencias-css.ts';
import { ejecutablesDelModulo, recursosDelModulo } from './referencias-js-recursos.ts';

export { referenciasCss } from './referencias-css.ts';

import { leer, WEB } from './publicados.ts';

/** Hojas, scripts y diccionarios que necesitan una referencia entrante publicada. */
const CARPETAS_USADAS = /^(estilos|scripts|idiomas)\//;
/** Atributos de una etiqueta cuyo valor es una dirección: enlaces, recursos y dibujos de SVG (xlink:href). */
const ATRIBUTOS_CON_DIRECCION = new Set(['href', 'xlink:href', 'src', 'poster', 'action']);
/** Claves del manifiesto cuyo valor es una ruta de la web. */
const CLAVES_CON_RUTA = new Set(['src', 'url', 'start_url']);
/** El esquema de una URL (RFC 3986, 3.1), con los dos puntos: «https:», «data:»; se usa con la bandera /i. */
const ESQUEMA = '[a-z][a-z0-9+.-]*:';
/** Un destino de otro origen: con esquema y «//» (https://, ftp://…) o solo «//». data: y blob: son del documento. */
export const OTRO_ORIGEN = new RegExp(`^\\s*(?:${ESQUEMA})?//`, 'i');
/** Una referencia que empieza por un esquema o por «//». */
const ESQUEMA_O_DOBLE_BARRA = new RegExp(`^(?:${ESQUEMA}|//)`, 'i');

/** Una referencia que no es un archivo de la web: lleva esquema (https:, data:, mailto:…) o es de otro origen. */
function esExterna(referencia: string): boolean {
  return ESQUEMA_O_DOBLE_BARRA.test(referencia);
}

/**
 * El primer grupo de cada coincidencia de `patron` en `texto`.
 *
 * @param texto - El texto en que se busca.
 * @param patron - Una expresión regular global (con «g») con al menos un grupo.
 * @returns El primer grupo de cada coincidencia, en orden; vacío («») si no capturó nada.
 */
export function primerGrupo(texto: string, patron: RegExp): string[] {
  return [...texto.matchAll(patron)].map((coincidencia) => coincidencia[1] ?? '');
}

/**
 * Las rutas de un srcset: cada candidato es «ruta anchura».
 *
 * @param srcset - El valor del atributo.
 * @returns La ruta de cada candidato, en orden.
 */
function candidatoSrcset(srcset: string, inicio: number): { ruta: string; siguiente: number } {
  let indice = inicio;
  while (indice < srcset.length && /[\s,]/.test(srcset[indice] ?? '')) {
    indice += 1;
  }
  const principio = indice;
  while (indice < srcset.length && !/\s/.test(srcset[indice] ?? '')) {
    indice += 1;
  }
  const ruta = srcset.slice(principio, indice).replace(/,+$/, '');
  if (srcset[indice - 1] !== ',') {
    while (indice < srcset.length && srcset[indice] !== ',') {
      indice += 1;
    }
    indice += 1;
  }
  return { ruta, siguiente: indice };
}
export function rutasDeSrcset(srcset: string): string[] {
  const rutas: string[] = [];
  let indice = 0;
  while (indice < srcset.length) {
    const candidato = candidatoSrcset(srcset, indice);
    if (candidato.ruta) {
      rutas.push(candidato.ruta);
    }
    indice = candidato.siguiente;
  }
  return rutas;
}

/** Ambos servidores redirigen la navegación a raíz hacia la portada; no es un alias de recursos o módulos. */
function destinoDeNavegacion(ruta: string): string {
  return ruta === '/' || ruta.startsWith('/#') ? PORTADA + ruta.slice(1) : ruta;
}

/** Las navegaciones siguen la portada; los atributos de recursos conservan su dirección literal. */
function direccionesDelAtributo(nombre: string, atributo: string, valor: string | null): string[] {
  if (valor === null) {
    return [];
  }
  if (atributo === 'srcset' || atributo === 'imagesrcset') {
    return rutasDeSrcset(valor);
  }
  if (nombre === 'a' && atributo === 'href') {
    return [destinoDeNavegacion(valor)];
  }
  if (nombre === 'object' && atributo === 'data') {
    return [valor];
  }
  return ATRIBUTOS_CON_DIRECCION.has(atributo) ? [valor] : [];
}

function referenciasMeta(nombre: string, atributos: Map<string, string | null>): string[] {
  if (nombre !== 'meta') {
    return [];
  }
  const contenido = atributos.get('content');
  if (!contenido) {
    return [];
  }
  const propiedad = (atributos.get('property') ?? atributos.get('name') ?? '').toLowerCase();
  if (['og:image', 'og:url', 'twitter:image'].includes(propiedad)) {
    return [contenido];
  }
  if ((atributos.get('http-equiv') ?? '').toLowerCase() !== 'refresh') {
    return [];
  }
  const destino = /(?:^|;)\s*url\s*=\s*(?:["']([^"']+)["']|([^;]+))/i.exec(contenido);
  return destino ? [(destino[1] ?? destino[2] ?? '').trim()] : [];
}

/**
 * Las direcciones locales o externas de una página: href, xlink:href, src, poster y cada candidato de srcset, leídas
 * con el analizador de etiquetas común (entre comillas dobles, simples o sin ellas) sobre la página sin comentarios.
 */
function referenciasHtml(html: string): string[] {
  const limpio = sinComentariosHtml(html);
  const atributos = aperturas(etiquetasDe(limpio)).flatMap(({ nombre, atributos }) => [
    ...[...atributos].flatMap(([atributo, valor]) =>
      atributo === 'style' && valor ? referenciasCss(valor) : direccionesDelAtributo(nombre, atributo, valor),
    ),
    ...referenciasMeta(nombre, atributos),
  ]);
  const sinGuiones = limpio.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '');
  const hojas = [...sinGuiones.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)];
  return [...atributos, ...hojas.flatMap((hoja) => referenciasCss(hoja[1] ?? ''))];
}

/** Los ids de una página, leídos con el analizador de etiquetas común y sin comentarios. */
function idsDe(html: string): Set<string> {
  const ids = new Set<string>();
  for (const { atributos } of aperturas(etiquetasDe(sinComentariosHtml(html)))) {
    const id = atributos.get('id');
    if (id) {
      ids.add(id);
    }
  }
  return ids;
}

/**
 * Lo que importa un script: las importaciones de siempre, las que se piden cuando hacen falta (`import('./x.js')`),
 * como los diccionarios de idiomas/ y el paso 4 del recorrido, y los Workers que arranca
 * (`new Worker(urlDeGuion(new URL('./x.js', import.meta.url)))`, como el motor del dispositivo; urlDeGuion es la
 * política de Trusted Types de scripts/confianza.js). El service worker se publica en un solo archivo y no carga
 * ningún guion.
 *
 * @param js - El texto del script.
 * @returns Los especificadores que importa y las rutas de Workers, tal como están escritos.
 */
export function dependenciasEjecutablesJs(js: string): string[] {
  const sinEl = sinComentariosJs(js);
  return [
    ...new Set([
      ...importacionesJs(js),
      ...ejecutablesDelModulo(js),
      ...primerGrupo(sinEl, /new\s+Worker\(\s*(?:urlDeGuion\(\s*)?new\s+URL\(\s*['"](\.[^'"]+)['"]/g),
    ]),
  ];
}

/** Incluye también recursos y enlaces relativos al módulo que deben existir en la publicación. */
export function referenciasJs(js: string): string[] {
  return [...new Set([...dependenciasEjecutablesJs(js), ...recursosDelModulo(js)])];
}

/**
 * Recorre el manifiesto entero y recoge el valor de cada clave que guarda una ruta. La recursión baja un nivel del JSON
 * en cada llamada: la acota la profundidad del manifiesto, un archivo pequeño de web/ escrito a mano.
 */
function rutasDelManifiesto(valor: unknown, clave = ''): string[] {
  if (typeof valor === 'string') {
    if (clave === 'start_url') {
      return [destinoDeNavegacion(valor)];
    }
    return CLAVES_CON_RUTA.has(clave) ? [valor] : [];
  }
  if (Array.isArray(valor)) {
    return valor.flatMap((elemento) => rutasDelManifiesto(elemento));
  }
  if (valor && typeof valor === 'object') {
    return Object.entries(valor).flatMap(([hija, contenido]) => rutasDelManifiesto(contenido, hija));
  }
  return [];
}

/** Las rutas del manifiesto de la aplicación web. */
function referenciasManifiesto(texto: string): string[] {
  const manifiesto: unknown = JSON.parse(texto);
  return rutasDelManifiesto(manifiesto);
}

/** Las referencias de un archivo publicado, según su tipo: página, hoja, manifiesto o script. */
function referenciasDe(archivo: string, texto: string): string[] {
  if (archivo.endsWith('.html')) {
    return referenciasHtml(texto);
  }
  if (archivo.endsWith('.css')) {
    return referenciasCss(texto);
  }
  if (archivo.endsWith('.webmanifest')) {
    return referenciasManifiesto(texto);
  }
  if (archivo.endsWith('.js')) {
    return referenciasJs(texto);
  }
  return [];
}

/**
 * La ruta publicada a la que lleva `ruta`, escrita desde `archivo`.
 *
 * @param archivo - El archivo que la escribe, con su ruta desde web/.
 * @param ruta - La ruta escrita en él: relativa a su carpeta o, con «/» inicial, a la raíz web.
 * @returns La ruta desde web/, normalizada.
 */
export function resolver(archivo: string, ruta: string): string {
  return posix.normalize(ruta.startsWith('/') ? ruta.slice(1) : posix.join(posix.dirname(archivo), ruta));
}

/** Los módulos publicados usan rutas relativas; el mapa generado no crea alias para especificadores bare. */
function importacionSinAlias(archivo: string, referencia: string): boolean {
  return archivo.endsWith('.js') && !referencia.startsWith('.') && !referencia.startsWith('/');
}

function decodificarRuta(ruta: string): string | undefined {
  try {
    return decodeURIComponent(ruta);
  } catch {
    return undefined;
  }
}

function comprobarFragmento(
  destino: string,
  fragmento: string,
  {
    archivo,
    referencia,
    idsPorPagina,
    web,
  }: { archivo: string; referencia: string; idsPorPagina: Map<string, Set<string>>; web: string },
): string[] {
  let ids = idsPorPagina.get(destino);
  if (!ids) {
    ids = idsDe(leer(destino, web));
    idsPorPagina.set(destino, ids);
  }
  return ids.has(fragmento) ? [] : [`${archivo}: «${referencia}» apunta a un id que no existe en ${destino}`];
}

/** El problema de una referencia local: lleva consulta, no lleva a nada publicado o apunta a un id que no existe. */
function comprobarReferencia(
  archivo: string,
  referencia: string,
  publicados: ReadonlySet<string>,
  { idsPorPagina, web }: { idsPorPagina: Map<string, Set<string>>; web: string },
): string[] {
  if (!referencia || esExterna(referencia)) {
    return [];
  }
  if (importacionSinAlias(archivo, referencia)) {
    return [`${archivo}: «${referencia}» no es una importación relativa; el mapa generado no declara aliases`];
  }
  if (referencia.includes('?')) {
    return [`${archivo}: «${referencia}» lleva una consulta; la caché se renueva con la VERSION del service worker`];
  }
  const [ruta = '', fragmento] = referencia.split('#');
  const rutaDecodificada = decodificarRuta(ruta);
  if (rutaDecodificada === undefined) {
    return [`${archivo}: «${referencia}» contiene una codificación inválida`];
  }
  const destino = ruta ? resolver(archivo, rutaDecodificada) : archivo;
  if (!publicados.has(destino)) {
    return [`${archivo}: «${referencia}» no existe entre los archivos publicados`];
  }
  if (fragmento && destino.endsWith('.html')) {
    return comprobarFragmento(destino, fragmento, { archivo, referencia, idsPorPagina, web });
  }
  return [];
}

/**
 * Cada referencia local lleva a un archivo publicado. Las listas del service worker se revisan aparte.
 *
 * @param publicados - Lo publicado de web/, con su ruta desde web/.
 * @returns Un problema por referencia rota, con consulta o a un id que no existe.
 */
export function comprobarReferencias(publicados: readonly string[], web: string = WEB): string[] {
  const conjunto = new Set(publicados);
  const idsPorPagina = new Map<string, Set<string>>();
  const conReferencias = publicados.filter((archivo) => /\.(html|css|js|webmanifest)$/.test(archivo));
  return conReferencias.flatMap((archivo) => {
    const texto = leer(archivo, web);
    if (
      archivo.endsWith('.html') &&
      aperturas(etiquetasDe(sinComentariosHtml(texto)), 'base').some(({ atributos }) => atributos.has('href'))
    ) {
      return [`${archivo}: base no admitida para comprobar referencias`];
    }
    return referenciasDe(archivo, texto).flatMap((referencia) =>
      comprobarReferencia(archivo, referencia, conjunto, { idsPorPagina, web }),
    );
  });
}

/**
 * Busca archivos sin referencia entrante entre las hojas, scripts y diccionarios.
 * No demuestra alcanzabilidad desde las páginas ni se ejecuta en la construcción.
 *
 * @param publicados - Lo publicado de web/, con su ruta desde web/.
 * @returns Un problema por archivo que nadie usa.
 */
export function comprobarUso(publicados: readonly string[], web: string = WEB): string[] {
  const usados = new Set<string>();
  for (const archivo of publicados.filter((publicado) => /\.(html|css|js)$/.test(publicado))) {
    const locales = referenciasDe(archivo, leer(archivo, web)).filter((referencia) => !esExterna(referencia));
    for (const referencia of locales) {
      usados.add(resolver(archivo, referencia.split('#')[0] ?? ''));
    }
  }
  return publicados
    .filter((archivo) => CARPETAS_USADAS.test(archivo) && !usados.has(archivo))
    .map((archivo) => `${archivo}: ninguna página, hoja ni script lo usa`);
}
