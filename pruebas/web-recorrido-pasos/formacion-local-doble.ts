/** Solo sustituye el transporte Worker; ejecuta ruta y selector reales, sin red. */
import type { FuenteSeleccion } from '../../src/plataforma/navegador/ruta-formacion.ts';
import { responderFormacionLocal } from '../../src/plataforma/navegador/ruta-formacion.ts';
import { AHORA_FORMACION } from '../fixtures/seleccion-formacion.ts';
export const peticionesFormacion: { url: string; cuerpo: string }[] = [];
let fuente: FuenteSeleccion | null = null;
let reloj = AHORA_FORMACION;
export function prepararFormacionLocal(nueva: FuenteSeleccion, ahora = AHORA_FORMACION): void {
  fuente = nueva;
  reloj = ahora;
  peticionesFormacion.length = 0;
}
export function moverRelojFormacion(ahora: number): void {
  reloj = ahora;
}
export async function pedirAlMotorLocal(url: string, opciones: RequestInit): Promise<Response> {
  if (!fuente || typeof opciones.body !== 'string' || new URL(url).pathname !== '/local/formacion/seleccionar') {
    throw new Error('La prueba no ha preparado una petición virtual de formación válida');
  }
  opciones.signal?.throwIfAborted();
  peticionesFormacion.push({ url, cuerpo: opciones.body });
  const respuesta = await responderFormacionLocal(
    { url, method: opciones.method ?? 'GET', headers: [...new Headers(opciones.headers)], body: opciones.body },
    fuente,
    reloj,
  );
  opciones.signal?.throwIfAborted();
  return respuesta;
}
