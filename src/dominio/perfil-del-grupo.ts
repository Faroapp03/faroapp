// Quién hace un trabajo como el tuyo: estudios y situación profesional de las personas ocupadas de cada grupo del
// censo en Cataluña (Censo 2021 del INE), y lo que cobraban de media en su gran grupo según sus estudios (Encuesta de
// Estructura Salarial del INE). Describe al grupo, nunca a la persona: Faro no conoce sus estudios ni su contrato. El
// salario es una media del grupo, no una promesa de lo que traerá formarse. La nacionalidad del grupo no se muestra.
// Lo usa contexto.ts.

import { gruposPublicados } from './grupos-del-censo.ts';
import type { Lengua } from './lengua.ts';
import type {
  DatosSalarios,
  EscalonDeEstudios,
  PerfilCenso,
  PerfilDelGrupo,
  SalarioPorEstudios,
} from './tipos-contexto.ts';
import type { Datos } from './tipos-paquete.ts';

/**
 * Los escalones de estudios que puede comparar el salario, de menos a más, con su nombre en la Encuesta de Estructura
 * Salarial. Los másteres y doctorados, que la encuesta da aparte, no se comparan: ninguna formación de Faro lleva a
 * ellos.
 */
const ESCALONES: readonly { readonly escalon: EscalonDeEstudios; readonly enLaEncuesta: string }[] = [
  { escalon: 'obligatoria', enLaEncuesta: 'Primera etapa de Educación Secundaria y similar' },
  { escalon: 'secundaria', enLaEncuesta: 'Educación secundaria segunda etapa' },
  { escalon: 'fpSuperior', enLaEncuesta: 'Enseñanzas de Formación Profesional de Grado Superior y similares' },
  { escalon: 'grado', enLaEncuesta: 'Grado (240 ETCS), Diplomatura, Ingeniería Técnica y similares' },
];

/**
 * Qué parte del grupo tiene los estudios de cada escalón, según su perfil del censo. La postsecundaria no superior
 * (unas décimas) no tiene categoría propia en la encuesta de salarios y no cuenta.
 */
const PESO_EN_EL_PERFIL: Readonly<Record<EscalonDeEstudios, (estudios: PerfilDelGrupo['estudios']) => number>> = {
  obligatoria: (estudios) => estudios.obligatoria,
  secundaria: (estudios) => estudios.bachillerato + estudios.fpGradoMedio,
  fpSuperior: (estudios) => estudios.fpGradoSuperior,
  grado: (estudios) => estudios.universitarios,
};

/** Los salarios del gran grupo de la persona, del año de la encuesta. */
export interface SalariosDelGranGrupo {
  perfil: PerfilDelGrupo;
  granGrupo: string;
  anio: number;
  salarios: DatosSalarios['grandes_grupos'][string] | undefined;
}

/** El perfil de un grupo tal como lo da el informe, sin la nacionalidad, que no se muestra. */
function perfilDe(codigo: string, perfil: PerfilCenso, lengua: Lengua): Omit<PerfilDelGrupo, 'amplio'> {
  const { estudios, situacion } = perfil;
  return {
    cno11: codigo,
    grupo: lengua.tituloCno(codigo),
    estudios: {
      obligatoria: estudios.hasta_secundaria_obligatoria,
      bachillerato: estudios.bachillerato,
      fpGradoMedio: estudios.fp_grado_medio,
      fpGradoSuperior: estudios.fp_grado_superior,
      universitarios: estudios.universitarios,
    },
    situacion: {
      indefinido: situacion.indefinido,
      temporal: situacion.temporal,
      cuentaPropia: situacion.cuenta_propia,
    },
  };
}

/** La posición en ESCALONES del escalón con más personas del grupo; con un empate, la del más bajo. */
function posicionDelEscalonMasFrecuente(estudios: PerfilDelGrupo['estudios']): number {
  const pesos = ESCALONES.map(({ escalon }) => PESO_EN_EL_PERFIL[escalon](estudios));
  return pesos.indexOf(Math.max(...pesos));
}

/**
 * Los dos escalones seguidos que se comparan: el más frecuente y el siguiente o, si la encuesta no da el siguiente en
 * ese gran grupo, el anterior. Null si no da ninguno de los dos.
 */
function escalonesComparados(masFrecuente: number, salarios: Record<string, number>): typeof ESCALONES | null {
  const tiene = (indice: number): boolean => {
    const nombre = ESCALONES[indice]?.enLaEncuesta;
    return nombre !== undefined && salarios[nombre] !== undefined;
  };
  if (!tiene(masFrecuente)) {
    return null;
  }
  if (tiene(masFrecuente + 1)) {
    return ESCALONES.slice(masFrecuente, masFrecuente + 2);
  }
  if (tiene(masFrecuente - 1)) {
    return ESCALONES.slice(masFrecuente - 1, masFrecuente + 1);
  }
  return null;
}

/**
 * El perfil de cada grupo del censo de unos códigos CNO-11, sin repetir grupos: el de 3 cifras o, si no llega a las
 * personas mínimas del paquete, el de 2, marcado como amplio. Vacío si el paquete no trae el censo.
 *
 * @param datos - El paquete de datos.
 * @param cnos - Los códigos CNO-11.
 * @param lengua - La lengua del informe.
 * @returns Un perfil por grupo.
 */
export function perfilesDelGrupo(datos: Datos, cnos: string[], lengua: Lengua): PerfilDelGrupo[] {
  const censo = datos.censo;
  if (!censo) {
    return [];
  }
  const vale = (perfil: PerfilCenso): boolean => perfil.personas >= censo.min_personas_perfil;
  const grupos = gruposPublicados(datos, cnos, { de3: censo.perfil_cno3, de2: censo.perfil_cno2, vale });
  return grupos.map(({ codigo, amplio, cifras }) => ({ ...perfilDe(codigo, cifras, lengua), amplio }));
}

/**
 * Los salarios del gran grupo de un único grupo del censo. Null si el paquete no los trae o hay varios grupos: cada uno
 * daría su gran grupo y no se escoge uno por la persona. Lo usan el salario por estudios y el salario por antigüedad.
 *
 * @param datos - El paquete de datos.
 * @param perfiles - Los perfiles de los grupos de la persona.
 * @returns Los salarios, o null.
 */
export function salariosDelGranGrupo(datos: Datos, perfiles: PerfilDelGrupo[]): SalariosDelGranGrupo | null {
  if (!datos.salarios || perfiles.length !== 1) {
    return null;
  }
  // La comprobación de longitud anterior garantiza un perfil en la lista recibida.
  const perfil = perfiles[0] as PerfilDelGrupo;
  const granGrupo = perfil.cno11.charAt(0);
  return { perfil, granGrupo, anio: datos.salarios.anio, salarios: datos.salarios.grandes_grupos[granGrupo] };
}

/**
 * Lo que cobraban de media en Cataluña las personas del gran grupo con el escalón de estudios más frecuente en el grupo
 * de la persona y con su vecino. Solo con un único grupo del censo: con varios, cada uno elegiría escalones distintos y
 * no se escoge uno por la persona. Null si el paquete no trae los salarios o no da los dos escalones.
 *
 * @param datos - El paquete de datos.
 * @param perfiles - Los perfiles de los grupos de la persona.
 * @param lengua - La lengua del informe.
 * @returns El salario por estudios, o null.
 */
export function salarioPorEstudios(
  datos: Datos,
  perfiles: PerfilDelGrupo[],
  lengua: Lengua,
): SalarioPorEstudios | null {
  const delGranGrupo = salariosDelGranGrupo(datos, perfiles);
  if (!delGranGrupo) {
    return null;
  }
  const { perfil, granGrupo, anio } = delGranGrupo;
  const salarios = delGranGrupo.salarios?.estudios ?? {};
  const comparados = escalonesComparados(posicionDelEscalonMasFrecuente(perfil.estudios), salarios);
  if (!comparados) {
    return null;
  }
  return {
    anio,
    granGrupo,
    titulo: lengua.tituloCno(granGrupo),
    // escalonesComparados comprueba que cada nombre seleccionado tiene un salario publicado.
    escalones: comparados.map(({ escalon, enLaEncuesta }) => ({ escalon, euros: salarios[enLaEncuesta] as number })),
  };
}
