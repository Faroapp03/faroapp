// Contrato de metodos.json: el consenso de los métodos publicados de exposición a la IA por ocupación ISCO-08, que da la
// confianza de la exposición en el informe breve (dominio/informe-breve.ts). Lo escribe la cadena de datos
// (plataforma_datos/orquestacion/exportacion/metodos.py) desde el cálculo de consenso aportado como entrada
// operativa. El generador de ese cálculo no forma parte del producto. Aquí solo se definen sus tipos.

/** El tercio de exposición en que un método sitúa una ocupación, por su percentil entre todas las del método. */
export type Tercio = 'alto' | 'medio' | 'bajo';

/** Una ocupación: su tercio según la OIT y cuántos de los demás métodos con dato la sitúan en el mismo tercio. */
export interface ConsensoDeUnaOcupacion {
  tercio_oit: Tercio;
  /** Métodos (sin contar la OIT) que la sitúan en el mismo tercio que la OIT. */
  coinciden: number;
  /** Métodos (sin contar la OIT) con dato para la ocupación. */
  con_dato: number;
}

/** Un método publicado, con su cita y su licencia. */
export interface MetodoDeExposicion {
  nombre: string;
  autor: string;
  anio: number;
  url: string;
  licencia: string;
  cita: string;
}

/** El archivo metodos.json del paquete. */
export interface DatosMetodos {
  fecha: string;
  metodos: Record<string, MetodoDeExposicion>;
  criterio: string;
  ocupaciones: Record<string, ConsensoDeUnaOcupacion>;
}
