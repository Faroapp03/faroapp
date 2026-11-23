import assert from 'node:assert/strict';
import test from 'node:test';
import {
  crearEvaluadorClasificacion,
  evaluarClasificacion,
  metadatosClasificados,
} from '../../src/catalogo-cursos/clasificacion.ts';
import { CAMPOS_HECHOS, type HechoCatalogo, type OfertaCatalogo } from '../../src/catalogo-cursos/contrato.ts';
import { firmaEditorial, identidadEditorial } from '../../src/catalogo-cursos/firma-editorial.ts';

const hecho: HechoCatalogo = {
  valor: null,
  motivo: 'no_consta_en_evidencia',
  unidad: null,
  moneda: null,
  alcance: 'unidad',
};
const CIFRAS_SHA256 = 64;
const nivel = { url: 'https://example.org/nivel', sha256: 'a'.repeat(CIFRAS_SHA256), capturadoEl: null };
const idioma = { url: 'https://example.org/idioma', sha256: 'b'.repeat(CIFRAS_SHA256), capturadoEl: null };
const referencia = (e: typeof nivel) => ({
  url: e.url,
  sha256: e.sha256,
  fecha_referencia: '2026-01-01T00:00:00Z',
  alcance: 'entidad' as const,
  naturaleza_fecha: 'recepcion_conservada' as const,
  naturaleza_documento: 'no_acreditada' as const,
});
const oferta: OfertaCatalogo = {
  unidad: { tipo: 'edicion', id: 'edicion-sintetica', programa_id: 'programa-sintetico' },
  proveedor_id: 'proveedor-sintetico',
  titulo_programa: 'Curso sintético',
  tipo_unidad: 'curso',
  url: 'https://example.org/curso',
  hechos: Object.fromEntries(CAMPOS_HECHOS.map((campo) => [campo, hecho])) as OfertaCatalogo['hechos'],
  referencias: [referencia(nivel), referencia(idioma)],
  comprobado_el: '2026-01-01T00:00:00Z',
  cierra_el: null,
  incidencia_enlace_el: null,
  corte_evaluacion_utc: '2026-01-01T00:00:00Z',
};
const programa = {
  programaId: oferta.unidad.programa_id,
  titulo: oferta.titulo_programa,
  proveedorId: oferta.proveedor_id,
  temas: ['ia'] as const,
  motivoTemas: { es: 'Materia sintética.', ca: 'Matèria sintètica.' },
  nivel: {
    valor: 'inicial' as const,
    origen: 'fuente' as const,
    literal: 'inicial',
    motivo: { es: 'Nivel sintético.', ca: 'Nivell sintètic.' },
    evidencia: nivel,
    alcance: 'unidad',
    escala: null,
  },
  idiomasClasificados: [
    {
      unidadId: oferta.unidad.id,
      tipoUnidad: oferta.unidad.tipo,
      valorOriginal: hecho.valor,
      motivoOriginal: hecho.motivo,
      modalidadOriginal: hecho,
      sincroniaOriginal: hecho,
      valores: ['ca'],
      origen: 'faro' as const,
      alcance: 'orientacion' as const,
      confianza: 'baja' as const,
      literal: null,
      motivo: { es: 'Idioma sintético.', ca: 'Idioma sintètic.' },
      evidencias: [idioma],
      anclajesEnOferta: [0],
    },
  ],
};
const evaluador = crearEvaluadorClasificacion({
  programas: [programa],
  unidadesRevisadas: { [identidadEditorial(oferta)]: firmaEditorial(oferta) },
});

test('diagnostica la primera guarda incumplida y conserva los metadatos por confirmar', () => {
  const casos = [
    [
      { ...oferta, unidad: { ...oferta.unidad, programa_id: 'otro' }, titulo_programa: 'otro' },
      'programa-sin-revision',
    ],
    [{ ...oferta, titulo_programa: 'otro', proveedor_id: 'otro' }, 'titulo-distinto'],
    [{ ...oferta, proveedor_id: 'otro', unidad: { ...oferta.unidad, id: 'otra' } }, 'proveedor-distinto'],
    [{ ...oferta, unidad: { ...oferta.unidad, id: 'otra' }, url: 'https://example.org/otra' }, 'unidad-sin-revision'],
    [{ ...oferta, url: 'https://example.org/otra', referencias: [] }, 'firma-distinta'],
  ] as const;
  for (const [entrada, motivo] of casos) {
    const resultado = evaluador.evaluarClasificacion(entrada);
    assert.deepEqual(resultado.revision, { estado: 'no-aplicada', motivo });
    assert.deepEqual(resultado.metadatos.temas, ['no-indicado']);
    assert.equal(resultado.metadatos.nivel.valor, null);
    assert.equal(resultado.metadatos.nivel.origen, 'por-confirmar');
  }
});

test('la revisión aplicada conserva la identidad de los metadatos y no depende de fechas', () => {
  const resultado = evaluador.evaluarClasificacion(oferta);
  assert.deepEqual(resultado.revision, { estado: 'aplicada' });
  assert.deepEqual(resultado.metadatos, programa);
  const nuevaFecha = {
    ...oferta,
    referencias: oferta.referencias.map((r) => ({ ...r, fecha_referencia: '2026-02-01T00:00:00Z' })),
  };
  assert.deepEqual(evaluador.evaluarClasificacion(nuevaFecha).metadatos, programa);
  assert.deepEqual(evaluador.evaluarClasificacion(nuevaFecha).revision, { estado: 'aplicada' });
  assert.deepEqual(evaluarClasificacion(oferta).metadatos, metadatosClasificados(oferta));
});

test('retirar la evidencia de nivel no invalida el idioma con su propio anclaje', () => {
  const complemento = evaluador.idiomaClasificadoDelCurso(oferta);
  assert.deepEqual(complemento, programa.idiomasClasificados[0]);
  const sinNivel = { ...oferta, referencias: [referencia(idioma)] };
  assert.deepEqual(evaluador.evaluarClasificacion(sinNivel).revisionNivel, {
    estado: 'no-aplicada',
    motivo: 'evidencia-nivel-ausente',
  });
  assert.deepEqual(evaluador.evaluarClasificacion(sinNivel).revision, {
    estado: 'no-aplicada',
    motivo: 'evidencia-nivel-ausente',
  });
  assert.deepEqual(evaluador.evaluarClasificacion(sinNivel).metadatos.temas, ['no-indicado']);
  assert.equal(evaluador.evaluarClasificacion(sinNivel).metadatos.nivel.valor, null);
  assert.equal(evaluador.idiomaClasificadoDelCurso(sinNivel), complemento);
  assert.equal(evaluador.idiomaClasificadoDelCurso({ ...oferta, referencias: [referencia(nivel)] }), null);
  assert.equal(evaluador.idiomaClasificadoDelCurso({ ...oferta, url: 'https://example.org/otra' }), null);
});

test('el evaluador conserva una instantánea de las firmas recibidas', () => {
  const identidad = identidadEditorial(oferta);
  const firmas: Record<string, string> = { [identidad]: firmaEditorial(oferta) };
  const estable = crearEvaluadorClasificacion({ programas: [programa], unidadesRevisadas: firmas });
  firmas[identidad] = 'firma-cambiada';
  assert.deepEqual(estable.evaluarClasificacion(oferta).revision, { estado: 'aplicada' });
  assert.deepEqual(estable.idiomaClasificadoDelCurso(oferta), programa.idiomasClasificados[0]);
  assert.deepEqual(
    crearEvaluadorClasificacion({ programas: [programa], unidadesRevisadas: firmas }).evaluarClasificacion(oferta)
      .revision,
    { estado: 'no-aplicada', motivo: 'firma-distinta' },
  );
});
