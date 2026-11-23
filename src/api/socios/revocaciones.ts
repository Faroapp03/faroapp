/** Revocaciones persistentes hasta caducidad; un identificador retirado no vuelve a ser válido tras reiniciar. */
/** Suelo de capacidad persistente; el almacén puede ampliarlo según el límite de instituciones.
 * Al llenarse nunca se descartan identificadores revocados que aún no han caducado.
 */
export const MAX_REVOCADOS = 4000;

/** Dónde se recuerdan los tokens revocados. */
export interface RevocacionesDeTokens {
  /** Recuerda el token hasta caducaS (segundos Unix); repetir no acorta la fecha. Lanza RevocacionesLlenas si no cabe otro. */
  revocar(jti: string, caducaS: number): Promise<void>;
  /** Si el token está revocado. */
  revocado(jti: string): Promise<boolean>;
}

/** No cabe otra revocación: se responde 503, y RFC 7009 (2.2.1) pide al socio que dé el token por vivo y repita. */
export class RevocacionesLlenas extends Error {
  override readonly name = 'RevocacionesLlenas';
}
