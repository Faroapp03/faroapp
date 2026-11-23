// Los nombres oficiales del catálogo del SEPE, que llegan en mayúsculas, escritos como se leen: en minúsculas, con la
// inicial en mayúscula, con las siglas en mayúsculas y con las herramientas que nombran escritas como se escriben.

/**
 * Marcas de las herramientas que nombra el catálogo, con la forma con que se escriben; la clave, en mayúsculas.
 */
const MARCAS: ReadonlyMap<string, string> = new Map([
  ['CHATGPT', 'ChatGPT'],
  ['COPILOT', 'Copilot'],
  ['MICROSOFT', 'Microsoft'],
  ['EXCEL', 'Excel'],
  ['WORD', 'Word'],
  ['POWERPOINT', 'PowerPoint'],
  ['ACCESS', 'Access'],
  ['OUTLOOK', 'Outlook'],
  ['OFFICE', 'Office'],
  ['POWER', 'Power'],
  ['POINT', 'Point'],
  ['QUERY', 'Query'],
  ['PIVOT', 'Pivot'],
  ['GOOGLE', 'Google'],
  ['DRIVE', 'Drive'],
  ['LINKEDIN', 'LinkedIn'],
  ['WORDPRESS', 'WordPress'],
  ['PRESTASHOP', 'PrestaShop'],
  ['PHOTOSHOP', 'Photoshop'],
  ['ILLUSTRATOR', 'Illustrator'],
  ['AUTOCAD', 'AutoCAD'],
  ['PYTHON', 'Python'],
  ['JAVASCRIPT', 'JavaScript'],
  ['LINUX', 'Linux'],
  ['WINDOWS', 'Windows'],
  ['ANDROID', 'Android'],
  ['AZURE', 'Azure'],
  ['ORACLE', 'Oracle'],
  ['INSTAGRAM', 'Instagram'],
  ['FACEBOOK', 'Facebook'],
  ['YOUTUBE', 'YouTube'],
  ['TIKTOK', 'TikTok'],
  ['WHATSAPP', 'WhatsApp'],
]);
/** Siglas que no se pasan a minúsculas al presentar los nombres oficiales (vienen en mayúsculas). */
const SIGLAS: ReadonlySet<string> = new Set([
  'TIC',
  'IA',
  'CNC',
  'SAP',
  'PRL',
  'BIM',
  'CAD',
  'SEO',
  'GPS',
  'ADR',
  'UE',
  'PYME',
  'PYMES',
  'ERP',
  'CRM',
  'IOT',
  'MS',
  'BI',
  'SQL',
  'HTML',
  'CSS',
  'PHP',
  'AWS',
  'PDF',
  'API',
  'RRHH',
  'CMS',
  'PLC',
]);
/**
 * Una palabra entera: letras de cualquier alfabeto y cifras, sin otra letra ni cifra a los lados. `\b` no sirve aquí
 * porque solo conoce [A-Za-z0-9_] y partiría «área» en «rea».
 */
const PALABRA = /(?<![\p{L}\d])[\p{L}\d]+(?![\p{L}\d])/gu;

/**
 * Una palabra ya en minúsculas, como se escribe: la forma de su marca, sus siglas en mayúsculas o tal cual.
 *
 * @param palabra - Una palabra del nombre, en minúsculas.
 * @returns La palabra como se escribe.
 */
function palabraLegible(palabra: string): string {
  const mayusculas = palabra.toUpperCase();
  return MARCAS.get(mayusculas) ?? (SIGLAS.has(mayusculas) ? mayusculas : palabra);
}

/**
 * El nombre oficial (en mayúsculas en el SEPE) en minúsculas con la inicial en mayúscula, conservando las siglas y la
 * forma con que se escriben las herramientas que nombra (MARCAS).
 *
 * @param nombre - El nombre oficial, en cualquier caja.
 * @returns El nombre como se lee.
 */
export function nombreLegible(nombre: string): string {
  const texto = nombre.toLowerCase().replace(PALABRA, palabraLegible);
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}
