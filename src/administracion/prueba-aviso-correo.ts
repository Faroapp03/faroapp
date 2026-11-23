/**
 * El aviso de prueba que se pide desde el panel: un mensaje de verdad por el canal de correo a la dirección guardada,
 * dentro de la sesión administrativa y con un límite para que el botón no sirva para inundar un buzón. Si el enlace
 * acepta la prueba, esa dirección queda verificada: Email Routing solo entrega a destinos verificados en la cuenta, así
 * que la aceptación es la evidencia. La respuesta dice si ha salido y, si no, por qué, sin la dirección.
 */
import { MS_POR_MINUTO } from '../comun/tiempo.ts';
import {
  type AlmacenAvisosDestinoPanel,
  type DestinoAvisos,
  type ResultadoLecturaDestino,
  type ResumenDestinoAvisos,
  resumenDe,
} from './avisos-destino.ts';
import {
  type CanalCorreo,
  enviarTextoPorCorreo,
  type MotivoCorreoNoEnviado,
  type ResultadoEnvioCorreo,
} from './envio-aviso-correo.ts';
import { textoDePrueba } from './mensaje-aviso-correo.ts';
import type { AccesoSesionPanel, SesionPanelActiva, SesionPanelInactiva } from './sesion.ts';

/** Una prueba cada diez minutos como mucho. */
const MINUTOS_ENTRE_PRUEBAS = 10;
export const ESPERA_ENTRE_PRUEBAS_MS = MINUTOS_ENTRE_PRUEBAS * MS_POR_MINUTO;
export type MotivoPruebaNoEnviada = MotivoCorreoNoEnviado | 'canal-no-configurado' | 'limite-de-pruebas';
export type ResultadoPrueba =
  | Exclude<ResultadoEnvioCorreo, Readonly<{ resultado: 'no-enviado' }>>
  | Readonly<{ resultado: 'no-enviado'; motivo: MotivoPruebaNoEnviada }>;
/** `destino` es el resumen tras la prueba: con `verificado` si la prueba aceptada la ha confirmado. */
export type ResultadoPruebaAviso =
  | Readonly<{ estado: 'activa'; sesion: SesionPanelActiva; prueba: ResultadoPrueba; destino: ResumenDestinoAvisos }>
  | SesionPanelInactiva;
export interface PruebaAvisos {
  enviarAvisoDePruebaDeSesion(acceso: AccesoSesionPanel): Promise<ResultadoPruebaAviso>;
}
export interface OpcionesPrueba {
  readonly canal: CanalCorreo | undefined;
  readonly panel: string;
  readonly ahora?: () => number;
}
type LecturaActiva = Extract<ResultadoLecturaDestino, { estado: 'activa' }>;

/** La prueba va a la dirección guardada aunque esté pendiente: es justo lo que la confirma. */
function probar(canal: CanalCorreo, panel: string, destino: DestinoAvisos): Promise<ResultadoPrueba> {
  if (destino.correo === null) {
    return Promise.resolve({ resultado: 'no-enviado', motivo: 'sin-destino' });
  }
  return enviarTextoPorCorreo(canal, destino.correo, textoDePrueba(panel));
}
/**
 * Anota la evidencia con la revisión y la dirección a las que se envió. Si entretanto alguien la ha cambiado, la
 * autoridad responde conflicto y el destino sigue como esté (la dirección nueva, pendiente).
 */
async function verificar(
  almacen: AlmacenAvisosDestinoPanel,
  acceso: AccesoSesionPanel,
  destino: DestinoAvisos,
): Promise<SesionPanelInactiva | ResumenDestinoAvisos> {
  if (destino.correo === null || destino.verificacion === 'verificado') {
    return resumenDe(destino);
  }
  const resultado = await almacen.verificarDestinoAvisosDeSesion(acceso, destino.revision, destino.correo);
  return 'sesion' in resultado ? resultado.destino : resultado;
}
async function probarDentroDeLaSesion(
  almacen: AlmacenAvisosDestinoPanel,
  canal: CanalCorreo,
  panel: string,
  { acceso, lectura }: Readonly<{ acceso: AccesoSesionPanel; lectura: LecturaActiva }>,
): Promise<ResultadoPruebaAviso> {
  const prueba = await probar(canal, panel, lectura.destino);
  if (prueba.resultado !== 'enviado') {
    return { estado: 'activa', sesion: lectura.sesion, prueba, destino: resumenDe(lectura.destino) };
  }
  const destino = await verificar(almacen, acceso, lectura.destino);
  return 'estado' in destino ? destino : { estado: 'activa', sesion: lectura.sesion, prueba, destino };
}
/**
 * Pone la prueba junto a las operaciones del destino. El límite es de esta instancia del Worker: cuenta solo las
 * pruebas que han llegado a intentar el envío, para que un intento sin destino no impida el siguiente.
 */
export function conPruebaDeCorreo(
  almacen: AlmacenAvisosDestinoPanel,
  { canal, panel, ahora = Date.now }: OpcionesPrueba,
): AlmacenAvisosDestinoPanel & PruebaAvisos {
  let ultimaPrueba = Number.NEGATIVE_INFINITY;
  return {
    leerDestinoAvisosDeSesion: (acceso) => almacen.leerDestinoAvisosDeSesion(acceso),
    cambiarDestinoAvisosDeSesion: (acceso, revision, correo) =>
      almacen.cambiarDestinoAvisosDeSesion(acceso, revision, correo),
    quitarDestinoAvisosDeSesion: (acceso, revision) => almacen.quitarDestinoAvisosDeSesion(acceso, revision),
    verificarDestinoAvisosDeSesion: (acceso, revision, correo) =>
      almacen.verificarDestinoAvisosDeSesion(acceso, revision, correo),
    async enviarAvisoDePruebaDeSesion(acceso) {
      const lectura = await almacen.leerDestinoAvisosDeSesion(acceso);
      if (lectura.estado !== 'activa') {
        return lectura;
      }
      const responder = (motivo: MotivoPruebaNoEnviada): ResultadoPruebaAviso => ({
        estado: 'activa',
        sesion: lectura.sesion,
        prueba: { resultado: 'no-enviado', motivo },
        destino: resumenDe(lectura.destino),
      });
      if (!canal) {
        return responder('canal-no-configurado');
      }
      const instante = ahora();
      const conDireccion = lectura.destino.correo !== null;
      if (conDireccion && instante - ultimaPrueba < ESPERA_ENTRE_PRUEBAS_MS) {
        return responder('limite-de-pruebas');
      }
      if (conDireccion) {
        ultimaPrueba = instante;
      }
      return probarDentroDeLaSesion(almacen, canal, panel, { acceso, lectura });
    },
  };
}
export function tienePrueba(almacen: AlmacenAvisosDestinoPanel): almacen is AlmacenAvisosDestinoPanel & PruebaAvisos {
  return typeof (almacen as Partial<PruebaAvisos>).enviarAvisoDePruebaDeSesion === 'function';
}
