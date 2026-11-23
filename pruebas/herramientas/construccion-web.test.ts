import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import test from 'node:test';
import { comprobarArtefactoCloudflare } from '../../herramientas/cloudflare/artefacto.ts';
import { listarArchivos } from '../../herramientas/web/carpeta-del-motor.ts';
import { construirWeb, DESTINO_POR_DEFECTO } from '../../herramientas/web/construir.ts';
import { SCRIPTS_CLASICOS } from '../../herramientas/web/csp.ts';
import type { ResumenDelGrafo } from '../../herramientas/web/empaquetado/grafo.ts';
import { RESUMEN_DEL_GRAFO, seEmpaqueta } from '../../herramientas/web/empaquetado.ts';
import { archivosPublicados } from '../../herramientas/web/publicados.ts';
import { javascriptPublicado } from '../../herramientas/web/recursos-publicados.ts';
import { listasDelCatalogo, valoresDelServicio } from '../../herramientas/web/servicio/servicio-publicado.ts';
import { paqueteParaPublicar } from '../../src/plataforma/node/paquete-publicado.ts';
import { RUTAS } from '../../src/plataforma/node/rutas.ts';

const REVISION = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
/**
 * Lo que tarda la exportación completa, medido sobre la construcción publicable de esta versión con prioridad baja: de
 * 3,8 a 4,4 s en cuatro construcciones; al cambiar, se mide de nuevo y se anota aquí. El plazo es cinco veces esa
 * medida, pero no menos de 60 s. Con la máquina ocupada por otros procesos, la misma exportación ha llegado a tardar
 * un 30 % más, y un plazo de pocos segundos fallaría por la carga y no por la
 * construcción. Con 60 s sigue en rojo una comprobación que vuelva a crecer con el tamaño del código, como la de
 * referencias, que llevaba la exportación a 64-68 s.
 */
const DURACION_MEDIDA_S = 4.4;
const VECES_LA_MEDIDA = 5;
const SUELO_S = 60;
const MS_POR_SEGUNDO = 1000;
const PLAZO_S = Math.max(SUELO_S, VECES_LA_MEDIDA * DURACION_MEDIDA_S);
/** Un módulo que el paquete sustituye: no debe publicarse suelto. */
const EMPAQUETADO = 'scripts/recorrido/api/transporte.js';

function huella(archivo: string): string {
  return createHash('sha256').update(readFileSync(archivo)).digest('hex');
}

function fuentes(publicados: readonly string[], datos: readonly string[]): Map<string, string> {
  const rutas = [
    ...publicados.map((ruta) => join(RUTAS.web, ruta)),
    ...datos.map((ruta) => join(RUTAS.paquete, ruta)),
    ...listarArchivos(RUTAS.codigo).map((ruta) => join(RUTAS.codigo, ruta)),
  ];
  return new Map(rutas.map((ruta) => [ruta, huella(ruta)]));
}

function exportar(destino: string, version: string) {
  const inicio = performance.now();
  const salidaCli = spawnSync(
    process.execPath,
    [
      join(RUTAS.raiz, 'herramientas/cloudflare/artefacto.ts'),
      'exportar',
      destino,
      '--revision-codigo',
      REVISION,
      '--huella-paquete',
      version,
    ],
    { encoding: 'utf8', timeout: PLAZO_S * MS_POR_SEGUNDO, env: { PATH: process.env.PATH ?? '', TMPDIR: tmpdir() } },
  );
  const segundos = Math.round((performance.now() - inicio) / MS_POR_SEGUNDO);
  const plazo = `${segundos} s; plazo ${PLAZO_S} s, medida ${DURACION_MEDIDA_S} s`;
  assert.equal(
    salidaCli.status,
    0,
    salidaCli.error ? `La exportación no terminó (${plazo}): ${salidaCli.error.message}` : salidaCli.stderr,
  );
  return JSON.parse(salidaCli.stdout);
}

/** El resumen del grafo que la construcción deja junto a la salida. */
function resumenDelGrafo(destino: string): ResumenDelGrafo {
  return JSON.parse(readFileSync(`${destino}.${RESUMEN_DEL_GRAFO}`, 'utf8')) as ResumenDelGrafo;
}

/**
 * Los guiones clásicos no se empaquetan: se publican sueltos, sin los comentarios de desarrollo y con la huella de esos
 * bytes en el nombre (<fuente>-<sha256>.js), nunca con el nombre fijo de su fuente.
 */
function comprobarLimpieza(destino: string): void {
  let conComentarios = 0;
  for (const ruta of SCRIPTS_CLASICOS) {
    assert.equal(seEmpaqueta(ruta), false, ruta);
    const original = readFileSync(join(RUTAS.web, ruta), 'utf8');
    const limpio = javascriptPublicado(original, 'script');
    conComentarios += original === limpio ? 0 : 1;
    const huella = createHash('sha256').update(limpio).digest('hex');
    const publicado = `${ruta.slice(0, -'.js'.length)}-${huella}.js`;
    assert.equal(seEmpaqueta(publicado), false, publicado);
    assert.equal(existsSync(join(destino, 'web', ruta)), false, `${ruta} no se publica con su nombre fijo`);
    const base = posix.basename(ruta, '.js');
    const copias = readdirSync(join(destino, 'web', posix.dirname(ruta))).filter((archivo) =>
      new RegExp(`^${base}-[a-f0-9]{64}\\.js$`, 'u').test(archivo),
    );
    assert.deepEqual(copias, [posix.basename(publicado)], ruta);
    assert.equal(readFileSync(join(destino, 'web', publicado), 'utf8'), limpio, publicado);
  }
  assert.ok(conComentarios > 0, 'Algún guion clásico debe contener comentarios que la entrega retira');
}

/**
 * Las fuentes propias, las del panel privado y las de terceros que sustituye el paquete no se publican sueltas. El
 * Worker del motor local es la única salida del paquete que conserva la ruta de su fuente.
 */
function comprobarSinFuentesSueltas(destino: string, publicados: readonly string[], { worker }: ResumenDelGrafo): void {
  const empaquetadas = publicados.filter(
    (ruta) => /^(?:scripts|terceros|administracion)\//.test(ruta) && seEmpaqueta(ruta),
  );
  assert.ok(empaquetadas.includes(EMPAQUETADO), `${EMPAQUETADO} debe ser una fuente del paquete`);
  for (const ruta of empaquetadas) {
    const publicado = join(destino, 'web', ruta);
    if (!worker.archivos.includes(ruta)) {
      assert.ok(!existsSync(publicado), `${ruta} lo sustituye el paquete y no debe publicarse suelta`);
      continue;
    }
    const original = readFileSync(join(RUTAS.web, ruta), 'utf8');
    const emitido = readFileSync(publicado, 'utf8');
    assert.ok(emitido !== original && emitido !== javascriptPublicado(original, 'module'), `${ruta} no es el paquete`);
  }
}

/**
 * El manifiesto del dispositivo y COMPROBADOS describen el mismo motor empaquetado: los mismos archivos de motor/ con
 * la misma huella SHA-256, y el Worker del motor va en COMPROBADOS.
 */
function comprobarManifiestoDelMotor(destino: string, { motor, worker }: ResumenDelGrafo): void {
  const manifiesto = JSON.parse(readFileSync(join(destino, 'web/firmas/manifiesto.json'), 'utf8')) as {
    archivos: Record<string, string>;
  };
  const servicio = listasDelCatalogo(
    valoresDelServicio(readFileSync(join(destino, 'web/service-worker.js'), 'utf8')).CATALOGO,
  );
  const comprobados = new Map(servicio.COMPROBADOS);
  const delMotor = (entradas: Iterable<[string, string]>) =>
    Object.fromEntries([...entradas].filter(([ruta]) => ruta.startsWith('motor/')).sort());
  assert.deepEqual(delMotor(Object.entries(manifiesto.archivos)), delMotor(comprobados));
  assert.deepEqual(Object.keys(delMotor(comprobados)), [...motor.archivos].sort());
  for (const archivo of worker.archivos) {
    assert.ok(comprobados.has(archivo), `${archivo} debe estar en COMPROBADOS`);
  }
}

/** La biblioteca carga su paquete, que lleva la comprobación de sus enlaces. */
function comprobarBiblioteca(destino: string, { paginas }: ResumenDelGrafo): void {
  const biblioteca = readFileSync(join(destino, 'web/biblioteca.html'), 'utf8');
  assert.match(biblioteca, /data-abrir-es=/);
  assert.match(biblioteca, /data-comprobacion-enlace/);
  const pagina = paginas['biblioteca.html'];
  assert.ok(pagina && biblioteca.includes(pagina.entrada), 'La biblioteca debe cargar la entrada de su paquete');
  const cargados = [pagina.entrada, ...pagina.estaticos, ...pagina.dinamicos];
  assert.ok(
    cargados.some((ruta) => readFileSync(join(destino, 'web', ruta), 'utf8').includes('[data-comprobacion-enlace]')),
    'El paquete de la biblioteca debe comprobar sus enlaces',
  );
  assert.ok(!listarArchivos(destino).some((ruta) => ruta.endsWith('observaciones-lecturas.json')));
}

/** Lo que la construcción hace con el paquete del navegador, sobre su salida y su resumen del grafo. */
function comprobarPaquete(destino: string, publicados: readonly string[], grafo: ResumenDelGrafo): void {
  comprobarLimpieza(destino);
  comprobarSinFuentesSueltas(destino, publicados, grafo);
  comprobarBiblioteca(destino, grafo);
  comprobarManifiestoDelMotor(destino, grafo);
}

/** El service worker de la salida va en un solo archivo y ninguna de sus listas lleva la administración. */
function comprobarServicioPublico(destino: string): void {
  const servicio = listasDelCatalogo(
    valoresDelServicio(readFileSync(join(destino, 'web/service-worker.js'), 'utf8')).CATALOGO,
  );
  const listas = ['ARCHIVOS', 'BAJO_DEMANDA', 'PAGINAS_DE_SECCIONES', 'HUELLAS_DE_ARCHIVOS', 'COMPROBADOS'] as const;
  for (const lista of listas) {
    assert.ok(!servicio[lista].flat().some((ruta) => ruta.startsWith('administracion/')), lista);
  }
  assert.ok(!existsSync(join(destino, 'web/service-worker')), 'el service worker se publica en un solo archivo');
}

/** El Worker de WebKit no carga módulos JSON: el motor publicado no lleva ninguno, ni importaciones con atributos. */
function comprobarMotorSinJson(motor: string): void {
  const archivos = listarArchivos(motor);
  assert.ok(archivos.length > 0);
  const conJson = archivos.filter(
    (ruta) => ruta.endsWith('.json') || /\.json['"]\s*with\s*\{/.test(readFileSync(join(motor, ruta), 'utf8')),
  );
  assert.deepEqual(conJson, [], 'el Worker de WebKit no carga módulos JSON: el motor publicado no lleva ninguno');
}

test('construcción completa conserva fuentes y datos, verifica la salida y excluye material de desarrollo', () => {
  const temporal = mkdtempSync(join(realpathSync(tmpdir()), 'construccion Año 2026-'));
  try {
    const destino = join(temporal, 'Salida Faro');
    const publicados = archivosPublicados();
    const paquete = paqueteParaPublicar(RUTAS.paquete);
    const antes = fuentes(publicados, paquete.archivos);
    const resumen = exportar(destino, paquete.version);
    const grafo = resumenDelGrafo(destino);
    comprobarPaquete(destino, publicados, grafo);
    assert.equal(
      readFileSync(join(destino, 'web/llms.txt'), 'utf8'),
      readFileSync(join(RUTAS.web, 'llms.txt'), 'utf8'),
      'La documentación anunciada debe formar parte del artefacto publicado',
    );
    assert.deepEqual(comprobarArtefactoCloudflare(destino, resumen.sha256Artefacto), resumen);
    assert.deepEqual(fuentes(publicados, paquete.archivos), antes);
    assert.equal(resumen.huellaPaquete, paquete.version);
    for (const archivo of paquete.archivos) {
      assert.equal(
        huella(join(destino, 'web/paquete', paquete.version, archivo)),
        huella(join(RUTAS.paquete, archivo)),
      );
    }
    for (const archivo of publicados.filter((ruta) => ruta.startsWith('terceros/') && !seEmpaqueta(ruta))) {
      assert.equal(huella(join(destino, 'web', archivo)), huella(join(RUTAS.web, archivo)));
    }
    const salida = listarArchivos(destino);
    assert.ok(!salida.some((ruta) => /(?:\.map|\.md|\.ts|\.py)$/.test(ruta)));
    assert.ok(
      !salida.some((ruta) => /(?:^|\/)(?:node_modules|\.assetsignore|\.dev.vars|var|pruebas)(?:\/|$)/.test(ruta)),
    );
    assert.ok(existsSync(join(destino, 'web/administracion/index.html')));
    assert.ok(!existsSync(join(destino, 'web/recursos/catalogo-cursos/lector.js')), 'el lector va en el paquete');
    comprobarMotorSinJson(join(destino, 'web/motor'));
    assert.ok(existsSync(join(destino, 'worker/worker.mjs')));
    comprobarServicioPublico(destino);
  } finally {
    rmSync(temporal, { recursive: true, force: true });
  }
});

test('el resumen del grafo de la construcción por defecto queda fuera de git y de la comprobación de estilo', () => {
  // La construcción lo deja junto a su destino, en la raíz: construir y después `npm run verificar` no puede fallar
  // por un archivo generado.
  const resumen = `${DESTINO_POR_DEFECTO}.${RESUMEN_DEL_GRAFO}`;
  const biome = JSON.parse(readFileSync(join(RUTAS.raiz, 'biome.json'), 'utf8')) as { files: { includes: string[] } };
  assert.ok(biome.files.includes.includes(`!${resumen}`), `biome.json deja fuera ${resumen}`);
  const ignorados = readFileSync(join(RUTAS.raiz, '.gitignore'), 'utf8').split('\n');
  assert.ok(ignorados.includes(resumen), `.gitignore deja fuera ${resumen}`);
});

test('revisión inválida no crea salida ni inicia la construcción', async () => {
  const temporal = mkdtempSync(join(realpathSync(tmpdir()), 'construccion-invalida-'));
  try {
    const destino = join(temporal, 'salida');
    await assert.rejects(construirWeb('revision no válida', destino), /revisión de código/);
    assert.ok(!existsSync(destino));
  } finally {
    rmSync(temporal, { recursive: true, force: true });
  }
});

test('la huella esperada inválida o ajena impide construir una salida nueva', async () => {
  const temporal = mkdtempSync(join(realpathSync(tmpdir()), 'construccion-huella-'));
  try {
    const destino = join(temporal, 'salida');
    for (const huellaPaquete of ['', 'incorrecta', '0000000000000000']) {
      await assert.rejects(construirWeb(REVISION, destino, { huellaPaquete, soloNuevo: true }), /huella esperada/);
      assert.ok(!existsSync(destino));
    }
  } finally {
    rmSync(temporal, { recursive: true, force: true });
  }
});
