/**
 * Campos cerrados que los canales de agentes anotan en el registro operativo: la consulta reconocida y el rótulo del
 * cliente autodeclarado. No dependen de la administración, así que el motor del dispositivo los usa sin arrastrarla.
 */
import { limpiarDatosPersonales } from '../seguridad/privacidad.ts';
import { HERRAMIENTAS } from './mcp/definiciones.ts';

const CONSULTAS = new Set(HERRAMIENTAS.map((h) => h.name));
const MAX_NOMBRE_CLIENTE = 64;
export type CategoriaCliente = 'declarado' | 'no_declarado' | 'omitido' | 'otros';
export interface ClienteDeclarado {
  readonly clienteDeclarado: string | null;
  readonly categoriaCliente: CategoriaCliente;
}
/** Un nombre autodeclarado no es identidad ni prueba del producto. Solo conserva rótulos técnicos acotados. */
export function sanearClienteDeclarado(entrada: unknown): ClienteDeclarado {
  if (entrada === undefined || entrada === null) {
    return { clienteDeclarado: null, categoriaCliente: 'no_declarado' };
  }
  if (
    typeof entrada !== 'string' ||
    entrada.length === 0 ||
    entrada.length > MAX_NOMBRE_CLIENTE ||
    !entrada.isWellFormed()
  ) {
    return { clienteDeclarado: null, categoriaCliente: 'omitido' };
  }
  const limpio = limpiarDatosPersonales(entrada),
    nombre = limpio.texto.trim();
  // No se guardan direcciones, delimitadores de parámetros, secuencias largas con aspecto de credencial, cifras largas
  // ni caracteres de control.
  if (
    limpio.eliminados > 0 ||
    !/^[\p{L}\p{N} ._()+-]+$/u.test(nombre) ||
    /[\p{C}]/u.test(entrada) ||
    /[A-Za-z0-9_-]{24,}|\d{6,}/u.test(nombre) ||
    nombre.length === 0
  ) {
    return { clienteDeclarado: null, categoriaCliente: 'omitido' };
  }
  return { clienteDeclarado: nombre, categoriaCliente: 'declarado' };
}
export function esConsultaOperativa(entrada: unknown): entrada is string {
  return typeof entrada === 'string' && (CONSULTAS.has(entrada) || entrada === 'no_identificada');
}
