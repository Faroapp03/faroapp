// Límites de lectura y ventanas de peticiones en memoria. Las redes se agrupan por IPv4 o prefijo IPv6 /64.
import { MS_POR_MINUTO } from '../comun/tiempo.ts';

/** Dice si un cliente puede hacer otra petición y la cuenta si puede. */
export type Limitador = (cliente: string) => boolean | Promise<boolean>;

/** Límites de lectura de la API por red; solo se aplican cuando la plataforma identifica la IP. */
export interface Limitadores {
  readonly lecturas?: Limitador;
}

/** Personas de un aula que salen a internet por la misma IP pública; también limita el servidor MCP. */
export const PERSONAS_POR_AULA = 30;
/** Ventana de las peticiones por red: diez minutos. */
export const VENTANA_LIMITADOR_MS = 10 * MS_POR_MINUTO;
/** Máximo por cliente cuando no se proporciona un límite específico. */
const PETICIONES_POR_DEFECTO = 60;
/** Lecturas por red en cada ventana; conserva el límite operativo vigente. */
const MAX_LECTURAS_POR_RED = 1800;
/** Grupos de una dirección IPv6 completa y los que forman su prefijo /64, el que se asigna a un solo cliente. */
const GRUPOS_IPV6 = 8;
const GRUPOS_PREFIJO = 4;
/** La base en que se escriben los grupos de una IPv6. */
const BASE_HEXADECIMAL = 16;
/**
 * Clientes distintos que recuerda cada limitador entre dos barridos. Un aula usa unas decenas; el tope solo frena a
 * quien estrena una clave por petición (rotando prefijos IPv6) para llenar la memoria de la instancia. Lleno incluso
 * tras barrer, el limitador rechaza a los clientes nuevos (falla cerrado) y sigue atendiendo a los que ya conoce.
 * Los barridos que fuerza un cliente nuevo están acotados por BARRIDOS_FORZADOS_POR_VENTANA.
 */
const MAX_CLIENTES_POR_LIMITADOR = 20_000;
/**
 * Con la memoria llena, cada barrido recorre todos los clientes recordados. Un cliente nuevo solo puede forzarlo diez
 * veces por ventana (una cada décima parte); entre tanto se le rechaza sin recorrer nada, para que rotar claves no
 * convierta cada petición en un recorrido completo.
 */
export const BARRIDOS_FORZADOS_POR_VENTANA = 10;
/** Un grupo de una IPv6: de una a cuatro cifras hexadecimales. */
const GRUPO_IPV6 = /^[0-9a-f]{1,4}$/;
/** Una IPv4 en notación decimal al final de una IPv6. */
const FINAL_IPV4 = /^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/;
/** Bits de un octeto, para separar cada grupo hexadecimal en sus dos octetos. */
const BITS_POR_OCTETO = 8;
const OCTETO = 0xff;
/** Los cinco grupos cero y el marcador que preceden a los dos grupos de una IPv4 mapeada. */
const GRUPOS_CERO_IPV4_MAPEADA = 5;
const MARCADOR_IPV4_MAPEADA = 0xffff;
const INICIO_IPV4_MAPEADA = GRUPOS_CERO_IPV4_MAPEADA + 1;

/**
 * Los ocho grupos de una IPv6, con «::» desplegado.
 *
 * @param direccion - La dirección en minúsculas, sin zona («%eth0»).
 * @returns Los grupos, o null si no tiene la forma de una IPv6.
 */
function gruposIpv6(direccion: string): string[] | null {
  const partes = direccion.split('::');
  if (partes.length > 2) {
    return null;
  }
  const [inicio = [], final = null] = partes.map((parte) => (parte ? parte.split(':') : []));
  const ceros = final === null ? 0 : GRUPOS_IPV6 - inicio.length - final.length;
  if (final !== null && ceros < 1) {
    return null;
  }
  const grupos = [...inicio, ...Array<string>(ceros).fill('0'), ...(final ?? [])];
  if (grupos.length !== GRUPOS_IPV6 || !grupos.every((grupo) => GRUPO_IPV6.test(grupo))) {
    return null;
  }
  return grupos;
}

/**
 * La red de una dirección, que es la clave del tope grueso: la IPv4 entera, o el prefijo /64 de una IPv6, porque un
 * solo cliente recibe un /64 entero y estrenaría una dirección por petición.
 *
 * @param ip - La dirección del cliente, tal como la da la plataforma.
 * @returns La IPv4, el prefijo «a:b:c:d::/64» o, si no se reconoce, la dirección tal cual.
 */
export function claveDeRed(ip: string): string {
  const direccion = ip.trim().toLowerCase().split('%')[0] ?? '';
  if (!direccion.includes(':')) {
    return direccion;
  }
  // La notación mixta sustituye los dos últimos grupos hexadecimales por cuatro octetos decimales.
  const finalIpv4 = direccion.match(FINAL_IPV4);
  let paraGrupos = direccion;
  if (finalIpv4) {
    const octetos = (finalIpv4[2] ?? '').split('.').map(Number);
    if (octetos.some((octeto) => octeto > OCTETO)) {
      return direccion;
    }
    const [a = 0, b = 0, c = 0, d = 0] = octetos;
    paraGrupos = `${finalIpv4[1]}${((a << BITS_POR_OCTETO) | b).toString(BASE_HEXADECIMAL)}:${((c << BITS_POR_OCTETO) | d).toString(BASE_HEXADECIMAL)}`;
  }
  const grupos = gruposIpv6(paraGrupos);
  if (!grupos) {
    return direccion;
  }
  const numeros = grupos.map((grupo) => Number.parseInt(grupo, BASE_HEXADECIMAL));
  if (
    numeros.slice(0, GRUPOS_CERO_IPV4_MAPEADA).every((grupo) => grupo === 0) &&
    numeros[GRUPOS_CERO_IPV4_MAPEADA] === MARCADOR_IPV4_MAPEADA
  ) {
    return numeros
      .slice(INICIO_IPV4_MAPEADA)
      .flatMap((grupo) => [grupo >>> BITS_POR_OCTETO, grupo & OCTETO])
      .join('.');
  }
  const prefijo = grupos
    .slice(0, GRUPOS_PREFIJO)
    .map((grupo) => Number.parseInt(grupo, BASE_HEXADECIMAL).toString(BASE_HEXADECIMAL));
  return `${prefijo.join(':')}::/64`;
}

/**
 * Crea un limitador en memoria de ventana deslizante: como mucho `max` peticiones por cliente cada `ventanaMs`, y como
 * mucho `maxClientes` clientes recordados a la vez.
 *
 * @param max - Peticiones admitidas por cliente en cada ventana.
 * @param ventanaMs - La ventana, en milisegundos: finita y mayor que cero.
 * @param ahora - El reloj, en milisegundos de época.
 * @param maxClientes - Clientes distintos que caben en memoria; lleno tras barrer, se rechaza a los nuevos.
 * @returns El limitador: dice si la petición puede seguir y, si puede, la cuenta.
 * @throws {RangeError} Si la ventana no es finita y positiva: cero o NaN descartarían todas las marcas.
 */
export function crearLimitador(
  max: number = PETICIONES_POR_DEFECTO,
  ventanaMs: number = VENTANA_LIMITADOR_MS,
  ahora: () => number = () => Date.now(),
  maxClientes: number = MAX_CLIENTES_POR_LIMITADOR,
): Limitador {
  if (!Number.isFinite(ventanaMs) || ventanaMs <= 0) {
    throw new RangeError('La ventana del limitador debe ser finita y mayor que cero.');
  }
  // Para cada cliente, los instantes de sus peticiones admitidas dentro de la ventana.
  const marcasPorCliente = new Map<string, number[]>();
  let ultimoBarrido = ahora();
  let ultimoBarridoForzado = Number.NEGATIVE_INFINITY;
  // Olvida a los clientes sin peticiones recientes, para que sus IP no se queden en memoria.
  const barrer = (instante: number): void => {
    for (const [cliente, marcas] of marcasPorCliente) {
      if (!marcas.some((marca) => instante - marca < ventanaMs)) {
        marcasPorCliente.delete(cliente);
      }
    }
    ultimoBarrido = instante;
  };
  // Con la memoria llena, un cliente nuevo solo entra si un barrido libera hueco, y solo puede forzar uno por fracción
  // de ventana.
  const cabeOtroCliente = (instante: number): boolean => {
    if (marcasPorCliente.size < maxClientes) {
      return true;
    }
    if (instante - ultimoBarridoForzado < ventanaMs / BARRIDOS_FORZADOS_POR_VENTANA) {
      return false;
    }
    ultimoBarridoForzado = instante;
    barrer(instante);
    return marcasPorCliente.size < maxClientes;
  };
  return (cliente) => {
    const instante = ahora();
    if (instante - ultimoBarrido >= ventanaMs) {
      barrer(instante);
    }
    if (!(marcasPorCliente.has(cliente) || cabeOtroCliente(instante))) {
      return false;
    }
    const recientes = (marcasPorCliente.get(cliente) ?? []).filter((marca) => instante - marca < ventanaMs);
    const admitida = recientes.length < max;
    if (admitida) {
      recientes.push(instante);
    }
    marcasPorCliente.set(cliente, recientes);
    return admitida;
  };
}

/** Los límites de lectura de la API, en memoria y con su ventana. */
export function crearLimitadores(ahora: () => number = () => Date.now()): Required<Limitadores> {
  return { lecturas: crearLimitador(MAX_LECTURAS_POR_RED, VENTANA_LIMITADOR_MS, ahora) };
}
