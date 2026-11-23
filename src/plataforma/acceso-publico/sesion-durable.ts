/**
 * Despacho privado del enlace del entorno (binding). La identidad Access y el origen se verifican antes, en la
 * frontera HTTP.
 */
import type { AlmacenAdministradores } from '../../administracion/administradores.ts';
import { esRevisionControles, leerPoliticaControles, type PoliticaControles } from '../../administracion/controles.ts';
import { type AlmacenPreparacionPanel, leerAccesoSesionPanel } from '../../administracion/sesion.ts';
import {
  type AlmacenSesionUnica,
  leerIdentidadPanel,
  RUTA_REGISTRO_PANEL_DURABLE,
} from '../../administracion/sesion-unica.ts';
import { operarAdministradoresDurable } from './administradores-despacho-durable.ts';

function objeto(valor: unknown, claves: string): valor is Record<string, unknown> {
  return (
    valor !== null &&
    typeof valor === 'object' &&
    !Array.isArray(valor) &&
    Object.keys(valor).sort().join(',') === claves
  );
}
/** Solo captura errores del contrato, nunca errores de ejecución del almacén. */
function entradaValida(cuerpo: unknown, cambio: boolean) {
  try {
    if (cambio) {
      if (!objeto(cuerpo, 'acceso,politica,revisionEsperada') || !esRevisionControles(cuerpo.revisionEsperada)) {
        return undefined;
      }
      return {
        acceso: leerAccesoSesionPanel(cuerpo.acceso),
        revisionEsperada: cuerpo.revisionEsperada,
        politica: leerPoliticaControles(cuerpo.politica),
      };
    }
    return objeto(cuerpo, 'acceso') ? { acceso: leerAccesoSesionPanel(cuerpo.acceso) } : undefined;
  } catch {
    return undefined;
  }
}
/** Sesión única: la identidad llega ya verificada por Access en la frontera HTTP. */
function operarSesionUnica(almacen: AlmacenSesionUnica, ruta: string, cuerpo: unknown): Promise<unknown> | undefined {
  try {
    if (ruta === '/panel/bienvenida' && objeto(cuerpo, 'identidad')) {
      return almacen.recibirEnPanel(leerIdentidadPanel(cuerpo.identidad));
    }
    if (
      ruta === '/panel/abrir-unica' &&
      objeto(cuerpo, 'acceso,identidad,retomar') &&
      typeof cuerpo.retomar === 'boolean'
    ) {
      const acceso = leerAccesoSesionPanel(cuerpo.acceso);
      return almacen.abrirSesionUnica(acceso, leerIdentidadPanel(cuerpo.identidad), cuerpo.retomar);
    }
    if (ruta === RUTA_REGISTRO_PANEL_DURABLE && objeto(cuerpo, '')) {
      return almacen.leerRegistroPanel();
    }
  } catch {
    return undefined;
  }
  return undefined;
}
/** undefined indica ruta o entrada inválida; el adaptador aplica la respuesta HTTP uniforme. */
export async function operarSesionDurable(
  almacen: AlmacenPreparacionPanel & AlmacenSesionUnica & AlmacenAdministradores,
  ruta: string,
  cuerpo: unknown,
): Promise<unknown> {
  const unica = operarSesionUnica(almacen, ruta, cuerpo) ?? operarAdministradoresDurable(almacen, ruta, cuerpo);
  if (unica) {
    return unica;
  }
  if (ruta === '/panel/preparar' && objeto(cuerpo, 'politica')) {
    let politica: PoliticaControles;
    try {
      politica = leerPoliticaControles(cuerpo.politica);
    } catch {
      return undefined;
    }
    return { controles: await almacen.prepararPanel(politica) };
  }
  if (ruta === '/panel/activar' && objeto(cuerpo, '')) {
    await almacen.activarSesionPanel();
    return { correcto: true };
  }
  const entrada = entradaValida(cuerpo, ruta === '/panel/cambiar');
  if (!entrada) {
    return undefined;
  }
  if ('politica' in entrada && entrada.politica && entrada.revisionEsperada !== undefined) {
    return almacen.cambiarControlesDeSesion(entrada.acceso, entrada.revisionEsperada, entrada.politica);
  }
  switch (ruta) {
    case '/panel/estado':
      return almacen.comprobarSesion(entrada.acceso);
    case '/panel/actividad':
      return almacen.mantenerSesion(entrada.acceso);
    case '/panel/cerrar':
      return almacen.cerrarSesion(entrada.acceso);
    case '/panel/leer':
      return almacen.leerControlesDeSesion(entrada.acceso);
    default:
      return undefined;
  }
}
