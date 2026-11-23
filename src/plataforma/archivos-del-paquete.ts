// Tabla común de archivos y preparación en memoria del paquete de datos para Node, Worker y navegador.
// Las claves cubren todas las partes de Datos; cada plataforma conserva sus reglas de lectura y comprobación.

import { sinTextoEnBase64 } from '../comun/vectores.ts';
import { catalanConErratas, escoConErratas } from '../dominio/erratas-esco.ts';
import { comprobarTich } from '../dominio/forma-del-dato-tich.ts';
import type { Datos } from '../dominio/tipos-paquete.ts';
import { conRelacionesCompactas } from './relaciones-esco.ts';

/** El archivo del paquete con la huella SHA-256 de cada uno, que escribe la cadena de datos al exportarlo. */
export const MANIFIESTO = 'manifiesto.json';

/**
 * Archivos del paquete que no son partes de Datos: están en el manifiesto (con su huella, se publican y se guardan sin
 * conexión como los demás), pero el motor no los carga al arrancar ni el Worker los empaqueta. Los pide quien los usa,
 * cuando los necesita. La tabla de vectores del móvil (herramientas/vectores-movil/empaquetar.ts, 15 MB) la pide el
 * motor del navegador después de arrancar, para que la pantalla del recorrido no espere. El clasificador de fragmentos
 * del recorrido (herramientas/clasificador-movil/empaquetar.ts, 6 MB), igual.
 */
export const ARCHIVOS_EXTRA_DEL_PAQUETE = {
  vectoresMovil: 'vectores-movil.json',
  clasificadorMovil: 'clasificador-movil.json',
} as const;

/** El archivo del paquete de cada parte de los datos. */
export const ARCHIVO_DE_CADA_PARTE = {
  // Las ocupaciones y competencias de ESCO.
  esco: 'esco.json',
  // La exposición a la IA por ocupación (OIT).
  oit: 'oit.json',
  // Las clasificaciones de ocupaciones y sus equivalencias.
  clasificaciones: 'clasificaciones.json',
  // El nivel de exposición agregado del estudio del ODEE y la Cambra de Comerç, por ocupación: solo su parte
  // pública, sin la tabla (plataforma_datos/ia_y_trabajo/fuentes/cambra/exportacion.py).
  cambra: 'exposicion-cambra.json',
  // Los textos de las ocupaciones y tareas.
  textos: 'textos.json',
  // Los vectores de las ocupaciones de la OIT.
  vectores: 'vectores-oit.json',
  // La correspondencia EURES entre ESCO y CO-SISPE: los títulos del SEPE con que busca la búsqueda de ocupaciones.
  eures: 'correspondencia-eures.json',
  // El catálogo de formación.
  formacion: 'formacion.json',
  // Cursos del Consorci para personas que trabajan, de la copia del paquete.
  consorci: 'consorci.json',
  // Lo comprobado de los enlaces de los datos: programas del SEPE y webs de entidades.
  enlaces: 'enlaces-comprobados.json',
  // Cursos de Citilab en Cornellà, solo hechos de sus fichas.
  citilab: 'citilab.json',
  // Formación abierta en línea: solo se usa si FARO_FORMACION_ABIERTA la enciende.
  formacionAbierta: 'formacion-abierta.json',
  // Barcelona Activa, solo enlaces: ficha de la ocupación y formaciones de IA del Cibernàrium.
  barcelonaActiva: 'barcelonactiva.json',
  // FUNDAE, solo hechos y enlaces: ediciones en teleformación con su plazo de preinscripción y sus colectivos.
  fundae: 'fundae.json',
  // La hoja de ruta personal: la comarca de cada municipio (Idescat) y el temario oficial de cada especialidad, de la
  // cadena de datos (plataforma_datos/cursos/fuentes/hoja_de_ruta/lector.py).
  comarcas: 'comarcas.json',
  temarios: 'temarios.json',
  // Los vectores del catálogo de formación.
  vectoresFormacion: 'vectores-formacion.json',
  // Los datos de Cataluña.
  cataluna: 'cataluna.json',
  // Datos oficiales del grupo, en bloques propios del informe: censo anual del Idescat, perfil del Censo 2021, encuesta
  // TIC-H y Encuesta de Estructura Salarial de sus fuentes oficiales.
  ocupados: 'ocupados.json',
  censo: 'censo.json',
  tich: 'tich.json',
  salarios: 'salarios.json',
  // Contratos de cada ocupación por provincia (Observatori del Treball).
  observatori: 'observatori.json',
  // Mercado de trabajo por ocupación para el informe breve: EPA, EAES, contratos por año y comarca, y ofertas.
  mercado: 'mercado.json',
  // Señal empresarial general con su propia población y periodo.
  empresas: 'empresas.json',
  // Reparto censal consultable fuera de las hojas del informe.
  sectores: 'sectores.json',
  // Consenso de los métodos de exposición a la IA por ocupación: la confianza del informe breve.
  metodos: 'metodos.json',
  // Traducciones de Faro al catalán: lo que no traen se muestra en castellano, marcado.
  catalan: 'catalan.json',
  // Acreditación de competencias.
  acreditacion: 'acreditacion.json',
  // Certificados que el SEPE relaciona con cada ocupación en sus perfiles de la oferta de empleo.
  perfilesSepe: 'perfiles-sepe.json',
  // Y los de su informe de necesidades formativas de 2016.
  certificadosSepe2016: 'certificados-sepe-2016.json',
  // Necesidades formativas del SEPE por ocupación.
  necesidades: 'sepe-necesidades.json',
  // La acreditación ACTIC, del bloque digital transversal.
  actic: 'actic.json',
} as const satisfies Record<keyof Datos, string>;

/** El nombre de un archivo del paquete que llena una parte de los datos. */
export type ArchivoDelPaquete = (typeof ARCHIVO_DE_CADA_PARTE)[keyof Datos];

/**
 * Las partes de los datos, en el orden de la tabla. Object.keys devuelve string[], pero las claves de la tabla son
 * justo las de Datos: `satisfies Record<keyof Datos, string>` no admite ni una de más ni una de menos.
 */
export const PARTES = Object.keys(ARCHIVO_DE_CADA_PARTE) as readonly (keyof Datos)[];

/** Las partes sin las que el motor no arranca: las que Datos no marca como opcionales. */
type PartesObligatorias = { [Parte in keyof Datos]-?: object extends Pick<Datos, Parte> ? never : Parte }[keyof Datos];

/**
 * Si cada parte es obligatoria. Las demás son opcionales: si su archivo no está, el campo no aparece y el motor
 * funciona sin ellas. TypeScript obliga a que las obligatorias sean justo las que Datos no marca como opcionales.
 */
const OBLIGATORIAS: Record<PartesObligatorias, true> = {
  esco: true,
  oit: true,
  clasificaciones: true,
  cambra: true,
  textos: true,
};

/**
 * Si el motor no arranca sin esa parte (OBLIGATORIAS).
 *
 * @param parte - La parte del paquete de datos.
 * @returns Si el paquete no es válido sin ella.
 */
export function esObligatoria(parte: keyof Datos): boolean {
  return Object.hasOwn(OBLIGATORIAS, parte);
}

/**
 * Las partes que leen el recorrido local y su arranque en el navegador (plataforma/navegador/ruta-local.ts y el índice
 * de búsqueda que prepara el motor): el primer análisis no necesita ninguna más. No se escribe a partir de lo que
 * parece que se usa: pruebas/paquetes/primer-analisis.test.ts recorre esas rutas con el paquete publicado y exige que
 * las partes que tocan sean exactamente estas.
 */
export const PARTES_DEL_RECORRIDO: readonly (keyof Datos)[] = [
  'esco',
  'clasificaciones',
  'catalan',
  'eures',
  'oit',
  'textos',
  'ocupados',
];

/**
 * Las partes con que arranca el motor del navegador antes de tener el paquete entero: las del recorrido y las
 * obligatorias, sin las que el paquete no es válido. En el orden de la tabla, que es el de preparación (el catalán se
 * prepara con el ESCO ya leído).
 */
export const PARTES_DEL_PRIMER_ANALISIS: readonly (keyof Datos)[] = PARTES.filter(
  (parte) => esObligatoria(parte) || PARTES_DEL_RECORRIDO.includes(parte),
);

/**
 * Los archivos del paquete que necesita el primer análisis, además del manifiesto: los de PARTES_DEL_PRIMER_ANALISIS y
 * los extras del recorrido (ARCHIVOS_EXTRA_DEL_PAQUETE), que cambian su resultado. El service worker los guarda antes
 * que el resto (src/service-worker/primer-analisis.js, ARCHIVOS_DEL_PRIMER_ANALISIS, que comprueba npm run web:comprobar).
 */
export const ARCHIVOS_DEL_PRIMER_ANALISIS: readonly string[] = [
  ...PARTES_DEL_PRIMER_ANALISIS.map((parte) => ARCHIVO_DE_CADA_PARTE[parte]),
  ...Object.values(ARCHIVOS_EXTRA_DEL_PAQUETE),
];

/**
 * Preparación para Worker y navegador: relaciones ESCO en un Int32Array común y vectores de formación sin retener
 * su texto base64. Los vectores de tareas oficiales conservan ese texto hasta calcular la huella del estimador.
 * Node lee el paquete tal cual como referencia de los datos exportados.
 */
const PREPARAR: { [Parte in keyof Datos]?: (leida: NonNullable<Datos[Parte]>) => Datos[Parte] } = {
  // Con la fe de erratas de las etiquetas (dominio/erratas-esco.ts), igual que en Node (node/datos.ts).
  esco: (leida) => conRelacionesCompactas(escoConErratas(leida)),
  // Un dato de la TIC-H mal formado no se carga: el informe no lo pintaría (dominio/forma-del-dato-tich.ts).
  tich: comprobarTich,
  vectoresFormacion: (leidos) => ({
    ...leidos,
    especialidades: sinTextoEnBase64(leidos.especialidades),
    ocupaciones: sinTextoEnBase64(leidos.ocupaciones),
  }),
};

/**
 * Deja una parte recién leída como queda en memoria en el Worker y en el navegador (PREPARAR).
 *
 * @param parte - La parte del paquete de datos.
 * @param leida - Lo leído de su archivo.
 * @param esco - Identidad ESCO del mismo paquete, necesaria para corregir los títulos catalanes.
 * @returns La parte lista para usar.
 */
export function prepararParte<Parte extends keyof Datos>(
  parte: Parte,
  leida: unknown,
  esco?: Datos['esco'],
): Datos[Parte] {
  if (parte === 'catalan') {
    return catalanConErratas(leida as NonNullable<Datos['catalan']>, esco) as Datos[Parte];
  }
  // TypeScript no ata el tipo de PREPARAR[parte] a Parte cuando Parte es genérica: el tipo de PREPARAR ya lo garantiza.
  const preparar = PREPARAR[parte] as ((leida: NonNullable<Datos[Parte]>) => Datos[Parte]) | undefined;
  // Cada archivo es, byte a byte, el que exportó y validó la cadena de datos: su forma es la de su parte de Datos.
  const comoSuParte = leida as NonNullable<Datos[Parte]>;
  return preparar ? preparar(comoSuParte) : comoSuParte;
}

/**
 * Las partes que solo lee el motor de cursos (motores/cursos/): se cargan aparte del núcleo. Si su archivo falta (y el
 * manifiesto lo nombra), está corrupto o no coincide con su huella, el núcleo (ocupaciones, tareas, mercado y el
 * recorrido) carga igual, sin ella, y el motor de cursos queda averiado (plataforma/motor-de-cursos.ts). formacion.json
 * está: la correspondencia EURES que lee la búsqueda de ocupaciones va aparte, en correspondencia-eures.json, del núcleo.
 * No está barcelonactiva.json, que también lee el informe.
 */
const DE_CURSOS: { readonly [Parte in keyof Datos]?: true } = {
  formacion: true,
  consorci: true,
  enlaces: true,
  citilab: true,
  formacionAbierta: true,
  fundae: true,
  vectoresFormacion: true,
  actic: true,
  // Los de la hoja de ruta personal: solo los lee el motor de cursos.
  comarcas: true,
  temarios: true,
};

/**
 * Si la parte es solo del motor de cursos (DE_CURSOS).
 *
 * @param parte - La parte del paquete de datos.
 * @returns Si su fallo deja sin cursos, no sin núcleo.
 */
export function esDeCursos(parte: keyof Datos): boolean {
  return Object.hasOwn(DE_CURSOS, parte);
}
