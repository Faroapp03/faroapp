// Se carga con --import en un proceso aislado: sustituye el registro de extensiones instaladas por el doble vacío
// antes de importar cualquier módulo del producto, como queda la instalación tras retirar la última extensión. Si
// nada importa el registro, el proceso termina con error: la sustitución no se habría probado.
import { registerHooks } from 'node:module';

const INSTALADAS = new URL('../../src/plataforma/extensiones-instaladas.ts', import.meta.url).href;
const VACIAS = new URL('./extensiones-vacias.ts', import.meta.url).href;
let sustituciones = 0;
registerHooks({
  resolve(especificador, contexto, siguiente) {
    const resuelto = siguiente(especificador, contexto);
    if (resuelto.url !== INSTALADAS) {
      return resuelto;
    }
    sustituciones += 1;
    return { ...resuelto, url: VACIAS };
  },
});
process.on('exit', () => {
  if (sustituciones === 0) {
    process.exitCode = 1;
  }
});
