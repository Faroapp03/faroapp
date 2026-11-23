// Lo que se pide en la ocupación: las necesidades formativas que el SEPE publica por ocupación de la CNO-11 a 4 cifras
// Es un dato de la ocupación en toda España, nunca una carencia de la persona.
// La ocupación se lleva a la CNO-11 con la misma regla y el mismo tope que «Tu ocupación en Cataluña» (codigosCno y
// MAX_GRUPOS, en contexto.ts), para que los dos apartados hablen de las mismas ocupaciones; si quedan varias con
// ficha, van todas, en el orden de su código: Faro nunca elige una por la persona. Una ficha que llega sin ninguna
// competencia (el SEPE sirvió la página cortada) no se enseña: un título sin contenido no orienta.

import { codigosCno, MAX_GRUPOS } from './contexto.ts';
import type { Lengua } from './lengua.ts';
import type { BloqueDeLaFicha, CompetenciaPedida, FichaSepe, NecesidadesDeLaOcupacion } from './tipos-necesidades.ts';
import type { Datos } from './tipos-paquete.ts';

/** Los cuatro bloques de la ficha, en el orden en que se enseñan. */
const BLOQUES_DE_LA_FICHA: readonly BloqueDeLaFicha[] = ['tecnicas', 'digitales', 'personales', 'idiomas'];

/** Una competencia con solo lo que enseña el informe: su nombre, su porcentaje y, en los idiomas, sus destrezas. */
function competenciaEnsenada({ competencia, porcentaje, destrezas }: CompetenciaPedida): CompetenciaPedida {
  const llanas = destrezas?.map(({ destreza, porcentaje: valor }) => ({ destreza, porcentaje: valor }));
  return { competencia, porcentaje, ...(llanas ? { destrezas: llanas } : {}) };
}

/** La ficha con solo lo que enseña el informe, para que el informe guardado no cargue el resto del paquete. */
function soloLoQueSeEnsena(ficha: FichaSepe): FichaSepe {
  const competencias: FichaSepe['competencias'] = {};
  for (const bloque of BLOQUES_DE_LA_FICHA) {
    const lista = ficha.competencias[bloque];
    if (lista) {
      competencias[bloque] = lista.map(competenciaEnsenada);
    }
  }
  const { ocupacion, anio, url, competencias_ia } = ficha;
  return { ocupacion, anio, url, competencias, competencias_ia };
}

/** Si la ficha trae alguna competencia en alguno de sus bloques. */
function tieneCompetencias(ficha: FichaSepe): boolean {
  return BLOQUES_DE_LA_FICHA.some((bloque) => (ficha.competencias[bloque]?.length ?? 0) > 0);
}

/**
 * Las fichas de las ocupaciones CNO-11 de la ocupación ESCO (sin ella, `esco` null, de su grupo ISCO-08), en el orden
 * de su código; ninguna si el paquete no trae el archivo o si la ocupación se reparte en más de MAX_GRUPOS grupos. En
 * un informe traducido, los nombres de la ficha (en castellano) se apuntan como datos sin traducir.
 *
 * @param datos - El paquete de datos.
 * @param esco - El código ESCO de la ocupación, o null.
 * @param isco08 - El código ISCO-08 de la ocupación.
 * @param lengua - La lengua del informe.
 * @returns Las fichas, vacías si no hay ninguna.
 */
export function necesidadesDe(
  datos: Datos,
  esco: string | null,
  isco08: string,
  lengua: Lengua,
): NecesidadesDeLaOcupacion[] {
  const necesidades = datos.necesidades;
  if (!necesidades) {
    return [];
  }
  const codigos = codigosCno(datos, esco, isco08);
  if (codigos.length > MAX_GRUPOS) {
    return [];
  }
  const sinCifras = new Set(necesidades.todo_a_cero);
  const fichas = codigos.flatMap((cno11) => {
    const ficha = necesidades.ocupaciones[cno11];
    return ficha && tieneCompetencias(ficha)
      ? [{ ...soloLoQueSeEnsena(ficha), cno11, conCifras: !sinCifras.has(cno11) }]
      : [];
  });
  // El valor que devuelve `original` no se usa: las fichas se quedan en castellano y esta llamada solo apunta cada
  // nombre como dato sin traducir.
  for (const ficha of fichas) {
    lengua.original(ficha.ocupacion, 'es');
    for (const bloque of BLOQUES_DE_LA_FICHA) {
      for (const { competencia } of ficha.competencias[bloque] ?? []) {
        lengua.original(competencia, 'es');
      }
    }
  }
  return fichas;
}
