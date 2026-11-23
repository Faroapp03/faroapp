// Contrato compartido por la API y su cliente web: límites, cabeceras y campos con una sola definición.
// La copia JavaScript del cliente debe generarse desde este módulo y conservar los mismos valores.

/** Versión del contrato que declaran las peticiones y respuestas de web y API. */
export const CONTRATO_API = 8;
/** Unidades UTF-16 (`String.length`) del relato que admite la búsqueda de ocupaciones. */
export const MAX_RELATO = 4000;
/** Unidades UTF-16 (`String.length`) de una tarea que admiten la API y sus campos de escritura. */
export const MAX_TAREA = 300;
/** Tareas de un informe completo, incluidas las que no viajan al otro dispositivo. */
export const MAX_TAREAS_INFORME = 30;
/** Grupos de una opción: uno o dos cuando la persona hace ambas cosas. */
export const MAX_GRUPOS_POR_OPCION = 2;
/** Unidades UTF-16 (`String.length`) de la palabra con que la persona nombra su trabajo. */
export const MAX_OCUPACION_PERSONA = 60;
/** Cabecera que declara la versión del contrato web y API. */
export const CABECERA_CONTRATO = 'x-faro-contrato';
/** Campo del rechazo que identifica las tareas cuya firma no vale. */
export const CAMPO_FIRMAS_NO_VALIDAS = 'tareasConFirmaNoValida';
/** Campo del rechazo que identifica las tareas no admitidas por la moderación. */
export const CAMPO_TAREAS_NO_ADMITIDAS = 'tareasNoAdmitidas';
/** Prefijo estable del identificador de tipo de los problemas de la API. */
export const RAIZ_DE_LOS_PROBLEMAS = 'tag:faroapp.org,2026:problema/';
