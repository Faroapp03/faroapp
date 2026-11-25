// La comprobación previa del controlador de vídeo de la máquina virtual (scripts/controlador-de-video.ts), con un
// `ioreg` simulado: un script que imprime las conexiones que se le piden. Lleno para; normal, ausente o Linux no dicen
// nada (y en Linux ni se llama a ioreg); un ioreg que falla avisa sin parar; y la batería de navegador la corre antes
// de lanzar nada.
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type TestContext, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  CLASE_DEL_CONTROLADOR,
  comprobarControladorDeVideo,
  conexionesDelControlador,
  UMBRAL_DE_CONEXIONES,
} from '../../scripts/controlador-de-video.ts';
import { FalloDeComprobacion } from '../../scripts/fallo-de-comprobacion.ts';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
/** El identificador de la primera conexión simulada y el pid de su proceso, como en una salida real. */
const PRIMER_ID = 0x100000584;
const PRIMER_PID = 1000;
const BASE_HEXADECIMAL = 16;
/** Conexiones de una máquina en uso normal (se midieron 509) y de una con el controlador por encima del umbral. */
const CONEXIONES_NORMALES = 509;
const CONEXIONES_DE_EJEMPLO = 37;
const EXCESO_SOBRE_EL_UMBRAL = 120;
const EXCESO_EN_LINUX = 100;
/** Permisos de un script ejecutable. */
const PERMISOS_EJECUTABLE = 0o755;
/** Estado con el que termina un ioreg simulado que falla. */
const ESTADO_DE_FALLO = 3;

function area(contexto: TestContext): string {
  const carpeta = mkdtempSync(join(realpathSync(tmpdir()), 'faro controlador video '));
  contexto.after(() => rmSync(carpeta, { recursive: true, force: true }));
  return carpeta;
}

/** La salida de `ioreg -r -c <clase> -w0` con N conexiones, con sus líneas de detalle y una línea de cabecera. */
function salidaDeIoreg(conexiones: number): string {
  const entradas = Array.from(
    { length: conexiones },
    (_, i) =>
      `+-o ${CLASE_DEL_CONTROLADOR}  <class ${CLASE_DEL_CONTROLADOR}, id 0x${(PRIMER_ID + i).toString(BASE_HEXADECIMAL)}, !registered, !matched, active, busy 0, retain 5>\n` +
      `    {\n      "IOUserClientCreator" = "pid ${PRIMER_PID + i}, WallpaperAerials"\n    }\n\n`,
  );
  return entradas.join('');
}

/** Un `ioreg` simulado que imprime `texto` y termina con `estado`; deja constancia de sus argumentos. */
function ioregSimulado(contexto: TestContext, texto: string, estado = 0): { ruta: string; llamadas: string } {
  const carpeta = area(contexto);
  const ruta = join(carpeta, 'ioreg');
  const salida = join(carpeta, 'salida.txt');
  const llamadas = join(carpeta, 'llamadas.txt');
  writeFileSync(salida, texto);
  writeFileSync(ruta, `#!/bin/sh\nprintf '%s\\n' "$*" >> '${llamadas}'\ncat '${salida}'\nexit ${estado}\n`);
  chmodSync(ruta, PERMISOS_EJECUTABLE);
  return { ruta, llamadas };
}

const SIN_AVISOS = (texto: string): never => {
  throw new Error(`Aviso inesperado: ${texto}`);
};

test('cuenta una conexión por entrada y consulta solo la clase del controlador, en solo lectura', (contexto) => {
  const { ruta, llamadas } = ioregSimulado(contexto, salidaDeIoreg(CONEXIONES_DE_EJEMPLO));
  assert.equal(
    conexionesDelControlador({ plataforma: 'darwin', ioreg: ruta, avisar: SIN_AVISOS }),
    CONEXIONES_DE_EJEMPLO,
  );
  assert.equal(readFileSync(llamadas, 'utf8').trim(), `-r -c ${CLASE_DEL_CONTROLADOR} -w0`);
});

test('con el controlador casi lleno para y dice cuántas conexiones hay', (contexto) => {
  const conexiones = UMBRAL_DE_CONEXIONES + EXCESO_SOBRE_EL_UMBRAL;
  const { ruta } = ioregSimulado(contexto, salidaDeIoreg(conexiones));
  assert.throws(
    () => comprobarControladorDeVideo({ plataforma: 'darwin', ioreg: ruta, avisar: SIN_AVISOS }),
    (error) => {
      assert(error instanceof FalloDeComprobacion);
      assert.equal(
        error.message,
        `El controlador de vídeo de la máquina virtual está casi lleno (${conexiones} de ~1024 conexiones): reinicia la máquina virtual antes de las pruebas de navegador`,
      );
      return true;
    },
  );
});

test('el umbral se supera, no se iguala', (contexto) => {
  const igual = ioregSimulado(contexto, salidaDeIoreg(UMBRAL_DE_CONEXIONES));
  comprobarControladorDeVideo({ plataforma: 'darwin', ioreg: igual.ruta, avisar: SIN_AVISOS });
  const encima = ioregSimulado(contexto, salidaDeIoreg(UMBRAL_DE_CONEXIONES + 1));
  assert.throws(
    () => comprobarControladorDeVideo({ plataforma: 'darwin', ioreg: encima.ruta, avisar: SIN_AVISOS }),
    FalloDeComprobacion,
  );
});

test('con una ocupación normal sigue sin decir nada', (contexto) => {
  const { ruta } = ioregSimulado(contexto, salidaDeIoreg(CONEXIONES_NORMALES));
  comprobarControladorDeVideo({ plataforma: 'darwin', ioreg: ruta, avisar: SIN_AVISOS });
});

test('sin el controlador (ioreg no imprime nada) o sin ioreg, no hace nada', (contexto) => {
  const vacio = ioregSimulado(contexto, '');
  assert.equal(conexionesDelControlador({ plataforma: 'darwin', ioreg: vacio.ruta, avisar: SIN_AVISOS }), 0);
  comprobarControladorDeVideo({ plataforma: 'darwin', ioreg: vacio.ruta, avisar: SIN_AVISOS });
  const ausente = join(area(contexto), 'no-existe');
  assert.equal(conexionesDelControlador({ plataforma: 'darwin', ioreg: ausente, avisar: SIN_AVISOS }), 0);
  comprobarControladorDeVideo({ plataforma: 'darwin', ioreg: ausente, avisar: SIN_AVISOS });
});

test('en Linux no hace nada ni llama a ioreg, aunque estuviera lleno', (contexto) => {
  const { ruta, llamadas } = ioregSimulado(contexto, salidaDeIoreg(UMBRAL_DE_CONEXIONES + EXCESO_EN_LINUX));
  comprobarControladorDeVideo({ plataforma: 'linux', ioreg: ruta, avisar: SIN_AVISOS });
  assert.equal(conexionesDelControlador({ plataforma: 'linux', ioreg: ruta, avisar: SIN_AVISOS }), 0);
  assert.equal(existsSync(llamadas), false);
});

test('un ioreg que falla avisa y no para la batería', (contexto) => {
  const { ruta } = ioregSimulado(contexto, '', ESTADO_DE_FALLO);
  const avisos: string[] = [];
  comprobarControladorDeVideo({ plataforma: 'darwin', ioreg: ruta, avisar: (texto) => avisos.push(texto) });
  assert.equal(avisos.length, 1);
  assert.match(avisos[0] ?? '', /No se ha podido leer el controlador de vídeo con ioreg \(terminó con 3\)/);
});

test('la batería de navegador comprueba el controlador antes de lanzar nada', () => {
  const verificar = readFileSync(join(RAIZ, 'scripts/verificar.ts'), 'utf8');
  const cuerpo = verificar.slice(verificar.indexOf('async function probarNavegador'));
  assert(cuerpo.indexOf('comprobarControladorDeVideo()') > 0);
  assert(cuerpo.indexOf('comprobarControladorDeVideo()') < cuerpo.indexOf('conFirefox('));
  for (const archivo of ['pruebas/navegadores/ensayo.ts', 'scripts/probar-motor-empaquetado.ts']) {
    const texto = readFileSync(join(RAIZ, archivo), 'utf8');
    assert(texto.includes('comprobarControladorDeVideo()'), `${archivo} no comprueba el controlador de vídeo`);
  }
});
