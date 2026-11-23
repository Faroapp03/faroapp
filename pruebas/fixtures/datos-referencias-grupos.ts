// Paquetes mínimos para probar la selección de referencias, la jerarquía y la confirmación sin API ni red.

import type { VectoresGuardados } from '../../src/comun/vectores.ts';
import type { Datos, DatosEsco, DatosOit } from '../../src/dominio/tipos-paquete.ts';

/** Paquete mínimo con las partes necesarias para estos contratos del dominio. */
export function datosMinimos(partes: Partial<Datos> = {}): Datos {
  return {
    esco: { competencias: [], ocupaciones: {} },
    oit: { fuente: { cita: '', aviso_adaptacion: '' }, ocupaciones: {}, tareas: {} },
    clasificaciones: { cno11: {}, isco08_es: {}, isco08_a_cno11: {} },
    cambra: {
      fuente: '',
      genero: { mujeres_exposicion_media_o_alta: 0, hombres_exposicion_media_o_alta: 0, pagina_impresa: 0 },
    },
    textos: { tareas: {}, competencias_por_ocupacion: {}, aviso_traduccion: '' },
    ...partes,
  };
}

/** Tarea oficial de un grupo, con nota o sin ella. */
export function tarea(isco08: string, nota: number | null, texto = isco08): DatosOit['tareas'][string] {
  return { isco08, indice: 0, texto_en: texto, nota, margen: null, metodo: null };
}

/** Ocupación ESCO de un grupo con su título. */
export function ocupacion(isco08: string, titulo: string): DatosEsco['ocupaciones'][string] {
  return { uri: titulo, isco08, titulo, competencias: [] };
}

/** Vectores cuantizados de una dimensión: positivos, negativos o nulos. */
export function vectores(ids: string[], componentes = ids.map(() => 1)): VectoresGuardados {
  return {
    modelo: 'prueba',
    dimensiones: 1,
    ids,
    escalas: ids.map(() => 1),
    datos: Buffer.from(Int8Array.from(componentes).buffer).toString('base64'),
  };
}
