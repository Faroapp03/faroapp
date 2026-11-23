/** Evaluación y lectura del vigilante bajo la autoridad de sesión compartida. */

import type { EstadoAvisoVigilante } from '../../administracion/aviso-vigilante.ts';
import type { ConfiguracionProgramada } from '../../administracion/configuracion-programada.ts';
import type { ConfiguracionVigilante } from '../../administracion/configuracion-vigilante.ts';
import type { ResultadoEnvioAviso } from '../../administracion/envio-aviso.ts';
import type { EnvioPorCanal } from '../../administracion/envio-por-canal.ts';
import type { AccesoSesionPanel } from '../../administracion/sesion.ts';
import {
  type EntradaAvisoVigilante,
  leerAvisoPorCanalSqlite,
  leerAvisoVigilanteSqlite,
  prepararAvisoVigilanteSqlite,
  registrarEnvioAvisoSqlite,
} from './aviso-vigilante-sqlite.ts';
import { AlmacenSesionPanelSqlite } from './sesion-sqlite.ts';
import {
  comprobarObservacionVigilanteEnTransaccion,
  exigirVigilantePreparadoEnTransaccion,
  leerHistorialVigilanteEnTransaccion,
  type ObservacionVigilante,
  prepararVigilanteEnTransaccion,
} from './vigilante-sqlite.ts';

export class AlmacenSesionVigilanteSqlite extends AlmacenSesionPanelSqlite {
  async prepararVigilanteDeSesion(acceso: AccesoSesionPanel, configuracion: ConfiguracionVigilante) {
    return this.conSesion(acceso, (sesion, ahora) => {
      prepararVigilanteEnTransaccion(this.sql, configuracion, ahora);
      return { estado: 'activa' as const, sesion, preparado: true as const };
    });
  }
  async exigirVigilanteDeSesion(acceso: AccesoSesionPanel, configuracion: ConfiguracionVigilante) {
    return this.conSesion(acceso, (sesion, ahora) => {
      exigirVigilantePreparadoEnTransaccion(this.sql, configuracion, ahora);
      return sesion;
    });
  }
  async comprobarVigilanteDeSesion(
    acceso: AccesoSesionPanel,
    configuracion: ConfiguracionVigilante,
    programada: ConfiguracionProgramada | undefined,
    observacion: ObservacionVigilante,
  ) {
    return this.conSesion(acceso, (sesion, ahora) => ({
      estado: 'activa' as const,
      sesion,
      vigilante: comprobarObservacionVigilanteEnTransaccion(
        this.sql,
        configuracion,
        { programada, observacion },
        ahora,
      ),
    }));
  }
  /** Evaluación del evento programado: sin sesión humana, con la misma transacción y el reloj de la autoridad. */
  async prepararAvisoVigilante(entrada: EntradaAvisoVigilante, panel: string) {
    return this.conTrabajos((ahora) => prepararAvisoVigilanteSqlite(this.sql, entrada, { ahora, panel }));
  }
  async registrarEnvioAviso(
    entrada: Readonly<{
      envio: ResultadoEnvioAviso;
      siguiente: EstadoAvisoVigilante;
      canales?: readonly EnvioPorCanal[];
    }>,
  ) {
    return this.conTrabajos((ahora) => registrarEnvioAvisoSqlite(this.sql, entrada, ahora));
  }
  async leerAvisoVigilante() {
    return this.conTrabajos(() => leerAvisoVigilanteSqlite(this.sql));
  }
  /** Lo ya avisado y el último intento de cada canal, para el estado que ve el panel. */
  async leerAvisoPorCanal() {
    return this.conTrabajos(() => leerAvisoPorCanalSqlite(this.sql));
  }
  async historialVigilanteDeSesion(
    acceso: AccesoSesionPanel,
    configuracion: ConfiguracionVigilante,
    opciones: { despuesDe?: number; limite?: number; revisionEsperada?: number },
  ) {
    return this.conSesion(acceso, (sesion, ahora) => {
      exigirVigilantePreparadoEnTransaccion(this.sql, configuracion, ahora);
      return {
        estado: 'activa' as const,
        sesion,
        historial: leerHistorialVigilanteEnTransaccion(this.sql, ahora, opciones),
      };
    });
  }
}
