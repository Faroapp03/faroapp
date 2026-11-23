// Motor del informe: construye el informe con reglas explícitas sobre datos validados y lo que confirma la persona.
// No usa IA. Cada cifra conserva su procedencia y su nivel de evidencia. Se escribe en castellano o, si se pide, en
// catalán: cambian los textos de Faro y los datos oficiales que Faro ha traducido; las reglas, no.

// La formación la calcula el motor de cursos (motores/cursos/, formacionDelInforme) y llega aquí como dato, en
// OpcionesInforme.formacion: este módulo no importa ningún valor del motor. Sin ella (el motor no está), el informe
// sale entero salvo la formación, con la marca formacionNoDisponible.

import { OFERTA_POR_DEFECTO, type OfertaDeFormacion } from '../../compartido/contratos/oferta-de-formacion.ts';
import { fichaDeBarcelonaActiva } from '../../compartido/utilidades/ficha-de-barcelona-activa.ts';
import type {
  CriterioDigitalTransversal,
  FormacionDelInforme as FormacionCalculada,
  FormacionRelacionada,
  FormacionTransversal,
  PeticionDeFormacion,
} from '../../motores/cursos/src/index.ts';
import { IDIOMA_POR_DEFECTO, type Idioma } from '../comun/idioma.ts';
import { MAX_TAREAS_INFORME } from '../comun/protocolo-web.ts';
import { bloqueDeAcreditacion } from './acreditacion.ts';
import { type ContextoDelCatalogo, catalogoAprendizaje } from './aprendizaje.ts';
import { caminos } from './caminos.ts';
import { contextoCataluna } from './contexto.ts';
import { EntradaInvalida } from './errores.ts';
import { ordenFranja, reparto5 } from './franjas.ts';
import {
  avisosDeOcupacion,
  avisosDeTraduccion,
  avisosInforme,
  citasDelGrupo,
  fuentesInforme,
} from './fuentes-y-avisos.ts';
import { marcasDelGrupo } from './grupos.ts';
import { hallazgos } from './hallazgos.ts';
import { crearLengua, type Lengua } from './lengua.ts';
import { marcaDelInforme } from './marca-del-informe.ts';
import { necesidadesDe } from './necesidades-formativas.ts';
import { type OcupacionConfirmada, resolverOcupacion } from './ocupacion-confirmada.ts';
import { opcionesDeOtraFormacion } from './opciones-otra-formacion.ts';
import { tareaInforme } from './tareas.ts';
import type { Entrada } from './tipos-entrada.ts';
import {
  type ConfirmacionOcupacion,
  type Informe,
  type OtraFormacion,
  type TareaInforme,
  type TextoSinTraducir,
  VERSION_INFORME,
} from './tipos-informe.ts';
import type { Datos, PoliticaReferencias } from './tipos-paquete.ts';
import { usoDeclaradoDeLaIa } from './uso-declarado-de-la-ia.ts';

/**
 * Cómo se escribe un informe: en qué idioma, con qué traducciones de las frases de la IA (castellano → idioma) y con
 * qué política selecciona referencias (dominio/referencias.ts). Con la política, el informe de un grupo para el que Faro no
 * tiene referencias dice que ese es el motivo de que sus tareas no tengan nota; sin ella, solo que no la tienen.
 * `criterioTransversal` elige el bloque digital transversal; sin él, el vigente. Los criterios están en
 * motores/cursos/src/criterio-digital-transversal.ts. `oferta` es la formación de fuera
 * del catálogo oficial que permite el despliegue (oferta-de-formacion.ts); sin ella, OFERTA_POR_DEFECTO.
 * `formacion` es la formación que ha calculado el motor de cursos para este informe (peticionDeFormacion dice qué se le
 * pide); sin ella o con null, el informe sale sin formación y lo dice (formacionNoDisponible).
 */
export interface OpcionesInforme {
  idioma?: Idioma;
  frasesTraducidas?: ReadonlyMap<string, string>;
  politica?: PoliticaReferencias;
  criterioTransversal?: CriterioDigitalTransversal;
  oferta?: OfertaDeFormacion;
  /** Tareas cuya estimación interna ha descartado la API; conservan el tiempo y aparecen sin nota. */
  tareasSinEstimacion?: ReadonlySet<string>;
  /** La formación del informe calculada por el motor de cursos, o null si el motor no está. */
  formacion?: FormacionCalculada | null;
}

/** Orden de las tareas en el informe: por franja, luego por tiempo dedicado y, a igualdad, por nota. */
function ordenTareas(a: TareaInforme, b: TareaInforme): number {
  return ordenFranja(a.franja) - ordenFranja(b.franja) || b.peso - a.peso || (b.valor ?? 0) - (a.valor ?? 0);
}

/** Lo que comparten las secciones del informe: la entrada, los datos, la ocupación comprobada, la lengua y el idioma. */
interface AmbitoDelInforme {
  entrada: Entrada;
  datos: Datos;
  ocupacion: OcupacionConfirmada;
  lengua: Lengua;
  idioma: Idioma;
}

/**
 * Rechaza lo que no puede dar un informe: una ocupación desconocida o incoherente, ninguna tarea, más de
 * MAX_TAREAS_INFORME (el mismo límite que la API, que el dominio no da por hecho) o tareas repetidas.
 *
 * @param entrada - Lo que confirma la persona.
 * @param datos - El paquete de datos.
 * @returns La ocupación comprobada.
 * @throws {EntradaInvalida} Si la entrada no puede dar un informe.
 */
export function comprobarEntradaInforme(entrada: Entrada, datos: Datos): OcupacionConfirmada {
  const ocupacion = resolverOcupacion(datos, entrada);
  if (!entrada.tareas.length) {
    throw new EntradaInvalida('No hay tareas confirmadas');
  }
  if (entrada.tareas.length > MAX_TAREAS_INFORME) {
    throw new EntradaInvalida(`Hay más de ${MAX_TAREAS_INFORME} tareas`);
  }
  if (new Set(entrada.tareas.map((tarea) => tarea.id)).size !== entrada.tareas.length) {
    throw new EntradaInvalida('Hay tareas repetidas');
  }
  return ocupacion;
}

/**
 * Lo que el informe pide al motor de cursos (formacionDelInforme): la ocupación comprobada, los otros grupos de su
 * plan (el segundo grupo y, en el orden de la entrada, los de las referencias de otro grupo), el día, el criterio del
 * bloque transversal y la oferta del despliegue.
 *
 * @param entrada - Lo que confirma la persona.
 * @param datos - El paquete de datos.
 * @param opciones - El criterio transversal y la oferta del despliegue.
 * @returns La petición.
 * @throws {EntradaInvalida} Si la entrada no puede dar un informe.
 */
export function peticionDeFormacion(
  entrada: Entrada,
  datos: Datos,
  opciones: Pick<OpcionesInforme, 'criterioTransversal' | 'oferta'> = {},
): PeticionDeFormacion {
  const ocupacion = comprobarEntradaInforme(entrada, datos);
  const deLasTareas = entrada.tareas.map(
    (tarea) => (tarea.referencia ? datos.oit.tareas[tarea.referencia.tareaOit]?.isco08 : undefined) ?? ocupacion.isco08,
  );
  const otrosGrupos = [...new Set([...(ocupacion.secundario ? [ocupacion.secundario] : []), ...deLasTareas])].filter(
    (grupo) => grupo !== ocupacion.isco08,
  );
  return {
    ocupacion,
    otrosGrupos,
    hoy: entrada.fecha,
    criterio: opciones.criterioTransversal,
    oferta: opciones.oferta ?? OFERTA_POR_DEFECTO,
  };
}

/** Cuántas ocupaciones del índice de la OIT tienen una nota media más alta que la de esta. */
function posicionEnLaOit(datos: Datos, isco: string): Informe['ocupacion']['posicion'] {
  const media = datos.oit.ocupaciones[isco]?.media ?? null;
  if (media === null) {
    return null;
  }
  const medias = Object.values(datos.oit.ocupaciones).flatMap((otra) => (otra.media === null ? [] : [otra.media]));
  const masAltas = medias.filter((otra) => otra > media).length;
  return { masAltas, total: medias.length };
}

/** Reparto del tiempo de la semana por franjas, a partir del tiempo que la persona dice dedicar a cada tarea. */
function repartoSemana(tareas: TareaInforme[]): Informe['semana'] {
  const pesos = { alta: 0, media: 0, baja: 0, sinDatos: 0 };
  for (const tarea of tareas) {
    pesos[tarea.franja ?? 'sinDatos'] += tarea.peso;
  }
  return { ...reparto5(pesos), pesoTotal: pesos.alta + pesos.media + pesos.baja + pesos.sinDatos };
}

/**
 * Los datos de la formación oficial que llegan en su idioma: los nombres y las referencias del SEPE, en castellano, y
 * los cursos del SOC y las ediciones del Consorci, ya en catalán.
 */
function originalesDeFormacion(formacion: FormacionRelacionada | null): TextoSinTraducir[] {
  if (!formacion) {
    return [];
  }
  const delSepe = formacion.especialidades.flatMap(({ nombre, modalidad, familia, ocupacionOficial }) =>
    [nombre, modalidad, familia, ...(ocupacionOficial ? [ocupacionOficial] : [])].map(enCastellano),
  );
  const cursos = [...formacion.cursos, ...(formacion.consorci?.ediciones ?? [])];
  return [...delSepe, ...cursos.map((curso) => enCatalan(curso.nombre))];
}

/** Los datos del bloque transversal que llegan en su idioma, tramo a tramo, como los de la formación oficial. */
function originalesDeTransversal(transversal: FormacionTransversal | null): TextoSinTraducir[] {
  const tramos = transversal ? [transversal, transversal.paraIrMasAlla] : [];
  return tramos
    .filter((tramo) => tramo !== null)
    .flatMap((tramo) => [
      ...tramo.especialidades.flatMap(({ nombre, modalidad }) => [enCastellano(nombre), enCastellano(modalidad)]),
      ...[...tramo.cursos, ...tramo.ediciones, ...tramo.previstas].map((curso) => enCatalan(curso.nombre)),
    ]);
}

/** Los títulos de la formación de fuera del catálogo oficial, en su idioma: Citilab, la abierta y el Cibernàrium. */
function originalesDeOtraFormacion({ citilab, formacionAbierta: abierta }: OtraFormacion): TextoSinTraducir[] {
  const abiertos = abierta ? [...abierta.publica, ...abierta.noPublica] : [];
  return [
    ...(citilab?.cursos ?? []).map((curso) => enCatalan(curso.titulo)),
    ...abiertos.map((curso) => ({ texto: curso.titulo, idioma: curso.idioma })),
    ...(abierta?.cibernarium?.formaciones ?? []).map((formacion) => enCatalan(formacion.titulo)),
    ...(abierta?.cibernarium ? [enCatalan(abierta.cibernarium.fuente)] : []),
  ];
}

/** Un dato en castellano. */
function enCastellano(texto: string): TextoSinTraducir {
  return { texto, idioma: 'es' };
}

/** Un dato en catalán. */
function enCatalan(texto: string): TextoSinTraducir {
  return { texto, idioma: 'ca' };
}

/**
 * El catálogo del plan, con las opciones de fuera del catálogo oficial detrás de todas las demás. Van en el ámbito del
 * bloque transversal: sin él (un paquete sin la formación oficial), tampoco ellas.
 */
function catalogoDe(
  entrada: Entrada,
  datos: Datos,
  contexto: Omit<ContextoDelCatalogo, 'otrasOpciones' | 'otrosGrupos' | 'ofertaPrevista'> & {
    otraFormacion: OtraFormacion;
    calculada: FormacionCalculada | null;
  },
  idioma: Idioma,
): Informe['aprendizaje'] {
  const { otraFormacion, calculada, ...delInforme } = contexto;
  const otrasOpciones = delInforme.transversal ? opcionesDeOtraFormacion(otraFormacion) : [];
  const deLaFormacion = {
    otrosGrupos: calculada?.otrosGrupos ?? [],
    ofertaPrevista: calculada?.ofertaPrevista ?? null,
  };
  return catalogoAprendizaje(entrada, datos, { ...delInforme, otrasOpciones, ...deLaFormacion }, idioma);
}

/** Un grupo con su título oficial en la lengua del informe. */
function grupoNombrado(lengua: Lengua, isco08: string) {
  return { isco08, tituloIsco: lengua.tituloIsco(isco08) };
}

/**
 * Cómo la confirmó la persona. Solo sin ocupación ESCO, con su palabra, con un segundo grupo o si el grupo lo propuso
 * la IA: un informe con ocupación ESCO y nada más no lleva este campo, porque su título ya lo dice todo.
 */
function confirmacionDe(
  entrada: Entrada,
  ocupacion: OcupacionConfirmada,
  lengua: Lengua,
): ConfirmacionOcupacion | null {
  // La API ya la ha limpiado de datos personales, puesto en una línea y recortado (api/textos-de-la-persona.ts).
  const palabra = entrada.ocupacionPersona || null;
  const propuestoPorIa = entrada.grupoPropuestoPorIa === true;
  const soloEsco = ocupacion.esco !== null && palabra === null && ocupacion.secundario === null;
  if (soloEsco && !propuestoPorIa) {
    return null;
  }
  const secundario = ocupacion.secundario === null ? null : grupoNombrado(lengua, ocupacion.secundario);
  const tituloEsco = ocupacion.esco === null ? null : lengua.tituloEsco(ocupacion.esco);
  const grupo = grupoNombrado(lengua, ocupacion.isco08);
  const texto = lengua.textos.confirmacion({ grupo, secundario, tituloEsco, palabra, propuestoPorIa });
  // La marca solo aparece si es cierta: el contrato la declara como `propuestoPorIa?: true`.
  return { texto, palabra, secundario, ...(propuestoPorIa ? { propuestoPorIa: true as const } : {}) };
}

/** La ocupación del informe: su título, su grupo, su nota media en la OIT y, si hace falta, cómo se confirmó. */
function ocupacionDelInforme(
  datos: Datos,
  entrada: Entrada,
  ocupacion: OcupacionConfirmada,
  lengua: Lengua,
): Informe['ocupacion'] {
  const isco = ocupacion.isco08;
  const oit = datos.oit.ocupaciones[isco];
  const { tituloIsco } = grupoNombrado(lengua, isco);
  const confirmada = confirmacionDe(entrada, ocupacion, lengua);
  const { nivelGradiente, sinNotaPublicada } = lengua.textos;
  return {
    esco: ocupacion.esco,
    titulo: ocupacion.esco === null ? tituloIsco : lengua.tituloEsco(ocupacion.esco),
    isco08: isco,
    tituloIsco,
    media: oit?.media ?? null,
    gradiente: oit?.gradiente ?? null,
    // La preparación OIT admite solo gradientes publicados, presentes en los textos ES/CA.
    nivel: oit?.gradiente ? (nivelGradiente[oit.gradiente] as string) : sinNotaPublicada,
    posicion: posicionEnLaOit(datos, isco),
    ...(confirmada ? { confirmada } : {}),
  };
}

/**
 * Los datos oficiales del grupo de la persona: su ocupación en Cataluña y el uso declarado de la IA en su grupo. Van en
 * bloques propios del informe: no cambian ninguna nota ni lo que recibe el modelo.
 */
function datosDelGrupo(
  datos: Datos,
  ocupacion: OcupacionConfirmada,
  lengua: Lengua,
): Pick<Informe, 'contexto' | 'usoDeclaradoIa' | 'fichaBarcelonaActiva'> {
  const ficha = fichaDeBarcelonaActiva(datos.barcelonaActiva, ocupacion.esco);
  return {
    contexto: contextoCataluna(datos, ocupacion.esco, ocupacion.isco08, lengua),
    usoDeclaradoIa: usoDeclaradoDeLaIa(datos, ocupacion.isco08, lengua),
    ...(ficha ? { fichaBarcelonaActiva: ficha } : {}),
  };
}

/** Las fuentes del plan: las del informe y las de su catálogo, una vez cada una y con el idioma en que se citan. */
function fuentesDelPlan(informe: Informe, lengua: Lengua, idioma: Idioma): Informe['aprendizaje']['fuentes'] {
  const idiomasFuentes = new Map(lengua.sinTraducir().map((dato) => [dato.texto, dato.idioma]));
  const fuentes = [...informe.fuentes, ...informe.aprendizaje.fuentes].map((fuente) => fuente.texto);
  return [...new Set(fuentes)].map((texto) => ({ texto, idioma: idiomasFuentes.get(texto) ?? idioma }));
}

/** La formación del informe, por bloques, y todos juntos con los nombres del informe (para citar sus fuentes). */
interface FormacionDelInforme {
  /** La formación que ha calculado el motor de cursos, o null si no está. */
  calculada: FormacionCalculada | null;
  formacion: Informe['formacion'];
  transversal: FormacionTransversal | null;
  otraFormacion: OtraFormacion;
  deLaFormacion: Pick<Informe, 'formacion' | 'formacionTransversal'> & OtraFormacion;
}

/**
 * La formación del informe: la oficial de la ocupación, la transversal y la de fuera del catálogo oficial, tal como la
 * ha calculado el motor de cursos (sin él, ninguna). Sus datos que llegan en su idioma se apuntan aquí, en un solo
 * sitio y en el orden del informe, que es el de la lista de datos sin traducir.
 */
function formacionDelInforme({ lengua }: AmbitoDelInforme, opciones: OpcionesInforme): FormacionDelInforme {
  const calculada = opciones.formacion ?? null;
  const formacion = calculada?.formacion ?? null;
  const transversal = calculada?.transversal ?? null;
  const otraFormacion: OtraFormacion = calculada?.otraFormacion ?? {};
  const originales = [
    ...originalesDeFormacion(formacion),
    ...originalesDeTransversal(transversal),
    ...originalesDeOtraFormacion(otraFormacion),
  ];
  for (const { texto, idioma } of originales) {
    lengua.original(texto, idioma);
  }
  return {
    calculada,
    formacion,
    transversal,
    otraFormacion,
    deLaFormacion: { formacion, formacionTransversal: transversal, ...otraFormacion },
  };
}

/**
 * Lo que se pide en su ocupación (necesidades formativas del SEPE) y cómo acreditar lo que ya sabe hacer: cada uno,
 * solo si el paquete lo trae y corresponde a su ocupación.
 */
function oficialesDeLaOcupacion(
  datos: Datos,
  ocupacion: OcupacionConfirmada,
  fecha: string,
  lengua: Lengua,
): Pick<Informe, 'necesidades' | 'acreditacion'> {
  const necesidades = necesidadesDe(datos, ocupacion.esco, ocupacion.isco08, lengua);
  const acreditacion = bloqueDeAcreditacion(datos, ocupacion, fecha, lengua.idioma);
  return { ...(necesidades.length ? { necesidades } : {}), ...(acreditacion ? { acreditacion } : {}) };
}

/**
 * Si el informe se ha hecho sin la IA de Faro: la web lo pide y nada de la entrada lo contradice. Una estimación
 * firmada o un grupo propuesto por la IA dicen que la IA sí intervino, y entonces el informe habla como siempre.
 */
function hechoSinIa(entrada: Entrada): Pick<Informe, 'sinIa'> {
  if (entrada.sinIa !== true || entrada.grupoPropuestoPorIa === true) {
    return {};
  }
  if (entrada.tareas.some((tarea) => tarea.estimacion)) {
    return {};
  }
  return { sinIa: { tareasPropias: entrada.tareas.filter((tarea) => !tarea.referencia).length } };
}

/** Un informe en otro idioma: con el aviso de sus traducciones y los datos que se quedan sin traducir. */
function traducido(informe: Informe, lengua: Lengua): Informe {
  return {
    ...informe,
    avisos: [...informe.avisos, ...avisosDeTraduccion(lengua)],
    sinTraducir: lengua.sinTraducir(),
  };
}

/** El informe con la marca legible por máquina de lo que escribió la IA (dominio/marca-del-informe.ts). */
function conSuMarca(informe: Informe, datos: Datos, { frasesTraducidas }: OpcionesInforme, entrada: Entrada): Informe {
  return {
    ...informe,
    marcaIa: marcaDelInforme(informe, datos, {
      ...(frasesTraducidas ? { frasesTraducidas } : {}),
      tareasOriginales: new Map(entrada.tareas.map((tarea) => [tarea.id, tarea])),
    }),
  };
}

/** Todas las tareas confirmadas, en el orden de exposición, tiempo y nota del informe. */
function tareasDelInforme(
  { entrada, datos, ocupacion, lengua }: AmbitoDelInforme,
  opciones: OpcionesInforme,
): { tareas: TareaInforme[]; sinReferencias: boolean } {
  // Las estimaciones son de su grupo principal: si no tiene referencias, ninguna tarea sin nota podía tenerla.
  const { politica, tareasSinEstimacion } = opciones;
  const sinReferencias = politica !== undefined && marcasDelGrupo(datos, ocupacion.isco08, politica).sinReferencias;
  // Todas las tareas confirmadas entran en el informe: ninguna se descarta en silencio.
  const deLasTareas = {
    datos,
    ocupacion,
    lengua,
    sinReferencias,
    ...(tareasSinEstimacion ? { tareasSinEstimacion } : {}),
  };
  const tareas = entrada.tareas.map((tarea) => tareaInforme(deLasTareas, tarea)).sort(ordenTareas);
  return { tareas, sinReferencias };
}

/** Los avisos del informe: los de lo que muestra y los de la ocupación. */
function avisosDelInforme(
  { entrada, datos, ocupacion, lengua }: AmbitoDelInforme,
  tareas: TareaInforme[],
  deLaFormacion: { formacion: Informe['formacion']; sinReferencias: boolean; formacionNoDisponible: boolean },
): string[] {
  return [
    ...avisosInforme(entrada, datos, tareas, { ...deLaFormacion, textos: lengua.textos }),
    ...avisosDeOcupacion(ocupacion, tareas, lengua),
  ];
}

/**
 * El informe, sección a sección y en su orden, con las fuentes del plan aún sin reunir (las de su catálogo). Cada
 * sección se calcula en el orden en que aparece: es el orden en que se apuntan los datos que llegan en su idioma.
 */
function redactarInforme(ambito: AmbitoDelInforme, opciones: OpcionesInforme): Informe {
  const { entrada, datos, ocupacion, lengua, idioma } = ambito;
  const delInforme = ocupacionDelInforme(datos, entrada, ocupacion, lengua);
  const { tareas, sinReferencias } = tareasDelInforme(ambito, opciones);
  const { tareasSinEstimacion } = opciones;
  const { calculada, formacion, transversal, otraFormacion, deLaFormacion } = formacionDelInforme(ambito, opciones);
  const delGrupo = datosDelGrupo(datos, ocupacion, lengua);
  const { textos } = lengua;
  return {
    version: VERSION_INFORME,
    // Solo un informe traducido dice su idioma: sin él, el informe está en castellano.
    ...(idioma === IDIOMA_POR_DEFECTO ? {} : { idioma }),
    fecha: entrada.fecha,
    ocupacion: delInforme,
    tareas,
    // Descartar una nota inválida no convierte una entrada con estimación en un informe sin IA.
    ...(tareasSinEstimacion?.size ? {} : hechoSinIa(entrada)),
    semana: repartoSemana(tareas),
    hallazgos: hallazgos(tareas, delInforme.posicion, { textos: textos.hallazgos, idioma, sinReferencias }),
    contexto: delGrupo.contexto,
    ...(delGrupo.fichaBarcelonaActiva ? { fichaBarcelonaActiva: delGrupo.fichaBarcelonaActiva } : {}),
    caminos: caminos(tareas, { textos: textos.caminos, idioma }),
    formacion,
    formacionTransversal: transversal,
    usoDeclaradoIa: delGrupo.usoDeclaradoIa,
    ...oficialesDeLaOcupacion(datos, ocupacion, entrada.fecha, lengua),
    ...otraFormacion,
    aprendizaje: catalogoDe(
      entrada,
      datos,
      { ocupacion, tareas, formacion, transversal, otraFormacion, calculada },
      idioma,
    ),
    plan: textos.plan.map((paso) => ({ ...paso })),
    fuentes: fuentesInforme(datos, deLaFormacion, citasDelGrupo(datos, delGrupo, lengua), lengua),
    limites: [...textos.limites],
    avisos: avisosDelInforme(ambito, tareas, { formacion, sinReferencias, formacionNoDisponible: calculada === null }),
    // Sin el motor de cursos, el informe lo dice: la presentación pone su aviso en lugar de la formación.
    ...(calculada === null ? { formacionNoDisponible: true as const } : {}),
  };
}

/**
 * Informe completo a partir de lo que confirma la persona, en el idioma de `opciones` (por defecto, en castellano).
 *
 * @param entrada - Lo que confirma la persona: su ocupación, sus tareas y la fecha.
 * @param datos - El paquete de datos.
 * @param opciones - El idioma, las traducciones de las frases de la IA, la política de estimación, el criterio del
 *   bloque transversal y la oferta de formación del despliegue.
 * @returns El informe, con su marca legible por máquina.
 * @throws {EntradaInvalida} Si la entrada no encaja con los datos.
 */
export function construirInforme(entrada: Entrada, datos: Datos, opciones: OpcionesInforme = {}): Informe {
  const idioma = opciones.idioma ?? IDIOMA_POR_DEFECTO;
  const ocupacion = comprobarEntradaInforme(entrada, datos);
  const lengua = crearLengua(datos, idioma, opciones.frasesTraducidas);
  const redactado = redactarInforme({ entrada, datos, ocupacion, lengua, idioma }, opciones);
  // Las fuentes del plan reúnen las del informe y las de su catálogo, con el idioma de todo lo ya apuntado.
  const informe: Informe = {
    ...redactado,
    aprendizaje: { ...redactado.aprendizaje, fuentes: fuentesDelPlan(redactado, lengua, idioma) },
  };
  return conSuMarca(idioma === IDIOMA_POR_DEFECTO ? informe : traducido(informe, lengua), datos, opciones, entrada);
}
