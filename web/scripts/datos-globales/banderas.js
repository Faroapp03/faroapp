// Las banderas de los territorios, todas 3:2 y a 24 × 16 px con su filete, como en el selector de idioma
// (.idioma-bandera): las de diseño propio de Faro (imagenes/identidad/) y, para los demás países que salen en «El
// mundo», las del juego country-flag-icons (imagenes/banderas/, licencia MIT; versión, huellas y texto de la licencia en
// imagenes/banderas/procedencia.json). Lógica pura.

/** Las banderas propias de Faro, por el código del territorio. */
const PROPIAS = new Map([
  ['ES51', 'identidad/bandera-catalunya.svg'],
  ['ESP', 'identidad/bandera-espana.svg'],
  ['DEU', 'identidad/bandera-alemania.svg'],
  ['FRA', 'identidad/bandera-francia.svg'],
  ['ITA', 'identidad/bandera-italia.svg'],
  ['EU27_2020', 'identidad/bandera-union-europea.svg'],
]);

/** Los países con bandera del juego, por su código ISO 3166-1 alfa-3 (el archivo es el código en minúsculas). */
const DEL_JUEGO = new Set([
  'ALB',
  'AUS',
  'AUT',
  'BEL',
  'BGR',
  'BIH',
  'BRA',
  'CAN',
  'CHE',
  'CHL',
  'COL',
  'CYP',
  'CZE',
  'DNK',
  'EST',
  'FIN',
  'GBR',
  'GRC',
  'HRV',
  'HUN',
  'IRL',
  'ISL',
  'ISR',
  'KOR',
  'LTU',
  'LUX',
  'LVA',
  'MKD',
  'MLT',
  'MNE',
  'NLD',
  'NOR',
  'POL',
  'PRT',
  'ROU',
  'SRB',
  'SVK',
  'SVN',
  'SWE',
  'TUR',
  'URY',
  'USA',
  'XKK',
]);

/**
 * La dirección de la bandera de un territorio, desde la raíz de la web, o null si no tiene: la propia de Faro y, con
 * `delJuego` (el selector y la ficha de «El mundo»), también la del juego.
 * @param {string | null} codigo @param {{ delJuego?: boolean }} [opciones] @returns {string | null}
 */
export function direccionDeLaBandera(codigo, { delJuego = false } = {}) {
  if (codigo === null) {
    return null;
  }
  const propia = PROPIAS.get(codigo);
  if (propia) {
    return `imagenes/${propia}`;
  }
  return delJuego && DEL_JUEGO.has(codigo) ? `imagenes/banderas/${codigo.toLowerCase()}.svg` : null;
}
