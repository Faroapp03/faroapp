// Fichas oficiales, exclusión de copias y cachés independientes por paquete.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { conTareasTipicas, fichaGrupo, fichaOcupacion, TAREAS_TIPICAS, tareasOficiales } from '../../src/api/fichas.ts';
import { referenciasPara } from '../../src/dominio/referencias.ts';
import type { Datos } from '../../src/dominio/tipos-paquete.ts';
import { cargarDatos } from '../../src/plataforma/node/datos.ts';
import { datosMinimos, ocupacion, tarea } from '../fixtures/datos-referencias-grupos.ts';

/** Exige una entrada presente en el catálogo o en el resultado probado. */
function definido<T>(valor: T | null | undefined, nombre: string): T {
  if (valor === undefined || valor === null) {
    assert.fail(nombre);
  }
  return valor;
}
/** Tamaños del banco real y del recorte que comprueba el aislamiento de la caché. */
const MIN_GRUPOS_DEL_CATALOGO = 400;
const TAREAS_DEL_RECORTADO = 3;

const datos = cargarDatos(fileURLToPath(new URL('../../datos/', import.meta.url)));

/** Un paquete con las primeras tareas con nota; no añade metadatos vectoriales a una consulta factual. */
function paqueteRecortado(cuantas: number): { recortado: Datos } {
  const tareas = Object.fromEntries(
    Object.entries(datos.oit.tareas)
      .filter(([, tarea]) => tarea.nota !== null)
      .slice(0, cuantas),
  );
  return { recortado: { ...datos, oit: { ...datos.oit, tareas } } };
}

// 1112-6 y 1114-7 son el mismo texto oficial en dos grupos del subgrupo 111. Con solo ese subgrupo, y sin las
// tareas del 1113 para que ese grupo se calibre con la base «subgrupo», todas las tareas hermanas caben en la
// selección: si la copia no se descarta, sale.
const tareas = Object.fromEntries(
  Object.entries(datos.oit.tareas).filter(([, { isco08 }]) => isco08.startsWith('111') && isco08 !== '1113'),
);
const subgrupo111: Datos = { ...datos, oit: { ...datos.oit, tareas } };
const texto = (id: string): string => definido(tareas[id], `la tarea ${id}`).texto_en;

test('las dos tareas de la prueba son copias del mismo texto en grupos distintos', () => {
  assert.equal(texto('1112-6'), texto('1114-7'));
  assert.notEqual(definido(tareas['1112-6'], 'tarea propia').isco08, definido(tareas['1114-7'], 'copia').isco08);
});

test('con la política «ampliada» y con la base «subgrupo», ni la excluida ni su copia son referencia', () => {
  const casos = [
    { isco08: '1112', politica: 'ampliada', base: 'ocupacion' },
    { isco08: '1113', politica: 'ocupacion', base: 'subgrupo' },
  ] as const;
  for (const { isco08, politica, base } of casos) {
    const elegidas = definido(referenciasPara(subgrupo111, isco08, politica, '1112-6'), `referencias de ${isco08}`);
    assert.equal(elegidas.base, base);
    const ids = elegidas.refs.map((referencia) => referencia.id);
    assert.ok(!ids.includes('1112-6') && !ids.includes('1114-7'), `${isco08} (${politica}): ${ids.join(', ')}`);
    // Sin excluir nada, la copia sí es referencia: la prueba ve lo que descarta.
    const todas = definido(referenciasPara(subgrupo111, isco08, politica), `referencias de ${isco08}`);
    assert.ok(todas.refs.some((referencia) => referencia.id === '1114-7'));
  }
});

/** Las tareas con nota de un grupo recorriendo el catálogo entero: lo que tiene que dar el índice. */
const tareasDelGrupoRecorriendo = (unosDatos: Datos, isco08: string): string[] =>
  Object.entries(unosDatos.oit.tareas)
    .filter(([, tarea]) => tarea.isco08 === isco08 && tarea.nota !== null)
    .sort((a, b) => a[1].indice - b[1].indice)
    .map(([id]) => id);

test('el índice de tareas por grupo da las mismas tareas y en el mismo orden que recorrer el catálogo', () => {
  const grupos = [...new Set(Object.values(datos.oit.tareas).map((tarea) => tarea.isco08))].sort();
  // Una cifra del paquete actual (unos 430 grupos con tareas oficiales): menos querría decir un catálogo recortado.
  assert.ok(grupos.length > MIN_GRUPOS_DEL_CATALOGO, 'se esperan más de 400 grupos ISCO-08 con tareas oficiales');
  for (const isco08 of grupos) {
    const delIndice = tareasOficiales(datos, isco08).map((tarea) => tarea.id);
    assert.deepEqual(delIndice, tareasDelGrupoRecorriendo(datos, isco08), `las tareas del grupo ${isco08}`);
  }
  // Un grupo sin tareas oficiales sigue dando una lista vacía (0110, oficiales de las fuerzas armadas, no tiene).
  assert.ok(!grupos.includes('0110'), 'el grupo 0110 tiene tareas en este paquete');
  assert.deepEqual(tareasOficiales(datos, '0110'), []);
});

test('el orden lo manda el índice de la clasificación, no el orden en que vienen las tareas en los datos', () => {
  // En el paquete real las tareas de cada grupo ya vienen por su índice: con un paquete que las trae al revés se ve
  // que lo que ordena la lista es el índice de la clasificación y no la posición en los datos.
  const grupo = '4226';
  const delGrupo = tareasDelGrupoRecorriendo(datos, grupo);
  assert.ok(delGrupo.length > 1, `el grupo ${grupo} debería tener varias tareas oficiales`);
  const alReves = Object.fromEntries(
    Object.entries(datos.oit.tareas)
      .filter(([id]) => !delGrupo.includes(id))
      .concat([...delGrupo].reverse().map((id) => [id, definido(datos.oit.tareas[id], `tarea ${id}`)])),
  );
  const revuelto: Datos = { ...datos, oit: { ...datos.oit, tareas: alReves } };
  assert.deepEqual(
    tareasOficiales(revuelto, grupo).map((tarea) => tarea.id),
    delGrupo,
  );
});

/** El grupo de la primera tarea oficial con nota del paquete. */
function grupoConNota(): string {
  return definido(
    Object.values(datos.oit.tareas).find((tarea) => tarea.nota !== null),
    'una tarea oficial con nota',
  ).isco08;
}

test('el índice de las fichas también va por paquete de datos', () => {
  const grupo = grupoConNota();
  const delReal = tareasOficiales(datos, grupo).map((tarea) => tarea.id);
  const { recortado } = paqueteRecortado(TAREAS_DEL_RECORTADO);
  const delRecortado = tareasOficiales(recortado, grupo).map((tarea) => tarea.id);
  assert.ok(delRecortado.length < delReal.length, 'el paquete recortado debería tener menos tareas en el grupo');
  // Usar el recortado no cambia lo que da el paquete real.
  assert.deepEqual(
    tareasOficiales(datos, grupo).map((tarea) => tarea.id),
    delReal,
  );
});

test('las tareas típicas de una candidata son los nombres cortos de sus primeras tareas, en el orden del índice', () => {
  const grupo = grupoConNota();
  const candidata = { esco: '4226.1', titulo: 'x', tituloIsco: 'x', descripcion: '', isco08: grupo, puntos: 1 };
  const esperadas = tareasDelGrupoRecorriendo(datos, grupo)
    .map((id) => datos.textos.tareas[id]?.corto)
    .filter((corto): corto is string => !!corto)
    .slice(0, TAREAS_TIPICAS);
  assert.deepEqual(definido(conTareasTipicas(datos, [candidata])[0], 'candidata enriquecida').tareasTipicas, esperadas);
});

/** Paquete pequeño con empates de índice, notas nulas y extremos de la escala. */
function datosControlados(): Datos {
  const unos = datosMinimos();
  unos.clasificaciones.isco08_es = { '1111': 'Grupo de prueba' };
  unos.esco.ocupaciones = { '1111.1': { ...ocupacion('1111', 'Ocupación de prueba'), descripcion: 'Descripción' } };
  unos.oit.tareas = {
    segunda: { ...tarea('1111', 1, 'Second'), indice: 1 },
    primera: tarea('1111', 0, 'First'),
    empatada: tarea('1111', 1, 'Tie'),
    sinNota: tarea('1111', null),
  };
  unos.textos.tareas = {
    primera: { corto: 'Primera', texto_es: 'Texto de la primera' },
    empatada: { corto: '', texto_es: 'Texto empatado' },
  };
  return unos;
}

test('las tareas conservan índice estable, nota cero, traducción ausente y franja sin alterar datos', () => {
  const unos = datosControlados(),
    antes = structuredClone(unos);
  const fichas = tareasOficiales(unos, '1111');
  assert.deepEqual(
    fichas.map(({ id }) => id),
    ['primera', 'empatada', 'segunda'],
  );
  const primera = definido(fichas[0], 'primera ficha'),
    segunda = definido(fichas.at(-1), 'segunda ficha');
  assert.equal(primera.nota, 0);
  assert.equal(primera.franja, 'baja');
  assert.equal(primera.traduccionPendiente, false);
  assert.deepEqual(
    [segunda.corto, segunda.texto_es, segunda.texto_en, segunda.traduccionPendiente],
    [null, null, 'Second', true],
  );
  assert.equal(segunda.franja, 'alta');
  assert.deepEqual(tareasOficiales(unos, '9999'), []);
  assert.deepEqual(unos, antes);
});

test('las fichas conservan ausencia de media/descripción y marcas acordes con la política', () => {
  const unos = datosControlados();
  const ficha = definido(fichaOcupacion(unos, '1111.1'), 'ficha de ocupación');
  assert.equal(ficha.tituloIsco, 'Grupo de prueba');
  assert.equal(ficha.descripcion, 'Descripción');
  assert.equal(ficha.oit, null);
  assert.equal(fichaOcupacion(unos, '9999.9'), null);
  for (const politica of ['ocupacion', 'ampliada', 'oit'] as const) {
    const grupo = fichaGrupo(unos, '1111', politica);
    assert.equal(grupo.titulo, 'Grupo de prueba');
    assert.deepEqual(grupo.tareas, ficha.tareas);
    assert.deepEqual(grupo.ocupaciones, [{ esco: '1111.1', titulo: 'Ocupación de prueba' }]);
    assert.equal(grupo.sinTareasOit, false);
    assert.equal(grupo.referenciasSubgrupo, false);
    assert.equal(grupo.sinReferencias, false);
  }
  const sinDescripcion = datosMinimos({
    esco: { competencias: [], ocupaciones: { '1111.1': ocupacion('1111', 'Título') } },
  });
  assert.equal(fichaOcupacion(sinDescripcion, '1111.1')?.descripcion, '');
  assert.equal(fichaOcupacion(sinDescripcion, '1111.1')?.tituloIsco, '1111');
});

test('las candidatas mantienen orden/campos y no heredan nombres típicos de otro paquete', () => {
  const unos = datosControlados();
  const candidata = {
    esco: '1111.1',
    titulo: 'Título',
    isco08: '1111',
    tituloIsco: 'Grupo',
    descripcion: '',
    puntos: 1,
  };
  const candidatas = [candidata, { ...candidata, esco: '9999.9', isco08: '9999' }];
  assert.deepEqual(conTareasTipicas(unos, candidatas), [
    { ...candidata, tareasTipicas: ['Primera'] },
    { ...candidatas[1], tareasTipicas: [] },
  ]);
  assert.ok(!Object.hasOwn(candidata, 'tareasTipicas'));
  assert.deepEqual(conTareasTipicas(datosMinimos(), [candidata])[0]?.tareasTipicas, []);
  assert.deepEqual(conTareasTipicas(unos, [candidata])[0]?.tareasTipicas, ['Primera']);
  assert.deepEqual(conTareasTipicas(unos, []), []);
});
