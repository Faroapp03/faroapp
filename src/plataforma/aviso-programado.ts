/**
 * Paso del vigilante en el evento programado: evalúa con el último recibo, decide si toca avisar y lo envía por los
 * canales que estén listos (el correo a la dirección confirmada del panel y la URL de `FARO_AVISO_URL`). Los dos
 * comparten el registro de lo avisado: un aviso se da por enviado si un canal lo entrega, y no se repite.
 */
import type { AvisoPreparado, CuerpoAvisoVigilante, EstadoAvisoVigilante } from '../administracion/aviso-vigilante.ts';
import type { DestinoAvisos } from '../administracion/avisos-destino.ts';
import { DestinoAvisoInvalido, enviarAviso, type ResultadoEnvioAviso } from '../administracion/envio-aviso.ts';
import { type CanalCorreo, enviarAvisoPorCorreo } from '../administracion/envio-aviso-correo.ts';
import { type EnvioPorCanal, resultadoDeLosCanales } from '../administracion/envio-por-canal.ts';
import { PLAZO_PANEL_MS } from '../administracion/http.ts';
import { dentroDelPlazo } from '../api/plazo.ts';

/**
 * Cada paso tiene su propio plazo: preparar en la autoridad, enviar (el de `enviarAviso`) y registrar. Así un envío
 * aceptado se registra siempre que la autoridad responda, aunque la preparación o el envío hayan tardado.
 */
export const PLAZO_REGISTRO_AVISO_MS = 3000;
/** El aviso ya ha salido (o ha fallado con su motivo), pero la autoridad no lo ha guardado. */
export class RegistroAvisoFallido extends Error {
  readonly envio: ResultadoEnvioAviso['resultado'];
  constructor(envio: ResultadoEnvioAviso['resultado'], causa: unknown) {
    super('El envío del aviso no se ha podido registrar', { cause: causa });
    this.envio = envio;
  }
}

export interface AutoridadAvisos {
  prepararAvisoVigilante(panel: string): Promise<AvisoPreparado | null>;
  registrarEnvioAviso(
    entrada: Readonly<{
      envio: ResultadoEnvioAviso;
      siguiente: EstadoAvisoVigilante;
      canales: readonly EnvioPorCanal[];
    }>,
  ): Promise<unknown>;
}
export type ResultadoAvisoProgramado = 'no-configurados' | 'sin-aviso' | 'enviado' | 'fallido';
export interface OpcionesAvisoProgramado {
  readonly autoridad: AutoridadAvisos;
  /** Lee y valida `FARO_AVISO_URL`; lanza `DestinoAvisoInvalido` si no es https o lleva credenciales. */
  readonly destino: () => URL | undefined;
  readonly panel: string;
  readonly pedir?: typeof fetch;
  /** El canal de correo, si el Worker tiene el enlace y un remitente admitido, con la lectura de su destino. */
  readonly correo?: Readonly<{ canal: CanalCorreo; destino: () => Promise<DestinoAvisos> }>;
}
function leerDestino(destino: OpcionesAvisoProgramado['destino']): URL | undefined | DestinoAvisoInvalido {
  try {
    return destino();
  } catch (error) {
    if (error instanceof DestinoAvisoInvalido) {
      return error;
    }
    throw error;
  }
}
type Envio = (cuerpo: CuerpoAvisoVigilante) => Promise<EnvioPorCanal>;
/** El correo solo cuenta como canal con un destino confirmado: sin él no se intenta y no queda ningún intento. */
async function envioPorCorreo(correo: OpcionesAvisoProgramado['correo']): Promise<Envio | undefined> {
  if (!correo) {
    return undefined;
  }
  const destino = await dentroDelPlazo(() => correo.destino(), PLAZO_PANEL_MS);
  if (destino.verificacion !== 'verificado') {
    return undefined;
  }
  return async (cuerpo) => {
    const envio = await enviarAvisoPorCorreo(correo.canal, destino, cuerpo);
    if (envio.resultado === 'enviado') {
      return { canal: 'correo', envio };
    }
    // Una dirección guardada que no cabe en la cabecera no se ha podido avisar: queda como dirección no admitida.
    const motivo = envio.resultado === 'no-enviado' ? 'destino-no-admitido' : envio.motivo;
    return { canal: 'correo', envio: { resultado: 'fallido', motivo } };
  };
}
function envioPorUrl(url: URL | undefined | DestinoAvisoInvalido, pedir?: typeof fetch): Envio | undefined {
  if (url === undefined) {
    return undefined;
  }
  return async (cuerpo) => ({
    canal: 'url',
    envio:
      url instanceof DestinoAvisoInvalido
        ? { resultado: 'fallido', motivo: 'destino-no-admitido' }
        : await enviarAviso(url, cuerpo, pedir),
  });
}
/** Por orden, el correo primero; cada canal intenta el suyo aunque otro ya haya entregado. */
async function enviarPorLosCanales(envios: readonly Envio[], cuerpo: CuerpoAvisoVigilante) {
  const resultados: EnvioPorCanal[] = [];
  for (const enviar of envios) {
    resultados.push(await enviar(cuerpo));
  }
  return resultados;
}
export function crearAvisoProgramado({ autoridad, destino, panel, pedir, correo }: OpcionesAvisoProgramado) {
  return async (): Promise<ResultadoAvisoProgramado> => {
    // El vigilante se evalúa siempre: sus decisiones quedan en el panel aunque no haya canal de avisos.
    const preparado = await dentroDelPlazo(() => autoridad.prepararAvisoVigilante(panel), PLAZO_PANEL_MS);
    const envios = [await envioPorCorreo(correo), envioPorUrl(leerDestino(destino), pedir)].filter(
      (envio): envio is Envio => envio !== undefined,
    );
    if (envios.length === 0) {
      return 'no-configurados';
    }
    if (preparado === null) {
      return 'sin-aviso';
    }
    const canales = await enviarPorLosCanales(envios, preparado.cuerpo);
    const envio = resultadoDeLosCanales(canales);
    try {
      await dentroDelPlazo(
        () => autoridad.registrarEnvioAviso({ envio, siguiente: preparado.siguiente, canales }),
        PLAZO_REGISTRO_AVISO_MS,
      );
    } catch (causa) {
      throw new RegistroAvisoFallido(envio.resultado, causa);
    }
    return envio.resultado;
  };
}
