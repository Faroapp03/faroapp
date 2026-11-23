/** Identidad OIDC de GitHub sintética de los receptores de mantenimiento: confianza fijada y afirmaciones del token. */
import type { ConfianzaOidcGitHub } from '../../src/administracion/oidc-github.ts';
import { MS_POR_SEGUNDO } from '../../src/comun/tiempo.ts';

const TAM_SHA = 40;
export const AHORA_OIDC = Date.parse('2026-10-16T12:00:00Z');
export const VIDA_TOKEN_OIDC_S = 300;
export const ORIGEN_MANTENIMIENTO = 'https://mantenimiento.example';
export const CONFIANZA_MANTENIMIENTO: ConfianzaOidcGitHub = {
  audiencia: `${ORIGEN_MANTENIMIENTO}/mantenimiento/resultado`,
  repositorioId: '123',
  propietarioId: '456',
  ref: 'refs/heads/main',
  workflowRef: 'equipo/producto/.github/workflows/actualizar.yml@refs/heads/main',
  workflowSha: 'a'.repeat(TAM_SHA),
  sha: 'b'.repeat(TAM_SHA),
};

/** Afirmaciones válidas de un token emitido en `AHORA_OIDC` para `confianza`; cada prueba altera solo lo que comprueba. */
export function afirmacionesOidc(confianza: ConfianzaOidcGitHub) {
  return {
    iss: 'https://token.actions.githubusercontent.com',
    aud: confianza.audiencia,
    repository_id: confianza.repositorioId,
    repository_owner_id: confianza.propietarioId,
    ref: confianza.ref,
    workflow_ref: confianza.workflowRef,
    workflow_sha: confianza.workflowSha,
    sha: confianza.sha,
    run_id: '789',
    run_attempt: '1',
    jti: 'sintetico',
    iat: AHORA_OIDC / MS_POR_SEGUNDO,
    nbf: AHORA_OIDC / MS_POR_SEGUNDO,
    exp: AHORA_OIDC / MS_POR_SEGUNDO + VIDA_TOKEN_OIDC_S,
  };
}
