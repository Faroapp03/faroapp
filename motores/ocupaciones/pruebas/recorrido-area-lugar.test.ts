// La pregunta del área cuando la persona solo nombra dónde trabaja («Trabajo en el puerto»): sin falsos amigos de
// género (puerto/puerta) y con la preposición y el artículo que escribió («¿Qué haces sobre todo en el puerto?»).

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { cargarDatos } from '../../../src/plataforma/node/datos.ts';
import { buscar, fraseDelArea, pasoDePantalla } from '../src/recorrido/pantalla/servicio.ts';
import { comprobarAtributos } from '../src/recorrido/preguntas/atributos.ts';

const datos = cargarDatos(fileURLToPath(new URL('../../../datos/', import.meta.url)));
const A = comprobarAtributos(
  JSON.parse(readFileSync(new URL('../src/recorrido/preguntas/atributos.json', import.meta.url), 'utf8')),
);

/** El título castellano de una ocupación de ESCO. */
const titulo = (esco: string) => datos.esco.ocupaciones[esco]?.titulo ?? '';

describe('el área de un lugar de trabajo', () => {
  it('«puerto» no trae las ocupaciones de «puerta» (montador de puertas, vendedor puerta a puerta)', () => {
    const area = buscar(datos, 'Trabajo en el puerto', 'es').area;
    assert.equal(area?.texto, 'puerto');
    const conPuerta = (area?.ocupaciones ?? []).filter((o) => /puerta/iu.test(titulo(o.esco)));
    assert.deepEqual(
      conPuerta.map((o) => titulo(o.esco)),
      [],
    );
    assert.ok(
      area?.ocupaciones.some((o) => /puerto/iu.test(titulo(o.esco))),
      'alguna ocupación lleva «puerto» en su título',
    );
  });

  it('una palabra cuyo género cambia dentro de una misma ocupación no distingue la vocal (limpiador/limpiadora)', () => {
    const esco = (texto: string) => (buscar(datos, texto, 'es').area?.ocupaciones ?? []).map((o) => o.esco);
    assert.deepEqual(esco('mecánica'), esco('mecánico'));
    assert.deepEqual(esco('educadora'), esco('educador'));
  });

  it('la primera pantalla de «Trabajo en el puerto» pregunta por el puerto, con su artículo y sin puertas', () => {
    const { paso } = pasoDePantalla(datos, A, { texto: 'Trabajo en el puerto', idioma: 'es', respuestas: [] });
    assert.equal(paso.tipo, 'pregunta');
    if (paso.tipo !== 'pregunta') {
      return;
    }
    assert.equal(paso.pregunta.texto, '¿Qué haces sobre todo en el puerto?');
    assert.ok(!paso.pregunta.opciones.some((o) => /puerta/iu.test(o.texto)));
  });
});

describe('la frase del área (fraseDelArea)', () => {
  it('toma la preposición y el artículo que escribió la persona', () => {
    assert.equal(fraseDelArea('Trabajo en el puerto', { texto: 'puerto' }), 'en el puerto');
    assert.equal(fraseDelArea('trabajo en un taller.', { texto: 'taller' }), 'en un taller');
    assert.equal(fraseDelArea('Treballo al port', { texto: 'port' }), 'al port');
    assert.equal(fraseDelArea("Treballo a l'hospital", { texto: 'hospital' }), "a l'hospital");
    assert.equal(fraseDelArea('Trabajo en la estación de tren', { texto: 'estacion tren' }), 'en la estación de tren');
  });

  it('sin preposición delante no hay frase: el enunciado es el general', () => {
    assert.equal(fraseDelArea('recursos humanos', { texto: 'recursos humanos' }), undefined);
    assert.equal(fraseDelArea('Trabajo de camarero', { texto: 'camarero' }), undefined);
  });
});
