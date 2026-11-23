/** La ficha del plan dice con frases completas, en castellano y en catalán, qué datos del curso no constan. */
import './dom.ts';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import type { OfertaCatalogo } from '../../src/catalogo-cursos/contrato.ts';
import type { OpcionPlan } from '../../src/seleccion-formacion/contrato.ts';
import { avisosPorConfirmar, lineasDeLaFicha } from '../../web/scripts/recorrido/plan-formacion/ficha-oferta.js';
import { CATALOGO_PUBLICADO, opcionesDelPlan, PREFERENCIAS } from '../fixtures/plan-del-catalogo-publicado.ts';

// El cliente importa el motor compilado; en las pruebas se lee la fuente del mismo módulo.
registerHooks({
  resolve(spec, contexto, siguiente) {
    for (const modulo of ['calendarios', 'forma']) {
      if (spec.includes(`/motor/src/catalogo-cursos/${modulo}.js`)) {
        const url = new URL(`../../src/catalogo-cursos/${modulo}.ts`, import.meta.url).href;
        return { url, shortCircuit: true };
      }
    }
    return siguiente(spec, contexto);
  },
});
const { leerSeleccion } = await import('../../web/scripts/recorrido/formacion/cliente.js');
const opciones = opcionesDelPlan();

test('un curso del que no consta si pide registro lo dice en los dos idiomas, aunque la persona no quiera registrarse', () => {
  const sinRegistro = opcionesDelPlan(CATALOGO_PUBLICADO, { ...PREFERENCIAS, aceptaRegistro: false });
  const opcion = sinRegistro.find((o) => o.porConfirmar.includes('registro_previo'));
  assert.ok(opcion);
  assert.deepEqual(avisosPorConfirmar(opcion, 'es'), [
    'No consta si este curso pide registrarse. Lo verás en su ficha oficial antes de inscribirte.',
  ]);
  assert.deepEqual(avisosPorConfirmar(opcion, 'ca'), [
    'No consta si aquest curs demana registrar-se. Ho veuràs a la seva fitxa oficial abans d’inscriure’t.',
  ]);
});

test('un curso con el idioma orientado por Faro lo explica con las mismas palabras que Cursos', () => {
  const opcion = opciones.find((o) => o.idioma.origen === 'historial-cibernarium');
  assert.ok(opcion);
  assert.deepEqual(avisosPorConfirmar(opcion, 'es'), [
    'Idioma probable según ediciones anteriores de la misma modalidad. Confirma el de esta sesión en la ficha.',
  ]);
  assert.deepEqual(avisosPorConfirmar(opcion, 'ca'), [
    'Idioma probable segons edicions anteriors de la mateixa modalitat. Confirma el d’aquesta sessió a la fitxa.',
  ]);
});

test('un curso sin idioma conocido dice que está por confirmar, sin dar ninguno por cierto', () => {
  const base = opciones.find((o) => o.oferta.proveedor_id === 'cibervoluntarios')?.oferta;
  assert.ok(base);
  const sinIdioma: OfertaCatalogo = {
    ...base,
    hechos: {
      ...base.hechos,
      idiomas_declarados: { ...base.hechos.idiomas_declarados, motivo: 'no_consta_en_evidencia', valor: null },
    },
  };
  const [opcion] = opcionesDelPlan({ ...CATALOGO_PUBLICADO, ofertas: [sinIdioma] });
  assert.ok(opcion);
  assert.match(lineasDeLaFicha(opcion, 'es').join('\n'), /Idioma: por confirmar/u);
  assert.match(lineasDeLaFicha(opcion, 'ca').join('\n'), /Idioma: per confirmar/u);
  assert.deepEqual(avisosPorConfirmar(opcion, 'es'), [
    'No consta en qué idioma se imparte este curso. Confírmalo en su ficha oficial antes de inscribirte.',
  ]);
  assert.deepEqual(avisosPorConfirmar(opcion, 'ca'), [
    'No consta en quin idioma s’imparteix aquest curs. Confirma-ho a la seva fitxa oficial abans d’inscriure’t.',
  ]);
});

test('un curso sin modalidad conocida dice que está por confirmar, en los dos idiomas', () => {
  const enLinea = opcionesDelPlan(CATALOGO_PUBLICADO, { ...PREFERENCIAS, modalidad: 'en-linea' });
  const opcion = enLinea.find((o) => o.porConfirmar.includes('modalidad'));
  assert.ok(opcion);
  assert.match(lineasDeLaFicha(opcion, 'es').join('\n'), /Modalidad: por confirmar/u);
  assert.match(lineasDeLaFicha(opcion, 'ca').join('\n'), /Modalitat: per confirmar/u);
  assert.deepEqual(avisosPorConfirmar(opcion, 'es'), [
    'No consta si este curso es en línea o presencial. Confírmalo en su ficha oficial antes de inscribirte.',
  ]);
  assert.deepEqual(avisosPorConfirmar(opcion, 'ca'), [
    'No consta si aquest curs és en línia o presencial. Confirma-ho a la seva fitxa oficial abans d’inscriure’t.',
  ]);
});

test('un curso del que consta todo no lleva ningún aviso', () => {
  const opcion = opciones.find((o) => o.porConfirmar.length === 0);
  assert.ok(opcion);
  assert.deepEqual(avisosPorConfirmar(opcion, 'es'), []);
  assert.deepEqual(avisosPorConfirmar(opcion, 'ca'), []);
});

/** Una respuesta del motor con una sola opción, tal como llega a la vista. */
function respuestaCon(opcion: OpcionPlan, porConfirmar: unknown) {
  return JSON.parse(
    JSON.stringify({
      schema_version: 2,
      opciones: { ia: [{ ...opcion, bloque: 'ia', porConfirmar }], digital: [] },
      calculado_el: '2026-11-18T18:44:35.001Z',
      etapa: 'inicial',
      estado: 'sin_oferta',
      camino: null,
      complementarios: [],
      descartes: [],
      huecos: [],
      requisitosPendientes: [],
    }),
  );
}

test('la vista solo admite datos por confirmar conocidos y sin repetir', () => {
  const opcion = opciones.find((o) => o.porConfirmar.length > 0);
  assert.ok(opcion);
  assert.deepEqual(
    leerSeleccion(respuestaCon(opcion, ['registro_previo', 'idioma', 'modalidad'])).opciones.ia[0]?.porConfirmar,
    ['registro_previo', 'idioma', 'modalidad'],
  );
  for (const invalido of [undefined, ['horario'], ['idioma', 'idioma'], 'idioma']) {
    assert.throws(() => leerSeleccion(respuestaCon(opcion, invalido)), /Respuesta de formación incompatible/u);
  }
});
