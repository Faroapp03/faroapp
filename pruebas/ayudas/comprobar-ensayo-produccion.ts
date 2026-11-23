/** Comprobación local del ensayo con los bytes de una entrega oficial; no contacta Cloudflare ni publica. */
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { comprobarEntrega, leerPerfil } from '../../herramientas/cloudflare/preparar-despliegue.ts';

/** Perfil completo y separado de producción, entrega oficial íntegra en dist/; devuelve el resumen del artefacto. */
export function comprobarEnsayoProduccion(raiz: string, huella: string) {
  leerPerfil(raiz);
  const { destino, ...resumen } = comprobarEntrega(join(raiz, 'dist'), huella, 'ensayo');
  assert.equal(destino, 'oficial', 'Se requiere artefacto oficial');
  return resumen;
}
