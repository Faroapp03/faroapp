import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { esObjeto } from '../../src/comun/json.ts';
import { diaUtc, esDiaReal, MS_POR_MINUTO } from '../../src/comun/tiempo.ts';
import {
  ARCHIVO_DE_CADA_PARTE,
  ARCHIVOS_EXTRA_DEL_PAQUETE,
  MANIFIESTO,
} from '../../src/plataforma/archivos-del-paquete.ts';

const CARPETA = new URL('../../datos/', import.meta.url);
const UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const TABLA_PRIVADA_DE_LA_CAMBRA = 'cambra.json';

test('el paquete oficial solo contiene sus datos declarados y cada archivo conserva su huella', () => {
  // Los archivos extra (vectores y clasificador del móvil) también están en el manifiesto: ARCHIVOS_EXTRA_DEL_PAQUETE.
  const esperados = [
    ...Object.values(ARCHIVO_DE_CADA_PARTE),
    ...Object.values(ARCHIVOS_EXTRA_DEL_PAQUETE),
    'nombres.json',
    'derechos.json',
  ].sort();
  const manifiesto: unknown = JSON.parse(UTF8.decode(readFileSync(new URL(MANIFIESTO, CARPETA))));
  assert.ok(esObjeto(manifiesto));
  assert.deepEqual(Object.keys(manifiesto).sort(), esperados);
  // El registro editorial y sus observaciones son entradas de Biblioteca; no viajan en el paquete.
  // Se cotejan con el HTML público y su proyección mínima en las pruebas de construcción y de Biblioteca.
  assert.deepEqual(
    // cambra.json, si está, es la tabla privada del ODEE y la Cambra: solo la leen las pruebas de los cálculos del
    // estudio; no está en el manifiesto y no se publica (pruebas/paquetes/exposicion-cambra.test.ts).
    readdirSync(CARPETA)
      .filter((nombre) => nombre !== TABLA_PRIVADA_DE_LA_CAMBRA)
      .sort(),
    // vectores-movil/: los binarios de la tabla de vectores, de los que sale vectores-movil.json (herramientas/vectores-movil);
    // fuentes/: las entradas verificables de los generadores; no son archivos del paquete descargable.
    [
      ...esperados,
      MANIFIESTO,
      'README.md',
      'globales',
      'lecturas.json',
      'observaciones-lecturas.json',
      'vectores-movil',
      'fuentes',
    ].sort(),
  );
  assert.deepEqual(readdirSync(new URL('globales/', CARPETA)), ['datos-globales.json']);
  for (const archivo of esperados) {
    const entrada: unknown = manifiesto[archivo];
    assert.ok(esObjeto(entrada), archivo);
    const bytes = readFileSync(new URL(archivo, CARPETA));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entrada.sha256, archivo);
    assert.doesNotThrow(() => JSON.parse(UTF8.decode(bytes)), archivo);
  }
});

/** Cuánto adelanta como mucho el día de España al UTC (verano: UTC+2). */
const MINUTOS_POR_HORA = 60;
const ADELANTO_DE_ESPANA_MS = 2 * MINUTOS_POR_HORA * MS_POR_MINUTO;

test('la copia de cada fuente de cursos es un día real y no es posterior a hoy: una fecha futura bloquearía el informe a todo el mundo', () => {
  const leer = (archivo: string): Record<string, unknown> => {
    const dato: unknown = JSON.parse(UTF8.decode(readFileSync(new URL(archivo, CARPETA))));
    assert.ok(esObjeto(dato), archivo);
    return dato;
  };
  const copias: [string, unknown][] = [
    ['formacion.json fecha_cursos', leer('formacion.json').fecha_cursos],
    ['consorci.json fecha_copia', leer('consorci.json').fecha_copia],
    ['fundae.json consulta', leer('fundae.json').consulta],
    ['citilab.json copia', leer('citilab.json').copia],
  ];
  const hoyEnEspana = diaUtc(Date.now() + ADELANTO_DE_ESPANA_MS);
  for (const [fuente, dia] of copias) {
    assert.ok(esDiaReal(dia), `${fuente}: ${String(dia)} no es un día real`);
    assert.ok(dia <= hoyEnEspana, `${fuente}: ${dia} es posterior a hoy (${hoyEnEspana})`);
  }
});
