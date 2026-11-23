// Los idiomas de Faro, castellano y catalán: el contrato que comparten la app y los dos motores. Las demás piezas del
// idioma (valores por defecto y comprobación) están en src/comun/idioma.ts, que reexporta estas.

/** Los idiomas que admite la API, en el orden en que se documentan: de esta lista se deriva el tipo Idioma. */
export const IDIOMAS = ['es', 'ca'] as const;

/** Un idioma de Faro: castellano o catalán. */
export type Idioma = (typeof IDIOMAS)[number];
