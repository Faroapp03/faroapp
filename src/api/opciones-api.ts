/** Contrato cerrado de composición: ninguna opción ajena se ignora silenciosamente. No inspecciona datos del paquete. */
import type { OpcionesApi } from './api.ts';

function cerrado(entrada: unknown, claves: readonly string[]): Record<string, unknown> {
  if (
    !entrada ||
    typeof entrada !== 'object' ||
    Array.isArray(entrada) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(entrada)) ||
    Object.getOwnPropertySymbols(entrada).length
  ) {
    throw new TypeError('Opciones de API no válidas');
  }
  for (const nombre of Object.getOwnPropertyNames(entrada)) {
    const d = Object.getOwnPropertyDescriptor(entrada, nombre);
    if (!claves.includes(nombre) || !d || !('value' in d) || !d.enumerable) {
      throw new TypeError('Opciones de API no válidas');
    }
  }
  return entrada as Record<string, unknown>;
}
export function exigirOpcionesApi(entrada: OpcionesApi): void {
  const o = cerrado(entrada, [
    'datos',
    'datosGlobales',
    'origenesPermitidos',
    'politicaReferencias',
    'oferta',
    'plazoMs',
    'seguridad',
    'caminoAMano',
    'agentes',
    'administracion',
    'motorDeCursos',
  ]);
  if (o.seguridad !== undefined) {
    const s = cerrado(o.seguridad, ['limitadores', 'secretoFirma', 'secretoFirmaAnterior', 'ipDeCloudflare']);
    if (s.limitadores !== undefined) {
      cerrado(s.limitadores, ['lecturas']);
    }
  }
  if (o.agentes !== undefined) {
    exigirAgentes(o.agentes);
  }
  if (o.administracion !== undefined) {
    cerrado(o.administracion, ['leerControles', 'registrarAcceso', 'socios']);
  }
}

function exigirAgentes(entrada: unknown): void {
  if (entrada !== undefined) {
    const a = cerrado(entrada, ['mcp', 'a2a', 'clavesFirmaMcp', 'socios']);
    for (const canal of ['mcp', 'a2a']) {
      if (typeof a[canal] === 'object' && a[canal] !== null) {
        cerrado(a[canal], ['limitador', 'hoy', 'firmador']);
      }
    }
    if (a.socios !== undefined && a.socios !== null) {
      cerrado(a.socios, ['instituciones', 'accesos', 'almacen', 'ahora', 'hoy']);
    }
  }
}
