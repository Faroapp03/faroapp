// Etapa «Base ESCO local» de la verificación: la base, su validación y las huellas que la atan al manifiesto y a la
// captura. Cada caso crea una raíz sintética bajo tmpdir; ninguno escribe en el producto ni consulta la red.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs, {
  chmodSync,
  closeSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { mock, type TestContext, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  BASE_ESCO,
  CAPTURA_ESCO,
  comprobarBaseEsco,
  HUELLAS_DE_LA_CAPTURA,
  huellaDeLaCaptura,
  huellaFijada,
  MANIFIESTO,
  resumenDeLaBaseEsco,
  VALIDACION_ESCO,
} from '../../scripts/base-esco.ts';
import { FalloDeComprobacion } from '../../scripts/fallo-de-comprobacion.ts';
import { principal } from '../../scripts/verificar.ts';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
const sha256 = (texto: string): string => createHash('sha256').update(texto).digest('hex');
const CONTENIDO = 'base ESCO sintética\n';
const HUELLA = sha256(CONTENIDO);
const HUELLA_CAPTURA = sha256('captura ESCO sintética\n');
const HUELLA_PROCEDENCIA = sha256('procedencia sintética\n');
const OTRA_HUELLA = 'f'.repeat(HUELLA.length);
const CIFRAS_ABREVIADAS = 12;
const abreviada = (huella: string): string => huella.slice(0, CIFRAS_ABREVIADAS);
const SECCION = /README\.md, «Base ESCO para la verificación»/u;
const CODIGO_USO_INVALIDO = 2;
const PERMISOS_NULOS = 0o000;

/** Una raíz con espacios en su nombre que se elimina aunque falle una afirmación. */
function raizDePrueba(contexto: TestContext, prefijo = 'faro base esco #% '): string {
  const raiz = mkdtempSync(join(tmpdir(), prefijo));
  contexto.after(() => rmSync(raiz, { recursive: true, force: true }));
  return raiz;
}

function escribir(raiz: string, relativa: string, contenido: string): string {
  const ruta = join(raiz, relativa);
  mkdirSync(dirname(ruta), { recursive: true });
  writeFileSync(ruta, contenido);
  return ruta;
}

function escribirManifiesto(raiz: string, manifiesto: unknown): void {
  escribir(raiz, MANIFIESTO, JSON.stringify(manifiesto));
}

const manifiestoCon = (huella: string): unknown => ({
  'esco.json': { origenes: { [BASE_ESCO]: huella }, sha256: OTRA_HUELLA },
});

function escribirHuellasDeLaCaptura(raiz: string, lineas: readonly string[]): void {
  escribir(raiz, HUELLAS_DE_LA_CAPTURA, `${lineas.join('\n')}\n`);
}

const HUELLAS_CORRECTAS = [
  `${HUELLA_CAPTURA}  ${CAPTURA_ESCO}`,
  `${HUELLA_PROCEDENCIA}  var/actualizacion/originales/esco/procedencia.json`,
];

function escribirValidacion(raiz: string, informe: unknown): void {
  escribir(raiz, VALIDACION_ESCO, JSON.stringify(informe));
}

const VALIDACION_CORRECTA = { estado: 'Admitido', sha256_original: HUELLA_CAPTURA, sha256_sqlite: HUELLA };

/** Una instalación sintética completa: manifiesto, huellas de la captura, base y validación coherentes. */
function instalacion(raiz: string): string {
  escribirManifiesto(raiz, manifiestoCon(HUELLA));
  escribirHuellasDeLaCaptura(raiz, HUELLAS_CORRECTAS);
  escribirValidacion(raiz, VALIDACION_CORRECTA);
  escribir(raiz, BASE_ESCO, CONTENIDO);
  return raiz;
}

async function rechaza(raiz: string, ...patrones: readonly RegExp[]): Promise<void> {
  await assert.rejects(comprobarBaseEsco(raiz), (error: unknown) => {
    assert.ok(error instanceof FalloDeComprobacion, String(error));
    assert.match(error.message, /^Base ESCO local: /u);
    for (const patron of patrones) {
      assert.match(error.message, patron);
    }
    return true;
  });
}

/** Lo que hay bajo la raíz con el contenido de cada archivo, para comprobar que la etapa no escribe nada. */
function inventario(raiz: string): Record<string, string> {
  return Object.fromEntries(
    readdirSync(raiz, { recursive: true, encoding: 'utf8' })
      .sort()
      .map((nombre) => {
        const ruta = join(raiz, nombre);
        return [nombre, statSync(ruta).isFile() ? sha256(readFileSync(ruta, 'latin1')) : 'carpeta'];
      }),
  );
}

/** Sustituye una función de node:fs también para los módulos que la importan por nombre. */
function sustituir<N extends 'openSync' | 'createReadStream' | 'statSync' | 'fstatSync'>(
  contexto: TestContext,
  nombre: N,
  sustituta: (typeof fs)[N],
): void {
  mock.method(fs, nombre, sustituta);
  syncBuiltinESMExports();
  contexto.after(() => {
    mock.restoreAll();
    syncBuiltinESMExports();
  });
}

const errorDeSistema = (code: string): NodeJS.ErrnoException => Object.assign(new Error(code), { code });

test('una instalación coherente da correcto y la etapa no cambia ningún nombre ni contenido', async (contexto) => {
  const raiz = instalacion(raizDePrueba(contexto));
  const antes = inventario(raiz);
  assert.equal(await comprobarBaseEsco(raiz), HUELLA);
  assert.deepEqual(inventario(raiz), antes);
  assert.match(resumenDeLaBaseEsco(HUELLA), new RegExp(`^Base ESCO local: correcto \\(${abreviada(HUELLA)}…`, 'u'));
});

test('una raíz alcanzada por carpetas enlazadas, como /var en macOS, no es un falso positivo', async (contexto) => {
  const real = raizDePrueba(contexto, 'faro carpeta real ');
  const enlazada = join(raizDePrueba(contexto, 'faro enlaces '), 'var');
  symlinkSync(real, enlazada);
  const raiz = instalacion(join(enlazada, 'instalacion'));
  assert.equal(await comprobarBaseEsco(raiz), HUELLA);
});

test('sin la base, falla y remite al README en lugar de omitir la comprobación', async (contexto) => {
  const raiz = instalacion(raizDePrueba(contexto));
  rmSync(join(raiz, BASE_ESCO));
  await rechaza(raiz, new RegExp(`falta ${BASE_ESCO}\\. Prepárala`, 'u'), SECCION);
});

test('un archivo en lugar de una carpeta de la ruta (ENOTDIR) se explica como base ausente', async (contexto) => {
  const raiz = instalacion(raizDePrueba(contexto));
  rmSync(join(raiz, 'var/actualizacion/validados'), { recursive: true });
  escribir(raiz, 'var/actualizacion/validados', 'no es una carpeta');
  await rechaza(raiz, new RegExp(`falta ${BASE_ESCO}`, 'u'), SECCION);
});

test('una base que es un enlace simbólico falla aunque apunte a una base con la huella correcta', async (contexto) => {
  const raiz = instalacion(raizDePrueba(contexto));
  const ajena = escribir(raizDePrueba(contexto, 'faro otra instalacion '), BASE_ESCO, CONTENIDO);
  rmSync(join(raiz, BASE_ESCO));
  symlinkSync(ajena, join(raiz, BASE_ESCO));
  await rechaza(raiz, /es un enlace simbólico/u, SECCION);
});

test('el enlace simbólico en el último tramo sin O_NOFOLLOW de Linux (EMLINK) se explica igual', async (contexto) => {
  const raiz = instalacion(raizDePrueba(contexto));
  const abrir = fs.openSync;
  const base = join(raiz, BASE_ESCO);
  let sustituidas = 0;
  sustituir(contexto, 'openSync', ((ruta: fs.PathLike, banderas?: fs.OpenMode, modo?: fs.Mode | null) => {
    if (ruta !== base) {
      return abrir(ruta, banderas ?? 'r', modo);
    }
    sustituidas += 1;
    throw errorDeSistema('EMLINK');
  }) as typeof fs.openSync);
  await rechaza(raiz, /es un enlace simbólico/u, SECCION);
  assert.equal(sustituidas, 1);
});

test('un enlace duro a la base de otra instalación no pasa por un archivo propio', async (contexto) => {
  const raiz = instalacion(raizDePrueba(contexto));
  const ajena = escribir(raizDePrueba(contexto, 'faro otra instalacion '), BASE_ESCO, CONTENIDO);
  rmSync(join(raiz, BASE_ESCO));
  linkSync(ajena, join(raiz, BASE_ESCO));
  await rechaza(raiz, new RegExp(`${BASE_ESCO} es un enlace duro: el mismo archivo tiene 2 nombres`, 'u'), SECCION);
});

test('una copia independiente de la base de otra instalación, clonada o no, es un archivo propio', async (contexto) => {
  const raiz = instalacion(raizDePrueba(contexto));
  const ajena = escribir(raizDePrueba(contexto, 'faro otra instalacion '), BASE_ESCO, CONTENIDO);
  const base = join(raiz, BASE_ESCO);
  rmSync(base);
  // COPYFILE_FICLONE clona donde el sistema puede (APFS, Btrfs) y copia donde no: este caso no distingue clon de
  // copia; demuestra que se acepta un archivo independiente con su propio nombre.
  fs.copyFileSync(ajena, base, fs.constants.COPYFILE_FICLONE);
  assert.equal(statSync(base).nlink, 1);
  assert.notEqual(statSync(base).ino, statSync(ajena).ino);
  assert.equal(await comprobarBaseEsco(raiz), HUELLA);
});

test('una base borrada entre la apertura y la comprobación (nlink 0) se explica como un cambio', async (contexto) => {
  const raiz = instalacion(raizDePrueba(contexto));
  const inodo = statSync(join(raiz, BASE_ESCO)).ino;
  const estadoAbierto = fs.fstatSync;
  let sustituidas = 0;
  sustituir(contexto, 'fstatSync', ((descriptor: number, opciones?: fs.StatOptions) => {
    const real = estadoAbierto(descriptor, opciones);
    if (real.ino !== inodo) {
      return real;
    }
    sustituidas += 1;
    return Object.assign(Object.create(Object.getPrototypeOf(real)), real, { nlink: 0 });
  }) as typeof fs.fstatSync);
  await rechaza(raiz, new RegExp(`${BASE_ESCO} ha cambiado mientras se comprobaba: se ha borrado`, 'u'));
  await assert.rejects(comprobarBaseEsco(raiz), (error: Error) => !error.message.includes('enlace duro'));
  assert.equal(sustituidas, 2);
});

test('un validacion.json con un enlace duro tampoco pasa por un archivo propio', async (contexto) => {
  const raiz = instalacion(raizDePrueba(contexto));
  linkSync(join(raiz, VALIDACION_ESCO), join(raiz, 'otro-nombre.json'));
  await rechaza(raiz, new RegExp(`${VALIDACION_ESCO} es un enlace duro`, 'u'), /Vuelve a preparar y validar/u);
});

test('una base sustituida entre la apertura y la comprobación de su ruta falla y pide repetir', async (contexto) => {
  const raiz = instalacion(raizDePrueba(contexto));
  const estado = fs.statSync;
  const base = realpathSync(join(raiz, BASE_ESCO));
  let sustituidas = 0;
  sustituir(contexto, 'statSync', ((ruta: fs.PathLike, opciones?: fs.StatSyncOptions) => {
    const real = estado(ruta, opciones);
    if (ruta !== base || real === undefined) {
      return real;
    }
    sustituidas += 1;
    return Object.assign(Object.create(Object.getPrototypeOf(real)), real, { ino: Number(real.ino) + 1 });
  }) as typeof fs.statSync);
  await rechaza(raiz, new RegExp(`${BASE_ESCO} ha cambiado mientras se comprobaba`, 'u'), /vuelve a lanzar/u);
  assert.equal(sustituidas, 1);
});

test('una carpeta enlazada hacia otra instalación falla y dice que el archivo está fuera', async (contexto) => {
  const raiz = instalacion(raizDePrueba(contexto));
  const otra = instalacion(raizDePrueba(contexto, 'faro otra instalacion '));
  rmSync(join(raiz, 'var'), { recursive: true });
  symlinkSync(join(otra, 'var'), join(raiz, 'var'));
  await rechaza(raiz, /se alcanza por un enlace y el archivo está fuera de esta instalación/u, SECCION);
});

test('una carpeta enlazada dentro de la instalación falla sin decir que está fuera', async (contexto) => {
  const raiz = instalacion(raizDePrueba(contexto));
  const esco = join(raiz, 'var/actualizacion/validados/esco');
  const copia = join(raiz, 'otra/esco');
  mkdirSync(dirname(copia), { recursive: true });
  fs.renameSync(esco, copia);
  symlinkSync(copia, esco);
  await rechaza(raiz, /el archivo está en otra\/esco\/biblioteca-esco\.sqlite, otra ruta de esta instalación/u);
  await assert.rejects(comprobarBaseEsco(raiz), (error: Error) => !error.message.includes('fuera'));
});

test('una carpeta o una FIFO en el lugar de la base fallan sin bloquear la lectura', async (contexto) => {
  const raiz = instalacion(raizDePrueba(contexto));
  rmSync(join(raiz, BASE_ESCO));
  mkdirSync(join(raiz, BASE_ESCO));
  await rechaza(raiz, /no es un archivo/u);
  rmSync(join(raiz, BASE_ESCO), { recursive: true });
  const creada = spawnSync('mkfifo', [join(raiz, BASE_ESCO)]);
  assert.equal(creada.status, 0, String(creada.stderr));
  await rechaza(raiz, /no es un archivo/u, SECCION);
});

test('un error de apertura distinto de los anteriores dice qué comprobar', async (contexto) => {
  const raiz = instalacion(raizDePrueba(contexto));
  const base = join(raiz, BASE_ESCO);
  chmodSync(base, PERMISOS_NULOS);
  await rechaza(
    raiz,
    new RegExp(`no se puede abrir ${BASE_ESCO} \\(EACCES\\)\\. Comprueba que tu usuario puede leer`, 'u'),
  );
});

test('un error de lectura al calcular la huella es un fallo de la etapa con qué hacer', async (contexto) => {
  const raiz = instalacion(raizDePrueba(contexto));
  sustituir(contexto, 'createReadStream', (_ruta, opciones) => {
    if (typeof opciones === 'object' && typeof opciones?.fd === 'number') {
      closeSync(opciones.fd);
    }
    return new Readable({
      read() {
        this.destroy(errorDeSistema('EIO'));
      },
    }) as fs.ReadStream;
  });
  await rechaza(raiz, new RegExp(`no se puede leer ${BASE_ESCO} \\(EIO\\)\\. Comprueba el disco`, 'u'), SECCION);
});

test('una base con otra huella falla y muestra las dos huellas abreviadas', async (contexto) => {
  const raiz = instalacion(raizDePrueba(contexto));
  const distinto = 'otra base ESCO\n';
  writeFileSync(join(raiz, BASE_ESCO), distinto);
  await rechaza(
    raiz,
    new RegExp(
      `\\(${abreviada(sha256(distinto))}…\\) no coincide con la fijada en datos/manifiesto\\.json \\(${abreviada(HUELLA)}…\\)`,
      'u',
    ),
    SECCION,
  );
});

test('un manifiesto sin la entrada de la base ESCO falla antes de mirar la base', async (contexto) => {
  const raiz = instalacion(raizDePrueba(contexto));
  const sinEntrada =
    /no fija la huella de var\/actualizacion\/validados\/esco\/biblioteca-esco\.sqlite en «esco\.json»/u;
  for (const manifiesto of [
    {},
    { 'esco.json': { sha256: OTRA_HUELLA } },
    { 'esco.json': { origenes: {} } },
    { 'esco.json': { origenes: { [BASE_ESCO]: 'no es una huella' } } },
    [],
  ]) {
    escribirManifiesto(raiz, manifiesto);
    await rechaza(raiz, sinEntrada);
  }
  rmSync(join(raiz, MANIFIESTO));
  await rechaza(raiz, /no se puede leer datos\/manifiesto\.json/u);
});

test('captura.sha256 tiene que fijar una sola huella para la captura', async (contexto) => {
  const raiz = instalacion(raizDePrueba(contexto));
  const sinHuella = /captura\.sha256 no fija una única huella para var\/actualizacion\/originales\/esco/u;
  for (const lineas of [
    [HUELLAS_CORRECTAS[1] ?? ''],
    [...HUELLAS_CORRECTAS, `${OTRA_HUELLA}  ${CAPTURA_ESCO}`],
    [`${HUELLA_CAPTURA}  ./${CAPTURA_ESCO}`],
  ]) {
    escribirHuellasDeLaCaptura(raiz, lineas);
    await rechaza(raiz, sinHuella);
  }
  escribirHuellasDeLaCaptura(raiz, [`${HUELLA_CAPTURA} *${CAPTURA_ESCO}`]);
  assert.equal(huellaDeLaCaptura(raiz), HUELLA_CAPTURA);
  rmSync(join(raiz, HUELLAS_DE_LA_CAPTURA));
  await rechaza(raiz, /no se puede leer plataforma_datos\/ocupaciones\/fuentes\/esco\/captura\.sha256/u);
});

test('sin validacion.json, o con uno ilegible o enlazado, falla y pide preparar y validar', async (contexto) => {
  const raiz = instalacion(raizDePrueba(contexto));
  const validacion = join(raiz, VALIDACION_ESCO);
  rmSync(validacion);
  await rechaza(raiz, new RegExp(`falta ${VALIDACION_ESCO}\\. Vuelve a preparar y validar`, 'u'), SECCION);
  writeFileSync(validacion, '{ no es JSON');
  await rechaza(raiz, new RegExp(`no se puede leer ${VALIDACION_ESCO} como JSON\\. Vuelve`, 'u'), SECCION);
  rmSync(validacion);
  const ajena = join(raizDePrueba(contexto, 'faro validacion ajena '), 'validacion.json');
  writeFileSync(ajena, JSON.stringify(VALIDACION_CORRECTA));
  symlinkSync(ajena, validacion);
  await rechaza(raiz, new RegExp(`${VALIDACION_ESCO} es un enlace simbólico`, 'u'));
});

test('validacion.json tiene que registrar la base del manifiesto y la captura de captura.sha256', async (contexto) => {
  const raiz = instalacion(raizDePrueba(contexto));
  const casos: readonly [unknown, RegExp][] = [
    [
      { ...VALIDACION_CORRECTA, sha256_sqlite: OTRA_HUELLA },
      new RegExp(
        `«sha256_sqlite» registra ${abreviada(OTRA_HUELLA)}…, y datos/manifiesto\\.json fija ${abreviada(HUELLA)}…`,
        'u',
      ),
    ],
    [{ ...VALIDACION_CORRECTA, sha256_sqlite: undefined }, /«sha256_sqlite» no registra ninguna huella/u],
    [
      { ...VALIDACION_CORRECTA, sha256_original: OTRA_HUELLA },
      new RegExp(
        `«sha256_original» registra ${abreviada(OTRA_HUELLA)}…, y plataforma_datos/ocupaciones/fuentes/esco/captura\\.sha256 fija ${abreviada(HUELLA_CAPTURA)}…`,
        'u',
      ),
    ],
    [{ ...VALIDACION_CORRECTA, sha256_original: 7 }, /«sha256_original» no registra ninguna huella/u],
    [[], /«sha256_sqlite» no registra ninguna huella/u],
  ];
  for (const [informe, patron] of casos) {
    escribirValidacion(raiz, informe);
    await rechaza(raiz, patron, /Vuelve a preparar y validar/u, SECCION);
  }
});

test('el manifiesto y captura.sha256 de esta instalación fijan las dos huellas', () => {
  assert.match(huellaFijada(RAIZ), /^[0-9a-f]{64}$/u);
  assert.match(huellaDeLaCaptura(RAIZ), /^[0-9a-f]{64}$/u);
});

test('principal comprueba la base primero en verificar y en npm test, no con --navegador', async (contexto) => {
  const raiz = raizDePrueba(contexto);
  escribirManifiesto(raiz, manifiestoCon(HUELLA));
  escribirHuellasDeLaCaptura(raiz, HUELLAS_CORRECTAS);
  for (const argumentos of [['--pruebas'], []]) {
    await assert.rejects(
      principal(raiz, argumentos),
      new RegExp(`^FalloDeComprobacion: Base ESCO local: falta ${BASE_ESCO}`, 'u'),
    );
  }
  await assert.rejects(principal(raiz, ['--desconocido']), (error: unknown) => {
    assert.ok(error instanceof FalloDeComprobacion);
    assert.equal(error.codigo, CODIGO_USO_INVALIDO);
    return true;
  });
  await assert.rejects(principal(raiz, ['--navegador', join(raiz, 'ajena.test.mjs')]), (error: Error) => {
    assert.doesNotMatch(error.message, /Base ESCO local/u);
    return true;
  });
});
