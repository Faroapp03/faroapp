/**
 * Manejador `scheduled` del Worker. Lee la configuración y valida el evento con su propio plazo; el panel ejecuta
 * después la actualización con el suyo, sin anidar dos plazos iguales que se cortarían a la vez. Cada fallo queda
 * registrado con su fase en la autoridad, si el panel se puede preparar; si no, solo en el registro de Cloudflare.
 * El vigilante se evalúa siempre que esté habilitado, también con la programación apagada: apagarla por error es
 * justo una actualización parada de la que hay que avisar.
 */
import { configuracionProgramadaDelEntorno } from '../../administracion/configuracion-programada.ts';
import { capturarConfiguracionVigilante } from '../../administracion/configuracion-vigilante.ts';
import {
  anotarFalloProgramado,
  FalloProgramadoAnotado,
  type FaseProgramada,
  motivoDeLaCausa,
} from '../../administracion/fallo-programado.ts';
import { PLAZO_PANEL_MS } from '../../administracion/http.ts';
import type { SolicitudTrabajoProgramado } from '../../administracion/programacion-trabajos.ts';
import { comprobarEventoProgramado } from '../../administracion/programada.ts';
import { dentroDelPlazo } from '../../api/plazo.ts';
import { MS_POR_MINUTO } from '../../comun/tiempo.ts';
import type { AdministracionMontada } from '../administracion.ts';
import { RegistroAvisoFallido } from '../aviso-programado.ts';

export interface EventoProgramadoWorker {
  readonly scheduledTime: number;
  readonly cron: string;
  readonly noRetry?: () => void;
}
type PanelProgramado = Pick<AdministracionMontada, 'ejecutarProgramada' | 'registrarFalloProgramado'>;
/** Sin panel tampoco hay autoridad para el vigilante: el aviso no se intenta. */
class PanelNoPreparado extends FalloProgramadoAnotado {}

/** Sin configuración habilitada no hay evento que atender: devuelve `undefined`. */
async function validarEvento(
  evento: EventoProgramadoWorker,
  variables: Record<string, string>,
  seguimiento: { fase: FaseProgramada },
): Promise<SolicitudTrabajoProgramado | undefined> {
  return dentroDelPlazo(async () => {
    const configuracion = configuracionProgramadaDelEntorno(variables);
    if (!configuracion?.habilitada) {
      return undefined;
    }
    seguimiento.fase = 'validacion';
    const instante = evento.scheduledTime;
    if (!Number.isSafeInteger(instante) || instante > Date.now()) {
      throw new Error('El instante del evento programado no es válido');
    }
    // El cron identifica un minuto UTC. Cloudflare puede entregar segundos y milisegundos dentro de ese minuto.
    const eventoEn = instante - (instante % MS_POR_MINUTO);
    return comprobarEventoProgramado({ eventoEn, cron: evento.cron }, configuracion);
  }, PLAZO_PANEL_MS);
}
async function prepararPanel(obtenerPanel: () => Promise<PanelProgramado>) {
  const panel = await dentroDelPlazo(() => obtenerPanel(), PLAZO_PANEL_MS);
  if (!panel.ejecutarProgramada) {
    throw new Error('La programación no está disponible');
  }
  return { ...panel, ejecutarProgramada: panel.ejecutarProgramada };
}
/** El panel se prepara aparte para registrar el fallo de configuración o de validación en su autoridad. */
async function anotarAntesDelPanel(
  obtenerPanel: () => Promise<PanelProgramado>,
  evento: EventoProgramadoWorker,
  fase: FaseProgramada,
  causa: unknown,
): Promise<FalloProgramadoAnotado> {
  const fallo = { eventoEn: evento.scheduledTime, fase, motivo: motivoDeLaCausa(causa) };
  let panel: PanelProgramado | undefined;
  try {
    panel = await dentroDelPlazo(() => obtenerPanel(), PLAZO_PANEL_MS);
  } catch {
    panel = undefined;
  }
  const registro = panel?.registrarFalloProgramado;
  const registrado = await anotarFalloProgramado(registro ? { registrarFalloProgramado: registro } : undefined, fallo);
  return new FalloProgramadoAnotado(fase, registrado, causa);
}
/** Sin programación habilitada el evento no toca la autoridad para la actualización. */
async function atender(
  evento: EventoProgramadoWorker,
  variables: Record<string, string>,
  obtenerPanel: () => Promise<PanelProgramado>,
): Promise<void> {
  const seguimiento: { fase: FaseProgramada } = { fase: 'configuracion' };
  let solicitud: SolicitudTrabajoProgramado | undefined;
  try {
    solicitud = await validarEvento(evento, variables, seguimiento);
  } catch (causa) {
    throw await anotarAntesDelPanel(obtenerPanel, evento, seguimiento.fase, causa);
  }
  if (!solicitud) {
    return;
  }
  let panel: Awaited<ReturnType<typeof prepararPanel>>;
  try {
    panel = await prepararPanel(obtenerPanel);
  } catch (causa) {
    // Sin panel no hay autoridad donde guardar el fallo: queda en el registro de Cloudflare.
    throw new PanelNoPreparado('preparacion', false, causa);
  }
  await panel.ejecutarProgramada(solicitud);
}
export interface MontajeProgramado {
  readonly obtenerPanel: () => Promise<PanelProgramado>;
  /** Prepara el panel y devuelve el paso del vigilante (`undefined` si no está habilitado), con su propio plazo. */
  readonly prepararAviso: () => Promise<(() => Promise<unknown>) | undefined>;
}
/**
 * Con `FARO_VIGILANTE` no válida no hay evaluación, pero sí aviso de ese hecho (si hay canal) y una línea en el
 * registro de Cloudflare: sin ellos, nadie se enteraría de que el vigilante no vigila.
 */
function vigilanteQueAvisa(variables: Record<string, string>): boolean {
  const { configuracion, invalida } = capturarConfiguracionVigilante(variables);
  if (invalida) {
    console.error('Faro: la configuración del vigilante no es válida.', {
      fase: 'aviso',
      motivo: 'configuracion-vigilante',
    });
  }
  return invalida || configuracion?.habilitado === true;
}
/**
 * El aviso no tumba el evento: su fallo queda en el registro de Cloudflare y el envío fallido, en la autoridad. Si
 * lo que falla es el registro de un envío, el registro de Cloudflare lo dice con el resultado del envío.
 */
async function avisarSinTumbar(prepararAviso: MontajeProgramado['prepararAviso']): Promise<void> {
  try {
    // Preparar, enviar y registrar tienen cada uno su plazo: un plazo común podría cortar tras un envío aceptado.
    const avisar = await dentroDelPlazo(() => prepararAviso(), PLAZO_PANEL_MS);
    await avisar?.();
  } catch (error) {
    if (error instanceof RegistroAvisoFallido) {
      console.error('Faro: el envío del aviso del vigilante no se ha podido registrar.', {
        fase: 'aviso',
        envio: error.envio,
      });
      return;
    }
    console.error('Faro: el aviso del vigilante no se ha podido preparar.', { fase: 'aviso' });
  }
}
/**
 * Atiende el evento y, después, el vigilante: también cuando la actualización ha fallado, que es cuando más falta
 * hace avisar. Deja en el registro de Cloudflare la fase y si el fallo quedó guardado, sin mensajes externos que
 * puedan contener credenciales.
 */
export async function atenderEventoProgramado(
  evento: EventoProgramadoWorker,
  variables: Record<string, string>,
  montaje: MontajeProgramado,
): Promise<void> {
  let fallo: unknown;
  try {
    evento.noRetry?.();
    await atender(evento, variables, montaje.obtenerPanel);
  } catch (error) {
    fallo = error;
  }
  if (vigilanteQueAvisa(variables) && !(fallo instanceof PanelNoPreparado)) {
    await avisarSinTumbar(montaje.prepararAviso);
  }
  if (fallo !== undefined) {
    const causa =
      fallo instanceof FalloProgramadoAnotado
        ? { fase: fallo.fase, registrado: fallo.registrado }
        : { fase: 'recepcion', registrado: false };
    console.error('Faro: la actualización programada ha fallado.', causa);
    throw new Error('La actualización programada no está disponible', { cause: causa });
  }
}
