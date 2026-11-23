import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { prepararListadoCursos } from '../../herramientas/web/listado-cursos.ts';
import { evaluarClasificacion, idiomaClasificadoDelCurso } from '../../src/catalogo-cursos/clasificacion.ts';
import { consultarCatalogo } from '../../src/catalogo-cursos/consulta.ts';
import type { EntregaCatalogo } from '../../src/catalogo-cursos/contrato.ts';
import { leerCatalogo } from '../../src/catalogo-cursos/lectura.ts';
import { consultarListado, type ListadoCursos } from '../../src/catalogo-cursos/listado.ts';
import { proyectarListado } from '../../src/catalogo-cursos/proyeccion-listado.ts';
import { leerListadoDePagina } from '../../web/scripts/catalogo-cursos/leer-listado.js';

const REFERENCIA = JSON.parse(
  readFileSync(new URL('../fixtures/catalogo-cursos-publico.referencia.json', import.meta.url), 'utf8'),
);
const BASE = leerCatalogo(
  readFileSync(new URL('../fixtures/catalogo-cursos-publico.utf8', import.meta.url)),
  REFERENCIA,
);

function ofertaDelEnsayo() {
  const base = BASE.ofertas[0];
  assert.ok(base);
  const titulo = 'Curso < > & </template> 日本語 import.meta.url';
  return {
    ...base,
    titulo_programa: titulo,
    hechos: {
      ...base.hechos,
      coste_formacion_tipo: { ...base.hechos.coste_formacion_tipo, motivo: 'conocido', valor: 'gratis_formacion' },
      idiomas_declarados: { ...base.hechos.idiomas_declarados, motivo: 'conocido', valor: ['català'] },
    },
    cierra_el: '2026-10-23T10:00:00.000001Z',
  } as const;
}

function comprobarVigencia(lista: ListadoCursos, catalogo: EntregaCatalogo) {
  const filtros = { idioma: 'ca', texto: 'curso', modalidad: '', orden: 'nombre' };
  const antes = Date.parse('2026-10-23T10:00:00.000Z');
  const fechaAtrasada = Date.parse('2026-10-22T10:30:00.000Z');
  for (const ahora of [antes, antes + 1]) {
    const completa = consultarCatalogo(catalogo, filtros, ahora);
    const compacta = consultarListado(lista, filtros, ahora);
    assert.deepEqual(compacta.cuentas, completa.cuentas);
    assert.deepEqual(
      compacta.ofertas.map((o) => o.url),
      completa.ofertas.map((o) => o.url),
    );
  }
  assert.equal(consultarListado(lista, filtros, antes).ofertas.length, 1);
  assert.equal(consultarListado(lista, filtros, antes + 1).ofertas.length, 0);
  assert.throws(() => consultarListado(lista, filtros, fechaAtrasada), /reloj/i);
}

test('la página de Cursos contiene su proyección acreditada y el JS solo su huella; se rechazan páginas de otra edición', async (t) => {
  const web = mkdtempSync(join(tmpdir(), 'listado-cursos-'));
  t.after(() => rmSync(web, { force: true, recursive: true }));
  mkdirSync(join(web, 'scripts/catalogo-cursos'), { recursive: true });
  const pagina = join(web, 'cursos.html');
  const modulo = join(web, 'scripts/catalogo-cursos/carga-pagina.js');
  const plantilla = '<template data-listado-cursos></template>';
  writeFileSync(pagina, plantilla);
  const base = BASE.ofertas[0];
  assert.ok(base);
  const oferta = ofertaDelEnsayo();
  const titulo = oferta.titulo_programa;
  const catalogo = { ...BASE, ofertas: [oferta, base] };
  const referencia = { ...REFERENCIA, ruta: `datos/catalogo-cursos/${REFERENCIA.sha256}.json` };
  const evaluador = { evaluarClasificacion, idiomaClasificadoDelCurso };
  prepararListadoCursos(web, { catalogo, referencia, evaluador });
  const html = readFileSync(pagina, 'utf8');
  const fuente = readFileSync(modulo, 'utf8');
  const contenido = /^<template data-listado-cursos>([A-Za-z0-9_-]+)<\/template>$/.exec(html)?.[1];
  const huella = /'([a-f0-9]{64})'/.exec(fuente)?.[1];
  assert.ok(contenido && huella);
  assert.ok(fuente.includes(`, ${contenido.length}, '${huella}'`));
  assert.ok(!fuente.includes(contenido) && !fuente.includes(oferta.url) && !html.includes(titulo));
  const lista = await leerListadoDePagina(contenido, contenido.length, huella);
  assert.deepEqual(lista, proyectarListado(catalogo));
  assert.equal(lista.ofertas[0]?.titulo_programa, titulo);
  comprobarVigencia(lista, catalogo);
  await assert.rejects(leerListadoDePagina(contenido.slice(1), contenido.length, huella));
  const alterado = (contenido[0] === 'A' ? 'B' : 'A') + contenido.slice(1);
  await assert.rejects(leerListadoDePagina(alterado, contenido.length, huella));
  writeFileSync(pagina, plantilla);
  prepararListadoCursos(web, null);
  assert.equal(readFileSync(pagina, 'utf8'), plantilla);
  assert.match(readFileSync(modulo, 'utf8'), /throw new Error/);
});
