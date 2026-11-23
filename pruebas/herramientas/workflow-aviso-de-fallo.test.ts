import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { parseDocument } from 'yaml';

const ARCHIVO = new URL('../../.github/workflows/actualizar.yml', import.meta.url);
const PLAZO_MS = 10_000;
const PERMISOS_EJECUTABLE = 0o755;
const PASO = 'Abrir, comentar o cerrar la incidencia del ciclo';
const PASO_RESUMEN = 'Anotar en el resumen que el aviso ha fallado';
const ENLACE = 'https://github.com/propietario/repositorio/actions/runs/987654';
const SEPARADOR_ARGUMENTO = '\u001f';
const SEPARADOR_ORDEN = '\u001e';

/** Una orden `gh` falsa: anota cada llamada y responde con lo que fija cada caso, sin tocar la red. */
const GH_FALSO = `#!/bin/bash
printf '%s\\037' "$@" >> "$REGISTRO_GH"
printf '\\036' >> "$REGISTRO_GH"
if [[ "\${FALSO_GH_FALLA:-}" == "$1 $2" ]]; then exit 1; fi
case "$1 $2" in
  "issue list") printf '%s' "\${FALSO_ABIERTA:-}" ;;
  "api repos/propietario/repositorio/actions/runs/987654/attempts/1/jobs") printf '%s' "\${FALSO_TRABAJO:-}" ;;
  "api repos/propietario/repositorio/check-runs/555/annotations") printf '%s' "\${FALSO_AVISOS:-}" ;;
esac
`;

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
  const aviso = objeto(jobs.aviso);
  assert.ok(Array.isArray(aviso.steps));
  return { raiz, jobs, aviso, pasos: aviso.steps.map(objeto) };
}
function paso(nombre: string): Record<string, unknown> {
  const encontrado = workflow().pasos.find((p) => p.name === nombre);
  assert.ok(encontrado, nombre);
  return encontrado;
}
function entornoDelPaso(p: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(objeto(p.env ?? {})).map(([k, v]) => [k, texto(v)]));
}
function condicion(valor: unknown): string {
  const expresion = /^\$\{\{\s*([\s\S]+?)\s*\}\}$/.exec(texto(valor))?.[1];
  assert.ok(expresion);
  return expresion;
}

test('el trabajo de aviso solo escribe incidencias y no recibe secretos, variables ni identidad', () => {
  const { raiz, jobs, aviso, pasos } = workflow();
  assert.deepEqual(aviso.permissions, { issues: 'write' });
  assert.deepEqual(aviso.needs, ['candidato', 'activacion']);
  assert.equal(aviso['timeout-minutes'], 2);
  assert.equal(aviso.uses, undefined);
  assert.equal(aviso.env, undefined);
  assert.equal(aviso.outputs, undefined);
  assert.equal(aviso.concurrency, undefined);
  // Los permisos del resto del workflow no cambian.
  assert.deepEqual(raiz.permissions, {});
  for (const nombre of ['candidato', 'activacion']) {
    assert.deepEqual(objeto(jobs[nombre]).permissions, { contents: 'read', 'id-token': 'write' });
  }
  assert.deepEqual(
    pasos.map((p) => p.name),
    [PASO, PASO_RESUMEN],
  );
  for (const p of pasos) {
    assert.equal(p.uses, undefined);
    assert.doesNotMatch(texto(p.run), /\$\{\{/);
    assert.doesNotMatch(texto(p.run), /\bgit\b|checkout/);
    for (const valor of Object.values(entornoDelPaso(p))) {
      assert.doesNotMatch(valor, /secrets\.|vars\.|id-token|inputs\.(?!a_demanda)/);
    }
  }
  assert.deepEqual(Object.keys(entornoDelPaso(paso(PASO))).sort(), [
    'ENTRADA_A_DEMANDA',
    'GH_REPO',
    'GH_TOKEN',
    'RESULTADO_ACTIVACION',
    'RESULTADO_CANDIDATO',
    'RESULTADO_CICLO',
  ]);
});

test('el aviso corre siempre, también tras un fallo, salvo en los ensayos', () => {
  const { aviso } = workflow();
  const decide = (ensayo: string | undefined, cancelado: boolean) =>
    runInNewContext(condicion(aviso.if), {
      always: () => true,
      cancelled: () => cancelado,
      inputs: { ensayo },
    });
  for (const cancelado of [false, true]) {
    assert.equal(decide('ninguno', cancelado), true);
    assert.equal(decide('', cancelado), true);
    assert.equal(decide('preparar', cancelado), false);
    assert.equal(decide('simular', cancelado), false);
  }
});

test('si el aviso falla, el resultado de la actualización no cambia y el resumen lo dice', () => {
  const { aviso } = workflow();
  assert.equal(aviso['continue-on-error'], true);
  const incidencia = paso(PASO);
  assert.equal(incidencia['continue-on-error'], true);
  assert.equal(incidencia.id, 'incidencia');
  const resumen = paso(PASO_RESUMEN);
  assert.equal(condicion(resumen.if), "steps.incidencia.outcome == 'failure'");
  assert.match(texto(resumen.run), /GITHUB_STEP_SUMMARY/);
  assert.match(texto(resumen.run), /El resultado de la actualización no cambia/);
});

interface Caso {
  candidato: string;
  activacion: string;
  /** Número de la incidencia abierta con la etiqueta fija; vacío si no hay. */
  abierta?: string;
  /** Salida `resultado_ciclo` del candidato; por defecto, un ciclo validado. */
  resultado?: string;
  aDemanda?: boolean;
  avisos?: string;
  fallaGh?: string;
}
interface Resultado {
  estado: number | null;
  ordenes: string[][];
  resumen: string;
  stderr: string;
}
function ejecutar(t: { after: (f: () => void) => void }, caso: Caso, guion = texto(paso(PASO).run)): Resultado {
  const carpeta = mkdtempSync(join(realpathSync(tmpdir()), 'aviso de fallo '));
  t.after(() => rmSync(carpeta, { recursive: true, force: true }));
  const registro = join(carpeta, 'registro');
  const resumen = join(carpeta, 'resumen');
  writeFileSync(registro, '');
  writeFileSync(resumen, '');
  writeFileSync(join(carpeta, 'gh'), GH_FALSO);
  chmodSync(join(carpeta, 'gh'), PERMISOS_EJECUTABLE);
  const r = spawnSync('/bin/bash', ['--noprofile', '--norc', '-euo', 'pipefail', '-c', guion], {
    env: {
      PATH: `${carpeta}:/usr/bin:/bin`,
      REGISTRO_GH: registro,
      GITHUB_STEP_SUMMARY: resumen,
      GITHUB_SERVER_URL: 'https://github.com',
      GITHUB_REPOSITORY: 'propietario/repositorio',
      GITHUB_RUN_ID: '987654',
      GITHUB_RUN_ATTEMPT: '1',
      GH_TOKEN: 'sin-valor',
      GH_REPO: 'propietario/repositorio',
      RESULTADO_CANDIDATO: caso.candidato,
      RESULTADO_ACTIVACION: caso.activacion,
      RESULTADO_CICLO: caso.resultado ?? 'validado',
      ENTRADA_A_DEMANDA: String(caso.aDemanda ?? false),
      FALSO_ABIERTA: caso.abierta ?? '',
      FALSO_TRABAJO: '555',
      FALSO_AVISOS: caso.avisos ?? '',
      FALSO_GH_FALLA: caso.fallaGh ?? '',
    },
    encoding: 'utf8',
    timeout: PLAZO_MS,
  });
  const ordenes = readFileSync(registro, 'utf8')
    .split(SEPARADOR_ORDEN)
    .filter((o) => o !== '')
    .map((o) => o.split(SEPARADOR_ARGUMENTO).slice(0, -1));
  return { estado: r.status, ordenes, resumen: readFileSync(resumen, 'utf8'), stderr: r.stderr };
}
/** Las órdenes que cambian algo en GitHub: todo lo que no es leer. */
function escrituras(r: Resultado): string[] {
  return r.ordenes.map((o) => o.slice(0, 2).join(' ')).filter((o) => !/^(issue list|api )/.test(o));
}
function argumento(r: Resultado, orden: string, opcion: string): string {
  const llamada = r.ordenes.find((o) => o.slice(0, 2).join(' ') === orden);
  assert.ok(llamada, orden);
  const posicion = llamada.indexOf(opcion);
  assert.ok(posicion >= 0, opcion);
  return llamada[posicion + 1] ?? '';
}

test('un ciclo que falla sin incidencia abierta abre una con fecha, trabajo y enlace', (t) => {
  const r = ejecutar(t, { candidato: 'failure', activacion: 'skipped' });
  assert.equal(r.estado, 0, r.stderr);
  assert.deepEqual(escrituras(r), ['label create', 'issue create']);
  assert.match(argumento(r, 'issue create', '--title'), /^La actualización de datos ha fallado \(\d{4}-\d{2}-\d{2}\)$/);
  assert.equal(argumento(r, 'issue create', '--label'), 'actualizacion-fallida');
  assert.match(
    argumento(r, 'issue create', '--body'),
    new RegExp(
      `^El ciclo de actualización del \\d{4}-\\d{2}-\\d{2} a las \\d{2}:\\d{2} UTC no ha terminado bien\\.\\n\\n` +
        `Ha fallado el trabajo «candidato»\\.\\n\\nEjecución: ${ENLACE}\\n\\n` +
        `Esta incidencia se cierra sola cuando un ciclo posterior termina bien\\.$`,
    ),
  );
  assert.match(r.resumen, /Se ha abierto una incidencia/);
});

test('un ciclo que falla con una incidencia abierta añade un comentario y no abre otra', (t) => {
  const r = ejecutar(t, { candidato: 'success', activacion: 'failure', abierta: '7' });
  assert.equal(r.estado, 0, r.stderr);
  assert.deepEqual(escrituras(r), ['issue comment']);
  assert.equal(r.ordenes.find((o) => o[1] === 'comment')?.[2], '7');
  assert.match(
    argumento(r, 'issue comment', '--body'),
    new RegExp(
      `^El ciclo del .+ UTC ha vuelto a fallar\\.\\n\\nHa fallado el trabajo «activación»\\.\\n\\nEjecución: ${ENLACE}$`,
    ),
  );
});

test('un trabajo cancelado cuenta como fallo y, si fallan los dos, el cuerpo nombra los dos', (t) => {
  const r = ejecutar(t, { candidato: 'cancelled', activacion: 'failure' });
  assert.deepEqual(escrituras(r), ['label create', 'issue create']);
  assert.match(argumento(r, 'issue create', '--body'), /Han fallado los trabajos «candidato» y «activación»\./);
});

test('un ciclo validado o sin pendientes cierra la incidencia abierta con un comentario', (t) => {
  for (const resultado of ['validado', 'sin-pendientes']) {
    for (const activacion of ['success', 'skipped']) {
      const r = ejecutar(t, { candidato: 'success', activacion, abierta: '7', resultado });
      assert.equal(r.estado, 0, r.stderr);
      assert.deepEqual(escrituras(r), ['issue close']);
      assert.equal(r.ordenes.find((o) => o[1] === 'close')?.[2], '7');
      assert.match(argumento(r, 'issue close', '--comment'), /^El ciclo del \d{4}-\d{2}-\d{2} terminó bien\.$/);
    }
  }
});

test('un ciclo que termina bien sin incidencia abierta no toca nada', (t) => {
  assert.deepEqual(escrituras(ejecutar(t, { candidato: 'success', activacion: 'success' })), []);
  assert.deepEqual(
    escrituras(ejecutar(t, { candidato: 'success', activacion: 'success', resultado: 'sin-pendientes' })),
    [],
  );
});

test('un ciclo rechazado, aunque ningún trabajo falle, abre una incidencia con fecha y enlace', (t) => {
  const r = ejecutar(t, { candidato: 'success', activacion: 'success', resultado: 'rechazado' });
  assert.equal(r.estado, 0, r.stderr);
  assert.deepEqual(escrituras(r), ['label create', 'issue create']);
  assert.match(
    argumento(r, 'issue create', '--title'),
    /^La actualización de datos terminó sin publicar datos nuevos \(\d{4}-\d{2}-\d{2}\)$/,
  );
  assert.equal(argumento(r, 'issue create', '--label'), 'actualizacion-fallida');
  assert.match(
    argumento(r, 'issue create', '--body'),
    new RegExp(
      `^La actualización del \\d{4}-\\d{2}-\\d{2} a las \\d{2}:\\d{2} UTC terminó sin publicar datos nuevos\\.\\n\\n` +
        `El motivo consta en el diario de la ejecución: ${ENLACE}\\n\\n` +
        `Esta incidencia se cierra sola cuando un ciclo posterior termina bien\\.$`,
    ),
  );
  assert.match(r.resumen, /Se ha abierto una incidencia/);
});

test('un ciclo rechazado con una incidencia abierta añade un comentario y no abre otra', (t) => {
  const r = ejecutar(t, { candidato: 'success', activacion: 'skipped', abierta: '7', resultado: 'rechazado' });
  assert.equal(r.estado, 0, r.stderr);
  assert.deepEqual(escrituras(r), ['issue comment']);
  assert.equal(r.ordenes.find((o) => o[1] === 'comment')?.[2], '7');
  assert.match(
    argumento(r, 'issue comment', '--body'),
    new RegExp(
      `^La actualización del .+ UTC ha vuelto a terminar sin publicar datos nuevos\\.\\n\\n` +
        `El motivo consta en el diario de la ejecución: ${ENLACE}$`,
    ),
  );
});

test('si no consta cómo terminó el ciclo, no se abre ni se cierra nada y el resumen lo dice', (t) => {
  for (const resultado of ['', 'otro', 'Rechazado']) {
    for (const abierta of ['', '7']) {
      const r = ejecutar(t, { candidato: 'success', activacion: 'success', abierta, resultado });
      assert.equal(r.estado, 0, r.stderr);
      assert.deepEqual(escrituras(r), []);
      assert.match(r.resumen, /No consta cómo terminó el ciclo/);
    }
  }
  const sinEjecutar = ejecutar(t, { candidato: 'skipped', activacion: 'skipped', abierta: '7', resultado: '' });
  assert.deepEqual(escrituras(sinEjecutar), []);
});

test('un fallo sigue avisando aunque el resultado del ciclo sea validado o falte', (t) => {
  for (const resultado of ['validado', '']) {
    const r = ejecutar(t, { candidato: 'success', activacion: 'failure', resultado });
    assert.deepEqual(escrituras(r), ['label create', 'issue create']);
  }
});

test('una reserva negada por el servidor con un motivo no es un fallo: no abre, no comenta y no cierra', (t) => {
  for (const abierta of ['', '7']) {
    const r = ejecutar(t, {
      candidato: 'failure',
      activacion: 'skipped',
      aDemanda: true,
      abierta,
      avisos: 'rechazada motivo=ocupado',
    });
    assert.equal(r.estado, 0, r.stderr);
    assert.deepEqual(escrituras(r), []);
    assert.match(r.resumen, /no concedió la reserva/);
  }
});

test('una reserva que falla sin un motivo del servidor, o sin poder comprobarlo, sí es un fallo', (t) => {
  const fallo = { candidato: 'failure', activacion: 'skipped', aDemanda: true } as const;
  const abren = ['label create', 'issue create'];
  assert.deepEqual(escrituras(ejecutar(t, { ...fallo, avisos: 'El servidor no ha concedido la reserva.' })), abren);
  assert.deepEqual(
    escrituras(
      ejecutar(t, { ...fallo, avisos: '', fallaGh: 'api repos/propietario/repositorio/check-runs/555/annotations' }),
    ),
    abren,
  );
  assert.deepEqual(
    escrituras(
      ejecutar(t, {
        ...fallo,
        avisos: 'rechazada motivo=ocupado',
        fallaGh: 'api repos/propietario/repositorio/actions/runs/987654/attempts/1/jobs',
      }),
    ),
    abren,
  );
});

test('fuera de un run a demanda no se consulta la reserva: el fallo se avisa siempre', (t) => {
  const r = ejecutar(t, { candidato: 'failure', activacion: 'skipped', avisos: 'rechazada motivo=ocupado' });
  assert.deepEqual(escrituras(r), ['label create', 'issue create']);
  assert.equal(r.ordenes.filter((o) => o[0] === 'api').length, 0);
});

test('si la API de GitHub falla, el paso termina con error para que el resumen lo cuente', (t) => {
  const r = ejecutar(t, { candidato: 'failure', activacion: 'skipped', fallaGh: 'issue list' });
  assert.notEqual(r.estado, 0);
  assert.deepEqual(escrituras(r), []);
  const resumen = ejecutar(t, { candidato: 'failure', activacion: 'skipped' }, texto(paso(PASO_RESUMEN).run));
  assert.equal(resumen.estado, 0, resumen.stderr);
  assert.match(resumen.resumen, /No se ha podido abrir, actualizar ni cerrar la incidencia del ciclo/);
});

test('el texto de la incidencia solo usa la fecha, qué pasó y el enlace: nada del run ni de personas', () => {
  const orden = texto(paso(PASO).run);
  assert.doesNotMatch(orden, /github\.(actor|triggering_actor|event)|GITHUB_(ACTOR|TRIGGERING_ACTOR|EVENT)/);
  const cuerpos = [...orden.matchAll(/printf '[^']*' ([^\n)]*)\)/g)].map((m) => m[1]);
  assert.deepEqual(cuerpos, [
    '"$momento" "$quien" "$enlace"',
    '"$momento" "$quien" "$enlace"',
    '"$momento" "$enlace"',
    '"$momento" "$enlace"',
  ]);
});
