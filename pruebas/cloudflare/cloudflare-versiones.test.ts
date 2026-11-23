import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  crearEjecutorWrangler,
  type EjecutorWrangler,
  ErrorVersionesCloudflare,
  ejecutarVersionesCloudflare,
  type OrdenWrangler,
  respuestaAcotada,
} from '../../herramientas/cloudflare/versiones.ts';
import { versionDelPaquete } from '../../src/plataforma/paquete-publicado.ts';

const INTENCION = '11111111-1111-4111-8111-111111111111';
const VERSION = '22222222-2222-4222-8222-222222222222';
const ANTERIOR = '33333333-3333-4333-8333-333333333333';
const DEPLOYMENT = '44444444-4444-4444-8444-444444444444';
const REVISION = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const REVISION_AJENA = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const ID_CUENTA = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const ID_NAMESPACE = 'cccccccccccccccccccccccccccccccc';
const DIRECTORIO_PRIVADO = 0o700;
const PUBLICO = 0o644;
const LLAMADAS_DEPLOY = 3;
const PRIVADO = 0o600;
const PLAZO_MS = 5_000;
const MAX_SALIDA = 16_777_216;
const PLAZO_LECTURA_MS = 30_000;
const PLAZO_MUTACION_MS = 120_000;
const MAX_SALIDA_RESPUESTA = 16_384;
function sha(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
function bytes(valor: unknown): Buffer {
  return Buffer.from(JSON.stringify(valor));
}
function contenidos(conCursos: boolean) {
  const dato = bytes({ uno: 1 }),
    manifiesto = bytes({ 'uno.json': { sha256: sha(dato) } });
  const paquete = versionDelPaquete(sha(manifiesto)),
    motor = bytes({ motor: 1 });
  const archivos = new Map<string, Buffer>([
    ['worker/worker.mjs', Buffer.from("import datos from './datos/uno.json'; export default datos;")],
    ['worker/datos/uno.json', dato],
    ['web/index.html', Buffer.from('<!doctype html>')],
    ['web/motor/entrada.js', motor],
    [`web/paquete/${paquete}/manifiesto.json`, manifiesto],
    [`web/paquete/${paquete}/uno.json`, dato],
  ]);
  if (conCursos) {
    archivos.set(
      'worker-cursos/worker.mjs',
      Buffer.from("import datos from './datos/uno.json'; export default datos;"),
    );
    archivos.set('worker-cursos/datos/uno.json', dato);
  }
  const dispositivo = {
    formato: 1,
    paquete,
    archivos: Object.fromEntries(
      [...archivos]
        .filter(([p]) => p.startsWith('web/motor/') || p.startsWith('web/paquete/'))
        .map(([p, b]) => [p.slice('web/'.length), sha(b)]),
    ),
  };
  archivos.set('web/firmas/manifiesto.json', bytes(dispositivo));
  return { archivos, paquete, manifiesto, dispositivo };
}
/** El principal de ejemplo con enlaces, variables y secretos de la entidad, que el adaptador conserva sin imprimir. */
function escribirConfiguracionPrincipal(padre: string) {
  const configuracion = JSON.parse(
    readFileSync(new URL('../../config/cloudflare/wrangler.example.jsonc', import.meta.url), 'utf8'),
  );
  configuracion.account_id = ID_CUENTA;
  configuracion.vars = { ENTIDAD: 'privada-no-imprimir' };
  configuracion.kv_namespaces = [{ binding: 'OTRO', id: ID_NAMESPACE }];
  configuracion.secrets = { required: ['SECRETO_REMOTO'] };
  const config = join(padre, 'entidad.json');
  writeFileSync(config, bytes(configuracion), { mode: PRIVADO });
  return { configuracion, config };
}
/** La pareja de la instalación: el binding CURSOS del ejemplo principal apunta al `name` del ejemplo de Cursos. */
function escribirConfiguracionCursos(padre: string) {
  const configuracionCursos = JSON.parse(
    readFileSync(new URL('../../config/cloudflare/wrangler.cursos.example.jsonc', import.meta.url), 'utf8'),
  );
  configuracionCursos.account_id = ID_CUENTA;
  const configCursos = join(padre, 'cursos.json');
  writeFileSync(configCursos, bytes(configuracionCursos), { mode: PRIVADO });
  return { configuracionCursos, configCursos };
}
function fixture(conCursos = true) {
  const padre = mkdtempSync(join(realpathSync(tmpdir()), 'versiones Año 2026-'));
  const artefacto = join(padre, 'artefacto'),
    { archivos, paquete, manifiesto, dispositivo } = contenidos(conCursos);
  for (const [ruta, contenido] of archivos) {
    mkdirSync(dirname(join(artefacto, ruta)), { recursive: true });
    writeFileSync(join(artefacto, ruta), contenido);
  }
  const descriptor = bytes({
    version: 1,
    revisionCodigo: REVISION,
    huellaPaquete: paquete,
    sha256ManifiestoPaquete: sha(manifiesto),
    sha256ManifiestoDispositivo: sha(bytes(dispositivo)),
    archivos: [...archivos]
      .sort(([a], [b]) => a.localeCompare(b, 'en'))
      .map(([ruta, b]) => ({ ruta, bytes: b.length, sha256: sha(b) })),
  });
  writeFileSync(join(artefacto, 'artefacto.json'), descriptor);
  const { configuracion, config } = escribirConfiguracionPrincipal(padre);
  const { configuracionCursos, configCursos } = escribirConfiguracionCursos(padre);
  const solicitud = {
    version: 1,
    operacion: 'subir',
    servicio: 'principal',
    intencionId: INTENCION,
    configuracion: config,
    configuracionCursos: configCursos,
    artefacto: { ruta: artefacto, revisionCodigo: REVISION, huellaPaquete: paquete, sha256Artefacto: sha(descriptor) },
  };
  return {
    padre,
    artefacto,
    configuracion,
    configuracionCursos,
    solicitud,
    archivos,
    limpiar: () => rmSync(padre, { recursive: true, force: true }),
  };
}
function salida(orden: OrdenWrangler, valor: unknown, registro?: unknown): { status: number } {
  writeFileSync(orden.stdout, JSON.stringify(valor), { mode: PRIVADO });
  writeFileSync(orden.stderr, 'log privado-no-imprimir', { mode: PRIVADO });
  if (registro !== undefined) {
    writeFileSync(orden.ndjson, `${JSON.stringify(registro)}\n`);
  }
  return { status: 0 };
}
function deployment(id = ANTERIOR, versionId = VERSION) {
  return { id, versions: [{ version_id: versionId, percentage: 100 }], author_email: 'privado@example.invalid' };
}
function evento(tipo: string, identificador = VERSION) {
  return {
    type: tipo,
    version: 1,
    worker_name: 'faro',
    version_id: identificador,
    deployment_id: identificador,
    version_traffic: {},
  };
}
function comprobarArgumentos(orden: OrdenWrangler, esperados: string[]): void {
  assert.deepEqual(orden.argumentos.slice(0, esperados.length), esperados);
}
function comprobarUpload(f: ReturnType<typeof fixture>, orden: OrdenWrangler): void {
  const temporal = orden.cwd;
  const copia = JSON.parse(readFileSync(join(temporal, 'wrangler.json'), 'utf8'));
  assert.deepEqual(copia, {
    ...f.configuracion,
    main: join(f.artefacto, 'worker/worker.mjs'),
    base_dir: join(f.artefacto, 'worker'),
    assets: { ...f.configuracion.assets, directory: join(f.artefacto, 'web') },
  });
  assert.equal(lstatSync(temporal).mode & 0o777, DIRECTORIO_PRIVADO);
  assert.equal(lstatSync(join(temporal, 'wrangler.json')).mode & 0o777, PRIVADO);
  comprobarArgumentos(orden, [
    'versions',
    'upload',
    '--no-bundle',
    '--keep-vars',
    '--tag',
    INTENCION,
    '--message',
    f.solicitud.artefacto.sha256Artefacto,
    '--config',
  ]);
  assert.equal(orden.entorno.HOME, temporal);
  assert.equal(orden.entorno.WRANGLER_CI_OVERRIDE_NAME, undefined);
  assert.equal(orden.entorno.CLOUDFLARE_ENV, undefined);
  assert.equal(orden.entorno.HTTPS_PROXY, undefined);
  assert.equal(orden.entorno.HTTP_PROXY, undefined);
  assert.equal(orden.entorno.NO_PROXY, undefined);
  assert.equal(orden.entorno.NODE_EXTRA_CA_CERTS, undefined);
  assert.equal(readFileSync(join(temporal, 'vacio.env'), 'utf8'), '');
}
test('upload oficial conserva configuración completa y bytes, identifica UUID+SHA y aísla logs/rutas', () => {
  const f = fixture();
  let temporal = '';
  try {
    const original = readFileSync(f.solicitud.configuracion);
    const ejecutar: EjecutorWrangler = (orden) => {
      temporal = orden.cwd;
      comprobarUpload(f, orden);
      return salida(orden, 'log secreto', evento('version-upload'));
    };
    const resultado = ejecutarVersionesCloudflare(f.solicitud, ejecutar);
    assert.deepEqual(resultado.resultado, { versionId: VERSION });
    assert.deepEqual(resultado.artefacto, {
      revisionCodigo: REVISION,
      huellaPaquete: f.solicitud.artefacto.huellaPaquete,
      sha256Artefacto: f.solicitud.artefacto.sha256Artefacto,
    });
    assert.equal(JSON.stringify(resultado).includes('privado'), false);
    assert.deepEqual(readFileSync(f.solicitud.configuracion), original);
    for (const [ruta, contenido] of f.archivos) {
      assert.deepEqual(readFileSync(join(f.artefacto, ruta)), contenido);
    }
    assert.equal(existsSync(temporal), false);
  } finally {
    f.limpiar();
  }
});
test('configuración del limitador retirado rechaza antes de Wrangler y conserva los archivos', () => {
  const f = fixture();
  try {
    for (const ratelimits of [
      [],
      null,
      [{ name: 'LIMITADOR_IA', namespace_id: '1001', simple: { limit: 1, period: 60 } }],
    ]) {
      const original = bytes({ ...f.configuracion, ratelimits });
      writeFileSync(f.solicitud.configuracion, original);
      assert.throws(
        () => ejecutarVersionesCloudflare(f.solicitud, () => assert.fail('No debe invocar Wrangler')),
        /configuracion-incompatible/,
      );
      assert.deepEqual(readFileSync(f.solicitud.configuracion), original);
      for (const [ruta, contenido] of f.archivos) {
        assert.deepEqual(readFileSync(join(f.artefacto, ruta)), contenido);
      }
    }
  } finally {
    f.limpiar();
  }
});
test('fetch público es obligatorio antes de invocar Wrangler; no se admite el bypass al origen privado', () => {
  const f = fixture();
  try {
    for (const compatibility_flags of [
      undefined,
      [],
      ['global_fetch_private_origin'],
      ['global_fetch_strictly_public', 'global_fetch_private_origin'],
      ['global_fetch_strictly_public', 'global_fetch_strictly_public'],
      ['global_fetch_strictly_public', null],
    ]) {
      writeFileSync(f.solicitud.configuracion, bytes({ ...f.configuracion, compatibility_flags }));
      let llamadas = 0;
      assert.throws(
        () =>
          ejecutarVersionesCloudflare(f.solicitud, () => {
            llamadas++;
            return { status: 0 };
          }),
        /configuracion-incompatible/,
      );
      assert.equal(llamadas, 0);
    }
  } finally {
    f.limpiar();
  }
});
test('estado usa JSON oficial y versiones devuelve solo id/tag/message, nunca correo ni recursos', () => {
  const f = fixture();
  try {
    const resultado = ejecutarVersionesCloudflare({ ...f.solicitud, operacion: 'estado' }, (orden) => {
      comprobarArgumentos(orden, ['deployments', 'status', '--json']);
      return salida(orden, deployment());
    });
    assert.deepEqual(resultado.resultado, {
      deploymentId: ANTERIOR,
      versiones: [{ versionId: VERSION, porcentaje: 100 }],
    });
    const lista = ejecutarVersionesCloudflare({ ...f.solicitud, operacion: 'versiones' }, (orden) =>
      salida(orden, [
        {
          id: VERSION,
          annotations: { 'workers/tag': INTENCION, 'workers/message': f.solicitud.artefacto.sha256Artefacto },
          metadata: { author_email: 'privado' },
        },
        { id: ANTERIOR },
      ]),
    );
    assert.deepEqual(lista.resultado, {
      versiones: [
        { versionId: VERSION, tag: INTENCION, message: f.solicitud.artefacto.sha256Artefacto },
        { versionId: ANTERIOR, tag: null, message: null },
      ],
    });
  } finally {
    f.limpiar();
  }
});
test('deploy solo 100 %, coteja deployment anterior y acredita después reparto JSON real', () => {
  const f = fixture();
  let llamadas = 0;
  try {
    const resultado = ejecutarVersionesCloudflare(
      { ...f.solicitud, operacion: 'desplegar', versionId: VERSION, anteriorDeploymentId: ANTERIOR },
      (orden) => {
        llamadas++;
        if (orden.argumentos[0] === 'deployments') {
          return salida(orden, deployment(llamadas === 1 ? ANTERIOR : DEPLOYMENT));
        }
        comprobarArgumentos(orden, ['versions', 'deploy', `${VERSION}@100%`, '--yes']);
        return salida(orden, null, evento('version-deploy', DEPLOYMENT));
      },
    );
    assert.equal(llamadas, LLAMADAS_DEPLOY);
    assert.deepEqual(resultado.resultado, {
      deploymentId: DEPLOYMENT,
      versiones: [{ versionId: VERSION, porcentaje: 100 }],
    });
    llamadas = 0;
    assert.throws(
      () =>
        ejecutarVersionesCloudflare(
          { ...f.solicitud, operacion: 'desplegar', versionId: VERSION, anteriorDeploymentId: DEPLOYMENT },
          (orden) => {
            llamadas++;
            return salida(orden, deployment());
          },
        ),
      /deployment-distinto/,
    );
    assert.equal(llamadas, 1);
  } finally {
    f.limpiar();
  }
});
function activarConTriggers(f: ReturnType<typeof fixture>, crons: string[], operacion: 'subir' | 'desplegar') {
  let llamadas = 0;
  const subir = operacion === 'subir';
  const solicitud = subir
    ? f.solicitud
    : {
        ...f.solicitud,
        operacion,
        versionId: VERSION,
        anteriorDeploymentId: ANTERIOR,
      };
  ejecutarVersionesCloudflare(solicitud, (orden) => {
    llamadas++;
    const temporal = JSON.parse(readFileSync(join(orden.cwd, 'wrangler.json'), 'utf8'));
    assert.deepEqual(temporal.triggers, { crons });
    assert.ok(orden.argumentos[0] !== 'triggers');
    if (orden.argumentos[0] === 'deployments') {
      return salida(orden, deployment(llamadas === 1 ? ANTERIOR : DEPLOYMENT));
    }
    return salida(orden, null, evento(subir ? 'version-upload' : 'version-deploy', subir ? VERSION : DEPLOYMENT));
  });
  assert.equal(llamadas, subir ? 1 : LLAMADAS_DEPLOY);
}
test('upload y activación de versión conservan triggers explícitos, incluido apagado, sin invocar triggers deploy', () => {
  const f = fixture();
  try {
    for (const crons of [[], ['17 4 * * *']]) {
      const configuracion = { ...f.configuracion, triggers: { crons } };
      writeFileSync(f.solicitud.configuracion, bytes(configuracion));
      activarConTriggers(f, crons, 'subir');
      activarConTriggers(f, crons, 'desplegar');
      assert.deepEqual(JSON.parse(readFileSync(f.solicitud.configuracion, 'utf8')), configuracion);
    }
  } finally {
    f.limpiar();
  }
});
test('triggers rechaza forma abierta, varios crons y expresiones no canónicas antes de Wrangler', () => {
  const f = fixture();
  try {
    for (const triggers of [
      null,
      [],
      {},
      { crons: ['0 0 * * *', '1 1 * * *'] },
      { crons: ['00 0 * * *'] },
      { crons: ['0 0 * * 1'] },
      { crons: ['0 0 * * *'], extra: true },
    ]) {
      writeFileSync(f.solicitud.configuracion, bytes({ ...f.configuracion, triggers }));
      assert.throws(
        () => ejecutarVersionesCloudflare(f.solicitud, () => assert.fail('No invocar Wrangler')),
        /configuracion-incompatible/,
      );
    }
  } finally {
    f.limpiar();
  }
});
function defecto(orden: OrdenWrangler, modo: string): { status: number | null } {
  switch (modo) {
    case 'timeout':
      return { status: null };
    case 'error':
      throw new Error('SECRETO');
    case 'ausente':
      return salida(orden, null);
    case 'nombre':
      return salida(orden, null, { ...evento('version-upload'), worker_name: 'ajeno' });
    case 'version':
      return salida(orden, null, { ...evento('version-upload'), version: 2 });
    default: {
      const resultado = salida(orden, null);
      const registro = JSON.stringify(evento('version-upload'));
      writeFileSync(orden.ndjson, `${registro}\n${registro}\n`);
      return resultado;
    }
  }
}
test('timeout, error remoto y NDJSON faltante o duplicado no se reintentan ni afirman éxito', () => {
  const f = fixture();
  try {
    for (const modo of ['timeout', 'error', 'ausente', 'duplicado', 'nombre', 'version']) {
      let llamadas = 0,
        temporal = '';
      assert.throws(
        () =>
          ejecutarVersionesCloudflare(f.solicitud, (orden) => {
            llamadas++;
            temporal = orden.cwd;
            return defecto(orden, modo);
          }),
        /wrangler-incierto|resultado-invalido/,
      );
      assert.equal(llamadas, 1);
      assert.equal(existsSync(temporal), false);
    }
  } finally {
    f.limpiar();
  }
});
test('configuración incompatible y artefacto distinto o corrupto rechazan antes de Wrangler', () => {
  const f = fixture();
  const noInvocar: EjecutorWrangler = () => {
    assert.fail('No debe invocar Wrangler');
  };
  try {
    for (const campo of ['env', 'build', 'containers', 'text_blobs', 'find_additional_modules', 'desconocido']) {
      writeFileSync(f.solicitud.configuracion, bytes({ ...f.configuracion, [campo]: {} }));
      assert.throws(() => ejecutarVersionesCloudflare(f.solicitud, noInvocar), /configuracion-incompatible/);
    }
    writeFileSync(f.solicitud.configuracion, bytes(f.configuracion));
    assert.throws(
      () =>
        ejecutarVersionesCloudflare(
          { ...f.solicitud, artefacto: { ...f.solicitud.artefacto, revisionCodigo: REVISION_AJENA } },
          noInvocar,
        ),
      /artefacto-invalido/,
    );
    writeFileSync(join(f.artefacto, 'worker/worker.mjs'), 'corrupto');
    assert.throws(() => ejecutarVersionesCloudflare(f.solicitud, noInvocar), /artefacto-invalido/);
  } finally {
    f.limpiar();
  }
});
test('migración pendiente reconocida por Wrangler rechaza sin alternativa ni reintento', () => {
  const f = fixture();
  let llamadas = 0;
  try {
    assert.throws(
      () =>
        ejecutarVersionesCloudflare(f.solicitud, (orden) => {
          llamadas++;
          salida(orden, null);
          writeFileSync(
            orden.stderr,
            'This Worker has a pending Durable Object migration, which cannot be applied by `wrangler versions upload`.',
          );
          return { status: 1 };
        }),
      /configuracion-incompatible/,
    );
    assert.equal(llamadas, 1);
  } finally {
    f.limpiar();
  }
});
test('un NDJSON deploy exitoso no acredita reparto ni sustituye status oficial posterior', () => {
  const f = fixture();
  let llamadas = 0;
  try {
    assert.throws(
      () =>
        ejecutarVersionesCloudflare(
          { ...f.solicitud, operacion: 'desplegar', versionId: VERSION, anteriorDeploymentId: ANTERIOR },
          (orden) => {
            llamadas++;
            if (orden.argumentos[0] === 'versions') {
              return salida(orden, null, evento('version-deploy', DEPLOYMENT));
            }
            return salida(
              orden,
              deployment(llamadas === 1 ? ANTERIOR : DEPLOYMENT, llamadas === 1 ? VERSION : ANTERIOR),
            );
          },
        ),
      /resultado-invalido/,
    );
    assert.equal(llamadas, LLAMADAS_DEPLOY);
  } finally {
    f.limpiar();
  }
});
test('status/list rechazan identidad, porcentajes, duplicados y JSON ajenos sin filtrar proveedor', () => {
  const f = fixture();
  const invalidos = [
    { id: 'no-uuid', versions: [] },
    { id: DEPLOYMENT, versions: [{ version_id: VERSION, percentage: '100' }] },
    { id: DEPLOYMENT, versions: [{ version_id: VERSION, percentage: 99 }] },
    {
      id: DEPLOYMENT,
      versions: [
        { version_id: VERSION, percentage: 50 },
        { version_id: VERSION, percentage: 50 },
      ],
    },
  ];
  try {
    for (const valor of invalidos) {
      assert.throws(
        () => ejecutarVersionesCloudflare({ ...f.solicitud, operacion: 'estado' }, (orden) => salida(orden, valor)),
        /resultado-invalido/,
      );
    }
    assert.throws(
      () =>
        ejecutarVersionesCloudflare({ ...f.solicitud, operacion: 'versiones' }, (orden) =>
          salida(orden, [{ id: VERSION }, { id: VERSION }]),
        ),
      /resultado-invalido/,
    );
    assert.throws(
      () =>
        ejecutarVersionesCloudflare({ ...f.solicitud, operacion: 'estado' }, (orden) => {
          salida(orden, null);
          writeFileSync(orden.stdout, 'SECRETO: no JSON');
          return { status: 0 };
        }),
      /resultado-invalido/,
    );
  } finally {
    f.limpiar();
  }
});
test('CLI exige solicitud privada cerrada y devuelve solo error JSON corto sin secretos', () => {
  const f = fixture();
  try {
    const archivo = join(f.padre, 'solicitud.json');
    const cli = () =>
      spawnSync(
        process.execPath,
        [fileURLToPath(new URL('../../herramientas/cloudflare/versiones.ts', import.meta.url)), archivo],
        { encoding: 'utf8', timeout: PLAZO_MS, env: {} },
      );
    for (const valor of [
      { ...f.solicitud, token: 'SECRETO' },
      { ...f.solicitud, operacion: 'arbitrario' },
    ]) {
      writeFileSync(archivo, bytes(valor), { mode: PRIVADO });
      const resultado = cli();
      assert.equal(resultado.status, 1);
      assert.equal(resultado.stderr, '');
      assert.equal(resultado.stdout, '{"version":1,"error":"entrada-invalida","efecto":"ninguno"}\n');
    }
    writeFileSync(archivo, bytes(f.solicitud));
    chmodSync(archivo, PUBLICO);
    assert.equal(cli().stdout, '{"version":1,"error":"entrada-invalida","efecto":"ninguno"}\n');
    rmSync(archivo);
    symlinkSync(f.solicitud.configuracion, archivo);
    assert.equal(cli().stdout, '{"version":1,"error":"entrada-invalida","efecto":"ninguno"}\n');
  } finally {
    f.limpiar();
  }
});
test('el lanzador oficial acota stdout/stderr durante ejecución y aplica plazos distintos sin huérfanos', () => {
  const f = fixture();
  try {
    for (const stream of ['stdout', 'stderr']) {
      let llamadas = 0;
      const operacion = stream === 'stdout' ? 'subir' : 'estado';
      const ejecutar = crearEjecutorWrangler((_argumentos, opciones) => {
        llamadas++;
        assert.equal(opciones.maxBuffer, MAX_SALIDA);
        assert.equal(opciones.timeout, operacion === 'subir' ? PLAZO_MUTACION_MS : PLAZO_LECTURA_MS);
        const resultado = spawnSync(
          process.execPath,
          [
            '-e',
            'process[process.argv[1]].write(Buffer.alloc(Number(process.argv[2])))',
            stream,
            String(MAX_SALIDA * 2),
          ],
          opciones,
        );
        assert.equal((resultado.error as NodeJS.ErrnoException)?.code, 'ENOBUFS');
        assert.throws(() => process.kill(resultado.pid, 0), { code: 'ESRCH' });
        return resultado;
      });
      assert.throws(
        () =>
          ejecutarVersionesCloudflare({ ...f.solicitud, operacion }, (orden) => {
            const resultado = ejecutar(orden);
            assert.ok(lstatSync(orden.stdout).size <= MAX_SALIDA && lstatSync(orden.stderr).size <= MAX_SALIDA);
            return resultado;
          }),
        /wrangler-incierto/,
      );
      assert.equal(llamadas, 1);
    }
  } finally {
    f.limpiar();
  }
});

/** El Worker de Cursos con su configuración de ejemplo, completada con la cuenta como en una instalación real. */
function fixtureCursos(conCursos = true) {
  const f = fixture(conCursos);
  return { ...f, cursos: { ...f.solicitud, servicio: 'cursos' } };
}
test('Worker de Cursos: sube solo su carpeta del artefacto, sin la web, y dice a qué servicio responde', () => {
  const f = fixtureCursos();
  try {
    const ejecutar: EjecutorWrangler = (orden) => {
      const copia = JSON.parse(readFileSync(join(orden.cwd, 'wrangler.json'), 'utf8'));
      assert.deepEqual(copia, {
        ...f.configuracionCursos,
        main: join(f.artefacto, 'worker-cursos/worker.mjs'),
        base_dir: join(f.artefacto, 'worker-cursos'),
      });
      comprobarArgumentos(orden, ['versions', 'upload', '--no-bundle', '--keep-vars', '--tag', INTENCION]);
      return salida(orden, 'log', { ...evento('version-upload'), worker_name: 'faro-cursos' });
    };
    const resultado = ejecutarVersionesCloudflare(f.cursos, ejecutar);
    assert.equal(resultado.servicio, 'cursos');
    assert.deepEqual(resultado.resultado, { versionId: VERSION });
    assert.equal(
      ejecutarVersionesCloudflare(f.solicitud, (orden) => salida(orden, 'log', evento('version-upload'))).servicio,
      'principal',
    );
  } finally {
    f.limpiar();
  }
});
test('Worker de Cursos: un perfil ajeno, un servicio desconocido o un artefacto sin Cursos se rechazan sin Wrangler', () => {
  const f = fixtureCursos();
  const noInvocar: EjecutorWrangler = () => assert.fail('No debe invocar Wrangler');
  try {
    const ajenos = [
      { assets: f.configuracion.assets },
      { durable_objects: f.configuracion.durable_objects },
      { version_metadata: { binding: 'CF_VERSION_METADATA' } },
      { vars: { ENTIDAD: 'x' } },
      { routes: [{ pattern: 'faro.example/*' }] },
      { triggers: { crons: [] } },
      { workers_dev: true },
      { compatibility_flags: [] },
      { limits: { cpu_ms: 50 } },
    ];
    for (const ajeno of ajenos) {
      writeFileSync(f.cursos.configuracionCursos, bytes({ ...f.configuracionCursos, ...ajeno }));
      for (const solicitud of [f.cursos, f.solicitud]) {
        assert.throws(() => ejecutarVersionesCloudflare(solicitud, noInvocar), /configuracion-incompatible/);
      }
    }
    // Cada configuración en el lugar de la otra.
    writeFileSync(f.cursos.configuracionCursos, bytes(f.configuracion));
    assert.throws(() => ejecutarVersionesCloudflare(f.cursos, noInvocar), /configuracion-incompatible/);
    writeFileSync(f.cursos.configuracionCursos, bytes(f.configuracionCursos));
    writeFileSync(f.solicitud.configuracion, bytes(f.configuracionCursos));
    assert.throws(() => ejecutarVersionesCloudflare(f.solicitud, noInvocar), /configuracion-incompatible/);
    writeFileSync(f.solicitud.configuracion, bytes(f.configuracion));
    assert.throws(
      () => ejecutarVersionesCloudflare({ ...f.cursos, configuracionCursos: f.solicitud.configuracion }, noInvocar),
      /entrada-invalida/,
    );
    for (const servicio of [undefined, 'unificado']) {
      assert.throws(() => ejecutarVersionesCloudflare({ ...f.cursos, servicio }, noInvocar), /entrada-invalida/);
    }
  } finally {
    f.limpiar();
  }
  const sin = fixtureCursos(false);
  try {
    assert.throws(
      () => ejecutarVersionesCloudflare(sin.cursos, () => assert.fail('No debe invocar Wrangler')),
      /artefacto-invalido/,
    );
  } finally {
    sin.limpiar();
  }
});

test('pareja de Workers: el binding CURSOS del principal nombra al de Cursos, con otro nombre, o nada se sube', () => {
  const f = fixtureCursos();
  const noInvocar: EjecutorWrangler = () => assert.fail('No debe invocar Wrangler');
  try {
    const parejas: [Record<string, unknown>, Record<string, unknown>][] = [
      // El mismo nombre en los dos: subir Cursos sustituiría la web.
      [
        { ...f.configuracion, services: [{ binding: 'CURSOS', service: 'faro' }] },
        { ...f.configuracionCursos, name: 'faro' },
      ],
      [{ ...f.configuracion, services: undefined }, f.configuracionCursos],
      [{ ...f.configuracion, services: [] }, f.configuracionCursos],
      [{ ...f.configuracion, services: [{ binding: 'CURSOS', service: 'otro-cursos' }] }, f.configuracionCursos],
      [{ ...f.configuracion, services: [{ binding: 'OTRO', service: 'faro-cursos' }] }, f.configuracionCursos],
    ];
    for (const [principal, cursos] of parejas) {
      writeFileSync(f.solicitud.configuracion, bytes(principal));
      writeFileSync(f.cursos.configuracionCursos, bytes(cursos));
      for (const solicitud of [f.cursos, { ...f.solicitud, operacion: 'estado' }]) {
        assert.throws(() => ejecutarVersionesCloudflare(solicitud, noInvocar), /configuracion-incompatible/);
      }
    }
    writeFileSync(f.solicitud.configuracion, bytes(f.configuracion));
    writeFileSync(f.cursos.configuracionCursos, bytes(f.configuracionCursos));
    const subida = ejecutarVersionesCloudflare(f.cursos, (orden) =>
      salida(orden, 'log', { ...evento('version-upload'), worker_name: 'faro-cursos' }),
    );
    assert.equal(subida.servicio, 'cursos');
  } finally {
    f.limpiar();
  }
});
/** El efecto que declara un fallo del adaptador: `ninguno`, `rechazado` o `incierto`. */
function efectoDe(accion: () => unknown): string {
  try {
    accion();
  } catch (error) {
    assert.ok(error instanceof ErrorVersionesCloudflare);
    return `${error.codigo}:${error.efecto}`;
  }
  return assert.fail('Se esperaba un fallo');
}
test('un fallo antes de lanzar la orden que cambia Cloudflare declara que no hubo efecto', () => {
  const f = fixture();
  const desplegar = { ...f.solicitud, operacion: 'desplegar', versionId: VERSION, anteriorDeploymentId: ANTERIOR };
  try {
    writeFileSync(f.solicitud.configuracionCursos, bytes({ ...f.configuracionCursos, name: 'faro' }));
    assert.equal(
      efectoDe(() => ejecutarVersionesCloudflare(f.solicitud, () => assert.fail('No debe invocar Wrangler'))),
      'configuracion-incompatible:ninguno',
    );
    writeFileSync(f.solicitud.configuracionCursos, bytes(f.configuracionCursos));
    const otro = (orden: OrdenWrangler) => salida(orden, deployment(DEPLOYMENT));
    assert.equal(
      efectoDe(() => ejecutarVersionesCloudflare(desplegar, otro)),
      'deployment-distinto:ninguno',
    );
  } finally {
    f.limpiar();
  }
});
test('tras lanzar la orden, solo la migración pendiente es un rechazo explícito; lo demás es incierto', () => {
  const f = fixture();
  const desplegar = { ...f.solicitud, operacion: 'desplegar', versionId: VERSION, anteriorDeploymentId: ANTERIOR };
  try {
    const migracion = (orden: OrdenWrangler) => {
      salida(orden, null);
      writeFileSync(orden.stderr, 'This Worker has a pending Durable Object migration, which cannot be applied by');
      return { status: 1 };
    };
    assert.equal(
      efectoDe(() => ejecutarVersionesCloudflare(f.solicitud, migracion)),
      'configuracion-incompatible:rechazado',
    );
    const fallo = (orden: OrdenWrangler) => {
      salida(orden, null);
      return { status: 1 };
    };
    assert.equal(
      efectoDe(() => ejecutarVersionesCloudflare(f.solicitud, fallo)),
      'wrangler-incierto:incierto',
    );
    assert.equal(
      efectoDe(() => ejecutarVersionesCloudflare(f.solicitud, () => ({ status: null }))),
      'wrangler-incierto:incierto',
    );
    const sinRegistro = (orden: OrdenWrangler) => salida(orden, 'ok');
    assert.equal(
      efectoDe(() => ejecutarVersionesCloudflare(f.solicitud, sinRegistro)),
      'resultado-invalido:incierto',
    );
    let llamada = 0;
    const despliegaSinEstado = (orden: OrdenWrangler) =>
      llamada++ === 0 ? salida(orden, deployment()) : { status: null };
    assert.equal(
      efectoDe(() => ejecutarVersionesCloudflare(desplegar, despliegaSinEstado)),
      'wrangler-incierto:incierto',
    );
  } finally {
    f.limpiar();
  }
});

test('una respuesta que no cabe es incierta si la orden ya se lanzó', () => {
  const grande = { version: 1, resultado: { relleno: 'x'.repeat(MAX_SALIDA_RESPUESTA) } } as unknown as Parameters<
    typeof respuestaAcotada
  >[0];
  assert.equal(
    efectoDe(() => respuestaAcotada(grande, true)),
    'resultado-invalido:incierto',
  );
  assert.equal(
    efectoDe(() => respuestaAcotada(grande, false)),
    'resultado-invalido:ninguno',
  );
  const pequena = { version: 1 } as unknown as Parameters<typeof respuestaAcotada>[0];
  assert.equal(respuestaAcotada(pequena, true), pequena);
});
test('el estado de un Worker se lee sin el artefacto, con la pareja comprobada; las demás operaciones lo exigen', () => {
  const f = fixture();
  const sin = { ...f.solicitud, operacion: 'estado', artefacto: null };
  try {
    rmSync(f.artefacto, { recursive: true, force: true });
    for (const servicio of ['principal', 'cursos'] as const) {
      const resultado = ejecutarVersionesCloudflare({ ...sin, servicio }, (orden) => {
        const copia = JSON.parse(readFileSync(join(orden.cwd, 'wrangler.json'), 'utf8'));
        assert.ok(String(copia.main).startsWith(join(orden.cwd, 'sin-artefacto')));
        comprobarArgumentos(orden, ['deployments', 'status', '--json']);
        return salida(orden, deployment());
      });
      assert.equal(resultado.artefacto, null);
      assert.deepEqual(resultado.resultado, {
        deploymentId: ANTERIOR,
        versiones: [{ versionId: VERSION, porcentaje: 100 }],
      });
    }
    writeFileSync(f.solicitud.configuracionCursos, bytes({ ...f.configuracionCursos, name: 'faro' }));
    assert.throws(
      () => ejecutarVersionesCloudflare(sin, () => assert.fail('No debe invocar Wrangler')),
      /configuracion-incompatible/,
    );
    for (const operacion of ['subir', 'versiones']) {
      assert.throws(
        () => ejecutarVersionesCloudflare({ ...sin, operacion }, () => assert.fail('No debe invocar Wrangler')),
        /entrada-invalida/,
      );
    }
  } finally {
    f.limpiar();
  }
});
