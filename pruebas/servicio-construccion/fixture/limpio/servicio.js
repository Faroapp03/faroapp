import { ARCHIVOS, FIRMAS, PAQUETE, TAMANOS_DEL_PAQUETE, VERSION } from './generado.js';
import { HuellaQueNoCoincide, PREFIJO, sumar } from './piezas.js';

const COPIA = `${PREFIJO}${VERSION}:${PAQUETE}`;
let ultimaFirma = FIRMAS.at(-1) ?? null;
class Copia {
  nombre = COPIA;
}
function tamanos() {
  return JSON.parse(TAMANOS_DEL_PAQUETE);
}

self.addEventListener('install', () => {
  ultimaFirma = sumar();
  return [new Copia(), tamanos(), ARCHIVOS, ultimaFirma, HuellaQueNoCoincide];
});
