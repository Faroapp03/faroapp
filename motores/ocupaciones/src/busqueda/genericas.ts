// Las palabras de rango o de función que aparecen en cientos de nombres del catálogo sin decir el oficio («técnico»,
// «auxiliar», «ayudante», «responsable»…). Su rareza (IDF) ya es baja, pero basta para que un nombre que la lleva cubra
// entera una búsqueda corta: «técnico laboral» acababa en «técnico en prevención de riesgos laborales» (minas) por
// encima de «responsable de relaciones laborales». Aquí se rebaja su peso, en la búsqueda y en los nombres, para que
// decida la palabra del oficio, y se reconoce la búsqueda que no dice nada más («técnico», «sóc auxiliar»), para que
// la interfaz pregunte «¿técnico de qué?» en lugar de ordenar cientos de opciones.
// La lista se ha escrito a partir de las palabras más frecuentes de los nombres de ESCO-es y del SEPE que nombran un
// rango o una función y no un oficio; no sale del banco de evaluación. Cada forma va en su forma común (palabras.ts).

import { formaComun, palabrasDe } from './palabras.ts';

/**
 * Lo que vale la rareza de una palabra genérica frente a la de una palabra de oficio con la misma rareza. Con 0,4,
 * «técnico» (IDF ≈ 2) pesa como una palabra que está en casi todos los nombres; sigue contando para desempatar entre
 * «técnico de laboratorio» y «auxiliar de laboratorio».
 */
const FACTOR_GENERICA = 0.4;

/**
 * Cada palabra genérica (en castellano y en catalán, masculino y femenino) → la clave con que se pide precisión: en
 * castellano y en masculino, la interfaz la traduce.
 */
const GENERICAS: ReadonlyMap<string, string> = new Map(
  (
    [
      ['tecnico', ['tecnico', 'tecnica', 'tecnicos', 'tecnicas', 'tecnic', 'tecnics']],
      ['auxiliar', ['auxiliar', 'auxiliares', 'auxiliars']],
      ['ayudante', ['ayudante', 'ayudantes', 'ajudant', 'ajudanta', 'ajudants']],
      ['responsable', ['responsable', 'responsables']],
      ['empleado', ['empleado', 'empleada', 'empleados', 'empleadas', 'empleat', 'empleats']],
      ['operario', ['operario', 'operaria', 'operarios', 'operarias', 'operari', 'operaris']],
      ['especialista', ['especialista', 'especialistas', 'especialistes']],
      ['asistente', ['asistente', 'asistentes', 'assistent', 'assistenta', 'assistents']],
      ['trabajador', ['trabajador', 'trabajadora', 'trabajadores', 'treballador', 'treballadora', 'treballadors']],
      ['profesional', ['profesional', 'profesionales', 'professional', 'professionals']],
      ['encargado', ['encargado', 'encargada', 'encargados', 'encarregat', 'encarregada']],
      ['oficial', ['oficial', 'oficiales', 'oficials']],
      ['agente', ['agente', 'agentes', 'agent', 'agents']],
      ['gestor', ['gestor', 'gestora', 'gestores', 'gestors']],
      // Rango de mando («gerente» proponía «gerente de supermercado»).
      ['gerente', ['gerente', 'gerentes', 'gerent', 'gerents']],
      ['director', ['director', 'directora', 'directores', 'directoras', 'directors']],
      ['jefe', ['jefe', 'jefa', 'jefes', 'jefas', 'cap', 'caps']],
      ['coordinador', ['coordinador', 'coordinadora', 'coordinadores', 'coordinadoras', 'coordinadors']],
      ['supervisor', ['supervisor', 'supervisora', 'supervisores', 'supervisoras', 'supervisors']],
      // Familias de oficio enteras («científico» mezclaba analistas de sistemas, agrónomos y
      // salud, y en catalán proponía «analista de sistemas»): primero «¿… de qué?».
      [
        'cientifico',
        ['cientifico', 'cientifica', 'cientificos', 'cientificas', 'cientific', 'cientifics', 'cientifiques'],
      ],
      ['investigador', ['investigador', 'investigadora', 'investigadores', 'investigadoras', 'investigadors']],
      ['ingeniero', ['ingeniero', 'ingeniera', 'ingenieros', 'ingenieras', 'enginyer', 'enginyera', 'enginyers']],
    ] as const
  ).flatMap(([clave, formas]) => formas.map((forma) => [formaComun(forma), clave] as const)),
);

/**
 * Si una palabra, en su forma común, es genérica.
 *
 * @param forma - Palabra en su forma común (formaComun).
 * @returns Si nombra un rango o una función y no un oficio.
 */
export function esGenerica(forma: string): boolean {
  return GENERICAS.has(forma);
}

/**
 * La rareza con que cuenta una palabra en la búsqueda y en los nombres: la del catálogo, rebajada si es genérica.
 *
 * @param forma - Palabra en su forma común.
 * @param rareza - Su rareza (IDF) en el catálogo.
 * @returns La rareza que se usa al puntuar.
 */
export function rarezaAjustada(forma: string, rareza: number): number {
  return esGenerica(forma) ? rareza * FACTOR_GENERICA : rareza;
}

/**
 * Si la búsqueda es una sola palabra genérica («técnico», «Sóc auxiliar», «ayudanta»): la clave con que la interfaz
 * pide precisión. Las palabras vacías («soy», «trabajo de») no cuentan.
 *
 * @param texto - El oficio de la búsqueda, sin el lugar de trabajo.
 * @returns La clave («tecnico») o undefined si la búsqueda dice algo más.
 */
export function precisionQueFalta(texto: string): string | undefined {
  const palabras = [...new Set(palabrasDe(texto).map(formaComun))];
  return palabras.length === 1 ? GENERICAS.get(palabras[0] as string) : undefined;
}
