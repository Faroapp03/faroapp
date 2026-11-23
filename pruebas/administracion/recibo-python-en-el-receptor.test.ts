/**
 * Frontera entre el productor Python y el receptor TypeScript: un recibo v4 con estado v5, producido en Python con
 * datos inventados, atraviesa el token firmado, el almacén SQLite y la repetición. No ensaya el flujo remoto.
 */
import assert from 'node:assert/strict';
import { type ExecFileSyncOptions, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { type TestContext, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { leerEstadoDatosPanel } from '../../src/administracion/estado-datos.js';
import { crearReceptorInicioActualizacion } from '../../src/administracion/inicio-actualizacion.ts';
import { crearReceptorResultadoActualizacion } from '../../src/administracion/resultado-actualizacion.ts';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { crearAlmacenPublicoNode } from '../../src/plataforma/acceso-publico/node.ts';
import { abrirSesionDePrueba } from '../ayudas/sesion-de-prueba.ts';

const RAIZ = fileURLToPath(new URL('../..', import.meta.url));
const PYTHON = join(RAIZ, '.venv', 'bin', 'python');
const PRODUCTOR = join(RAIZ, 'pruebas', 'ayudas', 'recibo-sintetico-vigente.py');
const GUARDIA_DE_RED = join(RAIZ, 'scripts', 'sin_red');
const SIN_GUARDIA = 'La ayuda del recibo sintético exige la guardia de red de la batería';
const URL_RESULTADO = 'https://mantenimiento.example/mantenimiento/resultado';
const ORIGEN = 'https://mantenimiento.example';
const SOLICITUD = '11111111-1111-4111-8111-111111111111';
const LONGITUD_HUELLA = 64;
const LONGITUD_SHA = 40;
const VERSION_RECIBO = 4;
const VERSION_ESTADO = 5;
const RSA_BITS = 2048;
const MS_SEGUNDO = 1000;
const VIDA_TOKEN = 300;
const PLAZO_PRODUCTOR_MS = 30_000;
const MAX_SALIDA_PRODUCTOR_BYTES = 8_388_608; // 8 MiB
// La dan las fichas sintéticas de `test_abierta.documento()`, comprobadas el 2026-10-06, más 91 días
// (DIAS_DE_REVISION + 1); test_abierta.py la fija igual. No describe ninguna instalación real.
const REVISION_PENDIENTE_SINTETICA = '2027-01-05';
const ACCESO = { huellaSesion: 'a'.repeat(LONGITUD_HUELLA), huellaPrincipal: 'b'.repeat(LONGITUD_HUELLA) };
const CONFIANZA = {
  audiencia: URL_RESULTADO,
  repositorioId: '123',
  propietarioId: '456',
  ref: 'refs/heads/main',
  workflowRef: 'equipo/producto/.github/workflows/actualizar.yml@refs/heads/main',
  workflowSha: 'a'.repeat(LONGITUD_SHA),
  sha: 'b'.repeat(LONGITUD_SHA),
};
const ALGORITMO = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };

/** Un token OIDC con las afirmaciones de la confianza configurada, firmado con una clave nueva en cada prueba. */
async function tokenSintetico(ahora: number) {
  const par = await crypto.subtle.generateKey(
    { ...ALGORITMO, modulusLength: RSA_BITS, publicExponent: new Uint8Array([1, 0, 1]) },
    true,
    ['sign', 'verify'],
  );
  const jwk = { ...(await crypto.subtle.exportKey('jwk', par.publicKey)), kid: 'sintetica' };
  const afirmaciones = {
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
    jti: 'sintetico',
    iat: ahora / MS_SEGUNDO,
    nbf: ahora / MS_SEGUNDO,
    exp: ahora / MS_SEGUNDO + VIDA_TOKEN,
  };
  const codificar = (dato: object) => Buffer.from(JSON.stringify(dato)).toString('base64url');
  const texto = `${codificar({ alg: 'RS256', kid: jwk.kid })}.${codificar(afirmaciones)}`;
  const bytes = await crypto.subtle.sign(ALGORITMO, par.privateKey, new TextEncoder().encode(texto));
  return { jwk, token: `${texto}.${Buffer.from(bytes).toString('base64url')}` };
}

function peticion(url: string, token: string, texto: string): Request {
  return new Request(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: texto,
  });
}

/**
 * El entorno del productor, sin heredar el de la prueba: solo lo que Python necesita para importar el producto,
 * escribir sus temporales y quedar sin red. Así ninguna credencial del entorno llega al hijo.
 */
function entornoDelProductor(cambios: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? '',
    TMPDIR: realpathSync(tmpdir()),
    PYTHONPATH: [RAIZ, GUARDIA_DE_RED].join(delimiter),
    PYTHONDONTWRITEBYTECODE: '1',
    PYTHONUTF8: '1',
    FARO_PRUEBAS_SIN_RED: '1',
    ...cambios,
  };
}

/** Un bloqueo del hijo no puede detener la prueba ni llenar la memoria: plazo y salida máximos, con error claro. */
function opcionesDelProductor(entorno: NodeJS.ProcessEnv): ExecFileSyncOptions {
  return {
    cwd: RAIZ,
    env: entorno,
    encoding: 'utf8',
    timeout: PLAZO_PRODUCTOR_MS,
    killSignal: 'SIGKILL',
    maxBuffer: MAX_SALIDA_PRODUCTOR_BYTES,
    stdio: ['ignore', 'pipe', 'pipe'],
  };
}

async function preparar(t: TestContext) {
  const salida = String(execFileSync(PYTHON, [PRODUCTOR], opcionesDelProductor(entornoDelProductor()))).trim();
  const recibo = JSON.parse(salida);
  assert.equal(recibo.version, VERSION_RECIBO);
  assert.equal(recibo.estado.version, VERSION_ESTADO);
  assert.ok(recibo.catalogo);
  assert.equal(recibo.estado.formacionAbiertaRevisionPendiente, REVISION_PENDIENTE_SINTETICA);
  assert.equal(Object.hasOwn(recibo.estado, 'formacionAbiertaCaduca'), false);
  const ahora = Math.ceil(Date.parse(recibo.terminadoEn) / MS_SEGUNDO) * MS_SEGUNDO;
  const { jwk, token } = await tokenSintetico(ahora);
  const pedir: typeof fetch = async () => Response.json({ keys: [jwk] });
  const carpeta = mkdtempSync(join(realpathSync(tmpdir()), 'recibo-v3-v5-'));
  const base = crearAlmacenPublicoNode({ archivo: join(carpeta, 'panel.sqlite'), maxClientes: 1, ahora: () => ahora });
  t.after(() => {
    base.close();
    rmSync(carpeta, { recursive: true, force: true });
  });
  await base.sesion.prepararPanel({ version: 2, api: 'deshabilitada', mcp: false, a2a: false });
  await abrirSesionDePrueba(base.sesion, ACCESO);
  await base.trabajos.prepararTrabajos();
  const accion = 'reintentar-pendientes';
  await base.trabajos.reservarTrabajoDeSesion(
    ACCESO,
    { solicitudId: SOLICITUD, accion, revisionEsperada: 0 },
    CONFIANZA,
  );
  const recibirInicio = crearReceptorInicioActualizacion({
    origen: ORIGEN,
    almacen: base.trabajos,
    pedir,
    ahora: () => ahora,
  });
  const inicio = JSON.stringify({ solicitudId: SOLICITUD, revisionReserva: 1, accion });
  assert.equal(
    (await recibirInicio(peticion(`${ORIGEN}/mantenimiento/inicio`, token, inicio))).status,
    ESTADO_HTTP.correcto,
  );
  const recibir = crearReceptorResultadoActualizacion({
    origen: ORIGEN,
    almacen: base.trabajos,
    pedir,
    ahora: () => ahora,
  });
  return { salida, recibo, base, recibir, token };
}

test('el recibo Python v4 con estado v5 atraviesa el token, el almacén y la repetición sin admitir mezclas de versiones', async (t) => {
  const { salida, recibo, base, recibir, token } = await preparar(t);
  const antes = await base.trabajos.leerTrabajoPrivado();
  // Dos mezclas de versiones: v5 con el campo de la v4 añadido y v5 sin su propio campo.
  for (const estado of [
    { ...recibo.estado, formacionAbiertaCaduca: null },
    Object.fromEntries(
      Object.entries(recibo.estado).filter(([clave]) => clave !== 'formacionAbiertaRevisionPendiente'),
    ),
  ]) {
    assert.equal(
      (await recibir(peticion(URL_RESULTADO, token, JSON.stringify({ ...recibo, estado })))).status,
      ESTADO_HTTP.solicitudIncorrecta,
    );
    assert.deepEqual(await base.trabajos.leerTrabajoPrivado(), antes);
    assert.equal(await base.trabajos.leerDatosDelUltimoTrabajo(), null);
  }
  const aceptado = await recibir(peticion(URL_RESULTADO, token, salida));
  assert.equal(aceptado.status, ESTADO_HTTP.correcto);
  assert.deepEqual(await aceptado.json(), { estado: 'aplicado' });
  const observacion = await base.trabajos.leerDatosDelUltimoTrabajo();
  assert.ok(observacion);
  assert.equal(observacion.huellaRecibo, createHash('sha256').update(salida).digest('hex'));
  assert.deepEqual(observacion.catalogo, recibo.catalogo);
  const estado = leerEstadoDatosPanel(observacion.datos);
  assert.equal(estado.version, VERSION_ESTADO);
  // Estrecha el tipo a v5: el campo de revisión pendiente solo existe en esa versión.
  assert.ok(estado.version === VERSION_ESTADO);
  assert.equal(estado.formacionAbiertaRevisionPendiente, REVISION_PENDIENTE_SINTETICA);
  assert.deepEqual(estado, recibo.estado);
  const repetido = await recibir(peticion(URL_RESULTADO, token, salida));
  assert.equal(repetido.status, ESTADO_HTTP.correcto);
  assert.deepEqual(await repetido.json(), { estado: 'repetido' });
  assert.deepEqual(await base.trabajos.leerDatosDelUltimoTrabajo(), observacion);
  const trabajo = await base.trabajos.leerTrabajoPrivado();
  const cambiado = await recibir(peticion(URL_RESULTADO, token, `${salida}\n`));
  assert.equal(cambiado.status, ESTADO_HTTP.conflicto);
  assert.deepEqual(await base.trabajos.leerTrabajoPrivado(), trabajo);
  assert.deepEqual(await base.trabajos.leerDatosDelUltimoTrabajo(), observacion);
});

test('sin la guardia de red el productor sintético se detiene antes de cargar el producto', () => {
  const sinGuardia = entornoDelProductor({ FARO_PRUEBAS_SIN_RED: '0' });
  // `-X importtime` anota en la salida de errores cada módulo importado: ninguno puede ser del producto.
  assert.throws(
    () => execFileSync(PYTHON, ['-X', 'importtime', PRODUCTOR], opcionesDelProductor(sinGuardia)),
    (error: { status?: number; stdout?: string; stderr?: string }) => {
      const errores = String(error.stderr);
      return (
        error.status === 1 &&
        error.stdout === '' &&
        errores.includes(SIN_GUARDIA) &&
        // La traza existe: el propio guion cargó la guardia antes de rechazar el trabajo.
        /\|\s*guardia_red$/mu.test(errores) &&
        !errores.includes('plataforma_datos')
      );
    },
  );
});
