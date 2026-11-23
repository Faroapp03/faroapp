import assert from 'node:assert/strict';
import test from 'node:test';
import { conFirmasEditoriales } from '../../herramientas/catalogo-cursos/firmas-editoriales.ts';
import { idiomaClasificadoDelCurso, metadatosClasificados } from '../../src/catalogo-cursos/clasificacion.ts';
import revisada from '../../src/catalogo-cursos/clasificacion-revisada.json' with { type: 'json' };
import { idiomasDelCurso } from '../../src/catalogo-cursos/consulta.ts';
import type { OfertaCatalogo } from '../../src/catalogo-cursos/contrato.ts';
import { firmaEditorial } from '../../src/catalogo-cursos/firma-editorial.ts';
import { CATALOGO_CLASIFICACION as catalogo } from '../ayudas/catalogo-clasificacion.ts';

const CIFRAS_SHA256 = 64;
const CANTIDAD_NUEVA = 999;
const complementada = catalogo.ofertas.find((o) => idiomaClasificadoDelCurso(o)?.alcance === 'norma-general');
assert.ok(complementada);
const fuente = catalogo.ofertas.find((o) => metadatosClasificados(o).nivel.origen === 'fuente');
assert.ok(fuente);

function sinRevision(oferta: OfertaCatalogo): void {
  assert.deepEqual(metadatosClasificados(oferta).temas, ['no-indicado']);
  assert.equal(metadatosClasificados(oferta).nivel.valor, null);
  assert.equal(metadatosClasificados(oferta).nivel.origen, 'por-confirmar');
}

test('la receta reproduce las guardas de la revisión histórica sin cambiar sus evidencias', () => {
  assert.deepEqual(conFirmasEditoriales(revisada, catalogo), revisada);
  assert.ok(catalogo.ofertas.every((o) => metadatosClasificados(o).nivel.valor !== null));
});

test('otra captura de los mismos hechos y cuerpos conserva materias, nivel e idioma con fechas históricas', () => {
  for (const original of catalogo.ofertas) {
    const referencia = original.referencias[0];
    assert.ok(referencia);
    const actualizada = {
      ...original,
      comprobado_el: '2026-10-26T08:00:00Z',
      corte_evaluacion_utc: '2026-10-26T08:00:01Z',
      hechos: Object.fromEntries(
        Object.entries(original.hechos).map(([campo, hecho]) => [
          campo,
          { ...hecho, ...(hecho.vigencia ? { vigencia: { comprobado_el: '2026-10-26T08:00:00Z' } } : {}) },
        ]),
      ) as OfertaCatalogo['hechos'],
      referencias: [
        ...original.referencias.map((r) => ({ ...r, fecha_referencia: '2026-10-26T08:00:00Z' })),
        { ...referencia, sha256: 'f'.repeat(CIFRAS_SHA256), fecha_referencia: '2026-10-26T08:00:00Z' },
      ],
    };
    assert.equal(metadatosClasificados(actualizada), metadatosClasificados(original), original.unidad.id);
    assert.deepEqual(idiomasDelCurso(actualizada), idiomasDelCurso(original), original.unidad.id);
    assert.equal(idiomaClasificadoDelCurso(actualizada), idiomaClasificadoDelCurso(original));
  }
});

test('mismo ID con otra URL, hechos sustantivos o soporte pertinente no hereda revisión', () => {
  sinRevision({ ...fuente, url: 'https://example.org/otra-version' });
  sinRevision({
    ...fuente,
    hechos: {
      ...fuente.hechos,
      horas_publicadas: { ...fuente.hechos.horas_publicadas, valor: 999, motivo: 'conocido' },
    },
  });
  const evidencia = metadatosClasificados(fuente).nivel.evidencia;
  assert.ok(evidencia);
  sinRevision({
    ...fuente,
    referencias: fuente.referencias.filter((r) => r.sha256 !== evidencia.sha256 || r.url !== evidencia.url),
  });
  sinRevision({ ...fuente, unidad: { ...fuente.unidad, id: 'otra-unidad' } });
});

test('calendarios y costes no deciden la materia o dificultad de la unidad', () => {
  const actualizada = {
    ...fuente,
    hechos: {
      ...fuente.hechos,
      coste_formacion: { ...fuente.hechos.coste_formacion, valor: 999, motivo: 'conocido' as const },
      calendario_formacion: {
        ...fuente.hechos.calendario_formacion,
        valor: null,
        motivo: 'no_consta_en_evidencia' as const,
      },
    },
  };
  assert.equal(metadatosClasificados(actualizada), metadatosClasificados(fuente));
});

test('el complemento exige su evidencia propia, conserva el alcance y cede ante una declaración nueva', () => {
  const idioma = idiomaClasificadoDelCurso(complementada);
  assert.ok(idioma);
  const sinApoyo = {
    ...complementada,
    referencias: complementada.referencias.filter(
      (r) =>
        !idioma.anclajesEnOferta.some(
          (i) => idioma.evidencias[i]?.url === r.url && idioma.evidencias[i]?.sha256 === r.sha256,
        ),
    ),
  };
  assert.equal(idiomaClasificadoDelCurso(sinApoyo), null);
  assert.deepEqual(idiomasDelCurso(sinApoyo), ['no-indicado']);
  const declarada = {
    ...complementada,
    hechos: {
      ...complementada.hechos,
      idiomas_declarados: { ...complementada.hechos.idiomas_declarados, valor: ['en'], motivo: 'conocido' as const },
    },
  };
  assert.equal(idiomaClasificadoDelCurso(declarada), null);
  assert.deepEqual(idiomasDelCurso(declarada), ['en']);
});

test('cambiar solo el soporte de nivel no borra una norma de idioma que conserva su propio anclaje', () => {
  const nivel = metadatosClasificados(complementada).nivel.evidencia;
  const idioma = idiomaClasificadoDelCurso(complementada);
  assert.ok(nivel && idioma);
  assert.ok(idioma.anclajesEnOferta.every((i) => idioma.evidencias[i]?.sha256 !== nivel.sha256));
  const sinNivel = {
    ...complementada,
    referencias: complementada.referencias.filter((r) => r.sha256 !== nivel.sha256 || r.url !== nivel.url),
  };
  sinRevision(sinNivel);
  assert.equal(idiomaClasificadoDelCurso(sinNivel), idioma);
  assert.deepEqual(idiomasDelCurso(sinNivel), idiomasDelCurso(complementada));
});

test('la congelación superficial no reutiliza la firma después de mutar un hecho o valor anidado', () => {
  const horas = { ...fuente.hechos.horas_publicadas };
  const superficial = Object.freeze({
    ...fuente,
    hechos: Object.freeze({ ...fuente.hechos, horas_publicadas: horas }),
  });
  assert.equal(metadatosClasificados(superficial), metadatosClasificados(fuente));
  horas.valor = CANTIDAD_NUEVA;
  horas.motivo = 'conocido';
  sinRevision(superficial);
  const requisitos: string[] = [];
  const conLista = Object.freeze({
    ...fuente,
    hechos: Object.freeze({
      ...fuente.hechos,
      requisitos_publicados: Object.freeze({ ...fuente.hechos.requisitos_publicados, valor: requisitos }),
    }),
  });
  const primera = firmaEditorial(conLista);
  requisitos.push('experiencia previa');
  assert.notEqual(firmaEditorial(conLista), primera);
});
