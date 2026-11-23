// Frente al conjunto: cada dato del grupo del censo al lado del mismo dato de todas las ocupaciones de Cataluña (quién
// lo hace, qué estudios tienen, con qué contrato y si crece). Describe al grupo, nunca a la persona. Solo con un único
// grupo del censo: con varios, cada uno daría otra comparación y no se escoge uno por la persona. Las cifras de
// Cataluña salen de las mismas fuentes y años que las del grupo (Idescat, Censo 2021 y Observatori del Treball). El
// bloque nombra el grupo del Censo 2021; una fila cuya cifra es de otro grupo (los contratos, de la ocupación CNO-11 de
// 4 cifras; las personas ocupadas, del nivel que publica el Idescat) lleva el nombre del suyo. Lo usa contexto.ts.

import type { Lengua } from './lengua.ts';
import { ANIO_CENSO_2021, TODOS_LOS_GRUPOS } from './personas-ocupadas.ts';
import { periodoDelObservatori } from './provincias.ts';
import type { PerfilDelGrupo } from './tipos-contexto.ts';
import type { BloqueComparado, FilaComparada, FrenteAlConjunto } from './tipos-frente-al-conjunto.ts';
import type { GrupoContratacion, GrupoOcupados } from './tipos-informe.ts';
import type { Datos } from './tipos-paquete.ts';

/** El «cuándo» de las filas que salen del Censo 2021. */
const CENSO_2021 = { anio: ANIO_CENSO_2021 };

/** Lo que el informe ya sabe del grupo y que se compara. */
export interface GrupoParaComparar {
  ocupados: GrupoOcupados[];
  contratacion: GrupoContratacion[];
  perfil: PerfilDelGrupo[];
  variacionConjunto: number | null;
}

/** Una fila solo si los dos lados tienen dato. */
function fila(
  dato: FilaComparada['dato'],
  cuando: FilaComparada['cuando'],
  grupo: number | null | undefined,
  conjunto: number | null | undefined,
): FilaComparada[] {
  return grupo === null || grupo === undefined || conjunto === null || conjunto === undefined
    ? []
    : [{ dato, cuando, grupo, conjunto }];
}

/** Las filas con el nombre de su grupo si no es el que nombra el bloque (`nombrado`). */
function delGrupo(filas: FilaComparada[], codigo: string, nombre: string, nombrado: string): FilaComparada[] {
  return codigo === nombrado ? filas : filas.map((una) => ({ ...una, otroGrupo: nombre }));
}

/** Mujeres (del mismo año y organismo que la cifra del grupo) y edad (Censo 2021). */
function quien(datos: Datos, ocupados: GrupoOcupados | undefined, nombrado: string): FilaComparada[] {
  if (!ocupados) {
    return [];
  }
  const conjunto = datos.censo?.ocupados_cataluna;
  const mujeresConjunto =
    ocupados.organismo === 'Idescat'
      ? datos.ocupados?.cataluna_cno3[TODOS_LOS_GRUPOS]?.[ocupados.anio]?.pct_mujeres
      : conjunto?.pct_mujeres;
  const filas = [
    ...fila('mujeres', { anio: ocupados.anio }, ocupados.pctMujeres, mujeresConjunto),
    ...fila('menores30', CENSO_2021, ocupados.pctMenores30, conjunto?.pct_menores_30),
    ...fila('mayores55', CENSO_2021, ocupados.pct55, conjunto?.pct_55_o_mas),
  ];
  return delGrupo(filas, ocupados.cno11, ocupados.grupo, nombrado);
}

/** Nivel de estudios terminados (Censo 2021), del grupo y de Cataluña. */
function estudios(datos: Datos, perfil: PerfilDelGrupo): FilaComparada[] {
  const conjunto = datos.censo?.perfil_cataluna?.estudios;
  if (!conjunto) {
    return [];
  }
  return [
    ...fila('obligatoria', CENSO_2021, perfil.estudios.obligatoria, conjunto.hasta_secundaria_obligatoria),
    ...fila('bachillerato', CENSO_2021, perfil.estudios.bachillerato, conjunto.bachillerato),
    ...fila('fpGradoMedio', CENSO_2021, perfil.estudios.fpGradoMedio, conjunto.fp_grado_medio),
    ...fila('fpGradoSuperior', CENSO_2021, perfil.estudios.fpGradoSuperior, conjunto.fp_grado_superior),
    ...fila('universitarios', CENSO_2021, perfil.estudios.universitarios, conjunto.universitarios),
  ];
}

/** Situación profesional (Censo 2021) y, con un único grupo de contratación, los contratos indefinidos firmados. */
function contrato(
  datos: Datos,
  perfil: PerfilDelGrupo,
  contratacion: GrupoContratacion[],
  lengua: Lengua,
): FilaComparada[] {
  const situacion = datos.censo?.perfil_cataluna?.situacion;
  const filas = situacion
    ? [
        ...fila('indefinido', CENSO_2021, perfil.situacion.indefinido, situacion.indefinido),
        ...fila('cuentaPropia', CENSO_2021, perfil.situacion.cuentaPropia, situacion.cuenta_propia),
      ]
    : [];
  const observatori = datos.observatori;
  if (!observatori || contratacion.length !== 1) {
    return filas;
  }
  // La comprobación anterior exige una lista densa de un único grupo producido por contexto.
  const { cno11, grupo } = contratacion[0] as GrupoContratacion;
  const periodo = { periodo: periodoDelObservatori(observatori, lengua.idioma) };
  const indefinidos = observatori.cataluna.cno4[cno11]?.pct_indefinidos;
  const firmados = fila('indefinidosFirmados', periodo, indefinidos, observatori.cataluna.total.pct_indefinidos);
  return [...filas, ...delGrupo(firmados, cno11, grupo, perfil.cno11)];
}

/** Variación de las personas ocupadas (censo anual) y de las contratadas (12 meses), con las de Cataluña. */
function crece(
  datos: Datos,
  grupo: GrupoParaComparar,
  ocupados: GrupoOcupados | undefined,
  lengua: Lengua,
): FilaComparada[] {
  const nombrado = grupo.perfil[0]?.cno11 ?? '';
  const variacion = ocupados?.variacion;
  const filas =
    ocupados && variacion
      ? delGrupo(
          fila('ocupadosCrece', { desde: variacion.desde, hasta: variacion.hasta }, variacion.pct, variacion.conjunto),
          ocupados.cno11,
          ocupados.grupo,
          nombrado,
        )
      : [];
  if (grupo.contratacion.length !== 1 || !datos.cataluna) {
    return filas;
  }
  // Los mismos 12 meses que los contratos del Observatori, que los publica en los dos idiomas; sin ese paquete, el
  // rótulo de cataluna.json, que solo está en castellano.
  const enSuIdioma = datos.observatori && periodoDelObservatori(datos.observatori, lengua.idioma);
  const periodo = { periodo: enSuIdioma ?? lengua.original(datos.cataluna.periodo_contratacion, 'es') };
  // La comprobación anterior exige un único grupo de contratación.
  const { cno11, grupo: nombre, variacion: contratadas } = grupo.contratacion[0] as GrupoContratacion;
  const contratadasCrece = fila('contratadasCrece', periodo, contratadas, grupo.variacionConjunto);
  return [...filas, ...delGrupo(contratadasCrece, cno11, nombre, nombrado)];
}

/**
 * El grupo frente al conjunto, o null: con varios grupos del censo, sin el perfil de Cataluña en el paquete o si
 * ninguna pregunta tiene datos.
 *
 * @param datos - El paquete de datos.
 * @param grupo - El grupo que se compara.
 * @param lengua - La lengua del informe.
 * @returns La comparación, o null.
 */
export function frenteAlConjunto(datos: Datos, grupo: GrupoParaComparar, lengua: Lengua): FrenteAlConjunto | null {
  if (grupo.perfil.length !== 1 || !datos.censo?.perfil_cataluna) {
    return null;
  }
  // perfilesDelGrupo produce una lista densa; la longitud se comprueba antes de esta lectura.
  const perfil = grupo.perfil[0] as PerfilDelGrupo;
  const ocupados = grupo.ocupados.length === 1 ? grupo.ocupados[0] : undefined;
  const bloques: BloqueComparado[] = [
    { pregunta: 'quien' as const, filas: quien(datos, ocupados, perfil.cno11) },
    { pregunta: 'estudios' as const, filas: estudios(datos, perfil) },
    { pregunta: 'contrato' as const, filas: contrato(datos, perfil, grupo.contratacion, lengua) },
    { pregunta: 'crece' as const, filas: crece(datos, grupo, ocupados, lengua) },
  ].filter(({ filas }) => filas.length > 0);
  return bloques.length ? { cno11: perfil.cno11, grupo: perfil.grupo, amplio: perfil.amplio, bloques } : null;
}
