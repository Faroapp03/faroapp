/** Adaptador local de entradas admitidas: no consulta enlaces ni modifica el catálogo. */
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import {
  type IntegridadLocal,
  type ObjetivoLectura,
  proyectarObservaciones,
} from '../../../src/biblioteca/observaciones-lecturas.ts';
import { comprobarReferencias } from './referencias.ts';
import { comoRegistro } from './registro.ts';

const MAX_JSON = 8_388_608;
function bytes(ruta: string): Buffer {
  const estado = lstatSync(ruta);
  if (!estado.isFile() || estado.isSymbolicLink() || estado.size > MAX_JSON) {
    throw new Error('La entrega de Biblioteca debe ser un archivo regular acotado');
  }
  const contenido = readFileSync(ruta);
  if (contenido.length > MAX_JSON) {
    throw new Error('Entrega de Biblioteca demasiado grande');
  }
  return contenido;
}
function huella(contenido: Buffer): string {
  return createHash('sha256').update(contenido).digest('hex');
}
function observaciones(ruta: string): unknown {
  try {
    return JSON.parse(bytes(ruta).toString('utf8'));
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}
/** SHA del archivo local que formará parte del mismo artefacto; no prueba accesibilidad remota. */
function integridad(objetivo: ObjetivoLectura, raiz: string): IntegridadLocal | null {
  if (objetivo.url === null || objetivo.url.startsWith('https://')) {
    return null;
  }
  const ruta = resolve(raiz, objetivo.url.split('#')[0] ?? '');
  const dentro = relative(raiz, ruta);
  if (!dentro || dentro === '..' || dentro.startsWith(`..${sep}`) || dentro.startsWith(sep)) {
    throw new Error('Enlace local fuera del artefacto');
  }
  try {
    if (realpathSync(ruta) !== ruta) {
      throw new Error('Enlace local mediante enlace simbólico');
    }
    return { objetivo: objetivo.objetivo, url: objetivo.url, sha256: huella(bytes(ruta)) };
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}
function locales(objetivos: readonly ObjetivoLectura[], raizWeb: string): IntegridadLocal[] {
  const raiz = realpathSync(raizWeb);
  return objetivos.flatMap((objetivo) => {
    const prueba = integridad(objetivo, raiz);
    return prueba ? [prueba] : [];
  });
}
/** El reloj y todas las rutas son explícitos. Ausencia de observaciones ≠ catálogo vacío.
 * Se llama tras admitir el paquete; el SHA vincula los objetivos al catálogo exacto,
 * no sustituye las firmas/admisión del paquete común ni autentica JSON arbitrario.
 */
export function cargarProyeccionLecturas(entrada: {
  readonly catalogo: string;
  readonly observaciones: string;
  readonly raizWeb: string;
  readonly ahora: string;
}) {
  const contenido = bytes(entrada.catalogo);
  const registro = comoRegistro(JSON.parse(contenido.toString('utf8')));
  comprobarReferencias(registro);
  const objetivos: ObjetivoLectura[] = registro.lecturas.flatMap((lectura) => {
    const filas = [{ objetivo: `${lectura.id}:enlace`, id: lectura.id, campo: 'enlace', url: lectura.enlace }];
    if (lectura.enlace_ca !== undefined && lectura.enlace_ca !== null) {
      filas.push({ objetivo: `${lectura.id}:enlace_ca`, id: lectura.id, campo: 'enlace_ca', url: lectura.enlace_ca });
    }
    return filas;
  });
  return proyectarObservaciones({
    catalogoSha256: huella(contenido),
    objetivos,
    observaciones: observaciones(entrada.observaciones),
    ahora: entrada.ahora,
    integridadLocal: locales(objetivos, entrada.raizWeb),
  });
}
