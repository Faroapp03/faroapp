// Consultas territoriales sobre la captura validada: seleccionan datos y conservan sus metadatos, sin recalcularlos.

import { esTexto } from '../../comun/json.ts';
import { VERSION_FARO } from '../../comun/version.ts';
import type { CifraCalculada } from '../../datos-globales/calculados.ts';
import {
  type Cifra,
  type DatosGlobales,
  type Territorio,
  territorioPorCodigo,
  type Valor,
} from '../../datos-globales/datos.ts';
import { EntradaInvalida } from '../../dominio/errores.ts';
import {
  MAX_CATALOGO_GLOBAL,
  MAX_SERIE_GLOBAL,
  SECCIONES_CATALOGO_GLOBAL,
  SECCIONES_GLOBALES,
} from '../esquemas-datos-globales.ts';
import type { AmbitoConsulta, Consulta } from './consultas.ts';
import type { Fuente, Procedencia } from './procedencia.ts';

type SeccionGlobal = (typeof SECCIONES_GLOBALES)[number];
type CifraGlobal = Valor | Cifra | CifraCalculada;
type Ficha = Record<string, unknown>;

/** Captura de datos necesaria solo para estas consultas; los datos de muestra nunca se ofrecen como publicados. */
function datosDe(ambito: AmbitoConsulta): DatosGlobales {
  const datos = ambito.datosGlobales;
  if (!datos || datos.muestra) {
    throw new EntradaInvalida('Los datos globales publicados no están disponibles en esta instalación.');
  }
  return datos;
}

/** Retira únicamente la serie: el catálogo conserva todos los metadatos del descriptor. */
function descriptorDe(entrada: Ficha): Ficha {
  const descriptor = { ...entrada };
  delete descriptor.valores;
  return descriptor;
}

/** Los parámetros llegan validados por el esquema compartido de la herramienta. */
function paginacion(argumentos: Ficha, maximo: number): { desplazamiento: number; maximo: number } {
  return {
    desplazamiento: typeof argumentos.desplazamiento === 'number' ? argumentos.desplazamiento : 0,
    maximo: typeof argumentos.maximo === 'number' ? argumentos.maximo : maximo,
  };
}

/** La siguiente página existe solo si queda al menos un elemento del resultado filtrado. */
function siguiente(total: number, desplazamiento: number, mostrados: number): number | null {
  const siguientePosicion = desplazamiento + mostrados;
  return siguientePosicion < total ? siguientePosicion : null;
}

/** La procedencia de un catálogo describe la selección, sin atribuir todas las cifras a una única institución. */
function procedenciaDelCatalogo(): Procedencia {
  return {
    faro: VERSION_FARO,
    fuentes: [],
    oficial: 'Cada ficha conserva la fuente y las condiciones que declara el conjunto publicado.',
    deFaro:
      'Faro ofrece este catálogo y selecciona sus páginas. Una meta, una encuesta y una cifra medida son categorías distintas.',
  };
}

/** Añade únicamente citas presentes en el dato; la ausencia de licencia no se sustituye por otra. */
function fuenteDe(ficha: Ficha): Fuente | null {
  const cita = esTexto(ficha.cita) ? ficha.cita : ficha.fuente;
  const nombre = esTexto(cita) ? cita : ficha.norma;
  if (!esTexto(nombre)) {
    return null;
  }
  return {
    cita: esTexto(ficha.url) ? `${nombre} · ${ficha.url}` : nombre,
    nivel: 'oficial',
    licencia: esTexto(ficha.licencia) ? ficha.licencia : 'La ficha no declara una licencia de reutilización.',
  };
}

/** Las cifras calculadas conservan también la cita y licencia de la encuesta de cada país incluido. */
function procedenciaDeLaFicha(ficha: Ficha, valores: readonly CifraGlobal[]): Procedencia {
  const candidatas = [fuenteDe(ficha), ...valores.map((valor) => fuenteDe({ ...valor }))];
  const fuentes = candidatas.filter((fuente): fuente is Fuente => fuente !== null);
  const unicas = fuentes.filter(
    (fuente, indice) =>
      fuentes.findIndex((otra) => otra.cita === fuente.cita && otra.licencia === fuente.licencia) === indice,
  );
  return {
    faro: VERSION_FARO,
    fuentes: unicas,
    oficial: 'La ficha y cada cifra conservan su fuente, periodo, unidad, naturaleza y notas cuando están declarados.',
    deFaro:
      ficha.naturaleza === 'calculado'
        ? 'Cálculo publicado de Faro a partir de las fuentes citadas. Esta consulta conserva sus valores, intervalos y cotas sin recalcularlos.'
        : 'Faro distribuye los datos publicados y selecciona los solicitados, sin calcular cifras nuevas. Las metas son objetivos normativos, no mediciones.',
  };
}

/**
 * Lista una página de las fichas o territorios publicados, en el orden original y sin descargar todas sus series.
 * @param ambito - Captura validada disponible en esta instalación.
 * @param argumentos - Sección y paginación validadas por el esquema público.
 * @returns Los descriptores completos, el total y la siguiente página, si existe.
 * @throws {EntradaInvalida} Si no hay datos publicados o la sección no existe.
 */
export function catalogoDatosGlobales(ambito: AmbitoConsulta, argumentos: Ficha): Consulta {
  const datos = datosDe(ambito);
  const seccion = SECCIONES_CATALOGO_GLOBAL.find((una) => una === argumentos.seccion);
  if (!seccion) {
    throw new EntradaInvalida('La sección de datos globales no existe.');
  }
  const filas = datos[seccion];
  const pagina = paginacion(argumentos, MAX_CATALOGO_GLOBAL);
  const elementos = filas
    .slice(pagina.desplazamiento, pagina.desplazamiento + pagina.maximo)
    .map((fila) => descriptorDe({ ...fila }));
  return {
    version: datos.version,
    generado: datos.generado,
    seccion,
    total: filas.length,
    desplazamiento: pagina.desplazamiento,
    siguiente: siguiente(filas.length, pagina.desplazamiento, elementos.length),
    elementos,
    procedencia: procedenciaDelCatalogo(),
  };
}

/** Una meta se pide por su identificador: no tiene una serie territorial a la que aplicar filtros. */
function comprobarConsultaDeMeta(argumentos: Ficha): void {
  if (['territorio', 'anio', 'desplazamiento', 'maximo'].some((clave) => Object.hasOwn(argumentos, clave))) {
    throw new EntradaInvalida('Las metas se consultan por sección e identificador, sin filtros de cifras.');
  }
}

/** Resuelve un código publicado, incluido el ISO3 alternativo, sin inventar un agregado mundial. */
function territorioDe(datos: DatosGlobales, argumentos: Ficha): Territorio {
  if (!esTexto(argumentos.territorio)) {
    throw new EntradaInvalida('La consulta de cifras necesita el código de un territorio.');
  }
  const territorio = territorioPorCodigo(datos, argumentos.territorio);
  if (!territorio) {
    throw new EntradaInvalida('El territorio no figura en los datos globales publicados.');
  }
  return territorio;
}

/** La cabecera de un indicador o bloque existente, sin alterar su naturaleza ni sus notas. */
function fichaDe(datos: DatosGlobales, seccion: SeccionGlobal, id: unknown): Ficha {
  const ficha = datos[seccion].find((una) => una.id === id);
  if (!ficha) {
    throw new EntradaInvalida('El identificador no figura en la sección de datos globales solicitada.');
  }
  return descriptorDe({ ...ficha });
}

/** Selecciona la serie original; los null y las cotas son datos y no se convierten en ceros. */
function cifrasDe(
  datos: DatosGlobales,
  seccion: SeccionGlobal,
  argumentos: Ficha,
  territorio: Territorio,
): readonly CifraGlobal[] {
  const admiteAnio = (cifra: CifraGlobal): boolean => argumentos.anio === undefined || cifra.anio === argumentos.anio;
  if (seccion === 'indicadores') {
    return territorio.valores.filter((cifra) => cifra.indicador === argumentos.id && admiteAnio(cifra));
  }
  if (seccion === 'metas') {
    return [];
  }
  const bloque = datos[seccion].find((uno) => uno.id === argumentos.id);
  return (bloque?.valores ?? []).filter(
    (cifra) => (cifra.territorio === territorio.codigo || cifra.territorio === territorio.iso3) && admiteAnio(cifra),
  );
}

/**
 * Consulta una ficha o serie: los identificadores desconocidos son errores y una serie sin observaciones es vacía.
 * @param ambito - Captura validada, separada de la configuración de IA.
 * @param argumentos - Identificadores, filtro de año y paginación validados por el esquema público.
 * @returns Los metadatos completos y las cifras seleccionadas; una meta completa vive en ficha, sin serie ficticia.
 * @throws {EntradaInvalida} Si falta la captura, el identificador es desconocido o los filtros no corresponden.
 */
export function consultarDatosGlobales(ambito: AmbitoConsulta, argumentos: Ficha): Consulta {
  const datos = datosDe(ambito);
  const seccion = SECCIONES_GLOBALES.find((una) => una === argumentos.seccion);
  if (!seccion) {
    throw new EntradaInvalida('La sección de cifras globales no existe.');
  }
  const ficha = fichaDe(datos, seccion, argumentos.id);
  if (seccion === 'metas') {
    comprobarConsultaDeMeta(argumentos);
  }
  const territorio = seccion === 'metas' ? null : territorioDe(datos, argumentos);
  const cifras = territorio ? cifrasDe(datos, seccion, argumentos, territorio) : [];
  const pagina = paginacion(argumentos, MAX_SERIE_GLOBAL);
  const valores = cifras.slice(pagina.desplazamiento, pagina.desplazamiento + pagina.maximo);
  return {
    version: datos.version,
    generado: datos.generado,
    seccion,
    ficha,
    territorio: territorio ? descriptorDe({ ...territorio }) : null,
    valores,
    total: cifras.length,
    desplazamiento: pagina.desplazamiento,
    siguiente: siguiente(cifras.length, pagina.desplazamiento, valores.length),
    procedencia: procedenciaDeLaFicha(ficha, valores),
  };
}
