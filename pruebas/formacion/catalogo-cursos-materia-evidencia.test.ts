import assert from 'node:assert/strict';
import test from 'node:test';
import { crearEvaluadorClasificacion } from '../../src/catalogo-cursos/clasificacion.ts';
import { CAMPOS_HECHOS, type HechoCatalogo, type OfertaCatalogo } from '../../src/catalogo-cursos/contrato.ts';
import { firmaEditorial, identidadEditorial } from '../../src/catalogo-cursos/firma-editorial.ts';
import materias from '../../src/catalogo-cursos/materias-revisadas.json' with { type: 'json' };
import { TEMAS_CURSOS } from '../../src/catalogo-cursos/temas.ts';

const CIFRAS_SHA = 64;
const PROGRAMAS_REVISADOS = 209;
const desconocido: HechoCatalogo = {
  valor: null,
  motivo: 'no_consta_en_evidencia',
  unidad: null,
  moneda: null,
  alcance: 'edicion',
};
const captura = {
  url: 'https://example.org/captura',
  sha256: 'b'.repeat(CIFRAS_SHA),
  capturado_utc: '2026-01-01T00:00:00Z',
  localizador: '/activities/0',
};
const oferta = {
  unidad: { tipo: 'edicion', id: 'cibernarium-edicion:2', programa_id: 'cibernarium:1' },
  proveedor_id: 'cibernarium',
  titulo_programa: 'Curso',
  tipo_unidad: 'actividad-formativa',
  url: 'https://example.org/curso',
  hechos: Object.fromEntries(CAMPOS_HECHOS.map((campo) => [campo, desconocido])) as OfertaCatalogo['hechos'],
  referencias: [],
  comprobado_el: '2026-01-01T00:00:00Z',
  cierra_el: null,
  incidencia_enlace_el: null,
  corte_evaluacion_utc: '2026-01-01T00:00:00Z',
} satisfies OfertaCatalogo;
const evidencia = {
  version: 1 as const,
  actividad_id: '1',
  programa_id: 'cibernarium:1',
  edicion_id: 'cibernarium-edicion:2',
  vinculo: captura,
  contenido: {
    metodo: 'cibernarium-descripcion-api-v1' as const,
    sha256: 'a'.repeat(CIFRAS_SHA),
    url: captura.url,
    sha256_captura: captura.sha256,
    capturado_utc: captura.capturado_utc,
    localizador: captura.localizador,
  },
  censo_ia: { ambito: 'ia' as const, ...captura },
  estado_censo: 'completo' as const,
};
const ancla = {
  programaId: 'cibernarium:1',
  titulo: 'Curso',
  proveedorId: 'cibernarium',
  contenido: {
    metodo: evidencia.contenido.metodo,
    sha256: evidencia.contenido.sha256,
    url: captura.url,
    sha256Captura: captura.sha256,
    capturadoEl: captura.capturado_utc,
    localizador: captura.localizador,
  },
  temas: ['digital'] as const,
};
const programa = {
  programaId: 'cibernarium:1',
  titulo: 'Curso',
  proveedorId: 'cibernarium',
  temas: ['empresa'] as const,
  motivoTemas: { es: 'Revisión anterior.', ca: 'Revisió anterior.' },
  nivel: {
    valor: 'inicial' as const,
    origen: 'faro' as const,
    literal: null,
    motivo: { es: 'Orientación.', ca: 'Orientació.' },
    evidencia: null,
    alcance: null,
    escala: null,
  },
};
const evaluador = crearEvaluadorClasificacion(
  { programas: [programa], unidadesRevisadas: { [identidadEditorial(oferta)]: firmaEditorial(oferta) } },
  [ancla],
);

test('las revisiones por contenido tienen una única identidad y no reproducen descripciones', () => {
  assert.equal(materias.schemaVersion, 1);
  assert.equal(materias.programas.length, PROGRAMAS_REVISADOS);
  assert.equal(new Set(materias.programas.map((p) => p.programaId)).size, PROGRAMAS_REVISADOS);
  assert.ok(materias.programas.every((p) => /^[a-f0-9]{64}$/u.test(p.contenido.sha256)));
  assert.ok(
    materias.programas.every((p) => p.temas.every((tema) => (TEMAS_CURSOS as readonly string[]).includes(tema))),
  );
  assert.ok(materias.programas.every((p) => !('description' in p) && !('description_literal' in p)));
  assert.equal(materias.programas.find((p) => p.programaId === 'cibernarium:1601188')?.temas.length, 0);
});

test('materia y nivel se acreditan por separado con el contenido y el censo exactos', () => {
  const resultado = evaluador.evaluarClasificacion({ ...oferta, evidencia_materia: evidencia });
  assert.deepEqual(resultado.metadatos.temas, ['digital', 'ia']);
  assert.equal(resultado.metadatos.nivel.valor, null);
  assert.deepEqual(resultado.revisionNivel, { estado: 'no-aplicada', motivo: 'evidencia-nivel-ausente' });
  assert.deepEqual(resultado.revision, { estado: 'aplicada' });
});

test('la guarda histórica exige soporte mientras el censo v5 acredita IA por separado', () => {
  const conSoporteAusente = {
    ...programa,
    nivel: { ...programa.nivel, evidencia: { url: captura.url, sha256: captura.sha256, capturadoEl: null } },
  };
  const evaluadorConSoporte = crearEvaluadorClasificacion(
    { programas: [conSoporteAusente], unidadesRevisadas: { [identidadEditorial(oferta)]: firmaEditorial(oferta) } },
    [ancla],
  );
  const legacy = evaluadorConSoporte.evaluarClasificacion(oferta);
  assert.deepEqual(legacy.metadatos.temas, ['no-indicado']);
  assert.deepEqual(legacy.revision, { estado: 'no-aplicada', motivo: 'evidencia-nivel-ausente' });
  const actual = evaluadorConSoporte.evaluarClasificacion({
    ...oferta,
    evidencia_materia: { ...evidencia, contenido: null },
  });
  assert.deepEqual(actual.metadatos.temas, ['ia']);
  assert.deepEqual(actual.revision, { estado: 'aplicada' });
  assert.deepEqual(actual.revisionNivel, legacy.revisionNivel);
});

test('censo ausente no inventa IA y el parcial solo conserva su evidencia previa', () => {
  const sin = { ...evidencia, censo_ia: null, estado_censo: 'completo' as const };
  assert.deepEqual(evaluador.evaluarClasificacion({ ...oferta, evidencia_materia: sin }).metadatos.temas, ['digital']);
  const parcial = { ...evidencia, estado_censo: 'parcial' as const };
  assert.deepEqual(evaluador.evaluarClasificacion({ ...oferta, evidencia_materia: parcial }).metadatos.temas, [
    'digital',
    'ia',
  ]);
  const nunca = { ...sin, estado_censo: 'sin-evidencia' as const };
  assert.deepEqual(evaluador.evaluarClasificacion({ ...oferta, evidencia_materia: nunca }).metadatos.temas, [
    'digital',
  ]);
});

test('contenido cambiado no hereda revisión antigua aunque el censo siga acreditando IA', () => {
  const cambiada = { ...evidencia, contenido: { ...evidencia.contenido, sha256: 'c'.repeat(CIFRAS_SHA) } };
  const resultado = evaluador.evaluarClasificacion({ ...oferta, evidencia_materia: cambiada });
  assert.deepEqual(resultado.metadatos.temas, ['ia']);
  assert.deepEqual(resultado.revisionContenido, { estado: 'no-aplicada', motivo: 'contenido-distinto' });
  const sinCenso = { ...cambiada, censo_ia: null, estado_censo: 'completo' as const };
  assert.deepEqual(evaluador.evaluarClasificacion({ ...oferta, evidencia_materia: sinCenso }).metadatos.temas, [
    'no-indicado',
  ]);
});

test('otra edición y otra URL se admiten solo con el vínculo e identidad correspondientes', () => {
  const nueva = {
    ...oferta,
    unidad: { ...oferta.unidad, id: 'cibernarium-edicion:3' },
    url: 'https://example.org/nueva',
    evidencia_materia: { ...evidencia, edicion_id: 'cibernarium-edicion:3' },
  };
  assert.deepEqual(evaluador.evaluarClasificacion(nueva).metadatos.temas, ['digital', 'ia']);
  assert.deepEqual(evaluador.evaluarClasificacion({ ...nueva, evidencia_materia: evidencia }).metadatos.temas, [
    'no-indicado',
  ]);
  assert.deepEqual(
    evaluador.evaluarClasificacion({
      ...nueva,
      evidencia_materia: { ...nueva.evidencia_materia, programa_id: 'cibernarium:otra' },
    }).metadatos.temas,
    ['no-indicado'],
  );
});

test('la fecha antigua no se rejuvenece y la forma previa conserva sus guardas', () => {
  const vieja = { ...evidencia, censo_ia: { ...evidencia.censo_ia, capturado_utc: '2020-01-01T00:00:00Z' } };
  assert.deepEqual(evaluador.evaluarClasificacion({ ...oferta, evidencia_materia: vieja }).metadatos.temas, [
    'digital',
    'ia',
  ]);
  assert.deepEqual(evaluador.evaluarClasificacion(oferta).metadatos.temas, ['empresa']);
  assert.deepEqual(evaluador.evaluarClasificacion({ ...oferta, url: 'https://example.org/otra' }).metadatos.temas, [
    'no-indicado',
  ]);
});

test('cambiar los objetos de entrada después no altera el evaluador capturado', () => {
  const editorial = structuredClone(programa);
  const materia = structuredClone(ancla);
  const firmas = { [identidadEditorial(oferta)]: firmaEditorial(oferta) };
  const estable = crearEvaluadorClasificacion({ programas: [editorial], unidadesRevisadas: firmas }, [materia]);
  editorial.titulo = 'Otro título';
  materia.contenido.sha256 = 'd'.repeat(CIFRAS_SHA);
  firmas[identidadEditorial(oferta)] = 'e'.repeat(CIFRAS_SHA);
  assert.deepEqual(estable.evaluarClasificacion({ ...oferta, evidencia_materia: evidencia }).metadatos.temas, [
    'digital',
    'ia',
  ]);
  assert.deepEqual(estable.evaluarClasificacion(oferta).metadatos.temas, ['empresa']);
});
