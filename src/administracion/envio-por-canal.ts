/**
 * Resultado de un aviso en cada canal (correo y URL). Cada canal guarda su propio intento para que el panel diga cuál
 * falló y por qué; lo ya avisado es uno solo para los dos: basta con que un canal entregue para no repetir el aviso.
 */
import { MOTIVOS_FALLO_AVISO, type ResultadoEnvioAviso } from './envio-aviso.ts';
import { type MotivoFalloCorreo, motivoParaElRegistro } from './envio-aviso-correo.ts';
import { exigirTrabajo, objetoTrabajo } from './estado-trabajos.js';
import { MOTIVOS_FALLO_CORREO_PANEL } from './vigilante-panel.js';

/** Una dirección guardada que no cabe en la cabecera tampoco se ha podido avisar: tiene su propio motivo. */
export type MotivoFalloCanalCorreo = MotivoFalloCorreo | 'destino-no-admitido';
export type EnvioPorCanal =
  | Readonly<{ canal: 'url'; envio: ResultadoEnvioAviso }>
  | Readonly<{
      canal: 'correo';
      envio: Readonly<{ resultado: 'enviado' }> | Readonly<{ resultado: 'fallido'; motivo: MotivoFalloCanalCorreo }>;
    }>;

function leerEnvio(entrada: unknown, motivos: readonly string[]) {
  const conMotivo = entrada !== null && typeof entrada === 'object' && 'motivo' in entrada;
  const o = objetoTrabajo(entrada, conMotivo ? 'motivo,resultado' : 'resultado');
  if (o.resultado === 'enviado' && !conMotivo) {
    return Object.freeze({ resultado: 'enviado' as const });
  }
  exigirTrabajo(o.resultado === 'fallido' && typeof o.motivo === 'string' && motivos.includes(o.motivo));
  return Object.freeze({ resultado: 'fallido' as const, motivo: o.motivo as string });
}
/** Un canal como mucho una vez, y cada uno con los motivos de su propia lista. */
export function leerEnviosPorCanal(entrada: unknown): readonly EnvioPorCanal[] {
  exigirTrabajo(Array.isArray(entrada) && entrada.length >= 1 && entrada.length <= 2);
  const envios = entrada.map((valor) => {
    const o = objetoTrabajo(valor, 'canal,envio');
    exigirTrabajo(o.canal === 'correo' || o.canal === 'url');
    const motivos = o.canal === 'correo' ? MOTIVOS_FALLO_CORREO_PANEL : MOTIVOS_FALLO_AVISO;
    return Object.freeze({ canal: o.canal, envio: leerEnvio(o.envio, motivos) }) as EnvioPorCanal;
  });
  exigirTrabajo(new Set(envios.map((e) => e.canal)).size === envios.length);
  return Object.freeze(envios);
}
/** El registro compartido solo admite los motivos de siempre: el detalle del correo se agrupa en ellos. */
function envioCompartido(envio: EnvioPorCanal): ResultadoEnvioAviso {
  if (envio.canal === 'url' || envio.envio.resultado === 'enviado') {
    return envio.envio as ResultadoEnvioAviso;
  }
  const motivo = envio.envio.motivo;
  return { resultado: 'fallido', motivo: motivo === 'destino-no-admitido' ? motivo : motivoParaElRegistro(motivo) };
}
/** Por orden de los canales: basta una entrega; si ninguna llega, cuenta el fallo del primero. */
export function resultadoDeLosCanales(envios: readonly EnvioPorCanal[]): ResultadoEnvioAviso {
  const entregado = envios.find((e) => e.envio.resultado === 'enviado');
  const elegido = entregado ?? envios[0];
  exigirTrabajo(elegido !== undefined);
  return envioCompartido(elegido);
}
