// La ficha del Catàleg d'ocupacions de Barcelona Activa de una ocupación ESCO: un dato de la ocupación, no de la
// formación, que el informe enseña en su contexto aunque no esté el motor de cursos. Lo usan la app
// (dominio/informe.ts) y el motor de cursos, que lo reexporta. No importa nada de motores/ ni de src/.

/** Lo que mira la ficha de los datos de Barcelona Activa del paquete (DatosBarcelonaActiva en el motor de cursos). */
export interface FichasDeBarcelonaActiva {
  /** La dirección de una ficha del catálogo sin su identificador. */
  url_ficha: string;
  /** El identificador de la ficha de cada código ESCO que tiene una sola. */
  ocupaciones: Record<string, string>;
}

/**
 * La dirección de la ficha del Catàleg d'ocupacions de una ocupación, si el paquete tiene una sola para su código ESCO.
 *
 * @param datos - Los datos de Barcelona Activa, si el paquete los trae.
 * @param esco - El código de la ocupación ESCO, o null.
 * @returns La dirección de la ficha, o null.
 */
export function fichaDeBarcelonaActiva(datos: FichasDeBarcelonaActiva | undefined, esco: string | null): string | null {
  if (!datos || esco === null || !Object.hasOwn(datos.ocupaciones, esco)) {
    return null;
  }
  const ficha = datos.ocupaciones[esco];
  return ficha ? `${datos.url_ficha}${ficha}` : null;
}
