/** Exportación privada local: conserva una construcción admitida; no firma, publica ni activa datos. */
// biome-ignore lint/style/noExcessiveLinesPerFile: La validación y exportación comparten el contrato del descriptor.
import { createHash } from 'node:crypto';
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { paqueteDeManifiesto } from '../../src/plataforma/node/paquete-publicado.ts';
import { RUTAS } from '../../src/plataforma/node/rutas.ts';
import { versionDelPaquete } from '../../src/plataforma/paquete-publicado.ts';
import { leerManifiesto } from '../../web/scripts/firmas/manifiesto-firmado.js';
import { orden } from '../comun/opciones.ts';
import type { ConstruccionCloudflare, WebConstruida } from './comprobar-construccion.ts';

const DESCRIPTOR = 'artefacto.json';
const MAX_DESCRIPTOR = 8_388_608;
const MAX_WORKER = 67_108_864;
const MAX_ASSET = 26_214_400;
const MAX_TOTAL = 1_073_741_824;
const MAX_ASSETS = 20_000;
const MAX_ARCHIVOS = 21_000;
const MAX_ENTRADAS = 84_000;
const MAX_RUTA = 512;
const HEX64 = /^[0-9a-f]{64}$/;
const HEX40 = /^[0-9a-f]{40}$/;
const HEX16 = /^[0-9a-f]{16}$/;
const ERROR = 'Artefacto Cloudflare no verificable';
class FalloArtefacto extends Error {}
/**
 * Lo que lleva cada Worker (su carpeta: worker/ el principal, worker-cursos/ el de Cursos), sumado para su tope de
 * 64 MiB: cada uno se sube aparte y tiene el suyo.
 */
function sumarAlWorker(porWorker: Map<string, number>, ruta: string, bytes: number): void {
  const carpeta = ruta.slice(0, ruta.indexOf('/'));
  const suma = (porWorker.get(carpeta) ?? 0) + bytes;
  porWorker.set(carpeta, suma);
  exigir(suma <= MAX_WORKER);
}
interface Archivo {
  readonly ruta: string;
  readonly bytes: number;
  readonly sha256: string;
}
export interface DescriptorArtefactoCloudflare {
  readonly version: 1;
  readonly destino?: 'privado' | 'oficial';
  readonly revisionCodigo: string;
  readonly huellaPaquete: string;
  readonly sha256ManifiestoPaquete: string;
  readonly sha256ManifiestoDispositivo: string;
  readonly archivos: readonly Archivo[];
}
export interface ResumenArtefactoCloudflare {
  readonly version: 1;
  readonly revisionCodigo: string;
  readonly huellaPaquete: string;
  readonly sha256Artefacto: string;
  readonly archivos: number;
  readonly bytesTotales: number;
}
function exigir(condicion: unknown): asserts condicion {
  if (!condicion) {
    throw new FalloArtefacto(ERROR);
  }
}
function sha(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
function objeto(valor: unknown, campos: string): Record<string, unknown> {
  exigir(typeof valor === 'object' && valor !== null && !Array.isArray(valor));
  exigir(Object.keys(valor).sort().join(',') === campos.split(',').sort().join(','));
  return valor as Record<string, unknown>;
}
function rutaValida(ruta: unknown): asserts ruta is string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: las rutas rechazan explícitamente caracteres de control.
  exigir(typeof ruta === 'string' && ruta.length <= MAX_RUTA && !/[\\:\x00-\x1f\x7f]/u.test(ruta));
  exigir(ruta.split('/').every((p) => p !== '' && p !== '.' && p !== '..'));
  exigir(
    /^worker(-cursos)?\/worker\.mjs$/.test(ruta) ||
      /^worker(-cursos)?\/datos\/[a-z0-9-]+\.json$/.test(ruta) ||
      ruta.startsWith('web/'),
  );
}
function leer(ruta: string, limite: number): Buffer {
  const estado = lstatSync(ruta);
  exigir(estado.isFile() && !estado.isSymbolicLink() && estado.nlink === 1 && estado.size <= limite);
  const bytes = readFileSync(ruta);
  exigir(bytes.byteLength <= limite);
  return bytes;
}
function json(bytes: Uint8Array): unknown {
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}
function archivoDe(entrada: unknown): Archivo {
  const a = objeto(entrada, 'ruta,bytes,sha256');
  rutaValida(a.ruta);
  exigir(typeof a.bytes === 'number' && Number.isSafeInteger(a.bytes) && a.bytes >= 0);
  exigir(typeof a.sha256 === 'string' && HEX64.test(a.sha256));
  return { ruta: a.ruta, bytes: a.bytes, sha256: a.sha256 };
}
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Valida un esquema cerrado y su inventario completo.
function descriptorDe(bytes: Uint8Array): DescriptorArtefactoCloudflare {
  const valor = json(bytes);
  const conDestino = typeof valor === 'object' && valor !== null && Object.hasOwn(valor, 'destino');
  const o = objeto(
    valor,
    `${conDestino ? 'destino,' : ''}version,revisionCodigo,huellaPaquete,sha256ManifiestoPaquete,sha256ManifiestoDispositivo,archivos`,
  );
  exigir(!conDestino || o.destino === 'privado' || o.destino === 'oficial');
  exigir(o.version === 1 && typeof o.revisionCodigo === 'string' && HEX40.test(o.revisionCodigo));
  exigir(typeof o.huellaPaquete === 'string' && HEX16.test(o.huellaPaquete));
  exigir(typeof o.sha256ManifiestoPaquete === 'string' && HEX64.test(o.sha256ManifiestoPaquete));
  exigir(typeof o.sha256ManifiestoDispositivo === 'string' && HEX64.test(o.sha256ManifiestoDispositivo));
  exigir(versionDelPaquete(o.sha256ManifiestoPaquete) === o.huellaPaquete);
  exigir(Array.isArray(o.archivos) && o.archivos.length > 0 && o.archivos.length <= MAX_ARCHIVOS);
  let anterior = '',
    total = 0,
    assets = 0;
  const porWorker = new Map<string, number>();
  const alias = new Set<string>();
  for (const entrada of o.archivos) {
    const a = archivoDe(entrada);
    exigir(a.ruta > anterior && !alias.has(a.ruta.normalize('NFC').toLowerCase()));
    anterior = a.ruta;
    alias.add(a.ruta.normalize('NFC').toLowerCase());
    if (a.ruta.startsWith('web/')) {
      exigir(a.bytes <= MAX_ASSET);
      assets++;
    } else {
      sumarAlWorker(porWorker, a.ruta, a.bytes);
    }
    total += a.bytes;
  }
  exigir(total <= MAX_TOTAL && assets <= MAX_ASSETS);
  return o as unknown as DescriptorArtefactoCloudflare;
}
/** Valida identidad externa, esquema y rutas sin abrir ni necesitar los archivos del inventario. */
export function leerDescriptorArtefactoCloudflare(
  archivo: string,
  sha256Esperado: string,
): DescriptorArtefactoCloudflare {
  exigir(typeof sha256Esperado === 'string' && HEX64.test(sha256Esperado));
  const bytes = leer(archivo, MAX_DESCRIPTOR);
  if (sha(bytes) !== sha256Esperado) {
    throw new FalloArtefacto(`${ERROR}: la huella del descriptor no coincide`);
  }
  try {
    return descriptorDe(bytes);
  } catch (error) {
    if (error instanceof FalloArtefacto || error instanceof SyntaxError || error instanceof TypeError) {
      throw new FalloArtefacto(`${ERROR}: descriptor no válido`);
    }
    throw error;
  }
}
function inventario(raiz: string): { archivos: string[]; directorios: string[] } {
  exigir(lstatSync(raiz).isDirectory() && !lstatSync(raiz).isSymbolicLink());
  const archivos: string[] = [],
    directorios: string[] = [];
  const visitar = (carpeta: string, prefijo: string): void => {
    for (const nombre of readdirSync(carpeta)) {
      const ruta = prefijo ? `${prefijo}/${nombre}` : nombre;
      const estado = lstatSync(join(carpeta, nombre));
      exigir(!estado.isSymbolicLink() && archivos.length + directorios.length <= MAX_ENTRADAS);
      if (estado.isDirectory()) {
        directorios.push(ruta);
        visitar(join(carpeta, nombre), ruta);
      } else {
        exigir(estado.isFile() && estado.nlink === 1);
        archivos.push(ruta);
      }
    }
  };
  visitar(raiz, '');
  return { archivos: archivos.sort(), directorios: directorios.sort() };
}
function mismos(a: readonly string[], b: readonly string[]): void {
  exigir(a.length === b.length && a.every((valor, i) => valor === b[i]));
}
function comprobarManifiestos(raiz: string, d: DescriptorArtefactoCloudflare): void {
  const paquete = `web/paquete/${d.huellaPaquete}/`;
  const bytesPaquete = leer(join(raiz, paquete, 'manifiesto.json'), MAX_ASSET);
  const bytesDispositivo = leer(join(raiz, 'web/firmas/manifiesto.json'), MAX_ASSET);
  exigir(sha(bytesPaquete) === d.sha256ManifiestoPaquete && sha(bytesDispositivo) === d.sha256ManifiestoDispositivo);
  const publicado = paqueteDeManifiesto(paquete, bytesPaquete);
  exigir(publicado.version === d.huellaPaquete);
  const contenido = json(bytesPaquete) as Record<string, { sha256: string }>;
  const archivos = new Map(d.archivos.map((a) => [a.ruta, a]));
  mismos(
    d.archivos.filter((a) => a.ruta.startsWith('web/paquete/')).map((a) => a.ruta),
    publicado.archivos.map((a) => paquete + a).sort(),
  );
  for (const nombre of publicado.archivos.slice(1)) {
    exigir(archivos.get(paquete + nombre)?.sha256 === contenido[nombre]?.sha256);
  }
  const dispositivo = leerManifiesto(bytesDispositivo, d.huellaPaquete).archivos;
  const motorYPaquete = d.archivos.filter((a) => a.ruta.startsWith('web/motor/') || a.ruta.startsWith('web/paquete/'));
  exigir(motorYPaquete.some((a) => a.ruta.startsWith('web/motor/')));
  mismos(
    motorYPaquete.map((a) => a.ruta),
    [...dispositivo.keys()].map((a) => `web/${a}`).sort(),
  );
  for (const archivo of motorYPaquete) {
    exigir(dispositivo.get(archivo.ruta.slice('web/'.length)) === archivo.sha256);
  }
  // El Worker principal y, si va, el de Cursos (lo exporta exportarArtefactoCloudflare): cada uno con su código y sus
  // módulos de datos, que son los del paquete.
  const conCursos = d.archivos.some((a) => a.ruta.startsWith('worker-cursos/'));
  for (const worker of conCursos ? ['worker', 'worker-cursos'] : ['worker']) {
    const datos = d.archivos.filter((a) => a.ruta.startsWith(`${worker}/datos/`));
    exigir(archivos.has(`${worker}/worker.mjs`) && datos.length > 0);
    for (const dato of datos) {
      exigir(archivos.get(paquete + dato.ruta.slice(`${worker}/datos/`.length))?.sha256 === dato.sha256);
    }
  }
  mismos(
    d.archivos.filter((a) => a.ruta.startsWith('web/firmas/')).map((a) => a.ruta),
    ['web/firmas/manifiesto.json'],
  );
}
/** Comprueba identidad externa y bytes trasladados; no reconstruye, firma ni necesita el candidato de origen. */
export function comprobarArtefactoCloudflare(destino: string, sha256Esperado: string): ResumenArtefactoCloudflare {
  const raiz = resolve(destino);
  const estado = lstatSync(raiz);
  exigir(estado.isDirectory() && !estado.isSymbolicLink());
  const d = leerDescriptorArtefactoCloudflare(join(raiz, DESCRIPTOR), sha256Esperado);
  const actual = inventario(raiz);
  mismos(actual.archivos, [DESCRIPTOR, ...d.archivos.map((a) => a.ruta)].sort());
  const directorios = new Set<string>();
  for (const a of d.archivos) {
    const partes = a.ruta.split('/');
    for (let i = 1; i < partes.length; i++) {
      directorios.add(partes.slice(0, i).join('/'));
    }
    const contenido = leer(join(raiz, a.ruta), a.ruta.startsWith('web/') ? MAX_ASSET : MAX_WORKER);
    exigir(contenido.byteLength === a.bytes && sha(contenido) === a.sha256);
  }
  mismos(actual.directorios, [...directorios].sort());
  comprobarManifiestos(raiz, d);
  return {
    version: 1,
    revisionCodigo: d.revisionCodigo,
    huellaPaquete: d.huellaPaquete,
    sha256Artefacto: sha256Esperado,
    archivos: d.archivos.length,
    bytesTotales: d.archivos.reduce((s, a) => s + a.bytes, 0),
  };
}
function destinoNuevo(destino: string): string {
  const final = resolve(destino),
    padre = dirname(final);
  exigir(realpathSync(padre) === padre && lstatSync(padre).isDirectory());
  exigir(!lstatSync(final, { throwIfNoEntry: false }));
  const desde = relative(realpathSync(RUTAS.raiz), final);
  exigir(desde === '..' || desde.startsWith(`..${sep}`) || isAbsolute(desde));
  return final;
}
function promover(temporal: string, destino: string): void {
  mkdirSync(destino, { mode: 0o700 });
  const propia = lstatSync(destino);
  let terminado = false;
  try {
    const ahora = lstatSync(destino);
    exigir(ahora.isDirectory() && !ahora.isSymbolicLink() && ahora.dev === propia.dev && ahora.ino === propia.ino);
    renameSync(temporal, destino);
    terminado = true;
  } finally {
    if (!terminado) {
      const actual = lstatSync(destino, { throwIfNoEntry: false });
      if (actual?.isDirectory() && actual.dev === propia.dev && actual.ino === propia.ino) {
        rmdirSync(destino);
      }
    }
  }
}
function copiarFuentes(fuentes: ReadonlyMap<string, string>, temporal: string): Archivo[] {
  const archivos: Archivo[] = [];
  let total = 0;
  const porWorker = new Map<string, number>();
  for (const [ruta, fuente] of [...fuentes].sort(([a], [b]) => (a < b ? -1 : Number(a > b)))) {
    rutaValida(ruta);
    const bytes = leer(fuente, ruta.startsWith('web/') ? MAX_ASSET : MAX_WORKER);
    total += bytes.byteLength;
    if (!ruta.startsWith('web/')) {
      sumarAlWorker(porWorker, ruta, bytes.byteLength);
    }
    exigir(total <= MAX_TOTAL);
    mkdirSync(dirname(join(temporal, ruta)), { recursive: true });
    writeFileSync(join(temporal, ruta), bytes, { flag: 'wx' });
    archivos.push({ ruta, bytes: bytes.byteLength, sha256: sha(bytes) });
  }
  return archivos;
}
/** La revisión se declara desde el ejecutor confiable; aquí no se acredita Git ni una firma digital. */
export async function exportarArtefactoCloudflare(
  destino: string,
  revisionCodigo: string,
  huellaPaqueteEsperada: string,
  contexto: WebConstruida,
): Promise<ResumenArtefactoCloudflare> {
  const destinoCloudflare = contexto.destinoCloudflare ?? 'privado';
  exigir(HEX40.test(revisionCodigo) && HEX16.test(huellaPaqueteEsperada));
  const final = destinoNuevo(destino);
  const { web, paquete } = contexto;
  exigir(realpathSync(paquete) === realpathSync(RUTAS.paquete));
  const { comprobarArtefactos } = await import('../web/comprobar-artefactos.ts');
  const version = comprobarArtefactos(web, paquete, contexto.motor);
  exigir(version === huellaPaqueteEsperada);
  const { CARPETA_CURSOS, conConstruccionCloudflare } = await import('./comprobar-construccion.ts');
  return conConstruccionCloudflare(
    async (construccion, resultado, rutasAssets) => {
      const temporal = mkdtempSync(join(dirname(final), '.artefacto-'));
      try {
        const fuentes = fuentesDeLosWorkers(construccion, resultado, CARPETA_CURSOS);
        for (const ruta of rutasAssets) {
          fuentes.set(`web/${ruta}`, join(web, ruta));
        }
        exigir(fuentes.size <= MAX_ARCHIVOS && rutasAssets.length <= MAX_ASSETS);
        const archivos = copiarFuentes(fuentes, temporal);
        const d: DescriptorArtefactoCloudflare = {
          version: 1,
          destino: destinoCloudflare,
          revisionCodigo,
          huellaPaquete: version,
          sha256ManifiestoPaquete: sha(leer(join(paquete, 'manifiesto.json'), MAX_ASSET)),
          sha256ManifiestoDispositivo: sha(leer(join(web, 'firmas/manifiesto.json'), MAX_ASSET)),
          archivos,
        };
        const contenido = Buffer.from(`${JSON.stringify(d, null, 2)}\n`);
        exigir(contenido.byteLength <= MAX_DESCRIPTOR);
        writeFileSync(join(temporal, DESCRIPTOR), contenido, { flag: 'wx' });
        const resumen = comprobarArtefactoCloudflare(temporal, sha(contenido));
        promover(temporal, final);
        return resumen;
      } finally {
        rmSync(temporal, { recursive: true, force: true });
      }
    },
    contexto,
    destinoCloudflare,
  );
}
/** El código y los módulos de datos de los dos Workers: el principal en worker/ y el de Cursos en worker-cursos/. */
function fuentesDeLosWorkers(
  construccion: string,
  resultado: ConstruccionCloudflare,
  carpetaCursos: string,
): Map<string, string> {
  const fuentes = new Map<string, string>([['worker/worker.mjs', join(construccion, 'worker.mjs')]]);
  for (const dato of resultado.datos) {
    fuentes.set(`worker/${dato.ruta}`, join(construccion, dato.ruta));
  }
  fuentes.set('worker-cursos/worker.mjs', join(construccion, carpetaCursos, 'worker.mjs'));
  for (const dato of resultado.cursos.datos) {
    fuentes.set(`worker-cursos/${dato.ruta}`, join(construccion, carpetaCursos, dato.ruta));
  }
  return fuentes;
}
function exigirArgumentos(condicion: unknown): asserts condicion {
  if (!condicion) {
    throw new FalloArtefacto(`${ERROR}: argumentos no válidos para la orden`);
  }
}
async function principal(): Promise<void> {
  const { positionals, values } = orden(
    'node herramientas/cloudflare/artefacto.ts exportar|comprobar|descriptor <carpeta o descriptor> [--destino privado|oficial] [opciones]\nLa carpeta o descriptor es posicional; --destino indica la variante al exportar.',
  ).leer({
    allowPositionals: true,
    options: {
      'revision-codigo': { type: 'string' },
      'huella-paquete': { type: 'string' },
      sha256: { type: 'string' },
      destino: { type: 'string' },
    },
  });
  const [accion, destino] = positionals;
  exigirArgumentos(positionals.length === 2 && destino);
  let resultado: ResumenArtefactoCloudflare | DescriptorArtefactoCloudflare;
  if (accion === 'exportar') {
    exigirArgumentos(values['revision-codigo'] && values['huella-paquete'] && !values.sha256);
    exigirArgumentos(values.destino === undefined || values.destino === 'privado' || values.destino === 'oficial');
    exigirArgumentos(HEX40.test(values['revision-codigo']) && HEX16.test(values['huella-paquete']));
    const final = destinoNuevo(destino);
    const { construirWeb } = await import('../web/construir.ts');
    resultado = await construirWeb(values['revision-codigo'], final, {
      huellaPaquete: values['huella-paquete'],
      soloNuevo: true,
      destinoCloudflare: values.destino ?? 'privado',
    });
  } else {
    exigirArgumentos(
      (accion === 'comprobar' || accion === 'descriptor') &&
        values.sha256 &&
        HEX64.test(values.sha256) &&
        !values['revision-codigo'] &&
        !values['huella-paquete'] &&
        !values.destino,
    );
    resultado =
      accion === 'descriptor'
        ? leerDescriptorArtefactoCloudflare(destino, values.sha256)
        : comprobarArtefactoCloudflare(destino, values.sha256);
  }
  const salida = JSON.stringify(resultado);
  exigir(Buffer.byteLength(`${salida}\n`) <= MAX_DESCRIPTOR);
  console.log(salida);
}
if (import.meta.main) {
  void principal().catch((error: unknown) => {
    const codigo = (error as NodeJS.ErrnoException | null)?.code;
    let mensaje = ERROR;
    if (error instanceof FalloArtefacto) {
      mensaje = error.message;
    } else if (['ENOENT', 'EACCES', 'EPERM', 'EISDIR', 'ENOTDIR', 'EIO', 'EROFS', 'ENOSPC'].includes(codigo ?? '')) {
      mensaje = `${ERROR}: archivo ausente o acceso al almacenamiento fallido`;
    }
    console.error(mensaje);
    process.exitCode = 1;
  });
}
