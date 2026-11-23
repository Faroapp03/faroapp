// Grafo y huellas SRI de las entradas del motor que cargan las páginas por su dirección fija.
import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { parse } from 'acorn';
import type { ContextoWeb } from './contexto.ts';

/**
 * La huella SRI de un archivo: sha384 en base64, la que se escribe en integrity.
 *
 * @param contenido - Los bytes o el texto del archivo.
 * @returns La huella en la forma `sha384-<base64>`.
 */
export function huellaSri(contenido: Uint8Array | string): string {
  return `sha384-${createHash('sha384').update(contenido).digest('base64')}`;
}

/**
 * Los módulos del motor que importan las páginas por su dirección fija: la limpieza de datos personales en el
 * dispositivo (web/scripts/recorrido/minimizar.js), el calendario y la forma de los cursos y la carga de la formación.
 * Van en el mapa de la página que los importa con todo lo que importan, para que sigan cargando si la página pasa de
 * solo informar a aplicar la Integrity-Policy.
 */
export const MOTOR_EN_LAS_PAGINAS: readonly string[] = [
  ...['privacidad.js', 'avisos.js', 'limites.js'].map((modulo) => `motor/src/seguridad/${modulo}`),
  'motor/src/catalogo-cursos/calendarios.js',
  'motor/src/catalogo-cursos/forma.js',
  'motor/src/seleccion-formacion/carga.js',
];

/**
 * La huella de cada módulo del motor que cargan unas entradas (por omisión, MOTOR_EN_LAS_PAGINAS) y lo que importan.
 * Lee los bytes del motor de referencia del contexto (el motor empaquetado de la construcción). Nunca compila el motor.
 *
 * @param contexto - Candidata y bytes finales del motor.
 * @param entradas - Los módulos del motor de los que se parte, por su ruta desde la web.
 * @returns La huella SRI de cada módulo del motor, por su ruta desde la web.
 * @throws {Error} Si falta un módulo que el grafo necesita.
 */
export function huellasDelMotorEnLasPaginas(
  contexto: ContextoWeb,
  entradas: readonly string[] = MOTOR_EN_LAS_PAGINAS,
): Record<string, string> {
  return huellasDelGrafoDelMotor(entradas, (archivo) => {
    const bytes = contexto.motor.get(archivo);
    if (!bytes) {
      throw new Error(`Falta el módulo del motor de referencia: ${archivo}`);
    }
    return bytes;
  });
}

/** Recorre las dependencias relativas desde las entradas, sobre una única captura del motor. */
function huellasDelGrafoDelMotor(
  entradas: readonly string[],
  leerModulo: (archivo: string) => Uint8Array,
): Record<string, string> {
  const huellas: Record<string, string> = {};
  const pendientes = [...entradas];
  for (let archivo = pendientes.pop(); archivo; archivo = pendientes.pop()) {
    if (archivo in huellas) {
      continue;
    }
    const contenido = leerModulo(archivo);
    huellas[archivo] = huellaSri(contenido);
    for (const importado of importacionesEstaticas(new TextDecoder().decode(contenido))) {
      pendientes.push(posix.join(posix.dirname(archivo), importado));
    }
  }
  return huellas;
}

/** Dependencias estáticas relativas de módulos JS; las cadenas, comentarios e importaciones dinámicas no cuentan. */
function importacionesEstaticas(codigo: string): string[] {
  const programa = parse(codigo, { ecmaVersion: 'latest', sourceType: 'module' });
  return programa.body.flatMap((nodo) => {
    if (
      nodo.type !== 'ImportDeclaration' &&
      nodo.type !== 'ExportNamedDeclaration' &&
      nodo.type !== 'ExportAllDeclaration'
    ) {
      return [];
    }
    const fuente = nodo.source?.value;
    return typeof fuente === 'string' && (fuente.startsWith('./') || fuente.startsWith('../')) && fuente.endsWith('.js')
      ? [fuente]
      : [];
  });
}
