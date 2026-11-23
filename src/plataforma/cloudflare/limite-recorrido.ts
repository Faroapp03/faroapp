/**
 * Identificadores del límite de intentos: HMAC, con una clave del servidor, de la IP (en IPv6, de su red /64) y del
 * periodo; nunca se conserva la dirección. La huella cambia cada periodo, pero quien tenga la clave puede recalcularla
 * para cualquier dirección y periodo: es un seudónimo rotatorio, no un dato anónimo.
 */
import { type IdentificadoresLimite, VENTANA_MS } from '../acceso-publico/limite-continuo-sqlite.ts';

/**
 * Periodo de la huella: igual que la ventana del límite. El Worker elige el periodo con su reloj y el objeto mide la
 * ventana con el suyo. Con un solo reloj bastaría leer el periodo actual y el anterior; se leen también el siguiente y
 * el de antes del anterior, y así ningún intento de la ventana queda fuera mientras el desfase entre los relojes de dos
 * Workers, medido frente al del objeto, sea menor que un periodo. Leer de más no cuenta de más: la ventana solo suma las
 * marcas de su cuarto de hora. Un periodo más largo solo alargaría el tiempo en que la misma huella identifica a la
 * misma red.
 */
const PERIODO_HUELLA_MS = VENTANA_MS;

const MIN_CLAVE_BYTES = 32;
const LONGITUD_IP_MAXIMA = 45;
const PARTES_IPV4 = 4;
const GRUPOS_IPV6 = 8;
const GRUPOS_RED_IPV6 = 4;
const GRUPOS_PREFIJO_IPV6 = 3;
const OCTETOS_PREFIJO_IPV4 = 3;
const OCTETO_MAXIMO = 255;
const BASE_HEXADECIMAL = 16;
function ipValida(ip: string): boolean {
  if (!ip || ip.length > LONGITUD_IP_MAXIMA || /[^0-9a-f:.]/i.test(ip)) {
    return false;
  }
  if (ip.includes(':')) {
    try {
      return new URL(`http://[${ip}]/`).hostname.startsWith('[');
    } catch (error) {
      // Una dirección IPv6 mal escrita no forma una URL (TypeError) y no vale.
      if (!(error instanceof TypeError)) {
        throw error;
      }
      return false;
    }
  }
  const partes = ip.split('.');
  return (
    partes.length === PARTES_IPV4 &&
    partes.every((parte) => /^(0|[1-9]\d{0,2})$/.test(parte) && Number(parte) <= OCTETO_MAXIMO)
  );
}
/** Dirección y clave ya comprobadas; cualquier otra entrada deja el límite fuera de servicio. */
function entrada(peticion: Request, secreto: unknown, ahora: number): { ip: string; clave: string } {
  const ip = peticion.headers.get('cf-connecting-ip') ?? '';
  if (
    !ipValida(ip) ||
    typeof secreto !== 'string' ||
    new TextEncoder().encode(secreto).length < MIN_CLAVE_BYTES ||
    !Number.isSafeInteger(ahora) ||
    ahora < 0
  ) {
    throw new Error('Límite de recorrido no disponible');
  }
  return { ip, clave: secreto };
}

async function firmar(secreto: string, mensaje: string): Promise<string> {
  const encoder = new TextEncoder();
  const firma = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secreto),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', firma, encoder.encode(mensaje)));
  return Array.from(bytes, (byte) => byte.toString(BASE_HEXADECIMAL).padStart(2, '0')).join('');
}

/** Huella de la versión 1, por dirección y ventana fija: los intentos se anotan también con ella, en espejo. */
export async function huellaLimiteRecorrido(peticion: Request, secreto: unknown, ahora = Date.now()): Promise<string> {
  const { ip, clave } = entrada(peticion, secreto, ahora);
  return firmar(clave, `faro/limite-recorrido/v1:${Math.floor(ahora / VENTANA_MS)}:${ip}`);
}

/** La cuota IPv6 agrupa la red /64; la dirección original solo vive en esta petición. */
function redDeIp(ip: string): string {
  if (!ip.includes(':')) {
    return ip;
  }
  const canonical = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
  if (canonical.startsWith('::ffff:')) {
    const partes = canonical.slice('::ffff:'.length).split(':');
    if (partes.length !== 2) {
      throw new Error('Dirección no válida');
    }
    const alta = Number.parseInt(partes[0] ?? '', BASE_HEXADECIMAL);
    const baja = Number.parseInt(partes[1] ?? '', BASE_HEXADECIMAL);
    return [alta >>> 8, alta & 255, baja >>> 8, baja & 255].join('.');
  }
  const mitades = canonical.split('::');
  const izquierda = mitades[0] ? mitades[0].split(':') : [];
  const derecha = mitades[1] ? mitades[1].split(':') : [];
  const ceros = mitades.length === 2 ? Array(GRUPOS_IPV6 - izquierda.length - derecha.length).fill('0') : [];
  const grupos = [...izquierda, ...ceros, ...derecha];
  if (grupos.length !== GRUPOS_IPV6) {
    throw new Error('Dirección no válida');
  }
  return `${grupos
    .slice(0, GRUPOS_RED_IPV6)
    .map((grupo) => grupo.padStart(GRUPOS_RED_IPV6, '0'))
    .join(':')}::/64`;
}

/**
 * El prefijo ancho de una red ya agrupada (redDeIp): el /48 en IPv6 y el /24 en IPv4, la unidad que suele recibir un
 * mismo cliente o una misma organización. Solo cuenta intentos cuando la tabla del límite está llena.
 */
function prefijoDeRed(red: string): string {
  if (red.endsWith('::/64')) {
    return `${red.split(':').slice(0, GRUPOS_PREFIJO_IPV6).join(':')}::/48`;
  }
  return `${red.split('.').slice(0, OCTETOS_PREFIJO_IPV4).join('.')}.0/24`;
}

/** Periodos vecinos que también se leen, relativos al actual: el anterior, el siguiente y el de antes del anterior. */
const VECINOS = [-1, 1, -2];

/** Huellas por red de la versión 3: la del periodo actual y las de los vecinos que existan. */
export async function huellasPorPeriodo(
  peticion: Request,
  secreto: unknown,
  ahora = Date.now(),
  alcance: 'red' | 'prefijo' = 'red',
) {
  const { ip, clave } = entrada(peticion, secreto, ahora);
  const red = alcance === 'red' ? redDeIp(ip) : prefijoDeRed(redDeIp(ip));
  const periodo = Math.floor(ahora / PERIODO_HUELLA_MS);
  const proposito = alcance === 'red' ? 'v3' : 'v3-prefijo';
  const huella = (n: number) => firmar(clave, `faro/limite-recorrido/${proposito}:${n}:${red}`);
  return {
    actual: await huella(periodo),
    vecinas: await Promise.all(
      VECINOS.map((desvio) => periodo + desvio)
        .filter((n) => n >= 0)
        .map(huella),
    ),
  };
}

/**
 * Huella estable de la versión 2, sin periodo. Ya no se escribe: solo se lee para contar las filas que dejó la versión
 * anterior, que caducan como mucho un cuarto de hora después de su último intento.
 */
export async function huellaEstableV2(peticion: Request, secreto: unknown): Promise<string> {
  const { ip, clave } = entrada(peticion, secreto, 0);
  return firmar(clave, `faro/limite-recorrido/v2:${redDeIp(ip)}`);
}

/**
 * Se escribe solo la huella del periodo actual. Cuentan además las de los periodos vecinos y la estable de la versión 2
 * (en la misma tabla) y las dos de la versión 1 (en su tabla antigua). Las del prefijo solo cuentan con la tabla llena.
 */
export async function identificadoresLimiteRecorrido(
  peticion: Request,
  secreto: unknown,
  ahora = Date.now(),
): Promise<IdentificadoresLimite> {
  const { actual, vecinas } = await huellasPorPeriodo(peticion, secreto, ahora);
  const prefijo = await huellasPorPeriodo(peticion, secreto, ahora, 'prefijo');
  const estable = await huellaEstableV2(peticion, secreto);
  const v1 = await huellaLimiteRecorrido(peticion, secreto, ahora);
  const v1Anterior = ahora >= VENTANA_MS ? await huellaLimiteRecorrido(peticion, secreto, ahora - VENTANA_MS) : null;
  return {
    clave: actual,
    recientes: [...vecinas, estable],
    anteriores: v1Anterior ? [v1, v1Anterior] : [v1],
    prefijo: { clave: prefijo.actual, recientes: prefijo.vecinas },
  };
}
