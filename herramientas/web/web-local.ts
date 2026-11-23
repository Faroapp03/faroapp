import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { RUTAS } from '../../src/plataforma/node/rutas.ts';

/** La web local construida: `web/` es lo que se sirve y `construccion.json` dice de qué fuentes sale. */
export const WEB_LOCAL = join(RUTAS.raiz, '.web-local');
export const DESCRIPTOR_LOCAL = 'construccion.json';
/** Lo que lee la construcción: si cambia un byte de estas rutas, la web local ya no corresponde a las fuentes. */
const ENTRADAS_DE_LA_WEB = [
  'web',
  'src',
  'compartido',
  'motores',
  'datos',
  'herramientas/web',
  'herramientas/comun',
  'herramientas/cloudflare',
  'herramientas/publicar-paquete.ts',
  'plataforma_datos/ia_y_trabajo/fuentes/hechos_informe/registro.json',
  'tsconfig.navegador.json',
  'package.json',
  'package-lock.json',
] as const;
const IGNORADOS = /(^|\/)(\.DS_Store|__pycache__|node_modules)(\/|$)/;

/** Lo que la web local deja escrito junto a la web servida. */
export interface WebLocal {
  readonly web: string;
  readonly huellaDeFuentes: string;
  readonly huellaMapaModulos: string;
  readonly version: string;
}

/**
 * Huella del contenido de las entradas (rutas y bytes), no de sus fechas: una copia, un rsync o un checkout cambian las
 * fechas sin cambiar nada, y un cambio de bytes con la misma fecha también tiene que reconstruir.
 */
function archivosDeLaEntrada(raiz: string, entrada: string): string[] {
  const ruta = join(raiz, entrada);
  const estado = lstatSync(ruta, { throwIfNoEntry: false });
  if (!estado?.isDirectory()) {
    return estado?.isFile() ? [entrada] : [];
  }
  return readdirSync(ruta, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => relative(raiz, join(e.parentPath, e.name)).split(sep).join('/'))
    .filter((archivo) => !IGNORADOS.test(archivo))
    .sort();
}

export function huellaDeLasFuentes(raiz: string = RUTAS.raiz): string {
  const suma = createHash('sha256');
  for (const entrada of ENTRADAS_DE_LA_WEB) {
    for (const archivo of archivosDeLaEntrada(raiz, entrada)) {
      const bytes = readFileSync(join(raiz, archivo));
      suma.update(`${archivo}\0${createHash('sha256').update(bytes).digest('hex')}\n`);
    }
  }
  return suma.digest('hex');
}

/** La web local, si existe y salió de estas mismas fuentes; si no, undefined. */
export function webLocalVigente(
  destino: string = WEB_LOCAL,
  huella: string = huellaDeLasFuentes(),
): WebLocal | undefined {
  try {
    const leido = JSON.parse(readFileSync(join(destino, DESCRIPTOR_LOCAL), 'utf8')) as Omit<WebLocal, 'web'>;
    return leido.huellaDeFuentes === huella && lstatSync(join(destino, 'web')).isDirectory()
      ? { ...leido, web: join(destino, 'web') }
      : undefined;
  } catch {
    return undefined;
  }
}
