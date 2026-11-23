/** Protocolo privado de secciones: misma autoridad, sesión y revisión que los controles. */
import { esRevisionControles } from '../../administracion/controles.ts';
import type { AlmacenSeccionesPanel } from '../../administracion/secciones-almacen.ts';
import { leerPoliticaSecciones } from '../../administracion/secciones-web.js';
import { leerAccesoSesionPanel } from '../../administracion/sesion.ts';

export function esRutaSeccionesDurable(ruta: string): boolean {
  return (
    ruta === '/secciones/autoridad' ||
    ruta === '/secciones/leer' ||
    ruta === '/secciones/leer-sesion' ||
    ruta === '/secciones/cambiar-sesion'
  );
}
function objeto(entrada: unknown, claves: string): entrada is Record<string, unknown> {
  return (
    entrada !== null &&
    typeof entrada === 'object' &&
    !Array.isArray(entrada) &&
    Object.keys(entrada).sort().join(',') === claves
  );
}
function entradaDe(ruta: string, cuerpo: unknown) {
  try {
    if (ruta === '/secciones/leer' && objeto(cuerpo, '')) {
      return { tipo: 'leer' } as const;
    }
    if (ruta === '/secciones/leer-sesion' && objeto(cuerpo, 'acceso')) {
      return { tipo: 'sesion', acceso: leerAccesoSesionPanel(cuerpo.acceso) } as const;
    }
    if (
      ruta === '/secciones/cambiar-sesion' &&
      objeto(cuerpo, 'acceso,revisionEsperada,secciones') &&
      esRevisionControles(cuerpo.revisionEsperada)
    ) {
      return {
        tipo: 'cambiar',
        acceso: leerAccesoSesionPanel(cuerpo.acceso),
        revision: cuerpo.revisionEsperada,
        secciones: leerPoliticaSecciones(cuerpo.secciones),
      } as const;
    }
  } catch {
    return undefined;
  }
  return undefined;
}
export async function operarSeccionesDurable(
  almacen: AlmacenSeccionesPanel & { leerSeccionesConAutoridad?: (permitirInicial: boolean) => Promise<unknown> },
  ruta: string,
  cuerpo: unknown,
): Promise<unknown> {
  if (
    ruta === '/secciones/autoridad' &&
    objeto(cuerpo, 'permitirInicial') &&
    typeof cuerpo.permitirInicial === 'boolean' &&
    almacen.leerSeccionesConAutoridad
  ) {
    return { secciones: await almacen.leerSeccionesConAutoridad(cuerpo.permitirInicial) };
  }
  const entrada = entradaDe(ruta, cuerpo);
  if (!entrada) {
    return undefined;
  }
  if (entrada.tipo === 'leer') {
    return { secciones: await almacen.leerSecciones() };
  }
  if (entrada.tipo === 'sesion') {
    return almacen.leerSeccionesDeSesion(entrada.acceso);
  }
  return almacen.cambiarSeccionesDeSesion(entrada.acceso, entrada.revision, entrada.secciones);
}
