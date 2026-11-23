/** Enriquecimiento puro de idioma y dificultad: no modifica hechos ni bloquea ofertas. */

import { jsonCanonico } from '../comun/jcs.ts';
import {
  type EvidenciaClasificacion,
  evaluarClasificacion,
  type IdiomaClasificado,
  idiomaClasificadoDelCurso,
  type NivelClasificado,
} from './clasificacion.ts';
import type { HechoCatalogo, OfertaCatalogo } from './contrato.ts';
import { idiomaCibernariumPorFicha, nivelCibernariumPorFicha } from './fichas-revisadas-cibernarium.ts';
import { hechoEditorial } from './firma-editorial.ts';
import { type OrientadorIdioma, orientarIdiomaCibernarium } from './idioma-cibernarium.ts';
import { type NivelContenidoObservado, nivelAutomatico } from './nivel-automatico.ts';
import { nivelFundae } from './nivel-fundae.ts';

export type { NivelContenidoObservado } from './nivel-automatico.ts';

export interface IdiomaEnriquecido {
  readonly valores: readonly string[];
  readonly origen: 'fuente' | 'faro' | 'por-confirmar';
  readonly alcance:
    | 'edicion'
    | 'norma-general'
    | 'orientacion'
    | 'material_observado'
    | 'programa'
    | 'historial-cibernarium'
    | null;
  readonly motivo: { readonly es: string; readonly ca: string };
  readonly evidencias: readonly EvidenciaClasificacion[];
}
export interface IdiomaNivelEnriquecido {
  /** Idioma de impartición declarado o revisión válida; no incluye idioma de la interfaz. */
  readonly idioma: IdiomaEnriquecido;
  /** Observación separada: no implica que toda la impartición se haga en este idioma. */
  readonly material: IdiomaEnriquecido;
  readonly nivel: NivelClasificado;
}
export interface IdiomaEdicionObservado {
  readonly unidad: OfertaCatalogo['unidad'];
  readonly proveedor_id: string;
  readonly titulo: string;
  readonly modalidad: HechoCatalogo;
  readonly sincronia: HechoCatalogo;
  readonly idioma_original: HechoCatalogo;
  readonly literal: string;
  readonly evidencia: EvidenciaClasificacion;
}
export interface IdiomaProgramaObservado {
  readonly unidad: OfertaCatalogo['unidad'];
  readonly titulo: string;
  readonly codigo: string;
  readonly idioma: string;
  readonly evidencia: EvidenciaClasificacion;
}
export interface OpcionesIdiomaNivel {
  readonly nivelRevisado?: NivelClasificado;
  readonly idiomaRevisado?: IdiomaClasificado | null;
  readonly idiomasEdicion?: readonly IdiomaEdicionObservado[];
  readonly idiomasPrograma?: readonly IdiomaProgramaObservado[];
  readonly nivelesContenido?: readonly NivelContenidoObservado[];
  readonly orientarIdioma?: OrientadorIdioma;
}
const SIN_IDIOMA: IdiomaEnriquecido = {
  valores: [],
  origen: 'por-confirmar',
  alcance: null,
  evidencias: [],
  motivo: { es: 'Idioma por confirmar.', ca: 'Idioma per confirmar.' },
};
const SIN_MATERIAL: IdiomaEnriquecido = {
  valores: [],
  origen: 'por-confirmar',
  alcance: null,
  evidencias: [],
  motivo: { es: 'Idioma del material por confirmar.', ca: 'Idioma del material per confirmar.' },
};
const nombres: Readonly<Record<string, string>> = {
  ca: 'ca',
  catalan: 'ca',
  catala: 'ca',
  es: 'es',
  espanol: 'es',
  castellano: 'es',
  castella: 'es',
  en: 'en',
  ingles: 'en',
  angles: 'en',
  english: 'en',
  fr: 'fr',
  frances: 'fr',
  francais: 'fr',
  de: 'de',
  aleman: 'de',
  alemany: 'de',
  deutsch: 'de',
  it: 'it',
  italiano: 'it',
  italia: 'it',
  pt: 'pt',
  portugues: 'pt',
};
function clave(valor: string): string {
  return valor
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase();
}
function idiomasHecho(hecho: HechoCatalogo): string[] {
  if (hecho.motivo !== 'conocido' || !Array.isArray(hecho.valor)) {
    return [];
  }
  const resultado = new Map<string, string>();
  for (const valor of hecho.valor) {
    if (typeof valor !== 'string' || !valor.trim()) {
      continue;
    }
    const nombre = clave(valor);
    const normal = Object.hasOwn(nombres, nombre) ? (nombres[nombre] ?? valor.trim()) : valor.trim();
    resultado.set(clave(normal), normal);
  }
  return [...resultado.values()];
}
/** NU11 solo es aplicable a ediciones asíncronas y si la oferta conserva la captura verificada. */
function normaCibernarium(oferta: OfertaCatalogo): IdiomaEnriquecido | null {
  const idioma = oferta.hechos.idiomas_declarados;
  if (
    oferta.proveedor_id !== 'cibernarium' ||
    oferta.unidad.tipo !== 'edicion' ||
    oferta.evidencia_materia?.edicion_id !== oferta.unidad.id ||
    oferta.evidencia_materia?.programa_id !== oferta.unidad.programa_id ||
    !['no_consta_en_evidencia', 'sin_soporte_de_campo'].includes(idioma.motivo) ||
    oferta.hechos.modalidad.motivo !== 'conocido' ||
    oferta.hechos.modalidad.valor !== 'en-linea' ||
    oferta.hechos.sincronia.motivo !== 'conocido' ||
    oferta.hechos.sincronia.valor !== 'asincrona'
  ) {
    return null;
  }
  const referencia = oferta.referencias.find(
    (r) =>
      r.url === 'https://cibernarium.barcelonactiva.cat/ca/normesfaqs' &&
      [
        '61ead2a96f638242bc7df86162a5363506a663ae754381bc22d021023f1c73e3',
        '561cb54c2b11e41b9c22eebd938bdfe764f54fde731397821975bbd3e42cb073',
      ].includes(r.sha256),
  );
  if (!referencia) {
    return null;
  }
  return {
    valores: ['ca', 'es'],
    origen: 'fuente',
    alcance: 'norma-general',
    evidencias: [
      {
        url: referencia.url,
        sha256: referencia.sha256,
        capturadoEl: referencia.fecha_referencia,
        localizador: 'NU11/Activitats online asíncrones',
      },
    ],
    motivo: {
      es: 'Norma general: vídeo en catalán, subtítulos en castellano y documentación en ambos idiomas; no se ha observado el material de esta edición.',
      ca: 'Norma general: vídeo en català, subtítols en castellà i documentació en totes dues llengües; no s’ha observat el material d’aquesta edició.',
    },
  };
}

function idiomaEnFicha(oferta: OfertaCatalogo, registros: readonly IdiomaEdicionObservado[]): IdiomaEnriquecido | null {
  if (!['no_consta_en_evidencia', 'sin_soporte_de_campo'].includes(oferta.hechos.idiomas_declarados.motivo)) {
    return null;
  }
  const coincide = registros.filter(
    (r) =>
      r.unidad.id === oferta.unidad.id &&
      r.unidad.tipo === oferta.unidad.tipo &&
      r.unidad.programa_id === oferta.unidad.programa_id &&
      r.proveedor_id === oferta.proveedor_id &&
      r.titulo === oferta.titulo_programa &&
      jsonCanonico(hechoEditorial(r.modalidad)) === jsonCanonico(hechoEditorial(oferta.hechos.modalidad)) &&
      jsonCanonico(hechoEditorial(r.sincronia)) === jsonCanonico(hechoEditorial(oferta.hechos.sincronia)) &&
      jsonCanonico(hechoEditorial(r.idioma_original)) ===
        jsonCanonico(hechoEditorial(oferta.hechos.idiomas_declarados)) &&
      oferta.referencias.some((ref) => ref.url === r.evidencia.url && ref.sha256 === r.evidencia.sha256),
  );
  if (coincide.length !== 1) {
    return null;
  }
  const dato = coincide[0];
  if (!dato) {
    return null;
  }
  const palabras = dato.literal
    .split(/\s*(?:,|\/|\bi\b|\by\b)\s*/iu)
    .map(clave)
    .filter(Boolean);
  if (!palabras.length || palabras.some((x) => !nombres[x])) {
    return null;
  }
  const valores = [...new Set(palabras.map((x) => nombres[x]).filter((x): x is string => Boolean(x)))];
  return {
    valores,
    origen: 'fuente',
    alcance: 'edicion',
    evidencias: [dato.evidencia],
    motivo: {
      es: 'Idioma publicado para esta edición en la ficha del proveedor.',
      ca: 'Idioma publicat per a aquesta edició a la fitxa del proveïdor.',
    },
  };
}

function idiomaProgramaDirecto(oferta: OfertaCatalogo): IdiomaEnriquecido | null {
  const directo = oferta.idioma_programa;
  const codigo = oferta.unidad.programa_id.replace(/^fundae:oferta:programa:/u, '');
  if (
    directo &&
    oferta.unidad.tipo === 'edicion' &&
    oferta.unidad.id.startsWith('fundae:edicion:') &&
    oferta.unidad.programa_id === `fundae:oferta:programa:${codigo}` &&
    directo.valores.length === 1 &&
    directo.valores[0] === 'es' &&
    oferta.referencias.some((r) => r.url === directo.url && r.sha256 === directo.sha256)
  ) {
    const u = new URL(directo.url);
    if (
      u.origin === 'https://agora.fundae.es' &&
      u.pathname === '/Oferta/RecuperarDifusionesRFO' &&
      u.searchParams.get('codigoTitulacion') === codigo
    ) {
      return {
        valores: ['es'],
        origen: 'fuente',
        alcance: 'programa',
        evidencias: [
          { url: directo.url, sha256: directo.sha256, capturadoEl: null, localizador: '/curso/descripcionIdioma' },
        ],
        motivo: {
          es: 'Castellano declarado para el programa; idioma de esta edición por confirmar.',
          ca: 'Castellà declarat per al programa; idioma d’aquesta edició per confirmar.',
        },
      };
    }
  }
  return null;
}

function idiomaPrograma(
  oferta: OfertaCatalogo,
  registros: readonly IdiomaProgramaObservado[],
): IdiomaEnriquecido | null {
  if (
    oferta.proveedor_id !== 'fundae:publicador:catalogo:3' ||
    !['no_consta_en_evidencia', 'sin_soporte_de_campo'].includes(oferta.hechos.idiomas_declarados.motivo)
  ) {
    return null;
  }
  const directo = idiomaProgramaDirecto(oferta);
  if (directo) {
    return directo;
  }
  const candidatas = registros.filter(
    (r) =>
      r.unidad.id === oferta.unidad.id &&
      r.unidad.programa_id === oferta.unidad.programa_id &&
      r.unidad.tipo === oferta.unidad.tipo &&
      r.titulo === oferta.titulo_programa &&
      r.unidad.programa_id === `fundae:oferta:programa:${r.codigo}` &&
      r.idioma === 'es' &&
      oferta.referencias.some((x) => x.url === r.evidencia.url && x.sha256 === r.evidencia.sha256),
  );
  if (candidatas.length !== 1) {
    return null;
  }
  const registro = candidatas[0];
  if (!registro) {
    return null;
  }
  return {
    valores: ['es'],
    origen: 'fuente',
    alcance: 'programa',
    evidencias: [registro.evidencia],
    motivo: {
      es: 'Castellano declarado para el programa; idioma de esta edición por confirmar.',
      ca: 'Castellà declarat per al programa; idioma d’aquesta edició per confirmar.',
    },
  };
}

/** El idioma de impartición de una oferta y su procedencia, sin calcular el nivel. */
export function idiomaDeImparticion(oferta: OfertaCatalogo, opciones: OpcionesIdiomaNivel = {}): IdiomaEnriquecido {
  // Un idioma visto solo en el material no dice en qué idioma se imparte el curso.
  const declarado = oferta.hechos.idiomas_declarados;
  const valores = declarado.alcance === 'material_observado' ? [] : idiomasHecho(declarado);
  if (valores.length) {
    return {
      valores,
      origen: 'fuente',
      evidencias: [],
      alcance: oferta.hechos.idiomas_declarados.alcance === 'declaracion_general' ? 'norma-general' : 'edicion',
      motivo: { es: 'Idioma declarado por la fuente.', ca: 'Idioma declarat per la font.' },
    };
  }
  const revisado = 'idiomaRevisado' in opciones ? opciones.idiomaRevisado : idiomaClasificadoDelCurso(oferta);
  if (revisado) {
    return {
      valores: [...new Set(revisado.valores)],
      origen: revisado.origen,
      alcance: revisado.alcance,
      motivo: revisado.motivo,
      evidencias: revisado.evidencias,
    };
  }
  return (
    idiomaEnFicha(oferta, opciones.idiomasEdicion ?? []) ??
    normaCibernarium(oferta) ??
    idiomaPrograma(oferta, opciones.idiomasPrograma ?? []) ??
    idiomaCibernariumPorFicha(oferta) ??
    (opciones.orientarIdioma ?? orientarIdiomaCibernarium)(oferta) ??
    SIN_IDIOMA
  );
}
function materialActual(oferta: OfertaCatalogo): IdiomaEnriquecido {
  const valores = idiomasHecho(oferta.hechos.idiomas_material_observado);
  if (!valores.length) {
    return SIN_MATERIAL;
  }
  return {
    valores,
    origen: 'fuente',
    alcance: 'material_observado',
    evidencias: [],
    motivo: {
      es: 'Idioma observado en el material; la impartición puede variar.',
      ca: 'Idioma observat al material; la impartició pot variar.',
    },
  };
}
/** Solo reutiliza revisiones validadas por la unidad, modalidad y soporte de la oferta actual. */
export function enriquecerIdiomaNivel(
  oferta: OfertaCatalogo,
  opciones: OpcionesIdiomaNivel = {},
): IdiomaNivelEnriquecido {
  const nivel = nivelAutomatico(
    oferta,
    opciones.nivelRevisado ?? evaluarClasificacion(oferta).metadatos.nivel,
    opciones.nivelesContenido ?? [],
  );
  return {
    idioma: idiomaDeImparticion(oferta, opciones),
    material: materialActual(oferta),
    nivel: nivel.valor === null ? (nivelFundae(oferta) ?? nivelCibernariumPorFicha(oferta) ?? nivel) : nivel,
  };
}
