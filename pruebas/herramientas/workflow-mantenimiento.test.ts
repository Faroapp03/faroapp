import assert from 'node:assert/strict';
import { execFileSync, type SpawnSyncReturns, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { parseDocument } from 'yaml';
import { PLAZO_SUITE_NAVEGADOR_MS, PLAZO_SUITE_PYTHON_MS, PLAZO_SUITE_UNIDAD_MS } from '../../scripts/verificar.ts';
import { crearDespachadorGitHub } from '../../src/administracion/ejecutor-github.ts';
import { IDENTIDAD_WEB } from '../../src/comun/identidad-web.ts';
import { prepararSqliteSimulado, urlSqliteRunner } from './fixture-sqlite-runner.ts';

const ARCHIVO = new URL('../../.github/workflows/actualizar.yml', import.meta.url);
const GUION = new URL('../../herramientas/mantenimiento/preparar-runner.sh', import.meta.url);
const SOLICITUD = '12345678-1234-4234-8234-123456789abc';
const LONGITUD_SHA = 40;
const SHA = 'a'.repeat(LONGITUD_SHA);
const COTA_SALIDA = 131_072;
const MODO_PRIVADO = 0o700;
const LIMITE_RUNNER_MINUTOS = 360;
const FASES_CONSTRUCCION = 9;
const FASES_ACTIVACION = 5;
/** Anotar el inicio, recuperar el commit y preparar las herramientas son idénticos en los dos jobs. */
const FASES_COMUNES = 3;
/** Solo el candidato pide su reserva, entre el checkout y las herramientas, y solo en un run a demanda. */
const RESERVA_A_DEMANDA = 'Pedir la reserva a demanda';
const CAUSA_SIN_NAVEGADORES = 'Anotar por qué el ciclo no publica';
/** La reserva llega por las entradas si la crea el servidor y por el paso de reserva si el run la pide a demanda. */
const RESERVA_EN_CONSTRUCCION = [
  ['FARO_SOLICITUD_ID', `\${{ inputs.a_demanda && steps.reserva.outputs.solicitud_id || inputs.solicitud_id }}`],
  [
    'FARO_REVISION_RESERVA',
    `\${{ inputs.a_demanda && steps.reserva.outputs.revision_reserva || inputs.revision_reserva }}`,
  ],
  ['FARO_ACCION', `\${{ inputs.accion }}`],
];
const PLAZO_MS = 10_000;

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
  assert.deepEqual(Object.keys(jobs), ['candidato', 'activacion', 'aviso']);
  const candidato = objeto(jobs.candidato);
  const activacion = objeto(jobs.activacion);
  assert.ok(Array.isArray(candidato.steps) && Array.isArray(activacion.steps));
  const construccion = candidato.steps.map(objeto);
  const publicacion = activacion.steps.map(objeto);
  return { raiz, candidato, activacion, construccion, publicacion, pasos: [...construccion, ...publicacion] };
}
// Estas condiciones solo usan comparaciones de cadenas, booleanos y operadores compartidos con Actions.
function expresion(job: Record<string, unknown>): string {
  const expresionIf = /^\$\{\{\s*([\s\S]+?)\s*\}\}$/.exec(texto(job.if))?.[1];
  assert.ok(expresionIf);
  return expresionIf;
}
test('los jobs de construcción y activación respetan el límite de Ubuntu y el resultado de la dependencia', () => {
  const { candidato, activacion } = workflow();
  assert.equal(activacion.needs, 'candidato');
  for (const job of [candidato, activacion]) {
    assert.equal(job['runs-on'], 'ubuntu-24.04');
    assert.ok(Number(job['timeout-minutes']) <= LIMITE_RUNNER_MINUTOS);
    assert.equal(job.uses, undefined); // La identidad del job debe corresponder a este mismo workflow y revisión.
  }
  const construir = expresion(candidato);
  const publicar = expresion(activacion);
  assert.match(publicar, /!cancelled\(\)/); // Sustituye el success() implícito cuando la dependencia se omite.
  const habilitacion = [
    ['si', false, true],
    ['si', true, false],
    ['no', false, false],
    ['no', true, false],
  ] as const;
  for (const intento of ['1', '2', '3']) {
    const admisibles = intento === '1' ? ['success'] : ['success', 'skipped'];
    for (const estado of ['success', 'skipped', 'failure', 'cancelled']) {
      for (const [bandera, cancelado, habilitada] of habilitacion) {
        const contexto = {
          github: { run_attempt: intento },
          inputs: { ensayo: 'ninguno' },
          vars: { FARO_ACTIVACION_AUTOMATICA: bandera },
          needs: { candidato: { result: estado } },
          cancelled: () => cancelado,
        };
        assert.equal(runInNewContext(construir, contexto), intento === '1');
        assert.equal(runInNewContext(publicar, contexto), habilitada && admisibles.includes(estado));
      }
    }
  }
});

function paso(marca: string, pasos = workflow().pasos) {
  const encontrados = pasos.filter((p) => texto(p.run).includes(marca));
  assert.equal(encontrados.length, 1);
  const encontrado = encontrados[0];
  assert.ok(encontrado);
  return encontrado;
}
function envDelPaso(p: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(objeto(p.env)).map(([k, v]) => [k, texto(v)]));
}
function entrecomillar(entrada: string): string {
  return `'${entrada.replaceAll("'", "'\\''")}'`;
}
function fixture() {
  const raiz = mkdtempSync(join(realpathSync(tmpdir()), 'workflow Año 2026 '));
  for (const nombre of ['workspace', 'runner', 'bin', 'cache']) {
    mkdirSync(join(raiz, nombre));
  }
  return {
    raiz,
    workspace: join(raiz, 'workspace'),
    runner: join(raiz, 'runner'),
    bin: join(raiz, 'bin'),
    cache: join(raiz, 'cache'),
    log: join(raiz, 'llamadas.jsonl'),
    limpiar: () => rmSync(raiz, { recursive: true, force: true }),
  };
}
type Fixture = ReturnType<typeof fixture>;
function entorno(f: Fixture): NodeJS.ProcessEnv {
  return {
    PATH: `${f.bin}:/usr/bin:/bin`,
    HOME: f.raiz,
    TMPDIR: f.runner,
    LANG: 'C.UTF-8',
    GITHUB_ACTIONS: 'true',
    GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_SERVER_URL: 'https://github.com',
    GITHUB_REPOSITORY: 'entidad/ejemplo',
    GITHUB_WORKSPACE: f.workspace,
    GITHUB_SHA: SHA,
    GITHUB_RUN_ID: '123',
    GITHUB_RUN_ATTEMPT: '1',
    RUNNER_TEMP: f.runner,
    RUNNER_TOOL_CACHE: f.cache,
    GITHUB_PATH: join(f.runner, 'path'),
    GITHUB_ENV: join(f.runner, 'env'),
  };
}
function ejecutarShell(guion: string, cwd: string, env: NodeJS.ProcessEnv) {
  return spawnSync('/bin/bash', ['--noprofile', '--norc', '-euo', 'pipefail', '-c', guion], {
    cwd,
    env,
    encoding: 'utf8',
    timeout: PLAZO_MS,
    maxBuffer: COTA_SALIDA,
  });
}
function ejecutable(ruta: string, contenido: string) {
  mkdirSync(join(ruta, '..'), { recursive: true });
  writeFileSync(ruta, contenido);
  chmodSync(ruta, MODO_PRIVADO);
}
function binario(f: Fixture, ruta: string, nombre: string, codigo: string) {
  const modulo = join(f.raiz, `${nombre}.cjs`);
  writeFileSync(modulo, codigo);
  ejecutable(ruta, `#!/bin/sh\nexec ${entrecomillar(process.execPath)} ${entrecomillar(modulo)} "$@"\n`);
}
function llamadas(f: Fixture): Array<Record<string, unknown>> {
  if (!existsSync(f.log)) {
    return [];
  }
  return readFileSync(f.log, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((s) => objeto(JSON.parse(s)));
}
const CLAVES_PRIVADAS = [
  'ACTIONS_ID_TOKEN_REQUEST_URL',
  'ACTIONS_ID_TOKEN_REQUEST_TOKEN',
  'FARO_ALMACEN_ACCESS_KEY_ID',
  'FARO_ALMACEN_SECRET_ACCESS_KEY',
  'GITHUB_TOKEN',
  'AWS_ACCESS_KEY_ID',
  'HTTPS_PROXY',
  'PYTHONPATH',
  'NODE_OPTIONS',
];
function registrar(f: Fixture, nombre: string) {
  return `const fs=require('node:fs');
const env=Object.fromEntries(${JSON.stringify(CLAVES_PRIVADAS)}.map(k=>[k,Boolean(process.env[k])]));
fs.appendFileSync(${JSON.stringify(f.log)},JSON.stringify({nombre:${JSON.stringify(nombre)},args:process.argv.slice(2),env,home:process.env.HOME,tmp:process.env.TMPDIR,ld:process.env.LD_LIBRARY_PATH})+'\\n');\n`;
}

function comprobarInputs(evento: Record<string, unknown>): void {
  const inputs = objeto(objeto(evento.workflow_dispatch).inputs);
  assert.deepEqual(Object.keys(inputs).sort(), [
    'a_demanda',
    'accion',
    'ensayo',
    'reanudar_entradas',
    'revisar_paquete_pendiente',
    'revision_reserva',
    'solicitud_id',
  ]);
  assert.equal(objeto(inputs.accion).required, true);
  for (const clave of ['revision_reserva', 'solicitud_id']) {
    assert.equal(objeto(inputs[clave]).required, false);
  }
  assert.equal(objeto(inputs.ensayo).default, 'ninguno');
  assert.deepEqual(objeto(inputs.ensayo).options, ['ninguno', 'preparar', 'simular']);
  assert.equal(objeto(inputs.reanudar_entradas).type, 'boolean');
  assert.equal(objeto(inputs.reanudar_entradas).default, false);
  assert.equal(objeto(inputs.revisar_paquete_pendiente).type, 'boolean');
  assert.equal(objeto(inputs.revisar_paquete_pendiente).default, false);
  assert.equal(objeto(inputs.a_demanda).type, 'boolean');
  assert.equal(objeto(inputs.a_demanda).default, false);
  assert.deepEqual(objeto(inputs.accion).options, [
    'actualizar-datos',
    'reintentar-pendientes',
    'comprobar-programada',
    'actualizar-cursos',
    'comprobar-vencidas',
  ]);
}

test('la solicitud de reanudar exige una nueva reserva a demanda con las fuentes en serie', (t) => {
  const { construccion } = workflow();
  const inicio = construccion[0];
  assert.ok(inicio, 'El trabajo de construcción debe declarar su paso de inicio');
  const supervisor = paso('ejecutar_mantenimiento ejecutar', construccion);
  const pasarBandera = objeto(supervisor.env).FARO_REANUDAR_ENTRADAS;
  assert.equal(pasarBandera, `\${{ inputs.reanudar_entradas && (inputs.a_demanda && 'si' || 'invalido') || 'no' }}`);
  const f = fixture();
  t.after(f.limpiar);
  for (const [job, reanudar, aDemanda, accion, paralelo, resultado] of [
    ['candidato', 'true', 'true', 'actualizar-datos', 'no', 0],
    ['candidato', 'true', 'false', 'actualizar-datos', 'no', 1],
    ['candidato', 'true', 'true', 'actualizar-cursos', 'no', 1],
    ['candidato', 'true', 'true', 'actualizar-datos', 'si', 1],
    ['candidato', 'false', 'false', 'comprobar-programada', 'si', 0],
    ['activacion', 'true', 'true', 'actualizar-datos', 'si', 0],
  ] as const) {
    const r = ejecutarShell(texto(inicio.run), f.workspace, {
      ...entorno(f),
      ENTRADA_ACCION: accion,
      ENTRADA_A_DEMANDA: aDemanda,
      ENTRADA_REANUDAR: reanudar,
      ENTRADA_ENSAYO: 'ninguno',
      ENTRADA_SOLICITUD_ID: '',
      ENTRADA_REVISION_RESERVA: '',
      GITHUB_JOB: job,
      REPOSITORIO_EN_PARALELO: paralelo,
    });
    assert.equal(r.status, resultado, r.stderr);
  }
});

test('workflow separa construcción y activación optativa, con inputs cerrados y sin cola que pierda reservas', () => {
  const { raiz, candidato, activacion, construccion, publicacion, pasos } = workflow();
  const evento = objeto(raiz.on);
  assert.deepEqual(Object.keys(evento), ['workflow_dispatch']);
  comprobarInputs(evento);
  assert.deepEqual(raiz.permissions, {});
  // Ningún run espera ni cancela a uno en curso; el grupo de cada caso lo fija workflow-a-demanda.test.ts.
  assert.equal(objeto(raiz.concurrency)['cancel-in-progress'], false);
  for (const job of [candidato, activacion]) {
    assert.deepEqual(job.permissions, { contents: 'read', 'id-token': 'write' });
    assert.equal(job.concurrency, undefined);
  }
  const comunes = construccion.filter((p) => p.name !== RESERVA_A_DEMANDA).slice(0, FASES_COMUNES);
  assert.deepEqual(comunes, publicacion.slice(0, FASES_COMUNES));
  assert.deepEqual(construccion.at(-1), publicacion.at(-1));
  assert.equal(construccion.length, FASES_CONSTRUCCION);
  assert.equal(publicacion.length, FASES_ACTIVACION);
  for (const p of pasos) {
    assert.equal(p.uses, undefined);
    assert.equal(p['continue-on-error'], undefined);
    assert.doesNotMatch(texto(p.run), /\$\{\{\s*(?:inputs|secrets)\./);
  }
  const final = paso('plataforma_datos.orquestacion.ejecutar_mantenimiento ejecutar');
  assert.deepEqual(
    Object.entries(envDelPaso(final)).filter(
      ([k]) => k.startsWith('FARO_') && ['FARO_SOLICITUD_ID', 'FARO_REVISION_RESERVA', 'FARO_ACCION'].includes(k),
    ),
    RESERVA_EN_CONSTRUCCION,
  );
  const ensayo = paso('plataforma_datos.orquestacion.ensayo_en_runner', pasos);
  for (const p of pasos.filter(
    (p) =>
      p !== final && p !== ensayo && p.name !== RESERVA_A_DEMANDA && !texto(p.run).includes('ejecutar_mantenimiento'),
  )) {
    const env = envDelPaso(p);
    assert.equal(env.ACTIONS_ID_TOKEN_REQUEST_URL, '');
    assert.equal(env.ACTIONS_ID_TOKEN_REQUEST_TOKEN, '');
    assert.ok(!Object.values(env).some((v) => v.includes('secrets.')));
  }
});

test('un ensayo se puede repetir en el runner sin entrar en la construcción real ni la activación', () => {
  const { candidato, activacion, construccion } = workflow();
  const ensayo = paso('plataforma_datos.orquestacion.ensayo_en_runner', construccion);
  assert.match(texto(ensayo.if), /github\.event\.repository\.default_branch/);
  assert.deepEqual(
    Object.keys(envDelPaso(ensayo))
      .filter((k) => envDelPaso(ensayo)[k]?.includes('secrets.'))
      .sort(),
    ['FARO_ALMACEN_ACCESS_KEY_ID', 'FARO_ALMACEN_S3', 'FARO_ALMACEN_SECRET_ACCESS_KEY'],
  );
  const real = paso('ejecutar_mantenimiento ejecutar', construccion);
  for (const modo of ['preparar', 'simular']) {
    for (const intento of ['1', '2']) {
      const contexto = {
        github: { run_attempt: intento },
        inputs: { ensayo: modo },
        vars: { FARO_ACTIVACION_AUTOMATICA: 'si' },
        needs: { candidato: { result: 'success' } },
        cancelled: () => false,
      };
      assert.equal(runInNewContext(expresion(candidato), contexto), true);
      assert.equal(runInNewContext(expresion(real), contexto), false);
      assert.equal(runInNewContext(expresion(activacion), contexto), false);
    }
  }
});

test('la construcción prepara navegadores y la activación recupera en su propio checkout con herramientas', () => {
  const { construccion, publicacion, candidato } = workflow();
  assert.match(texto(candidato.if), /github\.run_attempt == '1'/);
  assert.match(texto(publicacion[1]?.run), /checkout --detach "\$GITHUB_SHA"/);
  assert.match(texto(publicacion[2]?.run), /preparar-runner\.sh/);
  assert.match(texto(publicacion[3]?.run), /"activar" if .* else "recuperar"/);
  assert.ok(publicacion.every((p) => !/preparar-navegadores|ejecutar_mantenimiento ejecutar/.test(texto(p.run))));
  // Tras la construcción solo queda el aviso de los minutos del job.
  assert.match(texto(construccion.at(-2)?.run), /ejecutar_mantenimiento ejecutar/);
});

test('la preparación fría y caliente deja tiempo efectivo al supervisor y todas las fases caben en sus jobs', (t) => {
  const { raiz, candidato, activacion, construccion, publicacion } = workflow();
  const herramientas = paso('preparar-runner.sh', construccion);
  const motores = paso('preparar-navegadores.sh', construccion);
  const supervisor = paso('ejecutar_mantenimiento ejecutar', construccion);
  assert.equal(herramientas.id, 'herramientas');
  assert.equal(supervisor['timeout-minutes'], `\${{ fromJSON(steps.herramientas.outputs.minutos_supervisor) }}`);
  const f = fixture();
  t.after(f.limpiar);
  const salida = join(f.runner, 'presupuesto');
  // El job lee su tope de la variable del workflow, la misma que fija su timeout-minutes.
  const tope = { FARO_TOPE_CANDIDATO_MINUTOS: String(objeto(raiz.env).FARO_TOPE_CANDIDATO_MINUTOS) };
  // Con «no» el job no instala navegadores y sus 6 minutos pasan al supervisor.
  const casos = [
    { navegadores: 'si', segundos: 10, minutos: 303 },
    { navegadores: 'si', segundos: 310, minutos: 302 },
    { navegadores: 'si', segundos: 1190, minutos: 288 },
    { navegadores: 'no', segundos: 10, minutos: 309 },
    { navegadores: 'no', segundos: 1190, minutos: 294 },
  ];
  const fijos = [
    'Anotar el inicio del job',
    'Recuperar el commit del evento',
    RESERVA_A_DEMANDA,
    'Anunciar los minutos del job',
  ].reduce((total, nombre) => total + Number(construccion.find((p) => p.name === nombre)?.['timeout-minutes']), 0);
  for (const { navegadores, segundos, minutos } of casos) {
    const guion = texto(herramientas.run).replace(
      'bash herramientas/mantenimiento/preparar-runner.sh',
      `SECONDS=${segundos}`,
    );
    writeFileSync(salida, '');
    const env = { ...entorno(f), ...tope, GITHUB_OUTPUT: salida, FARO_NAVEGADORES_EN_EL_CICLO: navegadores };
    const r = ejecutarShell(guion, f.workspace, env);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(readFileSync(salida, 'utf8').trim(), `minutos_supervisor=${minutos}`);
    const preparacion =
      fijos + Math.ceil(segundos / 60) + (navegadores === 'si' ? Number(motores['timeout-minutes']) : 0);
    assert.ok(preparacion + minutos < Number(candidato['timeout-minutes']));
  }
  writeFileSync(salida, '');
  const erronea = { ...entorno(f), ...tope, GITHUB_OUTPUT: salida, FARO_NAVEGADORES_EN_EL_CICLO: 'sí' };
  assert.notEqual(ejecutarShell(texto(herramientas.run).replace(/^bash .*$/m, ''), f.workspace, erronea).status, 0);
  assert.equal(readFileSync(salida, 'utf8'), '');
  const minutosActivacion = publicacion.reduce((total, p) => total + Number(p['timeout-minutes']), 0);
  assert.ok(minutosActivacion < Number(activacion['timeout-minutes']));
});

test('dispatcher y workflow acuerdan el despacho ordinario y la revalidación privada', async () => {
  let cuerpo: unknown;
  const despacho = crearDespachadorGitHub({
    destino: { propietario: 'entidad', repositorio: 'ejemplo', workflow: 'actualizar.yml', ref: 'main' },
    obtenerToken: async () => 'token-sintetico',
    pedir: async (entrada) => {
      assert.ok(entrada instanceof Request);
      cuerpo = await entrada.json();
      return Response.json({
        workflow_run_id: 123,
        run_url: 'https://api.github.com/repos/entidad/ejemplo/actions/runs/123',
        html_url: 'https://github.com/entidad/ejemplo/actions/runs/123',
      });
    },
  });
  const resultado = await despacho(
    { solicitudId: SOLICITUD, revisionReserva: 7, accion: 'comprobar-programada' },
    new AbortController().signal,
  );
  assert.equal(resultado.estado, 'despachada');
  const inputs = objeto(objeto(objeto(workflow().raiz.on).workflow_dispatch).inputs);
  assert.deepEqual(objeto(cuerpo).inputs, {
    solicitud_id: SOLICITUD,
    revision_reserva: '7',
    accion: 'comprobar-programada',
  });
  await despacho(
    { solicitudId: SOLICITUD, revisionReserva: 7, accion: 'comprobar-programada', revisarPaquetePendiente: true },
    new AbortController().signal,
  );
  assert.deepEqual(
    Object.keys(objeto(objeto(cuerpo).inputs)).sort(),
    // El servidor nunca pide un run a demanda: sus despachos dejan `a_demanda` en falso.
    Object.keys(inputs)
      .filter((k) => k !== 'ensayo' && k !== 'a_demanda' && k !== 'reanudar_entradas')
      .sort(),
  );
  assert.equal(objeto(objeto(cuerpo).inputs).revisar_paquete_pendiente, 'true');
});

function prepararCheckout(f: Fixture) {
  const origen = join(f.raiz, 'origen');
  mkdirSync(origen);
  const gitEnv = { PATH: '/usr/bin:/bin', HOME: f.raiz, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  const git = (...args: string[]) =>
    execFileSync('/usr/bin/git', args, {
      cwd: origen,
      env: gitEnv,
      encoding: 'utf8',
      timeout: PLAZO_MS,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  git('init', '--template=');
  writeFileSync(join(origen, 'contenido.txt'), 'commit autorizado\n');
  git('add', 'contenido.txt');
  git(
    '-c',
    'user.name=Equipo Faro',
    '-c',
    'user.email=equipo@example.test',
    '-c',
    'core.hooksPath=/dev/null',
    'commit',
    '-m',
    'fixture',
  );
  const sha = git('rev-parse', 'HEAD');
  binario(
    f,
    join(f.bin, 'base64'),
    'base64',
    `let b=[];process.stdin.on('data',x=>b.push(x));process.stdin.on('end',()=>process.stdout.write(Buffer.concat(b).toString('base64')));`,
  );
  binario(
    f,
    join(f.bin, 'git'),
    'git',
    `const {spawnSync}=require('node:child_process');const fs=require('node:fs');
let args=process.argv.slice(2);const fetch=args.includes('fetch');
fs.appendFileSync(${JSON.stringify(f.log)},JSON.stringify({fetch,args,auth:Boolean(process.env.GIT_CONFIG_VALUE_0),
oidc:Boolean(process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN),ua:process.env.GIT_HTTP_USER_AGENT,pistas:[1,2,3].map(i=>process.env['GIT_CONFIG_VALUE_'+i])})+'\\n');
if(fetch){const i=args.indexOf('https://github.com/entidad/ejemplo.git');if(i<0)process.exit(91);args[i]=${JSON.stringify(origen)};}
const env={...process.env,GIT_ALLOW_PROTOCOL:'file'};delete env.GIT_CONFIG_COUNT;delete env.GIT_CONFIG_KEY_0;delete env.GIT_CONFIG_VALUE_0;
const r=spawnSync('/usr/bin/git',args,{env,stdio:'inherit',timeout:5000});process.exit(r.status??92);`,
  );
  return { sha, gitEnv };
}

test('shell checkout obtiene Git real del SHA del evento; HTTP se sustituye por repositorio local y no persiste token', () => {
  const f = fixture();
  try {
    const { sha, gitEnv } = prepararCheckout(f);
    const checkout = paso('git init', workflow().construccion);
    const env = { ...entorno(f), ...envDelPaso(checkout), GITHUB_SHA: sha, TOKEN_LECTURA: 'lectura-sintetica' };
    const r = ejecutarShell(texto(checkout.run), f.raiz, env);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(readFileSync(join(f.workspace, 'contenido.txt'), 'utf8'), 'commit autorizado\n');
    const cabeza = execFileSync('/usr/bin/git', ['-C', f.workspace, 'rev-parse', 'HEAD'], {
      env: gitEnv,
      encoding: 'utf8',
    }).trim();
    assert.equal(cabeza, sha);
    const registro = llamadas(f);
    assert.equal(registro.filter((r) => r.fetch).length, 1);
    for (const llamada of registro) {
      assert.equal(llamada.auth, llamada.fetch);
      assert.equal(llamada.oidc, false);
      assert.equal(llamada.ua, IDENTIDAD_WEB['User-Agent']);
      assert.deepEqual(
        llamada.pistas,
        llamada.fetch
          ? Object.entries(IDENTIDAD_WEB)
              .filter(([n]) => n !== 'User-Agent')
              .map(([n, v]) => `${n}: ${v}`)
          : [null, null, null],
      );
    }
    assert.doesNotMatch(
      readFileSync(join(f.workspace, '.git/config'), 'utf8'),
      /extraheader|lectura-sintetica|Authorization/i,
    );
  } finally {
    f.limpiar();
  }
});

const NODE_VERSION = '24.22.3';
const NODE_PAQUETE = `node-v${NODE_VERSION}-linux-x64`;
const NODE_ORIGEN = `https://nodejs.org/dist/v${NODE_VERSION}`;

function binariosNode(f: Fixture, nodeBin: string) {
  binario(
    f,
    join(nodeBin, 'node'),
    'node',
    `if(process.argv.some(a=>a.endsWith('/npm-cli.js'))){process.argv.splice(2,process.argv.findIndex(a=>a.endsWith('/npm-cli.js'))-1);${registrar(f, 'npm')}}else{${registrar(f, 'node')}if(process.argv[2]==='-p')process.stdout.write('${NODE_VERSION}\\n');else if(process.argv[2].endsWith('/comprobar-sqlite-node.mjs')){process.argv.splice(1,1);require(process.argv[1]);}}`,
  );
  binario(f, join(nodeBin, 'npm'), 'npm', registrar(f, 'npm'));
}

function prepararHerramientas(
  f: Fixture,
  { nodeEnCache = true, versionNodeSqlite = process.versions.sqlite ?? '' } = {},
) {
  const destino = join(f.workspace, 'herramientas/mantenimiento/preparar-runner.sh');
  mkdirSync(join(destino, '..'), { recursive: true });
  writeFileSync(destino, readFileSync(GUION));
  prepararSqliteSimulado(f.raiz, f.workspace, versionNodeSqlite);
  binario(
    f,
    join(f.bin, 'curl'),
    'curl',
    `${registrar(f, 'curl')}const a=process.argv.slice(2);const url=a.at(-1);const salida=a[a.indexOf('--output')+1];
fs.copyFileSync(require('node:path').join(${JSON.stringify(join(f.raiz, 'servidor'))},url.split('/').at(-1)),salida);`,
  );
  const nodeBin = join(f.cache, `node/${NODE_VERSION}/x64/bin`);
  if (nodeEnCache) {
    binariosNode(f, nodeBin);
  } else {
    // Una versión anterior en la caché no sustituye a la exigida.
    binario(f, join(f.cache, 'node/24.22.1/x64/bin/node'), 'node-antiguo', 'process.exit(97);');
  }
  const pythonBin = join(f.cache, 'Python/3.12.15/x64/bin');
  mkdirSync(join(pythonBin, '../lib'), { recursive: true });
  binario(
    f,
    join(pythonBin, 'python3.12'),
    'python',
    `${registrar(f, 'python')}if(process.argv[2]==='-c')process.stdout.write('3.12.15\\n');
if(process.argv.includes('plataforma_datos.orquestacion.preparar_dependencias')){
const p=require('node:path'),b=p.join(process.cwd(),'.venv/bin');fs.mkdirSync(b,{recursive:true});
fs.symlinkSync(p.join(process.env.LD_LIBRARY_PATH,'../bin/python3.12'),p.join(b,'python3.12'));}`,
  );
  ejecutable(join(f.bin, 'uname'), '#!/bin/sh\ncase "$1" in -s) echo Linux;; -m) echo x86_64;; *) exit 1;; esac\n');
  return nodeBin;
}

/** Simula nodejs.org, sha256sum y tar; la suma se calcula de verdad sobre los bytes servidos. */
function prepararDescarga(f: Fixture, { sumaCorrecta = true } = {}) {
  const paquete = join(f.raiz, 'servidor', `${NODE_PAQUETE}.tar.xz`);
  mkdirSync(join(paquete, '..'), { recursive: true });
  writeFileSync(paquete, 'paquete sintético de Node');
  const suma = createHash('sha256').update(readFileSync(paquete)).digest('hex');
  const anunciada = sumaCorrecta ? suma : 'f'.repeat(suma.length);
  writeFileSync(
    join(f.raiz, 'servidor', 'SHASUMS256.txt'),
    `${'0'.repeat(suma.length)}  ${NODE_PAQUETE}.tar.gz\n${anunciada}  ${NODE_PAQUETE}.tar.xz\n`,
  );
  const extraido = join(f.raiz, 'extraido', NODE_PAQUETE);
  binariosNode(f, join(extraido, 'bin'));
  prepararSuma(f);
  binario(
    f,
    join(f.bin, 'tar'),
    'tar',
    `${registrar(f, 'tar')}const a=process.argv.slice(2);
fs.cpSync(${JSON.stringify(extraido)},require('node:path').join(a[a.indexOf('-C')+1],${JSON.stringify(NODE_PAQUETE)}),{recursive:true});`,
  );
}

function prepararSuma(f: Fixture) {
  binario(
    f,
    join(f.bin, 'sha256sum'),
    'sha256sum',
    `${registrar(f, 'sha256sum')}const r=process.argv[2];
process.stdout.write(require('node:crypto').createHash('sha256').update(fs.readFileSync(r)).digest('hex')+'  '+r+'\\n');`,
  );
}

const ARCHIVO_PYTHON = 'python-3.12.15-linux-24.04-x64.tar.gz';
const URL_PYTHON = `https://github.com/actions/python-versions/releases/download/3.12.15-36805895057/${ARCHIVO_PYTHON}`;
function prepararPythonSinCache(f: Fixture) {
  prepararHerramientas(f);
  prepararSuma(f);
  const contenido = join(f.raiz, 'distribucion');
  const binarios = 'Python/3.12.15/x64/bin';
  mkdirSync(join(contenido, 'bin'), { recursive: true });
  mkdirSync(join(contenido, 'lib'));
  renameSync(join(f.cache, binarios, 'python3.12'), join(contenido, 'bin/python3.12'));
  writeFileSync(join(contenido, 'setup.sh'), 'exit 99\n');
  const archivo = join(f.raiz, 'servidor', ARCHIVO_PYTHON);
  execFileSync('/usr/bin/tar', ['-czf', archivo, '-C', contenido, '.']);
  const bytes = readFileSync(archivo);
  const suma = createHash('sha256').update(bytes).digest('hex');
  const destino = join(f.workspace, 'herramientas/mantenimiento/preparar-runner.sh');
  const guion = readFileSync(destino, 'utf8')
    .replace(/^python_bytes=\d+$/m, `python_bytes=${bytes.length}`)
    .replace(/^python_sha256=[a-f0-9]{64}$/m, `python_sha256=${suma}`);
  writeFileSync(destino, guion);
  return archivo;
}

test('sin Python en caché comprueba el archivo y registra únicamente el intérprete privado del job', () => {
  const f = fixture();
  try {
    prepararPythonSinCache(f);
    const hostil = Object.fromEntries(CLAVES_PRIVADAS.map((k) => [k, 'sintetico-no-heredar']));
    const r = ejecutarShell('bash herramientas/mantenimiento/preparar-runner.sh', f.workspace, {
      ...entorno(f),
      ...hostil,
    });
    assert.equal(r.status, 0, r.stderr);
    const registro = llamadas(f);
    const [descarga] = registro.filter((v) => v.nombre === 'curl');
    assert.ok(descarga && Array.isArray(descarga.args) && descarga.args.includes(URL_PYTHON));
    for (const [nombre, valor] of Object.entries(IDENTIDAD_WEB)) {
      assert.ok(descarga.args.includes(nombre === 'User-Agent' ? valor : `${nombre}: ${valor}`));
    }
    assert.ok(registro.some((v) => v.nombre === 'sha256sum'));
    assert.ok(registro.some((v) => v.nombre === 'python' && Array.isArray(v.args) && v.args.includes('-m')));
    const bin = readFileSync(join(f.runner, 'path'), 'utf8').trim().split('\n').at(-1) ?? '';
    assert.ok(bin.startsWith(join(f.runner, 'entorno.')) && bin.endsWith('/python/bin'), bin);
    assert.equal(existsSync(join(f.cache, 'Python/3.12.15/x64/bin/python3.12')), false);
  } finally {
    f.limpiar();
  }
});

for (const defecto of ['tamaño', 'SHA-256'] as const) {
  test(`una descarga Python con ${defecto} incorrecto se descarta antes de extraer o registrar binarios`, () => {
    const f = fixture();
    try {
      const ruta = prepararPythonSinCache(f);
      const bytes = readFileSync(ruta);
      bytes[0] = 0;
      writeFileSync(ruta, defecto === 'tamaño' ? bytes.subarray(1) : bytes);
      const r = ejecutarShell('bash herramientas/mantenimiento/preparar-runner.sh', f.workspace, entorno(f));
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, /tamaño o la suma SHA-256/u);
      assert.equal(existsSync(join(f.cache, 'Python/3.12.15/x64/bin/python3.12')), false);
      assert.equal(existsSync(join(f.runner, 'path')), false);
    } finally {
      f.limpiar();
    }
  });
}

test('un ZIP de SQLite alterado se rechaza antes de compilar o registrar herramientas', () => {
  const f = fixture();
  try {
    prepararHerramientas(f);
    const nombre = urlSqliteRunner.split('/').at(-1) ?? '';
    const archivo = join(f.raiz, 'servidor', nombre);
    const bytes = readFileSync(archivo);
    bytes[0] = 0;
    writeFileSync(archivo, bytes);
    const r = ejecutarShell('bash herramientas/mantenimiento/preparar-runner.sh', f.workspace, entorno(f));
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /huella SHA3-256 del ZIP de SQLite/u);
    assert.equal(existsSync(join(f.cache, 'Python/3.12.15/x64/lib/libsqlite3.so.0')), false);
    assert.equal(existsSync(join(f.runner, 'path')), false);
    assert.ok(llamadas(f).every((l) => l.nombre === 'curl'));
  } finally {
    f.limpiar();
  }
});

function comprobarEntornoAislado(f: Fixture, registro: ReadonlyArray<Record<string, unknown>>) {
  const lib = readFileSync(join(f.runner, 'env'), 'utf8').match(/^LD_LIBRARY_PATH=(.+)$/m)?.[1];
  assert.ok(lib);
  assert.ok(lib.startsWith(join(f.runner, 'entorno.')) && lib.endsWith('/python/lib'), lib);
  for (const llamada of registro) {
    assert.ok(Object.values(objeto(llamada.env)).every((v) => v === false));
    if (llamada.nombre === 'python' && Array.isArray(llamada.args) && llamada.args[0] === '-I') {
      assert.equal(llamada.ld, undefined);
      assert.equal(llamada.tmp, undefined);
      continue;
    }
    assert.notEqual(llamada.home, f.raiz);
    assert.ok(texto(llamada.tmp).startsWith(f.runner));
    assert.equal(llamada.ld, llamada.nombre === 'curl' ? undefined : lib);
  }
}

test('preparación ejecuta shell real con runtimes simulados y limpia credenciales/configuración hostil antes de cada herramienta', () => {
  const f = fixture();
  try {
    const nodeBin = prepararHerramientas(f);
    const hostil = Object.fromEntries(CLAVES_PRIVADAS.map((k) => [k, 'sintetico-no-heredar']));
    const r = ejecutarShell('bash herramientas/mantenimiento/preparar-runner.sh', f.workspace, {
      ...entorno(f),
      ...hostil,
      LD_LIBRARY_PATH: '/no-heredar-biblioteca',
    });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.stdout.includes(`SQLite ${process.versions.sqlite} · node:sqlite · FTS5`), r.stdout);
    const registro = llamadas(f);
    comprobarEntornoAislado(f, registro);
    const npm = registro.find((r) => r.nombre === 'npm');
    assert.ok(npm && Array.isArray(npm.args));
    assert.ok(npm.args.includes('--ignore-scripts') && npm.args.includes('--include=optional'));
    assert.ok(npm.args.includes(`--user-agent=${IDENTIDAD_WEB['User-Agent']}`));
    const python = registro.find(
      (r) =>
        r.nombre === 'python' &&
        Array.isArray(r.args) &&
        r.args.includes('plataforma_datos.orquestacion.preparar_dependencias'),
    );
    assert.ok(python);
    assert.ok(
      registro.some(
        (r) =>
          r.nombre === 'node' &&
          Array.isArray(r.args) &&
          r.args.some((a) => typeof a === 'string' && a.includes('transformSync')),
      ),
    );
    assert.ok(readFileSync(join(f.runner, 'path'), 'utf8').includes(nodeBin));
    assert.equal(existsSync(join(f.cache, 'Python/3.12.15/x64/lib/libsqlite3.so.0')), false);
    assert.equal(
      registro.filter((l) => l.nombre === 'python' && Array.isArray(l.args) && l.args[0] === '-I').length,
      2,
    );
  } finally {
    f.limpiar();
  }
});

test('un Node con la versión prevista y otro motor SQLite aborta antes de npm y del registro del job', () => {
  const f = fixture();
  try {
    prepararHerramientas(f, { versionNodeSqlite: '0.0.0' });
    const r = ejecutarShell('bash herramientas/mantenimiento/preparar-runner.sh', f.workspace, entorno(f));
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /node:sqlite carga SQLite .* y la fuente verificada exige 0\.0\.0/u);
    assert.equal(existsSync(join(f.runner, 'path')), false);
    assert.equal(
      llamadas(f).some((l) => l.nombre === 'npm'),
      false,
    );
  } finally {
    f.limpiar();
  }
});

test('preparación descarga Node 24.22.3 de nodejs.org con el perfil central, verifica SHA-256 y lo usa si falta en la caché', () => {
  const f = fixture();
  try {
    prepararHerramientas(f, { nodeEnCache: false });
    prepararDescarga(f);
    const hostil = Object.fromEntries(CLAVES_PRIVADAS.map((k) => [k, 'sintetico-no-heredar']));
    const r = ejecutarShell('bash herramientas/mantenimiento/preparar-runner.sh', f.workspace, {
      ...entorno(f),
      ...hostil,
    });
    assert.equal(r.status, 0, r.stderr);
    const registro = llamadas(f);
    const curl = registro.filter((l) => l.nombre === 'curl');
    assert.deepEqual(
      curl.map((l) => (Array.isArray(l.args) ? l.args.at(-1) : undefined)),
      [`${NODE_ORIGEN}/SHASUMS256.txt`, `${NODE_ORIGEN}/${NODE_PAQUETE}.tar.xz`, urlSqliteRunner],
    );
    for (const llamada of curl) {
      assert.ok(Array.isArray(llamada.args));
      const args = llamada.args;
      assert.equal(args[0], '-q');
      assert.equal(args[args.indexOf('--user-agent') + 1], IDENTIDAD_WEB['User-Agent']);
      assert.deepEqual(
        args.flatMap((v, i) => (v === '--header' ? [args[i + 1]] : [])),
        Object.entries(IDENTIDAD_WEB)
          .filter(([n]) => n !== 'User-Agent')
          .map(([n, v]) => `${n}: ${v}`),
      );
      assert.equal(args[args.indexOf('--proto') + 1], '=https');
      assert.ok(Object.values(objeto(llamada.env)).every((v) => v === false));
    }
    assert.ok(registro.some((l) => l.nombre === 'sha256sum'));
    const tar = registro.find((l) => l.nombre === 'tar');
    assert.ok(tar && Array.isArray(tar.args) && tar.args.includes('--no-same-owner'));
    const ruta = readFileSync(join(f.runner, 'path'), 'utf8').split('\n')[0] ?? '';
    assert.ok(ruta.startsWith(join(f.runner, 'entorno.')) && ruta.endsWith(`/${NODE_PAQUETE}/bin`), ruta);
    assert.ok(registro.some((l) => l.nombre === 'npm'));
  } finally {
    f.limpiar();
  }
});

test('preparación se detiene sin extraer ni registrar Node si la suma no coincide con SHASUMS256.txt', () => {
  const f = fixture();
  try {
    prepararHerramientas(f, { nodeEnCache: false });
    prepararDescarga(f, { sumaCorrecta: false });
    const r = ejecutarShell('bash herramientas/mantenimiento/preparar-runner.sh', f.workspace, entorno(f));
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /suma SHA-256 .* no coincide con el SHASUMS256\.txt oficial/);
    const registro = llamadas(f);
    assert.equal(registro.filter((l) => l.nombre === 'curl').length, 2);
    assert.ok(registro.every((l) => !['tar', 'node', 'npm', 'python'].includes(texto(l.nombre))));
    assert.equal(existsSync(join(f.runner, 'path')), false);
  } finally {
    f.limpiar();
  }
});

function prepararSupervisor(f: Fixture) {
  binario(
    f,
    join(f.workspace, '.venv/bin/python'),
    'supervisor',
    `${registrar(f, 'supervisor')}
if(!fs.statSync(process.argv[process.argv.indexOf('--registro') - 1]).isDirectory())process.exit(90);
fs.writeFileSync(${JSON.stringify(join(f.raiz, 'inputs.json'))},JSON.stringify({id:process.env.FARO_SOLICITUD_ID,revision:process.env.FARO_REVISION_RESERVA,accion:process.env.FARO_ACCION}));`,
  );
}

const GUION_MOTORES = 'bash herramientas/mantenimiento/preparar-navegadores.sh';
const MOTORES = ['chromium', 'firefox', 'webkit'];
/** Calidad prueba los tres motores; el ciclo solo abre Chromium, en el humo de datos. */
const COMANDO_CALIDAD = `${GUION_MOTORES} ${MOTORES.join(' ')}`;
const COMANDO_CICLO = `${GUION_MOTORES} chromium`;
/** Lo que el guion escribe para APT: la identidad generada y el archivo principal con la red, que se lee el último. */
const MAIN_APT = /^Dir::Etc::main "([^"]+)";$/m;
/**
 * Un apt-config de ensayo: lee del archivo principal de APT_CONFIG los valores de la red, como el real, salvo que
 * `pisados` simule otra configuración que gana.
 */
function aptConfig(f: Fixture, pisados: boolean) {
  binario(
    f,
    join(f.bin, 'apt-config'),
    'apt-config',
    `${registrar(f, 'apt-config')}
const red=fs.readFileSync(${MAIN_APT}.exec(fs.readFileSync(process.env.APT_CONFIG,'utf8'))[1],'utf8');
const args=process.argv.slice(3);
let salida='';
for(let i=0;i<args.length;i+=2){
  const valor=new RegExp('^'+args[i+1]+' "([^"]*)";$','m').exec(red)?.[1];
  salida+=args[i]+"='"+(${pisados}?'120':valor)+"'\\n";
}
process.stdout.write(salida);`,
  );
}
/**
 * Un runner de ensayo: `fallo` no arranca nunca; los motores de `sinBibliotecas` arrancan solo después de que
 * install-deps les instale sus bibliotecas; los demás, en cuanto se descargan.
 */
function prepararMotores(f: Fixture, fallo: string, { pisados = false, sinBibliotecas = [] as string[] } = {}) {
  aptConfig(f, pisados);
  for (const guion of ['preparar-navegadores.sh', 'apt-con-tope.sh'].map((n) => `herramientas/mantenimiento/${n}`)) {
    mkdirSync(join(f.workspace, guion, '..'), { recursive: true });
    writeFileSync(join(f.workspace, guion), readFileSync(new URL(`../../${guion}`, import.meta.url)));
  }
  ejecutable(join(f.bin, 'sudo'), '#!/bin/sh\nexec "$@"\n');
  ejecutable(join(f.bin, 'sleep'), '#!/bin/sh\ntest "$1" = 2\n');
  ejecutable(join(f.bin, 'dpkg'), '#!/bin/sh\ntest "$1" = --print-architecture && echo amd64\n');
  const bibliotecas = JSON.stringify(join(f.raiz, 'bibliotecas-'));
  const modulo = join(f.workspace, 'node_modules/playwright-core');
  mkdirSync(modulo, { recursive: true });
  writeFileSync(join(modulo, 'package.json'), JSON.stringify({ type: 'module', exports: './index.js' }));
  writeFileSync(
    join(modulo, 'index.js'),
    `import { existsSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
function motor(nombre) { return { async launch() {
  const sinBibliotecas = ${JSON.stringify(sinBibliotecas)}.includes(nombre) && !existsSync(${bibliotecas} + nombre);
  if (!existsSync(join(process.env.PLAYWRIGHT_BROWSERS_PATH, nombre)) || nombre === ${JSON.stringify(fallo)} || sinBibliotecas) {
    throw Error('No arranca ' + nombre);
  }
  return { close: async () => appendFileSync(${JSON.stringify(join(f.raiz, 'cerrados'))}, nombre+'\\n') };
} }; }
export const chromium=motor('chromium'), firefox=motor('firefox'), webkit=motor('webkit');`,
  );
  binario(
    f,
    join(f.bin, 'node'),
    'motor',
    `${registrar(f, 'motor')}
const args=process.argv.slice(2);
if (args.includes('install-deps')) {
  if (!fs.readFileSync(process.env.APT_CONFIG,'utf8').startsWith('configuracion de APT'))process.exit(89);
  for (const motor of args.slice(args.indexOf('install-deps') + 1)) fs.writeFileSync(${bibliotecas} + motor, '');
} else if (args.includes('install')) {
  if (!args.includes('--require') || !args.some(a=>a.endsWith('/red/identidad-http.cjs')))process.exit(90);
  fs.mkdirSync(process.env.PLAYWRIGHT_BROWSERS_PATH,{recursive:true});
  fs.writeFileSync(require('node:path').join(process.env.PLAYWRIGHT_BROWSERS_PATH,args.at(-1)),'instalado');
} else if (args.includes('--input-type=module')) {
  process.exit(require('node:child_process').spawnSync(process.execPath,args,{stdio:'inherit'}).status);
} else if (args[0]!=='herramientas/red/configurar-apt.ts') process.exit(91);
else if (args[1]==='identidad') process.stdout.write('configuracion de APT\\n');
else if (args[1]==='fuentes' && args[4]==='amd64') {
  fs.writeFileSync(args[2],'fuentes oficiales\\n');
  process.stdout.write('Dir::Etc::sourcelist "'+args[2]+'";\\nDir::Etc::sourceparts "'+args[3]+'";\\n');
} else process.exit(92);`,
  );
}

test('el job de calidad reserva tiempo para todas las baterías y la instalación en frío', () => {
  const documento = parseDocument(
    readFileSync(new URL('../../.github/workflows/calidad.yml', import.meta.url), 'utf8'),
  );
  const trabajo = objeto(objeto(objeto(documento.toJS()).jobs).calidad);
  const pasos = trabajo.steps;
  assert.ok(Array.isArray(pasos));
  const verificacion = pasos.map(objeto).find((paso) => texto(paso.run).includes('npm run verificar'));
  assert.ok(verificacion);
  const milisegundosPorMinuto = 60_000;
  const bateriasEnSerie = PLAZO_SUITE_UNIDAD_MS + PLAZO_SUITE_NAVEGADOR_MS + PLAZO_SUITE_PYTHON_MS;
  assert.ok(Number(verificacion['timeout-minutes']) * milisegundosPorMinuto > bateriasEnSerie);
  const minutosDeLosPasos = pasos.reduce((total, paso) => total + Number(objeto(paso)['timeout-minutes'] ?? 0), 0);
  assert.ok(Number(trabajo['timeout-minutes']) > minutosDeLosPasos);
});

// La tabla de la Cambra no está en Git: calidad la trae del almacén con sus tres secretos, antes de los tipos que la
// importan, y ningún otro paso recibe secretos ni usa acciones de terceros.
test('calidad recupera la tabla privada de la Cambra antes de los tipos y solo ese paso recibe secretos', () => {
  const calidad = parseDocument(readFileSync(new URL('../../.github/workflows/calidad.yml', import.meta.url), 'utf8'));
  const pasosCalidad = objeto(objeto(objeto(calidad.toJS()).jobs).calidad).steps;
  assert.ok(Array.isArray(pasosCalidad));
  const pasos = pasosCalidad.map(objeto);
  const orden = pasos.map((p) => String(p.run ?? ''));
  const recuperar = orden.findIndex((s) => s.includes('cambra.tabla_privada recuperar'));
  assert.ok(recuperar > orden.findIndex((s) => s.includes('preparar-runner.sh')));
  assert.ok(recuperar < orden.findIndex((s) => s.includes('npm run tipos')));
  const conSecretos = pasos.filter((p) =>
    Object.values(objeto(p.env ?? {})).some((v) => String(v).includes('secrets.')),
  );
  assert.deepEqual(conSecretos, [pasos[recuperar]]);
  assert.deepEqual(
    Object.entries(objeto(pasos[recuperar]?.env)).filter(([, v]) => String(v).includes('secrets.')),
    [
      ['FARO_ALMACEN_S3', `\${{ secrets.FARO_ALMACEN_S3 }}`],
      ['FARO_ALMACEN_ACCESS_KEY_ID', `\${{ secrets.FARO_ALMACEN_ACCESS_KEY_ID }}`],
      ['FARO_ALMACEN_SECRET_ACCESS_KEY', `\${{ secrets.FARO_ALMACEN_SECRET_ACCESS_KEY }}`],
    ],
  );
  assert.ok(pasos.every((p) => p.uses === undefined));
});

test('calidad prepara los tres motores y el ciclo solo Chromium, cada uno antes de lo que los abre', () => {
  const calidad = parseDocument(readFileSync(new URL('../../.github/workflows/calidad.yml', import.meta.url), 'utf8'));
  const pasosCalidad = objeto(objeto(objeto(calidad.toJS()).jobs).calidad).steps;
  assert.ok(Array.isArray(pasosCalidad));
  const orden = pasosCalidad.map((p) => texto(objeto(p).run));
  assert.ok(orden.includes(COMANDO_CALIDAD));
  assert.ok(orden.indexOf(COMANDO_CALIDAD) < orden.findIndex((s) => s.includes('npm run verificar')));
  // En calidad un fallo de la preparación sí para el job: sin motores no hay batería que valga.
  assert.ok(pasosCalidad.every((p) => objeto(p)['continue-on-error'] === undefined));
  const construccion = workflow().construccion;
  const candidato = construccion.map((p) => texto(p.run));
  assert.ok(candidato.indexOf(COMANDO_CICLO) > candidato.findIndex((s) => s.includes('preparar-runner.sh')));
  const causa = construccion.findIndex((p) => p.name === CAUSA_SIN_NAVEGADORES);
  assert.equal(causa, candidato.indexOf(COMANDO_CICLO) + 1);
  for (const consumidor of ['ensayo_en_runner', 'ejecutar_mantenimiento ejecutar']) {
    assert.ok(causa < candidato.findIndex((s) => s.includes(consumidor)), consumidor);
  }
});

/**
 * `bibliotecas`: los motores para los que se piden bibliotecas a APT, que son solo los que no arrancan tras
 * descargarse. `cerrados`: los motores que se abrieron y cerraron, en orden: primero la prueba de arranque y, si hizo
 * falta APT, la comprobación estricta de todos, que para en el primero que siga sin arrancar.
 */
const CASOS_MOTORES = [
  { comando: COMANDO_CALIDAD, motores: MOTORES, fallo: '', sinBibliotecas: [], bibliotecas: [], cerrados: MOTORES },
  {
    comando: COMANDO_CALIDAD,
    motores: MOTORES,
    fallo: '',
    sinBibliotecas: ['firefox', 'webkit'],
    bibliotecas: ['firefox', 'webkit'],
    cerrados: ['chromium', ...MOTORES],
  },
  {
    comando: COMANDO_CALIDAD,
    motores: MOTORES,
    fallo: 'webkit',
    sinBibliotecas: [],
    bibliotecas: ['webkit'],
    cerrados: ['chromium', 'firefox', 'chromium', 'firefox'],
  },
  {
    comando: COMANDO_CICLO,
    motores: ['chromium'],
    fallo: '',
    sinBibliotecas: [],
    bibliotecas: [],
    cerrados: ['chromium'],
  },
  {
    comando: COMANDO_CICLO,
    motores: ['chromium'],
    fallo: '',
    sinBibliotecas: ['chromium'],
    bibliotecas: ['chromium'],
    cerrados: ['chromium'],
  },
];
for (const { comando, motores, fallo, sinBibliotecas, bibliotecas, cerrados } of CASOS_MOTORES) {
  const caso = `${motores.join(', ')}; sin bibliotecas: ${sinBibliotecas.join(', ') || 'ninguno'}; fallo: ${fallo || 'ninguno'}`;
  test(`APT entra solo para los motores que no arrancan y la caché se exporta solo si arrancan todos (${caso})`, () => {
    const f = fixture();
    try {
      prepararMotores(f, fallo, { sinBibliotecas });
      const hostil = Object.fromEntries(CLAVES_PRIVADAS.map((k) => [k, 'hostil']));
      const r = ejecutarShell(comando, f.workspace, { ...entorno(f), ...hostil });
      assert.equal(r.status === 0, !fallo, r.stderr);
      const registro = llamadas(f);
      const argumentos = registro.map((v) => v.args).filter(Array.isArray);
      const dependencias = argumentos.filter((a) => a.includes('install-deps'));
      assert.deepEqual(
        dependencias.map((a) => a.slice(a.indexOf('install-deps') + 1)),
        bibliotecas.length > 0 ? [bibliotecas] : [],
      );
      assert.equal(
        registro.some((v) => v.nombre === 'apt-config'),
        bibliotecas.length > 0,
      );
      assert.deepEqual(
        argumentos.filter((a) => a.includes('install')).map((a) => a.at(-1)),
        motores,
      );
      assert.ok(registro.every((v) => Object.values(objeto(v.env)).every((presente) => !presente)));
      assert.deepEqual(readFileSync(join(f.raiz, 'cerrados'), 'utf8').trim().split('\n'), cerrados);
      assert.equal(existsSync(join(f.runner, 'env')), !fallo);
      if (!fallo) {
        assert.equal(
          readFileSync(join(f.runner, 'env'), 'utf8'),
          `PLAYWRIGHT_BROWSERS_PATH=${join(f.runner, 'navegadores-cache')}\n`,
        );
      }
    } finally {
      f.limpiar();
    }
  });
}

test('APT recibe reintentos, esperas y solo las fuentes oficiales en el archivo que lee el último, y se comprueba', () => {
  const f = fixture();
  try {
    prepararMotores(f, '', { sinBibliotecas: ['chromium'] });
    const r = ejecutarShell(COMANDO_CICLO, f.workspace, entorno(f));
    assert.equal(r.status, 0, r.stderr);
    const privado = readdirSync(f.runner).filter((n) => n.startsWith('navegadores-entorno.'));
    assert.equal(privado.length, 1);
    const configuracion = readFileSync(join(f.runner, String(privado[0]), 'apt.conf'), 'utf8');
    const principal = MAIN_APT.exec(configuracion)?.[1];
    assert.equal(principal, join(f.runner, String(privado[0]), 'apt-red.conf'));
    const red = readFileSync(String(principal), 'utf8');
    assert.match(red, /^Acquire::Retries "\d+";$/m);
    // Ni la lista ni las piezas del sistema: una lista propia con el archivo oficial y una carpeta de piezas vacía.
    const lista = join(f.runner, String(privado[0]), 'fuentes-oficiales.list');
    const piezas = join(f.runner, String(privado[0]), 'fuentes.d');
    assert.match(red, new RegExp(`^Dir::Etc::sourcelist "${lista}";\\nDir::Etc::sourceparts "${piezas}";$`, 'm'));
    assert.equal(readFileSync(lista, 'utf8'), 'fuentes oficiales\n');
    assert.deepEqual(readdirSync(piezas), []);
    const consultas = llamadas(f).filter((v) => v.nombre === 'apt-config');
    assert.deepEqual(objeto(consultas[0]).args, [
      'shell',
      'reintentos',
      'Acquire::Retries',
      'espera_http',
      'Acquire::http::Timeout',
      'espera_https',
      'Acquire::https::Timeout',
      'fuentes',
      'Dir::Etc::sourcelist',
      'piezas',
      'Dir::Etc::sourceparts',
    ]);
  } finally {
    f.limpiar();
  }
});

test('si otra configuración pisa las esperas o las fuentes de APT, la preparación para sin pedirle nada', () => {
  const f = fixture();
  try {
    prepararMotores(f, '', { pisados: true, sinBibliotecas: ['chromium'] });
    const r = ejecutarShell(COMANDO_CICLO, f.workspace, entorno(f));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /APT no usa los reintentos, las esperas ni las fuentes/);
    const argumentos = llamadas(f)
      .map((v) => v.args)
      .filter(Array.isArray);
    assert.ok(argumentos.every((a) => !a.includes('install-deps')));
    assert.equal(existsSync(join(f.runner, 'env')), false);
  } finally {
    f.limpiar();
  }
});

for (const motores of ['', 'chromium edge']) {
  test(`la preparación exige motores conocidos (${motores || 'ninguno'})`, () => {
    const f = fixture();
    try {
      prepararMotores(f, '');
      const r = ejecutarShell(`${GUION_MOTORES} ${motores}`.trim(), f.workspace, entorno(f));
      assert.equal(r.status, 2);
      assert.deepEqual(llamadas(f), []);
    } finally {
      f.limpiar();
    }
  });
}

test('sin Chromium listo, el ciclo para sin publicar y la ejecución dice por qué', (t) => {
  const { construccion } = workflow();
  const navegadores = construccion.find((p) => p.id === 'navegadores');
  assert.ok(navegadores);
  assert.equal(navegadores.run, COMANDO_CICLO);
  // El humo es obligatorio: un fallo de Chromium para el job, y con él la construcción y la activación.
  assert.equal(navegadores['continue-on-error'], undefined);
  const causa = construccion.find((p) => p.name === CAUSA_SIN_NAVEGADORES);
  assert.ok(causa);
  const condicion = /^\$\{\{\s*([\s\S]+?)\s*\}\}$/.exec(texto(causa.if))?.[1];
  assert.ok(condicion);
  for (const [fallo, resultado, anota] of [
    [true, 'failure', true],
    [false, 'success', false],
    [false, 'skipped', false],
    [true, 'skipped', false],
  ] as const) {
    const contexto = { failure: () => fallo, steps: { navegadores: { outcome: resultado } } };
    assert.equal(runInNewContext(condicion, contexto), anota, `${fallo} ${resultado}`);
  }
  const f = fixture();
  t.after(f.limpiar);
  const resumen = join(f.runner, 'resumen');
  const r = ejecutarShell(texto(causa.run), f.workspace, { ...entorno(f), GITHUB_STEP_SUMMARY: resumen });
  assert.equal(r.status, 0, r.stderr);
  const frase =
    'Chromium no ha quedado listo para el humo de datos: su instalación falló o no terminó en su plazo, también ' +
    'tras los reintentos de sus paquetes. Este ciclo no publica; el siguiente intento vuelve a prepararlo.';
  assert.equal(r.stdout, `::error title=Ciclo sin publicar::${frase}\n`);
  assert.equal(readFileSync(resumen, 'utf8'), `${frase}\n`);
});

function comprobarComandoSupervisor(args: unknown, f: Fixture): void {
  const trabajos = join(f.runner, 'trabajos');
  assert.deepEqual(args, [
    '-m',
    'plataforma_datos.orquestacion.ejecutar_mantenimiento',
    'ejecutar',
    f.workspace,
    trabajos,
    '--registro',
    join(trabajos, 'candidato.jsonl'),
  ]);
}
test('paso supervisor pasa inputs hostiles como datos, conserva sus capacidades y crea el padre privado del job', () => {
  const f = fixture();
  try {
    const final = paso('plataforma_datos.orquestacion.ejecutar_mantenimiento ejecutar');
    prepararSupervisor(f);
    const marcador = join(f.raiz, 'inyectado');
    const hostil = `$(touch ${entrecomillar(marcador)}); ' "; exit 99 #`;
    const env = {
      ...entorno(f),
      FARO_SOLICITUD_ID: hostil,
      FARO_REVISION_RESERVA: hostil,
      FARO_ACCION: hostil,
      ACTIONS_ID_TOKEN_REQUEST_URL: 'https://oidc.example.invalid',
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'oidc-sintetico',
      FARO_ALMACEN_ACCESS_KEY_ID: 'access-sintetico',
      FARO_ALMACEN_SECRET_ACCESS_KEY: 'secret-sintetico',
    };
    const r = ejecutarShell(texto(final.run), f.workspace, env);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(existsSync(marcador), false);
    assert.deepEqual(JSON.parse(readFileSync(join(f.raiz, 'inputs.json'), 'utf8')), {
      id: hostil,
      revision: hostil,
      accion: hostil,
    });
    const registro = llamadas(f);
    assert.equal(registro.length, 1);
    const llamada = registro[0];
    assert.ok(llamada);
    for (const nombre of [
      'ACTIONS_ID_TOKEN_REQUEST_TOKEN',
      'FARO_ALMACEN_ACCESS_KEY_ID',
      'FARO_ALMACEN_SECRET_ACCESS_KEY',
    ]) {
      assert.equal(objeto(llamada.env)[nombre], true);
    }
    comprobarComandoSupervisor(llamada.args, f);
  } finally {
    f.limpiar();
  }
});

/** La variable del repositorio con la variante de Cloudflare de la instalación. */
const VARIANTE_CLOUDFLARE = 'FARO_CLOUDFLARE_VARIANTE';

test('la construcción y la activación reciben la variante de la instalación de una variable del repositorio', () => {
  const pasos = workflow().pasos;
  const conVariante = pasos.filter((p) => VARIANTE_CLOUDFLARE in envDelPaso(p)).map((p) => p.name);
  assert.deepEqual(conVariante, [
    paso('plataforma_datos.orquestacion.ensayo_en_runner').name,
    paso('plataforma_datos.orquestacion.ejecutar_mantenimiento ejecutar').name,
    paso('FARO_CLOUDFLARE_CONFIGURACION_JSON').name,
  ]);
  for (const nombre of conVariante) {
    const p = pasos.find((candidato) => candidato.name === nombre);
    assert.ok(p);
    assert.equal(envDelPaso(p)[VARIANTE_CLOUDFLARE], `\${{ vars.${VARIANTE_CLOUDFLARE} }}`);
  }
});

// El registro de Actions muestra en claro los valores de vars.: el punto de acceso del almacén lleva la cuenta de
// Cloudflare, así que los dos solo llegan como secretos, que el registro oculta.
test('el almacén y la cuenta de Cloudflare llegan solo como secretos', () => {
  const conValor = workflow().pasos.flatMap((p) =>
    Object.entries(envDelPaso(p)).filter(([k]) => k === 'FARO_ALMACEN_S3' || k === 'CLOUDFLARE_ACCOUNT_ID'),
  );
  // El ensayo, la construcción y la activación usan el almacén; solo la activación, la cuenta.
  assert.deepEqual(
    conValor.map(([nombre]) => nombre),
    ['FARO_ALMACEN_S3', 'FARO_ALMACEN_S3', 'FARO_ALMACEN_S3', 'CLOUDFLARE_ACCOUNT_ID'],
  );
  for (const [nombre, valor] of conValor) {
    assert.equal(valor, `\${{ secrets.${nombre} }}`);
  }
});

test('solo la fase optativa de activación recibe credenciales Cloudflare y conserva la misma reserva', () => {
  const activacion = paso('FARO_CLOUDFLARE_CONFIGURACION_JSON');
  const env = envDelPaso(activacion);
  assert.match(texto(workflow().activacion.if), /vars\.FARO_ACTIVACION_AUTOMATICA == 'si'/);
  assert.equal(env.CLOUDFLARE_API_TOKEN, `\${{ secrets.CLOUDFLARE_API_TOKEN }}`);
  assert.equal(
    env.FARO_CLOUDFLARE_CURSOS_CONFIGURACION_JSON,
    `\${{ secrets.FARO_CLOUDFLARE_CURSOS_CONFIGURACION_JSON }}`,
  );
  assert.equal(
    env.FARO_SOLICITUD_ID,
    `\${{ inputs.a_demanda && needs.candidato.outputs.solicitud_id || inputs.solicitud_id }}`,
  );
  assert.equal(
    env.FARO_REVISION_RESERVA,
    `\${{ inputs.a_demanda && needs.candidato.outputs.revision_reserva || inputs.revision_reserva }}`,
  );
  assert.equal(env.FARO_ACCION, `\${{ inputs.accion }}`);
  assert.equal(env.FARO_A_DEMANDA, `\${{ inputs.a_demanda }}`);
  // La variante de la instalación no es una credencial: la necesitan la construcción y la activación.
  for (const anterior of workflow().pasos.filter((p) => p !== activacion && p.name !== activacion.name)) {
    assert.ok(!Object.keys(envDelPaso(anterior)).some((k) => k.includes('CLOUDFLARE') && k !== VARIANTE_CLOUDFLARE));
  }
  const sintaxis = ejecutarShell(`bash -n <<'GUION'\n${texto(activacion.run)}\nGUION`, '.', { PATH: '/usr/bin:/bin' });
  assert.equal(sintaxis.status, 0, sintaxis.stderr);
});

test('la fase de activación crea configuración privada fuera del checkout y retira el texto del entorno hijo', () => {
  const f = fixture();
  try {
    const codigo = texto(paso('FARO_CLOUDFLARE_CONFIGURACION_JSON').run).split("<<'PY'\n")[1]?.split('\nPY')[0];
    assert.ok(codigo);
    const sonda = `import subprocess, os, json, stat
from pathlib import Path
from types import SimpleNamespace
os.umask(0o077)
def comprobar(args, **opciones):
    config = Path(args[args.index('--configuracion-cloudflare') + 1])
    assert config.stat().st_mode & 0o777 == 0o600
    assert config.parent.stat().st_mode & 0o777 == 0o700
    assert not config.is_relative_to(os.environ['GITHUB_WORKSPACE'])
    assert json.loads(config.read_text()) == {'name':'fixture'}
    assert 'FARO_CLOUDFLARE_CONFIGURACION_JSON' not in os.environ
    cursos = Path(args[args.index('--configuracion-cloudflare-cursos') + 1])
    assert cursos.parent == config.parent and cursos != config
    assert cursos.stat().st_mode & 0o777 == 0o600
    assert json.loads(cursos.read_text()) == {'name':'fixture-cursos'}
    assert 'FARO_CLOUDFLARE_CURSOS_CONFIGURACION_JSON' not in os.environ
    esperado = os.environ['ESPERADO']
    assert args[1:5] == ['-m','plataforma_datos.orquestacion.ejecutar_mantenimiento',esperado,os.environ['GITHUB_WORKSPACE']]
    assert Path(args[5]).is_dir()
    assert not any(Path(args[5]).iterdir())
    assert opciones == {'check':False}
    print(json.dumps({'configuracion':str(config)}))
    return SimpleNamespace(returncode=0)
subprocess.run = comprobar
`;
    // El primer intento activa y cualquier otro recupera; ninguna variable del repositorio lo convierte en abandono:
    // el cierre se pide desde el panel.
    const casos = [
      ['1', 'activar'],
      ['2', 'recuperar'],
      ['3', 'recuperar'],
    ] as const;
    for (const [intento, esperado] of casos) {
      const propia = '11111111-1111-4111-8111-111111111111';
      const r: SpawnSyncReturns<string> = spawnSync(
        fileURLToPath(new URL('../../.venv/bin/python', import.meta.url)),
        ['-c', sonda + codigo],
        {
          env: {
            ...entorno(f),
            FARO_ORIGEN_PUBLICO: 'https://web.example',
            FARO_CLOUDFLARE_CONFIGURACION_JSON: '{"name":"fixture"}',
            FARO_CLOUDFLARE_CURSOS_CONFIGURACION_JSON: '{"name":"fixture-cursos"}',
            GITHUB_RUN_ATTEMPT: intento,
            ESPERADO: esperado,
            FARO_A_DEMANDA: 'false',
            FARO_SOLICITUD_ID: propia,
            FARO_ACTIVACION_ABANDONAR: propia,
          },
          encoding: 'utf8',
          timeout: PLAZO_MS,
          maxBuffer: COTA_SALIDA,
        },
      );
      assert.equal(r.status, 0, r.stderr);
      assert.equal(existsSync(texto(objeto(JSON.parse(r.stdout)).configuracion)), false);
    }
  } finally {
    f.limpiar();
  }
});

test('bootstrap Git y curl conserva los cuatro valores públicos del perfil aprobado sin algoritmo duplicado', () => {
  for (const nombre of ['actualizar', 'calidad']) {
    const documento = objeto(
      parseDocument(readFileSync(new URL(`../../.github/workflows/${nombre}.yml`, import.meta.url), 'utf8')).toJS(),
    );
    const jobs = objeto(documento.jobs);
    const job = objeto(Object.values(jobs)[0]);
    if (nombre === 'calidad') {
      assert.equal(objeto(job.env).npm_config_user_agent, IDENTIDAD_WEB['User-Agent']);
    }
    assert(Array.isArray(job.steps));
    const recuperar = objeto(job.steps.map(objeto).find((p) => p.name === 'Recuperar el commit del evento'));
    assert.equal(objeto(recuperar.env).GIT_HTTP_USER_AGENT, IDENTIDAD_WEB['User-Agent']);
    const orden = texto(recuperar.run);
    for (const [nombre, valor] of Object.entries(IDENTIDAD_WEB).filter(([n]) => n !== 'User-Agent')) {
      assert(orden.includes(`${nombre}: ${valor}`));
    }
    assert(orden.includes('GIT_CONFIG_COUNT=4'));
  }
  const guion = readFileSync(GUION, 'utf8');
  assert(guion.includes(IDENTIDAD_WEB['User-Agent']));
  for (const [nombre, valor] of Object.entries(IDENTIDAD_WEB).filter(([n]) => n !== 'User-Agent')) {
    assert(guion.includes(`${nombre}: ${valor}`));
  }
  assert(guion.includes('node --require "$PWD/herramientas/red/identidad-http.cjs"'));
});
