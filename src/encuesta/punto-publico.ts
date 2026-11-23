/**
 * El punto público de la encuesta (RUTA_DE_LA_ENCUESTA): recibe por POST un código y sus respuestas cerradas y las suma
 * al agregado. De la petición solo se leen el método, dos cabeceras técnicas (content-type y content-length) y el
 * cuerpo: ni la URL, ni la dirección IP, ni cabeceras que identifiquen, ni los datos que Cloudflare añade a la
 * petición. No escribe nada en la consola, tampoco ante un fallo. Un código que no existe, uno ya usado y uno de una
 * encuesta cerrada reciben exactamente la misma respuesta. pruebas/encuesta/anonimato.test.ts lo comprueba.
 *
 * El tope de intentos es de cada instancia y no mira quién envía, como el del punto de avisos: un tope por persona
 * exigiría leer la dirección IP, aunque fuera para convertirla en una huella rotatoria (cloudflare/limite-recorrido.ts),
 * y este punto no la lee. Adivinar un código de 140 bits al azar no es posible con ningún número de intentos.
 */
import { ESTADO_HTTP } from '../comun/estados-http.ts';
import { MS_POR_MINUTO, MS_POR_SEGUNDO } from '../comun/tiempo.ts';
import { huellaDelCodigo, leerCodigo } from './codigos.ts';
import { type AlmacenEncuesta, EncuestaInvalida, leerRespuestas, objetoCerrado } from './contrato.ts';

export const RUTA_DE_LA_ENCUESTA = '/encuesta/responder';
/** El cuerpo más largo posible (un código y cinco respuestas cerradas) ocupa unos 200 bytes; 1 KiB deja margen sin abrir la puerta. */
export const MAX_CUERPO_ENCUESTA_BYTES = 1024;
/** Envíos por minuto en cada instancia, vengan de quien vengan: cubre una sesión del piloto con todo el grupo a la vez. */
export const MAX_ENVIOS_POR_MINUTO = 60;
const METODO = 'POST';
const TIPO = 'application/json';
/** La única respuesta de rechazo de un código: la misma para uno inexistente, uno usado y uno de una encuesta cerrada. */
export const CODIGO_NO_VALIDO = 'codigo_no_valido';

export interface OpcionesDelPuntoDeEncuesta {
  readonly ahora?: () => number;
}
export type PuntoDeEncuesta = (
  peticion: Request,
  almacen: Pick<AlmacenEncuesta, 'responder'> | undefined,
) => Promise<Response>;

function respuesta(datos: object, estado: number, cabeceras: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(datos), {
    status: estado,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
      ...cabeceras,
    },
  });
}
/** Lee el cuerpo con el tope en bytes también cuando no se declara su longitud; null si lo supera o no es UTF-8. */
async function cuerpoLimitado(peticion: Request): Promise<string | null> {
  const declarada = peticion.headers.get('content-length');
  if (declarada !== null && (!/^(0|[1-9]\d*)$/.test(declarada) || Number(declarada) > MAX_CUERPO_ENCUESTA_BYTES)) {
    return null;
  }
  const lector = peticion.body?.getReader();
  if (!lector) {
    return null;
  }
  const decodificador = new TextDecoder('utf-8', { fatal: true });
  let leidos = 0;
  let texto = '';
  try {
    for (;;) {
      const { done, value } = await lector.read();
      if (done) {
        return texto + decodificador.decode();
      }
      leidos += value.byteLength;
      if (leidos > MAX_CUERPO_ENCUESTA_BYTES) {
        await lector.cancel();
        return null;
      }
      texto += decodificador.decode(value, { stream: true });
    }
  } catch (error) {
    if (error instanceof TypeError) {
      return null;
    }
    throw error;
  }
}
/** El código y las celdas de la respuesta; EncuestaInvalida si el cuerpo no cumple el contrato. */
function leerEnvio(texto: string) {
  let datos: unknown;
  try {
    datos = JSON.parse(texto);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new EncuestaInvalida();
    }
    throw error;
  }
  const o = objetoCerrado(datos, ['codigo', 'respuestas']);
  return { codigo: o.codigo, respuestas: o.respuestas };
}
async function atender(peticion: Request, almacen: Pick<AlmacenEncuesta, 'responder'>): Promise<Response> {
  const texto = await cuerpoLimitado(peticion);
  if (texto === null) {
    return respuesta({ error: 'solicitud_invalida' }, ESTADO_HTTP.solicitudIncorrecta);
  }
  let envio: ReturnType<typeof leerEnvio>;
  try {
    envio = leerEnvio(texto);
  } catch (error) {
    if (error instanceof EncuestaInvalida) {
      return respuesta({ error: 'solicitud_invalida' }, ESTADO_HTTP.solicitudIncorrecta);
    }
    throw error;
  }
  let codigo: ReturnType<typeof leerCodigo>;
  try {
    codigo = leerCodigo(envio.codigo);
  } catch (error) {
    if (error instanceof EncuestaInvalida) {
      return respuesta({ error: CODIGO_NO_VALIDO }, ESTADO_HTTP.conflicto);
    }
    throw error;
  }
  let celdas: ReturnType<typeof leerRespuestas>;
  try {
    celdas = leerRespuestas(codigo.tipo, envio.respuestas);
  } catch (error) {
    if (error instanceof EncuestaInvalida) {
      return respuesta({ error: 'solicitud_invalida' }, ESTADO_HTTP.solicitudIncorrecta);
    }
    throw error;
  }
  const aceptada = await almacen.responder({ huella: huellaDelCodigo(codigo.codigo), tipo: codigo.tipo, celdas });
  return aceptada
    ? respuesta({ estado: 'registrada' }, ESTADO_HTTP.correcto)
    : respuesta({ error: CODIGO_NO_VALIDO }, ESTADO_HTTP.conflicto);
}

/** Si el envío cabe en la ventana del minuto, y lo cuenta; si no, los segundos hasta que se abra la siguiente. */
function cabeEnLaVentana(ventana: { inicio: number; envios: number }, instante: number): true | number {
  if (instante - ventana.inicio >= MS_POR_MINUTO) {
    ventana.inicio = instante;
    ventana.envios = 0;
  }
  if (ventana.envios >= MAX_ENVIOS_POR_MINUTO) {
    return Math.max(1, Math.ceil((ventana.inicio + MS_POR_MINUTO - instante) / MS_POR_SEGUNDO));
  }
  ventana.envios += 1;
  return true;
}
/**
 * El punto de la encuesta de una instancia, con su ventana de envíos por minuto. 200 a una respuesta sumada, 409 con
 * «codigo_no_valido» a un código que no sirve, 400 a un cuerpo fuera de contrato o de tamaño, 405, 415, 429 con
 * Retry-After y 503 si el almacén no está o falla.
 */
export function crearPuntoDeEncuesta(opciones: OpcionesDelPuntoDeEncuesta = {}): PuntoDeEncuesta {
  const ahora = opciones.ahora ?? Date.now;
  // La ventana vive lo que viva la instancia y solo cuenta envíos: no guarda nada de quien los hace.
  const ventana = { inicio: Number.NEGATIVE_INFINITY, envios: 0 };
  return async (peticion, almacen) => {
    if (peticion.method !== METODO) {
      return respuesta({ error: 'metodo_no_admitido' }, ESTADO_HTTP.metodoNoAdmitido, { allow: METODO });
    }
    const [tipo = ''] = (peticion.headers.get('content-type') ?? '').split(';');
    if (tipo.trim().toLowerCase() !== TIPO) {
      return respuesta({ error: 'tipo_no_admitido' }, ESTADO_HTTP.tipoNoAdmitido);
    }
    const cabe = cabeEnLaVentana(ventana, ahora());
    if (cabe !== true) {
      return respuesta({ error: 'demasiadas_peticiones' }, ESTADO_HTTP.demasiadasPeticiones, {
        'retry-after': String(cabe),
      });
    }
    if (!almacen) {
      return respuesta({ error: 'no_disponible' }, ESTADO_HTTP.noDisponible);
    }
    try {
      return await atender(peticion, almacen);
    } catch {
      // Cualquier fallo de aquí en adelante (el almacén, su enlace o un error de programación) responde 503 y no se
      // registra, por decisión: el error puede llevar el código o su huella en su mensaje o en su pila, y un registro
      // con la hora del fallo uniría ese código con el momento en que se respondió. Los fallos se ven en el panel como
      // códigos que no se consumen; se diagnostican reproduciéndolos en pruebas, no con registros del punto.
      return respuesta({ error: 'no_disponible' }, ESTADO_HTTP.noDisponible);
    }
  };
}
