// Los guiones clásicos que cargan las páginas por su etiqueta se publican con la huella de sus bytes en el nombre
// (<carpeta>/<prefijo>-<sha256>.js): ningún service worker anterior los tiene en su copia, así que siempre llegan de la
// red con los bytes que nombra el integrity de la página nueva. Con un nombre fijo, la copia anterior serviría los
// bytes viejos y el navegador bloquearía el guion. Son la barrera de versión y los dos guiones clásicos de la cabecera
// (el tema y el idioma iniciales). Sus fuentes de web/ no cambian de nombre y las páginas fuente las citan por él; al
// construir, la publicación cambia los bytes (quita comentarios) y la preparación renombra cada copia por su huella
// final y reescribe la referencia de todas las páginas que la cargan.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { BARRERA } from './barrera-publicacion.ts';
import { listar } from './publicados.ts';

/** Un guion clásico que se publica con la huella de sus bytes en el nombre. */
export interface GuionConHuella {
  /** Su fuente, desde web/: el nombre con que lo citan las páginas fuente. */
  readonly fuente: string;
  /** El principio del nombre publicado, en la carpeta de la fuente: <prefijo>-<sha256>.js. */
  readonly prefijo: string;
  /** Las únicas páginas que lo cargan, cada una una vez; null si lo puede cargar cualquier página, una vez. */
  readonly paginas: ReadonlySet<string> | null;
}

/** Los guiones clásicos de la cabecera: ponen el tema y el idioma antes de pintar. */
export const CLASICOS_DE_LA_CABECERA: readonly GuionConHuella[] = [
  { fuente: 'scripts/tema-inicial.js', prefijo: 'tema-inicial', paginas: null },
  { fuente: 'scripts/idioma-inicial.js', prefijo: 'idioma-inicial', paginas: null },
  {
    fuente: 'scripts/inicio-animacion-inicial.js',
    prefijo: 'inicio-animacion-inicial',
    paginas: new Set(['inicio.html']),
  },
];
/** Todos los guiones que se publican con su huella en el nombre. */
export const GUIONES_CON_HUELLA: readonly GuionConHuella[] = [BARRERA, ...CLASICOS_DE_LA_CABECERA];

/** Un atributo src de una etiqueta. El mapa de módulos se genera después y lo cita sin src: no cuenta. */
const ATRIBUTO_SRC = /(\ssrc=")([^"]*)(")/gu;
const ORIGEN = 'https://faro.invalid';

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
const carpetaDe = ({ fuente }: GuionConHuella): string => posix.dirname(fuente);
const generada = ({ prefijo }: GuionConHuella): RegExp => new RegExp(`^${prefijo}-([a-f0-9]{64})\\.js$`, 'u');

/** Si una ruta desde web/ es la copia de un guion con la huella en el nombre (no su fuente). */
function esCopia(guion: GuionConHuella, ruta: string): boolean {
  return posix.dirname(ruta) === carpetaDe(guion) && generada(guion).test(posix.basename(ruta));
}

/** El guion con huella de una ruta desde web/: su fuente o una copia con huella; undefined si no es ninguno. */
export function guionDe(ruta: string): GuionConHuella | undefined {
  return GUIONES_CON_HUELLA.find((guion) => ruta === guion.fuente || esCopia(guion, ruta));
}

/** Si una ruta desde web/ es un guion con huella, por su fuente o por una copia con huella. */
export function esGuionConHuella(ruta: string): boolean {
  return guionDe(ruta) !== undefined;
}

/** Si una ruta desde web/ es uno de los guiones clásicos de la cabecera, por su fuente o por una copia con huella. */
export function esClasicoDeLaCabecera(ruta: string): boolean {
  const guion = guionDe(ruta);
  return guion !== undefined && CLASICOS_DE_LA_CABECERA.includes(guion);
}

/** La ruta desde web/ que carga un src en una página; null si es de otro origen. */
function rutaDesde(pagina: string, src: string): string | null {
  const url = new URL(src, new URL(pagina, `${ORIGEN}/`));
  return url.origin === ORIGEN ? decodeURIComponent(url.pathname.slice(1)) : null;
}

/** Las rutas desde web/ que una página carga de un guion, en orden: su fuente o cualquier copia con huella. */
function referencias(guion: GuionConHuella, pagina: string, html: string): string[] {
  return [...html.matchAll(ATRIBUTO_SRC)]
    .map(([, , src = '']) => rutaDesde(pagina, src))
    .filter((ruta): ruta is string => ruta !== null && (ruta === guion.fuente || esCopia(guion, ruta)));
}

/** Las copias con huella de un guion que hay en una web, por su nombre de archivo. */
function copias(web: string, guion: GuionConHuella): string[] {
  const carpeta = join(web, carpetaDe(guion));
  return existsSync(carpeta) ? readdirSync(carpeta).filter((archivo) => generada(guion).test(archivo)) : [];
}

/** Las páginas de una web, desde web/, con su HTML. */
function paginasDe(web: string): Map<string, string> {
  return new Map(
    listar('', web)
      .filter((archivo) => archivo.endsWith('.html'))
      .sort()
      .map((pagina) => [pagina, readFileSync(join(web, pagina), 'utf8')]),
  );
}

/** Si el guion tiene algo en la web: su fuente, alguna copia, una página que lo cite o una que deba cargarlo. */
function estaEnLaWeb(web: string, guion: GuionConHuella, paginas: ReadonlyMap<string, string>): boolean {
  return (
    existsSync(join(web, guion.fuente)) ||
    copias(web, guion).length > 0 ||
    [...paginas.keys()].some((pagina) => guion.paginas?.has(pagina)) ||
    [...paginas].some(([pagina, html]) => referencias(guion, pagina, html).length > 0)
  );
}

/**
 * Los bytes de los que sale el guion: su fuente o, en una web ya preparada, la única copia con huella. Nulo si no hay
 * ninguna o hay varias copias sin fuente.
 */
function origenDe(web: string, guion: GuionConHuella): string | null {
  if (existsSync(join(web, guion.fuente))) {
    return join(web, guion.fuente);
  }
  const [unica, ...otras] = copias(web, guion);
  return unica !== undefined && otras.length === 0 ? join(web, carpetaDe(guion), unica) : null;
}

/**
 * El nombre de archivo con que se publica un guion: su prefijo y el SHA-256 de sus bytes.
 *
 * @throws {Error} Si no hay de dónde sacar sus bytes.
 */
export function nombrePublicado(web: string, guion: GuionConHuella): string {
  const origen = origenDe(web, guion);
  if (origen === null) {
    throw new Error(`Falta la fuente de ${guion.fuente}`);
  }
  return `${guion.prefijo}-${sha256(readFileSync(origen))}.js`;
}

/** Si unos bytes son la copia del guion que nombra su huella y, con la fuente presente, idénticos a ella. */
function esCopiaValida(web: string, guion: GuionConHuella, nombre: string, bytes: Buffer): boolean {
  const fuente = join(web, guion.fuente);
  return (
    generada(guion).exec(nombre)?.[1] === sha256(bytes) && (!existsSync(fuente) || bytes.equals(readFileSync(fuente)))
  );
}

/**
 * Si una página puede cargar por su etiqueta, como guion clásico, la copia con huella de una ruta desde web/: la de un
 * guion con huella que admite esa página, presente en la web y con los bytes que nombra su huella.
 */
export function copiaConHuellaAdmitida(pagina: string, ruta: string, web: string): boolean {
  const guion = guionDe(ruta);
  const archivo = join(web, ruta);
  return (
    guion !== undefined &&
    esCopia(guion, ruta) &&
    (guion.paginas === null || guion.paginas.has(pagina)) &&
    existsSync(archivo) &&
    esCopiaValida(web, guion, posix.basename(ruta), readFileSync(archivo))
  );
}

/** El problema de cuántas veces carga una página un guion; null si está bien. */
function problemaDeCuantas(guion: GuionConHuella, pagina: string, cuantas: number): string | null {
  const debe = guion.paginas?.has(pagina) === true;
  if ((debe && cuantas !== 1) || cuantas > 1) {
    return `${pagina}: debe cargar ${guion.fuente} una sola vez`;
  }
  return null;
}

/**
 * Renombra el guion por la huella de sus bytes, retira las copias anteriores y reescribe la referencia de todas las
 * páginas que lo cargan. Sin nada del guion en la web, no hace nada.
 *
 * @throws {Error} Si falta su fuente o una página no lo carga las veces que debe; antes de escribir nada.
 */
export function prepararGuion(web: string, guion: GuionConHuella): void {
  const paginas = paginasDe(web);
  if (!estaEnLaWeb(web, guion, paginas)) {
    return;
  }
  const nombre = nombrePublicado(web, guion);
  const problemas = [...paginas].flatMap(([pagina, html]) => {
    const problema = problemaDeCuantas(guion, pagina, referencias(guion, pagina, html).length);
    return problema === null ? [] : [problema];
  });
  if (problemas.length) {
    throw new Error(problemas.join('\n'));
  }
  const carpeta = join(web, carpetaDe(guion));
  const origen = origenDe(web, guion);
  if (origen !== null && posix.basename(origen) !== nombre) {
    renameSync(origen, join(carpeta, nombre));
  }
  for (const anterior of copias(web, guion).filter((archivo) => archivo !== nombre)) {
    unlinkSync(join(carpeta, anterior));
  }
  for (const [pagina, html] of paginas) {
    const reescrita = html.replace(ATRIBUTO_SRC, (atributo, abre: string, src: string, cierra: string) => {
      const ruta = rutaDesde(pagina, src);
      const delGuion = ruta !== null && (ruta === guion.fuente || esCopia(guion, ruta));
      return delGuion ? `${abre}${src.slice(0, src.lastIndexOf('/') + 1)}${nombre}${cierra}` : atributo;
    });
    if (reescrita !== html) {
      writeFileSync(join(web, pagina), reescrita);
    }
  }
}

/**
 * Los problemas de un guion en la web construida: publicado con su nombre fijo, sin una única copia con huella, una
 * copia que no corresponde a su fuente o páginas que no lo cargan por su copia, o no las veces que deben.
 */
export function comprobarGuion(web: string, guion: GuionConHuella): string[] {
  const paginas = paginasDe(web);
  if (!estaEnLaWeb(web, guion, paginas)) {
    return [];
  }
  const problemas: string[] = [];
  if (existsSync(join(web, guion.fuente))) {
    problemas.push(`${guion.fuente}: se publica con su nombre fijo; en la web construida va con su huella`);
  }
  const [nombre, ...otras] = copias(web, guion);
  if (nombre === undefined || otras.length > 0) {
    return [...problemas, `${guion.fuente}: falta su copia con huella o hay más de una`];
  }
  const publicado = `${carpetaDe(guion)}/${nombre}`;
  if (!esCopiaValida(web, guion, nombre, readFileSync(join(web, publicado)))) {
    problemas.push(`${publicado}: no corresponde a su fuente`);
  }
  for (const [pagina, html] of paginas) {
    const cargadas = referencias(guion, pagina, html);
    const problema = problemaDeCuantas(guion, pagina, cargadas.length);
    if (problema !== null) {
      problemas.push(problema);
    }
    if (cargadas.some((ruta) => ruta !== publicado)) {
      problemas.push(`${pagina}: carga ${guion.fuente} por otro nombre que su copia con huella (${publicado})`);
    }
  }
  return problemas;
}

/** Lo generado de un guion que no va en las fuentes de web/: copias con su huella y páginas que las citan. */
function generadoEnLasFuentes(web: string, guion: GuionConHuella): string[] {
  const paginas = [...paginasDe(web)].filter(([pagina, html]) =>
    referencias(guion, pagina, html).some((ruta) => ruta !== guion.fuente),
  );
  return [
    ...copias(web, guion).map(
      (archivo) => `${carpetaDe(guion)}/${archivo}: la copia con su huella solo existe en la web construida`,
    ),
    ...paginas.map(([pagina]) => `${pagina}: en las fuentes, el guion se carga por su fuente (${guion.fuente})`),
  ];
}

/** Prepara en la web construida todos los guiones con huella (prepararGuion). */
export function prepararGuionesConHuella(web: string): void {
  for (const guion of GUIONES_CON_HUELLA) {
    prepararGuion(web, guion);
  }
}

/** Los problemas de todos los guiones con huella en la web construida (comprobarGuion). */
export function comprobarGuionesConHuella(web: string): string[] {
  return GUIONES_CON_HUELLA.flatMap((guion) => comprobarGuion(web, guion));
}

/** Lo generado de los guiones con huella que no puede quedar en las fuentes de web/. */
export function guionesConHuellaEnLasFuentes(web: string): string[] {
  return GUIONES_CON_HUELLA.flatMap((guion) => generadoEnLasFuentes(web, guion));
}
