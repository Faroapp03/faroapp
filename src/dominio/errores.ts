// Clases de error para distinguir entradas inválidas de fallos internos del dominio mediante instanceof.
// La capa de API decide la respuesta HTTP; estas clases conservan el constructor y las opciones de Error.

/** Petición al motor que cita una ocupación, tarea o referencia inexistente. Su mensaje debe ser apto para la persona. */
export class EntradaInvalida extends Error {}

/** Estado que el código o los datos no deberían permitir; el mensaje interno no debe exponerse en la respuesta. */
export class InvarianteRoto extends Error {}
