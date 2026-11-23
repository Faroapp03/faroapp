import assert from 'node:assert/strict';
import test from 'node:test';
import { consultarCatalogo } from '../../src/catalogo-cursos/consulta.ts';
import { temasDelCurso } from '../../src/catalogo-cursos/temas.ts';
import { CATALOGO_CLASIFICACION as catalogo } from '../ayudas/catalogo-clasificacion.ts';

const ahora = Date.parse('2026-10-25T20:30:00Z');
const filtros = { texto: '', idioma: '', modalidad: '', nivel: '', tema: '', orden: 'nombre' };
const ESPERADOS = { total: 709, ofimatica: 103, programasOfimatica: 68, sinTema: 0, ia: 116 };

test('documentos, nube, correo y colaboración publicados aparecen en ofimática', () => {
  const ids = [
    'cibervoluntarios:material:9550626442',
    'cibervoluntarios:material:10059786839',
    'cibervoluntarios:material:10016696758',
    'cibervoluntarios:material:8405596198',
    'cibervoluntarios:material:9567887010',
    'cibervoluntarios:material:10059786856',
  ];
  for (const id of ids) {
    const oferta = catalogo.ofertas.find((o) => o.unidad.id === id);
    assert.ok(oferta, id);
    assert.ok(temasDelCurso(oferta.titulo_programa).includes('ofimatica'));
  }
});

test('la ampliación conserva materias simultáneas y no convierte presentaciones genéricas en software', () => {
  assert.ok(temasDelCurso('Gemini y Google Workspace: Mejora tu productividad diaria').includes('ia'));
  assert.ok(temasDelCurso('Gemini y Google Workspace: Mejora tu productividad diaria').includes('ofimatica'));
  assert.deepEqual(temasDelCurso('Masterclass: Transforma la teva feina amb Microsoft Copilot 365'), ['ia']);
  assert.deepEqual(temasDelCurso('Domina Copilot a Microsoft 365'), ['ia', 'ofimatica']);
  assert.ok(!temasDelCurso('Presentaciones Efectivas').includes('ofimatica'));
  assert.ok(temasDelCurso('Presentaciones Efectivas').includes('comunicacion'));
  assert.deepEqual(temasDelCurso('Pensamiento de Diseño'), ['empresa']);
  assert.deepEqual(temasDelCurso('Introducción al Conocimiento de la Ciberseguridad'), ['seguridad']);
});

test('las nuevas materias recuperan ofertas del catálogo real sin retirar los cursos no clasificados', () => {
  const original = JSON.stringify(catalogo);
  const todos = consultarCatalogo(catalogo, filtros, ahora);
  const oficina = consultarCatalogo(catalogo, { ...filtros, tema: 'ofimatica' }, ahora);
  const desconocidos = consultarCatalogo(catalogo, { ...filtros, tema: 'no-indicado' }, ahora);
  assert.equal(todos.total, ESPERADOS.total);
  assert.equal(todos.ofertas.length, ESPERADOS.total);
  assert.equal(oficina.ofertas.length, ESPERADOS.ofimatica);
  assert.equal(new Set(oficina.ofertas.map((o) => o.unidad.programa_id)).size, ESPERADOS.programasOfimatica);
  assert.equal(desconocidos.ofertas.length, ESPERADOS.sinTema);
  assert.equal(todos.cuentas.get('tema')?.get('ia'), ESPERADOS.ia);
  assert.equal(JSON.stringify(catalogo), original);
});
