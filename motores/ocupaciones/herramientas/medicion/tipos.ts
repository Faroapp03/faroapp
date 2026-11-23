// Los tipos con que el medidor ve el motor: solo la parte de su contrato que usa, para medir cualquier versión del
// producto (se carga con import() desde --producto) sin depender de sus tipos internos.

/** Un texto por idioma. */
export type PorIdioma = Readonly<Record<string, string>>;

/** Lo que el medidor lee de los datos del paquete: el grupo CIUO-08 de cada ocupación ESCO. */
export interface DatosDelPaquete {
  readonly esco: { readonly ocupaciones: Readonly<Record<string, { readonly isco08?: string } | undefined>> };
}

/** Un grupo de la tabla de atributos (atributos.json), con los campos que contesta la persona simulada. */
export interface GrupoDeAtributos {
  readonly tr?: readonly number[];
  readonly cm?: Readonly<Record<string, number>>;
  readonly un?: number;
  readonly cp?: number;
  readonly ta?: readonly string[];
}

/** Una tarea de la tabla de atributos: sus textos cortos y los grupos vecinos con su parecido. */
export interface TareaDeAtributos {
  readonly es?: string;
  readonly ca?: string;
  readonly ve?: readonly (readonly [string, number])[];
}

export interface Atributos {
  readonly grupos: Readonly<Record<string, GrupoDeAtributos | undefined>>;
  readonly tareas: Readonly<Record<string, TareaDeAtributos | undefined>>;
}

export interface Opcion {
  readonly id: string | number;
  readonly texto: string;
}

export interface Pregunta {
  readonly id: string;
  readonly tipo: string;
  readonly texto: string;
  readonly opciones: readonly Opcion[];
}

export interface Hipotesis {
  readonly grupo: string;
  readonly ocupacion?: { readonly esco?: string; readonly titulo?: PorIdioma };
  readonly tituloGrupo?: PorIdioma;
}

export interface Alternativa {
  readonly id: string;
  readonly hipotesis: Hipotesis;
}

export interface PasoPropuesta {
  readonly tipo: 'propuesta';
  readonly id?: string;
  readonly local?: boolean;
  readonly mejor: Hipotesis;
  readonly alternativas: readonly Alternativa[];
  readonly motivo?: string;
}

export interface PasoPregunta {
  readonly tipo: 'pregunta';
  readonly pregunta: Pregunta;
  readonly motivo?: string;
}

export interface PasoDecidido {
  readonly tipo: 'decidida';
  readonly grupo: string;
  readonly esco?: string;
  readonly motivo?: string;
}

/** Cualquier otro paso (un resultado sin grupo, por ejemplo): solo se mira su tipo. */
export interface PasoOtro {
  readonly tipo: string;
  readonly id?: string;
  readonly motivo?: string;
}

export type Paso = PasoPropuesta | PasoPregunta | PasoDecidido | PasoOtro;

export const esPropuesta = (p: Paso): p is PasoPropuesta => p.tipo === 'propuesta';
export const esPregunta = (p: Paso): p is PasoPregunta => p.tipo === 'pregunta';
export const esDecidido = (p: Paso): p is PasoDecidido => p.tipo === 'decidida';

/** Una respuesta de la persona, como la manda la pantalla. */
export interface Respuesta {
  readonly pregunta: string;
  readonly opcion: string;
}

export interface EntradaDePantalla {
  readonly texto: string;
  readonly idioma: string;
  readonly respuestas: Respuesta[];
  readonly anadido?: string;
}

export interface SalidaDePantalla {
  readonly paso: Paso;
  readonly lectura?: { readonly sinComprension?: boolean };
}

export interface CandidataLexica {
  readonly esco: string;
  readonly isco08?: string;
}

export interface Busqueda {
  readonly candidatas?: readonly CandidataLexica[];
  /** Si la búsqueda solo reconoce un sector: entonces no se consultan los vectores. */
  readonly soloSector?: string;
}

export interface Previa {
  readonly previa: { readonly grupos: readonly { readonly isco08: string; readonly p: number }[] } | null;
  readonly candidatas: readonly CandidataLexica[];
}

export interface Vectores {
  similitudes(texto: string, idioma: string): { readonly grupos: Iterable<readonly [string, number]> };
}

export interface Clasificador {
  readonly clases: readonly string[];
  predecir(texto: string, cuantos: number): readonly { readonly grupo: string }[];
}

/** Las funciones del motor que usa el medidor. */
export interface Motor {
  readonly datos: DatosDelPaquete;
  readonly atributos: Atributos;
  readonly pasoDePantalla: (
    datos: DatosDelPaquete,
    atributos: Atributos,
    entrada: EntradaDePantalla,
  ) => SalidaDePantalla;
  readonly buscar: (datos: DatosDelPaquete, texto: string, idioma: string) => Busqueda;
  readonly previaCalibrada: (datos: DatosDelPaquete, busqueda: Busqueda, contexto: object) => Previa;
  readonly textoParaVectores: ((datos: DatosDelPaquete, texto: string, busqueda: Busqueda) => string) | undefined;
  readonly entradaDelClasificador: (texto: string) => string;
  readonly vectores: Vectores | null;
  readonly clasificador: Clasificador | null;
  /** La huella del clasificador medido, o null si no hay. */
  readonly huellaDelClasificador: string | null;
}
