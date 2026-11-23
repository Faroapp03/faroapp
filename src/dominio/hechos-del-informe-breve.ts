// Valores del registro editorial versionado de la plataforma. Validar su forma no renueva su revisión ni consulta la red.
import registro from '../../plataforma_datos/ia_y_trabajo/fuentes/hechos_informe/registro.json' with { type: 'json' };
import { nombresDeLosMeses } from '../comun/fechas.js';
import { leerHechosDelInforme, type RegistroHechosDelInforme } from './registro-hechos-del-informe.ts';
import type { Confianza } from './tipos-informe-breve.ts';

export const HECHOS_DEL_INFORME: RegistroHechosDelInforme = leerHechosDelInforme(registro);
const { capacidad, ofertas_ia: ofertas, proxima_tich: calendario, normas } = HECHOS_DEL_INFORME.afirmaciones;

/**
 * La confianza que admite cada tipo de afirmación de capacidad del registro: un resultado de ensayo mide pruebas de
 * laboratorio, no el puesto de nadie, y por eso nunca llega a alta.
 */
const CONFIANZA_DE_LA_CAPACIDAD: Readonly<Record<typeof capacidad.tipo, Confianza>> = Object.freeze({
  'resultado-de-ensayo': 'media',
});

/** Resultado de ensayo; no estima el trabajo de una persona. */
export const CAPACIDAD_DE_LA_IA = Object.freeze({
  pct: capacidad.porcentaje,
  horasPersona: capacidad.horas_persona,
  anio: capacidad.anio,
  confianza: CONFIANZA_DE_LA_CAPACIDAD[capacidad.tipo],
  fuente: `${capacidad.fuente.nombre}, ${capacidad.fuente.version}: ${capacidad.poblacion}`,
});

/** La fecha de la TIC-H en el calendario del INE: prevista, o ya pasada con sus valores publicados en el evento. */
export const PROXIMA_TICH = calendario.fecha;

/** El año de la edición de la TIC-H del calendario si su evento capturado ya trae los valores publicados; si no, null. */
export const TICH_PUBLICADA_SEGUN_CALENDARIO =
  calendario.estado === 'publicada-segun-calendario' ? calendario.periodo.slice('Año '.length) : null;

/** Proporción de anuncios de Indeed en España; no de todas las ofertas del país. */
export const OFERTAS_QUE_MENCIONAN_IA = Object.freeze({
  deCada100: ofertas.de_cada_100,
  anio: ofertas.anio,
  fuente: `${ofertas.fuente.nombre} (${ofertas.periodo})`,
});

/** Fecha de aplicación de la parte de alto riesgo declarada en el registro, no de todo el Reglamento. */
export const NORMAS_DE_ALTO_RIESGO = Object.freeze({
  aplicacion: normas.fecha,
  /** La fecha de aplicación que tenía antes de aplazarse. */
  aplazadaDesde: normas.fecha_anterior,
  fuente: normas.fuente.cita_corta,
});

/** Citas breves de las dos hojas; el registro conserva alcance y referencias completas. */
export const FUENTES_GENERALES = Object.freeze({
  oit: 'OIT/NASK 2025',
  osworld: capacidad.fuente.cita_corta,
  indeed: ofertas.fuente.cita_corta,
  normas: normas.fuente.cita_corta,
});

/** Posición de julio y de junio en el año, de 0 a 11. */
const JULIO = 6;
const JUNIO = 5;
/** El corte de los breves guardados sin periodo, el único que se admitía: de julio a junio. */
export const CORTE_ANTERIOR: readonly [string, string] = Object.freeze([
  nombresDeLosMeses('es')[JULIO] as string,
  nombresDeLosMeses('es')[JUNIO] as string,
]) as readonly [string, string];
