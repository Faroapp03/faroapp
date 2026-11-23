// Selección de formación abierta por titularidad y vigencia, ordenada por nivel, horas y título.
// El modo «no» evita ambas lecturas; «publica» excluye otras entidades y «gratis» las agrupa por separado.
// El Cibernàrium se incorpora a ambos modos activos si hay paquete de formación abierta.

import type {
  CursoAbierto,
  DatosFormacionAbierta,
  FichaAbiertaOficial,
  FormacionAbierta,
  NivelAbierto,
} from '../../../compartido/contratos/tipos-formacion-abierta.ts';
import { compararTexto } from '../../../src/comun/orden-alfabetico.ts';
import { cibernariumDelInforme, type DatosBarcelonaActiva } from './barcelona-activa.ts';
import type { ModoFormacionAbierta } from './oferta-de-formacion.ts';
import { diasEntreFechas } from './vigencia-cursos.ts';

/** De iniciación a avanzado: «iniciacion» y A1 son el mismo escalón, el primero. */
const ESCALON: Readonly<Record<NivelAbierto, number>> = { iniciacion: 0, A1: 0, A2: 1, B1: 2, B2: 3, C1: 4, C2: 5 };

/**
 * Si una ficha vale el día `hoy`: solo la excluye el fin que publica la fuente. La antigüedad de la comprobación no
 * la retira (la ficha conserva su fecha de comprobación). Una comprobación o un día del informe inválidos la excluyen.
 * El fin presente debe ser una fecha real AAAA-MM-DD; se compara como texto sin validarlo aquí.
 *
 * @param ficha - El día en que se comprobó la ficha y el de su fin (null si no termina), AAAA-MM-DD.
 * @param hoy - El día del informe (AAAA-MM-DD).
 * @returns Si la ficha vale ese día.
 */
export function fichaVigente(ficha: Pick<FichaAbiertaOficial, 'comprobado' | 'fin'>, hoy: string): boolean {
  return !Number.isNaN(diasEntreFechas(ficha.comprobado, hoy)) && (ficha.fin === null || ficha.fin >= hoy);
}

/**
 * El orden por horas: de más corto a más largo, y los cursos sin horas publicadas detrás de los que las tienen. Dos
 * cursos sin horas empatan (0): restar dos infinitos daría NaN.
 *
 * @param a - Las horas de un curso, o null si no las publica.
 * @param b - Las del otro.
 * @returns Negativo si `a` va antes, positivo si va después y 0 si empatan.
 */
function porHoras(a: number | null, b: number | null): number {
  if (a === null || b === null) {
    return Number(a === null) - Number(b === null);
  }
  return a - b;
}

/**
 * El orden de un bloque: de iniciación a avanzado; a igual nivel, de más corto a más largo; después, por título.
 *
 * @param a - Un curso.
 * @param b - El otro.
 * @returns Negativo si `a` va antes, positivo si va después y 0 si van juntos.
 */
export function ordenAbierto(a: CursoAbierto, b: CursoAbierto): number {
  return ESCALON[a.nivel] - ESCALON[b.nivel] || porHoras(a.horas, b.horas) || compararTexto(a.titulo, b.titulo, 'es');
}

/** Una ficha del paquete con los nombres del informe. */
function cursoAbierto(ficha: FichaAbiertaOficial): CursoAbierto {
  return {
    id: ficha.id,
    titulo: ficha.titulo,
    entidad: ficha.entidad,
    titular: ficha.titular,
    enlace: ficha.enlace,
    idioma: ficha.idioma,
    traduccionAutomatica: ficha.traduccion_automatica,
    tema: ficha.tema,
    nivel: ficha.nivel,
    horas: ficha.horas,
    aTuRitmo: ficha.a_tu_ritmo,
    fin: ficha.fin,
    dirigidoA: ficha.dirigido_a,
    certificado: ficha.certificado,
    comprobado: ficha.comprobado,
  };
}

/**
 * La formación abierta del informe con el modo del despliegue, el día `hoy`. Con «publica», ninguna ficha de otra
 * entidad llega al informe; las formaciones de IA del Cibernàrium (Barcelona Activa, de titular público) van con
 * «publica» y con «gratis». Los datos se piden como funciones para no leer el paquete cuando la pieza está apagada.
 *
 * @param formacionAbierta - Lee las fichas de formación abierta del paquete (undefined si no las trae).
 * @param modo - El modo del despliegue: «no», «publica» o «gratis».
 * @param hoy - El día del informe (AAAA-MM-DD).
 * @param barcelonaActiva - Lee los datos de Barcelona Activa del paquete; por defecto, ninguno.
 * @returns Los dos bloques con su cita y, si hay, el Cibernàrium; null si está apagada, si el paquete no la trae o si
 *   no queda ninguna ficha vigente ni formación del Cibernàrium.
 */
export function formacionAbiertaDelInforme(
  formacionAbierta: () => DatosFormacionAbierta | undefined,
  modo: ModoFormacionAbierta,
  hoy: string,
  barcelonaActiva: () => DatosBarcelonaActiva | undefined = () => undefined,
): FormacionAbierta | null {
  if (modo === 'no') {
    return null;
  }
  const datos = formacionAbierta();
  if (!datos) {
    return null;
  }
  const admitidas = datos.fichas.filter(
    (ficha) => (modo === 'gratis' || ficha.titular === 'publico') && fichaVigente(ficha, hoy),
  );
  const cursos = admitidas.map(cursoAbierto).sort(ordenAbierto);
  const cibernarium = cibernariumDelInforme(barcelonaActiva(), hoy);
  if (!cursos.length && !cibernarium) {
    return null;
  }
  return {
    publica: cursos.filter((curso) => curso.titular === 'publico'),
    noPublica: cursos.filter((curso) => curso.titular === 'no-publico'),
    fuente: datos.fuente,
    criterio: datos.criterio,
    ...(cibernarium ? { cibernarium } : {}),
  };
}
