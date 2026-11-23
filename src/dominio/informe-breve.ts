// Informe breve «La IA y tu trabajo»: las dos hojas de lo esencial (la IA y el mercado de trabajo), con las mismas
// reglas para todas las ocupaciones. La hoja de ruta de formación es un documento independiente.
// Parte del informe completo (informe.ts), que ya trae las tareas con su nota, el contexto de Cataluña y el uso
// declarado de la IA, y le añade el mercado de trabajo de mercado.json. No usa IA ni escribe frases: decide cifras,
// direcciones y confianzas, y la presentación (presentacion/informe-breve/) las escribe. Si falta un dato, su bloque no
// sale: nunca se rellena con el de otra ocupación.

import { nombresDeLosMeses } from '../comun/fechas.js';
import { codigosCno } from './contexto.ts';
import { contextoSectorial } from './contexto-sectorial.ts';
import { direccionDe } from './direcciones.ts';
import { franja } from './franjas.ts';
import { CAPACIDAD_DE_LA_IA, CORTE_ANTERIOR, NORMAS_DE_ALTO_RIESGO } from './hechos-del-informe-breve.ts';
import { detalleDeContratos, exposicionDelGrupo } from './informe-breve-contexto.ts';
import { aniosMedidos, senalDeLasPersonas } from './tich-en-el-informe-breve.ts';
import type { DatosEmpresas } from './tipos-contexto-empresarial.ts';
import type { Informe, TareaInforme } from './tipos-informe.ts';
import type {
  AnualBreve,
  ComarcasBreve,
  ComparacionContratacionDemandaBreve,
  Confianza,
  ContratacionBreve,
  EmpleoBreve,
  ExposicionBreve,
  FilaPerfil,
  InformeBreve,
  OfertasBreve,
  PerfilBreve,
  SalarioBreve,
  SenalBreve,
  TareaBreve,
  UsoBreve,
} from './tipos-informe-breve.ts';
import { VERSION_INFORME_BREVE } from './tipos-informe-breve.ts';
import type { DatosMercado, DatosOfertas, OfertasDeUnGrupo } from './tipos-mercado.ts';
import type { ConsensoDeUnaOcupacion } from './tipos-metodos.ts';
import type { Datos } from './tipos-paquete.ts';

/** Las notas van de 0 a 1 en los datos y de 0 a 100 en el informe; los porcentajes, igual. */
const POR_CIEN = 100;
/** Cifras significativas con que se limpia el ruido de la coma flotante antes de redondear. */
const CIFRAS_SIGNIFICATIVAS = 12;
/** Si más de un tercio del tiempo va a tareas sin nota, la exposición tiene confianza baja. */
const PARTES_DEL_TIEMPO = 3;
/** Diferencia entre los dos modelos de la OIT (en puntos) a partir de la cual la confianza es baja. */
const MAX_MARGEN_DE_LOS_MODELOS = 20;
/**
 * La confianza por métodos: hacen falta al menos tres con dato (contando la OIT); es alta si coinciden con la OIT 80 de
 * cada 100 o más, media desde 60 y baja por debajo.
 */
const MIN_METODOS = 3;
const PARTE_ALTA = 0.8;
const PARTE_MEDIA = 0.6;
/** Ancho del intervalo de la encuesta (en puntos) hasta el que la confianza es alta, y hasta el que es media. */
const INTERVALO_CONFIANZA_ALTA = 10;
const INTERVALO_CONFIANZA_MEDIA = 25;
/** Cuántas tareas menos expuestas se nombran, y con cuántas tareas con nota como mínimo. */
const MENOS_EXPUESTAS = 2;
const MIN_TAREAS_PARA_MENOS_EXPUESTAS = 3;
/** Cuántas comarcas se nombran; las demás van juntas. */
const COMARCAS_NOMBRADAS = 5;
/** Contratos mínimos en 12 meses para enseñar dónde se firman. */
const MIN_CONTRATOS_COMARCAS = 100;
/** «De cada 10 personas». */
const DE_CADA_10 = 10;
/** Los datos del perfil que enseña el informe breve, en su orden. */
const DATOS_DEL_PERFIL: readonly FilaPerfil['dato'][] = ['mujeres', 'menores30', 'mayores55', 'universitarios'];
/** El final de un periodo de 12 meses («12 meses a junio de 2026» → «junio de 2026»). */
const FIN_DEL_PERIODO = / a (\p{L}+ de \d{4})$/u;
/** El último mes de un periodo escrito en castellano («enero-septiembre de 2026» → septiembre, 2026). */
const ULTIMO_MES = /(\p{L}+) de (\d{4})$/u;
/** Un trimestre de la EPA («2026T2»). */
const TRIMESTRE = /^(\d{4})T([1-4])$/;
const MESES = nombresDeLosMeses('es'); // Los meses en castellano, como los escriben las fuentes.
/** Meses de un trimestre. */
const MESES_POR_TRIMESTRE = 3;

/**
 * Redondea a `decimales` cifras, la mitad hacia arriba (lejos del cero), después de quitar el ruido de la coma
 * flotante: 64,4999999 (que es 64,5) da 65, como en las cuentas a mano.
 *
 * @param valor - El número.
 * @param decimales - Cifras decimales.
 * @returns El número redondeado.
 */
export function redondear(valor: number, decimales = 0): number {
  const factor = 10 ** decimales;
  const limpio = Number((valor * factor).toPrecision(CIFRAS_SIGNIFICATIVAS));
  return (Math.sign(limpio) * Math.round(Math.abs(limpio))) / factor;
}

/** La suma de una lista de números. */
function suma(valores: readonly number[]): number {
  return valores.reduce((total, valor) => total + valor, 0);
}

/** El único valor de una lista, o null si hay varios distintos o ninguno. */
function unico(valores: readonly string[]): string | null {
  const distintos = [...new Set(valores)];
  return distintos.length === 1 ? (distintos[0] ?? null) : null;
}

/** Una tarea del informe con nota. */
type TareaConNota = TareaInforme & { valor: number };

/** De quién es la nota de una tarea (null si no tiene) y si es incierta. Solo la evidencia de la OIT es de la OIT. */
function procedenciaDe({ valor, evidencia, incierta }: TareaInforme): Pick<TareaBreve, 'origen' | 'incierta'> {
  if (valor === null) {
    return { origen: null, incierta };
  }
  return { origen: evidencia === 'estimacion-oit' ? 'oit' : 'faro', incierta };
}

/** La media de las tareas con nota ponderada por el tiempo, de 0 a 100. */
function mediaPonderada(tareas: readonly TareaConNota[], de: (tarea: TareaConNota) => number): number {
  const peso = suma(tareas.map((tarea) => tarea.peso));
  return redondear((POR_CIEN * suma(tareas.map((tarea) => tarea.peso * de(tarea)))) / peso);
}

/**
 * Cuántos métodos publicados (contando la OIT, que coincide consigo misma) sitúan la ocupación en el mismo tercio
 * que la
 * OIT, y la confianza que eso da; null si hay menos de MIN_METODOS con dato.
 */
function porMetodos(consenso: ConsensoDeUnaOcupacion | undefined) {
  if (!consenso || consenso.con_dato + 1 < MIN_METODOS) {
    return null;
  }
  const metodos = { coinciden: consenso.coinciden + 1, total: consenso.con_dato + 1, tercio: consenso.tercio_oit };
  const parte = metodos.coinciden / metodos.total;
  let confianza: Confianza = 'baja';
  if (parte >= PARTE_ALTA) {
    confianza = 'alta';
  } else if (parte >= PARTE_MEDIA) {
    confianza = 'media';
  }
  return { metodos, confianza };
}

/**
 * La confianza de la exposición: baja si más de un tercio del tiempo va a tareas sin nota; si no, la que dan los
 * métodos publicados (como mucho media si los dos modelos de la OIT se separan mucho); sin métodos, media, o baja si
 * los modelos se separan mucho.
 */
function confianzaDeLaExposicion(
  tareasSinNota: boolean,
  margenAncho: boolean,
  consenso: ConsensoDeUnaOcupacion | undefined,
): Pick<ExposicionBreve, 'confianza' | 'motivo' | 'metodos'> {
  const metodos = porMetodos(consenso);
  if (tareasSinNota) {
    return { confianza: 'baja', motivo: 'tareas-sin-nota', metodos: metodos?.metodos ?? null };
  }
  if (metodos) {
    const confianza = margenAncho && metodos.confianza === 'alta' ? 'media' : metodos.confianza;
    return { confianza, motivo: 'metodos', metodos: metodos.metodos };
  }
  return margenAncho
    ? { confianza: 'baja', motivo: 'margen-ancho', metodos: null }
    : { confianza: 'media', motivo: 'modelos', metodos: null };
}

/**
 * Conclusión 01: la media de la nota de la OIT de las tareas, ponderada por el tiempo que la persona dice dedicar a
 * cada una (mucho 3, algo 2, poco 1), con el margen entre los dos modelos del autor ponderado igual, y su confianza
 * (confianzaDeLaExposicion).
 */
function exposicionDe(
  tareas: readonly TareaInforme[],
  consenso: ConsensoDeUnaOcupacion | undefined,
): ExposicionBreve | null {
  const conNota = tareas.filter((tarea): tarea is TareaConNota => tarea.valor !== null);
  if (!conNota.length) {
    return null;
  }
  const valor = mediaPonderada(conNota, (tarea) => tarea.valor);
  const minimo = mediaPonderada(conNota, (tarea) => tarea.margen?.[0] ?? tarea.valor);
  const maximo = mediaPonderada(conNota, (tarea) => tarea.margen?.[1] ?? tarea.valor);
  const pesoTotal = suma(tareas.map((tarea) => tarea.peso));
  const pesoSinNota = pesoTotal - suma(conNota.map((tarea) => tarea.peso));
  const tareasSinNota = pesoSinNota * PARTES_DEL_TIEMPO > pesoTotal;
  return {
    valor,
    minimo,
    maximo,
    nivel: franja(valor / POR_CIEN),
    ...confianzaDeLaExposicion(tareasSinNota, maximo - minimo > MAX_MARGEN_DE_LOS_MODELOS, consenso),
    conNota: conNota.length,
    sinNota: tareas.length - conNota.length,
    estimadasPorFaro: conNota.filter((tarea) => procedenciaDe(tarea).origen === 'faro').length,
  };
}

/** La confianza de una cifra de encuesta según el ancho de su intervalo. */
function confianzaDelIntervalo([desde, hasta]: readonly [number, number]): Confianza {
  const ancho = hasta - desde;
  if (ancho <= INTERVALO_CONFIANZA_ALTA) {
    return 'alta';
  }
  return ancho <= INTERVALO_CONFIANZA_MEDIA ? 'media' : 'baja';
}

/**
 * Conclusión 02: cuántas personas del grupo dicen usar la IA generativa para trabajar. Primero, la de Cataluña de su
 * gran grupo, si la encuesta llega a las respuestas mínimas; si no, la de España que ya elige el informe completo
 * (uso-declarado-de-la-ia.ts).
 */
function usoDe(informe: Informe, datos: Datos): UsoBreve | null {
  const tich = datos.tich;
  const gran = informe.ocupacion.isco08.slice(0, 1);
  const enCataluna = tich?.cataluna_isco1?.[gran];
  if (tich && enCataluna && enCataluna.muestra >= tich.min_muestra) {
    return {
      deCada100: redondear(enCataluna.pct),
      intervalo: [redondear(enCataluna.ic95[0]), redondear(enCataluna.ic95[1])],
      anio: tich.anio,
      aniosMedidos: aniosMedidos(tich),
      ambito: 'cataluna',
      granGrupo: gran,
      grupo: null,
      confianza: confianzaDelIntervalo(enCataluna.ic95),
    };
  }
  const espana = informe.usoDeclaradoIa;
  if (!espana) {
    return null;
  }
  const esGranGrupo = /^\d$/.test(espana.codigo);
  return {
    deCada100: redondear(espana.pct),
    intervalo: [redondear(espana.intervalo[0]), redondear(espana.intervalo[1])],
    anio: espana.anio,
    aniosMedidos: datos.tich ? aniosMedidos(datos.tich) : [espana.anio],
    ambito: 'espana',
    granGrupo: esGranGrupo ? espana.codigo : null,
    grupo: esGranGrupo ? null : espana.grupo,
    confianza: confianzaDelIntervalo(espana.intervalo),
  };
}

/** Las tareas con su nota de 0 a 100, de la más expuesta a la menos; las que no tienen nota, al final. */
function tareasDe(tareas: readonly TareaInforme[]): TareaBreve[] {
  const breves = tareas.map((tarea) => {
    const valor = tarea.valor === null ? null : redondear(POR_CIEN * tarea.valor);
    return {
      tarea: {
        nombre: tarea.nombre,
        tiempo: tarea.tiempo,
        valor,
        franja: valor === null ? null : franja(valor / POR_CIEN),
        ...procedenciaDe(tarea),
      },
      peso: tarea.peso,
    };
  });
  return breves
    .toSorted((a, b) => (b.tarea.valor ?? -1) - (a.tarea.valor ?? -1) || b.peso - a.peso)
    .map(({ tarea }) => tarea);
}

/** Las dos tareas menos expuestas, si hay al menos tres con nota (con menos, la lista no diría nada nuevo). */
function menosExpuestasDe(tareas: readonly TareaBreve[]): TareaBreve[] {
  const conNota = tareas.filter((tarea) => tarea.valor !== null);
  return conNota.length < MIN_TAREAS_PARA_MENOS_EXPUESTAS ? [] : conNota.slice(-MENOS_EXPUESTAS).toReversed();
}

/**
 * Las personas contratadas en 12 meses en los grupos de la estadística de la ocupación (sumados si son varios) y su
 * variación anual, solo si la fuente la da para todos.
 */
function contratacionDe(informe: Informe): ContratacionBreve | null {
  const grupos = informe.contexto.contratacion;
  if (!grupos.length) {
    return null;
  }
  const personas = suma(grupos.map((grupo) => grupo.personas));
  const anterior = suma(grupos.map((grupo) => grupo.anterior ?? 0));
  const comparable = grupos.every((grupo) => grupo.variacion !== null && grupo.anterior !== null) && anterior > 0;
  const variacion = comparable ? POR_CIEN * (personas / anterior - 1) : null;
  const hasta = informe.contexto.periodo?.match(FIN_DEL_PERIODO)?.[1] ?? null;
  return {
    gruposCno: grupos.map((grupo) => grupo.cno11),
    personas,
    variacion,
    direccion: direccionDe(variacion),
    hasta,
  };
}

/** Las ofertas de los grupos de un nivel, sumadas, si la fuente publica todos; si falta alguno, null. */
function ofertasDelNivel(nivel: Record<string, OfertasDeUnGrupo> | undefined, codigos: readonly string[]) {
  const filas = codigos.map((codigo) => nivel?.[codigo]);
  if (!filas.length || filas.some((fila) => !fila)) {
    return null;
  }
  const presentes = filas.filter((fila): fila is OfertasDeUnGrupo => !!fila);
  const conAnterior = presentes.every((fila) => fila.anterior !== null);
  return {
    puestos: suma(presentes.map((fila) => fila.puestos)),
    anterior: conAnterior ? suma(presentes.map((fila) => fila.anterior ?? 0)) : null,
  };
}

/** Las ofertas de la ocupación, si no de su subgrupo o gran grupo; sin un total positivo no hay parte de cada 100. */
function ofertasDe(
  cnos: readonly string[],
  ofertas: DatosOfertas | null | undefined,
  datos: Datos,
): OfertasBreve | null {
  if (!(ofertas && cnos.length && ofertas.total > 0)) {
    return null;
  }
  const niveles = [
    { nivel: 'ocupacion', codigos: [...cnos], tabla: ofertas.cno4 },
    { nivel: 'grupo', codigos: [...new Set(cnos.map((cno) => cno.slice(0, 2)))], tabla: ofertas.cno2 },
    { nivel: 'grupo', codigos: [...new Set(cnos.map((cno) => cno.slice(0, 1)))], tabla: ofertas.cno1 },
  ] as const;
  for (const { nivel, codigos, tabla } of niveles) {
    const cifra = ofertasDelNivel(tabla, codigos);
    if (cifra && (nivel === 'ocupacion' || codigos.length === 1)) {
      const grupo = nivel === 'grupo' ? (datos.clasificaciones.cno11[codigos[0] ?? '']?.titulo ?? null) : null;
      return { ...pesoEnLasOfertas(cifra, ofertas), nivel, grupo, periodo: ofertas.periodo };
    }
  }
  return null;
}

/** De cada 100 ofertas, cuántas son de la ocupación este año y el anterior (si hay total), y hacia dónde ha ido. */
function pesoEnLasOfertas(
  cifra: { puestos: number; anterior: number | null },
  ofertas: DatosOfertas,
): Pick<OfertasBreve, 'pct' | 'pctAnterior' | 'direccion'> {
  const pct = (POR_CIEN * cifra.puestos) / ofertas.total;
  const conAnterior = cifra.anterior !== null && ofertas.total_anterior > 0;
  const pctAnterior = conAnterior ? (POR_CIEN * (cifra.anterior ?? 0)) / ofertas.total_anterior : null;
  const variacion = pctAnterior ? POR_CIEN * (pct / pctAnterior - 1) : null;
  return { pct, pctAnterior, direccion: direccionDe(variacion) };
}

/**
 * Las personas ocupadas: las de la EPA en el gran grupo de la ocupación (media de cuatro trimestres) o, sin ellas, las
 * del censo anual de su grupo, si es uno solo.
 */
function empleoDe(granGrupo: string | null, informe: Informe, mercado: DatosMercado | undefined): EmpleoBreve | null {
  const epa = granGrupo === null ? undefined : mercado?.empleo?.grandes_grupos[granGrupo];
  const trimestre = mercado?.empleo?.trimestres.at(-1);
  if (granGrupo !== null && epa && trimestre) {
    // La EPA es una encuesta por muestreo y nadie publica el error de la comparación entre dos medias de cuatro
    // trimestres que calcula Faro: el informe da las cifras y la variación, sin dirección.
    return {
      personas: epa.personas,
      variacion: epa.variacion_pct,
      direccion: 'sin-dato',
      anterior: epa.anterior,
      fuente: 'epa',
      codigo: granGrupo,
      grupo: null,
      hasta: trimestre,
    };
  }
  const [censo, ...otros] = informe.contexto.ocupados;
  if (!censo || otros.length) {
    return null;
  }
  const variacion = censo.variacion?.pct ?? null;
  return {
    personas: censo.personas,
    variacion,
    direccion: direccionDe(variacion),
    anterior: null,
    fuente: 'censo',
    codigo: censo.cno11,
    grupo: censo.grupo,
    hasta: censo.anio,
  };
}

/** El salario medio del grupo de la EAES que contiene el subgrupo de 2 cifras de la ocupación, si es uno solo. */
function salarioDe(cnos: readonly string[], mercado: DatosMercado | undefined): SalarioBreve | null {
  const salarios = mercado?.salarios;
  const cno2 = unico(cnos.map((cno) => cno.slice(0, 2)));
  const grupo = cno2 === null ? undefined : Object.values(salarios?.grupos ?? {}).find((g) => g.cno2.includes(cno2));
  if (!(salarios && grupo && grupo.total !== null)) {
    return null;
  }
  const variacion = grupo.anterior ? POR_CIEN * (grupo.total / grupo.anterior - 1) : null;
  const conBrecha = grupo.mujeres !== null && grupo.hombres !== null && grupo.hombres > 0;
  return {
    euros: grupo.total,
    variacion,
    direccion: direccionDe(variacion),
    anio: salarios.anio,
    anioAnterior: salarios.anio_anterior,
    brecha: conBrecha ? redondear(POR_CIEN * (1 - (grupo.mujeres ?? 0) / (grupo.hombres ?? 1))) : null,
    grupo: grupo.nombre,
  };
}

/** Los meses inicial y final de los doce meses de contratación; un periodo explícito inválido se rechaza. */
export function mesesDelPeriodoAnual(periodo: string): readonly [string, string] {
  const coincide = /^12 meses a (\p{L}+) de \d{4}$/u.exec(periodo);
  const mes = (MESES as readonly string[]).indexOf(coincide?.[1] ?? '');
  const hasta = MESES[mes];
  const desde = MESES[(mes + 1) % MESES.length];
  if (!(hasta && desde)) {
    throw new RangeError(`Periodo anual de contratación inesperado: ${periodo}`);
  }
  return [desde, hasta];
}

/** Los contratos por doce meses al corte, sumados si la ocupación tiene varios grupos y todos tienen serie. */
function anualDe(cnos: readonly string[], mercado: DatosMercado | undefined): AnualBreve | null {
  const anual = mercado?.anual;
  const series = cnos.map((cno) => anual?.cno4[cno]);
  if (!(anual && series.length) || series.some((serie) => !serie)) {
    return null;
  }
  const valores = anual.etiquetas.map((_, i) => suma(series.map((serie) => serie?.[i] ?? 0)));
  const periodo = mercado?.contratacion?.periodo;
  const explicito = periodo !== undefined && mesesDelPeriodoAnual(periodo)[1] !== CORTE_ANTERIOR[1];
  return {
    etiquetas: [...anual.etiquetas],
    valores,
    publicado: [...anual.publicado],
    ...(explicito ? { periodo } : {}),
  };
}

/** Los contratos de cada comarca, sumados entre los grupos de la ocupación; null si falta alguno. */
function contratosPorComarca(cnos: readonly string[], mercado: DatosMercado | undefined) {
  const porComarca = new Map<string, number>();
  let total = 0;
  for (const cno of cnos) {
    const deLaOcupacion = mercado?.comarcas?.cno4[cno];
    const todas = deLaOcupacion?.todas;
    if (!(deLaOcupacion && todas)) {
      return null;
    }
    total += deLaOcupacion.total;
    for (const [nombre, contratos] of todas) {
      porComarca.set(nombre, (porComarca.get(nombre) ?? 0) + contratos);
    }
  }
  return { total, comarcas: [...porComarca].toSorted((a, b) => b[1] - a[1]) };
}

/** Dónde se firman los contratos: las tres comarcas con más, de cada 100, y las demás juntas. */
function comarcasDe(cnos: readonly string[], datos: Datos): ComarcasBreve | null {
  const contratos = contratosPorComarca(cnos, datos.mercado);
  if (!contratos || contratos.total < MIN_CONTRATOS_COMARCAS) {
    return null;
  }
  const primeras = contratos.comarcas.slice(0, COMARCAS_NOMBRADAS).map(([nombre, numero]) => ({
    nombre,
    deCada100: redondear((POR_CIEN * numero) / contratos.total),
  }));
  return {
    primeras,
    resto: {
      comarcas: contratos.comarcas.length - primeras.length,
      deCada100: POR_CIEN - suma(primeras.map((comarca) => comarca.deCada100)),
    },
  };
}

type FilaDeComparacion = {
  contratadas: number | null;
  demandantes: NonNullable<DatosMercado['demandantes']>['cno4'][string] | null;
  variacionContratadas: number | null;
};

/** Reconstruye la relación anterior solo con variaciones de recuentos del mismo periodo. */
function relacionAnterior(filas: readonly FilaDeComparacion[], periodoCompatible: boolean): number | null {
  const comparable =
    periodoCompatible &&
    filas.every(
      (fila) =>
        fila.variacionContratadas !== null &&
        Number.isFinite(fila.variacionContratadas) &&
        fila.variacionContratadas > -1 &&
        fila.demandantes?.variacion_exacta != null &&
        Number.isFinite(fila.demandantes.variacion_exacta) &&
        fila.demandantes.variacion_exacta > -1,
    );
  return comparable
    ? suma(filas.map((fila) => (fila.contratadas ?? 0) / (1 + (fila.variacionContratadas ?? 0)))) /
        suma(
          filas.map((fila) => (fila.demandantes?.personas_12m ?? 0) / (1 + (fila.demandantes?.variacion_exacta ?? 0))),
        )
    : null;
}

/**
 * Compara recuentos distintos de contratación y demanda del mismo periodo, sin atribuirles una cohorte común.
 * El año anterior sale de las variaciones publicadas; si falta alguna o no permite reconstruir, no se compara.
 */
function comparacionContratacionDemandaDe(
  cnos: readonly string[],
  datos: Datos,
): ComparacionContratacionDemandaBreve | null {
  const periodo = datos.observatori?.periodo;
  if (!periodo || !/^12 meses a \p{L}+ de \d{4}$/u.test(periodo) || periodo !== datos.mercado?.demandantes?.periodo) {
    return null;
  }
  const filas = cnos.map((cno) => ({
    contratadas: datos.observatori?.cataluna.cno4[cno]?.personas_contratadas ?? null,
    demandantes: datos.mercado?.demandantes?.cno4[cno] ?? null,
    variacionContratadas: datos.mercado?.contratacion?.cno4[cno]?.variacion_exacta ?? null,
  }));
  if (
    !filas.length ||
    filas.some(
      (fila) =>
        fila.contratadas === null ||
        !Number.isFinite(fila.contratadas) ||
        fila.contratadas < 0 ||
        !Number.isFinite(fila.demandantes?.personas_12m) ||
        (fila.demandantes?.personas_12m ?? 0) <= 0,
    )
  ) {
    return null;
  }
  const contratadas = suma(filas.map((fila) => fila.contratadas ?? 0));
  const demandantes = suma(filas.map((fila) => fila.demandantes?.personas_12m ?? 0));
  const ratio = contratadas / demandantes;
  const anterior = relacionAnterior(filas, datos.mercado?.contratacion?.periodo === periodo);
  const variacion = anterior ? POR_CIEN * (ratio / anterior - 1) : null;
  return {
    gruposCno: [...cnos],
    personasContratadas: contratadas,
    personasDemandantes: demandantes,
    contratadasPorDemandante: ratio,
    anteriorContratadasPorDemandante: anterior,
    variacion,
    direccion: direccionDe(variacion),
    periodo,
  };
}

/** Quién trabaja en la ocupación (mujeres, edad y estudios) frente a todas las ocupaciones de Cataluña. */
function perfilDe(informe: Informe): PerfilBreve | null {
  const frente = informe.contexto.frente;
  if (!frente) {
    return null;
  }
  const todas = frente.bloques.flatMap((bloque) => bloque.filas);
  const filas = DATOS_DEL_PERFIL.flatMap((dato) => {
    const fila = todas.find((otra) => otra.dato === dato);
    return fila ? [{ dato, grupo: fila.grupo, conjunto: fila.conjunto }] : [];
  });
  if (!filas.length) {
    return null;
  }
  const cuando = [
    ...new Set(
      todas
        .filter((fila) => filas.some((f) => f.dato === fila.dato))
        .flatMap((fila) => ('anio' in fila.cuando ? [fila.cuando.anio] : [])),
    ),
  ].toSorted();
  const jovenes = filas.find((fila) => fila.dato === 'menores30');
  const mayores = filas.find((fila) => fila.dato === 'mayores55');
  const relevo =
    jovenes && mayores && jovenes.grupo > 0 && jovenes.conjunto > 0
      ? {
          grupo: redondear((DE_CADA_10 * mayores.grupo) / jovenes.grupo),
          conjunto: redondear((DE_CADA_10 * mayores.conjunto) / jovenes.conjunto),
        }
      : null;
  return { filas, cuando, relevo, grupo: { cno: frente.cno11, nombre: frente.grupo } };
}

/** La señal usa la base y clasificación declaradas del contrato ETICCE con Internet. */
function empresasDe(empresas: DatosEmpresas | undefined): DatosEmpresas | null {
  return empresas &&
    empresas.cataluna.total !== null &&
    empresas.encuesta.denominador === 'empresas con conexión a Internet' &&
    empresas.encuesta.clasificacion === 'CNAE-2025'
    ? empresas
    : null;
}

/** Las señales de «Qué vigilar»: las mismas para todos, con la de las personas de su grupo si hay cifra. */
function senalesDe(personas: SenalBreve | null, empresas: DatosEmpresas | null): SenalBreve[] {
  return [
    ...(empresas ? [{ clave: 'empresas', proxima: empresas.vigencia.siguiente_prevista } as const] : []),
    ...(personas ? [personas] : []),
    { clave: 'ofertas-ia', proxima: null },
    { clave: 'normas', proxima: NORMAS_DE_ALTO_RIESGO.aplicacion },
  ];
}

/** Un mes como número de meses desde el año 0 (para comparar), a partir de su texto en castellano o su trimestre. */
function mesDe(texto: string | null): number | null {
  const trimestre = texto?.match(TRIMESTRE);
  if (trimestre) {
    return Number(trimestre[1]) * MESES.length + Number(trimestre[2]) * MESES_POR_TRIMESTRE - 1;
  }
  const fin = texto?.match(ULTIMO_MES);
  const mes = fin ? MESES.indexOf(fin[1]?.toLowerCase() as (typeof MESES)[number]) : -1;
  return fin && mes >= 0 ? Number(fin[2]) * MESES.length + mes : null;
}

/** El mes de los datos más recientes que usa el informe, en castellano («septiembre de 2026»); null sin ninguno. */
function datosHastaDe(mercado: InformeBreve['mercado']): string | null {
  const meses = [mercado.contratacion?.hasta ?? null, mercado.empleo?.hasta ?? null]
    .map(mesDe)
    .filter((mes): mes is number => mes !== null);
  if (!meses.length) {
    return null;
  }
  const ultimo = Math.max(...meses);
  return `${MESES[ultimo % MESES.length]} de ${Math.floor(ultimo / MESES.length)}`;
}

/**
 * Los grupos de la estadística de la ocupación que tienen contratos en el Observatori. Uno sin contratos ni
 * demandantes (los bomberos forestales, por ejemplo) no cambia las sumas, igual que en la tarjeta de contratación;
 * uno con contratos al que le falte un dato sí deja fuera el bloque.
 */
function gruposConContratos(cnos: readonly string[], datos: Datos): string[] {
  return cnos.filter((cno) => (datos.observatori?.cataluna.cno4[cno]?.personas_contratadas ?? 0) > 0);
}

/**
 * El informe breve de una persona: las cifras y decisiones de sus dos primeras hojas, a partir de su informe completo
 * y del paquete de datos.
 *
 * @param informe - El informe completo (informe.ts).
 * @param datos - El paquete de datos.
 * @returns El informe breve.
 */
export function construirInformeBreve(informe: Informe, datos: Datos): InformeBreve {
  const { ocupacion } = informe;
  const idioma = informe.idioma ?? 'es';
  const cnos = codigosCno(datos, ocupacion.esco, ocupacion.isco08);
  const conContratos = gruposConContratos(cnos, datos);
  const granGrupo = unico(cnos.map((cno) => cno.slice(0, 1)));
  const tareas = tareasDe(informe.tareas);
  const uso = usoDe(informe, datos);
  const empresas = empresasDe(datos.empresas);
  const grupoOdee = exposicionDelGrupo(cnos, datos, idioma);
  const mercado = datos.mercado;
  const delMercado: InformeBreve['mercado'] = {
    contratacion: contratacionDe(informe),
    comparacionContratacionDemanda: comparacionContratacionDemandaDe(conContratos, datos),
    ofertas: ofertasDe(cnos, mercado?.ofertas, datos),
    empleo: empleoDe(granGrupo, informe, mercado),
    salario: salarioDe(cnos, mercado),
    anual: anualDe(conContratos, mercado),
    ...detalleDeContratos(conContratos, datos.observatori),
    comarcas: comarcasDe(conContratos, datos),
    perfil: perfilDe(informe),
  };
  return {
    version: VERSION_INFORME_BREVE,
    idioma,
    fecha: informe.fecha,
    ocupacion: { titulo: ocupacion.titulo, esco: ocupacion.esco, isco08: ocupacion.isco08, cno4: cnos, granGrupo },
    exposicion: exposicionDe(informe.tareas, datos.metodos?.ocupaciones[ocupacion.isco08]),
    ...(grupoOdee ? { grupoOdee } : {}),
    uso,
    capacidad: {
      deCada100: redondear(CAPACIDAD_DE_LA_IA.pct),
      horasPersona: CAPACIDAD_DE_LA_IA.horasPersona,
      anio: CAPACIDAD_DE_LA_IA.anio,
      confianza: CAPACIDAD_DE_LA_IA.confianza,
    },
    tareas,
    menosExpuestas: menosExpuestasDe(tareas),
    mercado: delMercado,
    empresas,
    sectores: contextoSectorial(cnos, datos.sectores),
    senales: senalesDe(uso ? senalDeLasPersonas(datos.tich) : null, empresas),
    datosHasta: datosHastaDe(delMercado),
  };
}
