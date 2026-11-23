// Registro de los casos de una foto del paquete (scripts/fotos-del-paquete.ts). Cada caso comprueba antes que el paquete
// del árbol es el de la foto; si no lo es, falla diciendo eso y cómo regenerarla, en vez de con una cifra que no cuadra.
import { readFileSync } from 'node:fs';
import { type TestContext, test } from 'node:test';
import { REFERENCIA } from '../../web/scripts/catalogo-cursos/referencia.js';

const MANIFIESTO = new URL('../../datos/manifiesto.json', import.meta.url);

/** El paquete al que está fijada una foto y la orden que la regenera. */
export interface PaqueteDeLaFoto {
  /** La huella SHA-256 del catálogo de Cursos publicado (web/scripts/catalogo-cursos/referencia.js). */
  readonly catalogo: string;
  /** La huella de cada archivo de datos/ que la foto lee, tal como la fija datos/manifiesto.json. */
  readonly datos?: Readonly<Record<string, string>>;
  /** Qué hacer para que la foto vuelva a ser la del paquete del árbol. */
  readonly regenerar: string;
}

/** Las huellas del paquete del árbol para lo que declara una foto. */
function huellasDelArbol(foto: PaqueteDeLaFoto): { catalogo: string; datos: Record<string, string> } {
  const manifiesto = JSON.parse(readFileSync(MANIFIESTO, 'utf8')) as Record<string, { sha256?: string }>;
  const datos = Object.fromEntries(
    Object.keys(foto.datos ?? {}).map((archivo) => [archivo, manifiesto[archivo]?.sha256 ?? 'ausente']),
  );
  return { catalogo: REFERENCIA.sha256, datos };
}

/**
 * Exige que el paquete del árbol sea el de la foto.
 *
 * @param foto - El paquete declarado por la foto.
 * @throws {Error} Si alguna huella no coincide, con las huellas del árbol y la orden para regenerar la foto.
 */
export function exigirElPaqueteDeLaFoto(foto: PaqueteDeLaFoto): void {
  const arbol = huellasDelArbol(foto);
  const iguales =
    arbol.catalogo === foto.catalogo &&
    Object.entries(foto.datos ?? {}).every(([archivo, huella]) => arbol.datos[archivo] === huella);
  if (!iguales) {
    throw new Error(
      `Esta prueba es una foto del paquete con el catálogo ${foto.catalogo}${
        foto.datos ? ` y ${JSON.stringify(foto.datos)}` : ''
      }, y el paquete del árbol es otro (catálogo ${arbol.catalogo}${
        foto.datos ? ` y ${JSON.stringify(arbol.datos)}` : ''
      }). Sus cifras solo valen para aquel paquete. Si el cambio de datos es el esperado, regenera la foto: ${
        foto.regenerar
      }, y declara en ella las huellas del árbol.`,
    );
  }
}

/**
 * Registra los casos de una foto del paquete: es la marca que la aparta de la comprobación del ciclo.
 *
 * @param foto - El paquete al que está fijada y cómo regenerarla.
 * @returns Una función con la forma de test(nombre, caso) que comprueba el paquete antes de cada caso.
 */
export function fotoDelPaquete(
  foto: PaqueteDeLaFoto,
): (nombre: string, caso: (contexto: TestContext) => void | Promise<void>) => void {
  return (nombre, caso) => {
    test(nombre, (contexto) => {
      exigirElPaqueteDeLaFoto(foto);
      return caso(contexto);
    });
  };
}
