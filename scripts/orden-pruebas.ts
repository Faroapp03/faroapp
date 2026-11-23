/** Ordena las pruebas de las carpetas temáticas por su nombre de archivo, como si estuvieran en la raíz de `pruebas/`; las demás conservan su ruta. */
import { join, relative, sep } from 'node:path';

const CARPETAS = new Set([
  'acceso-publico',
  'administracion',
  'api',
  'cloudflare',
  'comun',
  'conectividad',
  'datos-dominio',
  'formacion',
  'herramientas',
  'informe',
  'motores',
  'paquetes',
  'plataforma',
  'seguridad',
]);
const PARTES = 3;

export function claveDePrueba(raiz: string, archivo: string): string {
  const partes = relative(raiz, archivo).split(sep);
  return partes.length === PARTES && partes[0] === 'pruebas' && CARPETAS.has(partes[1] ?? '')
    ? join(raiz, 'pruebas', partes[2] as string)
    : archivo;
}
