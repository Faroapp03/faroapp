import './dom.ts';
import { registerHooks } from 'node:module';

/** Dobles de fronteras declaradas. El modelo, las tarjetas y pagina.enEspera/soltarEspera son código real. */
const interfaces = new Set([
  'compositor.js',
  'conversacion.js',
  'navegacion.js',
  'saludo.js',
  'idioma-de-los-datos.js',
]);
registerHooks({
  resolve(spec, contexto, siguiente) {
    const pideLaConversacion = ['/plan-formacion/preguntar-acreditacion.js', '/formacion/fallo.js'].some((modulo) =>
      contexto.parentURL?.endsWith(modulo),
    );
    if (pideLaConversacion && spec === '../conversacion.js') {
      return { url: new URL('./interfaz-doble.ts', import.meta.url).href, shortCircuit: true };
    }
    if (contexto.parentURL?.includes('/web/scripts/recorrido/')) {
      if (spec === './api.js') {
        return { url: new URL('./api-doble.ts', import.meta.url).href, shortCircuit: true };
      }
      // El paso de ocupación elige su camino con ocupacion-local.js, que pide al motor del dispositivo: los dos, dobles.
      if (spec === './ocupacion-local.js') {
        return { url: new URL('./ocupacion-local-doble.ts', import.meta.url).href, shortCircuit: true };
      }
      if (spec === './motor.js') {
        return { url: new URL('./motor-local-doble.ts', import.meta.url).href, shortCircuit: true };
      }
      if (spec.startsWith('./') && interfaces.has(spec.slice('./'.length))) {
        return { url: new URL('./interfaz-doble.ts', import.meta.url).href, shortCircuit: true };
      }
    }
    return siguiente(spec, contexto);
  },
});
