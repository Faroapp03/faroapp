// Buscador de ocupaciones ESCO sin IA: nombres, formas masculina y femenina, alternativos y descripción.
// Propone candidatas; la persona confirma. Nunca elige por ella.
// Busca también por el título catalán de cada ocupación, si el paquete trae la traducción de Faro (catalan.json, hecha
// con IA): ESCO no tiene versión catalana, y sin él «Sóc infermera» o «Treballo de fuster» no encontrarían nada. El
// título traducido solo sirve para encontrar la ocupación; lo que se enseña es siempre el título oficial.
// Aquí están las búsquedas y la lista de candidatas. Sus piezas van cada una en su archivo: cómo se comparan las
// palabras (palabras.ts), los índices del catálogo, que se construyen una vez al arrancar (indice.ts), lo que se busca
// (consulta.ts) y los puntos de cada ocupación (puntuacion.ts).

import type { Idioma } from '../../../../src/comun/idioma.ts';
import type { Datos } from '../../../../src/dominio/tipos-paquete.ts';
import { type Area, areaDeLaBusqueda } from './area.ts';
import { type Consulta, type Correccion, consultasDe, posicionesCandidatas } from './consulta.ts';
import { delSector, type PistaDeSector, partirOficioYLugar, pistasDeSector, type TextoPartido } from './contexto.ts';
import { marcaDeSigla, SIGLAS_SOLO_EN_MAYUSCULAS } from './denominaciones-de-diccionario.ts';
import { conFrasesDeDiccionario } from './frases-de-diccionario.ts';
import { frecuenciaDeLosGrupos } from './frecuencia.ts';
import { precisionQueFalta } from './genericas.ts';
import { escritoEnCatalan, type Indice, indiceDe, type OcupacionIndexada, reservaCatalana } from './indice.ts';
import { type MarcaEncontrada, marcasDelTexto, pistaDeLaMarca } from './marcas.ts';
import { formaComun, palabrasDe, sinPresentacion } from './palabras.ts';
import { PUNTOS_FRASE_EXACTA, puntuarFormas } from './puntuacion.ts';

/** Puntos mínimos para que una ocupación entre en la lista. */
const PUNTOS_MINIMOS = 20;
/** Se redondea a un decimal: se multiplica por esto, se redondea y se divide. */
const FACTOR_DE_UN_DECIMAL = 10;

/** Candidatas que devuelve, como mucho, una búsqueda. */
const LIMITE_BUSQUEDA = 8;
/** Candidatas que devuelven, como mucho, varias búsquedas sumadas (buscarVarias). */
const LIMITE_VARIAS = 6;
/** Bonificación de los grupos ISCO que sugiere el modelo, por orden de preferencia. */
const BONO_PRIMER_GRUPO = 30;
const BONO_SEGUNDO_GRUPO = 20;
const BONO_TERCER_GRUPO = 10;
const BONO_GRUPO = Object.freeze([BONO_PRIMER_GRUPO, BONO_SEGUNDO_GRUPO, BONO_TERCER_GRUPO]);
/** Ocupaciones de cada grupo sugerido que reciben la bonificación. */
const BONIFICADAS_POR_GRUPO = 2;
/**
 * Puntos que suma una candidata que ya encaja por su nombre si su grupo es del sector que nombra el texto
 * (contexto.ts): desempata, no decide. Elegido por validación cruzada de 5 pliegues sobre 100 casos, junto con
 * FACTOR_LUGAR (consulta.ts), entre 0, 4 y 8: 8 ganó en 3 de 5 pliegues.
 */
const BONO_SECTOR = 8;
/**
 * Puntos que suma, como mucho, una candidata que ya encaja por su nombre según cuánta gente trabaja en su grupo en
 * Cataluña (frecuencia.ts): desempata «maestro de educación primaria» frente a «maestro cervecero». Elegido por
 * validación cruzada.
 */
const BONO_FRECUENCIA = 25;
/**
 * Puntos con que entra una ocupación típica de una empresa nombrada en el texto (marcas.ts) que la búsqueda no ha
 * encontrado por sí misma: justo por encima del mínimo, para que la persona la vea sin que pase por delante de lo que
 * dice su texto. «Uber» a secas propone así los chóferes, como previa suave.
 */
const PUNTOS_DE_LA_MARCA = PUNTOS_MINIMOS + 5;
/**
 * Puntos que suma una candidata del resto del texto que es una ocupación del área nombrada en otra frase
 * («recursos humanos. Hago las nóminas» → administrativo de nóminas).
 */
const BONO_AREA = 15;

/**
 * Ocupación propuesta a la persona, con sus puntos (redondeados a un decimal). Los puntos llegan a PUNTOS_FRASE_EXACTA
 * más MAX_PUNTOS_DESCRIPCION (puntuacion.ts): el nombre exacto también suma la descripción.
 */
export interface Candidata {
  esco: string;
  titulo: string;
  isco08: string;
  tituloIsco: string;
  descripcion: string;
  puntos: number;
}

/** Los puntos con un decimal, como se publican en las candidatas. */
function redondearPuntos(puntos: number): number {
  return Math.round(puntos * FACTOR_DE_UN_DECIMAL) / FACTOR_DE_UN_DECIMAL;
}

/** La ocupación como se propone a la persona: con su título oficial, su grupo y sus puntos. */
function candidata(datos: Datos, esco: string, puntos: number): Candidata {
  // esco procede de una ocupación de los índices del mismo paquete.
  const ocupacion = datos.esco.ocupaciones[esco] as Datos['esco']['ocupaciones'][string];
  return {
    esco,
    titulo: ocupacion.titulo,
    isco08: ocupacion.isco08,
    tituloIsco: datos.clasificaciones.isco08_es[ocupacion.isco08] ?? ocupacion.isco08,
    descripcion: ocupacion.descripcion ?? '',
    puntos: redondearPuntos(puntos),
  };
}

/** Más puntos primero; a igualdad, el título más corto. */
function ordenar(a: Candidata, b: Candidata): number {
  return b.puntos - a.puntos || a.titulo.length - b.titulo.length;
}

/** Los puntos de cada ocupación de un índice con el texto (las que no llegan a nada no están) y sus correcciones. */
function puntuarEn(catalogo: Indice, texto: string, partido: TextoPartido): PuntosDeUnIndice {
  const formas = consultasDe(catalogo, texto, partido);
  const posiciones = new Set(formas.flatMap((forma) => posicionesCandidatas(catalogo, forma)));
  const puntos = new Map<string, number>();
  for (const posicion of [...posiciones].sort((a, b) => a - b)) {
    // posicionesCandidatas devuelve posiciones anotadas al construir este índice.
    const ocupacion = catalogo.ocupaciones[posicion] as OcupacionIndexada;
    const suyos = puntuarFormas(ocupacion, formas);
    if (suyos > 0) {
      puntos.set(ocupacion.esco, suyos);
    }
  }
  const comprension = Math.max(0, ...formas.map(parteConocida));
  return { puntos, correcciones: formas.flatMap((forma) => forma.correcciones), comprension };
}

/**
 * La parte de las palabras del oficio que el índice conoce (con algún peso): en el índice castellano, «Faig neteja
 * d'oficines» solo conoce «oficines», y le bastaría para proponer «empleado de oficina» con la puntuación entera.
 */
function parteConocida(consulta: Consulta): number {
  const { oficio } = consulta;
  return oficio.length ? oficio.filter((palabra) => consulta.peso(palabra) > 0).length / oficio.length : 1;
}

/** Los puntos de un índice, las palabras que se han corregido en él y la parte del oficio que conoce. */
interface PuntosDeUnIndice {
  puntos: Map<string, number>;
  correcciones: Correccion[];
  comprension: number;
}

/**
 * Al juntar los dos idiomas, lo que conserva un índice que no conoce ninguna palabra del oficio; con todas, todo. En
 * medio, en proporción.
 */
const MINIMO_SIN_COMPRENSION = 0.5;

/**
 * Abreviaturas que se escriben por el área: «RR. HH.», «RRHH» o «rr.hh.» son «recursos humanos» (Real Academia
 * Española, Diccionario panhispánico de dudas, apéndice 2, lista de abreviaturas: «RR. HH.»). Se sustituyen antes
 * de buscar.
 */
const ABREVIATURAS: readonly (readonly [RegExp, string])[] = [[/\bRR\.?\s*HH\b\.?/giu, 'recursos humanos']];

/** El texto con las abreviaturas escritas enteras. */
function sinAbreviaturas(texto: string): string {
  return ABREVIATURAS.reduce((resto, [abreviatura, entera]) => resto.replace(abreviatura, entera), texto);
}

/**
 * Una sigla escrita con puntos: letras sueltas separadas por un punto («A.T.S.», «D.U.E.», «v.s»), fuera de una
 * palabra. No toca «p. ej.», «EE. UU.», «col.legi» ni «www.x.com»: ahí no son letras sueltas.
 */
const SIGLA_CON_PUNTOS = /(?<![\p{L}\p{N}.])\p{L}(?:\.\p{L})+\.?(?![\p{L}\p{N}])/gu;

/**
 * El texto con las siglas sin puntos: «A.T.S.» → «ATS», como en siglas.json. Con los puntos, el buscador
 * leería letras sueltas y no reconocería la sigla: «A.T.S.» propondría conductor de camión y «V.S.», policía.
 */
function siglasSinPuntos(texto: string): string {
  return texto.replace(SIGLA_CON_PUNTOS, (sigla) => sigla.replaceAll('.', ''));
}

/**
 * El texto como lo dice ESCO: las siglas sin puntos («A.T.S.» → «ATS»), las abreviaturas escritas enteras («RRHH») y
 * las expresiones de la gente con la forma del catálogo («gente mayor» → «personas mayores»: frases-de-diccionario.ts).
 * Es lo que lee el buscador; la pantalla da lo mismo a los vectores y al clasificador
 * (recorrido/pantalla/previa-fusion.ts).
 *
 * @param texto - Lo que escribe la persona.
 * @returns El texto con las siglas, las abreviaturas y las expresiones cambiadas; igual si no tiene ninguna.
 */
export function textoComoEnEsco(texto: string): string {
  return conFrasesDeDiccionario(sinAbreviaturas(siglasEnMayusculas(siglasSinPuntos(texto))));
}

/** Una sigla que solo lo es en mayúsculas («PAS», «AL», «ME»), escrita en mayúsculas y como palabra suelta. */
const SIGLA_EN_MAYUSCULAS = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:${SIGLAS_SOLO_EN_MAYUSCULAS.join('|')})(?![\\p{L}\\p{N}])`,
  'gu',
);

/**
 * Las siglas que solo lo son en mayúsculas, con su marca de búsqueda: «sóc PAS de la UB» → «sóc siglapas de la UB»
 * (denominaciones-de-diccionario.ts). En un texto todo en mayúsculas no se distinguen de la palabra («NO ÉS PAS
 * FÀCIL»), salvo si la sigla va sola.
 */
function siglasEnMayusculas(texto: string): string {
  const sola = SIGLAS_SOLO_EN_MAYUSCULAS.includes(texto.trim());
  if (SIGLAS_SOLO_EN_MAYUSCULAS.length === 0 || (!sola && texto === texto.toUpperCase())) {
    return texto;
  }
  return texto.replace(SIGLA_EN_MAYUSCULAS, (sigla) => marcaDeSigla(sigla));
}

/** Opciones de una búsqueda. */
export interface OpcionesDeBusqueda {
  /** Idioma de la página: con «ca» se busca siempre también en el índice catalán. Por defecto, «es». */
  idioma?: Idioma;
}

/** Una búsqueda con todo lo que el motor sabe de ella, antes de pasar a CandidataDeBusqueda (analisis.ts). */
export interface BusquedaCompleta {
  candidatas: Candidata[];
  partido: TextoPartido;
  pistasDeSector: PistaDeSector[];
  necesitaPrecision?: string;
  correcciones: Correccion[];
  idiomasBuscados: Idioma[];
  /** Si la búsqueda nombra un área y no un puesto («recursos humanos»): el área y sus ocupaciones (area.ts). */
  area?: Area;
  /** Si no hay ninguna candidata: la interfaz pide a la persona que cuente qué hace. */
  sinComprension?: true;
}

/**
 * Junta los puntos de varios índices: los de cada ocupación, los del índice con que mejor encaja. Con más de un
 * índice, los de cada uno se rebajan según la parte del oficio que no conoce (MINIMO_SIN_COMPRENSION); con uno solo,
 * se quedan como están.
 */
function fusionar(resultados: readonly PuntosDeUnIndice[]): Map<string, number> {
  const fusion = new Map<string, number>();
  for (const { puntos, comprension } of resultados) {
    const factor = resultados.length > 1 ? MINIMO_SIN_COMPRENSION + (1 - MINIMO_SIN_COMPRENSION) * comprension : 1;
    for (const [esco, suyos] of puntos) {
      fusion.set(esco, Math.max(fusion.get(esco) ?? 0, suyos * factor));
    }
  }
  return fusion;
}

/**
 * Las candidatas ya ordenadas, sin las que repiten el título oficial de otra anterior: ESCO tiene ocupaciones distintas
 * con el mismo título («mozo de almacén/moza de almacén» en 9333.4 y 9333.8), y a la persona le saldría dos veces la
 * misma opción. Se queda la de más puntos; a igualdad, la que ya va delante.
 */
function sinTitulosRepetidos(candidatas: readonly Candidata[]): Candidata[] {
  const vistos = new Set<string>();
  return candidatas.filter((candidata) => {
    if (vistos.has(candidata.titulo)) {
      return false;
    }
    vistos.add(candidata.titulo);
    return true;
  });
}

/** El texto partido sin las formas de las empresas que nombra. */
function sinLasMarcas(partido: TextoPartido, marcas: readonly MarcaEncontrada[]): TextoPartido {
  const quitar = (parte: string) =>
    marcas
      .reduce((resto, { forma }) => ` ${resto} `.replaceAll(` ${forma} `, ' '), parte)
      .replace(/\s+/gu, ' ')
      .trim();
  return marcas.length ? { oficio: quitar(partido.oficio), lugar: quitar(partido.lugar) } : partido;
}

/** Las correcciones de varios índices, cada una una vez. */
function sinRepetir(correcciones: readonly Correccion[]): Correccion[] {
  const vistas = new Map(correcciones.map((correccion) => [`${correccion.de}→${correccion.a}`, correccion]));
  return [...vistas.values()];
}

/**
 * La búsqueda completa: separa el oficio del lugar de trabajo y saca las pistas de sector (contexto.ts), busca en el
 * índice castellano y, si la página está en catalán o el texto lo parece (escritoEnCatalan), también en el catalán, y
 * se queda con los mejores puntos de cada ocupación. Las del sector que nombra el texto suman BONO_SECTOR. Si el texto
 * es en castellano, no lo parece en catalán y el castellano no da nada, el catalán tampoco se consulta.
 *
 * @param datos - El paquete de datos.
 * @param textoEscrito - Lo que escribe la persona, ya limpio de datos personales.
 * @param limite - Cuántas candidatas como máximo.
 * @param opciones - El idioma de la página.
 * @returns Las candidatas, de más a menos puntos, y lo que se sabe de la búsqueda.
 */
export function buscarConTodo(
  datos: Datos,
  textoEscrito: string,
  limite: number = LIMITE_BUSQUEDA,
  opciones: OpcionesDeBusqueda = {},
): BusquedaCompleta {
  const texto = textoComoEnEsco(textoEscrito);
  const entera = buscarSinArea(datos, texto, opciones);
  const area = areaDeLaBusqueda(
    datos,
    indiceDe(datos),
    sinPresentacion(entera.partido.oficio),
    entera.hayNombreIdentico,
  );
  if (area) {
    return terminar(entera, limite, area);
  }
  const conArea = areaYResto(datos, texto, opciones);
  return conArea ? terminar(conArea.resto, limite, conArea.area) : terminar(entera, limite);
}

/** Una búsqueda antes de recortarla: todas sus candidatas y si algún nombre es la búsqueda entera. */
interface BusquedaSinRecortar extends Omit<BusquedaCompleta, 'area' | 'sinComprension'> {
  hayNombreIdentico: boolean;
}

/** Ordena y recorta las candidatas, quita los títulos repetidos y añade el área y sinComprension. */
function terminar(busqueda: BusquedaSinRecortar, limite: number, area?: Area): BusquedaCompleta {
  const { hayNombreIdentico: _identico, candidatas, ...resto } = busqueda;
  const finales = sinTitulosRepetidos([...candidatas].sort(ordenar)).slice(0, limite);
  return {
    ...(area ? { area } : {}),
    ...(finales.length ? {} : { sinComprension: true as const }),
    ...resto,
    candidatas: finales,
  };
}

/** Lo que separa las frases de un texto con varias partes («recursos humanos. Hago las nóminas»). */
const ENTRE_FRASES = /[.;:\n]+/u;

/**
 * Si una frase del texto nombra un área («recursos humanos») y el resto dice algo más («hago las nóminas y los
 * contratos»): el área y la búsqueda del resto, con BONO_AREA para las ocupaciones del área. Así lo que la persona
 * añade con sus palabras decide dentro del área.
 */
function areaYResto(
  datos: Datos,
  texto: string,
  opciones: OpcionesDeBusqueda,
): { area: Area; resto: BusquedaSinRecortar } | undefined {
  const frases = texto.split(ENTRE_FRASES).filter((frase) => palabrasDe(frase).length);
  if (frases.length < 2) {
    return undefined;
  }
  for (const [i, frase] of frases.entries()) {
    const sola = buscarSinArea(datos, frase, opciones);
    const area = areaDeLaBusqueda(datos, indiceDe(datos), sinPresentacion(sola.partido.oficio), sola.hayNombreIdentico);
    if (!area) {
      continue;
    }
    const resto = buscarSinArea(datos, frases.filter((_, j) => j !== i).join('. '), opciones);
    if (!resto.candidatas.length) {
      return undefined;
    }
    const delArea = new Set(area.ocupaciones.map(({ esco }) => esco));
    const candidatas = resto.candidatas.map((encontrada) =>
      delArea.has(encontrada.esco)
        ? { ...encontrada, puntos: redondearPuntos(encontrada.puntos + BONO_AREA) }
        : encontrada,
    );
    return { area, resto: { ...resto, candidatas, pistasDeSector: [...sola.pistasDeSector, ...resto.pistasDeSector] } };
  }
  return undefined;
}

/** La búsqueda sin mirar si es un área: todas las candidatas, sin recortar. */
function buscarSinArea(datos: Datos, texto: string, { idioma = 'es' }: OpcionesDeBusqueda): BusquedaSinRecortar {
  const marcas = marcasDelTexto(texto);
  // Los nombres de las empresas no son palabras del oficio: «Mercadona» no busca mercados.
  const partido = sinLasMarcas(partirOficioYLugar(texto), marcas);
  const pistas = [
    ...pistasDeSector(partido),
    ...marcas.map((marca) => pistaDeLaMarca(marca, (esco) => datos.esco.ocupaciones[esco]?.isco08)),
  ];
  const necesitaPrecision = precisionQueFalta(partido.oficio);
  const enCastellano = puntuarEn(indiceDe(datos), texto, partido);
  const resultados = [enCastellano];
  const idiomasBuscados: Idioma[] = ['es'];
  const reserva = reservaCatalana(datos);
  if (reserva && (idioma === 'ca' || escritoEnCatalan(reserva, texto))) {
    resultados.push(puntuarEn(reserva.indice, texto, partido));
    idiomasBuscados.push('ca');
  }
  const candidatas: Candidata[] = [];
  const frecuencia = frecuenciaDeLosGrupos(datos);
  const fusion = fusionar(resultados);
  for (const [esco, puntos] of fusion) {
    if (puntos < PUNTOS_MINIMOS) {
      continue;
    }
    // esco procede de una ocupación de los índices del mismo paquete.
    const { isco08 } = datos.esco.ocupaciones[esco] as Datos['esco']['ocupaciones'][string];
    const bonos = (delSector(isco08, pistas) ? BONO_SECTOR : 0) + BONO_FRECUENCIA * (frecuencia.get(isco08) ?? 0);
    candidatas.push(candidata(datos, esco, puntos + bonos));
  }
  const encontradas = new Set(candidatas.map(({ esco }) => esco));
  for (const esco of marcas.flatMap((marca) => marca.actividad.ocupaciones)) {
    if (!encontradas.has(esco) && datos.esco.ocupaciones[esco]) {
      candidatas.push(candidata(datos, esco, PUNTOS_DE_LA_MARCA));
      encontradas.add(esco);
    }
  }
  return {
    candidatas,
    hayNombreIdentico: [...fusion.values()].some((puntos) => puntos >= PUNTOS_FRASE_EXACTA),
    partido,
    pistasDeSector: pistas,
    ...(necesitaPrecision ? { necesitaPrecision } : {}),
    correcciones: sinRepetir(resultados.flatMap((resultado) => resultado.correcciones)),
    idiomasBuscados,
  };
}

/** Suma los puntos de cada ocupación en las búsquedas de todos los términos. */
function sumarBusquedas(datos: Datos, terminos: string[]): Map<string, Candidata> {
  const suma = new Map<string, Candidata>();
  for (const termino of terminos) {
    for (const encontrada of buscarOcupaciones(datos, termino, LIMITE_BUSQUEDA)) {
      const previa = suma.get(encontrada.esco);
      const puntos = previa ? redondearPuntos(previa.puntos + encontrada.puntos) : encontrada.puntos;
      suma.set(encontrada.esco, previa ? { ...previa, puntos } : encontrada);
    }
  }
  return suma;
}

/** Las ocupaciones del grupo que mejor encajan con las búsquedas (a igualdad, la de título más corto). */
function mejoresDelGrupo(
  datos: Datos,
  grupo: string,
  busquedas: Consulta[][],
): { ocupacion: OcupacionIndexada; puntos: number }[] {
  const { ocupaciones, porGrupo } = indiceDe(datos);
  const largoDelTitulo = (esco: string) =>
    (datos.esco.ocupaciones[esco] as Datos['esco']['ocupaciones'][string]).titulo.length;
  return (porGrupo.get(grupo) ?? [])
    .map((posicion) => ocupaciones[posicion] as OcupacionIndexada)
    .map((ocupacion) => ({
      ocupacion,
      puntos: busquedas.reduce((suma, formas) => suma + puntuarFormas(ocupacion, formas), 0),
    }))
    .sort((a, b) => b.puntos - a.puntos || largoDelTitulo(a.ocupacion.esco) - largoDelTitulo(b.ocupacion.esco))
    .slice(0, BONIFICADAS_POR_GRUPO);
}

/** Da a las mejores ocupaciones de cada grupo sugerido su bonificación, sobre la suma ya hecha. */
function bonificarGrupos(datos: Datos, suma: Map<string, Candidata>, terminos: string[], grupos: string[]): void {
  const catalogo = indiceDe(datos);
  const busquedas = terminos.map((termino) => consultasDe(catalogo, termino)).filter((formas) => formas.length);
  const validos = [...new Set(grupos)].filter((grupo) => catalogo.porGrupo.has(grupo)).slice(0, BONO_GRUPO.length);
  // validos se recorta al número de bonos; porGrupo guarda posiciones del mismo índice.
  for (const [orden, grupo] of validos.entries()) {
    for (const { ocupacion, puntos } of mejoresDelGrupo(datos, grupo, busquedas)) {
      const previa = suma.get(ocupacion.esco);
      suma.set(
        ocupacion.esco,
        candidata(datos, ocupacion.esco, (previa?.puntos ?? puntos) + (BONO_GRUPO[orden] as number)),
      );
    }
  }
}

/**
 * Las palabras de oficio de un relato largo: las que, solas, son el nombre entero de una ocupación («camarero»,
 * «administrativa», «enfermera»), según las formas reconocidas por el buscador. En un relato largo puede no
 * encontrar nada,
 * aunque el oficio esté dicho: cada nombre del catálogo cubre una parte muy pequeña de todo lo que se cuenta y no
 * llega a PUNTOS_MINIMOS. Solo cuentan las palabras que dan la puntuación de un nombre exacto, para no proponer
 * ocupaciones por palabras sueltas como «clientes» o «facturas».
 */
function palabrasDeOficio(datos: Datos, texto: string): string[] {
  return [...new Set(palabrasDe(texto))].filter(
    (palabra) => (buscarOcupaciones(datos, palabra, 1)[0]?.puntos ?? 0) >= PUNTOS_FRASE_EXACTA,
  );
}

/**
 * Las ocupaciones (por su código ESCO) que llevan en algún nombre, castellano o catalán, alguna de las palabras de
 * oficio tal cual, en su forma común.
 */
function conAlgunOficio(datos: Datos, oficios: string[]): Set<string> {
  const formas = new Set(oficios.map(formaComun));
  const indices = [indiceDe(datos), reservaCatalana(datos)?.indice].filter((indice) => indice !== undefined);
  return new Set(
    indices.flatMap((indice) =>
      indice.ocupaciones
        .filter((ocupacion) => ocupacion.nombres.some((nombre) => nombre.some((palabra) => formas.has(palabra))))
        .map((ocupacion) => ocupacion.esco),
    ),
  );
}

/**
 * Los índices del catálogo, el castellano y el catalán de reserva. Se construyen una vez por paquete de datos (en un
 * Worker, al arrancar) y quedan en memoria: ninguna búsqueda los construye. Con el índice invertido solo se puntúan
 * las ocupaciones que comparten alguna palabra con la búsqueda: el resultado es el mismo que puntuándolas todas, en una
 * fracción del tiempo.
 *
 * @param datos - El paquete de datos.
 */
export function prepararBuscador(datos: Datos): void {
  indiceDe(datos);
  reservaCatalana(datos);
}

/**
 * Busca ocupaciones por nombre (buscarConTodo): entra en la lista la que llega a PUNTOS_MINIMOS puntos. Los dos
 * idiomas no se mezclan en un mismo índice, que cambiaría la rareza de cada palabra: se busca en cada uno y se junta.
 *
 * @param datos - El paquete de datos.
 * @param texto - Lo que escribe la persona.
 * @param limite - Cuántas candidatas como máximo.
 * @param opciones - El idioma de la página.
 * @returns Las candidatas, de más a menos puntos.
 */
export function buscarOcupaciones(
  datos: Datos,
  texto: string,
  limite: number = LIMITE_BUSQUEDA,
  opciones: OpcionesDeBusqueda = {},
): Candidata[] {
  return buscarConTodo(datos, texto, limite, opciones).candidatas;
}

/**
 * Varias búsquedas a la vez (los términos que propone «entender»): una ocupación que encaja con varios términos sube.
 * Si el modelo sugiere grupos ISCO-08, las dos ocupaciones de cada grupo que mejor encajan con los términos reciben
 * una bonificación. Solo reordena y completa la lista: la persona elige.
 *
 * @param datos - El paquete de datos.
 * @param terminos - Los términos que propone «entender», con su peso.
 * @param limite - Cuántas candidatas como máximo.
 * @param grupos - Los grupos ISCO-08 que sugiere el modelo.
 * @returns Las candidatas, de más a menos puntos.
 */
function buscarVarias(
  datos: Datos,
  terminos: string[],
  limite: number = LIMITE_VARIAS,
  grupos: string[] = [],
): Candidata[] {
  const suma = sumarBusquedas(datos, terminos);
  bonificarGrupos(datos, suma, terminos, grupos);
  return [...suma.values()].sort(ordenar).slice(0, limite);
}

/**
 * Busca las ocupaciones de un relato: las de buscarOcupaciones con el texto entero y, si no llega ninguna, las de sus
 * palabras de oficio sumadas (buscarVarias), así que «curro de camarero en un bar, sirvo mesas…» propone camarero. De
 * estas, solo las que llevan alguna de esas palabras en un nombre: la que solo comparte su principio es de otro oficio
 * («camarero» y «operador de cámara», «soldador» y «soldado de infantería»). Sin palabras de oficio, ninguna: la
 * persona busca en la clasificación oficial.
 *
 * @param datos - El paquete de datos.
 * @param texto - El relato de la persona.
 * @param limite - Cuántas candidatas como máximo.
 * @param opciones - El idioma de la página, para la búsqueda con el texto entero.
 * @returns Las candidatas, de más a menos puntos; ninguna sin palabras de oficio.
 */
export function buscarEnElRelato(
  datos: Datos,
  texto: string,
  limite: number = LIMITE_BUSQUEDA,
  opciones: OpcionesDeBusqueda = {},
): Candidata[] {
  const enElTexto = buscarOcupaciones(datos, texto, limite, opciones);
  if (enElTexto.length) {
    return enElTexto;
  }
  const oficios = palabrasDeOficio(datos, texto);
  if (!oficios.length) {
    return [];
  }
  const delOficio = conAlgunOficio(datos, oficios);
  return buscarVarias(datos, oficios, limite).filter((candidata) => delOficio.has(candidata.esco));
}
