// Fichas factuales de la oferta del paquete para las consultas del catálogo. Un programa del SEPE sin edición no es
// una inscripción. Se excluyen los cursos terminados según su fin publicado. El momento sale solo del calendario y la
// inscripción conserva el estado que respalda su propia evidencia: haber empezado no la confirma ni la degrada. Lo
// empezado sin inscripción confirmada va detrás del resto; se conserva el orden por momento, fecha y nombre. La selección personal acreditada pertenece a src/seleccion-formacion/.

import { FUENTES_DE_CURSOS } from '../../../compartido/contratos/filtros-de-cursos.ts';
import type { EdicionCibernarium } from '../../../compartido/contratos/tipos-barcelona-activa.ts';
import type { CursoCitilabOficial, MomentoCitilab } from '../../../compartido/contratos/tipos-citilab.ts';
import type { DestinatariosCurso, MomentoCurso } from '../../../compartido/contratos/tipos-formacion.ts';
import { nombreLegible } from '../../../src/dominio/nombres-legibles.ts';
import type { Datos } from '../../../src/dominio/tipos-paquete.ts';
import { cibernariumDelInforme, inscripcionAbiertaHoy } from './barcelona-activa.ts';
import { consorciDe, formacionComprobada, programaOficial } from './enlaces-comprobados.ts';
import { etiquetasDe } from './etiquetas-formacion.ts';
import { fichaVigente } from './formacion-abierta.ts';
import { momentoCitilab } from './formacion-citilab.ts';
import { edicionesDelConsorci, previstasDelConsorci } from './formacion-consorci.ts';
import { edicionesAbiertasDeFundae, fichaDeFundae, paraQuienDeFundae } from './formacion-fundae.ts';
import { OFERTA_POR_DEFECTO, type OfertaDeFormacion } from './oferta-de-formacion.ts';
import { momentoDelCurso } from './vigencia-cursos.ts';

// Las fuentes viven en compartido/contratos/filtros-de-cursos.ts: la app las usa sin cargar este motor.
export { FUENTES_DE_CURSOS };

/** Nivel de cualificación del catálogo; no expresa una etapa de aprendizaje de Faro. */
type Nivel = 1 | 2 | 3;

/**
 * La inscripción de una ficha según su evidencia: «confirmada» si la fuente acredita que se puede entrar (ventana de
 * acceso publicada, preinscripción abierta o continuidad declarada); «sin-verificar» si la fuente no lo publica.
 */
type InscripcionDeLaBolsa = 'confirmada' | 'sin-verificar';

/** El aviso de un curso empezado cuya inscripción no está confirmada. */
const AVISO_EMPEZADO_SIN_CONFIRMAR: Readonly<Record<'es' | 'ca', string>> = Object.freeze({
  es: 'Ya ha empezado. Consulta con el centro si aún admite inscripciones.',
  ca: 'Ja ha començat. Consulta amb el centre si encara admet inscripcions.',
});

/** Una ficha de la bolsa: un curso (con fecha o sin ella) o una acción prevista. */
export interface CursoDeLaBolsa {
  /** `<fuente>:<identificador en su fuente>`; `consorci-prevista:<código>` para una acción prevista. */
  id: string;
  fuente: (typeof FUENTES_DE_CURSOS)[number];
  /** Un curso o una acción prevista, sin fecha («pregunta a la entidad»). */
  tipo: 'curso' | 'prevista';
  nombre: string;
  /** El código de su especialidad (del catálogo del SEPE o propio del Consorci); vacío si no tiene. */
  especialidad: string;
  familia: string | null;
  nivel: Nivel | null;
  horas: number | null;
  /** Idioma publicado del curso, nunca el idioma de la web. */
  idioma?: string | null;
  /** Hechos de esta edición; no se heredan de otra. */
  edicion?: EdicionCibernarium;
  /** Si se sigue a distancia; null si admite las dos cosas o no se sabe. */
  aDistancia: boolean | null;
  municipio: string | null;
  inicio: string | null;
  fin: string | null;
  /** Su momento según el calendario publicado: por empezar, empezado o sin fecha. No dice nada de la inscripción. */
  momento: MomentoCurso;
  /** El estado de la inscripción que respalda la evidencia de la fuente. */
  inscripcion: InscripcionDeLaBolsa;
  /** Solo si ya ha empezado y la inscripción no está confirmada: qué hacer, en castellano y catalán. */
  aviso?: Readonly<Record<'es' | 'ca', string>>;
  /**
   * «Con fecha», como en la rúbrica de los jueces: tiene un inicio anunciado o la inscripción confirmada (a tu ritmo
   * dentro de su ventana, con la inscripción abierta o con la preinscripción abierta). Haber empezado no basta.
   */
  conFecha: boolean;
  /** Hasta cuándo se pide plaza, si la fuente lo publica (FUNDAE: el fin de la preinscripción). */
  plazo: string | null;
  destinatarios: DestinatariosCurso | null;
  /** A quién admite, en una frase, si la fuente lo publica (FUNDAE). */
  paraQuien: string | null;
  /** Si habla de inteligencia artificial en su nombre (o, en el Cibernàrium, si es de su oferta de IA). */
  conIa: boolean;
  /** Quién lo imparte (curso o edición) o quiénes lo ofrecen (acción prevista). */
  entidades: string[];
  /** La dirección del curso o la web de la entidad (Consorci); null si no hay. */
  enlace: string | null;
  /**
   * Qué abre `enlace`: la página del curso (con su inscripción o su preinscripción) o la web de la entidad, que es la
   * primera de `entidades` (el Consorci no publica una página por curso); null sin enlace.
   */
  enlaceEs: 'curso' | 'entidad' | null;
}

const NIVEL_BASICO: Nivel = 1;
const NIVEL_ALTO: Nivel = 3;

/** Lo que no cambia entre las fichas de una fuente sin fechas propias. */
const SIN_FECHAS = { inicio: null, fin: null, plazo: null, paraQuien: null } as const;

/**
 * El nivel de cualificación de un texto del catálogo («1», «2», «3» o más); null si no lo dice.
 *
 * @param texto - El nivel tal como lo publica la fuente.
 * @returns El nivel, con los superiores a 3 como 3.
 */
function nivelDe(texto: string | undefined): Nivel | null {
  const nivel = Number(texto);
  if (!Number.isInteger(nivel) || nivel < NIVEL_BASICO) {
    return null;
  }
  return nivel >= NIVEL_ALTO ? NIVEL_ALTO : (nivel as Nivel);
}

/**
 * Las horas como número.
 *
 * @param texto - Las horas tal como las publica la fuente.
 * @returns Las horas; null si no las dice.
 */
export function horasDe(texto: string | undefined): number | null {
  const horas = Number(texto);
  return Number.isFinite(horas) && horas > 0 ? horas : null;
}

/** Si un curso del SOC se sigue a distancia, por su modalidad; null si no se sabe. */
function aDistanciaDelSoc(modalidad: string): boolean | null {
  if (/telef|distancia|en l[ií]nia|online|virtual/iu.test(modalidad)) {
    return true;
  }
  return /presencial/iu.test(modalidad) ? false : null;
}

/** Fuera de la bolsa: lo desfasado (los cursos de la covid). */
function vigente(nombre: string): boolean {
  return !etiquetasDe(nombre).has('desfasada');
}

/** Una familia profesional del catálogo como se lee; null si no la dice (el catálogo pone «-»). */
function familiaLegible(familia: string | undefined): string | null {
  return familia && /[\p{L}\d]/u.test(familia) ? nombreLegible(familia) : null;
}

/** La familia y el nivel de una especialidad del catálogo del SEPE; null y null si no está. */
function familiaYNivelDe(datos: Datos, codigo: string): Pick<CursoDeLaBolsa, 'familia' | 'nivel'> {
  const catalogo = formacionComprobada(datos);
  const especialidad =
    catalogo && Object.hasOwn(catalogo.especialidades, codigo) ? catalogo.especialidades[codigo] : undefined;
  return {
    familia: familiaLegible(especialidad?.familia),
    nivel: nivelDe(especialidad?.nivel),
  };
}

/** Si una ficha se puede empezar o tiene un inicio anunciado: depende de la inscripción acreditada, no de haber empezado. */
function conFechaDe(momento: MomentoCurso, inscripcion: InscripcionDeLaBolsa): boolean {
  return momento === 'por-iniciar' || inscripcion === 'confirmada';
}

/**
 * Los cursos del SOC que no han terminado. Su `estado` («en inscripción») no acredita matrícula abierta: el SOC lo
 * marca también en cursos empezados, así que un curso empezado queda sin confirmar.
 */
function cursosDelSoc(datos: Datos, hoy: string): CursoDeLaBolsa[] {
  const catalogo = formacionComprobada(datos);
  return (catalogo?.cursos ?? []).flatMap((curso) => {
    const momento = momentoDelCurso(curso, hoy);
    if (momento === 'terminado') {
      return [];
    }
    const codigo = curso.especialidades[0] ?? '';
    return [
      {
        id: `soc:${curso.id}`,
        fuente: 'soc' as const,
        tipo: 'curso' as const,
        nombre: curso.nombre,
        especialidad: codigo,
        ...familiaYNivelDe(datos, codigo),
        horas: horasDe(curso.horas),
        aDistancia: aDistanciaDelSoc(curso.modalidad),
        municipio: curso.municipio || null,
        inicio: curso.inicio,
        fin: curso.fin,
        momento,
        inscripcion: 'sin-verificar' as const,
        conFecha: conFechaDe(momento, 'sin-verificar'),
        plazo: null,
        destinatarios: curso.destinatarios ?? null,
        paraQuien: null,
        conIa: etiquetasDe(curso.nombre).has('ia'),
        entidades: curso.centro ? [curso.centro] : [],
        enlace: curso.enlace || null,
        enlaceEs: curso.enlace ? ('curso' as const) : null,
      },
    ];
  });
}

/** Lo que el Consorci toma del catálogo del SEPE para cada código: el programa comprobado. */
function especialidadParaElConsorci(datos: Datos) {
  const programas = datos.enlaces?.programas;
  return (codigo: string) => ({ codigo, sugerencia: false, programa: programaOficial(codigo, programas) });
}

/** Las ediciones con fecha del Consorci que no han terminado; el Consorci no publica el estado de la inscripción. */
function edicionesDelConsorciEnLaBolsa(datos: Datos, hoy: string): CursoDeLaBolsa[] {
  const consorci = consorciDe(datos);
  if (!consorci) {
    return [];
  }
  return edicionesDelConsorci(consorci, especialidadParaElConsorci(datos), hoy).ediciones.map((e) => ({
    id: `consorci:${e.id}`,
    fuente: 'consorci',
    tipo: 'curso',
    nombre: e.nombre,
    especialidad: e.especialidad,
    ...familiaYNivelDe(datos, e.especialidad),
    horas: horasDe(e.horas),
    aDistancia: e.aDistancia,
    municipio: e.municipio || null,
    inicio: e.inicio,
    fin: e.fin,
    momento: e.momento,
    inscripcion: 'sin-verificar',
    conFecha: conFechaDe(e.momento, 'sin-verificar'),
    plazo: null,
    destinatarios: 'personas-ocupadas',
    paraQuien: null,
    conIa: etiquetasDe(e.nombre).has('ia'),
    entidades: e.contacto.entidad ? [e.contacto.entidad] : [],
    enlace: e.contacto.web,
    enlaceEs: e.contacto.web ? 'entidad' : null,
  }));
}

/** Las acciones previstas del Consorci, una ficha por curso: quiénes lo ofrecen y si alguna es a distancia. */
function previstasDelConsorciEnLaBolsa(datos: Datos): CursoDeLaBolsa[] {
  const consorci = consorciDe(datos);
  if (!consorci) {
    return [];
  }
  const porCodigo = new Map<string, ReturnType<typeof previstasDelConsorci>>();
  for (const prevista of previstasDelConsorci(
    consorci,
    Object.keys(consorci.previstas),
    especialidadParaElConsorci(datos),
  )) {
    porCodigo.set(prevista.especialidad, [...(porCodigo.get(prevista.especialidad) ?? []), prevista]);
  }
  return [...porCodigo].map(([codigo, previstas]) => {
    const primera = previstas[0];
    // La web que se enlaza es de una de las entidades: va la primera, para que la ficha diga de quién es.
    const conWeb = previstas.find((p) => p.contacto.web);
    const entidades = [conWeb, ...previstas].map((p) => p?.contacto.entidad).filter((e): e is string => Boolean(e));
    return {
      id: `consorci-prevista:${codigo}`,
      fuente: 'consorci',
      tipo: 'prevista',
      nombre: primera?.nombre ?? codigo,
      especialidad: codigo,
      ...familiaYNivelDe(datos, codigo),
      horas: horasDe(primera?.horas),
      aDistancia: previstas.some((p) => p.aDistancia) ? true : (primera?.aDistancia ?? null),
      municipio: null,
      ...SIN_FECHAS,
      momento: 'sin-fecha',
      inscripcion: 'sin-verificar',
      conFecha: false,
      destinatarios: 'personas-ocupadas',
      conIa: etiquetasDe(primera?.nombre ?? '').has('ia'),
      entidades: [...new Set(entidades)],
      enlace: conWeb?.contacto.web ?? null,
      enlaceEs: conWeb ? ('entidad' as const) : null,
    };
  });
}

/** Las ediciones de FUNDAE con la preinscripción abierta, a distancia, con su plazo y a quién admiten. */
function edicionesDeFundae(datos: Datos, hoy: string): CursoDeLaBolsa[] {
  const { fundae } = datos;
  return edicionesAbiertasDeFundae(fundae, hoy).map((e) => {
    const catalogo = formacionComprobada(datos);
    const delCatalogo =
      catalogo && Object.hasOwn(catalogo.especialidades, e.especialidad)
        ? catalogo.especialidades[e.especialidad]
        : undefined;
    const nombre = nombreLegible(delCatalogo?.nombre ?? e.nombre);
    return {
      id: `fundae:${e.id}`,
      fuente: 'fundae' as const,
      tipo: 'curso' as const,
      nombre,
      especialidad: e.especialidad,
      ...familiaYNivelDe(datos, e.especialidad),
      horas: e.horas,
      aDistancia: true,
      municipio: null,
      inicio: null,
      fin: null,
      momento: 'por-iniciar' as const,
      // La preinscripción abierta publicada, con su plazo, acredita que se puede pedir plaza.
      inscripcion: 'confirmada' as const,
      conFecha: true,
      plazo: e.preinscripcion.fin,
      destinatarios: 'personas-ocupadas' as const,
      paraQuien: paraQuienDeFundae(e, { breve: true }),
      conIa: etiquetasDe(nombre).has('ia'),
      entidades: [e.entidad],
      // La ficha del curso en la web de FUNDAE, con sus ediciones a distancia: allí se hace la preinscripción.
      enlace: fichaDeFundae(e.especialidad),
      enlaceEs: 'curso' as const,
    };
  });
}

/** El momento de Citilab en la bolsa, por su calendario: los periódicos y los de consultar no tienen fecha de inicio. */
function momentoDeCitilab(momento: MomentoCitilab): MomentoCurso {
  return momento === 'por-iniciar' || momento === 'iniciado' ? momento : 'sin-fecha';
}

/** Si un curso de Citilab entra en la bolsa: sin terminar y, sin `citilabDePago`, gratuito. */
function citilabEnLaOferta(curso: CursoCitilabOficial, hoy: string, citilabDePago: boolean): boolean {
  return !(curso.fin && curso.fin < hoy) && (citilabDePago || curso.coste.gratuito === true);
}

/**
 * Los cursos de Citilab que no han terminado, los que funcionan todo el curso y los que hay que consultar; sin
 * `citilabDePago`, solo los gratuitos. Citilab no publica si un curso empezado admite inscripciones: queda sin confirmar.
 */
function cursosDeCitilab(datos: Datos, hoy: string, { citilabDePago }: OfertaDeFormacion): CursoDeLaBolsa[] {
  return (datos.citilab?.cursos ?? []).flatMap((curso) => {
    const momento = momentoCitilab(curso, hoy);
    if (!citilabEnLaOferta(curso, hoy, citilabDePago)) {
      return [];
    }
    return [
      {
        id: `citilab:${curso.id}`,
        fuente: 'citilab' as const,
        tipo: 'curso' as const,
        nombre: curso.titulo,
        especialidad: '',
        familia: null,
        nivel: null,
        horas: curso.horas,
        aDistancia: curso.modalidad === null ? null : curso.modalidad === 'en-linea',
        municipio: curso.lugar?.municipio || null,
        inicio: curso.inicio,
        fin: curso.fin,
        momento: momentoDeCitilab(momento),
        inscripcion: 'sin-verificar' as const,
        // Un grupo que funciona todo el curso con su horario semanal se puede empezar ya.
        conFecha: momento === 'por-iniciar' || momento === 'periodico',
        plazo: null,
        destinatarios: null,
        paraQuien: null,
        conIa: curso.trata_ia,
        entidades: ['Citilab'],
        enlace: curso.enlace,
        enlaceEs: curso.enlace ? ('curso' as const) : null,
      },
    ];
  });
}

/** La modalidad revisada prevalece; desconocida no se convierte en presencial. */
function distanciaCibernarium(edicion: EdicionCibernarium | undefined, original: boolean): boolean | null {
  if (!edicion) {
    return original;
  }
  return edicion.modalidad === null ? null : edicion.modalidad === 'en-linea';
}

/** Las formaciones de IA del Cibernàrium que van a empezar y las en línea empezadas con la inscripción abierta. */
function formacionesDelCibernarium(datos: Datos, hoy: string): CursoDeLaBolsa[] {
  return (cibernariumDelInforme(datos.barcelonaActiva, hoy)?.formaciones ?? []).map((f) => ({
    id: `cibernarium:${f.enlace.slice(f.enlace.lastIndexOf('=') + 1)}`,
    fuente: 'cibernarium' as const,
    tipo: 'curso' as const,
    nombre: f.titulo,
    especialidad: '',
    familia: null,
    nivel: null,
    horas: f.edicion?.horas ?? null,
    idioma: f.edicion?.idioma ?? null,
    ...(f.edicion ? { edicion: f.edicion } : {}),
    aDistancia: distanciaCibernarium(f.edicion, f.modalidad === 'en-linea'),
    municipio: null,
    inicio: f.inicio,
    fin: f.fin,
    momento: f.inicio <= hoy ? ('iniciado' as const) : ('por-iniciar' as const),
    // Solo el botón visible hoy con la inscripción abierta confirma que se puede entrar; si no, queda sin verificar.
    inscripcion: inscripcionAbiertaHoy(f) ? ('confirmada' as const) : ('sin-verificar' as const),
    conFecha: f.inicio > hoy || inscripcionAbiertaHoy(f),
    plazo: null,
    destinatarios: null,
    paraQuien: null,
    conIa: true,
    entidades: ['Barcelona Activa (Cibernàrium)'],
    enlace: f.enlace,
    enlaceEs: 'curso' as const,
  }));
}

/** La formación abierta en línea vigente que la oferta admite: de titular público o, en «gratis», también la demás. */
function formacionAbierta(datos: Datos, hoy: string, { formacionAbierta: modo }: OfertaDeFormacion): CursoDeLaBolsa[] {
  if (modo === 'no') {
    return [];
  }
  return (datos.formacionAbierta?.fichas ?? [])
    .filter((ficha) => (modo === 'gratis' || ficha.titular === 'publico') && fichaVigente(ficha, hoy))
    .map((ficha) => ({
      id: `abierta:${ficha.id}`,
      fuente: 'abierta' as const,
      tipo: 'curso' as const,
      nombre: ficha.titulo,
      especialidad: '',
      familia: null,
      nivel: null,
      horas: ficha.horas,
      aDistancia: true,
      municipio: null,
      inicio: ficha.inicio,
      fin: ficha.fin,
      momento: ficha.inicio > hoy ? ('por-iniciar' as const) : ('iniciado' as const),
      // La entidad publica desde cuándo se puede empezar y hasta cuándo seguir: el acceso está acreditado.
      inscripcion: 'confirmada' as const,
      conFecha: true,
      plazo: null,
      destinatarios: null,
      paraQuien: ficha.dirigido_a ? `Para ${ficha.dirigido_a}` : null,
      conIa: ficha.tema === 'ia' || etiquetasDe(ficha.titulo).has('ia'),
      entidades: [ficha.entidad],
      enlace: ficha.enlace,
      enlaceEs: ficha.enlace ? ('curso' as const) : null,
    }));
}

const RANGO = { conFecha: 0, sinFecha: 1, sinConfirmar: 2 } as const;

/** Ya ha empezado según su calendario y la fuente no confirma que admita inscripciones. */
function empezadoSinConfirmar(curso: Pick<CursoDeLaBolsa, 'momento' | 'inscripcion'>): boolean {
  return curso.momento === 'iniciado' && curso.inscripcion !== 'confirmada';
}

/**
 * El orden de la bolsa: lo que se puede empezar antes, después lo que no tiene fecha y al final lo empezado sin
 * confirmar, que no desplaza a lo que admite inscripción.
 */
function ordenDeLaBolsa(a: CursoDeLaBolsa, b: CursoDeLaBolsa): number {
  const rango = (c: CursoDeLaBolsa): number => {
    if (empezadoSinConfirmar(c)) {
      return RANGO.sinConfirmar;
    }
    return c.conFecha ? RANGO.conFecha : RANGO.sinFecha;
  };
  // Con la preinscripción abierta (FUNDAE), como lo que ya se puede empezar.
  const cuando = (c: CursoDeLaBolsa): string => c.inicio ?? (c.plazo ? '' : '9999');
  return (
    rango(a) - rango(b) ||
    cuando(a).localeCompare(cuando(b)) ||
    a.nombre.localeCompare(b.nombre, 'es') ||
    Number(a.id > b.id) - Number(a.id < b.id)
  );
}

/**
 * La bolsa de cursos del paquete el día `hoy`: todas las fichas de todas las fuentes, sin lo terminado ni lo desfasado,
 * ordenadas (primero lo que se puede empezar antes; al final lo empezado sin confirmar).
 *
 * @param datos - El paquete de datos.
 * @param hoy - El día de la consulta (AAAA-MM-DD).
 * @param oferta - La oferta del despliegue: qué formación abierta y si los cursos de pago de Citilab.
 * @returns Las fichas; sin formación en el paquete, ninguna.
 */
export function bolsaDeCursos(
  datos: Datos,
  hoy: string,
  oferta: OfertaDeFormacion = OFERTA_POR_DEFECTO,
): CursoDeLaBolsa[] {
  return [
    ...cursosDelSoc(datos, hoy),
    ...edicionesDelConsorciEnLaBolsa(datos, hoy),
    ...previstasDelConsorciEnLaBolsa(datos),
    ...edicionesDeFundae(datos, hoy),
    ...cursosDeCitilab(datos, hoy, oferta),
    ...formacionesDelCibernarium(datos, hoy),
    ...formacionAbierta(datos, hoy, oferta),
  ]
    .filter((curso) => vigente(curso.nombre))
    .map((curso) => (empezadoSinConfirmar(curso) ? { ...curso, aviso: AVISO_EMPEZADO_SIN_CONFIRMAR } : curso))
    .sort(ordenDeLaBolsa);
}
