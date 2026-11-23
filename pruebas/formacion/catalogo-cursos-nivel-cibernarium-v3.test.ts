import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { evaluarClasificacion } from '../../src/catalogo-cursos/clasificacion.ts';
import type { OfertaCatalogo } from '../../src/catalogo-cursos/contrato.ts';
import { nivelAutomatico } from '../../src/catalogo-cursos/nivel-automatico.ts';
import entrega from '../fixtures/catalogo-cursos-idioma-ejemplos.json' with { type: 'json' };

function muestra(titulo: string): OfertaCatalogo {
  const base = structuredClone(entrega.ofertas[0]) as unknown as OfertaCatalogo;
  assert.ok(base.evidencia_materia?.contenido);
  return { ...base, titulo_programa: titulo };
}

test('nivel inicial de fundamentos y avanzado catalán se leen del título, sin adivinar el nivel dos', () => {
  for (const [titulo, nivel] of [
    ['Python Nivell 1: Fonaments', 'inicial'],
    ['QGIS Nivell 1: Fonaments', 'inicial'],
    ['Vibe coding avançat', 'avanzado'],
    ['MySQL Nivell 2: SQL avançat', 'avanzado'],
    ['AWS Nivell 2: solucions al núvol', null],
    ['ACTIC NIVELL 1 - C1: CERCA', null],
    ['Aprèn tècniques avançades de fotografia', null],
    ['Eines avançades de vídeo per a principiants', 'inicial'],
  ] as const) {
    const oferta = muestra(titulo);
    assert.ok(oferta.evidencia_materia?.contenido);
    const { nivel_sugerido: descartado, ...contenido } = oferta.evidencia_materia.contenido;
    void descartado;
    const limpio = {
      ...oferta,
      evidencia_materia: { ...oferta.evidencia_materia, contenido },
    };
    assert.equal(nivelAutomatico(limpio, evaluarClasificacion(limpio).metadatos.nivel, []).valor, nivel, titulo);
  }
});

test('orientación por acciones exige identidad y huella de la captura vigente', () => {
  const base = muestra('Automatiza procesos con macros');
  assert.ok(base.evidencia_materia?.contenido);
  const evidencia = {
    ...base.evidencia_materia,
    contenido: {
      ...base.evidencia_materia.contenido,
      nivel_sugerido: { valor: 'intermedio', origen: 'descripcion', regla: 'nivel-cibernarium-v3' } as const,
    },
  };
  const oferta = { ...base, evidencia_materia: evidencia };
  const anterior = evaluarClasificacion(oferta).metadatos.nivel;
  const resultado = nivelAutomatico(oferta, anterior, []);
  assert.equal(resultado.valor, 'intermedio');
  assert.equal(resultado.origen, 'faro');
  assert.match(resultado.motivo.es, /Consulta los requisitos publicados/);
  assert.equal(nivelAutomatico({ ...oferta, referencias: [] }, anterior, []).valor, null);
  const antigua = {
    ...evidencia,
    contenido: {
      ...evidencia.contenido,
      nivel_sugerido: { ...evidencia.contenido.nivel_sugerido, regla: 'nivel-cibernarium-v2' as const },
    },
  };
  assert.equal(nivelAutomatico({ ...oferta, evidencia_materia: antigua }, anterior, []).valor, null);
});

test('itinerario se atribuye solo a su ficha y se presenta como orientación relativa', () => {
  const base = muestra('Introducció a exemples');
  const url = `https://cibernarium.barcelonactiva.cat/ca/formacio?activityId=${base.unidad.programa_id.replace(/^cibernarium:/u, '')}`;
  const original = base.referencias[0];
  assert.ok(original);
  const ref = { ...original, url };
  const nivel_itinerario = {
    unidad_id: base.unidad.id,
    programa_id: base.unidad.programa_id,
    titulo: 'Curs d’exemple',
    url,
    sha256: ref.sha256,
    localizador: 'itinerario/caja/2',
    valor: 'intermedio',
    version: 'cibernarium-itinerario-v1',
  } as const;
  const oferta = { ...base, titulo_programa: nivel_itinerario.titulo, referencias: [ref], nivel_itinerario };
  const anterior = evaluarClasificacion(oferta).metadatos.nivel;
  const nivel = nivelAutomatico(oferta, anterior, []);
  assert.equal(nivel.valor, 'intermedio');
  assert.match(nivel.motivo.es, /no es un nivel oficial/i);
  assert.equal(nivelAutomatico({ ...oferta, referencias: [] }, anterior, []).valor, null);
  assert.equal(nivelAutomatico({ ...oferta, titulo_programa: 'Otro curso' }, anterior, []).valor, null);
});
