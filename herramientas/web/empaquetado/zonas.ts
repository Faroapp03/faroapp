// Las zonas del paquete y las páginas: qué módulos carga cada página, en qué carpeta quedan sus archivos y cómo se
// reescribe la página para que cargue una sola entrada.
// - Las páginas públicas van a js/. Las de una extensión que protege su autoridad de recorrido, a <carpeta>/js/, bajo
//   sus rutas protegidas. Una página de la extensión fuera de esas rutas (un panel de muestra que se sirve en todos los
//   modos) forma su propia zona en <su carpeta>-js/, para que su paquete no quede detrás de la autoridad de recorrido.
// - El panel privado forma su propia zona en administracion/js/, tras su ruta reservada y fuera de la copia sin
//   conexión: su código no se comparte con las páginas públicas.

import { readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { CARPETAS_PUBLICAS_CON_HUELLA } from '../../../src/plataforma/cabeceras-web.ts';
import type { Extension } from '../../../src/plataforma/extension.ts';
import { EXTENSIONES } from '../../../src/plataforma/extensiones.ts';
import { VARIANTES_RECORRIDO } from '../../../src/plataforma/variantes-recorrido.ts';
import { CARPETA_DEL_MOTOR } from '../carpeta-del-motor.ts';
import { atributo, BLOQUE_DE_GUION, modulosDeLaPagina } from '../grafo-de-paginas.ts';
import { esGuionConHuella } from '../guiones-con-huella.ts';
import { archivosPublicados, SERVICE_WORKER } from '../publicados.ts';

/** El panel privado, que solo se empaqueta en su propia zona. */
export const PANEL = 'administracion/';
/**
 * Una de las carpetas públicas con huella, sin la barra final. Las fija el servidor (src/plataforma/cabeceras-web.ts),
 * que las guarda en la caché compartida un año: el paquete deja ahí lo que lleva la huella en el nombre y no repite la
 * lista. Son dos, la de las páginas públicas y la de los trozos del motor.
 */
function carpetaConHuella(delMotor: boolean): string {
  const carpetas = CARPETAS_PUBLICAS_CON_HUELLA.filter(
    (carpeta) => carpeta.startsWith(`${CARPETA_DEL_MOTOR}/`) === delMotor,
  );
  const [carpeta] = carpetas;
  if (carpetas.length !== 1 || !carpeta) {
    throw new Error(
      `Las carpetas públicas con huella deben ser una de las páginas y una del motor: ${carpetas.join(', ')}`,
    );
  }
  return carpeta.slice(0, -1);
}

/** Los trozos del motor, dentro de su carpeta: motor/<TROZOS_DEL_MOTOR>/. */
export const TROZOS_DEL_MOTOR = posix.relative(CARPETA_DEL_MOTOR, carpetaConHuella(true));
/** La zona de las páginas públicas. */
const PUBLICA = Object.freeze({ id: 'publica', carpeta: carpetaConHuella(false) });
/** La zona del panel privado, dentro de su ruta reservada (src/plataforma/administracion.ts). */
export const ZONA_DEL_PANEL = Object.freeze({ id: 'administracion', carpeta: `${PANEL}js` });

/** Una página con módulos: su ruta y los módulos que carga, en orden. */
export interface Pagina {
  readonly ruta: string;
  readonly modulos: readonly string[];
}
/** Una zona del paquete: sus páginas y la carpeta donde quedan todos sus archivos. */
export interface Zona {
  readonly id: string;
  readonly carpeta: string;
  readonly paginas: readonly Pagina[];
}

/**
 * Un guion que no se empaqueta: los clásicos y la barrera, por su fuente o por su copia con huella, y el service
 * worker, que se construye aparte.
 */
function esClasico(archivo: string): boolean {
  return esGuionConHuella(archivo) || archivo === SERVICE_WORKER;
}

/** La carpeta del paquete de las rutas protegidas de una extensión: <su carpeta>/js. */
export function carpetaDelPaqueteDe(extension: Pick<Extension, 'entrada'>): string {
  return `${extension.entrada.split('/')[0]}/js`;
}

/**
 * La zona de un archivo de la web: la web pública, la carpeta de una extensión instalada o, para una página de la
 * extensión fuera de sus rutas protegidas, la carpeta de esa página.
 */
export function zonaDe(ruta: string): { id: string; carpeta: string } {
  if (ruta.startsWith(PANEL)) {
    return ZONA_DEL_PANEL;
  }
  const extension = EXTENSIONES.find(({ entrada }) => ruta.startsWith(`${entrada.split('/')[0]}/`));
  if (!extension) {
    return PUBLICA;
  }
  const variante = VARIANTES_RECORRIDO.find(({ id }) => id === extension.id);
  if (!ruta.endsWith('.html') || variante?.coincide(`/${ruta}`)) {
    return { id: extension.id, carpeta: carpetaDelPaqueteDe(extension) };
  }
  // Al lado de la carpeta de la página y no dentro: las carpetas de JavaScript que declara la extensión son fuentes,
  // que la CSP de cada archivo comprueba, y el paquete ya está minificado.
  const carpeta = posix.dirname(ruta);
  return { id: carpeta, carpeta: `${carpeta}-js` };
}

/**
 * Si un archivo de la web lo sustituye el paquete: todo módulo que no es clásico, también los del panel privado. La CSP
 * de cada archivo se comprueba antes, sobre estas fuentes (csp.ts).
 */
export function seEmpaqueta(archivo: string): boolean {
  return archivo.endsWith('.js') && !esClasico(archivo);
}

/**
 * Las carpetas donde quedan los archivos de las zonas: la pública, la del panel y, por cada extensión, la de sus
 * rutas protegidas y la de cada carpeta de páginas suyas fuera de ellas.
 *
 * @param paginas - Las páginas publicadas, desde web/.
 * @returns Cada carpeta terminada en «/», sin repetir.
 */
export function carpetasDelPaquete(paginas: readonly string[]): string[] {
  const carpetas = paginas.filter((ruta) => ruta.endsWith('.html')).map((ruta) => `${zonaDe(ruta).carpeta}/`);
  return [...new Set([`${PUBLICA.carpeta}/`, `${ZONA_DEL_PANEL.carpeta}/`, ...carpetas])].sort();
}

/** Las zonas de la web con sus páginas de módulos, en el orden de los archivos publicados. */
export function zonas(web: string): Zona[] {
  const porZona = new Map<string, { id: string; carpeta: string; paginas: Pagina[] }>();
  for (const ruta of archivosPublicados(web).filter((archivo) => archivo.endsWith('.html'))) {
    const modulos = modulosDeLaPagina(ruta, readFileSync(join(web, ruta), 'utf8'));
    if (modulos.length === 0) {
      continue;
    }
    const zona = zonaDe(ruta);
    const actual = porZona.get(zona.id) ?? { ...zona, paginas: [] };
    actual.paginas.push({ ruta, modulos });
    porZona.set(zona.id, actual);
  }
  return [...porZona.values()];
}

/** El nombre de archivo de una ruta de la web, sin carpetas: «scripts/recorrido/x.js» → «scripts-recorrido-x». */
export function nombrePlano(ruta: string): string {
  return ruta.replace(/\.(?:html|js)$/, '').replaceAll('/', '-');
}

/** La página con un único módulo de entrada donde estaba el primero; los demás módulos y precargas se retiran. */
export function paginaConEntrada(ruta: string, html: string, entrada: string, precargas: readonly string[]): string {
  const absoluta =
    /<script\b[^>]*\ssrc="\//.test(html) && !/<script\b[^>]*\stype="module"[^>]*\ssrc="(?!\/)/.test(html);
  const direccion = (archivo: string) => (absoluta ? `/${archivo}` : posix.relative(posix.dirname(ruta), archivo));
  let colocada = false;
  return html.replaceAll(BLOQUE_DE_GUION, (bloque, etiqueta: string) => {
    const esModulo = etiqueta.startsWith('<script') && atributo(etiqueta, 'type') === 'module';
    const esPrecarga = etiqueta.startsWith('<link') && atributo(etiqueta, 'rel') === 'modulepreload';
    if (!esModulo && !esPrecarga) {
      return bloque;
    }
    if (!esModulo || colocada) {
      return '';
    }
    colocada = true;
    const nueva = [
      `<script type="module" src="${direccion(entrada)}"></script>`,
      ...precargas.map((archivo) => `<link rel="modulepreload" href="${direccion(archivo)}" />`),
    ].join('\n    ');
    return bloque.replace(etiqueta, nueva);
  });
}
