import { cabecerasIdentidadWeb } from '../comun/identidad-web.ts';
// Carga opcional de datos globales: separada del paquete ocupacional. La instantánea se prepara al
// componer la API; las consultas no realizan I/O. Solo los fallos previstos del recurso estático la dejan indisponible.

import { type DatosGlobales, DatosGlobalesNoValidos, leerDatosGlobales } from '../datos-globales/datos.ts';

/** El recurso estático ya publicado por la web, fuera del manifiesto ocupacional. */
export const RUTA_DATOS_GLOBALES = 'datos/datos-globales.json';
/** Mismo límite de texto que el lector web de datos globales, en unidades UTF-16. */
const MAX_CARACTERES = 2_000_000;
/** Plazo de una lectura del recurso estático, como la carga de archivos del paquete en navegador. */
const PLAZO_ASSET_MS = 60_000;

/** Texto ausente por tamaño/forma inválida; los errores inesperados del lector se propagan. */
export function datosGlobalesDelTexto(texto: string): DatosGlobales | null {
  if (texto.length > MAX_CARACTERES) {
    return null;
  }
  let valor: unknown;
  try {
    valor = JSON.parse(texto);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return null;
    }
    throw error;
  }
  try {
    return leerDatosGlobales(valor);
  } catch (error) {
    if (error instanceof DatosGlobalesNoValidos) {
      return null;
    }
    throw error;
  }
}

/**
 * Lee una vez el recurso estático con el transporte local de la plataforma. No reenvía cabeceras ni datos del cliente.
 * Un estado no satisfactorio, forma inválida o plazo vencido deja null; otros errores no se ocultan.
 */
export async function cargarDatosGlobales(
  pedir: (peticion: Request) => Promise<Response>,
  raiz: URL,
): Promise<DatosGlobales | null> {
  const controlador = new AbortController();
  const peticion = new Request(new URL(RUTA_DATOS_GLOBALES, raiz), {
    headers: { ...cabecerasIdentidadWeb() },
    signal: controlador.signal,
  });
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  const plazo = new Promise<never>((_resolver, rechazar) => {
    temporizador = setTimeout(() => {
      const error = new DOMException('Plazo de lectura del asset global vencido', 'TimeoutError');
      rechazar(error);
      controlador.abort(error);
    }, PLAZO_ASSET_MS);
  });
  try {
    const leer = async (): Promise<DatosGlobales | null> => {
      const respuesta = await pedir(peticion);
      return respuesta.ok ? datosGlobalesDelTexto(await respuesta.text()) : null;
    };
    return await Promise.race([leer(), plazo]);
  } catch (error) {
    if (error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      return null;
    }
    throw error;
  } finally {
    clearTimeout(temporizador);
  }
}
