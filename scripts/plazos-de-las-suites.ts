// Plazos de las suites de Node de la batería global, fijados por medida: la ejecución más lenta en verde en el runner
// de GitHub, con el margen del proyecto y redondeada al minuto superior. La velocidad del runner varía entre
// ejecuciones (la suite de unidad, en verde, tardó de 544 a 892 s en ocho calidades del 19 al 23/11/2026), así que la
// medida es siempre la más lenta en verde, no la habitual. pruebas/herramientas/plazos-de-las-suites.test.ts ata
// cada plazo a su medida.

/** Margen del proyecto sobre lo medido en el runner. */
export const MARGEN_SOBRE_LA_MEDIDA = 1.2;

/** La suite de unidad más lenta en verde: 892,5 s con 6.268 casos (calidad 45114904107, 23/11/2026). */
export const MEDIDA_SUITE_UNIDAD_MS = 892_481;
/** 892,5 s × 1,2 = 1.071 s, redondeado a 18 min. */
export const PLAZO_SUITE_UNIDAD_MS = 1_080_000;

/**
 * Cuánto más lento fue el runner más lento medido: mediana de 1,54 en los 218 archivos de unidad que tardaron más de
 * 0,5 s en las calidades 45080492072 (22/11) y 45114904107 (23/11). La suite de unidad ya tiene su medida en ese runner;
 * la de navegador no (el 23/11 no terminó en verde), así que su medida se lleva a ese runner con este factor. El
 * plazo del motor lleva con la misma medida las pruebas de Python del runner normal al lento (VARIACION_DEL_RUNNER en
 * plataforma_datos/orquestacion/medidas_del_ciclo.py); pruebas/herramientas/workflow-presupuesto.test.ts exige que
 * las dos coincidan.
 */
export const VARIACION_DEL_RUNNER = 1.54;

/** La suite de navegador más lenta en verde: 373,3 s con 82 casos (calidad 44964466134, 22/11/2026, runner normal). */
export const MEDIDA_SUITE_NAVEGADOR_MS = 373_334;
/**
 * 373,3 s × 1,54 (runner lento) × 1,2 = 690 s, redondeado a 12 min. Cada caso tiene además su propio plazo
 * (PLAZO_POR_PASO_MS), así que un archivo con varios casos que agotan el suyo puede llegar solo a este plazo de suite.
 */
export const PLAZO_SUITE_NAVEGADOR_MS = 720_000;
