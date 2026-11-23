// Promoción local con reserva y respaldo; el descriptor anterior acredita integridad, no autenticidad.
import { createHash } from 'node:crypto';
import fs, { type Stats } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { comprobarArtefactoCloudflare, leerDescriptorArtefactoCloudflare } from '../cloudflare/artefacto.ts';

const SOLO_PROPIETARIO = 0o700;
const MAX_DESCRIPTOR = 8_388_608;
const ERROR = 'No se puede promover la salida construida';
interface Anterior {
  readonly estado: Stats;
  readonly sha256: string;
}
interface Promocion {
  readonly destino: string;
  readonly etapa: string;
  readonly nuevo: string;
  readonly respaldo: string;
  readonly anterior: Anterior | undefined;
  reserva: Stats | undefined;
  publicada: Stats | undefined;
  trasladado: boolean;
  conservar: boolean;
}
function exigir(condicion: unknown): asserts condicion {
  if (!condicion) {
    throw new Error(ERROR);
  }
}
function estado(ruta: string): Stats | undefined {
  return fs.lstatSync(ruta, { throwIfNoEntry: false });
}
function mismo(actual: Stats | undefined, esperado: Stats): boolean {
  return !!actual && actual.dev === esperado.dev && actual.ino === esperado.ino;
}
function dentro(padre: string, hijo: string): boolean {
  const ruta = relative(padre, hijo);
  return ruta === '' || (ruta !== '..' && !ruta.startsWith(`..${sep}`) && !isAbsolute(ruta));
}
function rutas(origen: string, destino: string): { fuente: string; final: string } {
  const fuente = resolve(origen),
    final = resolve(destino);
  exigir(fs.realpathSync(fuente) === fuente && fs.realpathSync(dirname(final)) === dirname(final));
  exigir(fs.lstatSync(dirname(final)).isDirectory() && !dentro(fuente, final) && !dentro(final, fuente));
  return { fuente, final };
}
function huellaPropia(carpeta: string): string {
  const archivo = join(carpeta, 'artefacto.json');
  const info = fs.lstatSync(archivo);
  exigir(info.isFile() && info.nlink === 1 && info.size <= MAX_DESCRIPTOR);
  const contenido = fs.readFileSync(archivo);
  exigir(contenido.byteLength <= MAX_DESCRIPTOR);
  return createHash('sha256').update(contenido).digest('hex');
}
function anterior(destino: string): Anterior | undefined {
  const info = estado(destino);
  if (!info) {
    return undefined;
  }
  exigir(info.isDirectory() && !info.isSymbolicLink());
  const sha256 = huellaPropia(destino);
  comprobarArtefactoCloudflare(destino, sha256);
  exigir(mismo(estado(destino), info));
  return { estado: info, sha256 };
}
function comprobarAnterior(p: Promocion): void {
  if (p.anterior) {
    exigir(mismo(estado(p.destino), p.anterior.estado));
    comprobarArtefactoCloudflare(p.destino, p.anterior.sha256);
  } else {
    exigir(!estado(p.destino));
  }
}
function copiar(fuente: string, nuevo: string, sha256: string): void {
  const d = leerDescriptorArtefactoCloudflare(join(fuente, 'artefacto.json'), sha256);
  fs.mkdirSync(nuevo, { mode: SOLO_PROPIETARIO });
  const tamanos = new Map(d.archivos.map((a) => [a.ruta, a.bytes]));
  for (const ruta of ['artefacto.json', ...d.archivos.map((a) => a.ruta)]) {
    const origen = join(fuente, ruta),
      destino = join(nuevo, ruta);
    const info = fs.lstatSync(origen);
    const tamano = ruta === 'artefacto.json' ? MAX_DESCRIPTOR : tamanos.get(ruta);
    exigir(info.isFile() && info.nlink === 1 && tamano !== undefined && info.size <= tamano);
    fs.mkdirSync(dirname(destino), { recursive: true });
    fs.copyFileSync(origen, destino, fs.constants.COPYFILE_EXCL);
  }
  comprobarArtefactoCloudflare(nuevo, sha256);
  comprobarArtefactoCloudflare(fuente, sha256);
}
function publicar(p: Promocion, sha256: string): void {
  comprobarAnterior(p);
  if (p.anterior) {
    fs.renameSync(p.destino, p.respaldo);
    p.trasladado = true;
  }
  // La carpeta vacía propia impide reemplazar una carpeta que aparezca durante la preparación.
  fs.mkdirSync(p.destino, { mode: SOLO_PROPIETARIO });
  p.reserva = fs.lstatSync(p.destino);
  exigir(mismo(estado(p.destino), p.reserva));
  const nueva = fs.lstatSync(p.nuevo);
  fs.renameSync(p.nuevo, p.destino);
  p.reserva = undefined;
  p.publicada = nueva;
  comprobarArtefactoCloudflare(p.destino, sha256);
}
function restaurar(p: Promocion): void {
  if (p.publicada) {
    exigir(mismo(estado(p.destino), p.publicada));
    fs.renameSync(p.destino, p.nuevo);
  } else if (p.reserva && mismo(estado(p.destino), p.reserva)) {
    fs.rmdirSync(p.destino);
  }
  if (p.trasladado && p.anterior) {
    exigir(!estado(p.destino));
    comprobarArtefactoCloudflare(p.respaldo, p.anterior.sha256);
    fs.renameSync(p.respaldo, p.destino);
    p.trasladado = false;
  }
}
function promover(p: Promocion, sha256: string): void {
  try {
    publicar(p, sha256);
  } catch (error) {
    try {
      restaurar(p);
    } catch (restauracion) {
      p.conservar = true;
      throw new AggregateError([error, restauracion], `${ERROR}; se conserva la etapa de recuperación: ${p.etapa}`);
    }
    throw error;
  }
  if (p.anterior) {
    try {
      comprobarArtefactoCloudflare(p.respaldo, p.anterior.sha256);
    } catch (error) {
      p.conservar = true;
      throw new Error(`${ERROR}; se conserva la etapa de recuperación: ${p.etapa}`, { cause: error });
    }
  }
}
function conEtapa(fuente: string, final: string, sha256: string): void {
  const previo = anterior(final);
  const etapa = fs.mkdtempSync(join(dirname(final), `.${basename(final)}.etapa-`));
  fs.chmodSync(etapa, SOLO_PROPIETARIO);
  const p: Promocion = {
    destino: final,
    etapa,
    nuevo: join(etapa, 'nuevo'),
    respaldo: join(etapa, 'anterior'),
    anterior: previo,
    reserva: undefined,
    publicada: undefined,
    trasladado: false,
    conservar: false,
  };
  try {
    copiar(fuente, p.nuevo, sha256);
    promover(p, sha256);
  } finally {
    if (!p.conservar) {
      fs.rmSync(etapa, { recursive: true });
    }
  }
}
/**
 * Copia un artefacto verificado y sustituye solo una salida ausente o íntegra según su descriptor propio.
 * Exige padres canónicos existentes y rutas disjuntas. La reserva hermana excluye otras promociones cooperantes;
 * una reserva abandonada requiere revisión manual. No borra el origen ni acredita la autenticidad de la salida previa.
 * Ante un fallo intenta restaurar la salida anterior; si no puede, conserva su respaldo e indica la etapa en el error.
 * No garantiza recuperación automática tras terminar el proceso o perder alimentación.
 */
export function promoverSalidaConstruida(origen: string, destino: string, sha256: string): void {
  const { fuente, final } = rutas(origen, destino);
  comprobarArtefactoCloudflare(fuente, sha256);
  const bloqueo = join(dirname(final), `.${basename(final)}.promocion`);
  fs.mkdirSync(bloqueo, { mode: SOLO_PROPIETARIO });
  const propia = fs.lstatSync(bloqueo);
  try {
    conEtapa(fuente, final, sha256);
  } finally {
    if (mismo(estado(bloqueo), propia)) {
      fs.rmdirSync(bloqueo);
    }
  }
}
