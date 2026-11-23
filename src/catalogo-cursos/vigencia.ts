// Los instantes conservan microsegundos: redondearlos puede ofrecer una acción
// después de su límite publicado. Las fechas y el resultado del evaluador nunca se reescriben.
import { CatalogoNoValido, type OfertaCatalogo } from './contrato.ts';

const UTC = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?(Z|\+00:00)$/u;
const MICROS_POR_MILI = 1_000n;
const MICROS_POR_SEGUNDO = 1_000_000n;
const MILIS_POR_SEGUNDO = 1_000;
const CIFRAS_MICROS = 6;
const LARGO_SEGUNDOS = 19;

/** Lee el mismo dominio UTC del evaluador Python, sin normalizar días inválidos. */
export function instanteCatalogo(texto: string): bigint {
  const partes = UTC.exec(texto);
  if (!partes || texto.startsWith('0000')) {
    throw new CatalogoNoValido('Instante UTC del catálogo no válido');
  }
  const segundos = `${partes[1]}:${partes[2] ?? '00'}Z`;
  const milis = Date.parse(segundos);
  if (!Number.isFinite(milis) || new Date(milis).toISOString().slice(0, LARGO_SEGUNDOS) !== segundos.slice(0, -1)) {
    throw new CatalogoNoValido('Fecha del catálogo no válida');
  }
  return BigInt(milis / MILIS_POR_SEGUNDO) * MICROS_POR_SEGUNDO + BigInt((partes[3] ?? '').padEnd(CIFRAS_MICROS, '0'));
}

/** El reloj lo aporta la plataforma, nunca un parámetro de la consulta pública. */
export function relojCatalogo(milisegundos: number): bigint {
  if (
    !Number.isSafeInteger(milisegundos) ||
    milisegundos < Date.parse('0001-01-01T00:00:00Z') ||
    milisegundos > Date.parse('9999-12-31T23:59:59Z') + MILIS_POR_SEGUNDO - 1
  ) {
    throw new CatalogoNoValido('Reloj de consulta no válido');
  }
  return BigInt(milisegundos) * MICROS_POR_MILI;
}

function antesDelLimite(oferta: OfertaCatalogo, ahora: bigint): boolean {
  return oferta.cierra_el === null || ahora < instanteCatalogo(oferta.cierra_el);
}

/**
 * Solo un límite publicado por la fuente retira la oferta. La antigüedad de la comprobación es una revisión
 * interna del productor: no retira la oferta ni resta valor a sus hechos.
 */
export function sePuedeOfrecer(oferta: OfertaCatalogo, corteProyeccion: bigint, ahora: bigint): boolean {
  const comprobado = instanteCatalogo(oferta.comprobado_el);
  const corte = instanteCatalogo(oferta.corte_evaluacion_utc);
  return comprobado <= corte && corte <= corteProyeccion && corteProyeccion <= ahora && antesDelLimite(oferta, ahora);
}

/** La misma regla para una hoja ya preparada, también sin conexión: solo la invalida el límite publicado. */
export function antesDelLimitePublicado(oferta: OfertaCatalogo, ahoraMilisegundos: number): boolean {
  return antesDelLimite(oferta, relojCatalogo(ahoraMilisegundos));
}
