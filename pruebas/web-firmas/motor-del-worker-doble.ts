// Doble del motor compilado (web/motor/src/plataforma/navegador/motor.js) para el Worker real (motor-local/worker.js):
// apunta con qué clave de firma se crea cada motor y firma sus respuestas con ella, con el firmador real
// (src/seguridad/firma.ts). No lee ningún paquete.
import { crearFirmador } from '../../src/seguridad/firma.ts';

/** Lo que firma el motor en cada respuesta. */
export const DATOS_FIRMADOS = { grupo: '5131', estimacion: 0.42 };
/** La clave con que se ha creado cada motor, en orden; undefined si el Worker no le ha dado ninguna. */
export const claves: (CryptoKey | undefined)[] = [];

export async function crearMotorLocal(_base: URL, { secretoFirma }: { secretoFirma?: CryptoKey } = {}) {
  claves.push(secretoFirma);
  const firmador = await crearFirmador(secretoFirma);
  return {
    necesitaElResto: () => false,
    completar: async () => {},
    responder: async () => Response.json({ firma: await firmador.firmar(DATOS_FIRMADOS) }),
  };
}
