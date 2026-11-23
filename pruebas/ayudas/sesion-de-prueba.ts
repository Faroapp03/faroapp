/**
 * Prepara una sesión del Panel de Control para las pruebas por la única vía que existe: la apertura de la sesión
 * única. La persona sale de la huella principal del acceso, con un correo sintético y una sola entrada de Access.
 * Pide retomar, así que la misma persona sustituye su sesión anterior como al recargar en otro dispositivo; si el
 * panel lo tiene otra persona, la prueba falla con un mensaje claro en vez de recibir un estado inventado.
 */
import { createHash } from 'node:crypto';
import type { AccesoSesionPanel, SesionPanelActiva } from '../../src/administracion/sesion.ts';
import type { AlmacenSesionUnica, IdentidadPanel } from '../../src/administracion/sesion-unica.ts';

export const CORREO_DE_PRUEBA = 'panel@faro.invalid';

export function identidadDePrueba(acceso: AccesoSesionPanel): IdentidadPanel {
  return {
    huellaPrincipal: acceso.huellaPrincipal,
    correo: CORREO_DE_PRUEBA,
    huellaEntrada: createHash('sha256').update(`entrada:${acceso.huellaPrincipal}`).digest('hex'),
  };
}

export async function abrirSesionDePrueba(
  almacen: Pick<AlmacenSesionUnica, 'abrirSesionUnica'>,
  acceso: AccesoSesionPanel,
): Promise<SesionPanelActiva> {
  const resultado = await almacen.abrirSesionUnica(acceso, identidadDePrueba(acceso), true);
  if (resultado.estado !== 'abierta') {
    throw new Error('El panel lo tiene abierto otra persona: la prueba debe cerrar esa sesión antes de abrir otra');
  }
  return resultado.sesion;
}
