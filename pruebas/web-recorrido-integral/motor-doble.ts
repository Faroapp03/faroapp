import assert from 'node:assert/strict';

// El fallo del cliente real cuando la copia del motor no es la de esta versión: el mismo, para que el receptor lo
// reconozca (otro-dispositivo/recibir.js).
export { MotorQueNoCoincide } from '../../web/scripts/motor-local/cliente.js';

export type Transporte = (ruta: string, opciones: RequestInit) => Promise<Response>;
let atender: Transporte = async () => assert.fail('No hay motor de ensayo configurado');
export function fijarMotor(transporte: Transporte): void {
  atender = transporte;
}
export function pedirAlMotorLocal(ruta: string, opciones: RequestInit): Promise<Response> {
  return atender(ruta, opciones);
}
