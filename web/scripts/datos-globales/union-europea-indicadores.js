// Los indicadores de la UE que nombran los capítulos UE·1 a UE·5 (union-europea-capitulos.js), escritos una sola vez,
// y qué apartados de una ficha tienen todas sus cifras: lo que se escribe en una ficha sale de cifras que existen.

import { ue } from './union-europea-piezas.js';

/**
 * @import { DatosGlobales } from './datos.js'
 */

/**
 * Los indicadores de la UE que nombran los capítulos UE·1 a UE·5, por su id en datos-globales.json: cada id se escribe
 * una sola vez, aquí, y una errata en un nombre no compila (npm run tipos). Que cada id exista en el archivo
 * publicado lo comprueba pruebas/web-datos-globales-capitulos/paginas.test.js. Los que se componen con una lista (TECNICAS,
 * EDADES y los usos de union-europea-capitulos.js) salen de esa lista y no están aquí.
 */
export const INDICADORES_UE = Object.freeze({
  capacidadesDigitalesBasicasHombres: 'capacidades-digitales-basicas-hombres',
  capacidadesDigitalesBasicasMujeres: 'capacidades-digitales-basicas-mujeres',
  empresasIa: 'empresas-ia',
  empresasIa10A49: 'empresas-ia-10-49',
  empresasIa250OMas: 'empresas-ia-250-o-mas',
  empresasIa50A249: 'empresas-ia-50-249',
  empresasIaMotivoConocimientos: 'empresas-ia-motivo-conocimientos',
  empresasIaMotivoDudasLegales: 'empresas-ia-motivo-dudas-legales',
  empresasIaMotivoLaPenso: 'empresas-ia-motivo-la-penso',
  empresasIaMotivoProteccionDatos: 'empresas-ia-motivo-proteccion-datos',
  empresasIaSeccionF: 'empresas-ia-seccion-f',
  empresasIaSeccionJ: 'empresas-ia-seccion-j',
  empresasIaTexto: 'empresas-ia-texto',
  hombresIaGenerativa: 'hombres-ia-generativa',
  hombresIaGenerativaTrabajo: 'hombres-ia-generativa-trabajo',
  iaGenerativa16A24: 'ia-generativa-16-24',
  iaGenerativa65A74: 'ia-generativa-65-74',
  iaGenerativaEducacionFormal: 'ia-generativa-educacion-formal',
  iaGenerativaEducacionFormalHombres: 'ia-generativa-educacion-formal-hombres',
  iaGenerativaEducacionFormalMujeres: 'ia-generativa-educacion-formal-mujeres',
  iaGenerativaNoLaUsaNoLaNecesita: 'ia-generativa-no-la-usa-no-la-necesita',
  iaGenerativaNoLaUsaNoSabeUsarla: 'ia-generativa-no-la-usa-no-sabe-usarla',
  iaGenerativaNoLaUsaNoSabiaQueExistia: 'ia-generativa-no-la-usa-no-sabia-que-existia',
  iaGenerativaNoLaUsaPrivacidadSeguridad: 'ia-generativa-no-la-usa-privacidad-seguridad',
  iaGenerativaTrabajoEstudios0A2: 'ia-generativa-trabajo-estudios-0-2',
  iaGenerativaTrabajoEstudios3A4: 'ia-generativa-trabajo-estudios-3-4',
  iaGenerativaTrabajoEstudios5A8: 'ia-generativa-trabajo-estudios-5-8',
  iaGenerativaTrabajoManual: 'ia-generativa-trabajo-manual',
  iaGenerativaTrabajoNoManual: 'ia-generativa-trabajo-no-manual',
  iaGenerativaTrabajoOcupados: 'ia-generativa-trabajo-ocupados',
  iaGenerativaTrabajoTic: 'ia-generativa-trabajo-tic',
  iaGenerativaUsoPrivado: 'ia-generativa-uso-privado',
  iaGenerativaUsoPrivadoHombres: 'ia-generativa-uso-privado-hombres',
  iaGenerativaUsoPrivadoMujeres: 'ia-generativa-uso-privado-mujeres',
  mujeresIaGenerativa: 'mujeres-ia-generativa',
  mujeresIaGenerativaTrabajo: 'mujeres-ia-generativa-trabajo',
  personasIaGenerativa: 'personas-ia-generativa',
  personasIaGenerativaTrabajo: 'personas-ia-generativa-trabajo',
  personasIaGenerativaUsuariosInternet: 'personas-ia-generativa-usuarios-internet',
});

/**
 * Los apartados de una ficha que tienen todas sus cifras, con sus valores escritos. Un apartado al que le falta alguna
 * no se pone: escribir 0 sería una cifra falsa (sin cifra oficial no se pone ninguna).
 * @param {DatosGlobales} datos Los datos del dossier.
 * @param {Readonly<Record<string, Readonly<Record<string, string>>>>} apartados Cada apartado con sus marcadores y el
 *   id del indicador de cada uno.
 * @param {(cifra: number) => string} escribir Cómo se escribe cada cifra.
 * @returns {{ conCifras: Set<string>, valores: Record<string, string> }} Los apartados completos y sus valores.
 */
export function apartadosConCifras(datos, apartados, escribir) {
  /** @type {Record<string, string>} */
  const valores = {};
  /** @type {Set<string>} */
  const conCifras = new Set();
  for (const [apartado, marcadores] of Object.entries(apartados)) {
    const cifras = Object.entries(marcadores).map(([marcador, id]) => /** @type {const} */ ([marcador, ue(datos, id)]));
    if (cifras.every(([, cifra]) => cifra !== null)) {
      conCifras.add(apartado);
      for (const [marcador, cifra] of cifras) {
        valores[marcador] = escribir(/** @type {number} */ (cifra));
      }
    }
  }
  return { conCifras, valores };
}
