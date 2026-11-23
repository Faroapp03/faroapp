// Adaptador entre las preguntas del motor y la conversación: «No lo sé» es una opción neutra y las escalas
// de tres o cinco niveles se muestran en orden, con la respuesta neutra en el centro.

/** @typedef {{ id: string, texto: string }} OpcionDelMotor */
/** @typedef {{ id: string, texto: string, neutra: boolean }} OpcionVista */
/** @typedef {{ id: string, texto: string, opciones: OpcionVista[], escala: 3 | 5 | null }} PreguntaVista */

/** La respuesta que no informa: el motor la ignora y la pantalla la pinta aparte. */
const NO_LO_SE = 'no_lo_se';

/** Los ids de la escala de sí o no, en su orden. Se aceptan los nombres previsibles del contrato de 1B. */
const ESCALA_5 = [
  ['si'],
  ['mas_si', 'mas_bien_si', 'bastante_si'],
  [NO_LO_SE],
  ['mas_no', 'mas_bien_no', 'bastante_no'],
  ['no'],
];

/** Las escalas admitidas, por los niveles que usan: 3 (Sí · No lo sé · No) o las 5. @type {Map<string, 3 | 5>} */
const ESCALAS = new Map([
  ['0,2,4', /** @type {3} */ (ESCALA_5.length - 2)],
  ['0,1,2,3,4', /** @type {5} */ (ESCALA_5.length)],
]);

/**
 * El nivel de la escala de un id (0 = Sí … 4 = No), o -1 si no es de la escala.
 * @param {string} id @returns {number}
 */
function nivel(id) {
  return ESCALA_5.findIndex((ids) => ids.includes(id));
}

/**
 * Si las opciones forman una escala de sí o no, cuántos niveles tiene (3 o 5); si no, null.
 * @param {readonly OpcionDelMotor[]} opciones @returns {3 | 5 | null}
 */
function nivelesDeEscala(opciones) {
  const niveles = opciones.map((o) => nivel(o.id));
  if (niveles.some((n) => n < 0) || new Set(niveles).size !== niveles.length) {
    return null;
  }
  const conjunto = [...niveles].sort((a, b) => a - b).join(',');
  return ESCALAS.get(conjunto) ?? null;
}

/**
 * Textos de opciones del motor que la pantalla sustituye por otros más claros, por id de pregunta (su prefijo) y de
 * opción. «Un trabajo técnico o de apoyo especializado» (gran grupo 3 de la CIUO-08) no se entiende: se dice con
 * ejemplos. 1B también revisa sus textos; cuando cambien, esto se puede quitar.
 * @type {Readonly<Record<string, Readonly<Record<string, { es: string, ca: string }>>>>}
 */
const TEXTOS_MAS_CLAROS = {
  nivel1: {
    3: {
      es: 'Técnico o técnica: laboratorio, sanidad, informática, ventas o gestión',
      ca: 'Tècnic o tècnica: laboratori, sanitat, informàtica, vendes o gestió',
    },
  },
};

/**
 * El texto de una opción, más claro si la pantalla tiene uno para ella.
 * @param {string} pregunta @param {OpcionDelMotor} opcion @param {'es' | 'ca'} idioma
 */
function textoDeOpcion(pregunta, opcion, idioma) {
  const tipo = pregunta.split(':')[0] ?? '';
  return TEXTOS_MAS_CLAROS[tipo]?.[opcion.id]?.[idioma] ?? opcion.texto;
}

/**
 * La pregunta tal como la pinta la pantalla.
 * @param {{ id: string, texto: string, opciones: readonly OpcionDelMotor[] }} pregunta @param {'es' | 'ca'} [idioma]
 * @returns {PreguntaVista}
 */
export function vistaDePregunta(pregunta, idioma = 'es') {
  const escala = nivelesDeEscala(pregunta.opciones);
  const opciones = pregunta.opciones.map((o) => ({
    id: o.id,
    texto: textoDeOpcion(pregunta.id, o, idioma),
    neutra: o.id === NO_LO_SE,
  }));
  if (escala) {
    opciones.sort((a, b) => nivel(a.id) - nivel(b.id));
  }
  return { id: pregunta.id, texto: pregunta.texto, opciones, escala };
}
