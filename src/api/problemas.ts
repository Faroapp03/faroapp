// Títulos fijos de Problem Details: los comparten el contrato y las respuestas de la API.

/** Tipo de toda respuesta de error de la API REST. */
export const TIPO_PROBLEMA = 'application/problem+json';
export { RAIZ_DE_LOS_PROBLEMAS } from '../comun/protocolo-web.ts';

/** Título estable de cada problema; el detalle depende de la petición. */
export const PROBLEMAS = {
  demasiadas_peticiones: 'Demasiadas peticiones',
  origen_no_permitido: 'Origen no permitido',
  comprobacion: 'Comprobación de seguridad no superada',
  tipo_no_admitido: 'Tipo de cuerpo no admitido',
  cancelada: 'Petición cancelada',
  tiempo: 'Tiempo agotado',
  contrato: 'Versión del contrato incompatible',
  reloj_atrasado: 'Fecha del dispositivo atrasada',
  solicitud_invalida: 'Petición mal formada',
  error_interno: 'Error interno',
  ruta_desconocida: 'Ruta desconocida',
  metodo_no_admitido: 'Método no admitido',
  ocupacion_desconocida: 'Ocupación desconocida',
  grupo_desconocido: 'Grupo desconocido',
  contenido_no_admitido: 'Contenido no admitido',
  firma_no_valida: 'Firma no válida',
  seleccion_no_disponible: 'Selección de ocupación no disponible',
  acceso: 'Acceso no permitido',
  // Los de la API para socios (api/socios/): OAuth 2.0 (RFC 6749, 6750 y 7009) con su código en la extensión `error`.
  credenciales_no_validas: 'Credenciales del socio no válidas',
  concesion_no_admitida: 'Tipo de concesión no admitido',
  ambito_no_valido: 'Ámbito no válido',
  token_ausente: 'Falta el token de acceso',
  token_no_valido: 'Token de acceso no válido',
  token_de_otro_socio: 'Token de otro socio',
  revocacion_no_disponible: 'Revocación no disponible',
  no_configurado: 'Configuración del servicio no disponible',
  salida_invalida: 'Resultado de procesamiento no válido',
} as const satisfies Record<string, string>;
