/** Fotografía del idioma y el nivel con que el motor de cursos presenta la oferta del SOC. */
import { bolsaDeCursos } from '../../motores/cursos/src/bolsa-de-cursos.ts';
import type { Datos } from '../../src/dominio/tipos-paquete.ts';
import type { DatoFotografiado, UnidadFotografiada } from './foto-cursos.ts';

/** Solo las dos partes del paquete que lee la bolsa del SOC: los cursos y los enlaces que oculta. */
export type PaqueteDelSoc = Required<Pick<Datos, 'formacion' | 'enlaces'>>;

// Un curso que la bolsa no ofrece el día de la copia (terminado u oculto) no muestra idioma ni nivel.
const FUERA_DE_LA_BOLSA: DatoFotografiado = { valor: null, origen: 'fuera-de-la-bolsa', estado: 'por-confirmar' };

function idiomaDeLaBolsa(idioma: string | null | undefined): DatoFotografiado {
  return idioma
    ? { valor: [idioma], origen: 'fuente', estado: 'fuente' }
    : { valor: [], origen: null, estado: 'por-confirmar' };
}

/** El nivel de la bolsa es la cualificación publicada de la especialidad en el catálogo del SEPE. */
function nivelDeLaBolsa(nivel: number | null): DatoFotografiado {
  return nivel === null
    ? { valor: null, origen: null, estado: 'por-confirmar' }
    : { valor: nivel, origen: 'especialidad-sepe', estado: 'fuente' };
}

/** Cada curso de formacion.json, evaluado el día de su copia para que la foto no dependa del reloj. */
export function fotoDelSoc(paquete: PaqueteDelSoc): UnidadFotografiada[] {
  const { formacion } = paquete;
  const bolsa = new Map(
    bolsaDeCursos(paquete as Datos, formacion.fecha_cursos)
      .filter((curso) => curso.fuente === 'soc')
      .map((curso) => [curso.id, curso]),
  );
  return formacion.cursos.map((curso) => {
    const clave = `soc:${curso.id}`;
    const enLaBolsa = bolsa.get(clave);
    return {
      clave,
      fuente: 'soc',
      titulo: curso.nombre,
      datos: enLaBolsa
        ? { idioma: idiomaDeLaBolsa(enLaBolsa.idioma), nivel: nivelDeLaBolsa(enLaBolsa.nivel) }
        : { idioma: FUERA_DE_LA_BOLSA, nivel: FUERA_DE_LA_BOLSA },
    };
  });
}
