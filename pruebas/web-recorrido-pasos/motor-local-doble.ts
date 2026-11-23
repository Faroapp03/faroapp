// Doble de web/scripts/recorrido/motor.js para el paso de ocupación con el motor del dispositivo: cada petición
// devuelve la siguiente respuesta preparada (o lanza el error preparado) y guarda lo que se le ha enviado.
export class MotorNoListo extends Error {
  override name = 'MotorNoListo';
}

const preparadas: unknown[] = [];
/** Lo que el paso de ocupación ha mandado al motor, en orden. */
export const enviados: { operacion: string; cuerpo: Record<string, unknown> }[] = [];

/** Las respuestas que dará el motor, en orden; también vacía lo enviado. */
export function prepararPasos(...respuestas: unknown[]) {
  preparadas.splice(0, preparadas.length, ...respuestas);
  enviados.length = 0;
}

export async function pedir(operacion: string, cuerpo: Record<string, unknown>) {
  enviados.push({ operacion, cuerpo: structuredClone(cuerpo) });
  const siguiente = preparadas.shift();
  if (siguiente instanceof Error) {
    throw siguiente;
  }
  if (siguiente === undefined) {
    throw new Error('motor-local-doble: la prueba no ha preparado más respuestas');
  }
  return siguiente as Record<string, unknown>;
}
