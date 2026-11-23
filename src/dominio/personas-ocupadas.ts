// Personas ocupadas de los grupos del censo de una ocupación en Cataluña: las del último año del censo anual del
// Idescat, con su variación entre los dos últimos años comparables, o, si el paquete no lo trae, las del Censo 2021 del
// INE. La edad sale siempre del Censo 2021, el último que la publica por grupo de 3 cifras. Debajo de Cataluña, las de
// la comarca del Baix Llobregat. Ninguna variación se atribuye a nada: el informe solo la compara con la de toda
// Cataluña. Lo usa contexto.ts.

import { type CifrasPorNivel, type GrupoPublicado, grupoDe2, gruposPublicados } from './grupos-del-censo.ts';
import type { Lengua } from './lengua.ts';
import type {
  DatosOcupados,
  OcupadosDelAnio,
  OcupadosEnLaZona,
  OcupadosPorAnio,
  VariacionOcupados,
} from './tipos-contexto.ts';
import type { GrupoOcupados } from './tipos-informe.ts';
import type { CensoGrupo, Datos, DatosCataluna } from './tipos-paquete.ts';

/**
 * La comarca del Baix Llobregat, por su código del Idescat. El informe la da siempre debajo de Cataluña, sin preguntar
 * a la persona dónde vive ni dónde trabaja.
 */
const COMARCA_DEL_BAIX_LLOBREGAT = '11';
/**
 * Personas que tiene que tener un grupo en los dos años para dar su variación. Con menos, un cambio de unas decenas de
 * personas cabría en el ruido de la imputación de la ocupación y del redondeo del Idescat a múltiplos de 3.
 */
const MIN_PERSONAS_VARIACION = 1000;
/** El año del Censo 2021 del INE (cataluna.json), el último que publica la edad por grupo de 3 cifras. */
export const ANIO_CENSO_2021 = '2021';
/** La suma de todos los grupos de Cataluña en el censo anual. */
export const TODOS_LOS_GRUPOS = 'total';
/** Nivel de los grupos de 3 cifras en las clasificaciones. */
const NIVEL_GRUPO_DE_3 = '3';
/** Cifras de un código CNO-11 de grupo de 2 cifras. */
const CIFRAS_DEL_GRUPO_DE_2 = 2;

/** El último año del censo anual: el de las cifras que da el informe. */
function ultimoAnio(ocupados: DatosOcupados): string {
  // La cadena publica una lista no vacía de años. La aserción expresa ese contrato sin cambiar la lectura.
  return [...ocupados.anios].sort()[ocupados.anios.length - 1] as string;
}

/** Las cifras de un grupo en un año, si las hay y llegan al mínimo de personas del paquete. */
function delAnio(cifras: OcupadosPorAnio | undefined, anio: string, minimo: number): OcupadosDelAnio | null {
  const deEseAnio = cifras?.[anio];
  return deEseAnio && deEseAnio.ocupados >= minimo ? deEseAnio : null;
}

/** Factor que pasa una proporción a porcentaje con un decimal, antes de redondear. */
const PROPORCION_A_DECIMAS_DE_PORCENTAJE = 1000;
/** Las décimas que tiene un punto porcentual. */
const DECIMAS_POR_PUNTO = 10;

/** Variación en %, con el decimal que se muestra. */
function enPorcentaje(antes: number, despues: number): number {
  return Math.round(((despues - antes) / antes) * PROPORCION_A_DECIMAS_DE_PORCENTAJE) / DECIMAS_POR_PUNTO;
}

/**
 * Variación de un grupo de Cataluña entre los dos últimos años comparables del censo anual, con la de todos los
 * grupos. Null si no hay dos años comparables o si el grupo no llega a MIN_PERSONAS_VARIACION en alguno.
 */
function variacionDe(cifras: OcupadosPorAnio, ocupados: DatosOcupados): VariacionOcupados | null {
  const comparables = ocupados.anios.filter((anio) => anio >= ocupados.comparable_desde).sort();
  const [desde, hasta] = comparables.slice(-2);
  const total = ocupados.cataluna_cno3[TODOS_LOS_GRUPOS];
  if (desde === undefined || hasta === undefined) {
    return null;
  }
  const totalAntes = total?.[desde];
  const totalDespues = total?.[hasta];
  if (!totalAntes || !totalDespues) {
    return null;
  }
  const antes = delAnio(cifras, desde, MIN_PERSONAS_VARIACION);
  const despues = delAnio(cifras, hasta, MIN_PERSONAS_VARIACION);
  if (!antes || !despues) {
    return null;
  }
  const conjunto = enPorcentaje(totalAntes.ocupados, totalDespues.ocupados);
  return { desde, hasta, pct: enPorcentaje(antes.ocupados, despues.ocupados), conjunto };
}

/** La edad del Censo 2021 del mismo grupo que da la cifra, a 3 cifras o a 2. */
function edadDel2021(cataluna: DatosCataluna, grupo: GrupoPublicado<unknown>): CensoGrupo | undefined {
  return (grupo.amplio ? cataluna.ocupados_cno2 : cataluna.ocupados_cno3)[grupo.codigo];
}

/** Un grupo del censo anual en un año, con la edad del Censo 2021 del mismo grupo; sin su variación. */
function grupoDelCensoAnual(
  datos: Datos,
  grupo: GrupoPublicado<OcupadosPorAnio>,
  anio: string,
  lengua: Lengua,
): Omit<GrupoOcupados, 'variacion'> {
  const edad = datos.cataluna ? edadDel2021(datos.cataluna, grupo) : undefined;
  // gruposPublicados solo entrega grupos cuyo año supera delAnio en la selección del censo anual.
  const delGrupo = grupo.cifras[anio] as OcupadosDelAnio;
  return {
    cno11: grupo.codigo,
    grupo: lengua.tituloCno(grupo.codigo),
    amplio: grupo.amplio,
    organismo: 'Idescat',
    anio,
    personas: delGrupo.ocupados,
    pctMujeres: delGrupo.pct_mujeres,
    pctMenores30: edad?.pct_menores_30 ?? null,
    pct55: edad?.pct_55_o_mas ?? null,
  };
}

/** Los grupos del censo anual de unos códigos CNO-11, en su último año. */
function delCensoAnual(datos: Datos, ocupados: DatosOcupados, cnos: string[], lengua: Lengua): GrupoOcupados[] {
  const anio = ultimoAnio(ocupados);
  const cifras: CifrasPorNivel<OcupadosPorAnio> = {
    de3: ocupados.cataluna_cno3,
    de2: ocupados.cataluna_cno2,
    vale: (delGrupo) => delAnio(delGrupo, anio, ocupados.min_personas) !== null,
  };
  return gruposPublicados(datos, cnos, cifras).map((grupo) => ({
    ...grupoDelCensoAnual(datos, grupo, anio, lengua),
    variacion: variacionDe(grupo.cifras, ocupados),
  }));
}

/** Un grupo del Censo 2021 tal como lo da el informe, sin variación: el censo anual es otro método. */
function grupoDelCenso2021(grupo: GrupoPublicado<CensoGrupo>, lengua: Lengua): GrupoOcupados {
  const { codigo, amplio, cifras: censo } = grupo;
  return {
    cno11: codigo,
    grupo: lengua.tituloCno(codigo),
    amplio,
    organismo: 'INE',
    anio: ANIO_CENSO_2021,
    personas: censo.ocupados,
    pctMujeres: censo.pct_mujeres,
    pctMenores30: censo.pct_menores_30,
    pct55: censo.pct_55_o_mas,
    variacion: null,
  };
}

/** Si un grupo de 2 cifras tiene un solo grupo de 3: entonces los dos son el mismo grupo de personas. */
function tieneUnSoloGrupo(datos: Datos, codigo: string): boolean {
  return (
    Object.values(datos.clasificaciones.cno11).filter(
      ({ nivel, padre }) => nivel === NIVEL_GRUPO_DE_3 && padre === codigo,
    ).length === 1
  );
}

/**
 * Las personas ocupadas de cada grupo del censo de unos códigos CNO-11, sin repetir grupos: las del censo anual del
 * Idescat o, si el paquete no lo trae, las del Censo 2021.
 *
 * @param datos - El paquete de datos.
 * @param cataluna - Los datos de Cataluña.
 * @param cnos - Los códigos CNO-11.
 * @param lengua - La lengua del informe.
 * @returns Un grupo de ocupados por grupo del censo.
 */
export function personasOcupadas(
  datos: Datos,
  cataluna: DatosCataluna,
  cnos: string[],
  lengua: Lengua,
): GrupoOcupados[] {
  if (datos.ocupados) {
    return delCensoAnual(datos, datos.ocupados, cnos, lengua);
  }
  const cifras = { de3: cataluna.ocupados_cno3, de2: cataluna.ocupados_cno2, vale: () => true };
  return gruposPublicados(datos, cnos, cifras).map((grupo) => grupoDelCenso2021(grupo, lengua));
}

/**
 * Las personas ocupadas de esos grupos en la comarca del Baix Llobregat, en el mismo año que las de Cataluña. El
 * Idescat las da a 2 cifras: un grupo de 3 se da por el suyo de 2, marcado como amplio si reúne más grupos. Sin repetir
 * grupos.
 *
 * @param datos - El paquete de datos.
 * @param grupos - Los grupos de ocupados de Cataluña.
 * @param lengua - La lengua del informe.
 * @returns Los ocupados de la zona, por grupo.
 */
export function ocupadosEnLaZona(datos: Datos, grupos: GrupoOcupados[], lengua: Lengua): OcupadosEnLaZona[] {
  const comarca = datos.ocupados?.territorios[COMARCA_DEL_BAIX_LLOBREGAT];
  if (!datos.ocupados || !comarca) {
    return [];
  }
  const { min_personas: minPersonas } = datos.ocupados;
  const porCodigo = new Map<string, OcupadosEnLaZona>();
  for (const { cno11, anio, organismo } of grupos) {
    if (organismo !== 'Idescat') {
      continue;
    }
    const codigo = cno11.length === CIFRAS_DEL_GRUPO_DE_2 ? cno11 : grupoDe2(datos, cno11);
    const cifras = delAnio(comarca.cno2[codigo], anio, minPersonas);
    if (!cifras || porCodigo.has(codigo)) {
      continue;
    }
    const amplio = codigo !== cno11 && !tieneUnSoloGrupo(datos, codigo);
    const grupo = lengua.tituloCno(codigo);
    porCodigo.set(codigo, { comarca: comarca.nombre, cno11: codigo, grupo, amplio, personas: cifras.ocupados, anio });
  }
  return [...porCodigo.values()];
}
