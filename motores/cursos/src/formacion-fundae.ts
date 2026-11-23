// FUNDAE: las ediciones en teleformación de la oferta estatal de formación subvencionada para personas trabajadoras
// (plataforma_datos/cursos/fuentes/fundae/lector.py), solo hechos y el enlace oficial. Cada edición es de un programa
// del catálogo del SEPE: la hoja de ruta la da como convocatoria mientras su plazo de preinscripción está abierto.
// La bolsa de cursos la enseña como una ficha más. Que el plazo esté abierto no garantiza plaza, y FUNDAE no publica
// cuándo empiezan las clases.

import type { ColectivoFundae, DatosFundae, EdicionFundae } from '../../../compartido/contratos/tipos-fundae.ts';

export type { ColectivoFundae, DatosFundae, EdicionFundae } from '../../../compartido/contratos/tipos-fundae.ts';

const INTERSECTORIAL = 'INTERSECTORIAL';

/**
 * La ficha de un curso en la web de FUNDAE con sus ediciones en teleformación (modalidad 2), donde se hace la
 * preinscripción. Es la ruta «ficha-curso/oferta/<modalidad>/<código>» de experienciafundae.es (comprobada en su código
 * el 21/10/2026); la página pide a la API las mismas difusiones que guarda la cadena de datos.
 */
const FICHA_DE_FUNDAE = 'https://experienciafundae.es/ficha-curso/oferta/2/';

/**
 * La ficha de un curso en la web de FUNDAE, con todas sus ediciones a distancia.
 *
 * @param especialidad - El código de su especialidad («IFCT0049»).
 * @returns La dirección de la ficha.
 */
export function fichaDeFundae(especialidad: string): string {
  return `${FICHA_DE_FUNDAE}${encodeURIComponent(especialidad)}`;
}

/** Cómo se nombra cada colectivo detrás de «para personas». */
const COMO_SE_DICE: Readonly<Record<ColectivoFundae, string>> = {
  asalariados: 'asalariadas',
  autonomos: 'autónomas',
  'economia-social': 'de cooperativas',
  'administracion-publica': 'de la administración pública',
  desempleados: 'en paro',
  erte: 'en ERTE',
};

/**
 * Las ediciones con el plazo de preinscripción abierto el día `hoy`.
 *
 * @param fundae - Lo que trae el paquete de FUNDAE, si lo trae.
 * @param hoy - El día de la consulta (AAAA-MM-DD).
 * @returns Las ediciones abiertas, en el orden del paquete.
 */
export function edicionesAbiertasDeFundae(fundae: DatosFundae | undefined, hoy: string): EdicionFundae[] {
  return (fundae?.ediciones ?? []).filter((e) => e.preinscripcion.inicio <= hoy && hoy <= e.preinscripcion.fin);
}

/** Un sector de FUNDAE («FINANZAS Y SEGUROS») como se lee en una frase: «finanzas y seguros». */
function sectorEnLaFrase(sector: string): string {
  return sector.toLowerCase();
}

/** Una lista con comas y la última con «y» (o con «ni», en una negación). */
function enLista(partes: readonly string[], ultima: 'y' | 'ni' = 'y'): string {
  return partes.length > 1 ? `${partes.slice(0, -1).join(', ')} ${ultima} ${partes.at(-1)}` : (partes[0] ?? '');
}

/** Los dos colectivos de quien trabaja por cuenta ajena o propia: si falta alguno, la frase lo dice. */
const DE_QUIEN_TRABAJA: readonly ColectivoFundae[] = ['asalariados', 'autonomos'];
/** Fuera de la frase breve: quien no está trabajando, que no es el público de Faro. */
const SIN_TRABAJAR: readonly ColectivoFundae[] = ['desempleados', 'erte'];

/**
 * A quién se dirige una edición, en una frase: los colectivos que admite y, si es sectorial, que lo de asalariadas es
 * para quien trabaja en una empresa de ese sector. Si no admite personas asalariadas, lo dice. En breve (la hoja de
 * ruta y la sección de cursos), sin quien no está trabajando, y diciendo si no admite asalariadas o autónomas.
 *
 * @param edicion - La edición.
 * @param opciones - `breve`: solo los colectivos de quien trabaja.
 * @returns La frase, sin punto final.
 */
export function paraQuienDeFundae(edicion: EdicionFundae, { breve = false }: { breve?: boolean } = {}): string {
  const sectorial = edicion.sector !== INTERSECTORIAL;
  const nombre = (colectivo: ColectivoFundae): string =>
    colectivo === 'asalariados' && sectorial
      ? `asalariadas de empresas del sector de ${sectorEnLaFrase(edicion.sector)}`
      : COMO_SE_DICE[colectivo];
  const admite = (colectivo: ColectivoFundae): boolean => edicion.colectivos.includes(colectivo);
  const colectivos = breve ? edicion.colectivos.filter((c) => !SIN_TRABAJAR.includes(c)) : edicion.colectivos;
  const faltan = (breve ? DE_QUIEN_TRABAJA : (['asalariados'] as const))
    .filter((c) => !admite(c))
    .map((c) => COMO_SE_DICE[c]);
  if (!colectivos.length) {
    return `No admite personas ${enLista(faltan, 'ni')}`;
  }
  const frase = `Para personas ${enLista(colectivos.map(nombre))}`;
  return faltan.length ? `${frase}; no para personas ${enLista(faltan, 'ni')}` : frase;
}
