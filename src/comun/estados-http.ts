// Códigos de estado HTTP con nombres compartidos: RFC 9110, salvo 429 (RFC 6585).

/** Los códigos de estado HTTP, por su significado. */
export const ESTADO_HTTP = {
  /** 200: la petición se ha atendido. */
  correcto: 200,
  /** 202: aceptada para procesarla; el procesamiento aún no ha terminado. */
  aceptada: 202,
  /** 204: atendida, sin cuerpo. */
  sinContenido: 204,
  /** 302: lo pedido está temporalmente en otra dirección (cabecera `location`). */
  encontradoEnOtraDireccion: 302,
  /** 303: la respuesta está en otra dirección y se pide con GET (cabecera `location`). */
  verOtra: 303,
  /** 400: la petición está mal formada. */
  solicitudIncorrecta: 400,
  /** 401: falta la identificación o no vale. */
  noAutenticado: 401,
  /** 403: el servidor entiende la petición, pero no la autoriza. */
  prohibido: 403,
  /** 404: no se encuentra el recurso. */
  noEncontrado: 404,
  /** 405: la ruta no admite ese método. */
  metodoNoAdmitido: 405,
  /** 409: la petición choca con el estado del servidor (p. ej. otra versión del contrato). */
  conflicto: 409,
  /** 413: el cuerpo es demasiado grande. */
  demasiadoGrande: 413,
  /** 415: el tipo del cuerpo no se admite. */
  tipoNoAdmitido: 415,
  /** 421: la petición ha llegado a un servidor que no atiende a ese anfitrión (RFC 9110 §15.5.20). */
  anfitrionNoAtendido: 421,
  /** 422: tipo y sintaxis del contenido válidos, pero sus instrucciones no se pueden procesar. */
  contenidoNoProcesable: 422,
  /** 429: demasiadas peticiones. */
  demasiadasPeticiones: 429,
  /** 500: fallo interno. */
  errorInterno: 500,
  /** 502: el servicio del que depende ha respondido mal. */
  pasarelaIncorrecta: 502,
  /** 503: el servicio no está disponible. */
  noDisponible: 503,
  /** 504: el servicio del que depende no ha respondido a tiempo. */
  tiempoAgotado: 504,
} as const;
