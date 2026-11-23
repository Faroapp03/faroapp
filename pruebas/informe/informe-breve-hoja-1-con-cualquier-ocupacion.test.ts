/**
 * La hoja 1 impresa cabe con cero tareas para cualquier ocupación de los datos: el sitio que queda para las filas de la
 * lista, después del resto de la hoja (con su cabecera y su pie, que repiten el título de la ocupación), de «Lo que
 * sigue siendo tuyo» (con las menos expuestas que se generan con tres tareas con nota) y de la línea de papel, nunca es
 * negativo. Se calcula por la ruta real del reparto (huecoParaLasFilas, tareas-en-papel.ts). Recorre las ocupaciones
 * ESCO y los grupos ISCO-08 de cuatro cifras, en castellano y en catalán, sin navegador; la guardia de navegador mide lo
 * mismo en el papel con las ocupaciones de título más largo.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { construirInforme } from '../../src/dominio/informe.ts';
import { construirInformeBreve } from '../../src/dominio/informe-breve.ts';
import { cargarDatos } from '../../src/plataforma/node/datos.ts';
import { textosDeLaHoja } from '../../src/presentacion/informe-breve/hoja-ia.ts';
import { huecoParaLasFilas } from '../../src/presentacion/informe-breve/tareas-en-papel.ts';
import { titulos } from '../../src/presentacion/informe-breve.ts';

const DATOS = cargarDatos(fileURLToPath(new URL('../../datos/', import.meta.url)));
const FECHA = '2026-10-23';
const CIFRAS_DEL_GRUPO = 4;
const MIN_OCUPACIONES = 3000;
/** La nota de la primera tarea estimada, lo que sube la de cada una más y lo que se aparta su margen de ella. */
const NOTA_INICIAL = 0.5;
const SALTO = 0.1;
const MEDIO_MARGEN = 0.05;
const TAREAS = 3;
const MENOS_EXPUESTAS = 2;

/** La estimación de la tarea `i`: cada una, un poco más alta que la anterior. */
function estimacion(i: number) {
  const valor = NOTA_INICIAL + i * SALTO;
  return {
    valor,
    margen: [valor - MEDIO_MARGEN, valor + MEDIO_MARGEN] as [number, number],
    origen: 'faro' as const,
    referencias: 'ocupacion' as const,
    incierta: false,
  };
}

/** Las ocupaciones que se recorren: cada ocupación ESCO con su grupo y cada grupo ISCO-08 de cuatro cifras, solo. */
function ocupaciones(): { clave: string; esco?: string; isco08: string }[] {
  const esco = Object.entries(DATOS.esco.ocupaciones).map(([codigo, ocupacion]) => ({
    clave: `ESCO ${codigo}`,
    esco: codigo,
    isco08: ocupacion.isco08,
  }));
  const grupos = Object.keys(DATOS.clasificaciones.isco08_es)
    .filter((codigo) => codigo.length === CIFRAS_DEL_GRUPO)
    .map((codigo) => ({ clave: `ISCO ${codigo}`, isco08: codigo }));
  return [...esco, ...grupos];
}

for (const idioma of ['es', 'ca'] as const) {
  test(`${idioma}: la hoja 1 cabe con cero tareas con cualquier ocupación de los datos`, (t) => {
    let peor = { clave: '', libre: Number.POSITIVE_INFINITY };
    const sinSitio: string[] = [];
    const lista = ocupaciones();
    for (const { clave, esco, isco08 } of lista) {
      const informe = construirInforme(
        {
          isco08,
          ...(esco ? { ocupacionEsco: esco } : {}),
          fecha: FECHA,
          tareas: Array.from({ length: TAREAS }, (_, i) => ({
            id: `t${i + 1}`,
            texto: `Atender llamadas ${i}`,
            tiempo: 'mucho' as const,
            estimacion: estimacion(i),
          })),
        },
        DATOS,
        { idioma, formacion: null },
      );
      const breve = construirInformeBreve(informe, DATOS);
      assert.equal(breve.menosExpuestas.length, MENOS_EXPUESTAS, `${clave}: el informe lleva menos expuestas`);
      const libre = huecoParaLasFilas(breve, textosDeLaHoja(breve, titulos(informe).tituloTexto, idioma));
      if (libre < 0) {
        sinSitio.push(`${clave}: ${libre.toFixed(2)} cqi`);
      }
      if (libre < peor.libre) {
        peor = { clave, libre };
      }
    }
    t.diagnostic(`${idioma}: ${lista.length} ocupaciones; la peor, ${peor.clave}, deja ${peor.libre.toFixed(2)} cqi`);
    assert.ok(lista.length >= MIN_OCUPACIONES, `se recorren las ocupaciones de los datos (${lista.length})`);
    assert.deepEqual(sinSitio, [], `${idioma}: ocupaciones cuya hoja 1 no cabe con cero tareas`);
  });
}
