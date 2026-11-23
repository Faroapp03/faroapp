// Enlaces de Barcelona Activa: ficha del Catàleg d'ocupacions por código ESCO exacto y formaciones de IA del Cibernàrium.
// Se conservan títulos, fechas y modalidad del paquete. Las próximas preceden a las en línea ya iniciadas; estas
// últimas se incluyen desde el inicio hasta el día anterior al fin. La selección por fechas no comprueba plazas
// ni el estado actual de la inscripción en la fuente.

import type {
  ActividadCibernarium,
  CibernariumDelInforme,
  DatosBarcelonaActiva,
  EdicionCibernarium,
} from '../../../compartido/contratos/tipos-barcelona-activa.ts';
import { compararPorCodigo } from '../../../src/comun/orden.js';
import { compararTexto } from '../../../src/comun/orden-alfabetico.ts';

export type {
  CibernariumDelInforme,
  DatosBarcelonaActiva,
  EdicionCibernarium,
  FormacionCibernarium,
} from '../../../compartido/contratos/tipos-barcelona-activa.ts';

// La ficha de Barcelona Activa es un dato de la ocupación: vive en compartido/ y se reexporta aquí.
export { fichaDeBarcelonaActiva } from '../../../compartido/utilidades/ficha-de-barcelona-activa.ts';

/** Una actividad en línea ya iniciada con el día de fin excluido. */
function enLineaIniciada(actividad: ActividadCibernarium, hoy: string): boolean {
  return actividad.modalidad === 'en-linea' && actividad.inicio <= hoy && actividad.fin > hoy;
}

/**
 * Si la inscripción está abierta hoy según la fuente: el botón visible el día de la consulta y el estado «abierta»
 * (DISP0). Un botón de otro día o una apertura futura no la acreditan.
 */
export function inscripcionAbiertaHoy(actividad: { readonly edicion?: EdicionCibernarium }): boolean {
  const inscripcion = actividad.edicion?.inscripcion;
  return inscripcion?.botonVisible === true && inscripcion.estado === 'abierta';
}

/**
 * La frontera de lectura del paquete: solo se aplica la edición propia de la actividad (`id-edicion-publicado`).
 * Una edición con otra vinculación (un paquete de forma anterior) no se aplica: sus hechos de edición no constan.
 */
function soloEdicionPropia(actividad: ActividadCibernarium): ActividadCibernarium {
  if (!actividad.edicion || (actividad.edicion.vinculacion as string) === 'id-edicion-publicado') {
    return actividad;
  }
  const { edicion: _otra, ...sinEdicion } = actividad;
  return sinEdicion;
}

/** Intervalo publicado de la edición propia: su ventana de acceso o sus sesiones; sin ellos, el de la actividad. */
function conEdicion(actividad: ActividadCibernarium): ActividadCibernarium {
  const edicion = actividad.edicion;
  if (!edicion) {
    return actividad;
  }
  const dias = edicion.sesiones.map((s) => s.fecha).sort();
  const modalidad =
    edicion.modalidad === 'en-linea' || edicion.modalidad === 'presencial' ? edicion.modalidad : actividad.modalidad;
  return {
    ...actividad,
    modalidad,
    inicio: edicion.disponibilidad?.desde ?? dias[0] ?? actividad.inicio,
    fin: edicion.disponibilidad?.hasta ?? dias.at(-1) ?? actividad.fin,
  };
}

/**
 * Lo que se ofrece: una edición «sin-plazas» no, porque es un hecho publicado. A tu ritmo, hasta su fin; con sesiones
 * fijas, solo antes de su inicio. Lo demás se ofrece antes de empezar y, en línea ya empezado, solo si la fuente muestra
 * el botón de inscripción y la da por abierta: sin esos hechos de hoy no hay nada que diga que aún se puede entrar.
 */
function vigente(actividad: ActividadCibernarium, hoy: string): boolean {
  const edicion = actividad.edicion;
  if (edicion?.plazas === 'sin-plazas') {
    return false;
  }
  if (edicion?.sincronia === 'a-tu-ritmo') {
    return actividad.fin >= hoy;
  }
  if (edicion?.sincronia === 'horario-fijo') {
    return actividad.inicio > hoy;
  }
  return actividad.inicio > hoy || (enLineaIniciada(actividad, hoy) && inscripcionAbiertaHoy(actividad));
}

/**
 * Las formaciones de IA del Cibernàrium del informe: primero las que empiezan después de `hoy`, de la más próxima a la
 * más lejana; detrás, las en línea ya iniciadas con hoy < fin, de la que termina antes a la que termina después. Null si
 * no queda ninguna o el paquete no las trae.
 *
 * @param datos - Los datos de Barcelona Activa, si el paquete los trae.
 * @param hoy - El día de hoy (AAAA-MM-DD).
 * @returns Las formaciones con su cita, o null.
 */
export function cibernariumDelInforme(
  datos: DatosBarcelonaActiva | undefined,
  hoy: string,
): CibernariumDelInforme | null {
  if (!datos) {
    return null;
  }
  const actividades = datos.cibernarium
    .map(soloEdicionPropia)
    .map(conEdicion)
    .filter((a) => vigente(a, hoy));
  const porTitulo = (a: ActividadCibernarium, b: ActividadCibernarium) => compararTexto(a.titulo, b.titulo, 'ca');
  const proximas = actividades
    .filter((actividad) => actividad.inicio > hoy)
    .sort((a, b) => compararPorCodigo(a.inicio, b.inicio) || porTitulo(a, b));
  const abiertas = actividades
    .filter((actividad) => actividad.inicio <= hoy)
    .sort((a, b) => compararPorCodigo(a.fin, b.fin) || porTitulo(a, b));
  const formaciones = [...proximas, ...abiertas].map(({ id, titulo, inicio, fin, modalidad, edicion }) => ({
    titulo,
    enlace: `${datos.url_actividad}${id}`,
    inicio,
    fin,
    modalidad,
    ...(edicion ? { edicion } : {}),
  }));
  return formaciones.length ? { formaciones, fuente: datos.cita, consulta: datos.consulta } : null;
}
