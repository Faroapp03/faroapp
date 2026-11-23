import { registerHooks } from 'node:module';

// Sustituye solo el borde Worker del receptor; su formato, validación, consumidor y cancelación son de producto.
registerHooks({
  resolve(spec, contexto, siguiente) {
    if (
      contexto.parentURL?.includes('/web/scripts/otro-dispositivo/recibir.js') &&
      spec === '../motor-local/cliente.js'
    ) {
      return { url: new URL('./motor-doble.ts', import.meta.url).href, shortCircuit: true };
    }
    return siguiente(spec, contexto);
  },
});
