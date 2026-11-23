// Relaciones ESCO compactas para Worker y navegador: cada ocupación recorre su tramo de un Int32Array común.
// Los pares conservan el orden del catálogo; el índice se codifica por dos, más uno para la relación opcional.

import type { DatosEsco } from '../dominio/tipos-paquete.ts';

/** Una relación de la ocupación con una competencia: su posición en el catálogo y si es esencial («e») u opcional («o»). */
type Relacion = DatosEsco['ocupaciones'][string]['competencias'] extends Iterable<infer Par> ? Par : never;

/** Las relaciones de una ocupación: su tramo del Int32Array común. */
class RelacionesDeUnaOcupacion implements Iterable<Relacion> {
  private readonly codigos: Int32Array;
  private readonly inicio: number;
  private readonly fin: number;

  constructor(codigos: Int32Array, inicio: number, fin: number) {
    this.codigos = codigos;
    this.inicio = inicio;
    this.fin = fin;
  }

  *[Symbol.iterator](): Iterator<Relacion> {
    for (let i = this.inicio; i < this.fin; i++) {
      // inicio y fin delimitan el tramo asignado dentro del array común.
      const codigo = this.codigos[i] as number;
      yield [codigo >> 1, codigo & 1 ? 'o' : 'e'];
    }
  }
}

/**
 * El catálogo ESCO recién leído, con las competencias de cada ocupación en el Int32Array común. No cambia el leído.
 * Los índices proceden del catálogo exportado: enteros no negativos menores que 2^30, representables con su relación.
 * Cada iterable se consume una sola vez, antes de asignar el almacenamiento común.
 *
 * @param esco - Los datos de ESCO.
 * @returns Los mismos datos con las relaciones en forma compacta.
 * @throws Error si una relación no es «e» ni «o».
 */
export function conRelacionesCompactas(esco: DatosEsco): DatosEsco {
  const ocupaciones = Object.entries(esco.ocupaciones).map(([codigo, ocupacion]) => ({
    codigo,
    ocupacion,
    relaciones: [...ocupacion.competencias],
  }));
  const codigos = new Int32Array(ocupaciones.reduce((suma, { relaciones }) => suma + relaciones.length, 0));
  let posicion = 0;
  const compactas: [string, DatosEsco['ocupaciones'][string]][] = [];
  for (const { codigo, ocupacion, relaciones } of ocupaciones) {
    const inicio = posicion;
    for (const [indice, relacion] of relaciones) {
      if (relacion !== 'e' && relacion !== 'o') {
        throw new Error(`Relación ESCO desconocida en ${codigo}: ${relacion}`);
      }
      codigos[posicion++] = indice * 2 + (relacion === 'o' ? 1 : 0);
    }
    compactas.push([codigo, { ...ocupacion, competencias: new RelacionesDeUnaOcupacion(codigos, inicio, posicion) }]);
  }
  return { ...esco, ocupaciones: Object.fromEntries(compactas) };
}
