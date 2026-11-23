import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  desplegarEntrega,
  type EjecutorDespliegue,
  entornoWrangler,
  lineaWrangler,
  type SolicitudDespliegue,
} from '../../herramientas/cloudflare/desplegar.ts';
import { ARCHIVOS, origenDeEnsayoAutorizado } from '../../herramientas/cloudflare/preparar-despliegue.ts';
import {
  leerPrivadas,
  MAX_PRIVADAS_BYTES,
  SECRETOS_PRIVADOS,
  VARIABLES_PRIVADAS,
} from '../../herramientas/cloudflare/variables-privadas.ts';
import { versionDelPaquete } from '../../src/plataforma/paquete-publicado.ts';
import { comprobarEnsayoProduccion } from '../ayudas/comprobar-ensayo-produccion.ts';
import { comprobarEntregaOficial } from '../ayudas/comprobar-oficial.ts';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
const DESPLEGAR = fileURLToPath(new URL('../../herramientas/cloudflare/desplegar.ts', import.meta.url));
const PLAZO_CLI_MS = 10_000;
const LONGITUD_AUDIENCIA = 64;
const REVISION = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const HUELLA_AJENA = '0000000000000000000000000000000000000000000000000000000000000000';
const CANALES = ['FARO_MCP:no', 'FARO_A2A:no', 'FARO_API_SOCIOS:no'];
const PUBLICAR = ['deploy', '--no-bundle', '--keep-vars', '--config'];
const ENSAYAR = ['deploy', '--dry-run', '--no-bundle', '--keep-vars', '--config'];
const ORIGEN_ENSAYO = 'https://faro-ensayo.cuenta-ejemplo.workers.dev';
const OTRA_CUENTA = 'https://faro-ensayo.otra-cuenta.workers.dev';
const ACCESO = {
  equipo: 'entidad-ejemplo.cloudflareaccess.com',
  audiencia: 'a'.repeat(LONGITUD_AUDIENCIA),
  origen: ORIGEN_ENSAYO,
};

function sha(contenido: Uint8Array): string {
  return createHash('sha256').update(contenido).digest('hex');
}
function json(valor: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(valor, null, 2)}\n`);
}

/** Archivos de una entrega sintética: el Worker principal y, si se pide, el de Cursos, con sus datos y la web. */
function archivosDeEntrega(conCursos: boolean) {
  const dato = json({ datos: 'sintético' });
  const manifiesto = json({ 'uno.json': { sha256: sha(dato) } });
  const version = versionDelPaquete(sha(manifiesto));
  const motor = Buffer.from('export const motor = 1;\n');
  const archivos = new Map<string, Buffer>([
    ['worker/worker.mjs', Buffer.from("import datos from './datos/uno.json'; export default datos;\n")],
    ['worker/datos/uno.json', dato],
    ...(conCursos
      ? ([
          ['worker-cursos/worker.mjs', Buffer.from("import datos from './datos/uno.json'; export default datos;\n")],
          ['worker-cursos/datos/uno.json', dato],
        ] as const)
      : []),
    ['web/index.html', Buffer.from('<!doctype html>')],
    ['web/motor/entrada.js', motor],
    [`web/paquete/${version}/manifiesto.json`, manifiesto],
    [`web/paquete/${version}/uno.json`, dato],
    [
      'web/firmas/manifiesto.json',
      json({
        formato: 1,
        paquete: version,
        archivos: {
          'motor/entrada.js': sha(motor),
          [`paquete/${version}/manifiesto.json`]: sha(manifiesto),
          [`paquete/${version}/uno.json`]: sha(dato),
        },
      }),
    ],
  ]);
  return { archivos, version, manifiesto };
}

/** Instalación sintética: el perfil versionado y una entrega íntegra con los dos Workers, sellada con su destino. */
function instalacion(destino: 'privado' | 'oficial', { conCursos = true, carpeta = 'entrega' } = {}) {
  const raiz = mkdtempSync(join(realpathSync(tmpdir()), 'faro despliegue '));
  for (const archivo of Object.values(ARCHIVOS).flatMap((servicios) => Object.values(servicios))) {
    mkdirSync(dirname(join(raiz, archivo)), { recursive: true });
    copyFileSync(join(RAIZ, archivo), join(raiz, archivo));
  }
  const entrega = join(raiz, carpeta);
  const { archivos, version, manifiesto } = archivosDeEntrega(conCursos);
  for (const [ruta, contenido] of archivos) {
    mkdirSync(dirname(join(entrega, ruta)), { recursive: true });
    writeFileSync(join(entrega, ruta), contenido);
  }
  const descriptor = json({
    destino,
    version: 1,
    revisionCodigo: REVISION,
    huellaPaquete: version,
    sha256ManifiestoPaquete: sha(manifiesto),
    sha256ManifiestoDispositivo: sha(archivos.get('web/firmas/manifiesto.json') as Buffer),
    archivos: [...archivos]
      .sort(([a], [b]) => (a < b ? -1 : Number(a > b)))
      .map(([ruta, contenido]) => ({ ruta, bytes: contenido.byteLength, sha256: sha(contenido) })),
  });
  writeFileSync(join(entrega, 'artefacto.json'), descriptor);
  return { raiz, entrega, sha256: sha(descriptor), limpiar: () => rmSync(raiz, { recursive: true, force: true }) };
}

const EXISTENTE = {
  version: 1,
  entorno: 'produccion',
  tipo: 'existente',
  worker: 'faro-pruebas',
  cursos: 'faro-pruebas-cursos',
  origen: 'https://faroapp.org',
  migraciones_aplicadas: [{ tag: 'faro-pruebas-inicial-v1', new_sqlite_classes: ['AccesoPublicoDurable'] }],
};
const NUEVA_ENSAYO = {
  version: 1,
  entorno: 'ensayo',
  tipo: 'nueva',
  worker: 'faro-ensayo',
  cursos: 'faro-ensayo-cursos',
  origen: ORIGEN_ENSAYO,
  migraciones_aplicadas: [],
};

/** Ejecutor falso: registra cada orden y lee la configuración temporal mientras existe, como la leería Wrangler. */
function ejecutorFalso(codigo = 0, durante?: () => void) {
  const ordenes: { argumentos: readonly string[]; configuracion: Record<string, unknown>; envVacio: string }[] = [];
  const ejecutor: EjecutorDespliegue = async ({ argumentos }) => {
    const valor = (opcion: string) => argumentos[argumentos.indexOf(opcion) + 1] as string;
    ordenes.push({
      argumentos,
      configuracion: JSON.parse(readFileSync(valor('--config'), 'utf8')),
      envVacio: readFileSync(valor('--env-file'), 'utf8'),
    });
    durante?.();
    return codigo;
  };
  return { ejecutor, ordenes };
}

function solicitud(f: ReturnType<typeof instalacion>, cambio: Partial<SolicitudDespliegue> = {}): SolicitudDespliegue {
  return {
    raiz: f.raiz,
    accion: 'publicar',
    entorno: 'produccion',
    servicio: 'principal',
    sha256: f.sha256,
    artefacto: f.entrega,
    instalacion: EXISTENTE,
    ...cambio,
  };
}

test('comprobar no llama a Wrangler y devuelve la identidad de la entrega y del destino', async () => {
  const f = instalacion('oficial');
  try {
    const { ejecutor, ordenes } = ejecutorFalso();
    const recibo = await desplegarEntrega(solicitud(f, { accion: 'comprobar', instalacion: undefined }), ejecutor);
    assert.deepEqual(ordenes, []);
    assert.deepEqual(
      { ...recibo, huellaPaquete: typeof recibo.huellaPaquete },
      {
        accion: 'comprobar',
        entorno: 'produccion',
        servicio: 'principal',
        worker: 'faro-pruebas',
        destino: 'oficial',
        sha256Artefacto: f.sha256,
        revisionCodigo: REVISION,
        huellaPaquete: 'string',
        migracionPendiente: null,
        wrangler: false,
      },
    );
  } finally {
    f.limpiar();
  }
});

test('publicar en producción entrega a Wrangler una copia sin rutas que apunta a la entrega comprobada', async () => {
  const f = instalacion('oficial');
  try {
    const { ejecutor, ordenes } = ejecutorFalso();
    const recibo = await desplegarEntrega(solicitud(f), ejecutor);
    assert.equal(recibo.wrangler, true);
    assert.equal(ordenes.length, 1);
    const [orden] = ordenes;
    const { argumentos, configuracion } = orden as (typeof ordenes)[number];
    assert.deepEqual(argumentos.slice(0, PUBLICAR.length), PUBLICAR);
    assert.ok(
      !argumentos.includes('--dry-run') && !argumentos.includes('--routes') && !argumentos.includes('--domains'),
    );
    assert.deepEqual(
      argumentos.filter((_, i) => argumentos[i - 1] === '--var'),
      CANALES,
    );
    assert.equal(orden?.envVacio, '');
    assert.equal(configuracion.name, 'faro-pruebas');
    assert.equal(configuracion.workers_dev, false);
    assert.equal(configuracion.preview_urls, false);
    assert.equal(Object.hasOwn(configuracion, 'routes'), false);
    assert.equal(configuracion.main, join(f.entrega, 'worker/worker.mjs'));
    assert.equal(configuracion.base_dir, join(f.entrega, 'worker'));
    assert.equal((configuracion.assets as Record<string, unknown>).directory, join(f.entrega, 'web'));
    assert.equal(existsSync(dirname(argumentos[argumentos.indexOf('--config') + 1] as string)), false);
  } finally {
    f.limpiar();
  }
});

test('ensayar usa --dry-run en el Worker de ensayo y el de Cursos no recibe variables', async () => {
  const f = instalacion('privado');
  try {
    const { ejecutor, ordenes } = ejecutorFalso();
    for (const servicio of ['cursos', 'principal'] as const) {
      await desplegarEntrega(
        solicitud(f, { accion: 'ensayar', entorno: 'ensayo', servicio, instalacion: undefined }),
        ejecutor,
      );
    }
    const [cursos, principal] = ordenes;
    assert.deepEqual(cursos?.argumentos.slice(0, ENSAYAR.length), ENSAYAR);
    assert.equal(cursos?.argumentos.includes('--var'), false);
    assert.equal(cursos?.configuracion.name, 'faro-ensayo-cursos');
    assert.equal(cursos?.configuracion.workers_dev, false);
    assert.equal(principal?.configuracion.name, 'faro-ensayo');
    assert.deepEqual(principal?.configuracion.services, [{ binding: 'CURSOS', service: 'faro-ensayo-cursos' }]);
    assert.ok(principal?.argumentos.includes('FARO_PRUEBAS_ADMINISTRACION:no'));
  } finally {
    f.limpiar();
  }
});

test('el panel de ensayo solo se habilita con Access válido, el origen del registro y su interruptor', async () => {
  for (const [destino, interruptor] of [
    ['privado', 'FARO_PRUEBAS_ADMINISTRACION'],
    ['oficial', 'FARO_ADMINISTRACION'],
  ] as const) {
    const f = instalacion(destino);
    try {
      const { ejecutor, ordenes } = ejecutorFalso();
      await desplegarEntrega(
        solicitud(f, { accion: 'ensayar', entorno: 'ensayo', instalacion: NUEVA_ENSAYO, acceso: ACCESO }),
        ejecutor,
      );
      assert.deepEqual(
        ordenes[0]?.argumentos.filter((_, i, todos) => todos[i - 1] === '--var'),
        [
          `${interruptor}:si`,
          `FARO_ADMIN_ACCESS_EQUIPO:${ACCESO.equipo}`,
          `FARO_ADMIN_ACCESS_AUD:${ACCESO.audiencia}`,
          `FARO_ADMIN_ORIGEN:${ACCESO.origen}`,
          ...CANALES,
        ],
      );
    } finally {
      f.limpiar();
    }
  }
});

test('no se llama a Wrangler sin huella, destino, Worker, registro y migración correctos', async () => {
  const f = instalacion('oficial', { conCursos: false });
  const privada = instalacion('privado');
  try {
    const { ejecutor, ordenes } = ejecutorFalso();
    for (const [cambio, motivo] of [
      [{ sha256: HUELLA_AJENA }, /Artefacto Cloudflare no verificable/],
      [{ sha256: 'abc' }, /--sha256/],
      [{ artefacto: privada.entrega, sha256: privada.sha256 }, /privado no se admite en produccion/],
      [{ servicio: 'cursos' }, /no contiene worker-cursos\/worker\.mjs/],
      [{ instalacion: undefined }, /Publicar exige --instalacion/],
      [{ instalacion: { ...EXISTENTE, worker: 'faro' } }, /otros Workers/],
      [{ instalacion: { ...EXISTENTE, origen: 'https://otra.example' } }, /otro dominio/],
      [
        {
          instalacion: {
            ...EXISTENTE,
            migraciones_aplicadas: [
              { tag: 'faro-pruebas-inicial-v1', transferred_classes: [{ from: 'A', from_script: 'otro', to: 'A' }] },
            ],
          },
        },
        /etiquetas y operaciones deben coincidir/,
      ],
      [{ aplicarMigracion: 'faro-pruebas-inicial-v1' }, /solo se admite al publicar/],
      [{ acceso: ACCESO }, /Producción conserva su Access/],
      [{ entorno: 'ensayo', instalacion: NUEVA_ENSAYO }, /aplicaría la migración faro-ensayo-inicial-v1/],
      [{ entorno: 'ensayo', instalacion: undefined, accion: 'ensayar', acceso: ACCESO }, /exige --instalacion/],
      [
        {
          entorno: 'ensayo',
          instalacion: NUEVA_ENSAYO,
          accion: 'ensayar',
          acceso: { ...ACCESO, origen: 'https://faro-pruebas.cuenta-ejemplo.workers.dev' },
        },
        /instalación de ensayo autorizada/,
      ],
      [
        { entorno: 'ensayo', instalacion: NUEVA_ENSAYO, accion: 'ensayar', acceso: { ...ACCESO, origen: OTRA_CUENTA } },
        /instalación de ensayo autorizada/,
      ],
    ] as const) {
      await assert.rejects(desplegarEntrega(solicitud(f, cambio as Partial<SolicitudDespliegue>), ejecutor), motivo);
    }
    assert.deepEqual(ordenes, []);
  } finally {
    f.limpiar();
    privada.limpiar();
  }
});

test('una migración pendiente solo se aplica nombrándola en la publicación del Worker principal', async () => {
  const f = instalacion('privado');
  try {
    const { ejecutor, ordenes } = ejecutorFalso();
    const base = { entorno: 'ensayo', instalacion: NUEVA_ENSAYO } as const;
    await desplegarEntrega(solicitud(f, { ...base, servicio: 'cursos' }), ejecutor);
    const recibo = await desplegarEntrega(
      solicitud(f, { ...base, aplicarMigracion: 'faro-ensayo-inicial-v1' }),
      ejecutor,
    );
    assert.equal(recibo.migracionPendiente, 'faro-ensayo-inicial-v1');
    assert.deepEqual(
      ordenes.map((o) => o.configuracion.name),
      ['faro-ensayo-cursos', 'faro-ensayo'],
    );
  } finally {
    f.limpiar();
  }
});

test('publicar para terminar una activación da a la versión su etiqueta y la huella del artefacto', async () => {
  const f = instalacion('oficial');
  try {
    const { ejecutor, ordenes } = ejecutorFalso();
    const intencion = '11111111-1111-4111-8111-111111111111';
    await desplegarEntrega(solicitud(f, { intencion }), ejecutor);
    const argumentos = ordenes[0]?.argumentos ?? [];
    assert.equal(argumentos[argumentos.indexOf('--tag') + 1], intencion);
    assert.equal(argumentos[argumentos.indexOf('--message') + 1], f.sha256);
    const sinIntencion = ejecutorFalso();
    await desplegarEntrega(solicitud(f), sinIntencion.ejecutor);
    assert.equal(sinIntencion.ordenes[0]?.argumentos.includes('--tag'), false);
    const nada = ejecutorFalso();
    await assert.rejects(desplegarEntrega(solicitud(f, { intencion: 'otra' }), nada.ejecutor), /solicitudId/);
    assert.deepEqual(nada.ordenes, []);
  } finally {
    f.limpiar();
  }
});
test('si Wrangler falla o la entrega cambia durante la orden, el despliegue se detiene con error', async () => {
  const f = instalacion('oficial');
  try {
    await assert.rejects(
      desplegarEntrega(solicitud(f), ejecutorFalso(1).ejecutor),
      /Wrangler no terminó correctamente/,
    );
    const alterar = () => writeFileSync(join(f.entrega, 'web/index.html'), '<!doctype html><p>otra');
    await assert.rejects(desplegarEntrega(solicitud(f), ejecutorFalso(0, alterar).ejecutor), /no verificable/);
  } finally {
    f.limpiar();
  }
});

test('las comprobaciones compartidas de staging y oficial exigen el perfil completo y separado', () => {
  const f = instalacion('oficial', { carpeta: 'dist' });
  try {
    assert.equal(comprobarEnsayoProduccion(f.raiz, f.sha256).sha256Artefacto, f.sha256);
    assert.equal(comprobarEntregaOficial(f.raiz, f.entrega, f.sha256).sha256Artefacto, f.sha256);
    const ensayo = join(f.raiz, ARCHIVOS.ensayo.principal);
    const original = readFileSync(ensayo, 'utf8');
    writeFileSync(ensayo, JSON.stringify({ ...JSON.parse(original), name: 'faro-pruebas' }));
    assert.throws(() => comprobarEnsayoProduccion(f.raiz, f.sha256), /cuatro Workers distintos/);
    assert.throws(() => comprobarEntregaOficial(f.raiz, f.entrega, f.sha256), /cuatro Workers distintos/);
    writeFileSync(ensayo, original);
    rmSync(join(f.raiz, ARCHIVOS.produccion.principal));
    assert.throws(() => comprobarEnsayoProduccion(f.raiz, f.sha256), /wrangler\.produccion\.jsonc: ausente/);
  } finally {
    f.limpiar();
  }
});

test('una prueba remota solo se dirige al origen exacto de la instalación de ensayo autorizada', () => {
  const f = instalacion('oficial');
  try {
    assert.equal(origenDeEnsayoAutorizado(f.raiz, NUEVA_ENSAYO, ORIGEN_ENSAYO).origin, ORIGEN_ENSAYO);
    const produccionEnWorkersDev = 'https://faro-pruebas.cuenta-ejemplo.workers.dev';
    const compartido = { ...NUEVA_ENSAYO, worker: 'faro-pruebas', origen: produccionEnWorkersDev };
    for (const [registro, origen, motivo] of [
      [NUEVA_ENSAYO, OTRA_CUENTA, /instalación de ensayo autorizada/],
      [{ ...NUEVA_ENSAYO, origen: OTRA_CUENTA }, ORIGEN_ENSAYO, /instalación de ensayo autorizada/],
      [NUEVA_ENSAYO, produccionEnWorkersDev, /instalación de ensayo autorizada/],
      [NUEVA_ENSAYO, `${ORIGEN_ENSAYO}/`, /instalación de ensayo autorizada/],
      [compartido, produccionEnWorkersDev, /otros Workers/],
      [EXISTENTE, 'https://faroapp.org', /otro entorno/],
      [{ ...NUEVA_ENSAYO, origen: undefined }, ORIGEN_ENSAYO, /Registro de instalación inválido/],
    ] as const) {
      assert.throws(() => origenDeEnsayoAutorizado(f.raiz, registro, origen), motivo, `${origen} ${registro.origen}`);
    }
    const ensayo = join(f.raiz, ARCHIVOS.ensayo.principal);
    writeFileSync(ensayo, JSON.stringify({ ...JSON.parse(readFileSync(ensayo, 'utf8')), name: 'faro-pruebas' }));
    assert.throws(
      () => origenDeEnsayoAutorizado(f.raiz, compartido, produccionEnWorkersDev),
      /cuatro Workers distintos/,
    );
    rmSync(join(f.raiz, ARCHIVOS.produccion.principal));
    assert.throws(
      () => origenDeEnsayoAutorizado(f.raiz, NUEVA_ENSAYO, ORIGEN_ENSAYO),
      /wrangler\.produccion\.jsonc: ausente/,
    );
  } finally {
    f.limpiar();
  }
});

test('Wrangler se lanza siempre con la identidad de red del producto y el Wrangler fijado', () => {
  assert.deepEqual(lineaWrangler('/instalacion', ['deploy', '--dry-run']), [
    '--require',
    join('/instalacion', 'herramientas/red/identidad-wrangler.cjs'),
    join('/instalacion', 'node_modules/wrangler/bin/wrangler.js'),
    'deploy',
    '--dry-run',
  ]);
});

test('el entorno de Wrangler no hereda destinos, cuentas ni carga de código y conserva la autenticación', () => {
  const limpio = entornoWrangler({
    NODE_OPTIONS: '--require ajeno',
    NODE_PATH: 'ajeno',
    CLOUDFLARE_ACCOUNT_ID: 'otra',
    CF_API_BASE_URL: 'https://ajeno.example',
    WRANGLER_AUTH_URL: 'https://ajeno.example',
    CLOUDFLARE_INCLUDE_PROCESS_ENV: 'true',
    CLOUDFLARE_API_TOKEN: 'token-sintetico',
    HOME: '/hogar-sintetico',
  });
  for (const nombre of ['NODE_OPTIONS', 'NODE_PATH', 'CLOUDFLARE_ACCOUNT_ID', 'CF_API_BASE_URL', 'WRANGLER_AUTH_URL']) {
    assert.equal(limpio[nombre], undefined);
  }
  assert.equal(limpio.CLOUDFLARE_INCLUDE_PROCESS_ENV, undefined);
  assert.equal(limpio.CLOUDFLARE_API_TOKEN, 'token-sintetico');
  assert.equal(limpio.HOME, '/hogar-sintetico');
  assert.equal(limpio.WRANGLER_SEND_METRICS, 'false');
});

test('la orden explica su uso y se detiene ante opciones ausentes o desconocidas', () => {
  const orden = (...argumentos: string[]) =>
    spawnSync(process.execPath, [DESPLEGAR, ...argumentos], { encoding: 'utf8', timeout: PLAZO_CLI_MS, env: {} });
  const ayuda = orden('--ayuda');
  assert.equal(ayuda.status, 0);
  assert.match(ayuda.stdout, /comprobar\|ensayar\|publicar --entorno produccion\|ensayo/);
  assert.equal(orden('comprobar', '--desconocida', 'x').status, 2);
  const sinHuella = orden('comprobar', '--entorno', 'produccion', '--servicio', 'principal');
  assert.equal(sinHuella.status, 1);
  assert.match(sinHuella.stderr, /Despliegue detenido: Indica --sha256/);
});

/** Permisos que se exigen al archivo de secretos y a su carpeta, y otros que el archivo de --privadas no admite. */
const PRIVADO = 0o600;
const CARPETA_PRIVADA = 0o700;
const LEGIBLE_POR_TODOS = 0o644;
const LEGIBLE_POR_EL_GRUPO = 0o640;
const LEGIBLE_POR_OTROS = 0o604;
const SOLO_LECTURA = 0o400;
const PERMISOS_ABIERTOS = [LEGIBLE_POR_TODOS, LEGIBLE_POR_EL_GRUPO, LEGIBLE_POR_OTROS, SOLO_LECTURA, CARPETA_PRIVADA];
/** Un identificador de cuenta de Cloudflare: 32 cifras hexadecimales. */
const LONGITUD_CUENTA = 32;
const CUENTA = 'c'.repeat(LONGITUD_CUENTA);
/** Valores sintéticos con la forma que admite el Worker; el token es reconocible para buscarlo en lo que sale. */
const TOKEN = 'token-sintetico-que-nunca-debe-salir-0123456789';
const DEMANDA = JSON.stringify({
  version: 1,
  habilitada: false,
  actores: ['12345678'],
  separacionMin: 60,
  maxDia: 4,
  maxMes: { 'actualizar-datos': 30, 'comprobar-vencidas': 30, 'actualizar-cursos': 30 },
  presupuestoMinMes: 2000,
  reservaProgramadaMin: 30,
});
const VARIABLES = {
  FARO_ADMIN_ACCESS_CUENTA: CUENTA,
  FARO_ADMIN_ACCESS_GRUPO: '00000000-0000-4000-8000-000000000000',
  FARO_ADMINISTRADORES_INICIALES: 'persona@entidad.example',
  FARO_ADMIN_EXIGIR_MFA: 'si',
  FARO_ACTUALIZACION_DEMANDA: DEMANDA,
};
const PRIVADAS = { version: 1, variables: VARIABLES, secretos: { FARO_ADMIN_ACCESS_TOKEN: TOKEN } };

/** Archivo privado de quien opera, fuera de la instalación, con 0600 salvo que la prueba pida otros permisos. */
function archivoPrivadas(contenido: unknown, permisos = PRIVADO) {
  const carpeta = mkdtempSync(join(realpathSync(tmpdir()), 'faro privadas '));
  const ruta = join(carpeta, 'privadas.json');
  writeFileSync(ruta, typeof contenido === 'string' ? contenido : JSON.stringify(contenido), { mode: PRIVADO });
  chmodSync(ruta, permisos);
  return { carpeta, ruta, limpiar: () => rmSync(carpeta, { recursive: true, force: true }) };
}

/** Ejecutor que además guarda el entorno y lee el archivo de secretos, sus permisos y los de su carpeta. */
function ejecutorConSecretos(codigo = 0) {
  const vistas: {
    argumentos: readonly string[];
    env: NodeJS.ProcessEnv;
    ruta: string;
    secretos: unknown;
    permisos: number;
    carpeta: number;
  }[] = [];
  const ejecutor: EjecutorDespliegue = async ({ argumentos, env }) => {
    const ruta = argumentos[argumentos.indexOf('--secrets-file') + 1] as string;
    vistas.push({
      argumentos,
      env,
      ruta,
      secretos: JSON.parse(readFileSync(ruta, 'utf8')),
      permisos: statSync(ruta).mode & 0o777,
      carpeta: statSync(dirname(ruta)).mode & 0o777,
    });
    return codigo;
  };
  return { ejecutor, vistas };
}

const valorDe = (argumentos: readonly string[], opcion: string) => argumentos[argumentos.indexOf(opcion) + 1] as string;
const CON_PRIVADAS = [
  ...CANALES,
  `FARO_ADMIN_ACCESS_CUENTA:${VARIABLES.FARO_ADMIN_ACCESS_CUENTA}`,
  `FARO_ADMIN_ACCESS_GRUPO:${VARIABLES.FARO_ADMIN_ACCESS_GRUPO}`,
  `FARO_ADMINISTRADORES_INICIALES:${VARIABLES.FARO_ADMINISTRADORES_INICIALES}`,
  'FARO_ADMIN_EXIGIR_MFA:si',
  `FARO_ACTUALIZACION_DEMANDA:${DEMANDA}`,
];

test('sin --privadas Wrangler recibe exactamente los argumentos de siempre y el recibo no cambia', async () => {
  const f = instalacion('oficial');
  try {
    const { ejecutor, ordenes } = ejecutorFalso();
    const recibo = await desplegarEntrega(solicitud(f), ejecutor);
    const argumentos = ordenes[0]?.argumentos ?? [];
    assert.deepEqual(argumentos, [
      ...PUBLICAR,
      valorDe(argumentos, '--config'),
      ...CANALES.flatMap((variable) => ['--var', variable]),
      '--env-file',
      valorDe(argumentos, '--env-file'),
    ]);
    assert.equal(Object.hasOwn(recibo, 'privadas'), false);
  } finally {
    f.limpiar();
  }
});

test('con --privadas las variables van con --var y el secreto solo en un archivo temporal 0600 que se borra', async () => {
  const f = instalacion('oficial');
  const p = archivoPrivadas(PRIVADAS);
  try {
    for (const accion of ['publicar', 'ensayar'] as const) {
      const { ejecutor, vistas } = ejecutorConSecretos();
      const recibo = await desplegarEntrega(solicitud(f, { accion, privadas: p.ruta }), ejecutor);
      const [vista] = vistas;
      assert.ok(vista);
      const { argumentos } = vista;
      assert.deepEqual(argumentos, [
        ...(accion === 'publicar' ? PUBLICAR : ENSAYAR),
        valorDe(argumentos, '--config'),
        ...CON_PRIVADAS.flatMap((variable) => ['--var', variable]),
        '--secrets-file',
        vista.ruta,
        '--env-file',
        valorDe(argumentos, '--env-file'),
      ]);
      assert.deepEqual(vista.secretos, { FARO_ADMIN_ACCESS_TOKEN: TOKEN });
      assert.equal(vista.permisos, PRIVADO);
      assert.equal(vista.carpeta, CARPETA_PRIVADA);
      assert.ok(!vista.ruta.startsWith(f.raiz) && !vista.ruta.startsWith(p.carpeta));
      assert.equal(existsSync(dirname(vista.ruta)), false);
      assert.equal(JSON.stringify(argumentos).includes(TOKEN), false);
      assert.equal(JSON.stringify(vista.env).includes(TOKEN), false);
      assert.deepEqual(recibo.privadas, { variables: [...VARIABLES_PRIVADAS], secretos: [...SECRETOS_PRIVADOS] });
      const texto = JSON.stringify(recibo);
      // «si» es demasiado corto para buscarlo como trozo de texto; los demás valores son inconfundibles.
      for (const valor of [TOKEN, ...Object.values(VARIABLES)].filter((texto) => texto.length > 2)) {
        assert.equal(texto.includes(valor), false);
      }
    }
  } finally {
    p.limpiar();
    f.limpiar();
  }
});

test('sin secretos en el archivo no se pasa --secrets-file', async () => {
  const f = instalacion('oficial');
  const p = archivoPrivadas({ version: 1, variables: { FARO_ADMIN_EXIGIR_MFA: 'no' }, secretos: {} });
  try {
    const { ejecutor, ordenes } = ejecutorFalso();
    const recibo = await desplegarEntrega(solicitud(f, { privadas: p.ruta }), ejecutor);
    const argumentos = ordenes[0]?.argumentos ?? [];
    assert.equal(argumentos.includes('--secrets-file'), false);
    assert.deepEqual(
      argumentos.filter((_, i) => argumentos[i - 1] === '--var'),
      [...CANALES, 'FARO_ADMIN_EXIGIR_MFA:no'],
    );
    assert.deepEqual(recibo.privadas, { variables: ['FARO_ADMIN_EXIGIR_MFA'], secretos: [] });
  } finally {
    p.limpiar();
    f.limpiar();
  }
});

test('si Wrangler falla con --privadas el archivo de secretos se borra y el error no lo cita', async () => {
  const f = instalacion('oficial');
  const p = archivoPrivadas(PRIVADAS);
  try {
    const { ejecutor, vistas } = ejecutorConSecretos(1);
    await assert.rejects(desplegarEntrega(solicitud(f, { privadas: p.ruta }), ejecutor), (error: Error) => {
      assert.match(error.message, /Wrangler no terminó correctamente/);
      assert.equal(error.message.includes(TOKEN), false);
      return true;
    });
    assert.equal(vistas.length, 1);
    assert.equal(existsSync(dirname(vistas[0]?.ruta as string)), false);
  } finally {
    p.limpiar();
    f.limpiar();
  }
});

test('--privadas solo vale al ensayar o publicar el principal de producción', async () => {
  const f = instalacion('oficial');
  const p = archivoPrivadas(PRIVADAS);
  try {
    const { ejecutor, ordenes } = ejecutorFalso();
    for (const cambio of [
      { entorno: 'ensayo', accion: 'ensayar', instalacion: undefined },
      { servicio: 'cursos' },
      { accion: 'comprobar', instalacion: undefined },
    ] as const) {
      await assert.rejects(
        desplegarEntrega(solicitud(f, { ...cambio, privadas: p.ruta }), ejecutor),
        /--privadas solo se admite al ensayar o publicar el Worker principal de producción/,
      );
    }
    assert.deepEqual(ordenes, []);
  } finally {
    p.limpiar();
    f.limpiar();
  }
});

test('un nombre fuera de la lista, un valor que el Worker rechaza o una forma distinta detienen la orden', async () => {
  const f = instalacion('oficial');
  const con = (variables: object, secretos: object = {}) => ({ version: 1, variables, secretos });
  const casos: [unknown, RegExp][] = [
    [con({ FARO_MCP: 'si' }), /FARO_MCP no está en la lista cerrada/],
    [con({}, { [TOKEN]: TOKEN }), /secretos: un nombre que no es de Faro no está en la lista cerrada/],
    [con({ FARO_ADMIN_ACCESS_TOKEN: TOKEN }), /variables: FARO_ADMIN_ACCESS_TOKEN no está en la lista cerrada/],
    [con({}, { FARO_ADMIN_ACCESS_CUENTA: CUENTA }), /secretos: FARO_ADMIN_ACCESS_CUENTA no está/],
    [con({ FARO_ADMIN_ACCESS_CUENTA: 'cuenta' }), /FARO_ADMIN_ACCESS_CUENTA no tiene la forma/],
    [con({ FARO_ADMIN_ACCESS_GRUPO: 'grupo' }), /FARO_ADMIN_ACCESS_GRUPO no tiene la forma/],
    [con({ FARO_ADMINISTRADORES_INICIALES: 'sin-arroba' }), /FARO_ADMINISTRADORES_INICIALES admite/],
    [con({ FARO_ADMIN_EXIGIR_MFA: 'quizas' }), /FARO_ADMIN_EXIGIR_MFA admite si o no/],
    [con({ FARO_ACTUALIZACION_DEMANDA: '{"version":1}' }), /FARO_ACTUALIZACION_DEMANDA no tiene la forma/],
    [con({}, { FARO_ADMIN_ACCESS_TOKEN: 'corto!' }), /FARO_ADMIN_ACCESS_TOKEN no tiene la forma/],
    [con({ FARO_ADMIN_EXIGIR_MFA: '' }), /FARO_ADMIN_EXIGIR_MFA debe ser un texto no vacío/],
    [con({}), /no pone ningún nombre/],
    [{ ...PRIVADAS, version: 2 }, /version 1/],
    [{ ...PRIVADAS, otra: {} }, /lleva version, variables y secretos/],
    [{ version: 1, variables: VARIABLES }, /lleva version, variables y secretos/],
    [{ version: 1, variables: [], secretos: {} }, /variables del archivo de --privadas debe ser un objeto/],
    [`{"version":1,"secretos":{"FARO_ADMIN_ACCESS_TOKEN":"${TOKEN}"`, /no es un JSON legible/],
  ];
  try {
    const { ejecutor, ordenes } = ejecutorFalso();
    for (const [contenido, motivo] of casos) {
      const p = archivoPrivadas(contenido);
      try {
        await assert.rejects(desplegarEntrega(solicitud(f, { privadas: p.ruta }), ejecutor), (error: Error) => {
          assert.match(error.message, motivo);
          assert.equal(error.message.includes(TOKEN), false);
          return true;
        });
      } finally {
        p.limpiar();
      }
    }
    assert.deepEqual(ordenes, []);
  } finally {
    f.limpiar();
  }
});

test('el archivo de --privadas se exige 0600, del usuario, sin enlaces y de tamaño acotado', async () => {
  const f = instalacion('oficial');
  const { ejecutor, ordenes } = ejecutorFalso();
  const rechaza = (ruta: string, motivo: RegExp) =>
    assert.rejects(desplegarEntrega(solicitud(f, { privadas: ruta }), ejecutor), motivo);
  const p = archivoPrivadas(PRIVADAS);
  const getuid = process.getuid;
  assert.ok(getuid, 'la prueba del dueño necesita un sistema con usuarios POSIX');
  try {
    for (const permisos of PERMISOS_ABIERTOS) {
      chmodSync(p.ruta, permisos);
      await rechaza(p.ruta, /exige permisos 0600/);
    }
    chmodSync(p.ruta, PRIVADO);
    symlinkSync(p.ruta, join(p.carpeta, 'enlace.json'));
    await rechaza(join(p.carpeta, 'enlace.json'), /enlace simbólico/);
    mkdirSync(join(p.carpeta, 'real'));
    symlinkSync(join(p.carpeta, 'real'), join(p.carpeta, 'atajo'));
    writeFileSync(join(p.carpeta, 'real', 'privadas.json'), JSON.stringify(PRIVADAS), { mode: PRIVADO });
    await rechaza(join(p.carpeta, 'atajo', 'privadas.json'), /enlace simbólico/);
    linkSync(p.ruta, join(p.carpeta, 'duro.json'));
    await rechaza(p.ruta, /archivo único, sin enlaces/);
    rmSync(join(p.carpeta, 'duro.json'));
    process.getuid = () => getuid.call(process) + 1;
    await rechaza(p.ruta, /del usuario que despliega/);
    process.getuid = getuid;
    writeFileSync(p.ruta, `${JSON.stringify(PRIVADAS)}${' '.repeat(MAX_PRIVADAS_BYTES)}`);
    await rechaza(p.ruta, /no puede pasar de 16384 bytes/);
    assert.deepEqual(ordenes, []);
  } finally {
    process.getuid = getuid;
    p.limpiar();
    f.limpiar();
  }
});

test('la orden admite --privadas y lo rechaza fuera del principal de producción antes de leerlo', () => {
  const resultado = spawnSync(
    process.execPath,
    [DESPLEGAR, 'ensayar', '--entorno', 'ensayo', '--servicio', 'principal', '--sha256', HUELLA_AJENA].concat([
      '--privadas',
      '/no/existe.json',
    ]),
    { encoding: 'utf8', timeout: PLAZO_CLI_MS, env: {} },
  );
  assert.equal(resultado.status, 1);
  assert.match(resultado.stderr, /Despliegue detenido: --privadas solo se admite/);
});

test('el ejemplo de --privadas de la guía es válido, sin valores reales, y nombra la lista cerrada', () => {
  const guia = readFileSync(join(RAIZ, 'config/cloudflare/README.md'), 'utf8');
  const ejemplo = /<!-- privadas\.example -->\n {2}```json\n([\s\S]*?)\n {2}```/.exec(guia)?.[1];
  assert.ok(ejemplo, 'la guía incluye el ejemplo de --privadas');
  const privadas = leerPrivadas(ejemplo);
  assert.deepEqual(privadas.nombres, { variables: [...VARIABLES_PRIVADAS], secretos: [...SECRETOS_PRIVADOS] });
  assert.match(privadas.secretos.FARO_ADMIN_ACCESS_TOKEN as string, /^SUSTITUIR/);
  for (const nombre of [...VARIABLES_PRIVADAS, ...SECRETOS_PRIVADOS]) {
    assert.ok(guia.includes(`\`${nombre}\``), nombre);
  }
});
