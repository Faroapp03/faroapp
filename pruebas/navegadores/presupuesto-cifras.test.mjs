/** Las repeticiones de autenticación en las cifras del presupuesto, con un registro sintético del servidor del ensayo. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { cifras, cifrasDelRegistro, compresionPorTipo } from './presupuesto-cifras.mjs';
import { tablaDeCompresion } from './presupuesto-resumen.mjs';

const SIN_COMPRIMIR = 300;
const SERVIDOS = 100;
/** Las tres respuestas con cuerpo del registro del recorrido. */
const TRES = 3;

/** Un GET del registro: con 200 y cuerpo, o con el desafío Basic (401) y sin cuerpo. */
const peticion = (ruta, destino, estado) => {
  const correcta = estado === ESTADO_HTTP.correcto;
  return {
    ruta,
    metodo: 'GET',
    estado,
    destino,
    huella: ruta,
    llegada: 0,
    sinComprimir: correcta ? SIN_COMPRIMIR : 0,
    servidos: correcta ? SERVIDOS : 0,
  };
};
const correcta = (ruta, destino) => peticion(ruta, destino, ESTADO_HTTP.correcto);
const desafio = (ruta, destino) => peticion(ruta, destino, ESTADO_HTTP.noAutenticado);

test('un 401 seguido de la misma ruta con 200 es una repetición de autenticación', () => {
  const registro = [desafio('/estilos/tipografias.css', 'style'), correcta('/estilos/tipografias.css', 'style')];
  assert.deepEqual(cifras(registro), {
    peticiones: 2,
    direcciones: 1,
    repetidas: 1,
    bytesServidos: SERVIDOS,
    bytesDeLasRespuestas: SERVIDOS,
    bytesSinComprimir: SIN_COMPRIMIR,
    repeticionesDeAutenticacion: 1,
  });
});

test('un 401 que no se vuelve a pedir, o que llega después del 200, no lo es', () => {
  const sinRepetir = [correcta('/estilos/base.css', 'style'), desafio('/privado', 'document')];
  assert.equal(cifras(sinRepetir).repeticionesDeAutenticacion, 0);
  const alReves = [correcta('/estilos/base.css', 'style'), desafio('/estilos/base.css', 'style')];
  assert.equal(cifras(alReves).repeticionesDeAutenticacion, 0);
});

test('el JavaScript cuenta sus repeticiones de autenticación sin cambiar sus demás cifras', () => {
  const registro = [
    correcta('/recorrido.html', 'document'),
    desafio('/barrera-ab12.js', 'script'),
    desafio('/estilos/tipografias.css', 'style'),
    correcta('/barrera-ab12.js', 'script'),
    correcta('/estilos/tipografias.css', 'style'),
  ];
  const { get, javascript, porVia } = cifrasDelRegistro(registro, Number.POSITIVE_INFINITY);
  assert.deepEqual(get, {
    peticiones: 5,
    direcciones: 3,
    repetidas: 2,
    bytesServidos: TRES * SERVIDOS,
    bytesDeLasRespuestas: TRES * SERVIDOS,
    bytesSinComprimir: TRES * SIN_COMPRIMIR,
    repeticionesDeAutenticacion: 2,
  });
  assert.deepEqual(javascript, {
    peticiones: 2,
    direcciones: 1,
    repetidas: 1,
    bytesServidos: SERVIDOS,
    bytesDeLasRespuestas: SERVIDOS,
    bytesSinComprimir: SIN_COMPRIMIR,
    repeticionesDeAutenticacion: 1,
  });
  assert.equal(porVia.pagina.repeticionesDeAutenticacion, 2);
});

test('una respuesta cortada suma solo lo servido, y su compresión se mide con su tamaño', () => {
  const sinComprimir = 4000;
  const tamano = 1000;
  const escritos = 200;
  const cortada = {
    ...correcta('/datos/paquete.json', 'empty'),
    tipo: 'application/json',
    codificacion: 'br',
    sinComprimir,
    tamano,
    servidos: escritos,
    completa: false,
  };
  assert.equal(cifras([cortada]).bytesServidos, escritos, 'Cuenta los bytes escritos, no el tamaño de la respuesta');
  assert.equal(cifras([cortada]).bytesDeLasRespuestas, tamano, 'El peso de las respuestas no depende del corte');
  const json = compresionPorTipo([cortada]).JSON;
  assert.equal(json.servidos, escritos, 'Por tipo, lo servido también es lo escrito');
  assert.equal(json.tamano, tamano, 'El tamaño de la respuesta se conserva');
  assert.equal(json.razon, sinComprimir / tamano, 'La razón de compresión sale del tamaño, no de lo servido');
});

test('la tabla de compresión del resumen da la razón con el peso de las respuestas, también si alguna se cortó', () => {
  const sinComprimir = 4000;
  const tamano = 1000;
  const escritos = 200;
  const compresion = { JSON: { respuestas: 1, sinComprimir, tamano, servidos: escritos, codificaciones: { br: 1 } } };
  const [, , fila] = tablaDeCompresion([{ medida: { servidor: { compresion } } }]);
  // Con el decimal del resumen (DECIMALES_RAZON).
  const razon = (sinComprimir / tamano).toFixed(1);
  assert.match(fila, new RegExp(`\\| ${razon} \\|$`, 'u'), `La razón es ${razon}: ${fila}`);
  // Una medida anterior a R1f, sin `tamano`: lo servido era entonces el peso de las respuestas.
  const antigua = { JSON: { respuestas: 1, sinComprimir, servidos: tamano, codificaciones: { br: 1 } } };
  const [, , filaAntigua] = tablaDeCompresion([{ medida: { servidor: { compresion: antigua } } }]);
  assert.match(filaAntigua, new RegExp(`\\| ${razon} \\|$`, 'u'));
});
