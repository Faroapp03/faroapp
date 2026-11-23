// Textos fijos del informe: el plan de acción, las fuentes citadas, los límites de Faro, los avisos y las frases que
// escriben las reglas (hallazgos, caminos, origen de cada nota, contexto de Cataluña). Separados de las reglas para
// que se puedan revisar sin leer código. Este archivo tiene la estructura (TextosInforme) y los textos en castellano;
// textos-informe-ca.ts tiene los mismos en catalán, y lengua.ts elige los del idioma de cada informe.
// Un informe sin idioma usa estos, los castellanos.

import { porcentaje } from '../comun/formato.ts';
import type { Franja, Informe, ObjetivoPropuesto } from './tipos-informe.ts';

/**
 * De dónde toma el INE la ocupación de las personas ocupadas en el Censo 2021, en %: de los contratos del SEPE o
 * imputada con otros datos (metodología de los Censos de Población y Viviendas 2021, figura 25, pág. 58). Las cita el
 * aviso del censo, en castellano y en catalán.
 */
export const FUENTE_DE_LA_OCUPACION = { contratos: 61.2, imputada: 18.8 };

/** Un grupo ISCO-08 tal como se nombra en el informe. */
export interface GrupoNombrado {
  isco08: string;
  tituloIsco: string;
}

/** Lo que dice el informe de cómo confirmó la persona su ocupación. */
export interface DatosConfirmacion {
  grupo: GrupoNombrado;
  secundario: GrupoNombrado | null;
  /** El título de la ocupación ESCO, si la eligió. */
  tituloEsco: string | null;
  palabra: string | null;
  /** El grupo lo propuso la IA de Faro y la persona lo confirmó. */
  propuestoPorIa: boolean;
}

/** Lo que cita la frase del origen de una nota oficial: el texto de la tarea, su número y su grupo. */
interface CitaOficial {
  cita: string;
  indice: number;
  isco08: string;
  /** Título del grupo: solo lo usa la frase de un informe con dos grupos. */
  titulo: string;
}

/** Todos los textos que escriben las reglas del informe, en un idioma. Cada idioma tiene los mismos. */
export interface TextosInforme {
  /** Nivel de exposición de la ocupación según el gradiente que publica la OIT. */
  nivelGradiente: Record<string, string>;
  /** Nivel de una ocupación sin nota de la OIT. */
  sinNotaPublicada: string;
  /** Plan de acción: tres pasos concretos, del más cercano al más lejano. */
  plan: Informe['plan'];
  /** Lo que Faro no hace, dicho en el propio informe. */
  limites: string[];
  /** Referencias que escribe Faro, junto a las citas de cada fuente. */
  fuentes: {
    notasPorTarea: string;
    esco: string;
    ine: string;
    /** Va detrás de la cita del estudio de la Cambra. */
    cifrasVerificadas: string;
    elaboracionFaro: string;
    /** `fecha`: el día en que se consultó la web de Citilab, en dd/mm/aaaa. */
    citilab: (fecha: string) => string;
    /** `fecha`: el día en que se consultaron en el Idescat los nombres oficiales en catalán, en dd/mm/aaaa. */
    nombresIdescat: (fecha: string) => string;
    /** `criterio`: la versión del criterio con que se eligió la formación abierta. */
    formacionAbierta: (criterio: string) => string;
  };
  /** Avisos sobre la calidad de lo que muestra el informe. */
  avisos: {
    ejemplo: string;
    sinValidar: string;
    textosConIa: string;
    sinCataluna: string;
    sinFormacion: string;
    inciertas: string;
    insuficientes: string;
    /** El de `insuficientes` cuando el motivo es que Faro no tiene referencias para estimar las tareas del grupo. */
    sinReferencias: string;
    grupoSinEsco: string;
    competenciasSinOcupacion: string;
  };
  /**
   * Solo en un informe traducido (null en castellano, el idioma de los datos): la marca de las traducciones de Faro y
   * los avisos sobre ellas.
   */
  traduccion: {
    /** Las traducciones de los datos oficiales y de las frases de la IA están hechas con IA. */
    deFaro: string;
    /** Algunos datos oficiales no tienen traducción y se muestran en su idioma. */
    sinTraducir: string;
  } | null;
  /** Cómo confirmó la persona su ocupación, en una frase. */
  confirmacion: (datos: DatosConfirmacion) => string;
  /** De dónde sale la nota de cada tarea (`origenValor`). */
  origen: {
    incierta: string;
    ejemplo: string;
    margenMedido: string;
    margenProvisional: string;
    metodoOit: (margen: string) => string;
    subgrupo: string;
    rubrica: (margen: string) => string;
    oficialEquivalente: (cita: CitaOficial) => string;
    oficialDelGrupo: (cita: CitaOficial) => string;
    oficialPropia: (cita: CitaOficial) => string;
    insuficiente: string;
    estimacionNoDisponible: string;
    /** El de `insuficiente` cuando el motivo es que Faro no tiene referencias para estimar las tareas del grupo. */
    sinReferencias: string;
  };
  /** Hallazgos de la portada. `deLas` acota a las tareas con datos cuando falta alguna. */
  hallazgos: {
    /** Sin ninguna tarea con datos; `sinReferencias` es el texto cuando Faro no tiene con qué estimarlas. */
    sinDatos: { titulo: string; texto: string; sinReferencias: string; detalle: string };
    deLasQueTienenDatos: string;
    detalleOit: string;
    detalleOitYFaro: string;
    /** Todas las notas del hallazgo son estimaciones de Faro. */
    detalleFaro: string;
    segunOit: string;
    segunOitYFaro: string;
    segunFaro: string;
    ningunaAlta: (deLas: string) => string;
    ningunaAltaTexto: string;
    /** El nombre de cada franja, como se dice tras «la franja». */
    franjas: Readonly<Record<Franja, string>>;
    /**
     * El título cuando el margen de alguna tarea cruza de franja: de la franja posible más baja a la más alta. `varias`:
     * el título nombra más de una tarea y el margen que cruza puede ser solo el de alguna.
     */
    loQueMasCambiaEntreFranjas: (tareas: string, desde: string, hasta: string, varias: boolean) => string;
    loQueMasCambia: (tareas: string) => string;
    loQueMasCambiaTexto: (segunQuien: string) => string;
    todasCambian: (deLas: string) => string;
    todasCambianTexto: string;
    loQueDependeDeTi: (tareas: string) => string;
    loQueDependeDeTiTexto: string;
    entreLasMasExpuestas: string;
    entreLasMenosExpuestas: string;
    zonaIntermedia: string;
    posicion: (masAltas: number, total: number) => string;
    detallePosicion: string;
  };
  /** Caminos propuestos. `varias`: el camino se apoya en más de una tarea. */
  caminos: {
    usarLaIa: (tareas: string) => string;
    porqueMasCambia: (tareas: string, varias: boolean, dedicaMucho: boolean) => string;
    reforzar: string;
    porqueSigueSiendoTuyo: (tareas: string, varias: boolean) => string;
  };
  /** Los títulos de los dos objetivos que el plan propone para cada tarea (aprendizaje.ts); `texto`, el de la tarea. */
  objetivos: Record<ObjetivoPropuesto['tipo'], (texto: string) => string>;
  /** La ocupación en Cataluña. */
  contexto: {
    sinDatosCataluna: string;
    sinDatosOcupacion: string;
    demasiadosGrupos: (cantidad: number, codigos: string) => string;
    fuenteGenero: (pagina: number) => string;
    /** Cómo se cuenta la ocupación en el censo, con las cifras de la metodología del INE: se dice una sola vez. */
    avisoCenso: string;
  };
}

/** Terminación de los participios según lo que se confirma: una ocupación, un grupo o dos grupos. */
function concordancia(secundario: GrupoNombrado | null, tituloEsco: string | null): string {
  if (secundario) {
    return 'os';
  }
  return tituloEsco ? 'a' : 'o';
}

/**
 * Cómo confirmó la persona su ocupación, en una frase: «Grupo 7512 · Panaderos, pasteleros y confiteros, confirmado
 * por ti a partir de «heladero»». Con un segundo grupo se nombran los dos; con ocupación ESCO, también ella. Si el
 * grupo lo propuso la IA, la frase habla del grupo, que es lo único que propuso: «Grupo …, propuesto por la IA de Faro
 * y confirmado por ti», y la ocupación ESCO, si la hay, va detrás como elegida por la persona.
 */
function textoConfirmacion({ grupo, secundario, tituloEsco, palabra, propuestoPorIa }: DatosConfirmacion): string {
  const grupos = secundario
    ? `Grupos ${grupo.isco08} · ${grupo.tituloIsco} y ${secundario.isco08} · ${secundario.tituloIsco}`
    : `Grupo ${grupo.isco08} · ${grupo.tituloIsco}`;
  const origen = palabra ? ` a partir de «${palabra}»` : '';
  if (propuestoPorIa) {
    const final = concordancia(secundario, null);
    const esco = tituloEsco ? ` · Ocupación «${tituloEsco}», elegida por ti` : '';
    return `${grupos}, propuest${final} por la IA de Faro y confirmad${final} por ti${origen}${esco}`;
  }
  const sujeto = tituloEsco ? `Ocupación «${tituloEsco}» · ${grupos}` : grupos;
  return `${sujeto}, confirmad${concordancia(secundario, tituloEsco)} por ti${origen}`;
}

/** Los textos del informe en castellano: el idioma de partida. */
export const TEXTOS_INFORME_ES: TextosInforme = {
  nivelGradiente: {
    gradiente_4: 'muy alta (nivel 4 de 4)',
    gradiente_3: 'alta (nivel 3 de 4)',
    gradiente_2: 'media (nivel 2 de 4)',
    gradiente_1: 'baja pero variable (nivel 1 de 4)',
    exposicion_minima: 'mínima',
    no_expuesta: 'sin exposición apreciable',
  },
  sinNotaPublicada: 'sin nota publicada',
  plan: [
    {
      cuando: 'Esta semana',
      paso: 'Mira en qué tareas la IA podría ayudarte',
      detalle: 'Empieza por las de cambio alto y piensa qué revisarías tú.',
    },
    {
      cuando: 'Este mes',
      paso: 'Revisa la formación oficial de este informe',
      detalle: 'Comprueba plazas, fechas y requisitos en la página oficial de cada curso.',
    },
    {
      cuando: 'En 6 meses',
      paso: 'Vuelve a consultar Faro',
      detalle: 'Las fuentes se actualizan y tus tareas pueden cambiar.',
    },
  ],
  limites: [
    'No predice si perderás tu empleo ni cuándo.',
    'No evalúa tu capacidad, tu rendimiento ni lo que te falta.',
    'No decide qué debes aprender: muestra la formación que las fuentes oficiales relacionan con tu ocupación; las sugerencias de Faro van marcadas y eliges tú.',
    'No sabe cómo se trabaja en tu centro concreto ni si ya usa IA.',
    'Las notas describen exposición potencial a IA generativa en tareas genéricas. No prueban que una herramienta concreta las ejecute bien ni que tu centro la adopte.',
    'El rango descriptivo no es un intervalo de confianza individual. Una nota estable entre repeticiones puede ser errónea.',
    'Los textos «La IA podría» y «Lo tuyo» son explicaciones orientativas; no son pruebas de funcionamiento de herramientas.',
  ],
  fuentes: {
    notasPorTarea:
      'Notas por tarea que la OIT publica junto a su documento de trabajo n.º 140 (Working Paper 140), en el repositorio del autor principal. Reutilizables citando a la OIT según su política de acceso abierto.',
    esco: '© Unión Europea. ESCO v1.2.1, clasificación europea de capacidades, competencias, cualificaciones y ocupaciones. Faro selecciona y adapta estos datos.',
    ine: 'INE, CNO-11 y correspondencia con la CIUO-08.',
    cifrasVerificadas: 'Cifras verificadas contra el PDF publicado.',
    elaboracionFaro: 'Traducciones, resúmenes, franjas y reparto del tiempo: elaboración de Faro.',
    citilab: (fecha) =>
      `Citilab (citilab.eu): fichas de formación consultadas el ${fecha}. Faro solo muestra hechos de cada ficha, con su enlace.`,
    nombresIdescat: (fecha) =>
      `Fuente: elaboración propia a partir de datos del Idescat. Nombres oficiales en catalán de los grupos de ocupación (CIUO-2008 (ca), CCO-2011 (ca) y su correspondencia con la CNO-2011), consultados el ${fecha} en www.idescat.cat.`,
    formacionAbierta: (criterio) =>
      `Formación abierta en línea: selección de Faro con su criterio publicado (${criterio}) y fichas redactadas por Faro con el enlace a cada curso. Faro no recibe nada por estos enlaces.`,
  },
  avisos: {
    ejemplo: 'Incluye una estimación de ejemplo, que no ha calculado Faro.',
    sinValidar:
      'Incluye estimaciones de Faro con un rango provisional: todavía no se ha medido su error frente a la OIT.',
    textosConIa: 'Algunos textos de las tareas oficiales están traducidos o redactados con IA.',
    sinCataluna: 'Esta versión de Faro no tiene datos de Cataluña por ocupación.',
    sinFormacion: 'Todavía no hay datos de formación en esta versión de Faro.',
    inciertas:
      'Algunas estimaciones de Faro son inciertas: al repetirlas, la IA dio notas muy distintas. Se muestran con todo su rango.',
    insuficientes:
      'Algunas tareas no tienen nota publicada ni estimación: aparecen marcadas como información insuficiente.',
    sinReferencias:
      'La OIT no publica notas de las tareas de tu grupo de ocupaciones y Faro no tiene tareas de referencia para estimarlas: aparecen marcadas como información insuficiente.',
    grupoSinEsco:
      'Confirmaste tu grupo de ocupaciones en la clasificación internacional (CIUO-08), pero no una ocupación concreta del catálogo europeo ESCO. Por eso los datos de Cataluña y la formación se refieren a todo el grupo.',
    competenciasSinOcupacion:
      'Las competencias de tus tareas vienen del catálogo ESCO, pero sin una ocupación ESCO no se sabe si son esenciales u opcionales en tu trabajo.',
  },
  traduccion: null,
  confirmacion: textoConfirmacion,
  origen: {
    incierta:
      'Estimación incierta: al repetirla, la IA dio notas muy distintas; se muestra la mediana con todo su rango. ',
    ejemplo: 'Valor de ejemplo, fijo en el caso de esta página: no lo ha calculado Faro',
    margenMedido: 'su rango es la nota más y menos el mayor error medio medido frente a notas publicadas de la OIT',
    margenProvisional: 'rango provisional: todavía no se ha comparado con la OIT',
    metodoOit: (margen) =>
      `Estimación de Faro con el método de la OIT (las tareas oficiales más parecidas y los extremos de la escala); ${margen}`,
    subgrupo:
      'Estimación de Faro con los criterios de puntuación de la OIT y tareas de referencia de ocupaciones cercanas (mismo subgrupo CIUO-08), porque la OIT no publica tareas de esta ocupación; rango provisional',
    rubrica: (margen) => `Estimación de Faro con los criterios de puntuación de la OIT; ${margen}`,
    oficialEquivalente: ({ cita, isco08, indice }) =>
      `OIT 2025 · tarea oficial equivalente «${cita}», de otra ocupación (CIUO-08 ${isco08}, tarea ${indice})`,
    oficialDelGrupo: ({ cita, indice, isco08, titulo }) =>
      `OIT 2025 · tarea oficial «${cita}», tarea ${indice} del grupo ${isco08} · ${titulo}`,
    oficialPropia: ({ cita, indice, isco08 }) =>
      `OIT 2025 · tarea oficial «${cita}», tarea ${indice} de tu ocupación (CIUO-08 ${isco08})`,
    insuficiente: 'Información insuficiente: no hay nota publicada de la OIT ni estimación de Faro para esta tarea',
    estimacionNoDisponible: 'Estimación no disponible',
    sinReferencias:
      'Información insuficiente: la OIT no publica notas de las tareas de tu grupo de ocupaciones y Faro no tiene tareas de referencia para estimar la de esta tarea',
  },
  hallazgos: {
    sinDatos: {
      titulo: 'Faro no tiene datos suficientes sobre tus tareas.',
      texto:
        'No hay notas publicadas de la OIT ni estimaciones de Faro para las tareas que has confirmado. Aparecen igualmente en el informe, marcadas como información insuficiente.',
      sinReferencias:
        'La OIT no publica notas de las tareas de tu grupo de ocupaciones y Faro no tiene tareas de referencia para estimarlas. Aparecen igualmente en el informe, marcadas como información insuficiente.',
      detalle: 'Información insuficiente',
    },
    deLasQueTienenDatos: ' de las que tienen datos',
    detalleOit: 'Estimación de la OIT · con su rango',
    detalleOitYFaro: 'Estimación de la OIT y de Faro',
    detalleFaro: 'Estimación de Faro con los criterios de puntuación de la OIT',
    segunOit: 'Según la OIT',
    segunOitYFaro: 'Según la OIT y la estimación de Faro',
    segunFaro: 'Según la estimación de Faro',
    ningunaAlta: (deLas) => `Ninguna de tus tareas${deLas} tiene su nota en la franja alta.`,
    ningunaAltaTexto: 'Su rango puede llegar a otras franjas; consulta cada tarea.',
    franjas: { baja: 'baja', media: 'media', alta: 'alta' },
    loQueMasCambiaEntreFranjas: (tareas, desde, hasta, varias) =>
      `Lo que más puede cambiar: ${tareas}; ${varias ? 'el margen de alguna' : 'su margen'} va de la franja ${desde} a la ${hasta}.`,
    loQueMasCambia: (tareas) => `Lo que más puede cambiar: ${tareas}.`,
    loQueMasCambiaTexto: (segunQuien) =>
      `${segunQuien}, sus notas están en la franja alta de exposición potencial a la IA generativa. Esto no demuestra que una herramienta concreta pueda realizarlas correctamente.`,
    todasCambian: (deLas) => `Todas tus tareas${deLas} tienen algún potencial de cambio.`,
    todasCambianTexto: 'Ninguna queda en la franja baja.',
    loQueDependeDeTi: (tareas) => `Lo que más depende de ti: ${tareas}.`,
    loQueDependeDeTiTexto: 'Son las tareas con menos potencial de cambio con la IA.',
    entreLasMasExpuestas: 'Tu ocupación está entre las más expuestas a la IA generativa.',
    entreLasMenosExpuestas: 'Tu ocupación está entre las menos expuestas a la IA generativa.',
    zonaIntermedia: 'Tu ocupación está en una zona intermedia de exposición a la IA generativa.',
    posicion: (masAltas, total) =>
      `En el índice de la OIT, ${masAltas} de ${total} ocupaciones tienen una nota media más alta. Describe la ocupación, no a ti. La OIT concluye que, en conjunto, es más probable que la IA generativa transforme los empleos a que los sustituya.`,
    detallePosicion: 'Dato publicado por la OIT, 2025',
  },
  caminos: {
    usarLaIa: (tareas) => `Usar la IA para ${tareas}, sin perder el control`,
    porqueMasCambia: (tareas, varias, dedicaMucho) => {
      const pronombre = varias ? 'les' : 'le';
      const tiempo = dedicaMucho ? ` y ${pronombre} dedicas mucho tiempo` : '';
      return `${tareas} ${varias ? 'tienen' : 'tiene'} un potencial de cambio alto${tiempo}.`;
    },
    reforzar: 'Reforzar tareas de exposición baja',
    porqueSigueSiendoTuyo: (tareas, varias) =>
      `${tareas} ${varias ? 'están' : 'está'} en la franja de exposición baja a la IA generativa.`,
  },
  objetivos: {
    profesional: (texto) =>
      `Practicar «${texto}» con un caso simulado y revisar el resultado con una lista de criterios.`,
    ia: (texto) =>
      `Comparar una respuesta de IA para «${texto}» con fuentes contrastables y explicar sus errores y límites.`,
  },
  contexto: {
    sinDatosCataluna: 'Esta versión de Faro no tiene datos de Cataluña por ocupación.',
    sinDatosOcupacion: 'No hay datos oficiales de Cataluña para esta ocupación.',
    demasiadosGrupos: (cantidad, codigos) =>
      `Tu ocupación se reparte en ${cantidad} grupos de la estadística catalana (CNO-11 ${codigos}): son demasiados para que una cifra la describa bien.`,
    fuenteGenero: (pagina) => `ODEE y Cambra de Comerç de Barcelona, 2026, pág. ${pagina}`,
    avisoCenso: `Las cifras de personas ocupadas salen de registros administrativos, no de una encuesta. Según el INE, la ocupación es lo más difícil de saber así. La toma sobre todo de los contratos del SEPE (${porcentaje(FUENTE_DE_LA_OCUPACION.contratos)} de los casos); en el ${porcentaje(FUENTE_DE_LA_OCUPACION.imputada)} la calcula a partir de otros datos. Por eso algunos grupos salen con más personas que en la Encuesta de Población Activa (EPA) y otros, con menos (INE, metodología de los Censos de Población y Viviendas 2021, págs. 57 y 58).`,
  },
};
