// Se importa antes que el módulo que se ensaya: desde ese momento, sus importaciones directas resuelven a los dobles.
// Así se ejecuta el archivo real entero, sin recortar su texto ni añadirle exportaciones para las pruebas.
import { registerHooks } from 'node:module';

const DOBLES = new URL('./dobles.ts', import.meta.url).href;
const PASO_RETENIDO = new URL('./paso-retenido.ts', import.meta.url).href;
const DESDE_EL_RECORRIDO = /\/web\/scripts\/recorrido\.js(?:\?|$)/u;
const DESDE_EL_PASO = /\/web\/scripts\/recorrido\/paso-informe\.js(?:\?|$)/u;
const AUXILIARES_REALES = new Set([
  './explicaciones-sin-estimacion.js',
  './entrega-final.js',
  './plan-formacion/registro-acreditacion.js',
]);
const DESDE_AUXILIAR =
  /\/web\/scripts\/recorrido\/(?:explicaciones-sin-estimacion|entrega-final|plan-formacion\/registro-acreditacion)\.js(?:\?|$)/u;

registerHooks({
  resolve(especificador, contexto, siguiente) {
    const padre = contexto.parentURL ?? '';
    const delRecorrido = DESDE_EL_RECORRIDO.test(padre);
    const delPaso = DESDE_EL_PASO.test(padre);
    // El paso 4 que trae recorrido.js llega cuando la prueba lo suelta, para poder borrar mientras tanto.
    if (delRecorrido && especificador === './recorrido/paso-informe.js') {
      return { url: PASO_RETENIDO, shortCircuit: true };
    }
    // El filtro de confianza y los errores de la API (qué es una cancelación, qué avisos trae un rechazo) son parte de
    // lo que se comprueba, no límites: nunca se sustituyen.
    if (
      delPaso &&
      (especificador === '../confianza.js' ||
        especificador === './api/errores.js' ||
        AUXILIARES_REALES.has(especificador))
    ) {
      return siguiente(especificador, contexto);
    }
    if (
      DESDE_AUXILIAR.test(padre) &&
      [
        '../textos.js',
        '../../textos.js',
        './estado.js',
        '../estado.js',
        './formato.js',
        '../dom.js',
        '../idioma.js',
        './conversacion.js',
      ].includes(especificador)
    ) {
      return { url: DOBLES, shortCircuit: true };
    }
    if (delRecorrido || delPaso) {
      return { url: DOBLES, shortCircuit: true };
    }
    return siguiente(especificador, contexto);
  },
});
