import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { OfertaCatalogo } from '../../src/catalogo-cursos/contrato.ts';
import { enriquecerIdiomaNivel } from '../../src/catalogo-cursos/idioma-nivel.ts';
import entrega from '../fixtures/catalogo-cursos-idioma-ejemplos.json' with { type: 'json' };

function oferta(titulo = 'Herramientas digitales'): OfertaCatalogo {
  const fuente = structuredClone(entrega.ofertas[0]) as unknown as OfertaCatalogo;
  return {
    ...fuente,
    titulo_programa: titulo,
    proveedor_id: 'fundae:publicador:catalogo:3',
    referencias: fuente.referencias.map((r) => ({
      ...r,
      url: 'https://agora.fundae.es/Buscador/BuscarRecursosFormativosFundaeSEB?idCatalogo=3',
    })),
    unidad: { ...fuente.unidad, id: 'prueba-nueva', programa_id: 'prueba-nueva' },
    hechos: {
      ...fuente.hechos,
      idiomas_declarados: { ...fuente.hechos.idiomas_declarados, valor: null, motivo: 'no_consta_en_evidencia' },
      idiomas_material_observado: {
        ...fuente.hechos.idiomas_material_observado,
        valor: null,
        motivo: 'no_consta_en_evidencia',
      },
      requisitos_publicados: { ...fuente.hechos.requisitos_publicados, valor: null, motivo: 'no_consta_en_evidencia' },
    },
  };
}

test('deduplica el idioma declarado y mantiene aparte el material observado', () => {
  const base = oferta('Introducción a sistemas');
  const curso: OfertaCatalogo = {
    ...base,
    hechos: {
      ...base.hechos,
      idiomas_declarados: { ...base.hechos.idiomas_declarados, motivo: 'conocido', valor: ['ca', 'Català', 'es'] },
      idiomas_material_observado: { ...base.hechos.idiomas_material_observado, motivo: 'conocido', valor: ['en'] },
    },
  };
  const copia = structuredClone(curso);
  const resultado = enriquecerIdiomaNivel(curso);
  assert.deepEqual(resultado.idioma.valores, ['ca', 'es']);
  assert.deepEqual(resultado.material.valores, ['en']);
  assert.equal(resultado.material.alcance, 'material_observado');
  assert.equal(resultado.nivel.valor, 'inicial');
  assert.equal(resultado.nivel.origen, 'faro');
  assert.ok(resultado.nivel.evidencia?.sha256);
  assert.deepEqual(curso, copia);
  assert.deepEqual(enriquecerIdiomaNivel(curso), resultado);
});

test('título, duración o gratuidad no inventan idioma ni nivel; los requisitos no son el nivel del curso', () => {
  const base = oferta('Curs en català de fulls de càlcul');
  const curso: OfertaCatalogo = {
    ...base,
    hechos: {
      ...base.hechos,
      requisitos_publicados: {
        ...base.hechos.requisitos_publicados,
        motivo: 'conocido',
        valor: 'Nivel avanzado de inglés',
      },
    },
  };
  const resultado = enriquecerIdiomaNivel(curso);
  assert.deepEqual(resultado.idioma.valores, []);
  assert.equal(resultado.nivel.valor, null);
  assert.equal(resultado.nivel.origen, 'por-confirmar');
});

test('niveles explícitos se tratan como orientación y las señales contradictorias no se adivinan', () => {
  const avanzado = enriquecerIdiomaNivel(oferta('Tratamiento de datos: nivel avanzado'));
  assert.equal(avanzado.nivel.valor, 'avanzado');
  assert.equal(avanzado.nivel.origen, 'faro');
  assert.ok(avanzado.nivel.motivo.ca.includes('Orientació'));
  const contradictorio = enriquecerIdiomaNivel(oferta('Introducción a datos, nivel avanzado'));
  assert.equal(contradictorio.nivel.valor, null);
});

test('cambios de título o unidad no heredan el nivel de una revisión de otra edición', () => {
  const antes = oferta('Introducción a Python');
  const despues = {
    ...antes,
    titulo_programa: 'Python para equipos',
    unidad: { ...antes.unidad, id: 'nueva-edicion' },
  };
  assert.equal(enriquecerIdiomaNivel(antes).nivel.valor, 'inicial');
  assert.equal(enriquecerIdiomaNivel(despues).nivel.valor, null);
  assert.equal(enriquecerIdiomaNivel({ ...antes, referencias: [] }).nivel.valor, null);
});

test('norma general solo se aplica con modalidad, sincronía y captura exactas', () => {
  const base = oferta('Actividad grabada');
  assert.ok(base.evidencia_materia);
  const referenciaBase = base.referencias[0];
  assert.ok(referenciaBase);
  const curso: OfertaCatalogo = {
    ...base,
    proveedor_id: 'cibernarium',
    evidencia_materia: { ...base.evidencia_materia, edicion_id: base.unidad.id, programa_id: base.unidad.programa_id },
    referencias: [
      {
        ...referenciaBase,
        url: 'https://cibernarium.barcelonactiva.cat/ca/normesfaqs',
        sha256: '61ead2a96f638242bc7df86162a5363506a663ae754381bc22d021023f1c73e3',
      },
    ],
    hechos: {
      ...base.hechos,
      modalidad: { ...base.hechos.modalidad, motivo: 'conocido', valor: 'en-linea' },
      sincronia: { ...base.hechos.sincronia, motivo: 'conocido', valor: 'asincrona' },
    },
  };
  const resultado = enriquecerIdiomaNivel(curso);
  assert.equal(resultado.idioma.alcance, 'norma-general');
  assert.ok(resultado.idioma.motivo.es.includes('subtítulos'));
  assert.deepEqual(resultado.material.valores, []);
  const otra = { ...curso, hechos: { ...curso.hechos, sincronia: { ...curso.hechos.sincronia, valor: 'sincrona' } } };
  assert.deepEqual(enriquecerIdiomaNivel(otra).idioma.valores, []);
  const referenciaCurso = curso.referencias[0];
  assert.ok(referenciaCurso);
  const actualizada = {
    ...curso,
    referencias: [{ ...referenciaCurso, sha256: '561cb54c2b11e41b9c22eebd938bdfe764f54fde731397821975bbd3e42cb073' }],
  };
  const normaActualizada = enriquecerIdiomaNivel(actualizada).idioma;
  assert.deepEqual(normaActualizada.valores, ['ca', 'es']);
  assert.equal(normaActualizada.alcance, 'norma-general');
  assert.ok(normaActualizada.motivo.es.includes('vídeo en catalán'));
  assert.ok(normaActualizada.motivo.es.includes('subtítulos en castellano'));
  assert.ok(normaActualizada.motivo.es.includes('documentación en ambos idiomas'));
  const alterada = { ...curso, referencias: [{ ...referenciaCurso, sha256: 'alterada' }] };
  assert.deepEqual(enriquecerIdiomaNivel(alterada).idioma.valores, []);
});

test('las pistas por edición se anclan a la unidad, captura, modalidad y sincronía', () => {
  const base = oferta('Una formación');
  const referencia = base.referencias[0];
  assert.ok(referencia);
  const pista = {
    unidad: base.unidad,
    proveedor_id: base.proveedor_id,
    titulo: base.titulo_programa,
    modalidad: base.hechos.modalidad,
    sincronia: base.hechos.sincronia,
    idioma_original: base.hechos.idiomas_declarados,
    literal: 'català i castellà',
    evidencia: { url: referencia.url, sha256: referencia.sha256, capturadoEl: referencia.fecha_referencia },
  };
  const opciones = { idiomaRevisado: null, idiomasEdicion: [pista] };
  assert.deepEqual(enriquecerIdiomaNivel(base, opciones).idioma.valores, ['ca', 'es']);
  assert.equal(enriquecerIdiomaNivel(base, opciones).idioma.alcance, 'edicion');
  assert.deepEqual(
    enriquecerIdiomaNivel({ ...base, unidad: { ...base.unidad, id: 'otra-edicion' } }, opciones).idioma.valores,
    [],
  );
  assert.deepEqual(
    enriquecerIdiomaNivel(
      { ...base, hechos: { ...base.hechos, modalidad: { ...base.hechos.modalidad, valor: 'mixta' } } },
      opciones,
    ).idioma.valores,
    [],
  );
  assert.deepEqual(enriquecerIdiomaNivel({ ...base, referencias: [] }, opciones).idioma.valores, []);
  assert.deepEqual(enriquecerIdiomaNivel(base, { ...opciones, idiomasEdicion: [pista, pista] }).idioma.valores, []);
});

test('se respeta el nivel del evaluador inyectado y no se sustituye por heurísticas', () => {
  const original = enriquecerIdiomaNivel(oferta('Sin nivel')).nivel;
  const nivelRevisado = { ...original, valor: 'intermedio' as const, origen: 'fuente' as const };
  assert.equal(
    enriquecerIdiomaNivel(oferta('Excel avanzado'), { nivelRevisado, idiomaRevisado: null }).nivel.valor,
    'intermedio',
  );
});

test('idioma del programa figura con edición pendiente en filtro y ficha', async () => {
  const { fichaDelListado, idiomasDelCurso } = await import('../../src/catalogo-cursos/proyeccion-listado.ts');
  const original = entrega.ofertas.find((x) => x.unidad.id === 'fundae:edicion:1021') as unknown as OfertaCatalogo;
  assert.ok(original);
  const ficha = fichaDelListado(original, 'FUNDAE');
  assert.equal(ficha.origenIdioma, 'programa');
  assert.deepEqual(ficha.idiomas, ['es']);
  assert.deepEqual(idiomasDelCurso(original), ficha.idiomas);
  assert.equal(original.hechos.idiomas_declarados.motivo, 'no_consta_en_evidencia');
  const cambiada = {
    ...original,
    referencias: original.referencias.filter((r) => !r.url.includes('/RecuperarDifusionesRFO')),
  };
  assert.deepEqual(idiomasDelCurso(cambiada), ['no-indicado']);
});

test('la entrega nueva conserva la lengua del programa con referencia y sin idioma de edición', () => {
  const original = entrega.ofertas.find((x) => x.unidad.id === 'fundae:edicion:1021') as unknown as OfertaCatalogo;
  assert.ok(original);
  const ref = original.referencias.find((r) => r.url.includes('/Oferta/RecuperarDifusionesRFO?'));
  assert.ok(ref);
  const curso: OfertaCatalogo = { ...original, idioma_programa: { valores: ['es'], url: ref.url, sha256: ref.sha256 } };
  const resultado = enriquecerIdiomaNivel(curso, { idiomaRevisado: null, idiomasPrograma: [] });
  assert.equal(resultado.idioma.alcance, 'programa');
  assert.ok(resultado.idioma.motivo.es.includes('edición por confirmar'));
  assert.equal(curso.hechos.idiomas_declarados.valor, null);
  const sinRef = { ...curso, referencias: [] };
  assert.equal(
    enriquecerIdiomaNivel(sinRef, { idiomaRevisado: null, idiomasPrograma: [] }).idioma.origen,
    'por-confirmar',
  );
});

test('una edición nueva usa su categoría admitida y rechaza señales contradictorias', () => {
  const original = entrega.ofertas.find(
    (x) => x.unidad.id === 'cibernarium-edicion:1578980',
  ) as unknown as OfertaCatalogo;
  assert.ok(original?.evidencia_materia?.contenido);
  const evidencia = original.evidencia_materia;
  const contenido = evidencia.contenido;
  assert.ok(contenido);
  const nueva: OfertaCatalogo = {
    ...original,
    evidencia_materia: {
      ...evidencia,
      contenido: {
        ...contenido,
        nivel_sugerido: { valor: 'inicial', origen: 'categoria', regla: 'nivel-cibernarium-v1' },
      },
    },
  };
  const pendiente = enriquecerIdiomaNivel(oferta('Sin nivel')).nivel;
  const datos = enriquecerIdiomaNivel(nueva, { nivelRevisado: pendiente, idiomaRevisado: null, nivelesContenido: [] });
  assert.equal(datos.nivel.valor, 'inicial');
  assert.equal(datos.nivel.origen, 'faro');
  const contradictorio = { ...nueva, titulo_programa: 'Excel avanzado' };
  assert.equal(
    enriquecerIdiomaNivel(contradictorio, { nivelRevisado: pendiente, idiomaRevisado: null, nivelesContenido: [] })
      .nivel.valor,
    null,
  );
});

test('nivel explícito de actividad Ciber conserva alcance, identidad y revisión previa', () => {
  const base = oferta('Curso avanzado');
  const ref = base.referencias[0];
  assert.ok(ref);
  const captura = { ...ref, url: 'https://www.cibervoluntarios.org/api/public/activity_catalogs?lang=es' };
  const curso: OfertaCatalogo = {
    ...base,
    proveedor_id: 'cibervoluntarios',
    unidad: { tipo: 'recurso', id: 'cibervoluntarios:material:42', programa_id: 'cibervoluntarios:material:42' },
    referencias: [captura],
    nivel_actividad: {
      valor: 'avanzado',
      literal: 'Avanzado',
      actividad_id: '7',
      material_id: '42',
      url: captura.url,
      sha256: captura.sha256,
      capturado_utc: captura.fecha_referencia,
      localizador: '/hydra:member/3/level',
    },
  };
  const pendiente = enriquecerIdiomaNivel(oferta('Sin nivel')).nivel;
  const resultado = enriquecerIdiomaNivel(curso, { nivelRevisado: pendiente, idiomaRevisado: null });
  assert.equal(resultado.nivel.valor, 'avanzado');
  assert.equal(resultado.nivel.origen, 'fuente');
  assert.match(resultado.nivel.motivo.es, /actividad que contiene/);
  const otro = { ...curso, unidad: { ...curso.unidad, id: 'cibervoluntarios:material:43' } };
  assert.equal(enriquecerIdiomaNivel(otro, { nivelRevisado: pendiente, idiomaRevisado: null }).nivel.valor, null);
  const contradictorio = { ...curso, titulo_programa: 'Curso básico' };
  assert.equal(
    enriquecerIdiomaNivel(contradictorio, { nivelRevisado: pendiente, idiomaRevisado: null }).nivel.valor,
    null,
  );
  const revisado = { ...pendiente, valor: 'intermedio' as const, origen: 'fuente' as const };
  assert.equal(
    enriquecerIdiomaNivel(curso, { nivelRevisado: revisado, idiomaRevisado: null }).nivel.valor,
    'intermedio',
  );
});
