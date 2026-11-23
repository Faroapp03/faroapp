// Los grupos del censo de una ocupación. Cada estadística publica los grupos de la CNO-11 de 3 cifras que llegan a su
// mínimo de personas; si no publica el de la ocupación, se da su grupo de 2 cifras, más amplio, y el informe lo dice.
// Lo comparten las personas ocupadas (personas-ocupadas.ts) y el perfil del grupo (perfil-del-grupo.ts).

import type { Datos } from './tipos-paquete.ts';

/** Cifras de un grupo CNO-11 de tres cifras. */
const CIFRAS_DE3 = 3;
/** Cifras de un grupo CNO-11 de dos cifras. */
const CIFRAS_DE2 = 2;

/** Las cifras que publica una estadística a 3 cifras y a 2, y cuáles valen (llegan a su mínimo). */
export interface CifrasPorNivel<Cifras> {
  readonly de3: Readonly<Record<string, Cifras>>;
  readonly de2: Readonly<Record<string, Cifras>>;
  readonly vale: (cifras: Cifras) => boolean;
}

/** Un grupo con sus cifras. `amplio`: es el de 2 cifras, porque la estadística no da el de 3. */
export interface GrupoPublicado<Cifras> {
  codigo: string;
  amplio: boolean;
  cifras: Cifras;
}

/**
 * El grupo de 2 cifras al que pertenece un código de la CNO-11 de 3 o 4 cifras.
 *
 * @param datos - El paquete de datos.
 * @param codigo - El código CNO-11 de 3 o 4 cifras.
 * @returns El código de 2 cifras.
 */
export function grupoDe2(datos: Pick<Datos, 'clasificaciones'>, codigo: string): string {
  return datos.clasificaciones.cno11[codigo.slice(0, CIFRAS_DE3)]?.padre ?? codigo.slice(0, CIFRAS_DE2);
}

/** El grupo publicado de un código CNO-11 de 4 cifras: el de 3 cifras o, si no vale, el de 2; null si ninguno. */
function grupoPublicado<Cifras>(
  datos: Pick<Datos, 'clasificaciones'>,
  cno: string,
  cifras: CifrasPorNivel<Cifras>,
): GrupoPublicado<Cifras> | null {
  const de3 = cno.slice(0, CIFRAS_DE3);
  const cifrasDe3 = cifras.de3[de3];
  if (cifrasDe3 !== undefined && cifras.vale(cifrasDe3)) {
    return { codigo: de3, amplio: false, cifras: cifrasDe3 };
  }
  const de2 = grupoDe2(datos, cno);
  const cifrasDe2 = cifras.de2[de2];
  if (cifrasDe2 !== undefined && cifras.vale(cifrasDe2)) {
    return { codigo: de2, amplio: true, cifras: cifrasDe2 };
  }
  return null;
}

/**
 * Los grupos publicados de unos códigos CNO-11, en su orden y una sola vez: varios códigos pueden caer en el mismo. Si
 * un código cae en su grupo de 2 cifras y otro en un grupo de 3 que está dentro de ese, se da solo el de 2: con los
 * dos, las mismas personas se contarían dos veces.
 *
 * @param datos - El paquete de datos.
 * @param cnos - Los códigos CNO-11.
 * @param cifras - Las cifras por nivel.
 * @returns Los grupos publicados.
 */
export function gruposPublicados<Cifras>(
  datos: Pick<Datos, 'clasificaciones'>,
  cnos: readonly string[],
  cifras: CifrasPorNivel<Cifras>,
): GrupoPublicado<Cifras>[] {
  const porCodigo = new Map<string, GrupoPublicado<Cifras>>();
  for (const cno of cnos) {
    const grupo = grupoPublicado(datos, cno, cifras);
    if (grupo && !porCodigo.has(grupo.codigo)) {
      porCodigo.set(grupo.codigo, grupo);
    }
  }
  const grupos = [...porCodigo.values()];
  return grupos.filter(({ codigo, amplio }) => amplio || !porCodigo.has(grupoDe2(datos, codigo)));
}
