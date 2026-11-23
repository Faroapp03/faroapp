// Jerarquía, recuentos y marcas con un catálogo pequeño que contiene niveles repetidos y grupos sin ocupaciones.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  esGrupoValido,
  hijosDe,
  hijosParaExplorar,
  marcasDelGrupo,
  ocupacionesDelGrupo,
  tituloIsco,
} from '../../src/dominio/grupos.ts';
import { baseDeLaEstimacion } from '../../src/dominio/referencias.ts';
import type { Datos, PoliticaReferencias } from '../../src/dominio/tipos-paquete.ts';
import { datosMinimos, ocupacion, tarea, vectores } from '../fixtures/datos-referencias-grupos.ts';

const OCUPACIONES_DEL_PRIMER_GRUPO = 3;

function catalogo(): Datos {
  const datos = datosMinimos();
  datos.clasificaciones.isco08_es = {
    '1': 'Primer grupo',
    '11': 'Nivel repetido',
    '111': 'Nivel repetido',
    '1111': 'Ámbito primero',
    '1112': 'Ámbito segundo',
    '1113': 'Ámbito sin tareas',
    '2': 'Otro grupo',
    '22': 'Vacío',
    '222': 'Vacío',
    '2222': 'Vacío',
  };
  datos.esco.ocupaciones = {
    z: ocupacion('1111', 'Zapatero'),
    a: ocupacion('1111', 'Árbitro'),
    b: ocupacion('1112', 'Barbero'),
  };
  datos.oit.tareas = { primera: tarea('1111', 1), segunda: tarea('1112', null) };
  return datos;
}

test('los títulos solo reconocen claves propias y los grupos completos deben tener cuatro cifras oficiales', () => {
  const datos = catalogo();
  assert.equal(tituloIsco(datos, '1111'), 'Ámbito primero');
  for (const codigo of ['ausente', 'constructor', '__proto__', 'toString']) {
    assert.equal(tituloIsco(datos, codigo), null);
    assert.equal(esGrupoValido(datos, codigo), false);
  }
  assert.equal(esGrupoValido(datos, '1111'), true);
  for (const codigo of ['111', '11111', '9999', ' 1111', '1111\n']) {
    assert.equal(esGrupoValido(datos, codigo), false);
  }
});

test('la jerarquía cuenta las ocupaciones por prefijo y ordena los hijos y ocupaciones en castellano', () => {
  const datos = catalogo();
  assert.deepEqual(hijosDe(datos, ''), [
    { isco08: '2', titulo: 'Otro grupo', ocupaciones: 0 },
    { isco08: '1', titulo: 'Primer grupo', ocupaciones: 3 },
  ]);
  assert.deepEqual(hijosDe(datos, '111'), [
    { isco08: '1111', titulo: 'Ámbito primero', ocupaciones: 2 },
    { isco08: '1112', titulo: 'Ámbito segundo', ocupaciones: 1 },
    { isco08: '1113', titulo: 'Ámbito sin tareas', ocupaciones: 0 },
  ]);
  assert.deepEqual(
    ocupacionesDelGrupo(datos, '1111').map(({ esco }) => esco),
    ['a', 'z'],
  );
  assert.deepEqual(ocupacionesDelGrupo(datos, '2222'), []);
  assert.deepEqual(ocupacionesDelGrupo(datos, 'constructor'), []);
});

test('explorar salta solo el hijo único con el mismo título y conserva su recuento', () => {
  const datos = catalogo();
  assert.deepEqual(hijosParaExplorar(datos, '1'), [{ isco08: '111', titulo: 'Nivel repetido', ocupaciones: 3 }]);
  assert.deepEqual(hijosParaExplorar(datos, '2'), [{ isco08: '2222', titulo: 'Vacío', ocupaciones: 0 }]);
  assert.deepEqual(hijosParaExplorar(datos, '111'), hijosDe(datos, '111'));
  for (const padre of ['1111', '999', 'constructor']) {
    assert.equal(hijosDe(datos, padre), null);
    assert.equal(hijosParaExplorar(datos, padre), null);
  }
});

test('las marcas de todos los grupos coinciden con la base que usaría el estimador bajo cada política', () => {
  const datos = catalogo();
  const politicas: readonly PoliticaReferencias[] = ['ocupacion', 'ampliada', 'oit'];
  for (const conVectores of [false, true]) {
    if (conVectores) {
      datos.vectores = vectores(['primera']);
    }
    for (const politica of politicas) {
      for (const grupo of ['1111', '1112', '1113', '2222']) {
        const base = baseDeLaEstimacion(datos, grupo, politica);
        assert.deepEqual(marcasDelGrupo(datos, grupo, politica), {
          sinTareasOit: grupo !== '1111',
          referenciasSubgrupo: base === 'subgrupo',
          sinReferencias: base === null,
        });
      }
    }
  }
  assert.deepEqual(marcasDelGrupo(catalogo(), '1112'), {
    sinTareasOit: true,
    referenciasSubgrupo: true,
    sinReferencias: false,
  });
});

test('cada paquete conserva su índice sin mutar el catálogo ni contaminar otro paquete', () => {
  const primero = catalogo();
  const antes = structuredClone(primero);
  const segundo = catalogo();
  segundo.esco.ocupaciones = { c: ocupacion('1111', 'Carpintero') };
  assert.equal(ocupacionesDelGrupo(primero, '1111').length, 2);
  assert.equal(ocupacionesDelGrupo(segundo, '1111').length, 1);
  assert.equal(hijosDe(primero, '')?.find(({ isco08 }) => isco08 === '1')?.ocupaciones, OCUPACIONES_DEL_PRIMER_GRUPO);
  assert.equal(hijosDe(segundo, '')?.find(({ isco08 }) => isco08 === '1')?.ocupaciones, 1);
  assert.deepEqual(primero, antes);
});
