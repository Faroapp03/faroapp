import { TEXTOS_ACTIVACION } from './es/activacion.js';
import { TEXTOS_CATALOGO_CURSOS } from './es/catalogo-cursos.js';
import { TEXTOS_CONECTIVIDAD } from './es/conectividad.js';
import { TEXTOS_FORMACION } from './es/formacion.js';
import { TEXTOS_PANEL } from './es/panel.js';
import { TEXTOS_PANEL_ACTIVACION } from './es/panel-activacion.js';
import { TEXTOS_ADMINISTRADORES } from './es/panel-administradores.js';
import { TEXTOS_SESION_UNICA } from './es/panel-sesion-unica.js';
import { TEXTOS_VIGILANTE } from './es/panel-vigilante.js';
// Los textos de Faro en castellano, el idioma de partida. El HTML de cada página los lleva escritos igual (su clave
// va en data-texto o data-texto-<atributo>), así que sin JavaScript la web se lee en castellano; los scripts los piden
// por su clave (scripts/textos.js). Un texto con {nombre} lleva un valor que pone el script; uno con {0}, {1}…, los
// elementos que el HTML tiene dentro (un enlace, un icono), en su orden. pruebas/web-idiomas/textos.test.ts comprueba
// que el catalán (ca.js) tiene las mismas claves y los mismos marcadores, y que ningún texto de ambos está vacío.
// Cada texto va entero en su línea, aunque pase de 120 caracteres: se busca y se revisa sin recomponerlo.

import { TEXTOS_CREDITOS } from './es/creditos.js';
import { TEXTOS_CREDITOS_DATOS_GLOBALES } from './es/creditos-datos-globales.js';
import { TEXTOS_DATOS_GLOBALES } from './es/datos-globales.js';
import { TEXTOS_ENCUESTA } from './es/encuesta.js';
import { TEXTOS_FARO } from './es/faro.js';
import { TEXTOS_GUIA_IA } from './es/guia-ia.js';
import { TEXTOS_INSTALACION } from './es/instalacion.js';
import { TEXTOS_LECTURAS } from './es/lecturas.js';
import { TEXTOS_PAGINAS } from './es/paginas.js';
import { TEXTOS_RECORRIDO } from './es/recorrido.js';
import { TEXTOS_SECCIONES } from './es/secciones.js';

/**
 * Los textos de Faro en castellano, por clave (el catálogo del que parten las demás lenguas).
 *
 * @type {Readonly<Record<string, string>>}
 */
export default {
  ...TEXTOS_FORMACION,
  ...TEXTOS_CONECTIVIDAD,
  ...TEXTOS_ACTIVACION,
  ...TEXTOS_PANEL,
  ...TEXTOS_PANEL_ACTIVACION,
  ...TEXTOS_VIGILANTE,
  ...TEXTOS_SESION_UNICA,
  ...TEXTOS_ADMINISTRADORES,
  ...TEXTOS_CATALOGO_CURSOS,
  ...TEXTOS_PAGINAS,
  ...TEXTOS_SECCIONES,
  ...TEXTOS_FARO,
  ...TEXTOS_GUIA_IA,
  ...TEXTOS_CREDITOS,
  ...TEXTOS_CREDITOS_DATOS_GLOBALES,
  ...TEXTOS_DATOS_GLOBALES,
  ...TEXTOS_INSTALACION,
  ...TEXTOS_RECORRIDO,
  ...TEXTOS_LECTURAS,
  ...TEXTOS_ENCUESTA,
};
