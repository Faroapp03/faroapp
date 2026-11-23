import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  idiomaClasificadoDelCurso,
  idiomasDelCurso,
  metadatosClasificados,
  type OfertaCatalogo,
  origenIdiomaDelCurso,
} from '../../web/recursos/catalogo-cursos/lector.js';
import { describirIdiomas, nombreIdioma } from '../../web/scripts/catalogo-cursos/descripcion-idioma.js';
import { CATALOGO_CLASIFICACION as catalogo } from '../ayudas/catalogo-clasificacion.ts';

/** El idioma de una oferta como lo escribe la ficha de Cursos: lo que el listado proyecta de ella, ya descrito. */
function presentarIdiomas(oferta: OfertaCatalogo, idioma: 'es' | 'ca') {
  return describirIdiomas(idiomasDelCurso(oferta), origenIdiomaDelCurso(oferta), idioma);
}

test('las estimaciones conservan el aviso en fichas y en su texto compacto', () => {
  const estimadas = catalogo.ofertas.filter((o) => idiomaClasificadoDelCurso(o)?.origen === 'faro');
  assert.ok(estimadas.length > 0);
  for (const oferta of estimadas) {
    for (const idioma of ['es', 'ca'] as const) {
      const vista = presentarIdiomas(oferta, idioma);
      assert.ok(vista.valor);
      assert.match(vista.nota, /Faro/u);
      assert.match(vista.nota, idioma === 'es' ? /Confianza baja/u : /Confiança baixa/u);
      assert.match(vista.compacto ?? '', /orientaci[oó]/u);
      assert.match(vista.compacto ?? '', /confirma/u);
    }
  }
});

test('una norma de subtítulos no se presenta como voz castellana confirmada en esa edición', () => {
  const normativas = catalogo.ofertas.filter((o) => idiomaClasificadoDelCurso(o)?.alcance === 'norma-general');
  assert.ok(normativas.length > 0);
  for (const oferta of normativas) {
    for (const idioma of ['es', 'ca'] as const) {
      const vista = presentarIdiomas(oferta, idioma);
      assert.match(vista.valor ?? '', /Vídeo en catal/u);
      assert.match(vista.valor ?? '', /subt[íi]t[uo]l/u);
      assert.match(vista.nota, /norma general/u);
      assert.match(vista.compacto ?? '', /norma general/u);
      assert.doesNotMatch(vista.nota, /esta edici[oó]/u);
    }
  }
});

test('una declaración nueva prevalece sobre la estimación y desaparece su etiqueta Faro', () => {
  const oferta = structuredClone(catalogo.ofertas.find((o) => idiomaClasificadoDelCurso(o)?.origen === 'faro'));
  assert.ok(oferta);
  const corregida = {
    ...oferta,
    hechos: {
      ...oferta.hechos,
      idiomas_declarados: { ...oferta.hechos.idiomas_declarados, motivo: 'conocido' as const, valor: ['en'] },
    },
  };
  assert.deepEqual(presentarIdiomas(corregida, 'es'), {
    valor: 'Inglés',
    nota: 'Idioma publicado para este curso.',
    compacto: 'Inglés',
  });
});

test('una unidad sin revisión conserva los desconocidos en nivel e idioma de presentación', () => {
  const oferta = catalogo.ofertas.find((o) => idiomaClasificadoDelCurso(o)?.origen === 'faro');
  assert.ok(oferta);
  const nueva = { ...oferta, unidad: { ...oferta.unidad, id: 'edicion-sin-revision' } };
  const nivel = metadatosClasificados(nueva).nivel;
  assert.equal(nivel.valor, null);
  assert.equal(nivel.origen, 'por-confirmar');
  assert.match(nivel.motivo.es, /No hay una revisión/u);
  assert.match(nivel.motivo.ca, /No hi ha una revisió/u);
  for (const idioma of ['es', 'ca'] as const) {
    assert.deepEqual(presentarIdiomas(nueva, idioma), { valor: null, nota: '', compacto: null });
  }
});

test('los nombres de idioma de producción conservan las lenguas y los códigos no válidos', () => {
  assert.equal(nombreIdioma('es', 'es'), 'Castellano');
  assert.equal(nombreIdioma('es', 'ca'), 'Castellà');
  assert.equal(nombreIdioma('en', 'es'), 'Inglés');
  assert.equal(nombreIdioma('en', 'ca'), 'Anglès');
  // Un código que no está en la tabla se escribe tal cual, en mayúsculas; una variante regional, por su idioma.
  assert.equal(nombreIdioma('xx', 'es'), 'XX');
  assert.equal(nombreIdioma('zh-Hant', 'ca'), 'ZH-HANT');
  assert.equal(nombreIdioma('Francés', 'es'), 'Francés');
  assert.equal(nombreIdioma('en-GB', 'ca'), 'Anglès');
  assert.equal(nombreIdioma('fr', 'es'), 'Francés');
});
