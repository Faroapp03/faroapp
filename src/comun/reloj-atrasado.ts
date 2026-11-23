/**
 * La fecha del dispositivo es anterior a la de los datos de Faro: el reloj está mal puesto. Se distingue de un catálogo
 * no válido para poder decirle a la persona que corrija su reloj. La regla es propia de cada sitio:
 * - catálogo de cursos: el reloj y el corte de la entrega son instantes UTC y se comparan exactos, sin margen;
 * - informe: la fecha es un día y se compara con el día de la copia más reciente de los cursos, que es un día de
 *   España; el día civil de cualquier lugar va, como mucho, un día por detrás, así que solo se lanza con dos o más días
 *   de diferencia.
 * Una fecha posterior no se puede acreditar como errónea con los datos y no lo lanza.
 */
export class RelojAtrasado extends Error {}
