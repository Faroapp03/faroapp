/**
 * Configuración privada de APT para las bibliotecas de los navegadores: la identidad genérica (APT solo admite la UA;
 * no se le atribuye soporte de las tres pistas) y las fuentes, que son solo el archivo oficial de Ubuntu. Un espejo
 * regional degradado no envía datos a ritmo útil; las demás fuentes del sistema no hacen falta para estas bibliotecas.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { IDENTIDAD_WEB } from '../../src/comun/identidad-web.ts';

const LLAVE_OFICIAL = '/usr/share/keyrings/ubuntu-archive-keyring.gpg';
const COMPONENTES = 'main restricted universe multiverse';
/** Ubuntu sirve amd64 e i386 desde archive y security; el resto de arquitecturas, desde ports. */
const ARQUITECTURAS_DEL_ARCHIVO = new Set(['amd64', 'i386']);
const NOMBRE_SEGURO = /^[a-z0-9]+$/;

export function configuracionApt(): string {
  return `${['http', 'https']
    .map((protocolo) => `Acquire::${protocolo}::User-Agent "${IDENTIDAD_WEB['User-Agent']}";`)
    .join('\n')}\n`;
}

/** La suite del runner, de su /etc/os-release; solo se admite Ubuntu, que es lo que sirve el archivo oficial. */
export function suiteDelSistema(osRelease: string): string {
  const campo = (nombre: string) => new RegExp(`^${nombre}="?([^"\\n]*)"?$`, 'm').exec(osRelease)?.[1] ?? '';
  const suite = campo('VERSION_CODENAME') || campo('UBUNTU_CODENAME');
  if (campo('ID') !== 'ubuntu' || !NOMBRE_SEGURO.test(suite)) {
    throw new Error('El runner no es un Ubuntu con nombre de versión: no se conoce su archivo oficial.');
  }
  return suite;
}

/** Las únicas fuentes que lee APT: la suite, sus actualizaciones y sus parches de seguridad, firmados por Ubuntu. */
export function fuentesOficiales(suite: string, arquitectura: string): string {
  if (!NOMBRE_SEGURO.test(suite) || !NOMBRE_SEGURO.test(arquitectura)) {
    throw new Error('La suite y la arquitectura deben ser nombres simples.');
  }
  const archivo = ARQUITECTURAS_DEL_ARCHIVO.has(arquitectura);
  const paquetes = archivo ? 'https://archive.ubuntu.com/ubuntu/' : 'https://ports.ubuntu.com/ubuntu-ports/';
  const seguridad = archivo ? 'https://security.ubuntu.com/ubuntu/' : paquetes;
  const opciones = `[arch=${arquitectura} signed-by=${LLAVE_OFICIAL}]`;
  return [
    [paquetes, suite],
    [paquetes, `${suite}-updates`],
    [seguridad, `${suite}-security`],
  ]
    .map(([origen, nombre]) => `deb ${opciones} ${origen} ${nombre} ${COMPONENTES}\n`)
    .join('');
}

/** Lo que va en el archivo que APT lee el último: la lista oficial y una carpeta de piezas vacía, para nada más. */
export function configuracionFuentes(lista: string, piezas: string): string {
  return `Dir::Etc::sourcelist "${lista}";\nDir::Etc::sourceparts "${piezas}";\n`;
}

/** Uso: configurar-apt.ts identidad | configurar-apt.ts fuentes <lista> <carpeta de piezas> <arquitectura> */
if (import.meta.main) {
  const [orden, lista, piezas, arquitectura] = process.argv.slice(2);
  if (orden === 'identidad') {
    process.stdout.write(configuracionApt());
  } else if (orden === 'fuentes' && lista && piezas && arquitectura) {
    const suite = suiteDelSistema(readFileSync('/etc/os-release', 'utf8'));
    writeFileSync(lista, fuentesOficiales(suite, arquitectura));
    process.stdout.write(configuracionFuentes(lista, piezas));
  } else {
    process.stderr.write('Uso: configurar-apt.ts identidad | fuentes <lista> <carpeta de piezas> <arquitectura>\n');
    process.exit(2);
  }
}
