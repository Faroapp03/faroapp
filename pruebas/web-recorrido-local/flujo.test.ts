// El estado del diálogo con el motor local (web/scripts/recorrido/flujo-local.js), sin DOM ni red: empezar, responder,
// añadir lo contado, volver atrás y decidir el siguiente paso.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as flujo from '../../web/scripts/recorrido/flujo-local.js';

test('empezar con otro texto borra las respuestas anteriores sin modificar lo que ya se había dicho', () => {
  let e = flujo.empezar(flujo.estadoInicial(), '  camarero  ');
  e = flujo.responder(e, 'nivel1:5,4', '5');
  const otra = flujo.empezar(e, 'cajera');
  assert.equal(otra.texto, 'cajera');
  assert.deepEqual(otra.respuestas, []);
  assert.equal(e.texto, 'camarero');
  assert.deepEqual(e.respuestas, [{ pregunta: 'nivel1:5,4', opcion: '5' }]);
});

test('responder dos veces a la misma pregunta cambia la respuesta; «Atrás» quita la última', () => {
  let e = flujo.empezar(flujo.estadoInicial(), 'tecnico');
  e = flujo.responder(e, 'precision', '24');
  e = flujo.responder(e, 'precision', 'no_lo_se');
  assert.deepEqual(e.respuestas, [{ pregunta: 'precision', opcion: 'no_lo_se' }]);
  e = flujo.responder(e, 'tarea:2423-1,2422-1', '2423-1');
  e = flujo.deshacer(e);
  assert.equal(e.respuestas.length, 1);
});

test('una respuesta a una propuesta es una respuesta más: «Atrás» deshace también un «No»', () => {
  let e = flujo.empezar(flujo.estadoInicial(), 'camarero');
  e = flujo.responder(e, 'propuesta:5131:5131.1', 'no');
  e = flujo.responder(e, 'tarea:5132-1', '5132-1');
  e = flujo.deshacer(e);
  assert.deepEqual(e.respuestas, [{ pregunta: 'propuesta:5131:5131.1', opcion: 'no' }]);
});

test('si no entiende, la persona cuenta su día y se busca con las dos cosas; una sola vez', () => {
  let e = flujo.empezar(flujo.estadoInicial(), 'uber');
  assert.equal(e.aclaraciones >= 1, false);
  e = flujo.aclarar(e, ' Llevo pasajeros con mi coche ');
  assert.equal(e.texto, 'uber. Llevo pasajeros con mi coche');
  assert.equal(e.aclaraciones >= 1, true);
  assert.equal(flujo.empezar(e, 'otro').aclaraciones, 0);
});

test('«Lo cuento con mis palabras» añade lo escrito y conserva las respuestas', () => {
  let e = flujo.empezar(flujo.estadoInicial(), 'recursos humanos');
  e = flujo.responder(e, 'grupo:2423,1212,4416', 'no_lo_se');
  e = flujo.anadirTexto(e, ' hago las nóminas y los contratos ');
  assert.equal(e.texto, 'recursos humanos. hago las nóminas y los contratos');
  assert.equal(e.anadido, 'hago las nóminas y los contratos');
  assert.equal(e.respuestas.length, 1);
  e = flujo.anadirTexto(e, 'y las altas');
  assert.equal(e.anadido, 'hago las nóminas y los contratos. y las altas');
});

test('tras un saludo se vuelve a la entrada con la caja vacía y sin gastar la aclaración', () => {
  const saludo = flujo.empezar(flujo.estadoInicial(), 'hola, ¿qué tal?');
  const tras = flujo.trasCortesia(saludo);
  assert.equal(tras.texto, '');
  assert.equal(tras.aclaraciones, 0);
  assert.equal(tras.aclaraciones >= 1, false);
  // Lo siguiente que escribe es un texto nuevo, no se junta con el saludo.
  assert.equal(flujo.empezar(tras, 'corto verdura').texto, 'corto verdura');
});

test('lo repetido no se suma: ni en «Lo cuento» ni al aclarar, sin mirar mayúsculas, tildes ni puntos', () => {
  assert.equal(
    flujo.anadirTexto(flujo.empezar(flujo.estadoInicial(), 'camarero. hola'), 'Hola.').texto,
    'camarero. hola',
  );
  assert.equal(
    flujo.anadirTexto(flujo.empezar(flujo.estadoInicial(), 'camarero'), 'en un bar').texto,
    'camarero. en un bar',
  );
  assert.equal(flujo.anadirTexto(flujo.empezar(flujo.estadoInicial(), 'camarero'), '...').texto, 'camarero. ...');
  let e = flujo.empezar(flujo.estadoInicial(), 'trabajo en una oficina');
  e = flujo.anadirTexto(e, 'hago las nóminas');
  const otraVez = flujo.anadirTexto(e, 'HAGO las nominas');
  assert.equal(otraVez.texto, e.texto);
  assert.equal(otraVez.anadido, e.anadido);
  assert.equal(flujo.aclarar(e, 'hago las nóminas').texto, e.texto);
});

test('los textos que no avanzan se cuentan y, al llegar al tope, se pasa a los botones', () => {
  const nada = { lectura: { sinComprension: true, cortesia: ['saludo'] }, paso: { tipo: 'no_encontrada' } };
  let e = flujo.empezar(flujo.estadoInicial(), 'hola');
  const primera = flujo.destinoDelPaso(e, nada);
  assert.equal(primera.destino, 'cortesia');
  assert.equal(primera.estado.sinAvance, 1);
  // empezar no borra la cuenta: un segundo «hola» llega al tope.
  e = flujo.empezar(primera.estado, 'hola');
  assert.equal(e.sinAvance, 1);
  const segunda = flujo.destinoDelPaso(e, nada);
  assert.equal(segunda.destino, 'guiado');
  assert.equal(segunda.estado.sinAvance, 2);
  // Lo que avanza la pone a cero.
  const avanza = flujo.destinoDelPaso(segunda.estado, {
    lectura: { sinComprension: false },
    paso: { tipo: 'pregunta' },
  });
  assert.equal(avanza.destino, 'pregunta');
  assert.equal(avanza.estado.sinAvance, 0);
  // Un «Lo cuento» sin cambios va a los botones a la primera, con las respuestas intactas.
  const conRespuesta = flujo.responder(avanza.estado, 'propuesta:5131:x', 'no');
  const sinCambios = flujo.destinoDelPaso(
    conRespuesta,
    { lectura: { sinComprension: false }, paso: { tipo: 'pregunta' } },
    { sinCambios: true },
  );
  assert.equal(sinCambios.destino, 'guiado');
  assert.equal(sinCambios.aviso, 'recorrido.local.guiado.sin-cambios');
  assert.equal(sinCambios.estado.respuestas.length, 1);
  assert.equal(flujo.estadoInicial().sinAvance, 0);
});

test('el límite compartido del relato cuenta unidades UTF-16 al iniciar y concatenar', async () => {
  const { MAX_RELATO } = await import('../../web/scripts/protocolo-web.js');
  assert.equal(flujo.MAX_LETRAS, MAX_RELATO);
  for (const longitud of [MAX_RELATO - 1, MAX_RELATO, MAX_RELATO + 1]) {
    const escrito = 'á'.repeat(longitud);
    assert.equal(flujo.empezar(flujo.estadoInicial(), escrito).texto, escrito.slice(0, MAX_RELATO));
  }
  const MARGEN_PARA_CONCATENAR = 3;
  const inicial = flujo.empezar(flujo.estadoInicial(), 'a'.repeat(MAX_RELATO - MARGEN_PARA_CONCATENAR));
  assert.equal(flujo.anadirTexto(inicial, '😀x').texto, `${inicial.texto}. 😀x`.slice(0, MAX_RELATO));
});
