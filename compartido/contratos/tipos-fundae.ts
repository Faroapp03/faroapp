// Contrato de fundae.json en el paquete: las ediciones en teleformación de la oferta estatal para personas
// trabajadoras. Solo declara formas; las reglas están en el motor de cursos (motores/cursos/src/formacion-fundae.ts).

/** Los colectivos a los que se dirige una edición, como los nombra la cadena de datos. */
export type ColectivoFundae =
  | 'asalariados'
  | 'autonomos'
  | 'economia-social'
  | 'administracion-publica'
  | 'desempleados'
  | 'erte';

/** Una edición tal como la trae el paquete (fundae.json). */
export interface EdicionFundae {
  /** El identificador de su difusión en FUNDAE. */
  id: string;
  /** El código de su especialidad en el catálogo del SEPE. */
  especialidad: string;
  /** Su nombre tal como lo publica FUNDAE, en mayúsculas. */
  nombre: string;
  horas: number;
  /** Su nivel de digitalización («Básico», «Intermedio», «Avanzado»); null si no lo dice. */
  nivel_digital: string | null;
  /** La entidad formadora que la imparte. */
  entidad: string;
  /** El plazo de preinscripción (AAAA-MM-DD). */
  preinscripcion: { inicio: string; fin: string };
  colectivos: ColectivoFundae[];
  /** «INTERSECTORIAL» o el sector de su entidad: entonces es para quien trabaja en una empresa de ese sector. */
  sector: string;
  /** Su programa oficial en PDF, en fundae.es. */
  programa: string;
}

/** Lo que trae el paquete de FUNDAE. */
export interface DatosFundae {
  cita: string;
  /** Día (AAAA-MM-DD) en que se guardaron sus respuestas. */
  consulta: string;
  /** El buscador oficial de su formación subvencionada, donde se hace la preinscripción. */
  buscador: string;
  /** La página de FUNDAE para personas trabajadoras: gratuidad y condiciones. */
  condiciones: string;
  ediciones: EdicionFundae[];
}
