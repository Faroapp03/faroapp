// Formas de comarcas.json y temarios.json conservadas por el contrato del paquete de datos.
// Declaran municipios, equivalencias y contenidos oficiales, sin criterios de recomendación.

/** comarcas.json: cada municipio como [código Idescat de 6 cifras, nombre, código de comarca]. */
export interface DatosComarcas {
  formato: number;
  fuente: string;
  url: string;
  consultado: string;
  cita: string;
  licencia: string;
  comarcas: Record<string, string>;
  municipios: readonly (readonly [string, string, string])[];
  /** Nombres de las fuentes de cursos que no están tal cual en el Idescat; con fuenteDelCurso, solo para esa fuente. */
  equivalencias?: readonly EquivalenciaDeMunicipio[];
}

/** Un nombre de municipio de una fuente de cursos y su código del Idescat, con su motivo y su fuente. */
export interface EquivalenciaDeMunicipio {
  nombre: string;
  codigo: string;
  fuenteDelCurso?: string;
  motivo: string;
  fuente: string;
  idescat: string;
}

/** El temario oficial de una especialidad, literal y en su idioma. */
export interface TemarioOficial {
  objetivo: string | null;
  modulos: string[];
  /** Si el extracto llega al final de la lista de módulos. */
  modulosCompletos: boolean;
  idioma: 'es' | 'ca';
  fuente: { organismo: 'SEPE' | 'Consorci' | 'FUNDAE'; url: string };
  consultado: string;
}

/** temarios.json. */
export interface DatosTemarios {
  formato: number;
  consultado: string;
  fuentes: Record<string, { nombre: string; licencia: string }>;
  aviso: string;
  sinTemario: string[];
  temarios: Record<string, TemarioOficial>;
}
