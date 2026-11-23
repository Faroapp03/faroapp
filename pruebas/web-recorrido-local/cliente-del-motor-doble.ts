// Doble de web/scripts/motor-local/cliente.js para las peticiones del recorrido (recorrido/motor.js) y la preparación
// (recorrido/preparacion.js): cada petición falla con el error que fije la prueba, o responde un objeto vacío.
/** El fallo del cliente real cuando el motor del dispositivo no es el de esta versión. */
export class MotorQueNoCoincide extends TypeError {
  override name = 'MotorQueNoCoincide';
}

let fallo: unknown = null;
/** Lo que se ha pedido al motor, en orden. */
export const pedidas: string[] = [];

/** El error con que fallarán las peticiones; null, para que respondan. */
export function fijarFallo(error: unknown): void {
  fallo = error;
}

export async function pedirAlMotorLocal(direccion: string): Promise<Response> {
  pedidas.push(direccion);
  if (fallo) {
    throw fallo;
  }
  return Response.json({});
}

export function escucharLaCarga(): () => void {
  return () => {};
}

/** El fallo del cliente real cuando el motor no arranca con la copia ya lista. */
export class MotorBloqueado extends TypeError {
  override name = 'MotorBloqueado';
}
