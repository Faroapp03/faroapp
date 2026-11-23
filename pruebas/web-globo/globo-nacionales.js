// Una muestra de prueba con dos medidas nacionales: la de las empresas de Islandia (`empresas-ia-nacional-isl`) y la
// de las personas de Corea (`personas-ia-nacional-kor`), sobre la muestra de la página. La usan globo-datos.test.js y
// globo-panel.test.js para probar que la regla «tiene datos de la IA» y la ficha salen del contrato, sin lista de
// países. No es una prueba: npm test no lo ejecuta solo.

import { readFileSync } from 'node:fs';

/** Valores de las medidas nacionales de muestra, en porcentaje. */
const PORCENTAJE_ISLANDIA = 31.2;
const PORCENTAJE_COREA = 33.3;

/** Un indicador nacional medido, con su id y su nombre. */
/** @param {string} id @param {string} es @param {string} ca */
function indicador(id, es, ca) {
  return {
    id,
    nombre: { es, ca },
    definicion: { es: `${es}, según la encuesta nacional.`, ca: `${ca}, segons l'enquesta nacional.` },
    unidad: 'porcentaje',
    naturaleza: 'medido',
    fuente: 'Oficina de estadística de prueba',
    tabla: null,
    licencia: 'Licencia de prueba',
    url: 'https://example.org/',
    comparable: false,
    cobertura: 'mundo',
  };
}

/** Un país, con su nombre en cada idioma, y una cifra de un indicador. */
/** @param {string} iso3 @param {{es:string,ca:string}} nombre @param {string} id @param {number} valor */
function pais(iso3, nombre, id, valor) {
  return {
    codigo: iso3,
    iso3,
    tipo: 'pais',
    nombre,
    valores: [{ indicador: id, valor, anio: 2025, nota: null }],
  };
}

/** La muestra de la página con las dos medidas nacionales y sus países. @returns {unknown} */
export function conMedidasNacionales() {
  const datos = JSON.parse(readFileSync(new URL('../fixtures/datos-globales-muestra.json', import.meta.url), 'utf8'));
  datos.indicadores.push(
    indicador('empresas-ia-nacional-isl', 'Empresas de Islandia que usan IA', "Empreses d'Islàndia que fan servir IA"),
    indicador(
      'personas-ia-nacional-kor',
      'Personas de 3 años o más que han usado alguna vez IA generativa',
      'Persones de 3 anys o més que han fet servir alguna vegada IA generativa',
    ),
  );
  datos.territorios.push(
    pais('ISL', { es: 'Islandia', ca: 'Islàndia' }, 'empresas-ia-nacional-isl', PORCENTAJE_ISLANDIA),
    pais('KOR', { es: 'Corea del Sur', ca: 'Corea del Sud' }, 'personas-ia-nacional-kor', PORCENTAJE_COREA),
  );
  return datos;
}
