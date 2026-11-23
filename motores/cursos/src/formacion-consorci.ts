// Ediciones y acciones previstas del Consorci para las especialidades elegidas: contacto, programa y vigencia.
// Las ediciones no terminadas se ordenan por inicio; las previstas carecen de fecha y se ordenan por curso y entidad.
// La selección no comprueba plazas: la inscripción y las próximas fechas se consultan con la entidad.
// El paquete validado usa identificadores de entidad e001… y modalidades admitidas por su cadena de datos.

import type {
  ContactoEntidad,
  DatosConsorci,
  EdicionConsorciOficial,
  EdicionesRelacionadas,
  EdicionRelacionada,
  EntidadConsorciOficial,
  MomentoCurso,
  PrevistaRelacionada,
  ProgramaOficial,
} from '../../../compartido/contratos/tipos-formacion.ts';
import { compararTexto } from '../../../src/comun/orden-alfabetico.ts';
import { esADistancia, esCopiaAntigua, momentoDelCurso, ordenDeConvocatorias } from './vigencia-cursos.ts';

/** Lo que una edición toma de su especialidad: su código en el catálogo, si es una sugerencia y su programa. */
interface DeLaEspecialidad {
  codigo: string;
  sugerencia: boolean;
  programa: ProgramaOficial | null;
}
/** La especialidad por la que se ofrece una edición, por el código que cita el Consorci; undefined si por ninguna. */
type EspecialidadDeLaEdicion = (codigo: string) => DeLaEspecialidad | undefined;

/**
 * El primer código de una especialidad, el que citan el Consorci y los cursos del SOC: el catálogo del SEPE guarda las
 * transversales con los dos («CTRD0046 (FCOI0046)») y las demás con uno solo («ADGD0108»).
 *
 * @param codigo - El código de la especialidad en el catálogo.
 * @returns Lo que va antes del primer espacio, o el código entero si no lleva ninguno.
 */
export function primerCodigo(codigo: string): string {
  const espacio = codigo.indexOf(' ');
  return espacio < 0 ? codigo : codigo.slice(0, espacio);
}

/** Una entrada propia del registro; una propiedad heredada no pertenece a los datos del paquete. */
function valorPropio<Valor>(registro: Readonly<Record<string, Valor>>, clave: string): Valor | undefined {
  return Object.hasOwn(registro, clave) ? registro[clave] : undefined;
}

/** Solo el contacto de una entidad o de una edición, sin el resto de su registro. */
function contactoDe({ entidad, web, correo, telefono, contacto_oficial }: ContactoEntidad): ContactoEntidad {
  return {
    entidad,
    web,
    correo,
    telefono,
    contacto_oficial,
  };
}

/** Una edición del Consorci tal como la enseña el informe, con su especialidad, su momento y su contacto. */
function edicionRelacionada(
  edicion: EdicionConsorciOficial,
  especialidad: DeLaEspecialidad,
  momento: MomentoCurso,
  comprobado: string,
): EdicionRelacionada {
  return {
    id: edicion.id,
    nombre: edicion.nombre,
    especialidad: especialidad.codigo,
    modalidad: edicion.modalidad,
    aDistancia: edicion.a_distancia,
    municipio: edicion.municipio,
    inicio: edicion.inicio,
    fin: edicion.fin,
    horas: edicion.horas,
    sugerencia: especialidad.sugerencia,
    momento,
    destinatarios: 'personas-ocupadas',
    comprobado,
    contacto: contactoDe(edicion),
    inscripcion: 'con-la-entidad',
    programa: especialidad.programa,
  };
}

/**
 * Las especialidades elegidas por su primer código (primerCodigo): el Consorci cita «CTRD0046». Si dos comparten el
 * primer código, cuenta la primera.
 *
 * @param especialidades - Las especialidades elegidas, en su orden; `relacion` dice si es una sugerencia de Faro.
 * @returns La especialidad de cada código que cita el Consorci.
 */
export function porPrimerCodigo(
  especialidades: Iterable<{ codigo: string; relacion?: string; programa: ProgramaOficial | null }>,
): EspecialidadDeLaEdicion {
  const elegidas = new Map<string, DeLaEspecialidad>();
  for (const { codigo, relacion, programa } of especialidades) {
    const primero = primerCodigo(codigo);
    if (!elegidas.has(primero)) {
      elegidas.set(primero, { codigo, sugerencia: relacion === 'sugerencia', programa });
    }
  }
  return (codigo) => elegidas.get(codigo);
}

/**
 * Ediciones del Consorci que se ofrecen el día `hoy`: todas las de una especialidad elegida que no han terminado, en
 * el orden de las convocatorias. Que no hayan terminado no acredita que queden plazas ni que sigan activas sin fin.
 *
 * @param consorci - Los datos del Consorci del paquete.
 * @param especialidadDe - La especialidad elegida de cada código que cita el Consorci (porPrimerCodigo).
 * @param hoy - El día de la consulta (AAAA-MM-DD).
 * @param codigos - Los códigos de las especialidades elegidas: con ellos, también sus acciones previstas, sin fecha.
 * @returns Las ediciones, las previstas, la fecha de la copia, si es antigua y el buscador del Consorci.
 */
export function edicionesDelConsorci(
  consorci: DatosConsorci,
  especialidadDe: EspecialidadDeLaEdicion,
  hoy: string,
  codigos: Iterable<string> = [],
): EdicionesRelacionadas {
  const ediciones: EdicionRelacionada[] = [];
  for (const edicion of consorci.ediciones) {
    const momento = momentoDelCurso(edicion, hoy);
    const especialidad = especialidadDe(edicion.especialidad);
    if (momento === 'terminado' || !especialidad) {
      continue;
    }
    ediciones.push(edicionRelacionada(edicion, especialidad, momento, consorci.fecha_copia));
  }
  return {
    ediciones: ediciones.sort(ordenDeConvocatorias),
    previstas: previstasDelConsorci(consorci, codigos, especialidadDe),
    fechaCopia: consorci.fecha_copia,
    copiaAntigua: esCopiaAntigua(consorci.fecha_copia, hoy),
    buscador: consorci.buscador,
  };
}

/**
 * Las previstas de una entidad cuyo nombre no se publica van detrás de las demás.
 *
 * @param prevista - Una acción prevista.
 * @returns 1 si su entidad no tiene nombre publicado; 0 si lo tiene.
 */
function rangoPorEntidad(prevista: PrevistaRelacionada): number {
  return prevista.contacto.entidad ? 0 : 1;
}

/**
 * El orden de las acciones previstas (ver previstasDelConsorci): por nombre del curso; dentro, las de una entidad sin
 * nombre publicado al final, y después por entidad, modalidad y municipio.
 *
 * @param a - Una acción prevista.
 * @param b - La otra.
 * @returns Negativo si `a` va antes, positivo si va después y 0 si van juntas.
 */
export function ordenDePrevistas(a: PrevistaRelacionada, b: PrevistaRelacionada): number {
  return (
    compararTexto(a.nombre, b.nombre, 'ca') ||
    rangoPorEntidad(a) - rangoPorEntidad(b) ||
    compararTexto(a.contacto.entidad ?? '', b.contacto.entidad ?? '', 'ca') ||
    compararTexto(a.modalidad, b.modalidad, 'ca') ||
    compararTexto(a.municipio, b.municipio, 'ca')
  );
}

/** Una acción prevista tal como la enseña el informe, sin el programa de su especialidad (lo añade quien llama). */
function previstaRelacionada(
  codigo: string,
  nombre: string,
  { modalidad, horas }: { modalidad: string; horas: string },
  entidad: EntidadConsorciOficial,
): Omit<PrevistaRelacionada, 'programa'> {
  return {
    especialidad: codigo,
    nombre,
    modalidad,
    horas,
    municipio: entidad.municipio,
    aDistancia: esADistancia(modalidad),
    contacto: contactoDe(entidad),
  };
}

/**
 * Acciones previstas de unas especialidades (por su primer código): una por entidad y modalidad, por nombre del curso
 * y, dentro, de la entidad; las de una entidad cuyo nombre no se publica, al final del curso. Los duplicados de
 * código completo, entidad y modalidad conservan la primera acción, incluidas sus horas.
 *
 * @param consorci - Los datos del Consorci del paquete.
 * @param codigos - Los códigos de las especialidades, tal como los guarda el catálogo.
 * @param especialidadDe - Si se da, cada prevista lleva el programa de su especialidad; sin él, ninguno.
 * @returns Las acciones previstas, en el orden de ordenDePrevistas.
 */
export function previstasDelConsorci(
  consorci: DatosConsorci,
  codigos: Iterable<string>,
  especialidadDe?: EspecialidadDeLaEdicion,
): PrevistaRelacionada[] {
  const previstas: PrevistaRelacionada[] = [];
  const vistas = new Set<string>();
  for (const codigo of codigos) {
    const primero = primerCodigo(codigo);
    const delCodigo = valorPropio(consorci.previstas, primero);
    if (!delCodigo) {
      continue;
    }
    for (const accion of delCodigo.acciones) {
      const clave = `${codigo}|${accion.entidad}|${accion.modalidad}`;
      const entidad = valorPropio(consorci.entidades, accion.entidad);
      if (vistas.has(clave) || !entidad) {
        continue;
      }
      vistas.add(clave);
      const programa = especialidadDe?.(primero)?.programa ?? null;
      previstas.push({ ...previstaRelacionada(codigo, delCodigo.nombre, accion, entidad), programa });
    }
  }
  return previstas.sort(ordenDePrevistas);
}

/**
 * Cuántas entidades distintas suelen ofrecer una especialidad, según las acciones previstas.
 *
 * @param consorci - Los datos del Consorci del paquete.
 * @param codigo - El código de la especialidad en el catálogo.
 * @returns El número de entidades, 0 si no tiene acciones previstas.
 */
export function entidadesQueLaOfrecen(consorci: DatosConsorci, codigo: string): number {
  const primero = primerCodigo(codigo);
  const acciones = valorPropio(consorci.previstas, primero)?.acciones ?? [];
  return new Set(acciones.map((accion) => accion.entidad)).size;
}

/**
 * Ediciones de una especialidad programadas en el Consorci pero aún sin fecha.
 *
 * @param consorci - Los datos del Consorci del paquete.
 * @param codigo - El código de la especialidad en el catálogo.
 * @returns El número de ediciones, 0 si no tiene ninguna.
 */
export function programadasSinFecha(consorci: DatosConsorci, codigo: string): number {
  const primero = primerCodigo(codigo);
  return valorPropio(consorci.programadas_sin_fecha, primero) ?? 0;
}
