// El Worker/copia ya tienen pruebas propias; aquí se observa únicamente la elección de transporte.
let responder: (ruta: string, opciones: RequestInit) => Promise<Response> = async () => {
  throw new Error('Motor local no preparado por la prueba');
};
/** El fallo del cliente real cuando el motor del dispositivo no es el de esta versión (motor-local/cliente.js). */
export class MotorQueNoCoincide extends TypeError {
  override name = 'MotorQueNoCoincide';
}
/** El fallo del cliente real cuando el motor no arranca con la copia ya lista. */
export class MotorBloqueado extends TypeError {
  override name = 'MotorBloqueado';
}
export function fijarMotor(respuesta: typeof responder): void {
  responder = respuesta;
}
export function pedirAlMotorLocal(ruta: string, opciones: RequestInit): Promise<Response> {
  return responder(ruta, opciones);
}
