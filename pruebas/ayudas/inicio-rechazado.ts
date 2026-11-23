/** Reserva, receptor de inicio y tokens OIDC sintéticos para las pruebas del inicio rechazado; sin red. */
import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import {
  crearReceptorInicioActualizacion,
  type EnSegundoPlano,
} from '../../src/administracion/inicio-actualizacion.ts';
import type { ConfianzaOidcGitHub } from '../../src/administracion/oidc-github.ts';
import { MS_POR_SEGUNDO } from '../../src/comun/tiempo.ts';
import { prepararVigilanteSqlite } from '../../src/plataforma/acceso-publico/vigilante-sqlite.ts';
import { conDesafio } from './desafio.ts';
import { abrirSesionDePrueba } from './sesion-de-prueba.ts';
import { baseVigilante, CONFIANZA_VIGILANTE, CONFIG_VIGILANTE, CORTE_VIGILANTE } from './vigilante.ts';

export const ORIGEN_INICIO = 'https://mantenimiento.example';
export const ID_RESERVA = '11111111-1111-4111-8111-111111111111';
export const INICIO_RESERVA = { solicitudId: ID_RESERVA, revisionReserva: 1, accion: 'actualizar-datos' } as const;
const CIFRAS_HUELLA = 64;
const CIFRAS_SHA = 40;
const RSA_BITS = 2048;
const VIDA_TOKEN_S = 300;
export const ACCESO_RESERVA = { huellaSesion: 'a'.repeat(CIFRAS_HUELLA), huellaPrincipal: 'b'.repeat(CIFRAS_HUELLA) };
export const OTRA_REVISION = 'c'.repeat(CIFRAS_SHA);
const ALGORITMO = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };

async function firmante() {
  const par = await crypto.subtle.generateKey(
    { ...ALGORITMO, modulusLength: RSA_BITS, publicExponent: new Uint8Array([1, 0, 1]) },
    true,
    ['sign', 'verify'],
  );
  const jwk = { ...(await crypto.subtle.exportKey('jwk', par.publicKey)), kid: 'sintetica' };
  const firmar = async (contenido: Record<string, unknown>) => {
    const cabecera = Buffer.from(JSON.stringify({ alg: 'RS256', kid: jwk.kid })).toString('base64url');
    const texto = `${cabecera}.${Buffer.from(JSON.stringify(contenido)).toString('base64url')}`;
    const firma = await crypto.subtle.sign(ALGORITMO, par.privateKey, new TextEncoder().encode(texto));
    return `${texto}.${Buffer.from(firma).toString('base64url')}`;
  };
  return { jwk, firmar };
}
/** Las claves que publica el JWKS de la prueba y otras que nadie publica. */
export const CLAVES_GITHUB = firmante();
export const CLAVES_AJENAS = firmante();

/** Afirmaciones de un run de este repositorio emitidas en `emitidoEn` (por defecto, el corte de la prueba). */
export function afirmaciones(
  confianza: ConfianzaOidcGitHub,
  cambios: Record<string, unknown> = {},
  emitidoEn = CORTE_VIGILANTE,
) {
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
    iat: emitidoEn / MS_POR_SEGUNDO,
    nbf: emitidoEn / MS_POR_SEGUNDO,
    exp: emitidoEn / MS_POR_SEGUNDO + VIDA_TOKEN_S,
    ...cambios,
  };
}
/** Un run de este repositorio firmado para otra revisión del código. */
export function otraRevision(cambios: Record<string, unknown> = {}, emitidoEn = CORTE_VIGILANTE) {
  return afirmaciones(CONFIANZA_VIGILANTE, { sha: OTRA_REVISION, ...cambios }, emitidoEn);
}

/** Vigilante preparado, sesión abierta y una reserva nueva que espera su permiso de inicio. */
export async function reservaQueEsperaInicio(t: TestContext, avisarRechazo?: () => Promise<void>) {
  const f = await baseVigilante(t);
  prepararVigilanteSqlite(f.sql, CONFIG_VIGILANTE, f.reloj.ahora);
  await abrirSesionDePrueba(f.almacen, ACCESO_RESERVA);
  const reserva = await f.almacen.reservarTrabajoDeSesion(
    ACCESO_RESERVA,
    { solicitudId: ID_RESERVA, accion: 'actualizar-datos', revisionEsperada: 0 },
    CONFIANZA_VIGILANTE,
  );
  assert.equal(reserva.estado, 'nueva');
  const { jwk } = await CLAVES_GITHUB;
  const pedir: typeof fetch = async () => Response.json({ keys: [jwk] });
  const opciones = { origen: ORIGEN_INICIO, almacen: f.almacen, pedir, ahora: () => f.reloj.ahora };
  const recibir = conDesafio(
    crearReceptorInicioActualizacion(avisarRechazo ? { ...opciones, avisarRechazo } : opciones),
    'Bearer',
  );
  const pedirInicio = async (token: string, enSegundoPlano?: EnSegundoPlano) => {
    const peticion = new Request(`${ORIGEN_INICIO}/mantenimiento/inicio`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(INICIO_RESERVA),
    });
    const respuesta = await recibir(peticion, enSegundoPlano);
    return {
      estado: respuesta.status,
      cuerpo: await respuesta.json(),
      desafio: respuesta.headers.get('www-authenticate'),
    };
  };
  return { ...f, pedirInicio };
}
