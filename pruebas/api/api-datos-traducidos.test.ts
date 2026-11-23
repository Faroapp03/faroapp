// Proyecciones de datos oficiales: texto original y traducción al lado, sin API central ni IA.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buscarOcupaciones } from '../../motores/ocupaciones/src/index.ts';
import {
  candidataTraducida,
  fichaGrupoTraducida,
  fichaOcupacionTraducida,
  ocupacionTraducida,
  tituloIscoTraducido,
} from '../../src/api/datos-traducidos.ts';
import { conTareasTipicas, fichaGrupo, fichaOcupacion } from '../../src/api/fichas.ts';
import type { Datos } from '../../src/dominio/tipos-paquete.ts';
import { cargarDatos } from '../../src/plataforma/node/datos.ts';

const datos = cargarDatos(fileURLToPath(new URL('../../datos/', import.meta.url)));

/** Exige una ficha o traducción presente en el paquete actual. */
function definido<T>(valor: T | null | undefined, nombre: string): T {
  if (valor === undefined || valor === null) {
    assert.fail(nombre);
  }
  return valor;
}

/** Quita solo los campos de acompañamiento para comparar el dato original completo. */
function sinCamposCa(valor: unknown): unknown {
  return JSON.parse(JSON.stringify(valor, (clave, dato) => (clave.endsWith('_ca') ? undefined : dato)));
}

/** Paquete sin la parte opcional de catalán, sin modificar el que comparte la prueba. */
function sinCatalan(): Datos {
  const { catalan: _catalan, ...resto } = datos;
  return resto;
}

test('la ficha catalana mantiene originales y añade la denominación oficial y los textos actuales', () => {
  const ficha = fichaGrupo(datos, '4226', 'ocupacion');
  const antes = structuredClone(ficha);
  const traducida = fichaGrupoTraducida(datos, ficha, 'ca');
  assert.equal(traducida.titulo, 'Recepcionistas (general)');
  assert.equal(traducida.titulo_ca, 'Recepcionistes (general)');
  assert.equal(traducida.tareas.find(({ id }) => id === '4226-2')?.corto_ca, 'Concertar cites');
  assert.deepEqual(sinCamposCa(traducida), ficha);
  assert.deepEqual(ficha, antes);
  assert.notEqual(traducida.tareas, ficha.tareas);
  assert.notEqual(traducida.ocupaciones, ficha.ocupaciones);
});

test('una traducción que falta deja null al lado y conserva la tarea oficial', () => {
  const catalan = definido(datos.catalan, 'catalán del catálogo');
  const parcial = {
    ...datos,
    catalan: {
      ...catalan,
      tareas: Object.fromEntries(Object.entries(catalan.tareas).filter(([id]) => id !== '4226-3')),
    },
  };
  const ficha = fichaGrupo(parcial, '4226', 'ocupacion');
  const traducida = fichaGrupoTraducida(parcial, ficha, 'ca');
  const falta = definido(
    traducida.tareas.find(({ id }) => id === '4226-3'),
    'tarea sin traducción',
  );
  assert.equal(falta.corto_ca, null);
  assert.equal(falta.texto_ca, null);
  assert.equal(falta.corto, datos.textos.tareas['4226-3']?.corto);
  assert.deepEqual(sinCamposCa(traducida), ficha);
  assert.equal(
    fichaGrupoTraducida(datos, fichaGrupo(datos, '4226', 'ocupacion'), 'ca').tareas.find(({ id }) => id === '4226-3')
      ?.corto_ca,
    catalan.tareas['4226-3']?.corto,
  );
});

test('sin catalán o con traducciones vacías se conserva el original sin simular una traducción', () => {
  const sin = sinCatalan(),
    ficha = fichaGrupo(sin, '4226', 'ocupacion');
  const traducida = fichaGrupoTraducida(sin, ficha, 'ca');
  assert.equal(traducida.titulo_ca, null);
  assert.ok(traducida.tareas.every(({ corto_ca, texto_ca }) => corto_ca === null && texto_ca === null));
  assert.ok(traducida.ocupaciones.every(({ titulo_ca }) => titulo_ca === null));
  assert.deepEqual(sinCamposCa(traducida), ficha);
  const catalan = definido(datos.catalan, 'catalán');
  const vacia = { ...datos, catalan: { ...catalan, grupos: { '4226': '' } } };
  assert.equal(tituloIscoTraducido(vacia, '4226', 'ca'), null);
  assert.equal(tituloIscoTraducido(datos, '9999', 'ca'), null);
  assert.equal(tituloIscoTraducido(datos, '4226', 'es'), null);
});

test('la ocupación conserva ESCO, grupo, descripción, notas y tareas, con traducciones separadas', () => {
  const ficha = definido(fichaOcupacion(datos, '4226.1'), 'ficha ESCO actual');
  const traducida = fichaOcupacionTraducida(datos, ficha, 'ca');
  const catalan = definido(datos.catalan, 'catalán');
  assert.equal(traducida.titulo_ca, catalan.ocupaciones[ficha.esco]);
  assert.equal(traducida.tituloIsco_ca, catalan.grupos[ficha.isco08]);
  assert.deepEqual(sinCamposCa(traducida), ficha);
  const castellano = fichaOcupacionTraducida(datos, ficha, 'es');
  assert.equal(castellano.titulo_ca, null);
  assert.equal(castellano.tituloIsco_ca, null);
  assert.deepEqual(sinCamposCa(castellano), ficha);
});

test('ocupaciones y candidatas traducidas conservan campos adicionales y orden de búsqueda', () => {
  const ocupacion = { esco: '4226.1', titulo: 'Original conservado', adicional: 'dato' };
  const traducida = ocupacionTraducida(datos, ocupacion, 'ca');
  assert.deepEqual(sinCamposCa(traducida), ocupacion);
  const candidatas = conTareasTipicas(datos, buscarOcupaciones(datos, 'recepcionista'));
  assert.ok(candidatas.length > 0);
  const traducidas = candidatas.map((candidata) => candidataTraducida(datos, candidata, 'ca'));
  assert.deepEqual(sinCamposCa(traducidas), candidatas);
  assert.deepEqual(
    traducidas.map(({ esco }) => esco),
    candidatas.map(({ esco }) => esco),
  );
  for (const candidata of candidatas) {
    const castellano = candidataTraducida(datos, candidata, 'es');
    assert.equal(castellano.titulo_ca, null);
    assert.equal(castellano.tituloIsco_ca, null);
    assert.deepEqual(sinCamposCa(castellano), candidata);
  }
});

test('una tarea sin texto original mantiene el inglés y no ofrece una traducción huérfana', () => {
  const sinOriginal = {
    ...datos,
    textos: {
      ...datos.textos,
      tareas: Object.fromEntries(Object.entries(datos.textos.tareas).filter(([id]) => id !== '4226-2')),
    },
  };
  const ficha = fichaGrupo(sinOriginal, '4226', 'ocupacion');
  const traducida = fichaGrupoTraducida(sinOriginal, ficha, 'ca');
  const ausente = definido(
    traducida.tareas.find(({ id }) => id === '4226-2'),
    'tarea inglesa',
  );
  assert.equal(ausente.corto, null);
  assert.equal(ausente.texto_es, null);
  assert.equal(ausente.corto_ca, null);
  assert.equal(ausente.texto_ca, null);
  assert.equal(ausente.texto_en, datos.oit.tareas['4226-2']?.texto_en);
  assert.equal(ausente.traduccionPendiente, true);
});
