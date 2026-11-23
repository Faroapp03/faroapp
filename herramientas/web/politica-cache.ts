// Versión clásica de la política única de caché: sin imports, tipos ni módulo. La construcción del service worker la
// sirve en memoria a sus módulos (servicio/politica-del-servicio.ts) y la lleva dentro del service-worker.js de la web
// construida, que la comprobación de la candidata exige igual, byte a byte, a lo que da esta fuente.
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import type { Extension } from '../../src/plataforma/extension.ts';
import { EXTENSIONES } from '../../src/plataforma/extensiones.ts';
import { formatearTextoConBiome } from '../comun/archivos.ts';
import { sinComentariosJs } from './comentarios-js.ts';

const RAIZ = new URL('../../', import.meta.url);
const DECLARACION =
  /^export (?=function (?:rutaFueraDeLaCopia|rutaEsEntradaRecorrido|esDeLaWeb|esNavegacionRecorrido|claveDeCopia)\()/gm;
const NUMERO_EXPORTACIONES = 5;
/** El nombre con que Biome formatea la política clásica (política de caché y contrato compartido de secciones). */
const NOMBRE_DE_FORMATO = 'politica.js';

/** La única importación de cada fuente publicada que lee el registro de extensiones, escrita exactamente así. */
const IMPORTACION_DEL_REGISTRO: Readonly<Record<string, string>> = {
  'src/plataforma/politica-cache-web.ts': "import { EXTENSIONES } from './extensiones.ts';\n",
  'src/administracion/secciones-web.js': "import { EXTENSIONES } from '../plataforma/extensiones.ts';\n",
};

/** Un valor del registro como literal de JavaScript, congelado en cada nivel como el registro. */
function literalCongelado(valor: unknown): string {
  if (Array.isArray(valor)) {
    return `Object.freeze([${valor.map(literalCongelado).join(', ')}])`;
  }
  if (valor !== null && typeof valor === 'object') {
    const campos = Object.entries(valor).map(
      ([clave, campo]) => `${JSON.stringify(clave)}: ${literalCongelado(campo)}`,
    );
    return `Object.freeze({ ${campos.join(', ')} })`;
  }
  return JSON.stringify(valor);
}

/** El tipo de la copia del registro, tal como aparece en el JSDoc de las publicaciones. */
const TIPO_DEL_REGISTRO =
  'readonly { readonly entrada: string, ' +
  'readonly rutasDeSeccion: Readonly<Partial<Record<IdSeccionPublica, readonly string[]>>> }[]';

/**
 * La copia de los datos del registro que necesitan las publicaciones sin importaciones: la entrada de cada extensión
 * instalada y las rutas que suma a cada sección, en el orden del registro.
 */
export function declaracionDelRegistro(extensiones: readonly Extension[] = EXTENSIONES): string {
  const datos = extensiones.map(({ entrada, rutasDeSeccion }) => ({ entrada, rutasDeSeccion }));
  return `/**
 * Las extensiones instaladas, copiadas del registro (src/plataforma/extensiones.ts): su entrada y sus rutas de sección.
 * @type {${TIPO_DEL_REGISTRO}}
 */
const EXTENSIONES = ${literalCongelado(datos)};
`;
}

/** Sustituye en una fuente publicada su importación del registro por la declaración recibida. */
export function conDatosDelRegistro(origen: string, fuente: string, declaracion: string): string {
  const importacion = IMPORTACION_DEL_REGISTRO[origen];
  if (importacion === undefined) {
    return fuente;
  }
  if (fuente.split(importacion).length !== 2) {
    throw new Error(`${origen} debe importar el registro de extensiones una sola vez, como ${importacion.trim()}`);
  }
  return fuente.replace(importacion, declaracion);
}

/**
 * El contrato clásico de secciones debe declarar `const EXTENSIONES` una sola vez, fuera de los comentarios: la política
 * de caché la usa sin declararla (textoPoliticaCache).
 */
export function exigirRegistroDeclarado(secciones: string): void {
  if (sinComentariosJs(secciones).match(/^const EXTENSIONES = /gm)?.length !== 1) {
    throw new Error(
      'El contrato clásico de secciones debe declarar const EXTENSIONES una sola vez: la política de caché la usa',
    );
  }
}

/** Prepara el guion sin ejecutar las fuentes; solo admite sus exportaciones cerradas y la importación del registro. */
export function textoPoliticaCache(raiz: URL = RAIZ, extensiones: readonly Extension[] = EXTENSIONES): string {
  const origen = 'src/plataforma/politica-cache-web.ts';
  // Contrato entre las dos piezas del guion: la importación del registro de la política se quita sin poner nada en su
  // lugar, porque la política va detrás del contrato de secciones, cuya copia declara `const EXTENSIONES` con los datos
  // del registro (declaracionDelRegistro), y las dos comparten el ámbito global del guion clásico. Abajo se exige que
  // esa declaración exista una sola vez (exigirRegistroDeclarado).
  const fuente = conDatosDelRegistro(origen, readFileSync(new URL(origen, raiz), 'utf8'), '');
  const javascript = stripTypeScriptTypes(fuente);
  if ([...sinComentariosJs(javascript).matchAll(DECLARACION)].length !== NUMERO_EXPORTACIONES) {
    throw new Error('La política debe exportar únicamente las cinco funciones de política conocidas como funciones');
  }
  const clasico = javascript.replace(DECLARACION, (_coincidencia, desplazamiento: number) => {
    const resto = javascript.slice(desplazamiento);
    return /^export function (?:rutaFueraDeLaCopia|rutaEsEntradaRecorrido)\(/.test(resto)
      ? ''
      : '// biome-ignore lint/correctness/noUnusedVariables: ' +
          'global consumida por el service worker y comprobada con él.\n';
  });
  if (/\b(?:import|export)\b/.test(sinComentariosJs(clasico))) {
    throw new Error('La política clásica no admite imports ni otras exportaciones');
  }
  const origenSecciones = 'src/administracion/secciones-web.js';
  const secciones = conDatosDelRegistro(
    origenSecciones,
    readFileSync(new URL(origenSecciones, raiz), 'utf8'),
    declaracionDelRegistro(extensiones),
  );
  const exportaciones = [...sinComentariosJs(secciones).matchAll(/^export (?:const|function) (\w+)/gm)].map(
    ([, nombre]) => nombre,
  );
  if (
    exportaciones.join(',') !==
    'SECCIONES_WEB,VERSION_SECCIONES_PUBLICAS,politicaSeccionesInicial,leerPoliticaSecciones,leerDocumentoSecciones,' +
      'paginaDeLaRuta,seccionDeLaRuta'
  ) {
    throw new Error('El contrato de secciones debe conservar sus exportaciones públicas conocidas');
  }
  const seccionesClasicas = secciones
    .replace(/^export (?=(?:const|function) )/gm, '')
    .replace(
      /^function (seccionDeLaRuta)\(/gm,
      '// biome-ignore lint/correctness/noUnusedVariables: global consumida por el service worker.\nfunction $1(',
    );
  if (/\b(?:import|export)\b/.test(sinComentariosJs(seccionesClasicas))) {
    throw new Error('El contrato clásico de secciones no admite dependencias de módulos');
  }
  exigirRegistroDeclarado(seccionesClasicas);
  const publicasClasicas = textoSeccionesPublicas(raiz);
  const aviso = '// Generado desde contratos y políticas de secciones y caché; no editar.\n';
  return formatearTextoConBiome(`${aviso}${seccionesClasicas}\n${publicasClasicas}\n${clasico}`, NOMBRE_DE_FORMATO);
}

function textoSeccionesPublicas(raiz: URL): string {
  const publicas = readFileSync(new URL('web/scripts/secciones-publicas.js', raiz), 'utf8');
  const cabecera = "import { leerDocumentoSecciones, VERSION_SECCIONES_PUBLICAS } from './secciones-contrato.js';";
  const exportaciones = [...sinComentariosJs(publicas).matchAll(/^export (?:async )?function (\w+)/gm)].map(
    ([, nombre]) => nombre,
  );
  if (!publicas.includes(cabecera) || exportaciones.join(',') !== 'leerSeccionesPublicas,consultarAutoridadSecciones') {
    throw new Error('Falta el contrato de secciones públicas');
  }
  const publicasClasicas = publicas
    .replace(cabecera, '')
    .replaceAll("import('./secciones-contrato.js')", "import('../scripts/secciones-contrato.js')")
    .replace(/^export (?=(?:async )?function )/gm, '')
    .replace(
      /^async function consultarAutoridadSecciones\(/gm,
      '// biome-ignore lint/correctness/noUnusedVariables: global usada por el service worker.\n' +
        'async function consultarAutoridadSecciones(',
    );
  if (/\b(?:import|export)\b/.test(sinComentariosJs(publicasClasicas))) {
    throw new Error('El contrato clásico público no admite dependencias');
  }
  return publicasClasicas;
}
