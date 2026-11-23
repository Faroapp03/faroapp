/**
 * Las salidas del Worker en workerd de verdad: Miniflare arranca workerd en este equipo, sin red, con el código real
 * empaquetado, y un servicio de salida simulado responde a cada petición. Acredita que el despacho a GitHub, la
 * consulta de la ejecución, las claves OIDC y el aviso del vigilante funcionan con una respuesta normal y rechazan una
 * redirección con la clasificación de cada llamador. Con el modo `error` de `redirect`, workerd rechaza la petición
 * antes de enviarla y todas fallarían.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const requerir = createRequire(import.meta.url);
const HTTP_CORRECTO = 200;
const ESTADO_REDIRECCION = 302;
const RSA_BITS = 2048;
const VIDA_S = 300;
const MS_POR_S = 1000;
const TAM_SHA = 40;
const modulo = (ruta: string) => JSON.stringify(fileURLToPath(new URL(`../../src/${ruta}`, import.meta.url)));
const CONFIANZA = {
  audiencia: 'https://panel.example/mantenimiento/resultado',
  repositorioId: '101',
  propietarioId: '102',
  ref: 'refs/heads/main',
  workflowRef: 'entidad/herramienta/.github/workflows/actualizar.yml@refs/heads/main',
  sha: 'c'.repeat(TAM_SHA),
  workflowSha: 'd'.repeat(TAM_SHA),
};
const TRABAJO = {
  solicitudId: 'a3904d28-7ff8-41cc-b7d8-1ced941cf011',
  revisionReserva: 1,
  revisionBase: 0,
  accion: 'actualizar-datos',
  creadoEn: 1_000,
  actualizadoEn: 2_000,
  estado: 'despachado',
  runId: '123',
  runAttempt: '1',
  resultado: null,
  huellaRecibo: null,
  protocoloInicio: 'obligatorio',
  inicioConfirmado: true,
  confianza: CONFIANZA,
};
const RUN = {
  id: 123,
  run_attempt: 1,
  event: 'workflow_dispatch',
  head_sha: CONFIANZA.sha,
  path: '.github/workflows/actualizar.yml',
  status: 'completed',
  conclusion: 'success',
  repository: { id: 101, owner: { id: 102 } },
};
const DESPACHO = {
  workflow_run_id: 789,
  run_url: 'https://api.github.com/repos/entidad/herramienta/actions/runs/789',
  html_url: 'https://github.com/entidad/herramienta/actions/runs/789',
};

/** El Worker de ensayo: ejecuta la salida que pide la ruta con el `fetch` de workerd y devuelve su resultado. */
const ENTRADA = `
import { crearConsultorEjecucionGitHub } from ${modulo('administracion/consulta-ejecucion-github.ts')};
import { crearDespachadorGitHub } from ${modulo('administracion/ejecutor-github.ts')};
import { enviarAviso } from ${modulo('administracion/envio-aviso.ts')};
import { crearVerificadorOidcGitHub } from ${modulo('administracion/oidc-github.ts')};
import { pedirSinRedirecciones } from ${modulo('comun/salida-sin-redirecciones.ts')};
const CONFIANZA = ${JSON.stringify(CONFIANZA)};
const TRABAJO = ${JSON.stringify(TRABAJO)};
const senal = () => new AbortController().signal;
const SALIDAS = {
  comun: async () => {
    try {
      const respuesta = await pedirSinRedirecciones('https://salida.example/comun');
      return 'respuesta ' + respuesta.status;
    } catch (error) {
      return 'rechazada · ' + error.name;
    }
  },
  despacho: async () => {
    const despachar = crearDespachadorGitHub({
      destino: { propietario: 'entidad', repositorio: 'herramienta', workflow: 'actualizar.yml', ref: 'main' },
      obtenerToken: async () => 'token-sintetico',
    });
    const solicitud = { solicitudId: TRABAJO.solicitudId, accion: 'actualizar-datos', revisionReserva: 1 };
    return (await despachar(solicitud, senal())).estado;
  },
  consulta: async () => {
    const consultar = crearConsultorEjecucionGitHub({ obtenerToken: async () => 'token-sintetico' });
    return (await consultar(TRABAJO, senal())).estado;
  },
  oidc: async (peticion) => {
    const verificar = crearVerificadorOidcGitHub(CONFIANZA);
    const identidad = await verificar(await peticion.text());
    return identidad ? 'run ' + identidad.runId : 'sin identidad';
  },
  aviso: async () => {
    const envio = await enviarAviso(new URL('https://avisos.example/faro'), { version: 1, tipo: 'nuevo' });
    return envio.resultado === 'enviado' ? 'enviado' : 'fallido · ' + envio.motivo;
  },
};
export default {
  async fetch(peticion) {
    const salida = SALIDAS[new URL(peticion.url).pathname.slice(1)];
    try {
      return Response.json({ resultado: await salida(peticion) });
    } catch (error) {
      return Response.json({ error: String(error && error.message) }, { status: 500 });
    }
  },
};
`;

async function empaquetar(): Promise<string> {
  const { build } = requerir('esbuild') as typeof import('esbuild');
  const salida = await build({
    stdin: { contents: ENTRADA, loader: 'js', resolveDir: fileURLToPath(new URL('../../', import.meta.url)) },
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: 'es2024',
    write: false,
    logLevel: 'silent',
  });
  return salida.outputFiles[0]?.text ?? '';
}
/** Un par RSA sintético: la clave pública la sirve el servicio simulado y la privada firma el token de la prueba. */
async function credencialesOidc() {
  const algoritmo = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
  const par = await crypto.subtle.generateKey(
    { ...algoritmo, modulusLength: RSA_BITS, publicExponent: new Uint8Array([1, 0, 1]) },
    true,
    ['sign', 'verify'],
  );
  const jwk = { ...(await crypto.subtle.exportKey('jwk', par.publicKey)), kid: 'sintetica' };
  const ahora = Math.floor(Date.now() / MS_POR_S);
  const contenido = {
    iss: 'https://token.actions.githubusercontent.com',
    aud: CONFIANZA.audiencia,
    repository_id: CONFIANZA.repositorioId,
    repository_owner_id: CONFIANZA.propietarioId,
    ref: CONFIANZA.ref,
    workflow_ref: CONFIANZA.workflowRef,
    workflow_sha: CONFIANZA.workflowSha,
    sha: CONFIANZA.sha,
    run_id: '789',
    run_attempt: '1',
    jti: 'id-sintetico',
    iat: ahora,
    nbf: ahora,
    exp: ahora + VIDA_S,
  };
  const codificar = (valor: unknown) => Buffer.from(JSON.stringify(valor)).toString('base64url');
  const partes = `${codificar({ alg: 'RS256', kid: 'sintetica', typ: 'JWT' })}.${codificar(contenido)}`;
  const firma = await crypto.subtle.sign(algoritmo, par.privateKey, new TextEncoder().encode(partes));
  return { jwk, token: `${partes}.${Buffer.from(firma).toString('base64url')}` };
}
/** Lo que responde el servicio de salida a cada dirección cuando no redirige. */
function respuestasNormales(jwk: object): Record<string, () => unknown> {
  return {
    'https://salida.example/comun': () => ({ cuerpo: 'correcto' }),
    'https://api.github.com/repos/entidad/herramienta/actions/workflows/actualizar.yml/dispatches': () => DESPACHO,
    'https://api.github.com/repos/entidad/herramienta/actions/runs/123/attempts/1': () => RUN,
    'https://token.actions.githubusercontent.com/.well-known/jwks': () => ({ keys: [jwk] }),
    'https://avisos.example/faro': () => null,
  };
}
const ESPERADO = {
  comun: { normal: `respuesta ${HTTP_CORRECTO}`, redirige: 'rechazada · RedireccionRechazada' },
  // Con la petición ya enviada, una redirección deja el despacho incierto, nunca «sin efecto».
  despacho: { normal: 'despachada', redirige: 'incierta' },
  consulta: { normal: 'completada', redirige: 'no-disponible' },
  oidc: { normal: 'run 789', redirige: 'sin identidad' },
  aviso: { normal: 'enviado', redirige: 'fallido · respuesta-no-admitida' },
};

test('en workerd, cada salida del Worker funciona con una respuesta normal y rechaza una redirección', async () => {
  const { Miniflare, Response: RespuestaMiniflare, convertV4MiniflareOptions } = requerir('miniflare');
  const { jwk, token } = await credencialesOidc();
  const normales = respuestasNormales(jwk);
  const estado = { redirige: false, pedidas: [] as string[] };
  const miniflare = new Miniflare(
    convertV4MiniflareOptions({
      name: 'salidas',
      modules: true,
      compatibilityDate: '2026-10-01',
      script: await empaquetar(),
      outboundService: (peticion: Request) => {
        estado.pedidas.push(peticion.url);
        if (estado.redirige) {
          return new RespuestaMiniflare(null, {
            status: ESTADO_REDIRECCION,
            headers: { location: 'https://otro.example/' },
          });
        }
        const cuerpo = normales[peticion.url]?.();
        return cuerpo === null ? new RespuestaMiniflare(null, { status: 204 }) : RespuestaMiniflare.json(cuerpo);
      },
    }),
  );
  try {
    // La redirección va primero: las claves OIDC se guardan en memoria tras la primera descarga correcta.
    for (const modo of ['redirige', 'normal'] as const) {
      estado.redirige = modo === 'redirige';
      for (const [salida, esperado] of Object.entries(ESPERADO)) {
        estado.pedidas = [];
        const respuesta = await miniflare.dispatchFetch(`http://localhost/${salida}`, {
          method: 'POST',
          body: salida === 'oidc' ? token : '',
        });
        const cuerpo = (await respuesta.json()) as { resultado?: string; error?: string };
        assert.equal(respuesta.status, HTTP_CORRECTO, `${salida}: ${cuerpo.error ?? ''}`);
        assert.equal(cuerpo.resultado, esperado[modo], `${salida}, ${modo}`);
        assert.equal(estado.pedidas.length, 1, `${salida}, ${modo}: una sola petición, sin seguir la redirección`);
      }
    }
  } finally {
    await miniflare.dispose();
  }
});
