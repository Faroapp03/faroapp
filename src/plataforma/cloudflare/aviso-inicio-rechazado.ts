/** Aviso del vigilante en cuanto un permiso de inicio queda rechazado con evidencia, sin esperar al evento diario. */
import { DestinoAvisoInvalido } from '../../administracion/envio-aviso.ts';
import { RegistroAvisoFallido, type ResultadoAvisoProgramado } from '../aviso-programado.ts';

/** Sin canal no se evalúa ni se intenta nada; con un destino no admitido sí, para que el panel lo diga. */
function hayDestino(destino: () => URL | undefined): boolean {
  try {
    return destino() !== undefined;
  } catch (error) {
    if (error instanceof DestinoAvisoInvalido) {
      return true;
    }
    throw error;
  }
}
/**
 * Corre después de responder (con `waitUntil`), así que nunca rechaza: un fallo queda en el registro de Cloudflare,
 * como en el evento diario, y el envío fallido, en la autoridad, que lo reintentará el evento siguiente. `hayCorreo`
 * dice si el Worker tiene canal de correo: con él como único canal, el rechazo también se avisa en el momento, con la
 * misma memoria de lo ya avisado que el evento diario.
 */
export function crearAvisoInicioRechazado(
  avisar: () => Promise<ResultadoAvisoProgramado>,
  destino: () => URL | undefined,
  hayCorreo = false,
): () => Promise<void> {
  return async () => {
    try {
      if (hayCorreo || hayDestino(destino)) {
        await avisar();
      }
    } catch (error) {
      if (error instanceof RegistroAvisoFallido) {
        console.error('Faro: el envío del aviso del vigilante no se ha podido registrar.', {
          fase: 'aviso',
          origen: 'inicio-rechazado',
          envio: error.envio,
        });
        return;
      }
      console.error('Faro: el aviso del vigilante no se ha podido preparar.', {
        fase: 'aviso',
        origen: 'inicio-rechazado',
      });
    }
  };
}
