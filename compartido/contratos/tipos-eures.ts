// Contrato de correspondencia-eures.json: la correspondencia oficial de EURES entre las ocupaciones ESCO y los códigos
// españoles de ocupación (CO-SISPE 2011). La lee la búsqueda de ocupaciones con el núcleo del paquete; formacion.json,
// que solo lee el motor de cursos, lleva la misma en su campo `ocupaciones`.

/** Cómo corresponde una ocupación ESCO a un código español de ocupación, según EURES. */
export type Correspondencia = 'exacta' | 'cercana' | 'amplia' | 'estrecha';

/** Por código ESCO de ocupación, sus códigos CO-SISPE como `[código, relación, etiqueta]`, en el orden de EURES. */
export type CorrespondenciasEures = Record<string, [codigo: string, relacion: Correspondencia, etiqueta: string][]>;

/** El archivo correspondencia-eures.json: la cita que pide su licencia y las correspondencias. */
export interface DatosEures {
  fuente: string;
  ocupaciones: CorrespondenciasEures;
}
