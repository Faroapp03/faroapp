/**
 * Análisis puro de los píxeles de la senyera: en la columna central, de arriba abajo, deben verse cuatro franjas rojas
 * separadas por amarillo. Se toleran el borde y el fondo en los extremos y las filas de mezcla rojo-amarillo que deja
 * el suavizado entre franjas; no se admiten blanco ni otro color dentro de la bandera.
 */

/** Píxeles RGBA en filas, como los de ImageData. */
export interface ImagenRgba {
  readonly ancho: number;
  readonly alto: number;
  readonly datos: ArrayLike<number>;
}

/** Resultado del análisis: la secuencia de franjas vista y, si no es la senyera, el motivo. */
export interface AnalisisSenyera {
  readonly valida: boolean;
  readonly franjas: string;
  readonly motivo: string;
}

type Clase = 'R' | 'A' | 'T' | 'X';

const COMPONENTES = 4;
const FRANJAS_ROJAS = 4;
/** Filas de mezcla seguidas que admite el suavizado entre dos franjas; más serían una franja naranja. */
const MAX_FILAS_DE_MEZCLA = 2;
const ROJO_MIN_R = 150;
const ROJO_MAX_G = 70;
const AMARILLO_MIN_R = 200;
const AMARILLO_MIN_G = 150;
const CALIDO_MAX_B = 90;

/** Rojo, amarillo, mezcla de ambos por suavizado o ajeno (borde, fondo, blanco u otro color). */
function clasificar(r: number, g: number, b: number): Clase {
  if (b >= CALIDO_MAX_B || r < ROJO_MIN_R) {
    return 'X';
  }
  if (g <= ROJO_MAX_G) {
    return 'R';
  }
  if (r >= AMARILLO_MIN_R && g >= AMARILLO_MIN_G) {
    return 'A';
  }
  return 'T';
}

function columnaCentral(imagen: ImagenRgba): Clase[] {
  const x = Math.floor(imagen.ancho / 2);
  return Array.from({ length: imagen.alto }, (_, y) => {
    const i = (y * imagen.ancho + x) * COMPONENTES;
    return clasificar(Number(imagen.datos[i]), Number(imagen.datos[i + 1]), Number(imagen.datos[i + 2]));
  });
}

/** Junta filas iguales consecutivas en tramos. */
function tramos(clases: readonly Clase[]): { clase: Clase; filas: number }[] {
  const resultado: { clase: Clase; filas: number }[] = [];
  for (const clase of clases) {
    const ultimo = resultado.at(-1);
    if (ultimo?.clase === clase) {
      ultimo.filas += 1;
    } else {
      resultado.push({ clase, filas: 1 });
    }
  }
  return resultado;
}

function rechazo(franjas: string, motivo: string): AnalisisSenyera {
  return { valida: false, franjas, motivo };
}

/**
 * Comprueba que la imagen muestra la senyera: cuatro franjas rojas separadas por amarillo.
 *
 * @param imagen - Píxeles RGBA de la captura del elemento.
 * @returns Si es válida, la secuencia de franjas (R rojo, A amarillo) y el motivo del rechazo.
 */
export function analizarSenyera(imagen: ImagenRgba): AnalisisSenyera {
  if (imagen.datos.length !== imagen.ancho * imagen.alto * COMPONENTES || imagen.alto === 0) {
    return rechazo('', 'los datos no corresponden a una imagen RGBA del tamaño indicado');
  }
  const clases = columnaCentral(imagen);
  const primera = clases.findIndex((clase) => clase !== 'X');
  const ultima = clases.findLastIndex((clase) => clase !== 'X');
  const interior = primera < 0 ? [] : clases.slice(primera, ultima + 1);
  if (interior.includes('X')) {
    return rechazo(interior.join(''), 'dentro de la bandera hay un color que no es rojo ni amarillo');
  }
  const lista = tramos(interior);
  const mezclaLarga = lista.find(({ clase, filas }) => clase === 'T' && filas > MAX_FILAS_DE_MEZCLA);
  if (mezclaLarga) {
    return rechazo(interior.join(''), `hay ${mezclaLarga.filas} filas seguidas de mezcla: no es suavizado`);
  }
  // El suavizado solo mezcla un rojo con un amarillo vecinos; una mezcla entre dos franjas del mismo color es una
  // franja estrecha del otro color que no llega a verse pura.
  const franjaOculta = lista.some(
    ({ clase }, i) => clase === 'T' && i > 0 && i < lista.length - 1 && lista[i - 1]?.clase === lista[i + 1]?.clase,
  );
  if (franjaOculta) {
    return rechazo(interior.join(''), 'una mezcla separa dos franjas del mismo color: hay franjas de más');
  }
  const franjas = tramos(interior.filter((clase) => clase !== 'T'))
    .map(({ clase }) => clase)
    .join('');
  const rojas = franjas.replaceAll('A', '').length;
  const nucleo = franjas.replace(/^A/, '').replace(/A$/, '');
  if (rojas !== FRANJAS_ROJAS || nucleo !== 'RARARAR') {
    return rechazo(franjas, `se ven ${rojas} franjas rojas; la senyera tiene ${FRANJAS_ROJAS} separadas por amarillo`);
  }
  return { valida: true, franjas, motivo: '' };
}
