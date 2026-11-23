// La primera pantalla con la tabla de vectores y el clasificador cargados, como en el navegador. Las demás pruebas del
// recorrido corren sin ellos, y así se escapó que «xofer de bus» propusiera conductor de coches (8322): los vectores le
// daban la vuelta al buscador y al clasificador, que coincidían en conductor de autobús (8331). Regla de consenso en
// recorrido/pantalla/previa-fusion.ts (grupoDeConsenso).

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { cargarDatos } from '../../../src/plataforma/node/datos.ts';
import { clasificadorDesdeContenedor } from '../src/recorrido/fusion/clasificador-movil.ts';
import { cargarDesdeContenedor } from '../src/recorrido/fusion/vectores-movil.ts';
import { usarClasificador, usarVectores } from '../src/recorrido/pantalla/previa-fusion.ts';
import { pasoDePantalla } from '../src/recorrido/pantalla/servicio.ts';
import { comprobarAtributos } from '../src/recorrido/preguntas/atributos.ts';

const datos = cargarDatos(fileURLToPath(new URL('../../../datos/', import.meta.url)));
const atributos = comprobarAtributos(
  JSON.parse(readFileSync(new URL('../src/recorrido/preguntas/atributos.json', import.meta.url), 'utf8')),
);
const leer = (archivo: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../../datos/${archivo}`, import.meta.url), 'utf8'));
usarVectores(await cargarDesdeContenedor(leer('vectores-movil.json')));
usarClasificador(clasificadorDesdeContenedor(leer('clasificador-movil.json')));

/** El grupo de la propuesta del primer paso, o null si el primer paso no es una propuesta. */
function grupoPropuesto(texto: string, idioma: 'es' | 'ca' = 'es'): string | null {
  const { paso } = pasoDePantalla(datos, atributos, { texto, idioma, respuestas: [] });
  return paso.tipo === 'propuesta' ? paso.mejor.grupo : null;
}

describe('Consenso del buscador y el clasificador, con vectores (como en el navegador)', () => {
  it('«xofer de bus», «maquinista de Renfe», «ebanista» y «bartender en un hotel» proponen su ocupación', () => {
    assert.equal(grupoPropuesto('xofer de bus', 'ca'), '8331');
    assert.equal(grupoPropuesto('maquinista de Renfe'), '8311');
    assert.equal(grupoPropuesto('ebanista'), '7522');
    assert.equal(grupoPropuesto('bartender en un hotel'), '5132');
  });

  it('un área de verdad sigue preguntando qué haces en ella: «recursos humanos»', () => {
    const { paso } = pasoDePantalla(datos, atributos, { texto: 'recursos humanos', idioma: 'es', respuestas: [] });
    assert.equal(paso.tipo === 'pregunta' && paso.pregunta.tipo, 'area');
  });

  it('«doctor», «canguro» y «vendo autos» conservan el consenso con vectores', () => {
    assert.equal(grupoPropuesto('doctor'), '2211');
    assert.equal(grupoPropuesto('canguro'), '5311');
    assert.equal(grupoPropuesto('vendo autos'), '5223');
  });

  it('«portero», «repartidor» y «vendedora de estanco» proponen su ocupación', () => {
    assert.equal(grupoPropuesto('portero'), '5153');
    assert.equal(grupoPropuesto('portera'), '5153');
    assert.equal(grupoPropuesto('porter', 'ca'), '5153');
    assert.equal(grupoPropuesto('portera de hotel'), '9621');
    assert.equal(grupoPropuesto('repartidor'), '8322');
    assert.equal(grupoPropuesto('vendedora de estanco'), '5223');
  });

  it('«científico» e «ingeniero» solos piden precisar el oficio', () => {
    for (const texto of ['científico', 'ingeniero']) {
      const { paso } = pasoDePantalla(datos, atributos, { texto, idioma: 'es', respuestas: [] });
      assert.equal(paso.tipo, 'pregunta', texto);
      assert.match(paso.tipo === 'pregunta' ? paso.pregunta.texto : '', /de qué\?/u, texto);
    }
  });

  it('las siglas con puntos, como sin ellos: «A.T.S.» proponía conductor de camión y «V.S.», policía', () => {
    assert.equal(grupoPropuesto('A.T.S.'), '2221');
    assert.equal(grupoPropuesto('D.U.E.'), '2221');
    assert.equal(grupoPropuesto('V.S.'), '5414');
    assert.equal(grupoPropuesto('G.C.'), '5412');
  });
});
