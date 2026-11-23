/** Código de un fallo de procesamiento o configuración; la API lo traduce sin exponer el mensaje interno. */
export type CodigoErrorDeProcesamiento = 'no_configurado' | 'salida_invalida';

/** Error compartido por las reglas locales, el lector de configuración y su frontera HTTP. */
export class ErrorDeProcesamiento extends Error {
  readonly codigo: CodigoErrorDeProcesamiento;
  constructor(codigo: CodigoErrorDeProcesamiento, mensaje: string) {
    super(mensaje);
    this.codigo = codigo;
  }
}
