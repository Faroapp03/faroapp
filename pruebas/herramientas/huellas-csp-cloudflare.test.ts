import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { pasosDeCodigo } from '../../scripts/verificar.ts';

const raiz = fileURLToPath(new URL('../../', import.meta.url));
const PORTADA = 'src/plataforma/cloudflare/portada-publica.ts';
const ACCESO_WEB = 'src/plataforma/cloudflare/acceso-web-pagina.ts';
const GUION_PORTADA = 'herramientas/cloudflare/actualizar-portada.ts';
const GUION_ACCESO_WEB = 'herramientas/cloudflare/actualizar-acceso-web.ts';
const ACTIVOS = 'src/plataforma/cloudflare/activos-publicos.ts';
const FOTOGRAFIA = 'web/imagenes/fotografias/faro-penmon.webp';

/** Contenido y fecha de modificación: una reescritura con el mismo texto también cambia la fecha. */
function estado(relativa: string): string {
  const ruta = join(raiz, relativa);
  const huella = createHash('sha256').update(readFileSync(ruta)).digest('hex');
  return `${huella} ${statSync(ruta, { bigint: true }).mtimeNs}`;
}

function comprobar(base: string, guion: string) {
  return spawnSync(process.execPath, [join(base, guion), '--comprobar'], { encoding: 'utf8', cwd: base });
}

/**
 * Añade un espacio al contenido de la primera etiqueta indicada sin tocar la constante que guarda su huella. Si la
 * etiqueta empieza por una interpolación, el espacio entra al principio de la plantilla interpolada.
 */
function alterarEtiqueta(ruta: string, etiqueta: 'script' | 'style'): void {
  const fuente = readFileSync(ruta, 'utf8');
  const apertura = `<${etiqueta}>`;
  const inicio = fuente.indexOf(apertura);
  assert.ok(inicio >= 0, `${ruta} sin ${apertura} literal`);
  const tras = inicio + apertura.length;
  const interpolada = /^\s*\$\{(\w+)\}/.exec(fuente.slice(tras))?.[1];
  const declaracion = interpolada ? new RegExp(`const ${interpolada} =\\s*\``).exec(fuente) : null;
  assert.ok(!interpolada || declaracion, `${ruta} sin la plantilla ${interpolada}`);
  const posicion = declaracion ? declaracion.index + declaracion[0].length : tras;
  writeFileSync(ruta, `${fuente.slice(0, posicion)} ${fuente.slice(posicion)}`);
}

test('importar los guiones de huellas CSP no reescribe los módulos de las páginas', async () => {
  const antes = [estado(PORTADA), estado(ACCESO_WEB)];
  await import('../../herramientas/cloudflare/actualizar-portada.ts');
  await import('../../herramientas/cloudflare/actualizar-acceso-web.ts');
  assert.deepEqual([estado(PORTADA), estado(ACCESO_WEB)], antes);
});

test('la comprobación de huellas CSP del producto termina en verde sin escribir', () => {
  const antes = [estado(PORTADA), estado(ACCESO_WEB), estado(ACTIVOS)];
  for (const guion of [GUION_PORTADA, GUION_ACCESO_WEB]) {
    const resultado = comprobar(raiz, guion);
    assert.equal(resultado.status, 0, resultado.stderr);
    assert.match(resultado.stdout, /al día/);
  }
  assert.deepEqual([estado(PORTADA), estado(ACCESO_WEB), estado(ACTIVOS)], antes);
});

/** Lo que leen los guiones de huellas: los módulos de las páginas, sus dependencias y la fotografía compartida. */
function copiarLoNecesario(copia: string): void {
  for (const ruta of [
    'src/plataforma/cloudflare',
    'src/plataforma/paquete-publicado.ts',
    'src/plataforma/navegacion.ts',
    'src/comun',
    'herramientas/cloudflare',
    'herramientas/comun',
    FOTOGRAFIA,
  ]) {
    cpSync(join(raiz, ruta), join(copia, ruta), { recursive: true });
  }
}

test('la comprobación de huellas CSP rechaza un byte cambiado en el guion o el estilo sin escribir', () => {
  const casos = [
    { guion: GUION_PORTADA, modulo: PORTADA, etiqueta: 'script', huella: 'CSP_SCRIPT_CABECERA' },
    { guion: GUION_PORTADA, modulo: PORTADA, etiqueta: 'style', huella: 'CSP_PORTADA' },
    { guion: GUION_ACCESO_WEB, modulo: ACCESO_WEB, etiqueta: 'script', huella: 'CSP_GUION_ACCESO_WEB' },
    { guion: GUION_ACCESO_WEB, modulo: ACCESO_WEB, etiqueta: 'style', huella: 'CSP_ESTILO_ACCESO_WEB' },
  ] as const;
  for (const caso of casos) {
    const copia = mkdtempSync(join(tmpdir(), 'huellas-csp-'));
    try {
      copiarLoNecesario(copia);
      const modulo = join(copia, caso.modulo);
      alterarEtiqueta(modulo, caso.etiqueta);
      const alterado = readFileSync(modulo);
      const resultado = comprobar(copia, caso.guion);
      assert.equal(resultado.status, 1, `${caso.huella}: ${resultado.stdout}${resultado.stderr}`);
      assert.match(resultado.stderr, new RegExp(`no coinciden con su HTML.*${caso.huella}`));
      assert.deepEqual(readFileSync(modulo), alterado);
    } finally {
      rmSync(copia, { recursive: true, force: true });
    }
  }
});

test('la comprobación rechaza una fotografía compartida con otros bytes que su huella, sin escribir', () => {
  const copia = mkdtempSync(join(tmpdir(), 'huellas-activos-'));
  try {
    copiarLoNecesario(copia);
    const foto = join(copia, FOTOGRAFIA);
    writeFileSync(foto, Buffer.concat([readFileSync(foto), Buffer.from([0])]));
    const modulo = readFileSync(join(copia, ACTIVOS));
    const resultado = comprobar(copia, GUION_PORTADA);
    assert.equal(resultado.status, 1, `${resultado.stdout}${resultado.stderr}`);
    assert.match(resultado.stderr, /no coinciden con su archivo de la web.*HUELLA_FOTOGRAFIA_PORTADA/);
    assert.deepEqual(readFileSync(join(copia, ACTIVOS)), modulo);
  } finally {
    rmSync(copia, { recursive: true, force: true });
  }
});

test('las huellas de la portada se calculan solo de su guion y su estilo', async () => {
  const { huellaCsp, huellasDePortada } = await import('../../herramientas/cloudflare/actualizar-portada.ts');
  assert.deepEqual(huellasDePortada('<style>a{}</style><script>b()</script>'), {
    CSP_SCRIPT_CABECERA: huellaCsp('b()'),
    CSP_PORTADA: huellaCsp('a{}'),
  });
  assert.throws(() => huellasDePortada('<script>b()</script>'), /Falta el contenido de <style>/);
});

test('la verificación ejecuta cada comprobación de huellas CSP una sola vez y sin escritura', () => {
  const pasos = pasosDeCodigo(raiz);
  for (const guion of [GUION_PORTADA, GUION_ACCESO_WEB]) {
    const coincidentes = pasos.filter((paso) => paso.argumentos.includes(guion));
    assert.equal(coincidentes.length, 1, guion);
    assert.equal(coincidentes[0]?.comando, process.execPath);
    assert.deepEqual(coincidentes[0]?.argumentos, [guion, '--comprobar']);
  }
});
