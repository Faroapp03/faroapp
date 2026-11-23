/** El idioma de una oferta en el plan: la misma decisión que pinta Cursos, con su origen. */
import type { EntregaCatalogo, OfertaCatalogo } from '../catalogo-cursos/contrato.ts';
import { orientadorDelCatalogo } from '../catalogo-cursos/idioma-cibernarium.ts';
import { type IdiomaConOrigen, idiomaConOrigen } from '../catalogo-cursos/proyeccion-listado.ts';

// Una orientación de Faro no la publica la fuente: el curso se propone con su origen dicho y el idioma, por confirmar.
const ORIENTACIONES_DE_FARO: ReadonlySet<IdiomaConOrigen['origen']> = new Set(['faro', 'historial-cibernarium']);

export type IdiomaDeOferta = (oferta: OfertaCatalogo) => IdiomaConOrigen;

/** Decide una vez por oferta en cada consulta, con el orientador de la entrega completa, como hace Cursos. */
export function idiomasDeLaEntrega(catalogo: EntregaCatalogo): IdiomaDeOferta {
  const orientar = orientadorDelCatalogo(catalogo);
  const decididos = new Map<OfertaCatalogo, IdiomaConOrigen>();
  return (oferta) => {
    const anterior = decididos.get(oferta);
    if (anterior) {
      return anterior;
    }
    const idioma = idiomaConOrigen(oferta, orientar);
    decididos.set(oferta, idioma);
    return idioma;
  };
}

/** Ni la fuente ni una orientación de Faro dicen en qué idioma se imparte el curso. */
function idiomaDesconocido(idioma: IdiomaConOrigen): boolean {
  return idioma.origen === null;
}

/** El idioma no lo publica la fuente: es una orientación de Faro o no consta. */
export function idiomaPorConfirmar(idioma: IdiomaConOrigen): boolean {
  return idiomaDesconocido(idioma) || ORIENTACIONES_DE_FARO.has(idioma.origen);
}

/**
 * Lo desconocido no descarta: solo deja fuera la oferta un idioma que consta, declarado por la fuente u orientado por
 * Faro, y que no es ninguno de los que pide la persona.
 */
export function idiomaAceptado(idioma: IdiomaConOrigen, preferencias: readonly string[]): boolean {
  return idiomaDesconocido(idioma) || idioma.idiomas.some((codigo) => preferencias.includes(codigo));
}
