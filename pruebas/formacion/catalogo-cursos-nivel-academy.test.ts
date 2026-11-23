import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { OfertaCatalogo } from '../../src/catalogo-cursos/contrato.ts';
import { nivelAcademy } from '../../src/catalogo-cursos/nivel-academy.ts';
import { fichaDelListado } from '../../src/catalogo-cursos/proyeccion-listado.ts';
import entrega from '../fixtures/catalogo-cursos-idioma-ejemplos.json' with { type: 'json' };

test('los dos prerrequisitos concretos dan orientación Faro solo con su captura', () => {
  for (const nombre of ['introduction-to-evals', 'tool-use-with-the-messages-api']) {
    const oferta = entrega.ofertas.find((o) => o.unidad.id === `claude-academy:${nombre}`) as unknown as OfertaCatalogo;
    assert.ok(oferta);
    const nivel = nivelAcademy(oferta);
    assert.equal(nivel?.valor, 'intermedio');
    assert.equal(nivel?.origen, 'faro');
    assert.match(nivel?.motivo.es ?? '', /Claude Platform 101/);
    assert.equal(fichaDelListado(oferta, 'Anthropic').nivel.valor, 'intermedio');
    assert.equal(nivelAcademy({ ...oferta, referencias: [] }), null);
    assert.equal(nivelAcademy({ ...oferta, titulo_programa: 'Otro curso' }), null);
    const primera = oferta.referencias[0];
    assert.ok(primera);
    const cambiada = {
      ...oferta,
      referencias: [...oferta.referencias, { ...primera, url: oferta.url, fecha_referencia: '2030-01-01T00:00:00Z' }],
    };
    assert.equal(nivelAcademy(cambiada), null);
  }
});
