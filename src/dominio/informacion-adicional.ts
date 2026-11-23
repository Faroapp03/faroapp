// Información adicional del apartado 02: tres preguntas más de quien lee el informe, con datos que ya están en el
// paquete. «¿Cuánta gente busca este trabajo?» (personas inscritas sin empleo) y «¿Qué contratos se firman?»
// (contratos, jornada parcial y duración de los temporales), del Observatori del Treball, solo con un único grupo de
// contratación: cada bloque aplica min_base a su propia base (demandantes o contratos), y demandantes exige además
// media mensual disponible. «¿Y con los años?» (salario por antigüedad en la empresa), de la
// Encuesta de Estructura Salarial, solo con un único grupo del censo, como el salario por estudios. Describe al grupo,
// nunca a la persona. Lo usa contexto.ts.

import type { Lengua } from './lengua.ts';
import { salariosDelGranGrupo } from './perfil-del-grupo.ts';
import { periodoDelObservatori } from './provincias.ts';
import type { PerfilDelGrupo } from './tipos-contexto.ts';
import type {
  ContratosFirmados,
  Demandantes,
  IndicadoresObservatori,
  InformacionAdicional,
  SalarioPorAntiguedad,
  TramoDeAntiguedad,
} from './tipos-frente-al-conjunto.ts';
import type { GrupoContratacion } from './tipos-informe.ts';
import type { Datos } from './tipos-paquete.ts';

/** Los tramos de antigüedad, de menos a más años, con su nombre en la Encuesta de Estructura Salarial. */
const TRAMOS: readonly { readonly tramo: TramoDeAntiguedad; readonly enLaEncuesta: string }[] = [
  { tramo: 'menosDe1', enLaEncuesta: 'Menos de 1 año' },
  { tramo: 'de1a3', enLaEncuesta: 'De 1 a 3 años' },
  { tramo: 'de4a10', enLaEncuesta: 'De 4 a 10 años' },
  { tramo: 'de11a20', enLaEncuesta: 'De 11 a 20 años' },
  { tramo: 'de21a29', enLaEncuesta: 'De 21 a 29 años' },
  { tramo: 'de30oMas', enLaEncuesta: '30 y más años' },
];
/** Con menos tramos publicados no se ve cómo cambia el salario con los años. */
const MIN_TRAMOS = 2;
/** La parte del Observatori cuando no se enseña: el salario por antigüedad va solo. */
const SIN_OBSERVATORI: ParteDelObservatori = {
  cno11: null,
  grupo: null,
  periodo: null,
  demandantes: null,
  contratos: null,
};

/** Lo que responde el Observatori del Treball: demandantes y contratos de un único grupo de contratación. */
type ParteDelObservatori = Omit<InformacionAdicional, 'antiguedad'>;

/** Las personas inscritas que buscan un trabajo del grupo; null si no llegan a `min_base`. */
function demandantes(grupo: IndicadoresObservatori, minimo: number): Demandantes | null {
  const { demandantes_no_ocupados_12m: enLos12Meses, demandantes_no_ocupados_media: mediaMensual } = grupo;
  if (enLos12Meses === null || mediaMensual === null || enLos12Meses < minimo) {
    return null;
  }
  return { enLos12Meses, mediaMensual, contratadasPorDemandante: grupo.contratadas_por_demandante };
}

/** Los contratos firmados del grupo con los de Cataluña; null si no llegan a `min_base`. */
function contratos(
  grupo: IndicadoresObservatori,
  cataluna: IndicadoresObservatori,
  minimo: number,
): ContratosFirmados | null {
  if (grupo.contratos < minimo) {
    return null;
  }
  return {
    contratos: grupo.contratos,
    personas: grupo.personas_contratadas,
    porPersona: grupo.contratos_por_persona,
    porPersonaConjunto: cataluna.contratos_por_persona,
    pctParcial: grupo.pct_parcial,
    pctParcialConjunto: cataluna.pct_parcial,
    diasTemporales: grupo.duracion_media_temporales_dias,
    diasTemporalesConjunto: cataluna.duracion_media_temporales_dias,
  };
}

/**
 * El salario por antigüedad del gran grupo de un único grupo del censo, con los tramos que publica la encuesta (no da
 * los que tienen pocas respuestas); null si da menos de MIN_TRAMOS.
 */
function antiguedad(datos: Datos, perfil: PerfilDelGrupo[], lengua: Lengua): SalarioPorAntiguedad | null {
  const delGranGrupo = salariosDelGranGrupo(datos, perfil);
  if (!delGranGrupo) {
    return null;
  }
  const { granGrupo, anio } = delGranGrupo;
  const porTramo = delGranGrupo.salarios?.antiguedad ?? {};
  const tramos = TRAMOS.filter(({ enLaEncuesta }) => porTramo[enLaEncuesta] !== undefined).map(
    // El filtro anterior selecciona solo nombres con salario publicado, incluido cero.
    ({ tramo, enLaEncuesta }) => ({ tramo, euros: porTramo[enLaEncuesta] as number }),
  );
  if (tramos.length < MIN_TRAMOS) {
    return null;
  }
  return { anio, granGrupo, titulo: lengua.tituloCno(granGrupo), tramos };
}

/** Demandantes y contratos de un único grupo de contratación, o null si no se enseña ninguno de los dos. */
function delObservatori(
  datos: Datos,
  contratacion: readonly GrupoContratacion[],
  lengua: Lengua,
): ParteDelObservatori | null {
  const observatori = datos.observatori;
  if (!observatori || contratacion.length !== 1) {
    return null;
  }
  // La comprobación anterior exige una lista densa de un único grupo de contratación.
  const { cno11, grupo } = contratacion[0] as GrupoContratacion;
  const indicadores = observatori.cataluna.cno4[cno11];
  if (!indicadores) {
    return null;
  }
  const busca = demandantes(indicadores, observatori.min_base);
  const firmados = contratos(indicadores, observatori.cataluna.total, observatori.min_base);
  if (!busca && !firmados) {
    return null;
  }
  const periodo = periodoDelObservatori(observatori, lengua.idioma);
  return { cno11, grupo, periodo, demandantes: busca, contratos: firmados };
}

/**
 * Lo que responde «Información adicional», o null si no se enseña ninguna parte.
 *
 * @param datos - Paquete de datos cargado.
 * @param contratacion - Grupos de contratación CNO-11 de la ocupación; las cifras del Observatori, solo con uno.
 * @param perfil - Grupos del censo de la ocupación; el salario por antigüedad, solo con uno.
 * @param lengua - Lengua del informe.
 * @returns Las partes que se enseñan, o null si no hay ninguna.
 */
export function informacionAdicional(
  datos: Datos,
  contratacion: readonly GrupoContratacion[],
  perfil: PerfilDelGrupo[],
  lengua: Lengua,
): InformacionAdicional | null {
  const observatori = delObservatori(datos, contratacion, lengua);
  const conLosAnios = antiguedad(datos, perfil, lengua);
  if (!observatori && !conLosAnios) {
    return null;
  }
  return { ...(observatori ?? SIN_OBSERVATORI), antiguedad: conLosAnios };
}
