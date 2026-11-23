import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const fuente = fileURLToPath(new URL('../../herramientas/mantenimiento/fuente-sqlite.py', import.meta.url));
export const urlSqliteRunner = execFileSync('/usr/bin/python3', ['-I', fuente], { encoding: 'utf8' }).trim();

/** Prueba el verificador real con un ZIP local pequeño; el compilador y el Python del runner se simulan. */
export function prepararSqliteSimulado(raiz: string, workspace: string, versionNodeSqlite: string): string {
  const servidor = join(raiz, 'servidor');
  mkdirSync(servidor, { recursive: true });
  const archivo = join(servidor, basename(urlSqliteRunner));
  const paquete = basename(archivo, '.zip');
  execFileSync('/usr/bin/python3', [
    '-I',
    '-c',
    'from zipfile import ZipFile;import sys\nwith ZipFile(sys.argv[1], "w") as z:\n for n in ("sqlite3.c","sqlite3.h","sqlite3ext.h"): z.writestr(sys.argv[2]+"/"+n, sys.argv[3] if n=="sqlite3.h" else "fuente de prueba")',
    archivo,
    paquete,
    `#define SQLITE_VERSION "${versionNodeSqlite}"\n`,
  ]);
  const bytes = readFileSync(archivo);
  const helper = readFileSync(fuente, 'utf8')
    .replace(/^BYTES = [0-9_]+$/m, `BYTES = ${bytes.length}`)
    .replace(/^SHA3 = "[0-9a-f]+"$/m, `SHA3 = "${createHash('sha3-256').update(bytes).digest('hex')}"`);
  const carpeta = join(workspace, 'herramientas/mantenimiento');
  writeFileSync(join(carpeta, 'fuente-sqlite.py'), helper);
  const comprobador = 'comprobar-sqlite-node.mjs';
  copyFileSync(new URL(`../../herramientas/mantenimiento/${comprobador}`, import.meta.url), join(carpeta, comprobador));
  writeFileSync(
    join(carpeta, 'instalar-sqlite-linux.sh'),
    'set -eu\ntest -x "$1/bin/python3.12" && test -s "$2/sqlite3.c"\nmkdir -p "$1/lib"\nprintf compilada > "$1/lib/libsqlite3.so.0"\n',
  );
  return archivo;
}
