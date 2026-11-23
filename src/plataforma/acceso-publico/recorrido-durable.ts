import { leerModo } from '../../administracion/recorrido.ts';
import { leerAccesoSesionPanel } from '../../administracion/sesion.ts';
import {
  type DecisionDelLimite,
  type IdentificadoresLimite,
  VERSION_CONTRATO_LIMITE,
} from './limite-continuo-sqlite.ts';
import type { AlmacenSesionRecorridoSqlite } from './sesion-recorrido-sqlite.ts';

export function esRutaRecorridoDurable(ruta: string): boolean {
  return [
    '/privado/intento',
    '/recorrido/leer',
    '/recorrido/leer-sesion',
    '/recorrido/cambiar-sesion',
    '/recorrido/intento',
  ].includes(ruta);
}

/**
 * La decisión del límite en el mensaje de vuelta. La saturación lleva su propia clave: un Worker anterior, que solo lee
 * `permitido`, la toma por una respuesta que no entiende y responde 503 en vez de un «demasiados intentos» falso.
 */
function respuestaDeLaDecision(decision: DecisionDelLimite) {
  return decision === 'saturado' ? { saturado: true } : { permitido: decision };
}

async function operarIntento(
  almacen: AlmacenSesionRecorridoSqlite,
  cuerpo: Record<string, unknown>,
  claves: string,
): Promise<unknown> {
  if (claves === 'clave' && typeof cuerpo.clave === 'string') {
    return { permitido: await almacen.consumirIntentoRecorridoAntiguo(cuerpo.clave) };
  }
  if (
    claves === 'clave,espejo,version' &&
    cuerpo.espejo === true &&
    cuerpo.version === VERSION_CONTRATO_LIMITE &&
    cuerpo.clave !== null &&
    typeof cuerpo.clave === 'object' &&
    !Array.isArray(cuerpo.clave)
  ) {
    return respuestaDeLaDecision(
      await almacen.consumirIntentoRecorridoConEspejo(cuerpo.clave as IdentificadoresLimite),
    );
  }
  if (
    claves === 'clave,version' &&
    cuerpo.version === VERSION_CONTRATO_LIMITE &&
    cuerpo.clave !== null &&
    typeof cuerpo.clave === 'object' &&
    !Array.isArray(cuerpo.clave)
  ) {
    return respuestaDeLaDecision(await almacen.consumirIntentoRecorrido(cuerpo.clave as IdentificadoresLimite));
  }
  return undefined;
}

export async function operarRecorridoDurable(
  almacen: AlmacenSesionRecorridoSqlite,
  ruta: string,
  entrada: unknown,
): Promise<unknown> {
  if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) {
    return undefined;
  }
  const cuerpo = entrada as Record<string, unknown>;
  const claves = Object.keys(cuerpo).sort().join(',');
  if (
    ruta === '/privado/intento' &&
    claves === 'clave,valido,version' &&
    cuerpo.version === VERSION_CONTRATO_LIMITE &&
    typeof cuerpo.valido === 'boolean' &&
    cuerpo.clave !== null &&
    typeof cuerpo.clave === 'object' &&
    !Array.isArray(cuerpo.clave)
  ) {
    return { permitido: await almacen.decidirIntentoPrivado(cuerpo.clave as IdentificadoresLimite, cuerpo.valido) };
  }
  if (ruta === '/recorrido/leer' && claves === '') {
    return { recorrido: await almacen.leerRecorrido() };
  }
  if (ruta === '/recorrido/intento') {
    return operarIntento(almacen, cuerpo, claves);
  }
  if (ruta === '/recorrido/leer-sesion' && claves === 'acceso') {
    return almacen.leerRecorridoDeSesion(leerAccesoSesionPanel(cuerpo.acceso));
  }
  if (
    ruta === '/recorrido/cambiar-sesion' &&
    claves === 'acceso,modo,revisionEsperada' &&
    typeof cuerpo.revisionEsperada === 'number'
  ) {
    return almacen.cambiarRecorridoDeSesion(
      leerAccesoSesionPanel(cuerpo.acceso),
      cuerpo.revisionEsperada,
      leerModo(cuerpo.modo),
    );
  }
  return undefined;
}
