// La política de caché del service worker no tiene copia en src/service-worker/: la construcción sirve en memoria
// el módulo politica.js desde su fuente única (textoPoliticaCache), con la parte del registro de extensiones como
// literal congelado, y le añade las exportaciones que importan los módulos del service worker y las páginas de estado
// que el service worker sirve por sí mismo, en castellano y en catalán, con sus textos de los diccionarios.

import { createHash } from 'node:crypto';
import { TEXTOS_INSTALACION as INSTALACION_CA } from '../../../web/idiomas/ca/instalacion.js';
import { TEXTOS_SECCIONES as SECCIONES_CA } from '../../../web/idiomas/ca/secciones.js';
import { TEXTOS_INSTALACION as INSTALACION_ES } from '../../../web/idiomas/es/instalacion.js';
import { TEXTOS_SECCIONES as SECCIONES_ES } from '../../../web/idiomas/es/secciones.js';
import { textoPoliticaCache } from '../politica-cache.ts';

/** El nombre del módulo de la política junto a la plantilla de lo generado: no existe en el disco. */
export const MODULO_DE_LA_POLITICA = 'politica.js';

/** Lo que los módulos del service worker importan de la política, en orden alfabético. */
export const EXPORTACIONES_DE_LA_POLITICA = Object.freeze([
  'claveDeCopia',
  'consultarAutoridadSecciones',
  'esDeLaWeb',
  'esNavegacionRecorrido',
  'paginaDeLaRuta',
  'rutaEsEntradaRecorrido',
  'rutaFueraDeLaCopia',
  'seccionDeLaRuta',
]);

/** Lo que el módulo de la política añade para las páginas de estado del service worker. */
export const EXPORTACIONES_DE_LAS_PAGINAS = Object.freeze(['CSP_DE_LAS_PAGINAS', 'PAGINAS_DEL_SERVICIO']);

/** Los diccionarios de los que salen los textos de las páginas de estado, por idioma. */
const DICCIONARIOS = Object.freeze({
  es: { ...INSTALACION_ES, ...SECCIONES_ES },
  ca: { ...INSTALACION_CA, ...SECCIONES_CA },
});

/**
 * Los estados que el service worker cuenta con una página propia, con la clave del texto de cada uno. Cambiar el texto
 * de un estado es cambiar aquí su clave, que tiene que estar en los dos diccionarios. Cada página lleva el título, el
 * texto de su estado y el enlace al inicio: sin conexión y sin una página guardada que cuadre; una sección que no se ha
 * podido comprobar (sin red o con un fallo del servidor); una sección desactivada; una página de otra versión; y una
 * página detrás de un portal cuando hace falta conexión para comprobar el acceso.
 */
export const ESTADOS_DEL_SERVICIO = Object.freeze({
  'sin-conexion': 'sin-conexion.descripcion',
  'no-comprobada': 'servicio.no-comprobada',
  retirada: 'servicio.retirada',
  'otra-version': 'servicio.otra-version',
  'acceso-sin-conexion': 'servicio.acceso-sin-conexion',
});

/** El nombre de un estado del service worker con página propia. */
export type EstadoDelServicio = keyof typeof ESTADOS_DEL_SERVICIO;

/** Las claves de los textos comunes de las páginas de estado: el título y el enlace al inicio. */
export const CLAVES_COMUNES_DEL_SERVICIO = Object.freeze(['sin-conexion.titulo-principal', 'sin-conexion.volver']);

/** El marcador del enlace al inicio, que el service worker sustituye por la dirección de su ámbito. */
export const MARCADOR_DEL_INICIO = '{{inicio}}';

/**
 * El estilo mínimo de las páginas de estado: los colores del modo día de Faro, sin recursos externos. Son siempre
 * claras, como el resto del sitio al abrir: su política no admite guiones, así que no pueden leer la elección
 * guardada de la persona.
 */
const ESTILO_DE_LAS_PAGINAS = [
  ':root{color-scheme:light;background:#f4f3f0;color:#17212a;font:1.125rem/1.5 system-ui,sans-serif}',
  'main{max-width:36rem;margin:0 auto;padding:3rem 1.25rem}',
  'section+section{margin-top:2.5rem;padding-top:2rem;border-top:1px solid currentColor}',
  'h1{font-size:1.5rem;line-height:1.25;margin:0 0 1rem}a{color:inherit}',
].join('');

/**
 * La política de seguridad de las páginas de estado: solo su estilo, por su huella, y su icono vacío en línea, sin el
 * que el navegador pediría /favicon.ico y la política lo bloquearía en la consola; nada más se carga.
 */
export const CSP_DE_LAS_PAGINAS = [
  "default-src 'none'",
  'img-src data:',
  `style-src 'sha256-${createHash('sha256').update(ESTILO_DE_LAS_PAGINAS).digest('base64')}'`,
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

/** El texto, listo para escribirlo dentro del HTML. */
function escapar(texto: string): string {
  return texto.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** El texto de `clave` en `idioma`; sin él, la construcción falla. */
function texto(idioma: keyof typeof DICCIONARIOS, clave: string): string {
  const valor = (DICCIONARIOS[idioma] as Record<string, unknown>)[clave];
  if (typeof valor !== 'string' || valor === '') {
    throw new Error(`Falta el texto «${clave}» en el diccionario ${idioma}`);
  }
  return escapar(valor);
}

/** La página bilingüe de un estado: primero en castellano y después en catalán, cada parte con su idioma. */
function paginaDelEstado(clave: string): string {
  const parte = (idioma: keyof typeof DICCIONARIOS) =>
    [
      `<section lang="${idioma}">`,
      `<h1>${texto(idioma, 'sin-conexion.titulo-principal')}</h1>`,
      `<p>${texto(idioma, clave)}</p>`,
      `<p><a href="${MARCADOR_DEL_INICIO}">${texto(idioma, 'sin-conexion.volver')}</a></p>`,
      '</section>',
    ].join('');
  return [
    '<!doctype html><html lang="es"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<link rel="icon" href="data:,">',
    `<title>${texto('es', 'sin-conexion.titulo-principal')} · Faro</title>`,
    `<style>${ESTILO_DE_LAS_PAGINAS}</style></head>`,
    `<body><main>${parte('es')}${parte('ca')}</main></body></html>`,
  ].join('');
}

/** Las páginas de estado del service worker, por estado, generadas desde los diccionarios. */
export function paginasDelServicio(): Readonly<Record<string, string>> {
  return Object.freeze(
    Object.fromEntries(Object.entries(ESTADOS_DEL_SERVICIO).map(([estado, clave]) => [estado, paginaDelEstado(clave)])),
  );
}

/**
 * El módulo de la política del service worker, generado desde su fuente única.
 *
 * @returns La política clásica publicada con sus exportaciones para el empaquetado.
 */
export function moduloDeLaPolitica(): string {
  const paginas = [
    `const CSP_DE_LAS_PAGINAS = ${JSON.stringify(CSP_DE_LAS_PAGINAS)};`,
    `const PAGINAS_DEL_SERVICIO = ${JSON.stringify(paginasDelServicio())};`,
    '',
  ].join('\n');
  const exportaciones = [...EXPORTACIONES_DE_LAS_PAGINAS, ...EXPORTACIONES_DE_LA_POLITICA];
  return `${textoPoliticaCache()}\n${paginas}export { ${exportaciones.join(', ')} };\n`;
}
