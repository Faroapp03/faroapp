// Confirmación explícita de la ocupación elegida, incluidas alternativas y listas finales.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { comprobarAtributos } from '../src/recorrido/preguntas/atributos.ts';
import { siguientePasoConPropuestas } from '../src/recorrido/preguntas/motor.ts';
import { NO_LO_SE } from '../src/recorrido/preguntas/preguntas.ts';
import type { Entrada, Paso, Respuesta } from '../src/recorrido/preguntas/tipos.ts';

const A = comprobarAtributos(
  JSON.parse(readFileSync(new URL('../src/recorrido/preguntas/atributos.json', import.meta.url), 'utf8')),
);
/** «Soy técnico laboral en la Generalitat»: el buscador duda entre relaciones laborales (2423), minas y administración. */
const DUDOSA: Entrada = {
  idioma: 'es',
  respuestas: [],
  candidatas: [
    { esco: '2423.4', isco08: '2423', puntos: 52, titulo: 'técnico de relaciones laborales' },
    { esco: '3117.4', isco08: '3117', puntos: 50.6, titulo: 'inspector de seguridad minera' },
    { esco: '2422.1', isco08: '2422', puntos: 49, titulo: 'administrativo de la Administración pública' },
  ],
};
const LISTA = 'grupo:2423,3117,2422';
const MAX_PASOS = 40;
const paso = (respuestas: Respuesta[]): Paso => siguientePasoConPropuestas(A, { ...DUDOSA, respuestas });

test('elegir en una lista lo que no encabezaba pide «¿Es esta?» solo con Sí / No, y el «Sí» lo da por bueno', () => {
  const r: Respuesta[] = [{ pregunta: LISTA, opcion: '2422' }];
  const confirmacion = paso(r);
  assert.equal(confirmacion.tipo, 'propuesta');
  assert.ok(confirmacion.tipo === 'propuesta');
  assert.equal(confirmacion.propuesta.grupo, '2422');
  assert.equal(confirmacion.alternativas.length, 0, 'sin alternativas: la persona acaba de elegir entre ellas');
  const fin = paso([...r, { pregunta: confirmacion.id, opcion: 'si' }]);
  assert.equal(fin.tipo, 'resultado');
  assert.ok(fin.tipo === 'resultado' && fin.mejor.grupo === '2422');
});

test('elegir lo que ya encabezaba también se confirma con «Sí / No» (confirmar siempre)', () => {
  const r: Respuesta[] = [{ pregunta: LISTA, opcion: '2423' }];
  const confirmacion = paso(r);
  assert.ok(confirmacion.tipo === 'propuesta' && confirmacion.propuesta.grupo === '2423');
  assert.equal(confirmacion.tipo === 'propuesta' && confirmacion.alternativas.length, 0);
  const fin = paso([...r, { pregunta: confirmacion.tipo === 'propuesta' ? confirmacion.id : '', opcion: 'si' }]);
  assert.ok(fin.tipo === 'resultado' && fin.mejor.grupo === '2423');
});

test('tras una elección equivocada, el «No» deja seguir y lo que encabezaba se vuelve a ofrecer', () => {
  const r: Respuesta[] = [{ pregunta: LISTA, opcion: '2422' }];
  const confirmacion = paso(r);
  assert.ok(confirmacion.tipo === 'propuesta');
  r.push({ pregunta: confirmacion.id, opcion: 'no' });
  let p = paso(r);
  assert.notEqual(p.tipo, 'resultado', 'tras el «No» no se acaba el recorrido');
  const ofrecidos = new Set<string>();
  for (let i = 0; p.tipo !== 'resultado' && i < MAX_PASOS; i++) {
    if (p.tipo === 'propuesta') {
      ofrecidos.add(p.propuesta.grupo);
      for (const alt of p.alternativas) {
        ofrecidos.add(alt.hipotesis.grupo);
      }
      r.push({ pregunta: p.id, opcion: 'no' });
    } else {
      for (const o of p.pregunta.opciones) {
        ofrecidos.add(String(o.id));
      }
      r.push({ pregunta: p.pregunta.id, opcion: NO_LO_SE });
    }
    p = paso(r);
  }
  assert.ok(
    [...ofrecidos].some((g) => g.split('+').includes('2423')),
    'la persona puede volver a ver 2423',
  );
});

test('una alternativa elegida se confirma con Sí / No; con «Sí» vale y la propuesta queda rechazada', () => {
  const r: Respuesta[] = [];
  let p = paso(r);
  for (let i = 0; p.tipo === 'pregunta' && i < MAX_PASOS; i++) {
    r.push({ pregunta: p.pregunta.id, opcion: NO_LO_SE });
    p = paso(r);
  }
  if (p.tipo === 'resultado') {
    return; // ya decidido por la lista: no hay propuesta con alternativas en este camino
  }
  assert.ok(p.tipo === 'propuesta' && p.alternativas.length > 0, 'una propuesta con alternativas');
  const alternativa = p.alternativas[0];
  assert.ok(alternativa);
  r.push({ pregunta: p.id, opcion: alternativa.id });
  const confirmacion = paso(r);
  assert.ok(confirmacion.tipo === 'propuesta');
  assert.equal(confirmacion.propuesta.grupo, alternativa.hipotesis.grupo);
  assert.equal(confirmacion.alternativas.length, 0);
  const fin = paso([...r, { pregunta: confirmacion.id, opcion: 'si' }]);
  assert.ok(fin.tipo === 'resultado' && fin.mejor.grupo === alternativa.hipotesis.grupo);
  assert.ok(fin.tipo === 'resultado' && (fin.rechazos ?? 0) >= 1, 'la propuesta inicial cuenta como rechazada');
});

test('«Atrás» tras un «No» en la confirmación vuelve exactamente a la confirmación, y luego a la lista', () => {
  const lista = paso([]);
  const eleccion: Respuesta[] = [{ pregunta: LISTA, opcion: '2422' }];
  const confirmacion = paso(eleccion);
  assert.ok(confirmacion.tipo === 'propuesta');
  const trasNo = paso([...eleccion, { pregunta: confirmacion.id, opcion: 'no' }]);
  assert.notDeepEqual(trasNo, confirmacion);
  // El motor no guarda estado: quitar la última respuesta («Atrás») devuelve el paso de antes, idéntico.
  assert.deepEqual(paso(eleccion), confirmacion);
  assert.deepEqual(paso([]), lista);
});
