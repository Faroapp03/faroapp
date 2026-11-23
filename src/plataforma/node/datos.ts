// Lectura del paquete de datos en Node desde la carpeta indicada, con comprobación SHA-256 de cada archivo.
// Conserva los datos exportados sin compactación; las partes opcionales se leen solo cuando su archivo existe.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cumple, type EsquemaDe } from '../../comun/esquema.ts';
import { esObjeto } from '../../comun/json.ts';
import { catalanConErratas, escoConErratas } from '../../dominio/erratas-esco.ts';
import { comprobarTich } from '../../dominio/forma-del-dato-tich.ts';
import type { Datos } from '../../dominio/tipos-paquete.ts';
import { ARCHIVO_DE_CADA_PARTE, esDeCursos, esObligatoria, MANIFIESTO, PARTES } from '../archivos-del-paquete.ts';
import { anotarDatosDeCursosAveriados } from '../motor-de-cursos.ts';

// Rechaza bytes malformados sin sustituirlos; conserva el BOM para que JSON.parse mantenga su diagnóstico.
const UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/** Lo que el manifiesto guarda de cada archivo: al menos su SHA-256 en hexadecimal. */
const ENTRADA_DEL_MANIFIESTO: EsquemaDe<{ sha256: string }> = {
  type: 'object',
  required: ['sha256'],
  properties: { sha256: { type: 'string', pattern: '^[0-9a-f]{64}$' } },
};
/** Lo que tiene que hacer quien ve el error: volver a exportar el paquete. */
const COMO_ARREGLARLO = 'vuelve a exportar el paquete (npm run datos:exportar)';

/** La huella SHA-256 que el manifiesto guarda para `archivo`; falla con un mensaje claro si no la tiene. */
function huellaEsperada(manifiesto: unknown, archivo: string): string {
  const entrada = esObjeto(manifiesto) && Object.hasOwn(manifiesto, archivo) ? manifiesto[archivo] : undefined;
  if (!cumple(entrada, ENTRADA_DEL_MANIFIESTO)) {
    throw new Error(`El manifiesto del paquete no trae la huella de ${archivo}: ${COMO_ARREGLARLO}`);
  }
  return entrada.sha256;
}

/**
 * Lee un archivo del paquete, comprueba su huella y lo devuelve analizado; lo que llega de fuera entra como unknown.
 */
function leerComprobado(carpeta: string, manifiesto: unknown, archivo: string): unknown {
  const contenido = readFileSync(join(carpeta, archivo));
  const calculada = createHash('sha256').update(contenido).digest('hex');
  if (calculada !== huellaEsperada(manifiesto, archivo)) {
    throw new Error(`${archivo} no coincide con su huella en ${MANIFIESTO}: ${COMO_ARREGLARLO}`);
  }
  return JSON.parse(UTF8.decode(contenido));
}

/**
 * Lee un archivo que solo es de cursos (esDeCursos) con las mismas comprobaciones, pero sin tumbar el núcleo: si falta y
 * el manifiesto lo nombra, o falla su lectura, apunta el fallo y da undefined. Si ni está ni lo nombra el manifiesto,
 * el paquete no lo trae, como cualquier parte opcional.
 */
function leerDeCursos(carpeta: string, manifiesto: unknown, archivo: string, fallos: string[]): unknown {
  if (!existsSync(join(carpeta, archivo))) {
    if (esObjeto(manifiesto) && Object.hasOwn(manifiesto, archivo)) {
      fallos.push(`falta ${archivo}, que nombra ${MANIFIESTO}`);
    }
    return undefined;
  }
  try {
    return leerComprobado(carpeta, manifiesto, archivo);
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : String(error);
    fallos.push(mensaje.includes(archivo) ? mensaje : `${archivo}: ${mensaje}`);
    return undefined;
  }
}

/**
 * Lee el paquete de datos de `carpeta`, cada parte de su archivo (plataforma/archivos-del-paquete.ts) y comprobada
 * contra el manifiesto. Las partes opcionales (vectores, formación, cursos, datos de Cataluña y del grupo, catalán,
 * acreditación…) solo aparecen si su archivo está: sin ellas, el motor funciona igual. Falla si falta una parte
 * obligatoria, si un archivo no coincide con su huella o si el manifiesto no la tiene. Un archivo que solo es de cursos
 * no tumba la carga: el paquete sale sin él y su puerta da el motor de cursos por averiado (leerDeCursos). Lee los
 * datos tal cual, sin prepararlos para ocupar menos memoria: Node es la referencia de lo que dice el paquete.
 *
 * @param carpeta - La carpeta con los archivos de datos.
 * @returns Los datos cargados.
 */
export function cargarDatos(carpeta: string): Datos {
  const manifiesto: unknown = JSON.parse(UTF8.decode(readFileSync(join(carpeta, MANIFIESTO))));
  const datos: Partial<Record<keyof Datos, unknown>> = {};
  const fallosDeCursos: string[] = [];
  for (const parte of PARTES) {
    const archivo = ARCHIVO_DE_CADA_PARTE[parte];
    if (esDeCursos(parte)) {
      const leida = leerDeCursos(carpeta, manifiesto, archivo, fallosDeCursos);
      if (leida !== undefined) {
        datos[parte] = leida;
      }
    } else if (esObligatoria(parte) || existsSync(join(carpeta, archivo))) {
      datos[parte] = leerComprobado(carpeta, manifiesto, archivo);
    }
  }
  // El manifiesto identifica los archivos que exportó y validó la cadena de actualización.
  // Su forma es la de Datos; la lectura no repite su validación campo a campo.
  const leidos = datos as Datos;
  // La única corrección sobre lo leído: la fe de erratas de las etiquetas de ESCO, la misma que en el Worker y el
  // navegador (archivos-del-paquete.ts), para que todas las plataformas busquen y titulen igual.
  const cargados: Datos = {
    ...leidos,
    esco: escoConErratas(leidos.esco),
    // La forma del dato de la TIC-H, la misma que exigen el Worker y el navegador (archivos-del-paquete.ts).
    ...(leidos.tich ? { tich: comprobarTich(leidos.tich) } : {}),
    ...(leidos.catalan ? { catalan: catalanConErratas(leidos.catalan, leidos.esco) } : {}),
  };
  if (fallosDeCursos.length > 0) {
    const detalle = `no se han podido cargar los datos de cursos: ${fallosDeCursos.join('; ')}`;
    console.warn(`Faro: ${detalle}. El motor de ocupaciones funciona; el de cursos queda averiado.`);
    anotarDatosDeCursosAveriados(cargados, detalle);
  }
  return cargados;
}
