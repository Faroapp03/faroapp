// Los recursos del servidor MCP: dos textos fijos que un asistente puede leer antes de usar las herramientas, para
// presentar bien lo que responde Faro. Uno dice qué es Faro y cómo leer sus datos; el otro, de dónde sale cada dato y
// con qué licencia. Son de solo lectura y no cambian entre peticiones.

import { ESTADO_HTTP } from '../../comun/estados-http.ts';
import { VERSION_FARO } from '../../comun/version.ts';
import { UMBRALES } from '../../dominio/franjas.ts';
import { HERRAMIENTAS } from './definiciones.ts';
import { ALCANCE, LICENCIAS } from './procedencia.ts';
import { CODIGO, ErrorMcp } from './protocolo.ts';

/** Un recurso: su dirección, su nombre, su tipo y su contenido. */
interface Recurso {
  uri: string;
  name: string;
  title: string;
  description: string;
  mimeType: string;
  texto: () => string;
}

/** Un recurso tal como se lista en `resources/list`: sin su contenido. */
export type DescripcionDeRecurso = Omit<Recurso, 'texto'>;

/** Lo que responde `resources/read`: el contenido del recurso, con su dirección y su tipo. */
export interface ContenidoDeRecurso {
  contents: { uri: string; mimeType: string; text: string }[];
}

/** Cómo leer lo que responde Faro, en pocas líneas. */
const ACERCA = `# Faro: datos comprobados sobre el trabajo y la IA

Faro ayuda a las personas trabajadoras de Cataluña a entender cómo puede cambiar su trabajo con la IA generativa y
qué formación oficial tienen a su alcance. Ofrece ocho consultas factuales sin llamadas a modelos durante
la consulta: ${HERRAMIENTAS.map(({ name }) => `\`${name}\``).join(', ')}.
El recorrido reconoce la ocupación con la IA local del dispositivo; la persona confirma sus elecciones.

- La ocupación se ancla en un grupo de 4 cifras de la CIUO-08 (ISCO-08); una ocupación ESCO del grupo solo afina.
- La nota de cada tarea (0 a 1) es la exposición a la IA generativa según la OIT (Working Paper 140, 2025). Mide
  cuánto de la tarea podría hacer o ayudar a hacer la IA, no si un empleo desaparece.
- Franjas de Faro: alta con nota ≥ ${UMBRALES.alta}, media desde ${UMBRALES.media} y baja por debajo.
- Cada respuesta de las ocho consultas lleva \`procedencia\`: las fuentes con su cita, su fecha y su licencia, qué es dato oficial y qué ha
  hecho Faro (traducciones, orden, franjas).
- ${ALCANCE}
- Antes de buscar, Faro retira los datos personales que reconoce su filtro. No envíes datos personales en las consultas.

Versión de Faro: ${VERSION_FARO}.
`;

/** Los recursos, en el orden fijo en que se listan. */
const RECURSOS: readonly Recurso[] = [
  {
    uri: 'faro://acerca',
    name: 'acerca',
    title: 'Qué es Faro y cómo leer sus datos',
    description: 'Qué ofrece Faro, cómo se leen la nota de la OIT y las franjas, y qué no es una respuesta de Faro.',
    mimeType: 'text/markdown',
    texto: () => ACERCA,
  },
  {
    uri: 'faro://fuentes',
    name: 'fuentes',
    title: 'Fuentes y licencias',
    description: 'La licencia o las condiciones de reutilización de cada fuente que cita Faro.',
    mimeType: 'application/json',
    texto: () => JSON.stringify({ faro: VERSION_FARO, licencias: LICENCIAS }, null, 2),
  },
];

/**
 * La lista pública de los recursos.
 *
 * @returns Los recursos con sus descripciones, sin su contenido.
 */
export function listaDeRecursos(): DescripcionDeRecurso[] {
  return RECURSOS.map(({ uri, name, title, description, mimeType }) => ({ uri, name, title, description, mimeType }));
}

/**
 * Atiende `resources/read`; un recurso que no existe es -32602, como pide la revisión vigente.
 *
 * @param parametros - Los parámetros de `resources/read` (con `uri`).
 * @returns El contenido del recurso.
 * @throws {Error} ErrorMcp (-32602) si el recurso no existe.
 */
export function leerRecurso(parametros: Record<string, unknown>): ContenidoDeRecurso {
  const recurso = RECURSOS.find((uno) => uno.uri === parametros.uri);
  if (!recurso) {
    throw new ErrorMcp(CODIGO.parametros, 'Recurso no encontrado', ESTADO_HTTP.correcto);
  }
  return { contents: [{ uri: recurso.uri, mimeType: recurso.mimeType, text: recurso.texto() }] };
}
