// Formas completas de los archivos del paquete leídos directamente. Cada guarda comprueba los tipos del dominio,
// permite campos extra y conserva los datos recibidos; las políticas de rango y coherencia siguen en sus dueños.

import {
  esFormaDe,
  esListaDe,
  esNuloO,
  esNumero,
  esOpcional,
  esRegistroDe,
  esTexto,
  type Guarda,
} from '../comun/json.ts';
import type { VectoresGuardados } from '../comun/vectores.ts';
import type { Datos, DatosCatalan, DatosEsco, DatosOit, DatosTextos, EstadoTexto } from './tipos-paquete.ts';

/** Elementos de un par: un margen o un intervalo [desde, hasta]. */
const ELEMENTOS_DEL_PAR = 2;
/** Elementos de una competencia ESCO: [uri, titulo, tipo]. */
const ELEMENTOS_DE_LA_COMPETENCIA = 3;

/**
 * Par de dos números, sin imponer rangos; los márgenes y los intervalos deciden sus políticas al usarlo. Es la guarda
 * común del paquete y de la entrada del informe (esquema-entrada.ts).
 *
 * @param valor - Valor de cualquier origen.
 * @returns Si es una lista de exactamente dos números.
 */
export function esParDeNumeros(valor: unknown): valor is [number, number] {
  return Array.isArray(valor) && valor.length === ELEMENTOS_DEL_PAR && esNumero(valor[0]) && esNumero(valor[1]);
}

function esCompetencia(valor: unknown): valor is [string, string, string] {
  return (
    Array.isArray(valor) &&
    valor.length === ELEMENTOS_DE_LA_COMPETENCIA &&
    esTexto(valor[0]) &&
    esTexto(valor[1]) &&
    esTexto(valor[2])
  );
}

function esRelacion(valor: unknown): valor is [number, 'e' | 'o'] {
  return (
    Array.isArray(valor) &&
    valor.length === ELEMENTOS_DEL_PAR &&
    esNumero(valor[0]) &&
    (valor[1] === 'e' || valor[1] === 'o')
  );
}

const esOcupacionEsco = esFormaDe({
  uri: esTexto,
  titulo: esTexto,
  isco08: esTexto,
  alternativos: esOpcional(esListaDe(esTexto)),
  descripcion: esOpcional(esTexto),
  competencias: esListaDe(esRelacion),
});

const esOcupacionOit = esFormaDe({
  titulo_en: esTexto,
  media: esNuloO(esNumero),
  sd: esNuloO(esNumero),
  gradiente: esNuloO(esTexto),
});

const esTareaOit = esFormaDe({
  isco08: esTexto,
  indice: esNumero,
  texto_en: esTexto,
  nota: esNuloO(esNumero),
  margen: esNuloO(esParDeNumeros),
  metodo: esNuloO(esTexto),
});

function esEstadoTexto(valor: unknown): valor is EstadoTexto {
  return valor === 'redacción manual' || valor === 'redactado con IA' || valor === 'traducido con IA';
}

const esTextoDeTarea = esFormaDe({
  corto: esTexto,
  texto_es: esTexto,
  ia_podria: esOpcional(esTexto),
  lo_tuyo: esOpcional(esTexto),
  estado: esOpcional(esEstadoTexto),
});

const esTareaCatalan = esFormaDe({
  corto: esOpcional(esTexto),
  texto: esOpcional(esTexto),
  ia_podria: esOpcional(esTexto),
  lo_tuyo: esOpcional(esTexto),
});

/** ESCO serializado como JSON: las relaciones iterables del dominio llegan como listas de tuplas exactas. */
export const esDatosEsco: Guarda<DatosEsco> = esFormaDe({
  competencias: esListaDe(esCompetencia),
  ocupaciones: esRegistroDe(esOcupacionEsco),
});

/** Fuente, ocupaciones y cada tarea de la OIT, con los nulos que admite el contrato del paquete. */
export const esDatosOit: Guarda<DatosOit> = esFormaDe({
  fuente: esFormaDe({ cita: esTexto, aviso_adaptacion: esTexto }),
  ocupaciones: esRegistroDe(esOcupacionOit),
  tareas: esRegistroDe(esTareaOit),
});

/** Textos en castellano, origen opcional y todas las competencias por ocupación y tarea. */
export const esDatosTextos: Guarda<DatosTextos> = esFormaDe({
  tareas: esRegistroDe(esTextoDeTarea),
  competencias_por_ocupacion: esRegistroDe(esRegistroDe(esListaDe(esTexto))),
  aviso_traduccion: esTexto,
});

/** Traducciones catalanas parciales, títulos y su procedencia, sin inventar los textos que faltan. */
export const esDatosCatalan: Guarda<DatosCatalan> = esFormaDe({
  idioma: (valor: unknown): valor is 'ca' => valor === 'ca',
  marca: esTexto,
  estado: esTexto,
  aviso_traduccion: esTexto,
  tareas: esRegistroDe(esTareaCatalan),
  grupos: esRegistroDe(esTexto),
  ocupaciones: esRegistroDe(esTexto),
  grupos_cno11: esRegistroDe(esTexto),
  fuente_grupos: esFormaDe({ cita: esTexto, licencia: esTexto, consultado: esTexto }),
});

/**
 * Vectores guardados, con los tipos de cada campo comprobados; la coherencia entre ellos (dimensiones, una escala por
 * identificador y los bytes justos) la comprueba cargarIndice (comun/vectores.ts) al cargarlos.
 */
export const esVectoresGuardados: Guarda<VectoresGuardados> = esFormaDe({
  modelo: esTexto,
  dimensiones: esNumero,
  ids: esListaDe(esTexto),
  escalas: esListaDe(esNumero),
  datos: esTexto,
});

/** Los dos índices de significado del archivo de vectores de la formación. */
export const esVectoresFormacion: Guarda<NonNullable<Datos['vectoresFormacion']>> = esFormaDe({
  especialidades: esVectoresGuardados,
  ocupaciones: esVectoresGuardados,
});
