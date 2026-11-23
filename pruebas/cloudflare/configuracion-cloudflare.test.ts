import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { OPCIONES } from '../../herramientas/cloudflare/desplegar.ts';
import { leerAccesoEnsayo } from '../../herramientas/cloudflare/parametros-ensayo.ts';
import {
  ARCHIVOS,
  comprobarMigraciones,
  comprobarSeparacion,
  comprobarServicio,
  type Entorno,
  leerEntorno,
  leerPerfil,
  leerRegistroInstalacion,
  migracionPendiente,
  type Servicio,
} from '../../herramientas/cloudflare/preparar-despliegue.ts';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
const CLASE = 'AccesoPublicoDurable';
const LONGITUD_AUDIENCIA = 64;
type Cambio = Record<string, unknown>;

/** Comprueba que cada alteración de un archivo del perfil se rechaza por la guardia esperada. */
function rechaza(casos: readonly [Entorno, Servicio, Cambio, RegExp][]): void {
  const carpeta = mkdtempSync(join(tmpdir(), 'faro-perfil-'));
  try {
    for (const [entorno, servicio, cambio, motivo] of casos) {
      for (const archivos of Object.values(ARCHIVOS)) {
        for (const archivo of Object.values(archivos)) {
          mkdirSync(dirname(join(carpeta, archivo)), { recursive: true });
          copyFileSync(join(RAIZ, archivo), join(carpeta, archivo));
        }
      }
      const archivo = join(carpeta, ARCHIVOS[entorno][servicio]);
      writeFileSync(archivo, JSON.stringify({ ...JSON.parse(readFileSync(archivo, 'utf8')), ...cambio }));
      assert.throws(() => leerPerfil(carpeta), motivo, `${entorno}/${servicio}: ${JSON.stringify(cambio)}`);
    }
  } finally {
    rmSync(carpeta, { recursive: true, force: true });
  }
}

test('el perfil versionado separa producción y ensayo y conserva la instalación existente', () => {
  const perfil = leerPerfil(RAIZ);
  assert.equal(perfil.produccion.principal.name, 'faro-pruebas');
  assert.equal(perfil.produccion.cursos.name, 'faro-pruebas-cursos');
  assert.deepEqual(perfil.produccion.principal.migrations, [
    { tag: 'faro-pruebas-inicial-v1', new_sqlite_classes: [CLASE] },
  ]);
  assert.deepEqual(perfil.produccion.principal.services, [{ binding: 'CURSOS', service: 'faro-pruebas-cursos' }]);
  assert.deepEqual(perfil.produccion.principal.routes, [{ pattern: 'faroapp.org', custom_domain: true }]);
  assert.equal(perfil.ensayo.principal.name, 'faro-ensayo');
  assert.equal(perfil.ensayo.cursos.name, 'faro-ensayo-cursos');
  assert.deepEqual(perfil.ensayo.principal.migrations, [
    { tag: 'faro-ensayo-inicial-v1', new_sqlite_classes: [CLASE] },
  ]);
  for (const entorno of ['produccion', 'ensayo'] as const) {
    assert.equal(perfil[entorno].cursos.workers_dev, false);
    assert.equal(perfil[entorno].principal.workers_dev, entorno === 'ensayo');
  }
});

test('ningún archivo puede volver a compartir Workers, migraciones o datos con el otro entorno', () => {
  const transferencia = (from_script: string, tag: string) => ({
    migrations: [{ tag, transferred_classes: [{ from: CLASE, from_script, to: CLASE }] }],
  });
  rechaza([
    ['ensayo', 'principal', { name: 'faro-pruebas' }, /cuatro Workers distintos/],
    ['ensayo', 'cursos', { name: 'faro-pruebas-cursos' }, /CURSOS debe ser su Worker de Cursos/],
    ['ensayo', 'principal', { services: [{ binding: 'CURSOS', service: 'faro-pruebas-cursos' }] }, /CURSOS debe ser/],
    [
      'ensayo',
      'principal',
      { migrations: [{ tag: 'faro-pruebas-inicial-v1', new_sqlite_classes: [CLASE] }] },
      /no comparten etiquetas/,
    ],
    [
      'ensayo',
      'principal',
      transferencia('faro-pruebas', 'faro-ensayo-copia-v1'),
      /no puede transferir datos de producción/,
    ],
    ['produccion', 'principal', transferencia('faro-ensayo', 'faro-adopcion-v1'), /no puede adoptar datos del ensayo/],
  ]);
});

test('producción no se expone en workers.dev ni en previews y solo declara su dominio propio', () => {
  const ruta = (pattern: string, custom_domain = true) => ({ routes: [{ pattern, custom_domain }] });
  rechaza([
    ['produccion', 'principal', { workers_dev: true }, /workers_dev debe ser false/],
    ['produccion', 'principal', { preview_urls: true }, /preview_urls difiere del producto/],
    ['produccion', 'principal', ruta('faroapp.org', false), /exactamente un dominio propio/],
    ['produccion', 'principal', ruta('faro-pruebas.faroapp.workers.dev'), /no se sirve en workers\.dev/],
    ['produccion', 'principal', ruta('faroapp.org/*'), /exactamente un dominio propio/],
    ['produccion', 'principal', ruta('*.faroapp.org'), /exactamente un dominio propio/],
    [
      'produccion',
      'principal',
      { routes: [...ruta('faroapp.org').routes, ...ruta('otro.example').routes] },
      /exactamente un dominio propio/,
    ],
    ['produccion', 'cursos', { workers_dev: true }, /workers_dev debe ser false/],
    ['produccion', 'cursos', ruta('cursos.faroapp.org'), /campos no admitidos/],
    ['ensayo', 'principal', ruta('ensayo.faroapp.org'), /campos no admitidos/],
    ['ensayo', 'cursos', { workers_dev: true }, /workers_dev debe ser false/],
    ['ensayo', 'principal', { preview_urls: true }, /preview_urls difiere del producto/],
  ]);
});

test('los campos del producto, los bindings y las variables no se sustituyen desde la configuración', () => {
  const principal = JSON.parse(readFileSync(join(RAIZ, ARCHIVOS.produccion.principal), 'utf8'));
  rechaza([
    ['produccion', 'principal', { vars: { FARO_ADMINISTRACION: 'si' } }, /campos no admitidos/],
    ['ensayo', 'principal', { triggers: { crons: ['15 4 * * *'] } }, /campos no admitidos/],
    ['produccion', 'cursos', { limits: { cpu_ms: 50 } }, /campos no admitidos/],
    ['produccion', 'principal', { assets: { ...principal.assets, run_worker_first: false } }, /assets difiere/],
    [
      'produccion',
      'principal',
      { durable_objects: { bindings: [{ name: 'OTRO', class_name: CLASE }] } },
      /durable_objects difiere/,
    ],
    ['ensayo', 'principal', { main: 'src/plataforma/cloudflare/worker.ts' }, /main difiere/],
    ['produccion', 'principal', { compatibility_flags: [] }, /compatibility_flags difiere/],
    [
      'produccion',
      'principal',
      { services: [...principal.services, { binding: 'OTRO', service: 'otro' }] },
      /solo el servicio CURSOS/,
    ],
    ['produccion', 'principal', { name: 'Faro Pruebas' }, /nombre de Worker inválido/],
  ]);
});

test('el historial de migraciones admite varias entradas válidas y nunca borra ni crea la clase antes de transferirla', () => {
  const crear = (tag: string, clase = CLASE) => ({ tag, new_sqlite_classes: [clase] });
  const transferir = (tag: string, from_script = 'faro-pruebas') => ({
    tag,
    transferred_classes: [{ from: CLASE, from_script, to: CLASE }],
  });
  assert.deepEqual(
    comprobarMigraciones(
      [crear('v1', 'Anterior'), { tag: 'v2', renamed_classes: [{ from: 'Anterior', to: CLASE }] }],
      'faro',
    ),
    ['v1', 'v2'],
  );
  assert.deepEqual(comprobarMigraciones([transferir('faro-transferencia-v1')], 'faro'), ['faro-transferencia-v1']);
  for (const [historial, motivo] of [
    [[], /se exige el historial/],
    [[{ tag: 'v1', deleted_classes: [CLASE] }], /solo se admite una operación/],
    [[{ tag: 'v1', new_classes: [CLASE] }], /solo se admite una operación/],
    [[{ ...crear('v1'), renamed_classes: [{ from: CLASE, to: 'Otra' }] }], /solo se admite una operación/],
    [[crear('v1'), transferir('v2')], /ya existe en este Worker/],
    [[transferir('v1', 'faro')], /no se transfiere a sí mismo/],
    [[crear('v1'), crear('v1', 'Otra')], /etiqueta repetida/],
    [[crear('v1'), crear('v2', 'Otra')], /terminar exactamente con/],
    [[{ tag: 'v1', renamed_classes: [{ from: 'Ausente', to: CLASE }] }], /no existe la clase Ausente/],
    [[{ tag: 'V 1', new_sqlite_classes: [CLASE] }], /etiqueta ausente o inválida/],
  ] as const) {
    assert.throws(() => comprobarMigraciones(historial, 'faro'), motivo, JSON.stringify(historial));
  }
});

const INICIAL = { tag: 'faro-pruebas-inicial-v1', new_sqlite_classes: [CLASE] };
const ORIGEN_ENSAYO = 'https://faro-ensayo.cuenta-ejemplo.workers.dev';
function registroDeProduccion(cambio: Cambio = {}) {
  return leerRegistroInstalacion({
    version: 1,
    entorno: 'produccion',
    tipo: 'existente',
    worker: 'faro-pruebas',
    cursos: 'faro-pruebas-cursos',
    origen: 'https://faroapp.org',
    migraciones_aplicadas: [INICIAL],
    ...cambio,
  });
}
function registroDeEnsayo(cambio: Cambio = {}) {
  return registroDeProduccion({
    entorno: 'ensayo',
    tipo: 'nueva',
    worker: 'faro-ensayo',
    cursos: 'faro-ensayo-cursos',
    origen: ORIGEN_ENSAYO,
    migraciones_aplicadas: [],
    ...cambio,
  });
}

test('el registro de instalación distingue instalación nueva y actualización existente', () => {
  const perfil = leerPerfil(RAIZ);
  assert.equal(migracionPendiente(perfil.produccion, registroDeProduccion(), 'produccion'), null);
  assert.equal(migracionPendiente(perfil.ensayo, registroDeEnsayo(), 'ensayo'), 'faro-ensayo-inicial-v1');
  for (const cambio of [
    { tipo: 'nueva' },
    { migraciones_aplicadas: [] },
    { migraciones_aplicadas: ['faro-pruebas-inicial-v1'] },
    { migraciones_aplicadas: [INICIAL, INICIAL] },
    { migraciones_aplicadas: [{ ...INICIAL, deleted_classes: [CLASE] }] },
    { credencial: 'valor' },
    { version: 2 },
    { origen: undefined },
    { origen: 'https://faroapp.org/' },
    { origen: 'http://faroapp.org' },
    { origen: 'https://faro-pruebas.faroapp.workers.dev' },
  ]) {
    assert.throws(() => registroDeProduccion(cambio), /Registro de instalación inválido/, JSON.stringify(cambio));
  }
});

test('el registro de ensayo fija el origen exacto de su Worker con el subdominio de la cuenta', () => {
  for (const origen of [
    'https://faro-pruebas.cuenta-ejemplo.workers.dev',
    'https://faro-ensayo.workers.dev',
    'https://faro-ensayo.cuenta-ejemplo.workers.dev/',
    'https://faro-ensayo.Cuenta-Ejemplo.workers.dev',
    'http://faro-ensayo.cuenta-ejemplo.workers.dev',
    'https://faro-ensayo.cuenta-ejemplo.workers.dev.example.org',
    'https://faro-ensayo.<subdominio-de-la-cuenta>.workers.dev',
    'https://faroapp.org',
  ]) {
    assert.throws(() => registroDeEnsayo({ origen }), /el origen de ensayo es https:\/\/faro-ensayo\./, origen);
  }
  const perfil = leerPerfil(RAIZ);
  const compartido = registroDeEnsayo({
    worker: 'faro-pruebas',
    cursos: 'faro-pruebas-cursos',
    origen: 'https://faro-pruebas.cuenta-ejemplo.workers.dev',
  });
  assert.throws(() => migracionPendiente(perfil.ensayo, compartido, 'ensayo'), /otros Workers/);
  assert.throws(
    () => migracionPendiente(perfil.produccion, registroDeProduccion({ origen: 'https://otra.example' }), 'produccion'),
    /otro dominio que la configuración de producción/,
  );
});

test('el historial aplicado se compara completo: misma etiqueta con otra operación no es continuidad', () => {
  const perfil = leerPerfil(RAIZ);
  const registro = registroDeProduccion();
  const renombrado = { ...perfil.produccion, principal: { ...perfil.produccion.principal, name: 'faro' } };
  const conHistorial = (migrations: unknown[]) => ({
    ...perfil.produccion,
    principal: comprobarServicio({ ...perfil.produccion.principal, migrations }, 'produccion', 'principal'),
  });
  const transferida = {
    tag: 'faro-pruebas-inicial-v1',
    transferred_classes: [{ from: CLASE, from_script: 'otro-worker', to: CLASE }],
  };
  const anterior = { tag: 'v1', new_sqlite_classes: ['Anterior'] };
  const renombrada = { tag: 'v2', renamed_classes: [{ from: 'Anterior', to: CLASE }] };
  for (const [entorno, configuracion, motivo] of [
    ['produccion', renombrado, /otros Workers/],
    ['ensayo', perfil.produccion, /otro entorno/],
    ['produccion', conHistorial([{ ...INICIAL, tag: 'faro-otra-v1' }]), /no conserva el historial/],
    ['produccion', conHistorial([transferida]), /etiquetas y operaciones deben coincidir/],
    ['produccion', conHistorial([anterior, renombrada]), /no conserva el historial/],
  ] as const) {
    assert.throws(() => migracionPendiente(configuracion, registro, entorno), motivo);
  }
  const continuo = registroDeProduccion({ migraciones_aplicadas: [anterior] });
  assert.equal(migracionPendiente(conHistorial([anterior, renombrada]), continuo, 'produccion'), 'v2');
  const variasPendientes = {
    ...perfil.produccion,
    principal: { ...perfil.produccion.principal, migrations: [INICIAL, { tag: 'a' }, { tag: 'b' }] },
  };
  assert.throws(() => migracionPendiente(variasPendientes, registro, 'produccion'), /como mucho una/);
});

test('la plantilla del registro solo se admite con el subdominio de la cuenta y describe el primer ensayo', () => {
  const plantilla = JSON.parse(readFileSync(join(RAIZ, 'config/cloudflare/instalacion.example.json'), 'utf8'));
  assert.throws(() => leerRegistroInstalacion(plantilla), /subdominio de la cuenta/);
  const registro = leerRegistroInstalacion({
    ...plantilla,
    origen: plantilla.origen.replace('<subdominio-de-la-cuenta>', 'cuenta-ejemplo'),
  });
  assert.equal(registro.tipo, 'nueva');
  assert.equal(registro.origen, ORIGEN_ENSAYO);
  assert.equal(migracionPendiente(leerPerfil(RAIZ).ensayo, registro, 'ensayo'), 'faro-ensayo-inicial-v1');
});

test('la raíz no ofrece una configuración de Wrangler que se descubra sola', () => {
  for (const archivo of ['wrangler.json', 'wrangler.jsonc', 'wrangler.toml']) {
    assert.equal(existsSync(join(RAIZ, archivo)), false, `${archivo} haría que wrangler deploy publicase sin guardias`);
  }
});

test('los parámetros de Access del ensayo solo admiten el origen exacto de la instalación autorizada', () => {
  const correcto = {
    equipo: 'entidad-ejemplo.cloudflareaccess.com',
    audiencia: 'a'.repeat(LONGITUD_AUDIENCIA),
    origen: ORIGEN_ENSAYO,
  };
  assert.deepEqual(leerAccesoEnsayo(correcto, ORIGEN_ENSAYO), correcto);
  const autorizada = /instalación de ensayo autorizada/;
  for (const [cambio, motivo] of [
    [{ origen: 'https://faro-ensayo.otra-cuenta.workers.dev' }, autorizada],
    [{ origen: 'https://faro-pruebas.cuenta-ejemplo.workers.dev' }, autorizada],
    [{ origen: `${ORIGEN_ENSAYO}/` }, autorizada],
    [{ origen: 'http://faro-ensayo.cuenta-ejemplo.workers.dev' }, autorizada],
    [{ origen: 'https://faro-ensayo.workers.dev' }, autorizada],
    [{ origen: 'https://faroapp.org' }, autorizada],
    [{ equipo: 'https://otro.example/ruta' }, /aplicación de Cloudflare Access válida/],
    [{ audiencia: 'breve' }, /Audiencia de Access inválida/],
    [{ secreto: 'ajeno' }, /exactamente equipo, audiencia y origen/],
  ] as const) {
    assert.throws(() => leerAccesoEnsayo({ ...correcto, ...cambio }, ORIGEN_ENSAYO), motivo, JSON.stringify(cambio));
  }
});

const GUIAS = ['docs/despliegue.md', 'docs/migracion-workers.md', 'config/cloudflare/README.md'];
const DOCUMENTOS = [
  ...GUIAS,
  'docs/configuracion.md',
  'docs/operacion-local.md',
  'docs/administracion.md',
  'src/administracion/vigilante.md',
];
const MINIMO_DE_ORDENES = 8;

function leer(ruta: string): string {
  return readFileSync(join(RAIZ, ruta), 'utf8');
}
/** Ancla de un título como la calcula el visor de Markdown: minúsculas, sin puntuación y con guiones. */
function ancla(titulo: string): string {
  return titulo
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}
function anclas(texto: string): string[] {
  return [...texto.matchAll(/^#{1,6} (.+)$/gm)].map(([, titulo]) => ancla(titulo as string));
}

test('las órdenes de despliegue que citan las guías son válidas para la orden única', () => {
  const ordenes = GUIAS.flatMap((guia) =>
    [...leer(guia).matchAll(/node herramientas\/cloudflare\/desplegar\.ts([^`\n]*)/g)].map(
      ([, resto]) => resto as string,
    ),
  );
  assert.ok(ordenes.length >= MINIMO_DE_ORDENES, `solo ${ordenes.length} órdenes documentadas`);
  for (const orden of ordenes) {
    const args = (orden.match(/"[^"]*"|\S+/g) ?? []).map((parte) => parte.replace(/^"|"$/g, ''));
    const { values, positionals } = parseArgs({ args, options: OPCIONES, allowPositionals: true, strict: true });
    assert.equal(positionals.length, 1, orden);
    assert.ok(['comprobar', 'ensayar', 'publicar'].includes(positionals[0] as string), orden);
    assert.ok(values.entorno === 'produccion' || values.entorno === 'ensayo', orden);
    assert.ok(values.servicio === 'principal' || values.servicio === 'cursos', orden);
    assert.ok(values.sha256, orden);
    assert.ok(positionals[0] !== 'publicar' || values.instalacion, `publicar sin --instalacion: ${orden}`);
    assert.ok(!values.acceso || values.instalacion, `--acceso sin --instalacion: ${orden}`);
  }
});

/** Configuraciones de destino (bloques JSON) y registros de producción que cita la guía de Workers, en orden. */
function guiaDeWorkers() {
  const guia = leer('docs/migracion-workers.md');
  const destinos = [...guia.matchAll(/```json\n([\s\S]*?)```/g)].map(([, json]) => JSON.parse(json as string));
  const registros = [...guia.matchAll(/`(\{"version":1,"entorno":"produccion"[^`]*\})`/g)].map(([, json]) =>
    leerRegistroInstalacion(JSON.parse(json as string)),
  );
  return { destinos, registros };
}

test('el renombrado documentado conserva el historial aplicado y no deja migraciones pendientes', () => {
  const { destinos, registros } = guiaDeWorkers();
  const [destino] = destinos;
  const registro = registros.find((r) => r.tipo === 'existente');
  assert.ok(destino && registro, 'la guía cita el destino y el registro del renombrado');
  assert.deepEqual(Object.keys(destino).sort(), ['name', 'services'], 'el renombrado solo cambia nombres');
  const actual = leerEntorno(RAIZ, 'produccion');
  const renombrado = {
    principal: comprobarServicio({ ...actual.principal, ...destino }, 'produccion', 'principal'),
    cursos: comprobarServicio({ ...actual.cursos, name: 'faro-cursos' }, 'produccion', 'cursos'),
  };
  comprobarSeparacion({ produccion: renombrado, ensayo: leerEntorno(RAIZ, 'ensayo') });
  assert.deepStrictEqual(renombrado.principal.migrations, actual.principal.migrations);
  assert.deepStrictEqual(registro.migraciones_aplicadas, actual.principal.migrations);
  assert.equal(migracionPendiente(renombrado, registro, 'produccion'), null);
  const anterior = { ...registro, worker: 'faro-pruebas', cursos: 'faro-pruebas-cursos' };
  assert.throws(() => migracionPendiente(renombrado, anterior, 'produccion'), /otros Workers/);
  assert.throws(() => migracionPendiente(actual, registro, 'produccion'), /otros Workers/);
});

test('la transferencia documentada como alternativa pasa los validadores y deja una sola migración pendiente', () => {
  const { destinos, registros } = guiaDeWorkers();
  const destino = destinos[1];
  const registro = registros.find((r) => r.tipo === 'nueva');
  assert.ok(destino && registro, 'la guía cita el destino y el registro de la transferencia');
  const actual = leerEntorno(RAIZ, 'produccion');
  const migrado = {
    principal: comprobarServicio({ ...actual.principal, ...destino }, 'produccion', 'principal'),
    cursos: comprobarServicio({ ...actual.cursos, name: 'faro-cursos' }, 'produccion', 'cursos'),
  };
  comprobarSeparacion({ produccion: migrado, ensayo: leerEntorno(RAIZ, 'ensayo') });
  assert.equal(migracionPendiente(migrado, registro, 'produccion'), 'faro-transferencia-v1');
  assert.throws(
    () => migracionPendiente(migrado, { ...registro, worker: 'faro-pruebas' }, 'produccion'),
    /otros Workers/,
  );
});

/** Enlaces relativos de un documento que no llevan a un archivo o a un título existente. */
function enlacesRotos(documento: string): string[] {
  const rotos: string[] = [];
  for (const [, destino = ''] of leer(documento).matchAll(/\]\(([^)\s]+)\)/g)) {
    if (/^(?:https?:|mailto:)/.test(destino)) {
      continue;
    }
    const [ruta = '', fragmento] = destino.split('#');
    const archivo = ruta === '' ? join(RAIZ, documento) : join(RAIZ, documento, '..', ruta);
    const conAncla = fragmento !== undefined && archivo.endsWith('.md');
    if (
      !existsSync(archivo) ||
      (conAncla && !anclas(readFileSync(archivo, 'utf8')).includes(decodeURIComponent(fragmento)))
    ) {
      rotos.push(`${documento}: ${destino}`);
    }
  }
  return rotos;
}

test('los enlaces y anclas de las guías de instalación existen', () => {
  assert.deepEqual(DOCUMENTOS.flatMap(enlacesRotos), []);
});

test('la migración de producción que cita la guía es la aplicada en la configuración versionada', () => {
  const guia = leer('config/cloudflare/README.md');
  const citada = JSON.parse(guia.match(/`(\{"tag":"faro-pruebas-inicial-v1"[^`]*\})`/)?.[1] ?? 'null');
  assert.deepStrictEqual([citada], leerPerfil(RAIZ).produccion.principal.migrations);
});

test('los perfiles trasladados resuelven las mismas entradas y recursos desde su carpeta', () => {
  for (const archivos of Object.values(ARCHIVOS)) {
    for (const [servicio, archivo] of Object.entries(archivos)) {
      const config = JSON.parse(readFileSync(join(RAIZ, archivo), 'utf8')) as {
        main: string;
        base_dir: string;
        assets?: { directory: string };
      };
      const carpeta = dirname(join(RAIZ, archivo));
      const worker = servicio === 'principal' ? 'worker' : 'worker-cursos';
      assert.equal(resolve(carpeta, config.main), join(RAIZ, 'dist', worker, 'worker.mjs'));
      assert.equal(resolve(carpeta, config.base_dir), join(RAIZ, 'dist', worker));
      if (servicio === 'principal') {
        assert.ok(config.assets);
        assert.equal(resolve(carpeta, config.assets.directory), join(RAIZ, 'dist/web'));
      }
    }
  }
});
