// Fe de erratas de las etiquetas de ESCO en castellano y en catalán: nombres oficiales que, por un error de
// traducción, nombran otra ocupación. Se aplica al leer el paquete, en Node, en el Worker y en el navegador, así que
// el buscador, la pantalla del recorrido y el informe ven lo mismo. El archivo exportado no cambia: la errata queda a
// la vista aquí, con su prueba, y la cadena de datos debe aplicarla también en la próxima exportación.

import type { DatosCatalan, DatosEsco } from './tipos-paquete.ts';

/** Una etiqueta oficial corregida: la ocupación (código y URI de ESCO), su título bueno y lo que se le quita. */
export interface ErrataEsco {
  /** Código de la ocupación en el paquete. */
  readonly esco: string;
  /** URI oficial de ESCO: la errata solo se aplica si coincide, por si los códigos cambian entre versiones. */
  readonly uri: string;
  /** Título corregido en castellano, con la forma masculina y la femenina separadas por «/». */
  readonly tituloEs: string;
  /** Título corregido en catalán, con el mismo formato. */
  readonly tituloCa: string;
  /** Nombres alternativos que se quitan, comparados sin mayúsculas: son los de la errata. */
  readonly quitarAlternativos: readonly string[];
  /** Por qué es una errata y cómo se comprobó. */
  readonly prueba: string;
}

export const ERRATAS_ESCO: readonly ErrataEsco[] = [
  {
    esco: '5329.2',
    uri: 'http://data.europa.eu/esco/occupation/5ee264b2-9bc5-40f6-9db3-c87143af6b2d',
    tituloEs: 'flebotomista/flebotomista',
    tituloCa: 'flebotomista/flebotomista',
    quitarAlternativos: ['enfermero', 'enfermera'],
    prueba:
      'En la API oficial de ESCO (consultada el 19/10/2026), su título en inglés es «phlebotomist», con «phlebotomy ' +
      'technician» y «venipuncturist» como alternativos, y su propia descripción en castellano dice que «toman muestras ' +
      'de sangre de pacientes». La etiqueta «enfermero/enfermera» (y en catalán «infermer/infermera») es un error de ' +
      'traducción: las enfermeras son el grupo CIUO-08 2221. Con la errata, «infermera» y «enfermera» llevaban al ' +
      'grupo 5329.',
  },
  {
    esco: '2310.1',
    uri: 'http://data.europa.eu/esco/occupation/684fd8d5-9b40-4b02-a680-438f0082d923',
    tituloEs: 'profesor de educación superior/profesora de educación superior',
    tituloCa: "professor d'educació superior/professora d'educació superior",
    quitarAlternativos: [],
    prueba:
      'En la API oficial de ESCO (consultada el 19/10/2026), el título en castellano es «profesor de educación ' +
      'superior/profesora de educación superiora» («higher education lecturer» en inglés), y sus propios alternativos ' +
      'dicen «profesora de educación superior»: «superiora» es una errata del femenino.',
  },
  {
    esco: '8113.6',
    uri: 'http://data.europa.eu/esco/occupation/86c49d9c-b37d-4a14-8e9d-d0357005a48d',
    tituloEs: 'peón de campo petrolífero/peona de campo petrolífero',
    tituloCa: 'peó de camp petrolífer/peona de camp petrolífer',
    quitarAlternativos: [],
    prueba:
      'Título inglés oficial de ESCO: «roustabout». El castellano ' +
      'decía solo «peón/peona», un título genérico que atraía a cualquier peón de obra, del campo o de fábrica.',
  },
];

const minusculas = (texto: string): string => texto.trim().toLocaleLowerCase('es');

/**
 * El catálogo ESCO con las etiquetas en castellano corregidas. No cambia el objeto recibido.
 *
 * @param esco - Los datos de ESCO tal como se leyeron.
 * @returns Los mismos datos, con cada errata aplicada si la URI coincide.
 */
export function escoConErratas(esco: DatosEsco): DatosEsco {
  let ocupaciones: DatosEsco['ocupaciones'] | null = null;
  for (const errata of ERRATAS_ESCO) {
    const ocupacion = esco.ocupaciones[errata.esco];
    if (!ocupacion || ocupacion.uri !== errata.uri) {
      continue;
    }
    const quitar = new Set(errata.quitarAlternativos.map(minusculas));
    const alternativos = (ocupacion.alternativos ?? []).filter((alternativo) => !quitar.has(minusculas(alternativo)));
    ocupaciones ??= { ...esco.ocupaciones };
    ocupaciones[errata.esco] = { ...ocupacion, titulo: errata.tituloEs, alternativos };
  }
  return ocupaciones ? { ...esco, ocupaciones } : esco;
}

/**
 * Los títulos catalanes con las erratas corregidas. No cambia el objeto recibido.
 *
 * @param catalan - Los datos en catalán tal como se leyeron.
 * @param esco - El catálogo ESCO del mismo paquete; si falta, no se aplican erratas.
 * @returns Los mismos datos, con títulos corregidos solo donde coincide la URI.
 */
export function catalanConErratas(catalan: DatosCatalan, esco?: DatosEsco): DatosCatalan {
  let ocupaciones: DatosCatalan['ocupaciones'] | null = null;
  for (const errata of ERRATAS_ESCO) {
    if (catalan.ocupaciones[errata.esco] === undefined || esco?.ocupaciones[errata.esco]?.uri !== errata.uri) {
      continue;
    }
    ocupaciones ??= { ...catalan.ocupaciones };
    ocupaciones[errata.esco] = errata.tituloCa;
  }
  return ocupaciones ? { ...catalan, ocupaciones } : catalan;
}
