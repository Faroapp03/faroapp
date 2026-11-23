// Las cifras que Faro escribe, en la web y en el informe, con punto de miles siempre y coma decimal, iguales en
// cualquier navegador y en Node. No se piden a Intl: un motor sin `useGrouping: 'always'` escribiría «4000» donde Faro
// escribe «4.000». Se redondea, como Intl, sobre la forma decimal más corta del número («0.745» da «0,75»).

const DIGITOS_DE_MILES = 3;
const MITAD = 5;
const MAX_DECIMALES = 20;
const MAYOR_SIN_EXPONENTE = 1e21;
const FORMA_DECIMAL = /^(\d+)(?:\.(\d+))?$/u;

/** Las cifras de la parte entera agrupadas de tres en tres con punto: «1234567» → «1.234.567». @param {string} entera */
function conPuntoDeMiles(entera) {
  const grupos = [];
  for (let fin = entera.length; fin > 0; fin -= DIGITOS_DE_MILES) {
    grupos.unshift(entera.slice(Math.max(0, fin - DIGITOS_DE_MILES), fin));
  }
  return grupos.join('.');
}

/**
 * El número sin signo con `decimales` cifras, redondeado a la mitad hacia arriba sobre su forma decimal más corta.
 * @param {number} valor Finito y no negativo. @param {number} decimales
 * @returns {[string, string]} La parte entera y la decimal.
 */
function redondeado(valor, decimales) {
  const forma = FORMA_DECIMAL.exec(String(valor));
  if (!forma && valor >= MAYOR_SIN_EXPONENTE) {
    // Desde 1e21 un número de coma flotante es entero y String lo escribe con exponente: BigInt da sus cifras.
    return [BigInt(valor).toString(), '0'.repeat(decimales)];
  }
  if (!forma) {
    // Menos de una millonésima: toFixed da la forma decimal sin exponente.
    const [entera = '0', decimal = ''] = valor.toFixed(decimales).split('.');
    return [entera, decimal];
  }
  const [, entera = '0', decimal = ''] = forma;
  const cifras = BigInt(entera + decimal.slice(0, decimales).padEnd(decimales, '0'));
  const total = String(Number(decimal[decimales] ?? '0') >= MITAD ? cifras + 1n : cifras).padStart(decimales + 1, '0');
  return [total.slice(0, total.length - decimales), total.slice(total.length - decimales)];
}

/**
 * Un número con punto de miles y coma decimal, siempre con `decimales` cifras: «1.234,5», «4.000», «-0,50».
 * @param {number} valor Finito. @param {number} [decimales] Entero entre 0 y 20.
 * @returns {string}
 */
export function cifra(valor, decimales = 0) {
  if (!Number.isFinite(valor) || !Number.isInteger(decimales) || decimales < 0 || decimales > MAX_DECIMALES) {
    throw new RangeError('La cifra no se puede escribir');
  }
  const [entera, decimal] = redondeado(Math.abs(valor), decimales);
  // Como Intl: un negativo conserva su signo aunque redondee a cero («-0,0»).
  const signo = valor < 0 || Object.is(valor, -0) ? '-' : '';
  return `${signo}${conPuntoDeMiles(entera)}${decimal ? `,${decimal}` : ''}`;
}

/**
 * Un número con hasta `maximo` decimales, sin ceros sobrantes: «1.500», «1,5», «0,59». Para cifras que no tienen un
 * número fijo de decimales, como horas o importes publicados.
 * @param {number} valor Finito. @param {number} maximo Entero entre 0 y 20.
 * @returns {string}
 */
export function cifraHasta(valor, maximo) {
  // Solo se recortan los ceros de la parte decimal, nunca los de los millares («1.500»).
  return cifra(valor, maximo).replace(/,(\d*?)0+$/u, (_, decimales) => (decimales ? `,${decimales}` : ''));
}

/** Los céntimos de un importe: dos decimales, o ninguno si el importe redondeado es entero. */
const DECIMALES_DEL_IMPORTE = 2;
const ESPACIO_DE_NO_SEPARACION = '\u00a0';

/**
 * Un importe publicado, el mismo en la tarjeta del catálogo y en la ficha del curso, con la misma regla en todas las
 * monedas: redondeado a dos decimales, sin ellos si queda entero y con los dos si no («1.500 €», «1.500,50 €»,
 * «20 USD», «12,50 GBP»). El euro va con su signo y las demás con su código; sin moneda, solo la cifra. Antes de la
 * moneda va un espacio de no separación.
 * @param {number} valor Finito. @param {string|null} [moneda] Código ISO 4217.
 * @returns {string}
 */
export function importe(valor, moneda = null) {
  // Redondeado a los céntimos: sin decimales si queda entero («9,999» da «10»), con los dos si no («12,50»).
  const conCentimos = cifra(valor, DECIMALES_DEL_IMPORTE);
  const escrito = conCentimos.endsWith(',00') ? conCentimos.slice(0, -',00'.length) : conCentimos;
  if (!moneda) {
    return escrito;
  }
  return `${escrito}${ESPACIO_DE_NO_SEPARACION}${moneda === 'EUR' ? '€' : moneda}`;
}
