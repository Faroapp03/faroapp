// Lo que cubre la firma de una estimación: a qué está atada (una ocupación ESCO o, sin ella, un grupo ISCO-08), la
// tarea tal como se estimó y todo lo que se mostrará de ella. El informe solo acepta estimaciones que Faro ha emitido
// de verdad para esa tarea y esa ocupación o ese grupo (seguridad/firma.ts). Una estimación atada a una ocupación ESCO
// no vale para su grupo, ni al revés: cada una se calibró con un contexto distinto.

import { normalizar } from '../comun/texto.ts';
import type { OcupacionConfirmada } from '../dominio/ocupacion-confirmada.ts';
import type { TareaEntrada } from '../dominio/tipos-entrada.ts';
import { MAX_TAREA } from '../seguridad/limites.ts';
import { limpiarDatosPersonales } from '../seguridad/privacidad.ts';

/**
 * Versión del contenido firmado: si cambia lo que cubre la firma, sube y las firmas de otra versión dejan de valer.
 */
const VERSION_FIRMA = 4;

/** Una estimación de Faro tal como llega en la entrada del informe. */
export type EstimacionEntrada = NonNullable<TareaEntrada['estimacion']>;

/** A qué está atada una estimación: a una ocupación ESCO o a un grupo ISCO-08, nunca a los dos. */
export type AmbitoFirmado = { ocupacionEsco: string; grupoIsco08: null } | { ocupacionEsco: null; grupoIsco08: string };

/** Lo que cubre la firma: la versión, su ámbito, la tarea normalizada y todo lo que se muestra de la estimación. */
export type ContenidoFirmado = { v: typeof VERSION_FIRMA } & AmbitoFirmado & {
    tarea: string;
    valor: number;
    margen: [number, number];
    origen: EstimacionEntrada['origen'];
    referencias: NonNullable<EstimacionEntrada['referencias']>;
    incierta: boolean;
    referenciaCercana: string | null;
    iaPodria: string | null;
    loTuyo: string | null;
  };

/**
 * El ámbito de una ocupación confirmada: su ocupación ESCO si la eligió; si no, su grupo.
 *
 * @param ocupacion - La ocupación confirmada: su código ESCO (o null) y su grupo ISCO-08.
 * @returns El ámbito: la ocupación ESCO o, si no la eligió, el grupo.
 */
export function ambitoDe(ocupacion: Pick<OcupacionConfirmada, 'esco' | 'isco08'>): AmbitoFirmado {
  return ocupacion.esco === null
    ? { ocupacionEsco: null, grupoIsco08: ocupacion.isco08 }
    : { ocupacionEsco: ocupacion.esco, grupoIsco08: null };
}

/**
 * Los datos que se firman al emitir una estimación y se comprueban al recibirla en el informe. Se firman en JSON
 * canónico (JCS, RFC 8785: seguridad/firma.ts), así que el orden de los campos no importa; lo que cubren, sí: no se
 * cambia sin subir VERSION_FIRMA.
 *
 * @param ambito - El ámbito de la estimación.
 * @param tarea - El texto de la tarea estimada.
 * @param estimacion - La estimación que se firma.
 * @returns Los datos que se firman, en la forma de VERSION_FIRMA.
 */
export function contenidoFirmado(
  ambito: AmbitoFirmado,
  tarea: string,
  estimacion: EstimacionEntrada,
): ContenidoFirmado {
  return {
    v: VERSION_FIRMA,
    ...ambito,
    // La tarea se firma recortada y sin datos personales, como la recibió el estimador, y normalizada: el informe la
    // acepta aunque cambien mayúsculas, acentos o signos.
    tarea: normalizar(limpiarDatosPersonales(tarea.slice(0, MAX_TAREA)).texto),
    valor: estimacion.valor,
    margen: estimacion.margen,
    origen: estimacion.origen,
    referencias: estimacion.referencias ?? 'ocupacion',
    incierta: estimacion.incierta ?? false,
    referenciaCercana: estimacion.referenciaCercana ?? null,
    iaPodria: estimacion.iaPodria ?? null,
    loTuyo: estimacion.loTuyo ?? null,
  };
}
