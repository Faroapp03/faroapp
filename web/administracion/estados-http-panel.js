// Estados HTTP que el cliente del panel distingue al leer una respuesta; el resto se trata como respuesta no válida.
export const EXITO = 200;
export const INCORRECTO = 400;
export const PROHIBIDO = 403;
export const CONFLICTO = 409;
export const NO_DISPONIBLE = 503;
export const AGOTADO = 504;

/** Rechazos conocidos del servidor («estado:error») y el aviso con que el panel los explica al usuario. */
export const AVISOS_DE_RECHAZO = new Map([
  [`${CONFLICTO}:revision_desactualizada`, 'revision_instituciones_conflictiva'],
  [`${CONFLICTO}:limite_instituciones`, 'limite_instituciones'],
  [`${CONFLICTO}:dos_claves_activas`, 'dos_claves_activas'],
  ['404:institucion_no_encontrada', 'institucion_no_encontrada'],
  [`${PROHIBIDO}:correo_no_verificado`, 'correo_no_verificado'],
  [`${PROHIBIDO}:no_es_administrador`, 'no_es_administrador'],
  [`${PROHIBIDO}:segundo_factor_requerido`, 'segundo_factor_requerido'],
  [`${PROHIBIDO}:acceso_denegado`, 'acceso_denegado'],
  [`${PROHIBIDO}:origen_no_permitido`, 'acceso_denegado'],
  [`${INCORRECTO}:solicitud_invalida`, 'solicitud_rechazada'],
  [`${NO_DISPONIBLE}:no_disponible`, 'no_disponible'],
  [`${AGOTADO}:tiempo_agotado`, 'tiempo_agotado'],
]);
