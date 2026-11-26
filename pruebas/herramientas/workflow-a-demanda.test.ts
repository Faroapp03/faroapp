import assert from 'node:assert/strict';
import { type SpawnSyncReturns, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { parseDocument } from 'yaml';

const ARCHIVO = new URL('../../.github/workflows/actualizar.yml', import.meta.url);
const PYTHON = fileURLToPath(new URL('../../.venv/bin/python', import.meta.url));
const RESERVA = 'Pedir la reserva a demanda';
const ORDEN_RESERVA = '/usr/bin/python3 -I plataforma_datos/orquestacion/reserva_a_demanda.py';
const GRUPO_MANUAL = 'faro-actualizar-manual';
const SOLICITUD_SERVIDOR = '12345678-1234-4234-8234-123456789abc';
const SOLICITUD_DEMANDA = '22222222-2222-4222-8222-222222222222';
const PLAZO_MS = 10_000;
const SIN_OIDC = { ACTIONS_ID_TOKEN_REQUEST_URL: '', ACTIONS_ID_TOKEN_REQUEST_TOKEN: '' };

function objeto(entrada: unknown): Record<string, unknown> {
  assert.ok(entrada !== null && typeof entrada === 'object' && !Array.isArray(entrada));
  return entrada as Record<string, unknown>;
}
function texto(entrada: unknown): string {
  assert.equal(typeof entrada, 'string');
  return entrada as string;
}
function workflow() {
  const documento = parseDocument(readFileSync(ARCHIVO, 'utf8'), { uniqueKeys: true });
  assert.deepEqual(documento.errors, []);
  const raiz = objeto(documento.toJS());
  const jobs = objeto(raiz.jobs);
  const candidato = objeto(jobs.candidato);
  const activacion = objeto(jobs.activacion);
  assert.ok(Array.isArray(candidato.steps) && Array.isArray(activacion.steps));
  const construccion = candidato.steps.map(objeto);
  const publicacion = activacion.steps.map(objeto);
  return { raiz, candidato, activacion, construccion, publicacion, pasos: [...construccion, ...publicacion] };
}
function porNombre(pasos: Array<Record<string, unknown>>, nombre: string): Record<string, unknown> {
  const encontrado = pasos.find((p) => p.name === nombre);
  assert.ok(encontrado, nombre);
  return encontrado;
}
function envDelPaso(p: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(objeto(p.env ?? {})).map(([k, v]) => [k, texto(v)]));
}
/** Evalúa una expresión `${{ … }}` con los operadores que comparte con JavaScript y la función `format`. */
function evaluar(valor: unknown, contexto: Record<string, unknown>): unknown {
  const expresion = /^\$\{\{\s*([\s\S]+?)\s*\}\}$/.exec(texto(valor))?.[1];
  assert.ok(expresion, String(valor));
  const format = (plantilla: string, ...valores: unknown[]) =>
    plantilla.replace(/\{(\d+)\}/g, (_, i: string) => String(valores[Number(i)]));
  return runInNewContext(expresion, { ...contexto, format });
}
function bash(guion: string, env: NodeJS.ProcessEnv) {
  return spawnSync('/bin/bash', ['--noprofile', '--norc', '-euo', 'pipefail', '-c', guion], {
    env,
    encoding: 'utf8',
    timeout: PLAZO_MS,
  });
}
function carpeta(t: { after: (f: () => void) => void }, nombre: string): string {
  const ruta = mkdtempSync(join(realpathSync(tmpdir()), `${nombre} `));
  t.after(() => rmSync(ruta, { recursive: true, force: true }));
  return ruta;
}

const SERVIDOR = { a_demanda: false, ensayo: 'ninguno', solicitud_id: SOLICITUD_SERVIDOR, revision_reserva: '7' };
const DEMANDA = { a_demanda: true, ensayo: 'ninguno', solicitud_id: '', revision_reserva: '' };

test('un run a demanda se pide con una entrada booleana, apagada por defecto, y con las acciones ligeras', () => {
  const inputs = objeto(objeto(objeto(workflow().raiz.on).workflow_dispatch).inputs);
  assert.deepEqual(objeto(inputs.a_demanda), {
    description: texto(objeto(inputs.a_demanda).description),
    type: 'boolean',
    default: false,
  });
  const acciones = objeto(inputs.accion).options;
  assert.ok(Array.isArray(acciones));
  for (const accion of ['actualizar-datos', 'actualizar-cursos', 'comprobar-vencidas']) {
    assert.ok(acciones.includes(accion), accion);
  }
});

test('el primer paso detiene un run a demanda con reserva del servidor o con ensayo y deja anotado su inicio', (t) => {
  const { construccion, publicacion } = workflow();
  const inicio = construccion[0];
  assert.ok(inicio);
  assert.deepEqual(publicacion[0], inicio);
  assert.deepEqual(envDelPaso(inicio), {
    ENTRADA_A_DEMANDA: `\${{ inputs.a_demanda }}`,
    ENTRADA_ACCION: `\${{ inputs.accion }}`,
    ENTRADA_ENSAYO: `\${{ inputs.ensayo }}`,
    ENTRADA_REANUDAR: `\${{ inputs.reanudar_entradas }}`,
    ENTRADA_SOLICITUD_ID: `\${{ inputs.solicitud_id }}`,
    ENTRADA_REVISION_RESERVA: `\${{ inputs.revision_reserva }}`,
    REPOSITORIO_EN_PARALELO: `\${{ vars.FARO_FUENTES_EN_PARALELO }}`,
    ...SIN_OIDC,
  });
  const runner = carpeta(t, 'primer paso');
  const marcador = join(runner, 'inyectado');
  const hostil = `$(touch '${marcador}')`;
  const casos = [
    [{ ...SERVIDOR }, 0],
    [{ ...SERVIDOR, ensayo: 'simular', solicitud_id: hostil }, 0],
    [{ ...DEMANDA }, 0],
    [{ ...DEMANDA, ensayo: '' }, 0],
    [{ ...DEMANDA, ensayo: 'preparar' }, 1],
    [{ ...DEMANDA, ensayo: 'simular' }, 1],
    [{ ...DEMANDA, solicitud_id: hostil }, 1],
    [{ ...DEMANDA, revision_reserva: '7' }, 1],
  ] as const;
  for (const [entradas, salida] of casos) {
    rmSync(join(runner, 'inicio-del-job'), { force: true });
    const r = bash(texto(inicio.run), {
      PATH: '/usr/bin:/bin',
      RUNNER_TEMP: runner,
      ENTRADA_A_DEMANDA: String(entradas.a_demanda),
      ENTRADA_REANUDAR: 'false',
      ENTRADA_ENSAYO: entradas.ensayo,
      ENTRADA_SOLICITUD_ID: entradas.solicitud_id,
      ENTRADA_REVISION_RESERVA: entradas.revision_reserva,
    });
    assert.equal(r.status, salida, JSON.stringify(entradas));
    assert.equal(r.stdout.startsWith('::error title=Faro · entradas::'), salida === 1);
    assert.ok(existsSync(join(runner, 'inicio-del-job')));
  }
  assert.equal(existsSync(marcador), false);
});

test('la reserva se pide antes de preparar las herramientas, solo a demanda y con Python aislado', () => {
  const { candidato, construccion, publicacion } = workflow();
  const indice = construccion.findIndex((p) => p.name === RESERVA);
  assert.equal(construccion[indice - 1]?.name, 'Recuperar el commit del evento');
  assert.equal(construccion[indice + 1]?.id, 'herramientas');
  assert.ok(publicacion.every((p) => p.name !== RESERVA));
  const reserva = porNombre(construccion, RESERVA);
  assert.equal(reserva.id, 'reserva');
  assert.equal(reserva.run, ORDEN_RESERVA);
  assert.equal(reserva['timeout-minutes'], 1);
  assert.deepEqual(envDelPaso(reserva), {
    FARO_ACCION: `\${{ inputs.accion }}`,
    FARO_ACTUALIZACION_ORIGEN: `\${{ vars.FARO_ACTUALIZACION_ORIGEN }}`,
  });
  for (const [inputs, corre] of [
    [SERVIDOR, false],
    [DEMANDA, true],
  ] as const) {
    assert.equal(evaluar(reserva.if, { inputs }), corre);
  }
  assert.deepEqual(candidato.outputs, {
    solicitud_id: `\${{ steps.reserva.outputs.solicitud_id }}`,
    revision_reserva: `\${{ steps.reserva.outputs.revision_reserva }}`,
    resultado_ciclo: `\${{ steps.ciclo.outputs.resultado_ciclo }}`,
  });
});

test('la construcción y la activación usan la reserva del servidor o la que el run pidió a demanda', () => {
  const { construccion, publicacion } = workflow();
  const construir = envDelPaso(porNombre(construccion, 'Construir y conservar el candidato'));
  const activar = envDelPaso(porNombre(publicacion, 'Activar o recuperar el candidato conservado'));
  const salidas = { solicitud_id: SOLICITUD_DEMANDA, revision_reserva: '9' };
  const casos = [
    [SERVIDOR, salidas, [SOLICITUD_SERVIDOR, '7']],
    [DEMANDA, salidas, [SOLICITUD_DEMANDA, '9']],
    // Sin salidas del candidato, la activación consulta la reserva de su run.
    [DEMANDA, { solicitud_id: '', revision_reserva: '' }, ['', '']],
  ] as const;
  for (const [inputs, outputs, esperado] of casos) {
    const contexto = { inputs, steps: { reserva: { outputs } }, needs: { candidato: { outputs } } };
    for (const env of [construir, activar]) {
      assert.deepEqual(
        [evaluar(env.FARO_SOLICITUD_ID, contexto), evaluar(env.FARO_REVISION_RESERVA, contexto)],
        esperado,
      );
    }
  }
  assert.equal(activar.FARO_A_DEMANDA, `\${{ inputs.a_demanda }}`);
  // La consulta de la reserva envía la acción del run: le llega por el entorno, nunca escrita dentro de la orden.
  assert.equal(activar.FARO_ACCION, `\${{ inputs.accion }}`);
  const orden = texto(porNombre(publicacion, 'Activar o recuperar el candidato conservado').run);
  assert.ok(orden.includes('reserva_del_run(os.environ)') && !orden.includes(`\${{`));
});

const SONDA_CONSULTA = `import json, os, subprocess, sys, types
falso = types.ModuleType('plataforma_datos.orquestacion.reserva_a_demanda')
class ReservaNoConcedida(Exception):
    pass
consultas = []
def reserva_del_run(entorno):
    consultas.append(entorno['FARO_ACTUALIZACION_ORIGEN'])
    if os.environ['CONSULTA'] == 'rechazada':
        raise ReservaNoConcedida('El servidor no ha concedido la reserva.')
    return ('${SOLICITUD_DEMANDA}', '9')
falso.ReservaNoConcedida = ReservaNoConcedida
falso.reserva_del_run = reserva_del_run
sys.modules[falso.__name__] = falso
def ejecutar(args, **opciones):
    print(json.dumps([os.environ['FARO_SOLICITUD_ID'], os.environ['FARO_REVISION_RESERVA'], len(consultas)], separators=(',', ':')))
    return types.SimpleNamespace(returncode=0)
subprocess.run = ejecutar
`;

test('la activación consulta su reserva solo si un run a demanda llega sin las salidas del candidato', (t) => {
  const activar = porNombre(workflow().publicacion, 'Activar o recuperar el candidato conservado');
  const codigo = texto(activar.run).split("<<'PY'\n")[1]?.split('\nPY')[0];
  assert.ok(codigo);
  const raiz = carpeta(t, 'consulta de la activacion');
  const casos = [
    ['true', '', '', 'concedida', 0, `${JSON.stringify([SOLICITUD_DEMANDA, '9', 1])}\n`],
    ['true', SOLICITUD_SERVIDOR, '7', 'concedida', 0, `${JSON.stringify([SOLICITUD_SERVIDOR, '7', 0])}\n`],
    ['false', SOLICITUD_SERVIDOR, '7', 'concedida', 0, `${JSON.stringify([SOLICITUD_SERVIDOR, '7', 0])}\n`],
    ['true', '', '', 'rechazada', 1, '::error title=Faro · reserva::El servidor no ha concedido la reserva.\n'],
  ] as const;
  for (const [demanda, solicitud, revision, consulta, salida, esperado] of casos) {
    const r: SpawnSyncReturns<string> = spawnSync(PYTHON, ['-c', SONDA_CONSULTA + codigo], {
      env: {
        PATH: '/usr/bin:/bin',
        HOME: raiz,
        RUNNER_TEMP: raiz,
        GITHUB_WORKSPACE: raiz,
        GITHUB_RUN_ATTEMPT: '2',
        FARO_ORIGEN_PUBLICO: 'https://web.example',
        FARO_ACTUALIZACION_ORIGEN: 'https://servidor.example',
        FARO_CLOUDFLARE_CONFIGURACION_JSON: '{}',
        FARO_CLOUDFLARE_CURSOS_CONFIGURACION_JSON: '{}',
        FARO_A_DEMANDA: demanda,
        FARO_SOLICITUD_ID: solicitud,
        FARO_REVISION_RESERVA: revision,
        CONSULTA: consulta,
      },
      encoding: 'utf8',
      timeout: PLAZO_MS,
    });
    assert.equal(r.status, salida, r.stderr);
    assert.equal(r.stdout, esperado);
  }
});

test('los runs a demanda y los ensayos comparten un grupo; los del servidor van cada uno en el suyo', () => {
  const concurrencia = objeto(workflow().raiz.concurrency);
  assert.equal(concurrencia['cancel-in-progress'], false);
  const grupo = (inputs: Record<string, unknown>, runId: string) =>
    evaluar(concurrencia.group, { inputs, github: { run_id: runId } });
  assert.equal(grupo(DEMANDA, '1'), GRUPO_MANUAL);
  assert.equal(grupo({ ...SERVIDOR, ensayo: 'preparar' }, '2'), GRUPO_MANUAL);
  assert.equal(grupo({ ...SERVIDOR, ensayo: 'simular' }, '3'), GRUPO_MANUAL);
  assert.equal(grupo(SERVIDOR, '4'), 'faro-actualizar-4');
  assert.notEqual(grupo(SERVIDOR, '5'), grupo(SERVIDOR, '6'));
  assert.equal(grupo({ ...SERVIDOR, ensayo: '' }, '7'), 'faro-actualizar-7');
});

test('el workflow no usa acciones ni pide permisos nuevos y ninguna orden contiene una expresión', () => {
  const { raiz, candidato, activacion, pasos } = workflow();
  assert.doesNotMatch(readFileSync(ARCHIVO, 'utf8'), /^\s*(?:-\s*)?uses\s*:/m);
  assert.deepEqual(raiz.permissions, {});
  for (const job of [candidato, activacion]) {
    assert.deepEqual(job.permissions, { contents: 'read', 'id-token': 'write' });
  }
  for (const p of pasos) {
    assert.doesNotMatch(texto(p.run), /\$\{\{/, texto(p.name));
  }
});

test('la identidad OIDC solo llega a la reserva, el ensayo, la construcción y la activación', () => {
  const { construccion, publicacion } = workflow();
  const conIdentidad = (lista: Array<Record<string, unknown>>) =>
    lista
      .filter((p) => {
        const env = envDelPaso(p);
        return env.ACTIONS_ID_TOKEN_REQUEST_URL !== '' || env.ACTIONS_ID_TOKEN_REQUEST_TOKEN !== '';
      })
      .map((p) => p.name);
  assert.deepEqual(conIdentidad(construccion), [
    RESERVA,
    'Ensayar con la base de producción en una copia aislada',
    'Construir y conservar el candidato',
  ]);
  assert.deepEqual(conIdentidad(publicacion), ['Activar o recuperar el candidato conservado']);
  const reserva = envDelPaso(porNombre(construccion, RESERVA));
  assert.ok(!Object.values(reserva).some((v) => v.includes('secrets.')));
});
