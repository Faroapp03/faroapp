// Doble de web/scripts/motor-local/cliente.js para recorrido/motor.js: cada petición espera, como la del cliente real
// mientras no hay un service worker activo (paquete-sin-conexion.js, estadoDelPaquete), hasta que la prueba la
// responde (responderTodas).
/** El fallo del cliente real cuando el motor del dispositivo no es el de esta versión. */
export class MotorQueNoCoincide extends TypeError {
  override name = 'MotorQueNoCoincide';
}

const enEspera: ((respuesta: Response) => void)[] = [];
/** Lo que se ha pedido al motor, en orden. */
export const pedidas: string[] = [];

export function pedirAlMotorLocal(direccion: string): Promise<Response> {
  pedidas.push(direccion);
  return new Promise((resolver) => {
    enEspera.push(resolver);
  });
}

/** Responde con un objeto vacío todas las peticiones que esperan. */
export function responderTodas(): void {
  for (const resolver of enEspera.splice(0)) {
    resolver(Response.json({}));
  }
}

export function escucharLaCarga(): () => void {
  return () => {};
}

/** El fallo del cliente real cuando el motor no arranca con la copia ya lista. */
export class MotorBloqueado extends TypeError {
  override name = 'MotorBloqueado';
}
