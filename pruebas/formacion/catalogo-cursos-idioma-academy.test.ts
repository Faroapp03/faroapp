import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { OfertaCatalogo } from '../../src/catalogo-cursos/contrato.ts';
import { idiomaAcademy } from '../../src/catalogo-cursos/idioma-academy.ts';
import { fichaDelListado, idiomasDelCurso } from '../../src/catalogo-cursos/proyeccion-listado.ts';
import entrega from '../fixtures/catalogo-cursos-idioma-ejemplos.json' with { type: 'json' };

test('Course.inLanguage está vinculado a cada recurso, URL, título y captura', () => {
  for (const id of ['introduction-to-evals', 'tool-use-with-the-messages-api']) {
    const oferta = entrega.ofertas.find((x) => x.unidad.id === `claude-academy:${id}`) as unknown as OfertaCatalogo;
    assert.ok(oferta);
    assert.deepEqual(idiomasDelCurso(oferta), ['en']);
    assert.deepEqual(fichaDelListado(oferta, 'Anthropic').idiomas, ['en']);
    assert.equal(idiomaAcademy(oferta)?.evidencias[0]?.localizador, 'Course.inLanguage');
    assert.equal(idiomaAcademy({ ...oferta, titulo_programa: 'Otro curso' }), null);
    assert.equal(idiomaAcademy({ ...oferta, referencias: [] }), null);
    const ref = oferta.referencias[0];
    assert.ok(ref);
    const cambiada = {
      ...oferta,
      referencias: [
        ...oferta.referencias,
        { ...ref, url: oferta.url, sha256: 'otra-huella', fecha_referencia: '2030-01-01T00:00:00Z' },
      ],
    };
    assert.equal(idiomaAcademy(cambiada), null);
    assert.equal(idiomaAcademy({ ...oferta, unidad: { ...oferta.unidad, id: 'otro' } }), null);
    assert.equal(idiomaAcademy({ ...oferta, url: 'https://academy.claude.com/courses/otro' }), null);
  }
});
