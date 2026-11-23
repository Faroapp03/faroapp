/** Comprobación local de una entrega oficial para producción; no contacta Cloudflare ni publica. */
import { comprobarEntrega, leerPerfil } from '../../herramientas/cloudflare/preparar-despliegue.ts';

/** Perfil completo y separado, todos los bytes y destino oficial; devuelve el resumen del artefacto. */
export function comprobarEntregaOficial(raiz: string, directorio: string, huella: string) {
  leerPerfil(raiz);
  const { destino: _destino, ...resumen } = comprobarEntrega(directorio, huella, 'produccion');
  return resumen;
}
