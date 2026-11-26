import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { parseDocument } from 'yaml';
import { VARIACION_DEL_RUNNER } from '../../scripts/plazos-de-las-suites.ts';
import {
  MINUTOS_LIMITE_WORKFLOW_ACTUALIZAR,
  PLAZO_RESERVA_PROGRAMADA_MS,
} from '../../src/administracion/programacion-trabajos.ts';

/** El repositorio es privado: cada job descuenta sus minutos de los 2.000 gratuitos del mes. */
const TOPE_CANDIDATO_MINUTOS = 324;
const TOPE_ACTIVACION_MINUTOS = 45;
const TOPE_AVISO_MINUTOS = 2;
/** GitHub corta cualquier job de un ejecutor alojado a las seis horas, diga lo que diga su timeout-minutes. */
const TOPE_GITHUB_MINUTOS = 360;
/** Lo que la reserva dura más que los tres jobs: cubre las colas de GitHub y el desfase de relojes. */
const MINUTOS_MARGEN_RESERVA = 13;
const MS_POR_MINUTO = 60_000;
const TOPE_CALIDAD_MINUTOS = 192;
const SEGUNDOS_POR_MINUTO = 60;
const POR_CIENTO = 100;
/** Margen para el recibo y el cierre del supervisor tras conservar el artefacto. */
const MINUTOS_RECIBO = 5;
const EJECUTOR = 'plataforma_datos/orquestacion/ejecutor_operativo.py';
const MEDIDAS = 'plataforma_datos/orquestacion/medidas_del_ciclo.py';
const ALMACEN = 'plataforma_datos/orquestacion/almacen_s3.py';
const SEGUNDOS_TRANSCURRIDOS = 125;
const MINUTOS_COBRADOS = 3;
const PLAZO_MS = 10_000;
const INICIO = 'Anotar el inicio del job';
const MINUTOS = 'Anunciar los minutos del job';
const MOTORES_CICLO = 'bash herramientas/mantenimiento/preparar-navegadores.sh chromium';
const MOTORES_CALIDAD = 'bash herramientas/mantenimiento/preparar-navegadores.sh chromium firefox webkit';

function objeto(entrada: unknown): Record<string, unknown> {
  assert.ok(entrada !== null && typeof entrada === 'object' && !Array.isArray(entrada));
  return entrada as Record<string, unknown>;
}
function texto(entrada: unknown): string {
  assert.equal(typeof entrada, 'string');
  return entrada as string;
}
function leer(nombre: string): Record<string, unknown> {
  const documento = parseDocument(
    readFileSync(new URL(`../../.github/workflows/${nombre}.yml`, import.meta.url), 'utf8'),
    { uniqueKeys: true },
  );
  assert.deepEqual(documento.errors, []);
  return objeto(documento.toJS());
}
function pasos(job: Record<string, unknown>): Array<Record<string, unknown>> {
  assert.ok(Array.isArray(job.steps));
  return job.steps.map(objeto);
}
function jobsDelCiclo() {
  const raiz = leer('actualizar');
  const jobs = objeto(raiz.jobs);
  return { raiz, candidato: objeto(jobs.candidato), activacion: objeto(jobs.activacion), aviso: objeto(jobs.aviso) };
}
function condicion(paso: Record<string, unknown>): string {
  const expresion = /^\$\{\{\s*([\s\S]+?)\s*\}\}$/.exec(texto(paso.if))?.[1];
  assert.ok(expresion);
  return expresion;
}
function ejecutar(guion: string, env: NodeJS.ProcessEnv) {
  return spawnSync('/bin/bash', ['--noprofile', '--norc', '-euo', 'pipefail', '-c', guion], {
    env,
    encoding: 'utf8',
    timeout: PLAZO_MS,
  });
}

test('cada job tiene el tope de minutos del presupuesto mensual', () => {
  const { candidato, activacion, aviso } = jobsDelCiclo();
  assert.equal(candidato['timeout-minutes'], TOPE_CANDIDATO_MINUTOS);
  assert.equal(aviso['timeout-minutes'], TOPE_AVISO_MINUTOS);
  assert.equal(objeto(jobsDelCiclo().raiz.env).FARO_TOPE_CANDIDATO_MINUTOS, TOPE_CANDIDATO_MINUTOS);
  assert.equal(activacion['timeout-minutes'], TOPE_ACTIVACION_MINUTOS);
  assert.equal(objeto(objeto(leer('calidad').jobs).calidad)['timeout-minutes'], TOPE_CALIDAD_MINUTOS);
});

test('ningún job pasa del tope de seis horas de los ejecutores alojados de GitHub', () => {
  for (const nombre of ['actualizar', 'calidad']) {
    for (const [id, job] of Object.entries(objeto(leer(nombre).jobs))) {
      assert.ok(Number(objeto(job)['timeout-minutes']) <= TOPE_GITHUB_MINUTOS, `${nombre}.yml, job ${id}`);
    }
  }
});

/** Lee una constante entera de un módulo Python, escrita como producto de enteros (`55 * 60`). */
function constantePython(ruta: string, nombre: string): number {
  const fuente = readFileSync(new URL(`../../${ruta}`, import.meta.url), 'utf8');
  const valor = new RegExp(`^${nombre} = (\\d+(?: \\* \\d+)*)$`, 'm').exec(fuente)?.[1];
  assert.ok(valor, `${nombre} en ${ruta}`);
  return valor.split(' * ').reduce((total, factor) => total * Number(factor), 1);
}
/** Lee una constante decimal de un módulo Python, escrita con punto (`1.54`). */
function decimalPython(ruta: string, nombre: string): number {
  const fuente = readFileSync(new URL(`../../${ruta}`, import.meta.url), 'utf8');
  const valor = new RegExp(`^${nombre} = (\\d+\\.\\d+)$`, 'm').exec(fuente)?.[1];
  assert.ok(valor, `${nombre} en ${ruta}`);
  return Number(valor);
}

test('el plazo del motor y los de las suites llevan sus medidas al mismo runner lento', () => {
  assert.equal(decimalPython(MEDIDAS, 'VARIACION_DEL_RUNNER'), VARIACION_DEL_RUNNER);
});
/**
 * Lo que tardó el supervisor antes del motor en el último ciclo real completo (descargar y restaurar la base), con el
 * mismo margen que el plazo del motor y en minutos enteros, como los cuenta GitHub.
 */
function antesDelMotorConMargen(): number {
  const medido = constantePython(MEDIDAS, 'ANTES_DEL_MOTOR_S') / SEGUNDOS_POR_MINUTO;
  return Math.ceil((medido * (POR_CIENTO + constantePython(MEDIDAS, 'MARGEN_POR_CIENTO'))) / POR_CIENTO);
}
/** El plazo del supervisor que calcula el workflow con la preparación más lenta que admite su paso. */
function supervisorMinimo(candidato: Record<string, unknown>, tope: number): number {
  const herramientas = pasos(candidato).find((p) => p.id === 'herramientas');
  assert.ok(herramientas);
  const runner = mkdtempSync(join(realpathSync(tmpdir()), 'supervisor minimo '));
  try {
    const salida = join(runner, 'salida');
    writeFileSync(salida, '');
    const segundos = Number(herramientas['timeout-minutes']) * SEGUNDOS_POR_MINUTO;
    const guion = texto(herramientas.run).replace(/^bash .*$/m, `SECONDS=${segundos}`);
    const env = {
      PATH: '/usr/bin:/bin',
      GITHUB_OUTPUT: salida,
      FARO_TOPE_CANDIDATO_MINUTOS: String(tope),
      FARO_NAVEGADORES_EN_EL_CICLO: 'si',
    };
    const r = ejecutar(guion, env);
    assert.equal(r.status, 0, r.stderr);
    return Number(/^minutos_supervisor=(\d+)$/m.exec(readFileSync(salida, 'utf8'))?.[1]);
  } finally {
    rmSync(runner, { recursive: true, force: true });
  }
}

test('los topes del workflow, el límite del servidor y el plazo del motor no se contradicen', () => {
  const { raiz, candidato, activacion, aviso } = jobsDelCiclo();
  const tope = Number(objeto(raiz.env).FARO_TOPE_CANDIDATO_MINUTOS);
  const activar = Number(activacion['timeout-minutes']);
  const avisar = Number(aviso['timeout-minutes']);
  const antesDelMotor = antesDelMotorConMargen();
  const motor = constantePython(EJECUTOR, 'PLAZO_CANDIDATO_S') / SEGUNDOS_POR_MINUTO;
  // Tras el motor, el supervisor lee la generación, exporta y conserva el artefacto y envía el recibo.
  const despuesDelMotor =
    (constantePython(ALMACEN, 'PLAZO_LECTURA_S') +
      constantePython(EJECUTOR, 'PLAZO_ARTEFACTO_S') +
      constantePython(ALMACEN, 'PLAZO_SUBIDA_S')) /
      SEGUNDOS_POR_MINUTO +
    MINUTOS_RECIBO;
  const supervisor = supervisorMinimo(candidato, tope);
  const contradicciones = [
    ...(Number(candidato['timeout-minutes']) === tope ? [] : ['timeout-minutes del candidato en actualizar.yml']),
    ...(tope + activar + avisar === MINUTOS_LIMITE_WORKFLOW_ACTUALIZAR
      ? []
      : [
          `MINUTOS_LIMITE_WORKFLOW_ACTUALIZAR en src/administracion/programacion-trabajos.ts (${tope + activar + avisar})`,
        ]),
    ...(PLAZO_RESERVA_PROGRAMADA_MS === (MINUTOS_LIMITE_WORKFLOW_ACTUALIZAR + MINUTOS_MARGEN_RESERVA) * MS_POR_MINUTO
      ? []
      : [`PLAZO_RESERVA_PROGRAMADA_MS: los tres jobs del workflow más ${MINUTOS_MARGEN_RESERVA} minutos`]),
    // El tope del candidato es justo el que deja al supervisor lo que necesita: ni le falta ni sobra presupuesto.
    ...(antesDelMotor + motor + despuesDelMotor === supervisor
      ? []
      : [
          `FARO_TOPE_CANDIDATO_MINUTOS en actualizar.yml (${tope - supervisor + antesDelMotor + motor + despuesDelMotor})`,
        ]),
    ...(tope <= TOPE_GITHUB_MINUTOS ? [] : [`PLAZO_CANDIDATO_S en ${EJECUTOR}: el job no cabe en seis horas`]),
  ];
  assert.deepEqual(contradicciones, [], `Faltan por ajustar: ${contradicciones.join('; ')}`);
});

test('el ciclo instala los navegadores según una sola variable, que hoy los pide', () => {
  const { raiz, candidato } = jobsDelCiclo();
  assert.equal(objeto(raiz.env).FARO_NAVEGADORES_EN_EL_CICLO, 'si');
  const motores = pasos(candidato).find((p) => p.run === MOTORES_CICLO);
  assert.ok(motores);
  for (const [valor, instala] of [
    ['si', true],
    ['no', false],
  ] as const) {
    assert.equal(runInNewContext(condicion(motores), { env: { FARO_NAVEGADORES_EN_EL_CICLO: valor } }), instala);
  }
});

test('los dos jobs del ciclo anotan su inicio primero y anuncian sus minutos al final, también tras un fallo', () => {
  const { candidato, activacion } = jobsDelCiclo();
  for (const job of [candidato, activacion]) {
    const lista = pasos(job);
    assert.equal(lista[0]?.name, INICIO);
    assert.equal(lista.at(-1)?.name, MINUTOS);
    assert.equal(condicion(objeto(lista.at(-1))), 'always()');
    assert.deepEqual(job.permissions, { contents: 'read', 'id-token': 'write' });
  }
});

test('el aviso de minutos redondea hacia arriba la duración del job', (t) => {
  const { candidato } = jobsDelCiclo();
  const lista = pasos(candidato);
  const runner = mkdtempSync(join(realpathSync(tmpdir()), 'minutos del job '));
  t.after(() => rmSync(runner, { recursive: true, force: true }));
  // Las entradas de un despacho del servidor: el primer paso solo detiene un run a demanda mal lanzado.
  const env = {
    PATH: '/usr/bin:/bin',
    RUNNER_TEMP: runner,
    GITHUB_JOB: 'candidato',
    ENTRADA_A_DEMANDA: 'false',
    ENTRADA_REANUDAR: 'false',
    ENTRADA_ENSAYO: 'ninguno',
    ENTRADA_SOLICITUD_ID: '12345678-1234-4234-8234-123456789abc',
    ENTRADA_REVISION_RESERVA: '7',
  };
  const inicio = ejecutar(texto(lista[0]?.run), env);
  assert.equal(inicio.status, 0, inicio.stderr);
  const anotado = Number(readFileSync(join(runner, 'inicio-del-job'), 'utf8'));
  assert.ok(Number.isInteger(anotado));
  writeFileSync(join(runner, 'inicio-del-job'), `${anotado - SEGUNDOS_TRANSCURRIDOS}\n`);
  const aviso = ejecutar(texto(lista.at(-1)?.run), env);
  assert.equal(aviso.status, 0, aviso.stderr);
  assert.equal(
    aviso.stdout,
    `::notice title=Minutos del job::El job candidato ha durado ${MINUTOS_COBRADOS} minutos.\n`,
  );
});

test('calidad cancela la ejecución superada de su rama y no se repite por cada petición de cambios', () => {
  const raiz = leer('calidad');
  assert.deepEqual(Object.keys(objeto(raiz.on)), ['push', 'workflow_dispatch']);
  assert.deepEqual(raiz.concurrency, { group: `calidad-\${{ github.ref }}`, 'cancel-in-progress': true });
});

test('calidad comprueba tipos, estilo y juntas antes de preparar navegadores y baterías', () => {
  const ordenes = pasos(objeto(objeto(leer('calidad').jobs).calidad)).map((p) => texto(p.run));
  const rapidas = ordenes.findIndex((o) => o.includes('npm run tipos'));
  const rapida = ordenes[rapidas] ?? '';
  for (const orden of ['npm run juntas:comprobar', 'npm run estilo', 'ruff check .', 'ruff format --check .']) {
    assert.ok(rapida.includes(orden), orden);
  }
  assert.ok(rapidas > ordenes.findIndex((o) => o.includes('preparar-runner.sh')));
  assert.ok(rapidas < ordenes.indexOf(MOTORES_CALIDAD));
  assert.ok(rapidas < ordenes.findIndex((o) => o.includes('npm run verificar')));
});
