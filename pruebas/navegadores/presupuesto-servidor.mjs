// El servidor del ensayo del presupuesto de rendimiento: se pone delante del fixture (o del Worker oficial, en la
// portada y el acceso) y hace lo que haría el alojamiento y la red del teléfono, igual para los tres motores:
// - HTTPS con HTTP/2 (y HTTP/1.1 si el motor no lo negocia), con el certificado sintético de loopback de esta carpeta;
// - compresión de los tipos de texto con Brotli o gzip según `accept-encoding`, como la red del alojamiento;
// - latencia añadida a cada respuesta y ancho de banda de bajada compartido por todas (un cubo de fichas: el enlace).
// Anota cada petición: ruta, destino (`sec-fetch-dest`), protocolo, codificación, bytes sin comprimir, tamaño de la
// respuesta y bytes servidos (los escritos de verdad: menos que el tamaño si el navegador corta), y cuándo llegó y
// cuándo salió su último byte. Las cifras del ensayo salen de este registro.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Agent, createServer, request as pedirHttp } from 'node:http';
import { createSecureServer } from 'node:http2';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { brotliCompress, constants, gzip } from 'node:zlib';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { IDENTIDAD_WEB } from '../../src/comun/identidad-web.ts';
import { adaptarSolicitud } from './fixture.ts';

const comprimirBrotli = promisify(brotliCompress);
const comprimirGzip = promisify(gzip);
const MS_POR_SEGUNDO = 1000;
/** Niveles intermedios, los de una compresión al vuelo (el máximo de Brotli es 11 y el de gzip, 9). */
const CALIDAD_BROTLI = 5;
const NIVEL_GZIP = 6;
/** Los tipos que el alojamiento comprime: texto, JSON, JavaScript, manifiestos y SVG; nunca fuentes ni imágenes. */
export const COMPRIMIBLE = /^(?:text\/|application\/(?:json|javascript|manifest\+json|xml)|image\/svg\+xml)/u;
/** Lo que se envía de una vez por el enlace limitado: trozos pequeños para que las respuestas se repartan el ancho. */
export const TROZO = 16_384;
/** Lo que se espera entre dos miradas al tráfico en curso. */
const SONDEO_DE_CALMA_MS = 250;
/** Cabeceras propias de cada conexión, que no se reenvían (HTTP/2 las prohíbe). */
const DE_CONEXION = new Set(['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'proxy-connection', 'te']);
const TLS = {
  cert: readFileSync(new URL('./tls-sintetico.pem', import.meta.url)),
  key: readFileSync(new URL('./tls-clave-sintetica.pem', import.meta.url)),
};

/** Milisegundos de época con fracción, comparables con los de la página (performance.timeOrigin + now). */
export const ahora = () => performance.timeOrigin + performance.now();
const esperar = (ms) => new Promise((ok) => setTimeout(ok, Math.max(0, ms)));

/** Lo ya comprimido, por codificación y huella del cuerpo: el alojamiento no comprime dos veces lo mismo. */
const comprimidos = new Map();

/** El cuerpo comprimido con `codificacion` (br o gzip), una sola vez por contenido. */
export function comprimir(cuerpo, codificacion, huella = createHash('sha256').update(cuerpo).digest('hex')) {
  const clave = `${codificacion}:${huella}`;
  if (!comprimidos.has(clave)) {
    const brotli = {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: CALIDAD_BROTLI,
        [constants.BROTLI_PARAM_SIZE_HINT]: cuerpo.length,
      },
    };
    comprimidos.set(
      clave,
      codificacion === 'br' ? comprimirBrotli(cuerpo, brotli) : comprimirGzip(cuerpo, { level: NIVEL_GZIP }),
    );
  }
  return comprimidos.get(clave);
}

const TEXTO_PUBLICADO = /\.(?:html|css|js|mjs|json|webmanifest|svg|txt|md|xml)$/u;

/**
 * Comprime de antemano, con Brotli, todo el texto publicado de la construcción, como un alojamiento que guarda lo
 * comprimido: así ningún escenario paga la primera compresión de un archivo y todos se miden igual.
 */
export async function precomprimir(artefacto) {
  const inicio = ahora();
  const tareas = [];
  let bytes = 0;
  for (const [ruta, ficha] of artefacto.fichas) {
    if (ruta.startsWith('web/') && TEXTO_PUBLICADO.test(ruta)) {
      tareas.push(comprimir(artefacto.leer(ruta), 'br', ficha.sha256));
      bytes += ficha.bytes;
    }
  }
  const comprimidosBr = await Promise.all(tareas);
  const servidos = comprimidosBr.reduce((suma, cuerpo) => suma + cuerpo.length, 0);
  return { archivos: tareas.length, bytesSinComprimir: bytes, bytesBrotli: servidos, ms: Math.round(ahora() - inicio) };
}

/** La codificación que el alojamiento elige para lo que acepta el navegador: Brotli antes que gzip. */
function elegirCodificacion(aceptadas) {
  const lista = String(aceptadas ?? '')
    .split(',')
    .map((parte) => parte.trim().split(';')[0]);
  if (lista.includes('br')) {
    return 'br';
  }
  return lista.includes('gzip') ? 'gzip' : null;
}

/**
 * El enlace de bajada: un cubo de fichas compartido por todas las respuestas. Cada trozo reserva su turno al pedirlo y
 * espera a que el enlace lo haya «transmitido» a `bytesPorSegundo`; sin límite, no espera.
 */
function crearEnlace(bytesPorSegundo) {
  let libreDesde = 0;
  return async (bytes) => {
    if (!bytesPorSegundo) {
      return;
    }
    const momento = performance.now();
    libreDesde = Math.max(momento, libreDesde) + (bytes * MS_POR_SEGUNDO) / bytesPorSegundo;
    await esperar(libreDesde - momento);
  };
}

/** Si el navegador ha cortado la respuesta: en HTTP/2 lo dice su stream (la respuesta de Node no tiene `destroyed`). */
const cortada = (res) => Boolean(res.destroyed || res.stream?.destroyed);

/** Se cumple cuando la conexión admite más datos o se cierra (enseguida si ya está cortada); retira sus dos oyentes. */
function seVacia(res) {
  if (cortada(res)) {
    return Promise.resolve();
  }
  return new Promise((ok) => {
    const listo = () => {
      res.off('drain', listo);
      res.off('close', listo);
      ok();
    };
    res.on('drain', listo);
    res.on('close', listo);
  });
}

/**
 * Envía el cuerpo por el enlace, trozo a trozo y respetando el ritmo de la conexión. Falso si el navegador corta: desde
 * el corte no pide más turnos ni escribe más trozos. En `envio` cuenta los turnos pedidos y los bytes escritos.
 */
async function enviar(res, cuerpo, turno, envio) {
  for (let desde = 0; desde < cuerpo.length; desde += TROZO) {
    if (cortada(res)) {
      return false;
    }
    const trozo = cuerpo.subarray(desde, desde + TROZO);
    envio.anotar('turnos', 1);
    await turno(trozo.length);
    if (cortada(res)) {
      return false;
    }
    envio.anotar('bytes', trozo.length);
    if (!res.write(trozo)) {
      await seVacia(res);
    }
  }
  if (cortada(res)) {
    return false;
  }
  res.end();
  return true;
}

/**
 * Lo enviado de una respuesta: turnos del enlace pedidos y bytes escritos, en total y después de que se cerrara (que
 * en una respuesta cortada tiene que ser cero).
 */
function cuentaDelEnvio(res) {
  const envio = { turnos: 0, bytes: 0, turnosTrasElCierre: 0, bytesTrasElCierre: 0 };
  let cerrada = false;
  res.once('close', () => {
    cerrada = true;
  });
  return {
    envio,
    anotar(campo, cantidad) {
      envio[campo] += cantidad;
      if (cerrada) {
        envio[`${campo}TrasElCierre`] += cantidad;
      }
    },
  };
}

/** Lee el cuerpo de una petición entrante (las de estos escenarios son casi todas GET, sin cuerpo). */
async function leerCuerpo(req) {
  const partes = [];
  for await (const parte of req) {
    partes.push(parte);
  }
  return Buffer.concat(partes);
}

/**
 * Pasa la petición al servidor de arriba como si llegara directa: su anfitrión, su origen y el agente de usuario que el
 * fixture exige (la identidad del proyecto; el navegador puede haber llegado con la móvil, que se anota aparte).
 */
function reenviar({ req, cuerpo, arriba, propio, agente }) {
  const cabeceras = {};
  for (const [nombre, valor] of Object.entries(req.headers)) {
    if (!nombre.startsWith(':') && !DE_CONEXION.has(nombre)) {
      cabeceras[nombre] = ['origin', 'referer'].includes(nombre) ? String(valor).replace(propio, arriba.origin) : valor;
    }
  }
  cabeceras.host = arriba.host;
  cabeceras['user-agent'] = IDENTIDAD_WEB['User-Agent'];
  return new Promise((ok, fallo) => {
    const salida = pedirHttp(
      {
        host: arriba.hostname,
        port: arriba.port,
        path: req.url,
        method: req.method,
        headers: cabeceras,
        agent: agente,
      },
      async (respuesta) => {
        try {
          ok({ estado: respuesta.statusCode ?? 0, cabeceras: respuesta.headers, cuerpo: await leerCuerpo(respuesta) });
        } catch (error) {
          fallo(error);
        }
      },
    );
    salida.once('error', fallo);
    salida.end(cuerpo);
  });
}

/** Las cabeceras de la respuesta para el navegador: sin las de conexión, con su longitud y el origen propio. */
function cabecerasDeSalida(cabeceras, { arriba, propio, codificacion, longitud }) {
  const salida = {};
  for (const [nombre, valor] of Object.entries(cabeceras)) {
    if (!DE_CONEXION.has(nombre) && nombre !== 'content-length') {
      salida[nombre] = nombre === 'location' ? String(valor).replace(arriba.origin, propio) : valor;
    }
  }
  if (codificacion) {
    salida['content-encoding'] = codificacion;
    salida.vary = salida.vary ? `${salida.vary}, accept-encoding` : 'accept-encoding';
  }
  salida['content-length'] = String(longitud);
  return salida;
}

/** El cuerpo que sale: comprimido si su tipo lo admite, el navegador lo acepta y no llegaba ya comprimido. */
async function cuerpoDeSalida(req, respuesta, huella) {
  const tipo = String(respuesta.cabeceras['content-type'] ?? '');
  const codificacion = elegirCodificacion(req.headers['accept-encoding']);
  const yaComprimido = Boolean(respuesta.cabeceras['content-encoding']);
  if (req.method === 'HEAD' || !codificacion || yaComprimido || !COMPRIMIBLE.test(tipo) || !respuesta.cuerpo.length) {
    return { cuerpo: respuesta.cuerpo, codificacion: null, tipo };
  }
  return { cuerpo: await comprimir(respuesta.cuerpo, codificacion, huella), codificacion, tipo };
}

/** Atiende una petición: la reenvía, la comprime, espera la latencia y la envía por el enlace, anotándolo todo. */
async function atender(req, res, estado) {
  const { condicion, arriba, propio, registro, agente, identidad, turno } = estado;
  const entrada = {
    ruta: new URL(req.url, propio).pathname,
    metodo: req.method,
    destino: req.headers['sec-fetch-dest'] ?? null,
    protocolo: req.httpVersion,
    identidadEsperada: req.headers['user-agent'] === identidad['User-Agent'],
    aceptada: req.headers['accept-encoding'] ?? null,
    llegada: ahora(),
  };
  registro.push(entrada);
  estado.enCurso += 1;
  try {
    const respuesta = await reenviar({ req, cuerpo: await leerCuerpo(req), arriba, propio, agente });
    // La huella del contenido sin comprimir: dos direcciones con la misma huella sirven los mismos bytes.
    entrada.huella = createHash('sha256').update(respuesta.cuerpo).digest('hex');
    const { cuerpo, codificacion, tipo } = await cuerpoDeSalida(req, respuesta, entrada.huella);
    Object.assign(entrada, { estado: respuesta.estado, tipo, codificacion, sinComprimir: respuesta.cuerpo.length });
    // El tamaño de la respuesta tal como sale (comprimida o no): mide la compresión. Lo servido es lo escrito de verdad.
    entrada.tamano = req.method === 'HEAD' ? 0 : cuerpo.length;
    await esperar(condicion.latenciaMs);
    const salida = cabecerasDeSalida(respuesta.cabeceras, { arriba, propio, codificacion, longitud: entrada.tamano });
    res.writeHead(respuesta.estado, salida);
    const cuenta = cuentaDelEnvio(res);
    entrada.envio = cuenta.envio;
    entrada.completa = await enviar(res, req.method === 'HEAD' ? Buffer.alloc(0) : cuerpo, turno, cuenta);
  } finally {
    // Una respuesta cortada solo suma los bytes que llegó a escribir, y una que no empezó a enviarse, ninguno.
    entrada.servidos = entrada.envio?.bytes ?? 0;
    entrada.fin = ahora();
    estado.enCurso -= 1;
    estado.ultima = entrada.fin;
  }
}

/** Espera a que no quede ninguna respuesta en curso y no llegue ninguna nueva durante `silencioMs`, hasta `plazoMs`. */
async function esperarCalma(estado, silencioMs, plazoMs) {
  const limite = ahora() + plazoMs;
  const sondeo = Math.min(silencioMs, SONDEO_DE_CALMA_MS);
  while (ahora() < limite) {
    if (estado.enCurso === 0 && ahora() - estado.ultima >= silencioMs) {
      return true;
    }
    await esperar(sondeo);
  }
  return false;
}

/**
 * El servidor del ensayo delante de `origenDeArriba` (HTTP en loopback), con la red de `condicion` y la identidad que
 * debe traer el navegador. Devuelve su origen HTTPS, el registro de peticiones y sus errores.
 */
export async function crearServidorDelEnsayo({ origenDeArriba, condicion, identidad, bytesPorSegundo }) {
  const estado = {
    condicion,
    identidad,
    arriba: new URL(origenDeArriba),
    propio: '',
    registro: [],
    errores: [],
    agente: new Agent({ keepAlive: true }),
    turno: crearEnlace(bytesPorSegundo),
    enCurso: 0,
    ultima: ahora(),
  };
  const sesiones = new Set();
  const servidor = createSecureServer({ ...TLS, allowHTTP1: true }, (req, res) => {
    void atender(req, res, estado).catch((error) => {
      estado.errores.push(String(error));
      if (!res.headersSent) {
        res.writeHead(ESTADO_HTTP.pasarelaIncorrecta);
      }
      res.end();
    });
  });
  servidor.on('session', (sesion) => sesiones.add(sesion));
  servidor.on('secureConnection', (conexion) => sesiones.add(conexion));
  await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
  estado.propio = `https://127.0.0.1:${servidor.address().port}`;
  return {
    origen: estado.propio,
    registro: estado.registro,
    errores: estado.errores,
    enCurso: () => estado.enCurso,
    esperarCalma: (silencioMs, plazoMs) => esperarCalma(estado, silencioMs, plazoMs),
    async cerrar() {
      estado.agente.destroy();
      const cerrado = new Promise((ok) => servidor.close(() => ok()));
      for (const sesion of sesiones) {
        sesion.destroy();
      }
      await cerrado;
    },
  };
}

/**
 * Las variables del Worker oficial en el ensayo, todas sintéticas: las tres claves del portal (válidas en forma, sin
 * ningún valor real) para que responda la pantalla de acceso. Sin sesión no se consulta la autoridad durable.
 */
export const ENTORNO_SINTETICO_DEL_OFICIAL = Object.freeze({
  FARO_CLAVE_GENERAL: 'clave-general-sintetica-del-ensayo',
  FARO_SESION_PORTAL: 'firma-portal-sintetica-del-ensayo-de-mas-de-32-bytes',
  FARO_LIMITE_PORTAL: 'limite-portal-sintetico-del-ensayo-de-mas-de-32-bytes',
});

/** Las rutas que el Worker oficial responde antes de la sesión y cuya respuesta se coteja (portada y acceso). */
export const RUTAS_DEL_OFICIAL = Object.freeze(['/', '/acceso-web']);

/** El enlace ASSETS del Worker oficial sobre la web de su construcción (`oficial` de servible()): sus mismos bytes. */
export function assetsDelArtefacto({ fichas, leer }) {
  return {
    fetch: async (peticion) => {
      const ruta = `web${new URL(peticion.url).pathname}`;
      return fichas.has(ruta) ? new Response(leer(ruta)) : new Response(null, { status: ESTADO_HTTP.noEncontrado });
    },
  };
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Lo que responde `worker` a una navegación a cada ruta de RUTAS_DEL_OFICIAL: su estado y la huella de su cuerpo. */
async function respuestasDe(worker, assets) {
  const respuestas = {};
  for (const ruta of RUTAS_DEL_OFICIAL) {
    const peticion = new Request(`https://127.0.0.1${ruta}`, {
      headers: { accept: 'text/html', 'sec-fetch-dest': 'document', 'sec-fetch-mode': 'navigate' },
    });
    const respuesta = await worker.default.fetch(peticion, { ...ENTORNO_SINTETICO_DEL_OFICIAL, ASSETS: assets });
    respuestas[ruta] = { estado: respuesta.status, sha256: sha256(Buffer.from(await respuesta.arrayBuffer())) };
  }
  return respuestas;
}

/** Cómo se nombran, en los fallos, el Worker comprobado y la construcción de la que tiene que salir. */
const QUIEN = Object.freeze({
  oficial: { worker: 'Worker oficial', de: 'del artefacto medido', desde: 'desde el artefacto medido' },
  privado: { worker: 'Worker privado', de: 'de su construcción', desde: 'desde su construcción' },
});

/**
 * Comprueba que el Worker servido (`servido`: su módulo y la ruta de la que sale) es el worker/worker.mjs de la
 * construcción `medido` (el `oficial` o el `privado` de servible()), y no el de la fuente del arnés ni el de otra
 * construcción: la ruta, los bytes frente a la huella que consta en el artefacto.json de esa construcción, ese
 * artefacto.json frente al que se cargó y el mismo módulo cargado. Devuelve la huella de sus bytes; si algo no
 * cuadra, falla diciendo qué.
 */
function comprobarWorkerDe(destino, servido, medido) {
  const { worker, de, desde } = QUIEN[destino];
  const rutaEsperada = join(medido.carpeta, 'worker/worker.mjs');
  if (servido.ruta !== rutaEsperada) {
    throw new Error(`El ${worker} servido (${servido.ruta}) no es el ${de} (${rutaEsperada})`);
  }
  const descriptor = readFileSync(join(medido.carpeta, 'artefacto.json'));
  if (sha256(descriptor) !== medido.sha256Artefacto) {
    throw new Error(`El artefacto.json de ${medido.carpeta} ha cambiado desde que se cargó`);
  }
  const ficha = JSON.parse(descriptor.toString('utf8')).archivos.find((a) => a.ruta === 'worker/worker.mjs');
  const huella = sha256(readFileSync(servido.ruta));
  if (!ficha || huella !== ficha.sha256 || huella !== medido.sha256) {
    throw new Error(`El ${worker} servido (${huella}) no coincide con el de su artefacto.json (${ficha?.sha256})`);
  }
  if (servido.worker !== medido.worker) {
    throw new Error(`El módulo del ${worker} servido no es el cargado ${desde}`);
  }
  return huella;
}

/**
 * Comprueba que el Worker que va a servir la portada y el acceso (`servido`) es el worker/worker.mjs del artefacto
 * oficial medido (`medido`: el `oficial` de servible(); comprobarWorkerDe). Después, la portada y el acceso tienen que
 * responder 200, y la huella de cada cuerpo queda en el registro: lo que reciba el navegador se coteja con ella al
 * terminar la medida (comprobarMedida de presupuesto-ejecucion.mjs). Devuelve el registro de lo que sirve cada
 * escenario oficial, comprobado; si algo no cuadra, falla diciendo qué.
 */
export async function comprobarWorkerOficial(servido, medido) {
  const huella = comprobarWorkerDe('oficial', servido, medido);
  const respuestas = await respuestasDe(servido.worker, assetsDelArtefacto(medido));
  for (const ruta of RUTAS_DEL_OFICIAL) {
    if (respuestas[ruta].estado !== ESTADO_HTTP.correcto) {
      throw new Error(`${ruta}: el Worker oficial del artefacto medido responde ${respuestas[ruta].estado}, no 200`);
    }
  }
  return {
    destino: 'oficial',
    worker: { ruta: servido.ruta, sha256: huella },
    artefacto: { carpeta: medido.carpeta, sha256: medido.sha256Artefacto },
    respuestas,
    comprobado: true,
  };
}

/**
 * Comprueba que el Worker con que el fixture sirve la web de una construcción (servible(): el de `artefacto`) es el
 * worker/worker.mjs de su Worker privado (`privado`; comprobarWorkerDe). Devuelve el registro de lo que sirve cada
 * escenario privado, comprobado; si algo no cuadra, falla diciendo qué.
 */
export function comprobarWorkerPrivado(construccion) {
  const { artefacto, privado } = construccion;
  if (!privado) {
    throw new Error('La construcción no dice qué Worker privado sirve su web');
  }
  const huella = comprobarWorkerDe('privado', { ruta: privado.ruta, worker: artefacto.worker }, privado);
  return {
    destino: 'privado',
    worker: { ruta: privado.ruta, sha256: huella },
    artefacto: { carpeta: privado.carpeta, sha256: privado.sha256Artefacto },
    web: { carpeta: artefacto.directorio },
    comprobado: true,
  };
}

/**
 * El servidor oficial de una construcción (servible()): su propio Worker oficial, comprobado, con la web de su
 * artefacto. `servido` solo cambia en las pruebas del cotejo. Sin construcción oficial no hay portada ni acceso que
 * medir: falla, nunca sirve otro Worker en su lugar.
 */
export async function servidorOficialDe(construccion, servido = construccion?.oficial) {
  if (!construccion?.oficial) {
    throw new Error(
      'La portada y el acceso salen del Worker oficial del artefacto medido: indica una construcción de destino oficial ' +
        '(--destino-cloudflare oficial) con su --worker-privado',
    );
  }
  const procedencia = await comprobarWorkerOficial(servido, construccion.oficial);
  const servidor = await crearServidorOficial({
    worker: servido.worker,
    assets: assetsDelArtefacto(construccion.oficial),
  });
  return { ...servidor, procedencia };
}

/** Responde una petición con el Worker oficial `worker` (todas las rutas, como en el despliegue) y su enlace ASSETS. */
async function responderOficial(req, res, { worker, assets }) {
  const origen = `http://${req.headers.host}`;
  const respuesta = await worker.default.fetch(adaptarSolicitud(req, origen), {
    ...ENTORNO_SINTETICO_DEL_OFICIAL,
    ASSETS: assets,
  });
  const cuerpo = Buffer.from(await respuesta.arrayBuffer());
  res.writeHead(respuesta.status, Object.fromEntries(respuesta.headers));
  res.end(req.method === 'HEAD' ? undefined : cuerpo);
}

/**
 * Lo que sirve un Worker oficial (`worker`, el módulo con su `default.fetch`, y `assets`, su enlace ASSETS) por HTTP en
 * loopback, con las variables sintéticas: la portada, sus activos públicos y la pantalla de acceso, con sus bytes y sus
 * cabeceras (CSP incluida), y lo que responda a cualquier otra ruta sin sesión. Anota cada petición (ruta, método,
 * destino y estado, como fixture.ts) y sus errores. El presupuesto lo crea con servidorOficialDe(); descargas-js.mjs,
 * también, o con el Worker de las fuentes si mide una construcción privada.
 */
export async function crearServidorOficial({ worker, assets }) {
  const peticiones = [];
  const errores = [];
  const servidor = createServer((req, res) => {
    const peticion = {
      ruta: new URL(`http://${req.headers.host}${req.url}`).pathname,
      metodo: req.method ?? 'GET',
      destino: req.headers['sec-fetch-dest'] ?? null,
    };
    peticiones.push(peticion);
    // El estado, al terminar la respuesta, como fixture.ts: sin él, no terminó o se abortó.
    res.once('finish', () => {
      Object.assign(peticion, { estado: res.statusCode });
    });
    void responderOficial(req, res, { worker, assets }).catch((error) => {
      errores.push(String(error));
      if (!res.headersSent) {
        res.writeHead(ESTADO_HTTP.errorInterno);
      }
      res.end();
    });
  });
  await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
  return {
    origen: `http://127.0.0.1:${servidor.address().port}`,
    peticiones,
    errores,
    cerrar: () => {
      servidor.closeAllConnections();
      return new Promise((ok) => servidor.close(() => ok()));
    },
  };
}
