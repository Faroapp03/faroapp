/** Consulta privada de mantenimiento. Solo crea el hijo al leer; no hereda secretos ni ejecuta una shell. */
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { type LectorEstadoDatosPanel, leerEstadoDatosPanel } from '../../administracion/estado-datos.js';
import { RUTAS } from './rutas.ts';

export const PLAZO_ESTADO_DATOS_MS = 3000;
export const MAX_SALIDA_ESTADO_DATOS_BYTES = 131_072;
const VARIABLES_MINIMAS = ['PATH', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ', 'TMPDIR', 'TMP', 'TEMP'] as const;
function entornoMinimo(): NodeJS.ProcessEnv {
  const entorno: NodeJS.ProcessEnv = {};
  for (const nombre of VARIABLES_MINIMAS) {
    const valor = process.env[nombre];
    if (valor !== undefined) {
      entorno[nombre] = valor;
    }
  }
  return entorno;
}
function noDisponible(): Error {
  return new Error('El estado de los datos no está disponible');
}
/** execFile limita tiempo y ambos canales; esperar close adicional garantiza recolectar al hijo también al abortar. */
async function consultar(senal: AbortSignal): Promise<Buffer> {
  if (senal.aborted) {
    throw noDisponible();
  }
  let terminar: (valor: { error: Error | null; salida: Buffer }) => void = () => undefined;
  const resultado = new Promise<{ error: Error | null; salida: Buffer }>((resolver) => {
    terminar = resolver;
  });
  const hijo = execFile(
    join(RUTAS.raiz, '.venv', 'bin', 'python'),
    ['-m', 'plataforma_datos.orquestacion.estado_panel'],
    {
      cwd: RUTAS.raiz,
      env: entornoMinimo(),
      encoding: 'buffer',
      timeout: PLAZO_ESTADO_DATOS_MS,
      maxBuffer: MAX_SALIDA_ESTADO_DATOS_BYTES,
      killSignal: 'SIGKILL',
      signal: senal,
      windowsHide: true,
    },
    (error, salida) => terminar({ error, salida }),
  );
  const recolectado = new Promise<void>((resolver) => {
    hijo.once('close', () => resolver());
  });
  const [hecho] = await Promise.all([resultado, recolectado]);
  if (hecho.error || senal.aborted) {
    throw noDisponible();
  }
  return hecho.salida;
}
/** La instalación decide el ejecutable y el cwd; ni el HTTP ni el documento pueden aportar órdenes o rutas. */
export function crearLectorEstadoDatosNode(
  consulta: (senal: AbortSignal) => Promise<Buffer> = consultar,
): LectorEstadoDatosPanel {
  return async (senal) => {
    let fase = 'ejecución';
    try {
      const salida = await consulta(senal);
      fase = 'validación de la salida';
      const texto = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(salida);
      return leerEstadoDatosPanel(JSON.parse(texto));
    } catch {
      if (!senal.aborted) {
        console.error('Faro: el estado de los datos no está disponible.', { fase });
      }
      throw noDisponible();
    }
  };
}
