/** Preparación por capacidad: un registro averiado no bloquea controles, sesión ni datos del panel. */
import type { AlmacenAccesos } from '../../administracion/accesos.ts';
import type { AlmacenInstituciones } from '../../administracion/instituciones.ts';

function preparacionCompartida(preparar: () => Promise<void>): () => Promise<void> {
  let actual: Promise<void> | undefined;
  return () => {
    if (!actual) {
      const candidata = Promise.resolve().then(preparar);
      actual = candidata;
      const retirarPendiente = () => {
        if (actual === candidata) {
          actual = undefined;
        }
      };
      // Comparte solo la preparación en curso. Cada llamada posterior vuelve a verificar el estado persistido.
      void candidata.then(retirarPendiente, retirarPendiente);
    }
    return actual;
  };
}
/** Se prepara antes de operar, no como respaldo tras una lectura fallida. Estados parciales siguen fallando. */
export function institucionesDiferidas(almacen: AlmacenInstituciones): AlmacenInstituciones {
  const preparar = preparacionCompartida(() => almacen.prepararInstituciones());
  return {
    prepararInstituciones: preparar,
    leerInstitucionesDeSesion: async (acceso) => {
      await preparar();
      return almacen.leerInstitucionesDeSesion(acceso);
    },
    invitarInstitucionDeSesion: async (acceso, solicitud, nueva) => {
      await preparar();
      return almacen.invitarInstitucionDeSesion(acceso, solicitud, nueva);
    },
    renovarInvitacionDeSesion: async (acceso, solicitud, nueva) => {
      await preparar();
      return almacen.renovarInvitacionDeSesion(acceso, solicitud, nueva);
    },
    retirarInstitucionDeSesion: async (acceso, solicitud) => {
      await preparar();
      return almacen.retirarInstitucionDeSesion(acceso, solicitud);
    },
    retirarClaveDeSesion: async (acceso, solicitud) => {
      await preparar();
      return almacen.retirarClaveDeSesion(acceso, solicitud);
    },
    consultarInvitacion: async (recibida) => {
      await preparar();
      return almacen.consultarInvitacion(recibida);
    },
    activarInvitacion: async (recibida, clave) => {
      await preparar();
      return almacen.activarInvitacion(recibida, clave);
    },
    buscarInstitucion: async (id) => {
      await preparar();
      return almacen.buscarInstitucion(id);
    },
  };
}
export function accesosDiferidos(almacen: AlmacenAccesos, prepararInstituciones: () => Promise<void>): AlmacenAccesos {
  const preparar = preparacionCompartida(async () => {
    await prepararInstituciones();
    await almacen.prepararAccesos();
  });
  return {
    prepararAccesos: preparar,
    registrarAcceso: async (uso) => {
      await preparar();
      return almacen.registrarAcceso(uso);
    },
    depurarAccesos: async () => {
      await preparar();
      return almacen.depurarAccesos();
    },
    leerAccesosDeSesion: async (acceso, pagina) => {
      await preparar();
      return almacen.leerAccesosDeSesion(acceso, pagina);
    },
  };
}
