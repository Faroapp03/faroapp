// La barra de la conversación solo marca el 100 % con la copia sin conexión completa y verificada, y cada uno de los
// dos estados de la copia tiene su texto, fijado literalmente en los dos idiomas.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { TEXTOS_INSTALACION as CA } from '../../web/idiomas/ca/instalacion.js';
import ca from '../../web/idiomas/ca.js';
import { TEXTOS_INSTALACION as ES } from '../../web/idiomas/es/instalacion.js';
import es from '../../web/idiomas/es.js';
import {
  estadoDeLaCopia,
  porcentajeDeLaPreparacion,
  reintentosDeLaCopia,
} from '../../web/scripts/recorrido/avance-de-la-preparacion.js';

const CIEN = 100;
const ARCHIVOS = 37;
const DEL_PRIMER_ANALISIS = 10;
const FASES = ['comprobado', 'motor', 'datos', 'clasificador', 'vectores', 'listo'];
const CON_LA_COPIA = { conLaCopia: true };

const aMedias = {
  archivos: ARCHIVOS,
  guardados: DEL_PRIMER_ANALISIS,
  completo: false,
  primerAnalisis: { archivos: DEL_PRIMER_ANALISIS, guardados: DEL_PRIMER_ANALISIS, bytes: null, bytesTotales: null },
};
// Todos los archivos contados como guardados, pero sin la respuesta del service worker que la da por completa: no está
// verificada (el manifiesto se guarda el último, después de comprobar cada archivo contra su huella).
const sinVerificar = { ...aMedias, guardados: ARCHIVOS };
const completa = { ...aMedias, guardados: ARCHIVOS, completo: true };
const estado = (copia: typeof aMedias | null, listo = true) => ({ copia, fases: new Set(FASES), listo });

test('con el motor listo y la copia a medias, la barra no llega al 100 % y dice que ya se puede empezar', () => {
  assert.equal(porcentajeDeLaPreparacion(estado(aMedias), CON_LA_COPIA), CIEN - 1);
  assert.equal(estadoDeLaCopia(estado(aMedias)), 'empezar');
});

test('con todos los archivos contados pero la copia sin verificar, la barra tampoco llega al 100 %', () => {
  assert.equal(porcentajeDeLaPreparacion(estado(sinVerificar), CON_LA_COPIA), CIEN - 1);
  assert.equal(porcentajeDeLaPreparacion(estado(null), CON_LA_COPIA), CIEN - 1);
  assert.equal(estadoDeLaCopia(estado(sinVerificar)), 'empezar');
});

test('solo con la copia completa y verificada la barra marca el 100 % y dice que la copia está lista', () => {
  assert.equal(porcentajeDeLaPreparacion(estado(completa), CON_LA_COPIA), CIEN);
  assert.equal(estadoDeLaCopia(estado(completa)), 'lista');
});

test('mientras el motor no ha respondido no hay estado de la copia ni 100 %, aunque la copia esté completa', () => {
  assert.equal(estadoDeLaCopia(estado(completa, false)), null);
  assert.ok((porcentajeDeLaPreparacion(estado(completa, false), CON_LA_COPIA) ?? 0) < CIEN);
});

test('los textos de los dos estados son los fijados, en castellano y en catalán, y la conversación usa cada uno', () => {
  assert.equal(ES['copia-sin-conexion.empezar'], 'Ya puedes empezar. La copia sin conexión sigue preparándose.');
  assert.equal(CA['copia-sin-conexion.empezar'], 'Ja pots començar. La còpia sense connexió es continua preparant.');
  assert.equal(ES['copia-sin-conexion.lista'], 'La copia sin conexión está lista.');
  assert.equal(CA['copia-sin-conexion.lista'], 'La còpia sense connexió està preparada.');
  for (const clave of ['copia-sin-conexion.empezar', 'copia-sin-conexion.lista']) {
    assert.equal(es[clave], ES[clave], clave);
    assert.equal(ca[clave], CA[clave], clave);
  }
  const pagina = readFileSync(new URL('../../web/scripts/recorrido/preparacion.js', import.meta.url), 'utf8');
  assert.match(pagina, /empezar: 'copia-sin-conexion\.empezar'/);
  assert.match(pagina, /lista: 'copia-sin-conexion\.lista'/);
  assert.match(pagina, /porcentajeDeLaPreparacion\(preparacion, \{ conLaCopia: true \}\)/);
});

/** Un entorno de reintentos que anota cada petición y cada espera a la red. */
function entornoDeReintentos(enLinea: { valor: boolean }) {
  const pedidos: string[] = [];
  const esperas: (() => void)[] = [];
  const reintentar = reintentosDeLaCopia({
    pedir: () => pedidos.push('pedir'),
    enLinea: () => enLinea.valor,
    alVolverLaRed: (pedir) => esperas.push(pedir),
  });
  return { pedidos, esperas, reintentar };
}

test('con red, un intento fallido de la copia se vuelve a pedir una sola vez, al instante, y después queda detenida', () => {
  const { pedidos, esperas, reintentar } = entornoDeReintentos({ valor: true });
  assert.equal(reintentar(), 'al-instante');
  assert.equal(pedidos.length, 1);
  for (let fallo = 0; fallo < ARCHIVOS; fallo += 1) {
    assert.equal(reintentar(), 'detenida');
  }
  assert.equal(pedidos.length, 1, 'sin bucle: ninguna petición más');
  assert.equal(esperas.length, 0);
});

test('sin red, se vuelve a pedir una sola vez al volver la red; con red otra vez, una al instante, y nada más', () => {
  const red = { valor: false };
  const { pedidos, esperas, reintentar } = entornoDeReintentos(red);
  assert.equal(reintentar(), 'al-volver-la-red');
  assert.equal(reintentar(), 'detenida', 'sin red no se acumulan esperas');
  assert.equal(esperas.length, 1);
  assert.equal(pedidos.length, 0, 'sin red no se pide nada hasta que vuelve');
  red.valor = true;
  esperas[0]?.();
  assert.equal(pedidos.length, 1);
  assert.equal(reintentar(), 'al-instante');
  assert.equal(reintentar(), 'detenida');
  assert.equal(pedidos.length, 2, 'como mucho dos peticiones más, una por causa');
});

test('detenida la copia, se dice con el texto aprobado en los dos idiomas, y la barra no llega al 100 %', () => {
  const detenida = { ...estado(aMedias), copiaDetenida: true };
  assert.equal(estadoDeLaCopia(detenida), 'detenida');
  assert.equal(porcentajeDeLaPreparacion(detenida, CON_LA_COPIA), CIEN - 1);
  assert.equal(
    ES['copia-sin-conexion.detenida'],
    'La copia sin conexión no se ha podido completar. Faro sigue funcionando con conexión.',
  );
  assert.equal(
    CA['copia-sin-conexion.detenida'],
    'La còpia sense connexió no s’ha pogut completar. Faro continua funcionant amb connexió.',
  );
  assert.equal(es['copia-sin-conexion.detenida'], ES['copia-sin-conexion.detenida']);
  assert.equal(ca['copia-sin-conexion.detenida'], CA['copia-sin-conexion.detenida']);
  const pagina = readFileSync(new URL('../../web/scripts/recorrido/preparacion.js', import.meta.url), 'utf8');
  assert.match(pagina, /detenida: 'copia-sin-conexion\.detenida'/);
  assert.match(pagina, /return estado \? TEXTO_DE_LA_COPIA\[estado\] : null;/);
  assert.match(pagina, /preparacion\.listo && reintentarLaCopia\(\) === 'detenida'/);
  assert.doesNotMatch(pagina, /estadoDeLaCopia\(preparacion\) === 'detenida'/, 'el aviso ya no se retira: lo dice');
});

test('si la copia detenida se completa después (otro intento), el texto pasa a «lista» y solo entonces llega al 100 %', () => {
  const despues = { ...estado(completa), copiaDetenida: true };
  assert.equal(estadoDeLaCopia(despues), 'lista');
  assert.equal(porcentajeDeLaPreparacion(despues, CON_LA_COPIA), CIEN);
});
