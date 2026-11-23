// Lo que el esquema del registro de lecturas (registro.ts) no puede ver porque cruza unas partes con otras: ids únicos,
// temas que existen, tipos con su texto, ningún segmento vacío, enlaces publicables y que todo lo que el generador pone
// en un atributo HTML o en una clave de diccionario sin escapar es un identificador. Lo usa ../lecturas.ts antes de
// escribir nada.

import { type Lectura, type Registro, RegistroInvalido, TIPOS } from './registro.ts';

/**
 * La forma de todo lo que el registro pone dentro de un atributo o de una clave de diccionario sin escapar (el id de
 * una lectura o de un tema): letras minúsculas, cifras y guiones.
 */
const IDENTIFICADOR = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/**
 * La fuente del contenido escrito por Faro: solo él puede enlazar una página de Faro o ir sin enlace (una guía en
 * preparación).
 */
export const FUENTE_PROPIA = 'Equipo Faro';

/**
 * Si el enlace de una lectura es contenido propio de Faro: una página o una ficha PDF de Faro, o ningún enlace (una guía
 * en preparación). Lo que se publica fuera va siempre por https://.
 *
 * @param lectura - La lectura.
 * @returns Si es propia.
 */
export function esPropia(lectura: Pick<Lectura, 'enlace'>): boolean {
  return lectura.enlace === null || !lectura.enlace.startsWith('https://');
}

/** El catálogo enlaza publicaciones HTTPS, fichas PDF locales y, para el contenido del Equipo Faro, páginas de Faro. */
function enlaceAdmitido(enlace: string, delEquipo: boolean): boolean {
  if (enlace.startsWith('https://')) {
    try {
      return new URL(enlace).protocol === 'https:';
    } catch {
      return false;
    }
  }
  return /^fichas\/[a-z0-9._-]+\.pdf$/.test(enlace) || (delEquipo && /^[a-z0-9-]+\.html(?:#[a-z0-9-]+)?$/.test(enlace));
}

/** El primer enlace de una lectura que no pertenece a las rutas publicables, si existe. */
function enlaceNoAdmitido(lectura: Lectura): string | undefined {
  const delEquipo = lectura.fuente === FUENTE_PROPIA;
  return [lectura.enlace, lectura.enlace_ca].find(
    (enlace): enlace is string => enlace !== null && enlace !== undefined && !enlaceAdmitido(enlace, delEquipo),
  );
}

/**
 * Lo que una lectura necesita y no tiene, o nombra y no existe: el enlace (solo el Equipo Faro puede dejar una guía en
 * preparación) y su tema.
 *
 * @param lectura - La lectura.
 * @param registro - El registro.
 * @returns El motivo, o null si está completa.
 */
function referenciaRota(lectura: Lectura, registro: Registro): string | null {
  if (lectura.enlace === null && lectura.fuente !== FUENTE_PROPIA) {
    return `${lectura.id}: falta el enlace de la lectura`;
  }
  if (lectura.tema !== undefined && !Object.hasOwn(registro.temas, lectura.tema)) {
    return `${lectura.id}: el tema «${lectura.tema}» no está en «temas»`;
  }
  return null;
}

/**
 * Lo que le falta a un segmento (un tipo) para ser una pestaña: el nombre del tipo («Guía») y el del segmento
 * («Guías»), y alguna lectura.
 *
 * @param registro - El registro.
 * @returns El motivo, o null si los tres segmentos están completos.
 */
function segmentoIncompleto(registro: Registro): string | null {
  for (const { tipo, segmento } of TIPOS) {
    const falta = [`biblioteca.tipo.${tipo}`, `biblioteca.tipos.${tipo}`].find(
      (clave) => !Object.hasOwn(registro.textos, clave),
    );
    if (falta !== undefined) {
      return `falta el texto «${falta}»`;
    }
    if (!registro.lecturas.some((lectura) => lectura.tipo === tipo)) {
      return `el segmento «${segmento}» no tiene lecturas`;
    }
  }
  return null;
}

/**
 * Comprueba lo que el esquema del registro no puede ver: que cada lectura tiene un id único, un enlace publicable y lo
 * que necesita, que su tema existe y su tipo tiene texto, que ningún segmento (un tipo) queda vacío y que todo lo que
 * va a un atributo o a una clave sin escapar es un identificador.
 *
 * @param registro - El registro, ya con su forma validada.
 * @throws {RegistroInvalido} Con la primera referencia rota o el primer identificador que no lo es.
 */
export function comprobarReferencias(registro: Registro): void {
  const rechazo = (que: string): RegistroInvalido => new RegistroInvalido(`datos/lecturas.json: ${que}`);
  const ids = registro.lecturas.map(({ id }) => id);
  const repetido = ids.find((id, posicion) => ids.indexOf(id) !== posicion);
  if (repetido !== undefined) {
    throw rechazo(`el id «${repetido}» está repetido`);
  }
  for (const lectura of registro.lecturas) {
    const enlace = enlaceNoAdmitido(lectura);
    if (enlace !== undefined) {
      throw rechazo(`${lectura.id}: enlace no admitido «${enlace}»`);
    }
    const rota = referenciaRota(lectura, registro);
    if (rota !== null) {
      throw rechazo(rota);
    }
  }
  const segmento = segmentoIncompleto(registro);
  if (segmento !== null) {
    throw rechazo(segmento);
  }
  const identificadores = [...Object.keys(registro.temas), ...registro.lecturas.flatMap(({ id, tema }) => [id, tema])];
  const mal = identificadores.find((valor) => valor !== undefined && !IDENTIFICADOR.test(valor));
  if (mal !== undefined) {
    throw rechazo(`«${mal}» no es un identificador (letras minúsculas, cifras y guiones)`);
  }
}
