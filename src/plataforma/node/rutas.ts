// Rutas operativas de Faro en Node, calculadas desde el módulo y ajenas al directorio de trabajo.
import { fileURLToPath } from 'node:url';

/** Una carpeta de la instalación, absoluta y portable entre rutas con espacios o Unicode. */
function desdeAqui(relativa: string): string {
  return fileURLToPath(new URL(relativa, import.meta.url));
}

/** Solo las carpetas operativas del producto. */
export const RUTAS = {
  /** Raíz de la instalación; aquí se buscan los perfiles .dev.vars. */
  raiz: desdeAqui('../../../'),
  /** Código del motor. */
  codigo: desdeAqui('../../'),
  /** Paquete oficial de datos, con su manifiesto. */
  paquete: desdeAqui('../../../datos/'),
  /** Registro local de consumo sin contenido; no se versiona. */
  registro: desdeAqui('../../../registro/'),
  /** Web que sirve el servidor local. */
  web: desdeAqui('../../../web/'),
} as const;
