// Tu ocupación en Cataluña: personas ocupadas (también en la comarca del Baix Llobregat) y contratadas según las
// estadísticas oficiales (Idescat, INE y Observatori del Treball), quién hace un trabajo como el tuyo (Censo 2021 y
// Encuesta de Estructura Salarial) y la diferencia de exposición entre mujeres y hombres según el estudio de ODEE y la
// Cambra. Los títulos de la CNO-11 y el periodo de los datos están en castellano, como los publica la fuente; los
// textos de Faro, en el idioma del informe (textos-informe.ts). Es el apartado «contexto» del informe
// (Informe.contexto), del que el informe breve toma sus cifras (informe-breve.ts).

import { lista } from '../comun/formato.ts';
import { frenteAlConjunto } from './frente-al-conjunto.ts';
import { informacionAdicional } from './informacion-adicional.ts';
import type { Lengua } from './lengua.ts';
import { perfilesDelGrupo, salarioPorEstudios } from './perfil-del-grupo.ts';
import { ocupadosEnLaZona, personasOcupadas } from './personas-ocupadas.ts';
import { provinciasDeLaOcupacion } from './provincias.ts';
import type { Contexto, GrupoContratacion } from './tipos-informe.ts';
import type { Datos, DatosCambra, DatosCataluna } from './tipos-paquete.ts';

/**
 * Como mucho se muestran estos grupos de la estadística catalana; con más, ninguna cifra describiría bien la
 * ocupación.
 */
export const MAX_GRUPOS = 4;

/** Cifras de un código CNO-11 de grupo primario (4 cifras); EURES da a veces códigos más largos. */
const CIFRAS_CNO4 = 4;

/** Niveles de la correspondencia EURES que sirven para desempatar, del más fiable al menos. */
const NIVELES_EURES_DESEMPATE: readonly NivelEuresDesempate[] = Object.freeze(['exacta', 'cercana']);

/** Las correspondencias EURES admitidas para desempatar candidatos del INE. */
type NivelEuresDesempate = 'exacta' | 'cercana';

/** Códigos CNO-11 de 4 cifras que EURES asocia a la ocupación ESCO con ese nivel de correspondencia. */
function codigosEures(datos: Datos, esco: string, nivel: NivelEuresDesempate): Set<string> {
  const correspondencias = datos.eures?.ocupaciones[esco] ?? [];
  return new Set(
    correspondencias.filter(([, relacion]) => relacion === nivel).map(([codigo]) => codigo.slice(0, CIFRAS_CNO4)),
  );
}

/** Diferencia de exposición entre mujeres y hombres, con una cita corta (la referencia completa va en las fuentes). */
function generoSegunCambra(cambra: DatosCambra, lengua: Lengua): Contexto['genero'] {
  return {
    mujeres: cambra.genero.mujeres_exposicion_media_o_alta,
    hombres: cambra.genero.hombres_exposicion_media_o_alta,
    fuente: lengua.textos.contexto.fuenteGenero(cambra.genero.pagina_impresa),
  };
}

/** Contexto sin cifras de Cataluña: solo el dato de género y el motivo por el que faltan. */
function contextoVacio(genero: Contexto['genero'], pendiente: string): Contexto {
  return {
    ocupados: [],
    contratacion: [],
    periodo: null,
    variacionConjunto: null,
    genero,
    pendiente,
    zona: [],
    perfil: [],
    salario: null,
    avisoCenso: null,
    provincias: null,
    frente: null,
    adicional: null,
  };
}

/** Personas contratadas por código CNO-11 de 4 cifras; los códigos sin contrataciones no aparecen. */
function gruposContratacion(cataluna: DatosCataluna, cnos: string[], lengua: Lengua): GrupoContratacion[] {
  return cnos.flatMap((cno): GrupoContratacion[] => {
    const contratacion = cataluna.contratacion_cno4[cno];
    const personas = contratacion?.personas_contratadas ?? 0;
    if (!contratacion || !(personas > 0)) {
      return [];
    }
    return [
      {
        cno11: cno,
        grupo: lengua.tituloCno(cno),
        personas,
        anterior: contratacion.personas_contratadas_anterior,
        variacion: contratacion.variacion_pct,
        pctIndefinidos: contratacion.pct_indefinidos,
      },
    ];
  });
}

/**
 * La variación de las personas contratadas en toda Cataluña: la que publica el Observatori para el total, si su paquete
 * es del mismo periodo; si no, la suma de las ocupaciones de cataluna.json, como dice la nota del bloque.
 */
function variacionDeCataluna(datos: Datos, cataluna: DatosCataluna): number | null {
  const observatori = datos.observatori;
  const publicada =
    observatori && observatori.periodo === cataluna.periodo_contratacion
      ? observatori.cataluna.total.variacion_personas_contratadas
      : null;
  return publicada ?? cataluna.variacion_conjunto_ocupaciones;
}

/** Una copia de los grupos, de más a menos personas; la lista recibida no cambia. */
function porTamano<T extends { personas: number }>(grupos: readonly T[]): T[] {
  return grupos.toSorted((a, b) => b.personas - a.personas);
}

/**
 * Códigos CNO-11 de 4 cifras de una ocupación ESCO o, sin ella (`esco` null), de su grupo ISCO-08. Manda la
 * correspondencia oficial del INE (CIUO-08 → CNO-11). Si da varios, la correspondencia EURES (ESCO → ocupaciones
 * españolas) solo sirve para escoger uno de ellos: cuando las dos se contradicen, EURES no decide (a veces pone, por
 * ejemplo, «activista» entre los administrativos). Sin ocupación ESCO no hay desempate: se dan todos los del INE.
 *
 * @param datos - Paquete de datos cargado.
 * @param esco - URI de la ocupación ESCO, o null si la persona solo eligió el grupo.
 * @param isco - Código ISCO-08 de 4 cifras del grupo.
 * @returns Códigos CNO-11 de 4 cifras, ordenados; vacía si el INE no da ninguno.
 */
export function codigosCno(datos: Datos, esco: string | null, isco: string): string[] {
  const correspondenciaIne = datos.clasificaciones.isco08_a_cno11[isco] ?? [];
  const ine = [...new Set(correspondenciaIne.map((fila) => fila.cno11))].sort();
  if (ine.length <= 1 || esco === null) {
    return ine;
  }
  for (const nivel of NIVELES_EURES_DESEMPATE) {
    const eures = codigosEures(datos, esco, nivel);
    const enAmbas = ine.filter((codigo) => eures.has(codigo));
    if (enAmbas.length === 1) {
      return enAmbas;
    }
  }
  return ine;
}

/**
 * Contexto de la ocupación en Cataluña (sin ocupación ESCO, el de su grupo ISCO-08), escrito en la lengua del
 * informe. Si se reparte en más de MAX_GRUPOS grupos de la estadística, no se da ninguna cifra: se dice por qué. El
 * aviso de cómo se cuenta la ocupación en el censo va una sola vez, si hay alguna cifra del censo.
 *
 * @param datos - Paquete de datos cargado.
 * @param esco - URI de la ocupación ESCO, o null si la persona solo eligió el grupo.
 * @param isco - Código ISCO-08 de 4 cifras del grupo.
 * @param lengua - Lengua del informe.
 * @returns El apartado «contexto» del informe; sin cifras, con el motivo en `pendiente`.
 */
export function contextoCataluna(datos: Datos, esco: string | null, isco: string, lengua: Lengua): Contexto {
  const textos = lengua.textos.contexto;
  const genero = generoSegunCambra(datos.cambra, lengua);
  const cataluna = datos.cataluna;
  if (!cataluna) {
    return contextoVacio(genero, textos.sinDatosCataluna);
  }
  const cnos = codigosCno(datos, esco, isco);
  if (cnos.length > MAX_GRUPOS) {
    return contextoVacio(genero, textos.demasiadosGrupos(cnos.length, lista(cnos, lengua.idioma)));
  }
  const ocupados = porTamano(personasOcupadas(datos, cataluna, cnos, lengua));
  const contratacion = porTamano(gruposContratacion(cataluna, cnos, lengua));
  const perfil = perfilesDelGrupo(datos, cnos, lengua);
  const hayDatos = ocupados.length > 0 || contratacion.length > 0;
  const variacionConjunto = variacionDeCataluna(datos, cataluna);
  return {
    ocupados,
    contratacion,
    periodo: lengua.original(cataluna.periodo_contratacion, 'es'),
    variacionConjunto,
    genero,
    pendiente: hayDatos ? null : textos.sinDatosOcupacion,
    zona: ocupadosEnLaZona(datos, ocupados, lengua),
    perfil,
    salario: salarioPorEstudios(datos, perfil, lengua),
    avisoCenso: ocupados.length > 0 || perfil.length > 0 ? textos.avisoCenso : null,
    provincias: provinciasDeLaOcupacion(datos.observatori, contratacion, lengua),
    frente: frenteAlConjunto(datos, { ocupados, contratacion, perfil, variacionConjunto }, lengua),
    adicional: informacionAdicional(datos, contratacion, perfil, lengua),
  };
}
