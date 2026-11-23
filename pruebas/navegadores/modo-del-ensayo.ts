/**
 * El modo del ensayo oficial de navegador sale del destino que declara la construcción (artefacto.json): ninguna opción
 * de la orden lo cambia ni lo contradice.
 */
import { CREDENCIALES_SINTETICAS } from './privado.ts';

/** Lo que el ensayo usa de su modo: el Basic sintético con que los contextos abren la puerta privada. */
export interface ModoDelEnsayo {
  readonly destino: 'privado';
  readonly credenciales: typeof CREDENCIALES_SINTETICAS;
}

/**
 * Por qué una construcción oficial no se ensaya aquí: su Worker exige el portal de acceso general (HTTPS, sesión y
 * límite de intentos con su autoridad durable), que este fixture HTTP no reproduce.
 */
export const MOTIVO_OFICIAL =
  'La construcción de destino oficial no se ensaya con ensayo.ts: su Worker exige el portal de acceso general, que ' +
  'este fixture HTTP no reproduce. Ensáyala con node pruebas/navegadores/portal-oficial-miniflare.mjs.';

/** La construcción no dice para qué destino se hizo: sin él, el ensayo no sabe qué Worker está probando. */
export const MOTIVO_SIN_DESTINO =
  'La construcción no declara su destino en artefacto.json: vuelve a construirla con herramientas/web/construir.ts.';

/**
 * El modo del ensayo para el destino de la construcción.
 *
 * @param destino - El campo `destino` de artefacto.json.
 * @returns El modo privado, con su Basic sintético.
 * @throws {Error} Si el destino es el oficial o la construcción no declara ninguno.
 */
export function modoDelEnsayo(destino: unknown): ModoDelEnsayo {
  if (destino === 'privado') {
    return { destino, credenciales: CREDENCIALES_SINTETICAS };
  }
  throw new Error(destino === 'oficial' ? MOTIVO_OFICIAL : MOTIVO_SIN_DESTINO);
}
