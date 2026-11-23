import { TEXTOS_ACTIVACION } from './ca/activacion.js';
import { TEXTOS_CATALOGO_CURSOS } from './ca/catalogo-cursos.js';
import { TEXTOS_CONECTIVIDAD } from './ca/conectividad.js';
import { TEXTOS_FORMACION } from './ca/formacion.js';
import { TEXTOS_PANEL } from './ca/panel.js';
import { TEXTOS_PANEL_ACTIVACION } from './ca/panel-activacion.js';
import { TEXTOS_ADMINISTRADORES } from './ca/panel-administradores.js';
import { TEXTOS_SESION_UNICA } from './ca/panel-sesion-unica.js';
import { TEXTOS_VIGILANTE } from './ca/panel-vigilante.js';
// Los textos de Faro en catalán, traducidos con IA. Términos que conviene mirar, en web/idiomas/README.md.
// Tiene exactamente las mismas claves que es.js y los mismos marcadores: {nombre} es un valor que pone el script y
// {0}, {1}… son los elementos que el HTML tiene dentro (un enlace, un icono), que pueden cambiar de orden pero no
// desaparecer. Catalán estándar (IEC), con tuteo como el castellano y la terminología oficial de ocupación y
// formación.
// Cada texto va entero en su línea, aunque pase de 120 caracteres, como en es.js.

import { TEXTOS_CREDITOS } from './ca/creditos.js';
import { TEXTOS_CREDITOS_DATOS_GLOBALES } from './ca/creditos-datos-globales.js';
import { TEXTOS_DATOS_GLOBALES } from './ca/datos-globales.js';
import { TEXTOS_ENCUESTA } from './ca/encuesta.js';
import { TEXTOS_FARO } from './ca/faro.js';
import { TEXTOS_GUIA_IA } from './ca/guia-ia.js';
import { TEXTOS_INSTALACION } from './ca/instalacion.js';
import { TEXTOS_LECTURAS } from './ca/lecturas.js';
import { TEXTOS_PAGINAS } from './ca/paginas.js';
import { TEXTOS_RECORRIDO } from './ca/recorrido.js';
import { TEXTOS_SECCIONES } from './ca/secciones.js';

/**
 * Los textos de Faro en catalán, con las mismas claves y marcadores que el castellano (es.js).
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
