// El motor empaquetado de una construcción da los mismos recorridos y resultados que el de las fuentes.
//
// - Con el medidor del producto (motores/ocupaciones/herramientas/medir-casos.ts, con --traza): los 2.112 casos de los
//   tres bancos de motores/ocupaciones/banco/ (2.473 personas simuladas), su configuración y las claves de ruido de
//   cada banco. La medición del paquete tiene que ser comparable con la referencia y su `resultados` (paso de pantalla,
//   personas, recorridos y trazas) tiene que ser byte a byte el de las fuentes, en cada variante: el de la medición de
//   las fuentes que se dé o, si no, el de la huella de la referencia del README de los bancos.
// - Una muestra fija de 50 casos pasa por el Worker real del paquete en Chromium, Firefox y WebKit, en cada una de las
//   tres variantes propias de la muestra (normal, ruido: la opción de cada pregunta se sortea; sin-vectores: se retira
//   la tabla de vectores; no son la simulación de personas del medidor), y responde lo mismo que el motor de las
//   fuentes (motor-empaquetado/navegador.ts). Es una muestra en navegador, no el banco entero.
//
// Uso: npm run probar:motor-empaquetado -- <construcción, con web/>, que exige 12 de 12 sin omisiones; también
//   FARO_CONSTRUCCION=<construcción, con web/> node --test pruebas/web-recorrido-integral/motor-empaquetado.test.ts
//   FARO_VARIANTES=normal,ruido,sin-vectores y FARO_NAVEGADORES=chromium,firefox,webkit (vacías o ausentes, todas;
//   un nombre desconocido es un error) · FARO_FUENTES=<carpeta con <variante>.json, la medición de las fuentes; la
//   variante sin archivo se compara con la huella del README> · FARO_SALIDA=<carpeta donde dejar las mediciones del
//   paquete y la muestra de cada navegador y variante, navegador-<navegador>-<variante>.json; sin ella, todo va a una
//   carpeta temporal que se retira al terminar>.
// Sin FARO_CONSTRUCCION, los casos se saltan con su motivo: hace falta una construcción (npm run construir). Con ella
// en una ruta sin el motor empaquetado, la prueba falla: no se omite.

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import {
  huellaDeResultados,
  huellasDeReferencia,
  medir,
  prepararRaiz,
  variantesPedidas,
} from './motor-empaquetado/medicion.ts';
import { compararEnNavegador, muestraDelBanco, navegadoresPedidos } from './motor-empaquetado/navegador.ts';
import { prepararSalida } from './motor-empaquetado/salida.ts';

const CONSTRUCCION = process.env.FARO_CONSTRUCCION ?? '';
const WEB = join(CONSTRUCCION, 'web');
const MOTOR = join(WEB, 'motor/src/plataforma/navegador/motor.js');
if (CONSTRUCCION && !existsSync(MOTOR)) {
  throw new Error(`FARO_CONSTRUCCION no es una construcción: falta ${MOTOR}`);
}
const SIN_CONSTRUCCION = CONSTRUCCION ? false : 'sin construcción: FARO_CONSTRUCCION=<dist con web/>';
const PLAZO_DE_UNA_MEDICION_MS = 600_000;
/** El plazo de la muestra en un navegador y una variante: dura segundos (de 3 a 6 s medidos el 03/11/2026). */
const PLAZO_DE_LA_MUESTRA_MS = 180_000;
const MUESTRA = 50;
const CADA = 42;

const variantes = variantesPedidas(process.env.FARO_VARIANTES);
const navegadores = navegadoresPedidos(process.env.FARO_NAVEGADORES);
const raiz = SIN_CONSTRUCCION ? '' : mkdtempSync(join(tmpdir(), 'motor-empaquetado-'));
// La carpeta de las mediciones se crea y se comprueba antes de medir: un fallo aquí se ve en el acto, no al final.
const SALIDA = raiz && process.env.FARO_SALIDA ? prepararSalida(process.env.FARO_SALIDA) : raiz;
if (raiz) {
  prepararRaiz(WEB, join(raiz, 'producto'));
  // La raíz medida es temporal: se retira al terminar. Las mediciones solo se conservan con FARO_SALIDA, que es otra
  // carpeta; los enlaces de la raíz se retiran sin tocar lo que señalan.
  after(() => rmSync(raiz, { recursive: true, force: true }));
}

/** El `resultados` de una medición, como texto: lo que se compara byte a byte. */
const resultados = (archivo: string): string =>
  JSON.stringify((JSON.parse(readFileSync(archivo, 'utf8')) as { resultados: unknown }).resultados);

function primerCasoDistinto(paquete: string, fuentes: string): string {
  type Medido = { resultados: { banco?: string; id?: string }[] };
  const a = (JSON.parse(readFileSync(paquete, 'utf8')) as Medido).resultados;
  const b = (JSON.parse(readFileSync(fuentes, 'utf8')) as Medido).resultados;
  const i = a.findIndex((caso, n) => JSON.stringify(caso) !== JSON.stringify(b[n]));
  return i < 0 ? `distinto número de casos (${a.length} y ${b.length})` : `${a[i]?.banco}/${a[i]?.id} (caso ${i + 1})`;
}

for (const variante of variantes) {
  test(`medición ${variante}: los resultados del paquete son byte a byte los de las fuentes`, {
    skip: SIN_CONSTRUCCION,
    timeout: PLAZO_DE_UNA_MEDICION_MS,
  }, (t) => {
    const salida = join(SALIDA, `paquete-${variante}.json`);
    const hecho = medir(join(raiz, 'producto'), variante, salida, WEB);
    assert.equal(hecho.codigo, 0, hecho.texto);
    const { base } = JSON.parse(readFileSync(salida, 'utf8')) as { base: Record<string, unknown> };
    assert.equal(base.origen_bancos, 'original', 'la medición tiene que ser de los tres bancos enteros');
    assert.equal(base.comparable_con_la_referencia, true, 'la medición tiene que ser comparable con la referencia');
    const fuentes = process.env.FARO_FUENTES ? join(process.env.FARO_FUENTES, `${variante}.json`) : '';
    if (fuentes && existsSync(fuentes)) {
      const iguales = resultados(salida) === resultados(fuentes);
      assert.ok(iguales, `el paquete se aparta de las fuentes en ${primerCasoDistinto(salida, fuentes)}`);
    }
    t.diagnostic(`${hecho.texto.trim()} · resultados ${huellaDeResultados(salida)}`);
    assert.equal(huellaDeResultados(salida), huellasDeReferencia()[variante], hecho.texto);
  });
}

for (const navegador of navegadores) {
  for (const variante of variantes) {
    test(`${MUESTRA} casos del banco por el Worker del paquete en ${navegador}, variante ${variante}, responden lo mismo que las fuentes`, {
      skip: SIN_CONSTRUCCION,
      timeout: PLAZO_DE_LA_MUESTRA_MS,
    }, async (t) => {
      const casos = await muestraDelBanco(MUESTRA, CADA);
      assert.equal(casos.length, MUESTRA);
      const celda = await compararEnNavegador(t, WEB, casos, { navegador, variante });
      writeFileSync(join(SALIDA, `navegador-${navegador}-${variante}.json`), `${JSON.stringify(celda, null, 2)}\n`);
      const { version, comparados, conLaIa, distintos } = celda;
      t.diagnostic(
        `${navegador} ${version} · ${variante} · ${casos.length} casos · ${comparados} pasos · ${conLaIa} con la IA de la variante · ${distintos.length} distintos`,
      );
      assert.ok(comparados >= MUESTRA, `solo se han comparado ${comparados} pasos`);
      assert.equal(conLaIa, comparados, 'cada paso tiene que ser un paso calculado con la IA de la variante');
      assert.deepEqual(distintos, [], `${distintos.length} de ${comparados} pasos distintos`);
    });
  }
}
