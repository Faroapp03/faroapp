// Entrada del dominio para construir el informe: ocupación y tareas confirmadas, con sus referencias o estimaciones.
// Admite usos internos; la API aplica restricciones adicionales. Solo tipos, sin validación en ejecución.
// Los campos opcionales admiten también undefined explícito, como la guarda de entrada; JSON omite esos valores.

/** Tiempo que la persona dice dedicar a una tarea. */
export type Tiempo = 'mucho' | 'algo' | 'poco';

/** Tarea confirmada por la persona, con su tiempo y, si la hay, su tarea oficial o su estimación. */
export interface TareaEntrada {
  id: string;
  /** Texto confirmado por la persona. */
  texto: string;
  tiempo: Tiempo;
  /** Tarea oficial ISCO-08 de referencia: la de su ocupación o una equivalente de otra ocupación. */
  referencia?: { tareaOit: string; relacion: 'propia' | 'equivalente' } | undefined;
  /**
   * Solo para tareas sin referencia OIT: valoración con la rúbrica de la OIT.
   * La API comprueba las firmas exigidas para los orígenes firmados; «ejemplo» y «competencias» son de uso interno.
   */
  estimacion?:
    | {
        /** Nota en escala 0–1; el tipo number no impone sus límites. */
        valor: number;
        /** Extremos inferior y superior en la misma escala que valor. */
        margen: [number, number];
        origen: 'faro' | 'faro-sin-validar' | 'ejemplo';
        referenciaCercana?: string | undefined;
        competencias?: string[] | undefined;
        iaPodria?: string | undefined;
        loTuyo?: string | undefined;
        firma?: string | undefined;
        /**
         * Con qué se calibró: las tareas de su ocupación, las de su subgrupo ISCO-08 (margen provisional) o el método de la
         * OIT, que elige entre todas las tareas oficiales.
         */
        referencias?: 'ocupacion' | 'subgrupo' | 'oit' | undefined;
        /** Las estimaciones repetidas difirieron mucho: se muestra la mediana con todo su rango. */
        incierta?: boolean | undefined;
      }
    | undefined;
}

/**
 * Lo que confirma la persona para pedir su informe. La ocupación es un grupo ISCO-08 de 4 cifras y la ocupación ESCO
 * solo afina: hace falta al menos uno de los dos y, si llegan ambos, tienen que coincidir
 * (la regla de confirmación lo comprueba; estos campos opcionales no expresan esa condición).
 */
export interface Entrada {
  /** Código ESCO de la ocupación confirmada por la persona (opcional: afina el grupo). */
  ocupacionEsco?: string | undefined;
  /** Grupo ISCO-08 de 4 cifras confirmado por la persona. Obligatorio si no hay ocupación ESCO. */
  isco08?: string | undefined;
  /** Segundo grupo, cuando la persona hace las dos cosas: se admiten tareas oficiales de los dos. */
  isco08Secundario?: string | undefined;
  /**
   * La palabra con que la persona nombró su trabajo («heladero»). La API la limpia de datos personales, la pone en una
   * línea y la recorta al límite del protocolo web antes de construir el informe.
   */
  ocupacionPersona?: string | undefined;
  /** El grupo lo propuso el clasificador local y lo confirmó la persona: el informe lo dice. */
  grupoPropuestoPorIa?: boolean | undefined;
  /**
   * La web lo pide cuando el informe se ha hecho sin la IA de Faro: la ocupación elegida en la lista oficial y las
   * tareas oficiales marcadas en casillas. La regla del informe comprueba que nada lo contradiga.
   */
  sinIa?: boolean | undefined;
  tareas: TareaEntrada[];
  /** El día del informe (AAAA-MM-DD): decide qué cursos siguen abiertos y qué comprobaciones han caducado. */
  fecha: string;
}
