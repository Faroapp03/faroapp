/**
 * La parte del objeto durable del destino de los avisos: su almacén, que comprueba la sesión del panel en la misma
 * transacción que la lectura o el cambio, y su protocolo privado con el Worker. La dirección solo cruza el enlace en
 * «cambiar» (de ida) y en las dos lecturas (de vuelta); cambiar y quitar responden con el resumen.
 */
import {
  type AlmacenAvisosDestino,
  type DestinoAvisos,
  esRevisionDestino,
  type ResultadoCambioDestino,
  type ResultadoLecturaDestino,
} from '../../administracion/avisos-destino.ts';
import { leerDestinoCorreo } from '../../administracion/destino-correo.ts';
import { type AccesoSesionPanel, leerAccesoSesionPanel } from '../../administracion/sesion.ts';
import type { VariablesDelEntorno } from '../../comun/entorno.ts';
import { responderEncuestaDurable } from '../../encuesta/protocolo-durable.ts';
import { leerAvisoPorCanalSqlite } from './aviso-vigilante-sqlite.ts';
import { cambiarDestinoSqlite, leerDestinoSqlite, verificarDestinoSqlite } from './avisos-destino-sqlite.ts';
import { MAX_RESPUESTA } from './durable-limites.ts';
import { estadoAvisosDeLaLectura } from './estado-canales-aviso.ts';
import { responderOperacionPrivada } from './respuesta-durable.ts';
import { AlmacenSesionDemandaSqlite } from './trabajos-demanda-sqlite.ts';

export const RUTAS_AVISOS_DURABLE = {
  destino: '/avisos/destino',
  leer: '/avisos/leer-sesion',
  cambiar: '/avisos/cambiar-sesion',
  quitar: '/avisos/quitar-sesion',
  verificar: '/avisos/verificar-sesion',
} as const;
const RUTAS = new Set<string>(Object.values(RUTAS_AVISOS_DURABLE));
export function esRutaAvisosDurable(ruta: string): boolean {
  return RUTAS.has(ruta);
}

/** El almacén de sesión del objeto durable: la encuesta, la reserva a demanda y, además, el destino de los avisos. */
export class AlmacenSesionAvisosSqlite extends AlmacenSesionDemandaSqlite implements AlmacenAvisosDestino {
  async leerDestinoParaAvisar(): Promise<DestinoAvisos> {
    return this.sql.transaccion(() => leerDestinoSqlite(this.sql));
  }
  async leerDestinoAvisosDeSesion(acceso: AccesoSesionPanel): Promise<ResultadoLecturaDestino> {
    return this.conSesion(acceso, (sesion) => ({ estado: 'activa', sesion, destino: leerDestinoSqlite(this.sql) }));
  }
  /**
   * La lectura de la tarjeta: la dirección y, en la misma transacción, el estado de cada canal con su último intento.
   * Solo lee: no evalúa el vigilante ni anota ninguna decisión.
   */
  async leerDestinoYAvisosDeSesion(
    acceso: AccesoSesionPanel,
    variables: VariablesDelEntorno,
  ): Promise<ResultadoLecturaDestino> {
    return this.conSesion(acceso, (sesion) => {
      const destino = leerDestinoSqlite(this.sql);
      const { registro, porCanal } = leerAvisoPorCanalSqlite(this.sql);
      const avisos = estadoAvisosDeLaLectura({ variables, verificacion: destino.verificacion, registro, porCanal });
      return { estado: 'activa', sesion, destino, avisos };
    });
  }
  async cambiarDestinoAvisosDeSesion(
    acceso: AccesoSesionPanel,
    revisionEsperada: number,
    correo: string,
  ): Promise<ResultadoCambioDestino> {
    return this.conSesion(acceso, (sesion, ahora) => ({
      ...cambiarDestinoSqlite(this.sql, revisionEsperada, correo, ahora),
      sesion,
    }));
  }
  async quitarDestinoAvisosDeSesion(
    acceso: AccesoSesionPanel,
    revisionEsperada: number,
  ): Promise<ResultadoCambioDestino> {
    return this.conSesion(acceso, (sesion, ahora) => ({
      ...cambiarDestinoSqlite(this.sql, revisionEsperada, null, ahora),
      sesion,
    }));
  }
  async verificarDestinoAvisosDeSesion(
    acceso: AccesoSesionPanel,
    revisionEsperada: number,
    correo: string,
  ): Promise<ResultadoCambioDestino> {
    return this.conSesion(acceso, (sesion) => ({
      ...verificarDestinoSqlite(this.sql, revisionEsperada, correo),
      sesion,
    }));
  }
}

function cuerpoCon(entrada: unknown, claves: string): Record<string, unknown> | undefined {
  if (entrada === null || typeof entrada !== 'object' || Array.isArray(entrada)) {
    return undefined;
  }
  return Object.keys(entrada).sort().join(',') === claves ? (entrada as Record<string, unknown>) : undefined;
}
type Accion = (() => Promise<unknown>) | undefined;
/** «Cambiar» y «verificar» llevan la misma forma: la sesión, la revisión vista y la dirección. */
function accionConCorreo(almacen: AlmacenAvisosDestino, ruta: string, entrada: unknown): Accion {
  const esperada = ruta === RUTAS_AVISOS_DURABLE.cambiar || ruta === RUTAS_AVISOS_DURABLE.verificar;
  const cuerpo = esperada ? cuerpoCon(entrada, 'acceso,correo,revisionEsperada') : undefined;
  if (!cuerpo || !esRevisionDestino(cuerpo.revisionEsperada)) {
    return undefined;
  }
  const acceso = leerAccesoSesionPanel(cuerpo.acceso);
  const correo = leerDestinoCorreo(cuerpo.correo);
  const { revisionEsperada } = cuerpo;
  return ruta === RUTAS_AVISOS_DURABLE.cambiar
    ? () => almacen.cambiarDestinoAvisosDeSesion(acceso, revisionEsperada, correo)
    : () => almacen.verificarDestinoAvisosDeSesion(acceso, revisionEsperada, correo);
}
/** Devuelve la acción ya validada; un mensaje fuera de contrato no llega al almacén y responde 400. */
function accionDe(
  almacen: AlmacenSesionAvisosSqlite,
  ruta: string,
  entrada: unknown,
  variables: VariablesDelEntorno,
): Accion {
  if (ruta === RUTAS_AVISOS_DURABLE.destino && cuerpoCon(entrada, '')) {
    return async () => ({ destino: await almacen.leerDestinoParaAvisar() });
  }
  const leer = ruta === RUTAS_AVISOS_DURABLE.leer ? cuerpoCon(entrada, 'acceso') : undefined;
  if (leer) {
    const acceso = leerAccesoSesionPanel(leer.acceso);
    return () => almacen.leerDestinoYAvisosDeSesion(acceso, variables);
  }
  const conCorreo = accionConCorreo(almacen, ruta, entrada);
  if (conCorreo) {
    return conCorreo;
  }
  const quitar = ruta === RUTAS_AVISOS_DURABLE.quitar ? cuerpoCon(entrada, 'acceso,revisionEsperada') : undefined;
  if (quitar && esRevisionDestino(quitar.revisionEsperada)) {
    const acceso = leerAccesoSesionPanel(quitar.acceso);
    const { revisionEsperada } = quitar;
    return () => almacen.quitarDestinoAvisosDeSesion(acceso, revisionEsperada);
  }
  return undefined;
}
async function responderAvisosDurable(
  almacen: AlmacenSesionAvisosSqlite,
  entrada: Readonly<{ ruta: string; cuerpo: unknown; variables: VariablesDelEntorno }>,
) {
  let accion: (() => Promise<unknown>) | undefined;
  try {
    accion = accionDe(almacen, entrada.ruta, entrada.cuerpo, entrada.variables);
  } catch {
    accion = undefined;
  }
  return responderOperacionPrivada(accion ? await accion() : undefined, MAX_RESPUESTA);
}
/**
 * Las rutas privadas que el objeto durable atiende con su almacén de sesión fuera del protocolo general: el destino de
 * los avisos y la encuesta. Devuelve null si la ruta no es de ninguno de los dos y la atiende otro protocolo. El
 * entorno sirve para decir en qué estado está cada canal de avisos.
 */
export async function responderPanelConSesionDurable(
  almacen: AlmacenSesionAvisosSqlite,
  ruta: string,
  cuerpo: unknown,
  variables: VariablesDelEntorno = {},
): Promise<Response | null> {
  if (esRutaAvisosDurable(ruta)) {
    return responderAvisosDurable(almacen, { ruta, cuerpo, variables });
  }
  return responderEncuestaDurable(almacen, ruta, cuerpo);
}
