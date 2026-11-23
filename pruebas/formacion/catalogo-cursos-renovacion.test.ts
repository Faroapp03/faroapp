/** Las comprobaciones editoriales conservan su instantánea y el producto admite nuevos catálogos. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { consultarCatalogo } from '../../src/catalogo-cursos/consulta.ts';
import { leerCatalogo } from '../../src/catalogo-cursos/lectura.ts';
import { REFERENCIA } from '../../web/scripts/catalogo-cursos/referencia.js';
import { CATALOGO_CLASIFICACION } from '../ayudas/catalogo-clasificacion.ts';

const FILTROS = { texto: '', idioma: '', modalidad: '', nivel: '', tema: '', orden: 'nombre' };

test('la publicación vigente se lee con su referencia propia, sin exigir el SHA de la revisión editorial', () => {
  const bytes = readFileSync(new URL(`../../web/${REFERENCIA.ruta}`, import.meta.url));
  const catalogo = leerCatalogo(bytes, REFERENCIA);
  assert.ok(Object.isFrozen(catalogo));
});

test('una actualización admite una oferta nueva y su idioma sin prestarle materias ni nivel de otra identidad', () => {
  const original = CATALOGO_CLASIFICACION.ofertas[0];
  assert.ok(original);
  const nueva = {
    ...original,
    unidad: { ...original.unidad, id: 'edicion-sintetica-nueva', programa_id: 'programa-sintetico-nuevo' },
    cierra_el: '2026-11-02T10:00:00Z',
    hechos: {
      ...original.hechos,
      idiomas_declarados: { ...original.hechos.idiomas_declarados, motivo: 'conocido' as const, valor: ['fr'] },
    },
  };
  const renovado = { ...CATALOGO_CLASIFICACION, ofertas: [nueva] };
  const reloj = Date.parse('2026-11-02T09:59:59Z');
  const consulta = consultarCatalogo(
    renovado,
    { ...FILTROS, idioma: 'fr', tema: 'no-indicado', nivel: 'no-indicado' },
    reloj,
  );
  assert.deepEqual(consulta.ofertas, [nueva]);
  assert.equal(consulta.total, 1);
  assert.equal(consultarCatalogo(renovado, FILTROS, Date.parse(nueva.cierra_el)).ofertas.length, 0);
});
