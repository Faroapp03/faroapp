/** Principal de prueba tal como lo entrega la guardia de Access tras verificar el JWT: con correo y emisión. */
import type { PrincipalAdministrativo } from '../../src/plataforma/acceso-administrativo.ts';

/** Cada sujeto sintético tiene su propio correo, así que dos personas de prueba siguen siendo distintas. */
export function principalDePrueba(
  emisor: string,
  sujeto: string,
  correo: string | null = `${sujeto}@faro.invalid`.toLowerCase(),
  emitidoEn: number | null = 1,
): PrincipalAdministrativo {
  return { emisor, sujeto, correo, emitidoEn, segundoFactor: false };
}
/** El mismo principal cuando su JWT declara en `amr` un segundo factor. */
export function principalConSegundoFactor(emisor: string, sujeto: string): PrincipalAdministrativo {
  return { ...principalDePrueba(emisor, sujeto), segundoFactor: true };
}
