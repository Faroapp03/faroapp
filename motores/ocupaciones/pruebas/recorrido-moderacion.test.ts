// La moderación del camino local del recorrido (src/recorrido/pantalla/moderacion.ts): la misma política y los
// mismos avisos que la moderación general (seguridad/moderacion.ts), con reglas en el dispositivo. El 024 con la
// intención o las instrucciones de autolesión, en castellano y en catalán; nunca por hablar del trabajo.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { PREFIJO_LOCAL, responderLocal } from '../../../src/plataforma/navegador/ruta-local.ts';
import { cargarDatos } from '../../../src/plataforma/node/datos.ts';
import {
  AVISO_AYUDA,
  AVISO_AYUDA_CA,
  AVISO_FUERA_DE_TEMA,
  AVISO_FUERA_DE_TEMA_CA,
} from '../../../src/seguridad/avisos.ts';
import { avisoDeModeracion, categoriasLocales } from '../src/recorrido/pantalla/moderacion.ts';
import { comprobarAtributos } from '../src/recorrido/preguntas/atributos.ts';

const datos = cargarDatos(fileURLToPath(new URL('../../../datos/', import.meta.url)));
const A = comprobarAtributos(
  JSON.parse(readFileSync(new URL('../src/recorrido/preguntas/atributos.json', import.meta.url), 'utf8')),
);
const BIEN = 200;

const RIESGO_ES = [
  'Soy camarera y quiero morirme',
  'trabajo en un almacén, no quiero vivir así',
  'Me voy a suicidar',
  'estoy pensando en quitarme la vida',
  'no tengo ganas de vivir',
  '¿Cómo suicidarme sin dolor?',
];
const RIESGO_CA = [
  'Sóc infermera i vull morir',
  'em vull suïcidar',
  'estic pensant en treure’m la vida',
  'no vull viure així',
  'com suïcidar-me?',
];
/** Trabajos legítimos que nombran el suicidio, la violencia o el daño: siguen. */
const TRABAJO = [
  'Soy enfermera de psiquiatría y atiendo intentos de suicidio',
  'Me mato a trabajar en la obra',
  'cargo cajas y me hago daño en la espalda',
  'Soy cocinero y a veces me hago cortes con el cuchillo',
  'policía: investigo agresiones y abusos a menores',
  'Sóc mosso d’esquadra i treballo en prevenció del suïcidi',
  'arreglo golpes de coches',
  'trabajo en el matadero y mato terneros',
];

describe('la moderación local', () => {
  it('con intención o instrucciones de autolesión ofrece el 024, con el texto oficial en cada idioma', async () => {
    for (const texto of RIESGO_ES) {
      assert.deepEqual(await avisoDeModeracion(texto, 'es'), { tipo: 'ayuda', texto: AVISO_AYUDA }, texto);
    }
    for (const texto of RIESGO_CA) {
      assert.deepEqual(await avisoDeModeracion(texto, 'ca'), { tipo: 'ayuda', texto: AVISO_AYUDA_CA }, texto);
    }
  });

  it('hablar del trabajo (también de suicidio, violencia o daño) no para nada', async () => {
    for (const texto of TRABAJO) {
      assert.deepEqual(categoriasLocales(texto), [], texto);
      assert.equal(await avisoDeModeracion(texto, 'es'), null, texto);
    }
  });

  it('las amenazas y el sexo con menores en primera persona paran con el aviso de que Faro solo ve el trabajo', async () => {
    assert.deepEqual(await avisoDeModeracion('Voy a matar a mi jefe', 'es'), {
      tipo: 'fuera-de-tema',
      texto: AVISO_FUERA_DE_TEMA,
    });
    assert.deepEqual(await avisoDeModeracion('el vaig a matar', 'ca'), {
      tipo: 'fuera-de-tema',
      texto: AVISO_FUERA_DE_TEMA_CA,
    });
    assert.deepEqual(categoriasLocales('busco sexo con menores'), ['sexual/minors']);
  });

  it('el motor del dispositivo para antes de buscar, en el paso y al añadir una tarea', async () => {
    const pedir = async (operacion: string, cuerpo: unknown) => {
      const r = await responderLocal(datos, () => A, {
        url: `http://127.0.0.1${PREFIJO_LOCAL}${operacion}`,
        method: 'POST',
        headers: [['content-type', 'application/json']],
        body: JSON.stringify(cuerpo),
      });
      assert.equal(r.status, BIEN);
      return (await r.json()) as { parada?: { tipo: string }; paso?: unknown; enlace?: unknown };
    };
    const paso = await pedir('paso', { texto: 'Sóc cambrera i vull morir', idioma: 'ca', respuestas: [] });
    assert.equal(paso.parada?.tipo, 'ayuda');
    assert.equal(paso.paso, undefined);
    const tarea = await pedir('enlazar', { grupo: '5131', tarea: 'quiero morirme', idioma: 'es' });
    assert.equal(tarea.parada?.tipo, 'ayuda');
    const normal = await pedir('paso', { texto: 'camarero', idioma: 'es', respuestas: [] });
    assert.equal(normal.parada, undefined);
  });
});
