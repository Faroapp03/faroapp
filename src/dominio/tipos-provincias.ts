// Contratos de la vista del Observatori del Treball que usa el dominio y de los contratos por provincia del informe.
// Conservan los indicadores, umbrales y rótulos del paquete, sin aplicar reglas de selección o reparto.

import type { IndicadoresObservatori } from './tipos-frente-al-conjunto.ts';

/** Las cuatro provincias de Cataluña, con su nombre oficial, el mismo en castellano y en catalán. */
export type Provincia = 'Barcelona' | 'Girona' | 'Lleida' | 'Tarragona';

/**
 * Paquete del Observatori del Treball (opcional). El motor lee los contratos por provincia, los indicadores de 12
 * meses de cada ocupación y de Cataluña, y la serie de contratos mensuales para el informe breve.
 */
export interface DatosObservatori {
  /** La fuente del paquete. */
  fuentes: { observatori: string };
  /**
   * Los 12 meses de los datos, como los rotula cataluna.json («12 meses a junio de 2026»): dice si son del mismo
   * periodo. Solo se compara con el periodo de los datos de contratación; lo que el informe enseña sale
   * del rótulo por idioma de `contrato_indefinido.contratos_firmados.periodo`.
   */
  periodo: string;
  /** Umbral de base: cada bloque lo aplica a sus contratos o demandantes, según la cifra que presenta. */
  min_base: number;
  mensual?: { meses: string[]; cno4: Record<string, { contratos: (number | null)[] }> };
  /** El rótulo de los 12 meses de los contratos firmados, por idioma para la presentación. */
  contrato_indefinido: { contratos_firmados: { periodo: { es: string; ca: string } } };
  cataluna: {
    /** `variacion_personas_contratadas`: la variación anual que publica la fuente para toda Cataluña, en %. */
    total: IndicadoresObservatori & { pct_indefinidos: number; variacion_personas_contratadas: number | null };
    cno4: Record<string, IndicadoresObservatori & { pct_indefinidos: number | null }>;
  };
  provincias: {
    /** Qué se cuenta en la tabla por provincia (contratos de 12 meses). */
    medida: string;
    /** Cita de la tabla del Idescat con que cada comarca va a su provincia. */
    cita: string;
    /** Comarcas con algún municipio en otra provincia, contadas en su provincia principal. */
    comarcas_partidas: string[];
    /** Contratos de 12 meses por provincia, solo de las ocupaciones con `min_base` contratos o más. */
    cno4: Record<string, Record<Provincia, number>>;
  };
}

/** Los contratos de la ocupación en una provincia y cuántos son de cada 100 de Cataluña (redondeado al entero). */
export interface ContratosEnLaProvincia {
  provincia: Provincia;
  contratos: number;
  deCada100: number;
}

/** Dónde se firman los contratos de la ocupación: las cuatro provincias, de más a menos contratos. */
export interface ProvinciasDeLaOcupacion {
  cno11: string;
  /** Nombre oficial del grupo, en el idioma del informe si hay traducción. */
  grupo: string;
  /** Los 12 meses de los contratos («de julio de 2025 a junio de 2026»), en el idioma del informe. */
  periodo: string;
  /** Contratos firmados en Cataluña: la suma de las cuatro provincias. */
  total: number;
  provincias: ContratosEnLaProvincia[];
}
