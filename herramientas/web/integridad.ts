// La integridad de los guiones de la web: cada guion que carga una página lleva su huella (Subresource Integrity, SRI)
// y los navegadores que comprueban esa huella rechazan un archivo distinto. La cabecera de integridad de las páginas
// (src/plataforma/cabeceras-web.ts) está en modo Report-Only: informa de infracciones sin bloquearlas.
// - Los <script src> y los <link rel="modulepreload"> llevan su atributo integrity; los dos guiones clásicos de la
//   cabecera (por su fuente o por su copia con huella), además, crossorigin, porque la regla solo admite huellas
//   comprobadas en modo CORS.
// - Los módulos que se importan desde otros módulos no tienen etiqueta: su huella va en el mapa de módulos
//   (<script type="importmap">) de cada página, que lista solo lo que esa página puede cargar, con direcciones
//   relativas a ella. En una construcción son su entrada y sus trozos estáticos y dinámicos según el grafo emitido
//   (empaquetado.ts), con los bytes del paquete. Se añaden los módulos del motor que la página importa por su dirección
//   fija, con todo lo que importan.
// - En una construcción, cada archivo del paquete publicado debe ser, byte a byte, el que emitió el empaquetado.
// - El mapa va en línea, así que la CSP lo admite por su huella: la que devuelve corregirIntegridad, que la
//   construcción guarda en construccion.json y lleva al Worker (mapa-de-modulos.ts es una plantilla neutra).
// - Las páginas fuente (web/**/*.html) no llevan mapa ni integrity ni crossorigin: todo eso se inyecta en la candidata
//   de la construcción (corregirIntegridad, siempre con su contexto); nunca se escribe en web/.
// La comprobación falla si algo no coincide o si una fuente lleva huellas: las huellas nunca se escriben a mano.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { EXTENSIONES } from '../../src/plataforma/extensiones.ts';
import { LECTOR_PUBLICADO } from './catalogo-cursos.ts';
import type { ContextoWeb } from './contexto.ts';
import { carpetasDelPaquete } from './empaquetado/zonas.ts';
import { aperturas, type Etiqueta, etiquetasDe, sinComentariosHtml } from './etiquetas.ts';
import { bytesDeLaWeb, modulosQueCarga } from './grafo-de-paginas.ts';
import { esClasicoDeLaCabecera, esGuionConHuella } from './guiones-con-huella.ts';
import { huellaCsp, textoDelMapa } from './huellas-de-los-mapas.ts';
import { huellaSri, huellasDelMotorEnLasPaginas, MOTOR_EN_LAS_PAGINAS } from './integridad-motor.ts';
import { leer } from './publicados.ts';

export { huellaCsp, huellasDeLosMapas, textoDelMapa } from './huellas-de-los-mapas.ts';
export { huellaSri, huellasDelMotorEnLasPaginas, MOTOR_EN_LAS_PAGINAS } from './integridad-motor.ts';

/** El mapa de módulos de una página, con su texto tal cual (la huella de la CSP es la de ese texto). */
const MAPA = /<script type="importmap">([\s\S]*?)<\/script>/;
/** El panel privado usa SRI de entrada y no comparte el catálogo público de módulos. */
const PAGINA_ADMINISTRATIVA = 'administracion/index.html';
/** Una etiqueta que carga un guion por su dirección: <script src> o <link rel="modulepreload">. */
const ETIQUETA_DE_GUION = /<(script|link)\b([^>]*)>/g;

/**
 * Las carpetas con módulos de la web: las de la web real, las del paquete (js/, la del panel y las de cada
 * extensión, empaquetado/zonas.ts) y las de JavaScript que declara cada extensión.
 *
 * @param publicados - Los archivos que se publican, desde web/.
 * @returns Cada carpeta terminada en «/».
 */
export function carpetasDeModulos(publicados: readonly string[]): string[] {
  return [
    'scripts/',
    'idiomas/',
    'terceros/',
    ...carpetasDelPaquete(publicados),
    ...EXTENSIONES.flatMap(({ excepcionesCsp }) => excepcionesCsp.carpetasDeJavaScript),
  ];
}

/**
 * Los módulos que pueden cargar las páginas: los scripts, los diccionarios, el paquete y las bibliotecas de terceros
 * que importan los scripts, en orden. Los guiones con huella (los clásicos de la cabecera y la barrera de versión)
 * quedan fuera: son guiones clásicos que nadie importa y que su propia etiqueta carga con su integridad.
 *
 * @param publicados - Los archivos que se publican, desde web/.
 * @returns Las rutas de los módulos, ordenadas.
 */
export function modulosDeLaWeb(publicados: readonly string[]): string[] {
  const carpetas = carpetasDeModulos(publicados);
  return publicados
    .filter(
      (archivo) =>
        archivo === LECTOR_PUBLICADO.slice('web/'.length) ||
        (carpetas.some((carpeta) => archivo.startsWith(carpeta)) &&
          archivo.endsWith('.js') &&
          !esGuionConHuella(archivo)),
    )
    .sort();
}

/** La huella de un archivo de la web; vacía si no existe (eso lo cuenta comprobarReferencias). */
function huellaDe(archivo: string, contexto: ContextoWeb): string {
  const bytes = bytesDeLaWeb(archivo, contexto);
  return bytes ? huellaSri(bytes) : '';
}

/** Los módulos del motor que importan por su dirección fija los módulos de una página. */
function motorQueCarga(modulos: readonly string[], contexto: ContextoWeb): string[] {
  const textos = modulos.map((modulo) => new TextDecoder().decode(bytesDeLaWeb(modulo, contexto) ?? new Uint8Array()));
  return MOTOR_EN_LAS_PAGINAS.filter((entrada) => textos.some((texto) => texto.includes(entrada)));
}

/**
 * El mapa de módulos que debe llevar una página: la huella de cada módulo que puede cargar, por su dirección relativa.
 *
 * @param publicados - Los archivos que se publican, desde web/.
 * @param motor - Las huellas de los módulos del motor; por defecto, las de los que importa la página.
 * @param contexto - Candidata, paquete y motor de referencia.
 * @param pagina - La página, desde web/.
 * @returns La huella de cada módulo, por su dirección relativa a la página.
 */
export function mapaEsperado(
  publicados: readonly string[],
  motor: Readonly<Record<string, string>> | undefined,
  contexto: ContextoWeb,
  pagina = 'index.html',
): Record<string, string> {
  const modulos = modulosQueCarga(pagina, contexto);
  const deLaWeb = new Set(modulosDeLaWeb(publicados));
  const web = modulos
    .filter((archivo) => deLaWeb.has(archivo))
    .map((archivo): [string, string] => [archivo, huellaDe(archivo, contexto)]);
  const delMotor = motor ?? huellasDelMotorEnLasPaginas(contexto, motorQueCarga(modulos, contexto));
  const entradas = [...web, ...Object.entries(delMotor)].sort(([a = ''], [b = '']) => (a < b ? -1 : 1));
  return Object.fromEntries(
    entradas.map(([archivo, huella]) => {
      const relativa = posix.relative(posix.dirname(pagina), archivo);
      return [relativa.startsWith('.') ? relativa : `./${relativa}`, huella];
    }),
  );
}

/**
 * Los archivos del paquete publicado que no son, byte a byte, los que emitió el empaquetado: así un trozo cambiado
 * después de preparar no pasa aunque ninguna etiqueta lo nombre.
 *
 * @param contexto - La candidata y los bytes del paquete; sin paquete no hay nada que comparar.
 * @returns Un problema por archivo que falta o no coincide.
 */
export function comprobarPaquetePublicado(contexto: ContextoWeb): string[] {
  const paquete = contexto.paqueteNavegador;
  if (!paquete) {
    return [];
  }
  return [...paquete].flatMap(([archivo, esperado]) => {
    const ruta = join(contexto.web, archivo);
    if (!existsSync(ruta)) {
      return [`${archivo}: falta el archivo del paquete`];
    }
    return Buffer.compare(readFileSync(ruta), esperado) === 0 ? [] : [`${archivo}: no es el archivo del paquete`];
  });
}

/** La dirección que carga una etiqueta, si carga un guion; null si no. */
function guionDe({ nombre, atributos }: Etiqueta): string | null {
  if (nombre === 'script') {
    return atributos.get('src') ?? null;
  }
  if (nombre === 'link' && atributos.get('rel') === 'modulepreload') {
    return atributos.get('href') ?? null;
  }
  return null;
}

/**
 * Los problemas de huella de las etiquetas de una página: sin integrity, con una que no es la del archivo o sin CORS.
 */
function rutaDesdePagina(pagina: string, ruta: string): string {
  const base = new URL(pagina, 'https://faro.invalid/');
  return decodeURIComponent(new URL(ruta, base).pathname.slice(1));
}

function problemasDeEtiquetas(pagina: string, html: string, contexto: ContextoWeb): string[] {
  const problemas: string[] = [];
  for (const etiqueta of aperturas(etiquetasDe(html))) {
    const guion = guionDe(etiqueta);
    if (!guion) {
      continue;
    }
    const ruta = rutaDesdePagina(pagina, guion);
    const huella = huellaDe(ruta, contexto);
    if (!huella || etiqueta.atributos.get('integrity') !== huella) {
      problemas.push(`${pagina}: ${guion} sin su huella`);
    }
    if (esClasicoDeLaCabecera(ruta) && etiqueta.atributos.get('crossorigin') !== 'anonymous') {
      problemas.push(`${pagina}: ${guion} sin crossorigin="anonymous" (sin él no cuenta su huella)`);
    }
  }
  return problemas;
}

/** Un objeto JSON, sin null ni listas. */
function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return valor !== null && typeof valor === 'object' && !Array.isArray(valor);
}

/** imports/scopes vacíos no desvían el grafo; los alias requieren otro constructor que los resuelva y compruebe. */
function problemasDeAlias(pagina: string, mapa: unknown): string[] {
  if (!esObjeto(mapa)) {
    return [];
  }
  return ['imports', 'scopes']
    .filter((campo) => Object.hasOwn(mapa, campo) && (!esObjeto(mapa[campo]) || Object.keys(mapa[campo]).length > 0))
    .map((campo) => `${pagina}: aliases de ${campo} no admitidos por este constructor`);
}

/** Los problemas del mapa de una página: falta, va detrás de un guion o no tiene las huellas de hoy. */
function problemasDelMapa(pagina: string, html: string, esperado: string): string[] {
  const mapas = aperturas(etiquetasDe(html), 'script').filter(({ atributos }) => atributos.get('type') === 'importmap');
  if (mapas.length > 1) {
    return [`${pagina}: debe haber un único mapa de módulos`];
  }
  const texto = textoDelMapa(html);
  if (texto === null) {
    return [`${pagina}: sin mapa de módulos`];
  }
  const problemas: string[] = [];
  const primerGuion = html.search(/<script\b(?! type="importmap")|<link\b[^>]*rel="modulepreload"/);
  if (primerGuion !== -1 && primerGuion < html.indexOf('<script type="importmap">')) {
    problemas.push(`${pagina}: el mapa de módulos va detrás de un guion`);
  }
  let integridad: unknown;
  try {
    integridad = JSON.parse(texto);
  } catch {
    return [`${pagina}: el mapa de módulos no es JSON`];
  }
  problemas.push(...problemasDeAlias(pagina, integridad));
  if (!esObjeto(integridad) || JSON.stringify(integridad.integrity) !== esperado) {
    problemas.push(`${pagina}: el mapa de módulos no tiene las huellas de hoy`);
  }
  return problemas;
}

/**
 * Los problemas de integridad de unas páginas ya construidas: etiquetas sin su huella, mapas que faltan o no coinciden
 * entre páginas y una huella de la CSP que no es la del mapa.
 *
 * @param publicados - Los archivos que se publican, desde web/.
 * @param paginas - El HTML de cada página construida, por su ruta desde web/.
 * @param huellaEnLaCsp - La huella del mapa que declara la CSP de la candidata.
 * @param contexto - Candidata, paquete y motor de referencia.
 * @returns Un aviso por cada problema; vacío si la integridad es correcta.
 */
export function comprobarSalida(
  publicados: readonly string[],
  paginas: ReadonlyMap<string, string>,
  huellaEnLaCsp: string,
  contexto: ContextoWeb,
): string[] {
  const visibles = new Map([...paginas].map(([pagina, html]) => [pagina, sinComentariosHtml(html)]));
  const problemas = [...visibles].flatMap(([pagina, html]) => [
    ...problemasDeEtiquetas(pagina, html, contexto),
    ...problemasDelMapaDePagina(pagina, html, JSON.stringify(mapaEsperado(publicados, undefined, contexto, pagina))),
  ]);
  problemas.push(...comprobarPaquetePublicado(contexto));
  const huellas = new Set(
    [...visibles]
      .filter(([pagina]) => pagina !== PAGINA_ADMINISTRATIVA)
      .map(([, html]) => textoDelMapa(html))
      .filter((texto) => texto !== null)
      .map(huellaCsp),
  );
  const admitidas = new Set(huellaEnLaCsp.split(' '));
  const paginasPublicadas = publicados.filter((ruta) => ruta.endsWith('.html') && ruta !== PAGINA_ADMINISTRATIVA);
  const conjuntoCompleto = paginasPublicadas.length > 0 && paginasPublicadas.every((ruta) => visibles.has(ruta));
  if (
    [...huellas].some((huella) => !admitidas.has(huella)) ||
    (conjuntoCompleto && (admitidas.size !== huellas.size || huellaEnLaCsp.split(' ').length !== huellas.size))
  ) {
    problemas.push(
      'La huella del mapa de módulos en la CSP no es la de las páginas (corrígelo con npm run web:preparar)',
    );
  }
  return problemas;
}

/**
 * Los problemas de una página fuente que lleva lo que solo pone la construcción: su mapa, integrity o crossorigin.
 *
 * @param pagina - La página, desde web/.
 * @param html - Su HTML fuente.
 * @returns Un aviso por cada etiqueta con huellas escritas en la fuente.
 */
export function problemasDeLaFuente(pagina: string, html: string): string[] {
  const visible = sinComentariosHtml(html);
  const problemas = textoDelMapa(visible) === null ? [] : [`${pagina}: la fuente no lleva mapa de módulos`];
  for (const etiqueta of aperturas(etiquetasDe(visible))) {
    const guion = guionDe(etiqueta);
    if (guion && (etiqueta.atributos.has('integrity') || etiqueta.atributos.has('crossorigin'))) {
      problemas.push(`${pagina}: ${guion} no lleva integrity ni crossorigin en la fuente`);
    }
  }
  return problemas;
}

/**
 * La página construida a partir de su fuente: el panel, con SRI en sus etiquetas; las demás, además, con su mapa.
 *
 * @param pagina - La página, desde web/.
 * @param fuente - Su HTML fuente.
 * @param publicados - Los archivos que se publican, desde web/.
 * @param contexto - Candidata, paquete y motor de referencia.
 * @returns La página con las huellas de hoy.
 */
export function paginaConstruida(
  pagina: string,
  fuente: string,
  publicados: readonly string[],
  contexto: ContextoWeb,
): string {
  return pagina === PAGINA_ADMINISTRATIVA
    ? fuente.replaceAll(ETIQUETA_DE_GUION, (etiqueta, nombre: string, atributos: string) =>
        conHuella(etiqueta, nombre, atributos, { contexto, pagina }),
      )
    : paginaConHuellas(fuente, publicados, contexto, pagina);
}

/**
 * Los problemas de integridad de la web construida: sus páginas se comprueban tal cual (comprobarSalida). Que las
 * fuentes no lleven huellas lo comprueba web:comprobar (problemasDeLaFuente).
 *
 * @param publicados - Los archivos que se publican, desde web/.
 * @param paginas - El HTML de cada página, por su ruta desde web/.
 * @param huellaEnLaCsp - La huella del mapa que declara la CSP de la candidata.
 * @param contexto - Candidata, paquete y motor de referencia.
 * @returns Un aviso por cada problema; vacío si la integridad es correcta.
 */
export function comprobarIntegridad(
  publicados: readonly string[],
  paginas: ReadonlyMap<string, string>,
  huellaEnLaCsp: string,
  contexto: ContextoWeb,
): string[] {
  return comprobarSalida(publicados, paginas, huellaEnLaCsp, contexto);
}

/** El panel no comparte módulos ni contenido de la copia pública. Su entrada conserva SRI. */
function problemasDelMapaDePagina(pagina: string, html: string, esperado: string): string[] {
  if (pagina === PAGINA_ADMINISTRATIVA) {
    return textoDelMapa(html) === null ? [] : [`${pagina}: no debe cargar el mapa público de módulos`];
  }
  return problemasDelMapa(pagina, html, esperado);
}

/** El mapa de módulos en línea, con la sangría de la cabecera de las páginas. */
function mapaEnLinea(publicados: readonly string[], contexto: ContextoWeb, pagina = 'index.html'): string {
  const json = JSON.stringify({ integrity: mapaEsperado(publicados, undefined, contexto, pagina) }, null, 2).replaceAll(
    '\n',
    '\n    ',
  );
  return `<script type="importmap">\n    ${json}\n    </script>`;
}

/** Una etiqueta de guion con su huella de hoy (y crossorigin si es clásica); las demás etiquetas, igual. */
function conHuella(
  etiqueta: string,
  nombre: string,
  atributos: string,
  destino: { contexto: ContextoWeb; pagina: string },
): string {
  const { contexto, pagina } = destino;
  const [guion] = etiquetasDe(etiqueta).map(guionDe);
  if (!guion) {
    return etiqueta;
  }
  const limpios = atributos.replaceAll(/\s+(?:integrity|crossorigin)(?:="[^"]*")?/g, '').replace(/\s*\/$/, '');
  const ruta = rutaDesdePagina(pagina, guion);
  const cors = esClasicoDeLaCabecera(ruta) ? ' crossorigin="anonymous"' : '';
  const cierre = nombre === 'link' ? ' /' : '';
  return `<${nombre}${limpios} integrity="${huellaDe(ruta, contexto)}"${cors}${cierre}>`;
}

/**
 * Una página con las huellas de hoy: en sus etiquetas y en su mapa de módulos, delante de la primera etiqueta `<script`.
 *
 * @param html - El HTML de una página.
 * @param publicados - Los archivos que se publican, desde web/.
 * @param contexto - Candidata, paquete y motor de referencia.
 * @returns La página con las huellas de hoy.
 */
export function paginaConHuellas(
  html: string,
  publicados: readonly string[],
  contexto: ContextoWeb,
  pagina = 'index.html',
): string {
  const conEtiquetas = html.replaceAll(ETIQUETA_DE_GUION, (etiqueta, nombre: string, atributos: string) =>
    conHuella(etiqueta, nombre, atributos, { contexto, pagina }),
  );
  const mapa = mapaEnLinea(publicados, contexto, pagina);
  if (MAPA.test(conEtiquetas)) {
    return conEtiquetas.replace(MAPA, () => mapa);
  }
  if (/<script\b/.test(conEtiquetas)) {
    return conEtiquetas.replace(/<script\b/, () => `${mapa}\n    <script`);
  }
  if (/<\/head>/.test(conEtiquetas)) {
    return conEtiquetas.replace(/<\/head>/, () => `${mapa}\n  </head>`);
  }
  throw new Error(`${pagina}: no hay cabecera para el mapa de módulos`);
}

/**
 * Inyecta las huellas de hoy en las páginas de la candidata (contexto.web) y las escribe allí, con el resto del HTML
 * tal cual. La VERSION del service worker debe usar la misma huella que devuelve.
 *
 * @param publicados - Los archivos que se publican, desde web/.
 * @param contexto - Candidata y motor de referencia.
 * @returns La huella CSP del mapa de módulos.
 * @throws {Error} Si no hay páginas o una página no tiene cabecera para el mapa; prepara todas antes de escribir.
 */
export function corregirIntegridad(publicados: readonly string[], contexto: ContextoWeb): string {
  const { web } = contexto;
  const paginas = publicados.filter((archivo) => archivo.endsWith('.html'));
  if (paginas.length === 0) {
    throw new Error('No hay páginas para generar el mapa de módulos');
  }
  const construidas = new Map(
    paginas.map((pagina) => [pagina, paginaConstruida(pagina, leer(pagina, web), publicados, contexto)] as const),
  );
  for (const [pagina, contenido] of construidas) {
    writeFileSync(join(web, pagina), contenido);
  }
  const huella = [
    ...new Set(
      paginas
        .filter((pagina) => pagina !== PAGINA_ADMINISTRATIVA)
        // paginaConstruida inyecta el mapa en toda página pública o lanza («no hay cabecera»): nunca falta aquí.
        .map((pagina) => huellaCsp(textoDelMapa(construidas.get(pagina) ?? '') ?? '')),
    ),
  ]
    .sort()
    .join(' ');
  return huella;
}
