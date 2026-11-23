/**
 * Estado de cada canal de avisos tal como lo ve el panel. El objeto durable comparte el entorno del Worker, así que ve
 * el enlace de correo, el remitente y `FARO_AVISO_URL`, y lee la verificación de la dirección en su propia autoridad.
 * Ninguna dirección sale de aquí: solo estados y motivos de listas cerradas.
 */
import type { VerificacionDestino } from '../../administracion/avisos-destino.ts';
import { capturarConfiguracionVigilante } from '../../administracion/configuracion-vigilante.ts';
import { DestinoAvisoInvalido, destinoAvisoDelEntorno } from '../../administracion/envio-aviso.ts';
import { enlaceCorreoDelEntorno, remitenteAvisoDelEntorno } from '../../administracion/envio-aviso-correo.ts';
import type { EstadoAvisosPanel } from '../../administracion/vigilante-panel.js';
import type { AvisosVigilante, CanalAvisoVigilante } from '../../administracion/vigilante-proyeccion.ts';
import type { VariablesDelEntorno } from '../../comun/entorno.ts';
import type { IntentosPorCanal } from './aviso-canales-sqlite.ts';
import type { RegistroAvisoVigilante } from './aviso-vigilante-sqlite.ts';

type EstadoCorreo = Extract<CanalAvisoVigilante, { canal: 'correo' }>['estado'];
type EstadoUrl = Extract<CanalAvisoVigilante, { canal: 'url' }>['estado'];

/** Sin enlace o sin remitente no hay canal; con los dos, el estado es el de la dirección guardada. */
export function estadoCanalCorreo(variables: VariablesDelEntorno, verificacion: VerificacionDestino): EstadoCorreo {
  const enlace: unknown = (variables as Readonly<Record<string, unknown>>).AVISOS_CORREO;
  const origen = variables.FARO_ADMIN_ORIGEN;
  if (!enlaceCorreoDelEntorno(enlace) || origen === undefined || !URL.canParse(origen)) {
    return 'no-configurado';
  }
  const remitente = remitenteAvisoDelEntorno(variables, origen).estado;
  if (remitente !== 'configurado') {
    return remitente;
  }
  return verificacion === 'sin_destino' ? 'sin-destino' : verificacion;
}
/** Solo dice si hay destino y si es admisible; la dirección no sale del objeto durable. */
export function estadoCanalUrl(variables: VariablesDelEntorno): EstadoUrl {
  try {
    return destinoAvisoDelEntorno(variables) ? 'configurados' : 'no-configurados';
  } catch (error) {
    if (error instanceof DestinoAvisoInvalido) {
      return 'destino-no-admitido';
    }
    throw error;
  }
}
/**
 * El correo primero y después la URL, cada uno con su último intento. Un registro anterior a los intentos por canal
 * solo pudo venir de la URL: ese intento se conserva como el de la URL hasta que algún canal registre uno propio.
 */
export function avisosPorCanal(
  entrada: Readonly<{
    variables: VariablesDelEntorno;
    verificacion: VerificacionDestino;
    registro: RegistroAvisoVigilante;
    porCanal: IntentosPorCanal;
  }>,
): AvisosVigilante {
  const { variables, verificacion, registro, porCanal } = entrada;
  const sinIntentosPorCanal = porCanal.correo === undefined && porCanal.url === undefined;
  const intentoUrl = sinIntentosPorCanal ? registro.ultimoIntento : (porCanal.url ?? null);
  return Object.freeze({
    canales: Object.freeze([
      {
        canal: 'correo' as const,
        estado: estadoCanalCorreo(variables, verificacion),
        ultimoIntento: porCanal.correo ?? null,
      },
      { canal: 'url' as const, estado: estadoCanalUrl(variables), ultimoIntento: intentoUrl },
    ]),
  });
}
/**
 * Lo que la tarjeta «Avisos» enseña al abrir, sin escribir nada: los dos canales y si las comprobaciones automáticas
 * están activas. Sin vigilante habilitado el evento diario no evalúa ni avisa; con su configuración no válida, sí avisa
 * de eso mismo, así que cuenta como activas.
 */
export function estadoAvisosDeLaLectura(entrada: Parameters<typeof avisosPorCanal>[0]): EstadoAvisosPanel {
  const vigilante = capturarConfiguracionVigilante(entrada.variables);
  const activas = vigilante.invalida || vigilante.configuracion?.habilitado === true;
  return Object.freeze({
    comprobaciones: activas ? 'activas' : 'desactivadas',
    canales: avisosPorCanal(entrada).canales,
  });
}
