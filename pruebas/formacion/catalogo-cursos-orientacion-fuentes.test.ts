import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { EntregaCatalogo, OfertaCatalogo } from '../../src/catalogo-cursos/contrato.ts';
import { orientadorDelCatalogo } from '../../src/catalogo-cursos/idioma-cibernarium.ts';
import { enriquecerIdiomaNivel } from '../../src/catalogo-cursos/idioma-nivel.ts';
import { nivelFundae } from '../../src/catalogo-cursos/nivel-fundae.ts';
import entrega from '../fixtures/catalogo-cursos-idioma-ejemplos.json' with { type: 'json' };

const [cibernarium, fundae] = entrega.ofertas as unknown as readonly [OfertaCatalogo, OfertaCatalogo];

test('el historial de ediciones orienta solo en el ámbito calibrado, y una declaración lo sustituye', () => {
  const curso: OfertaCatalogo = {
    ...cibernarium,
    corte_evaluacion_utc: '2026-11-19T00:00:00Z',
    hechos: {
      ...cibernarium.hechos,
      modalidad: { ...cibernarium.hechos.modalidad, motivo: 'conocido', valor: 'presencial' },
      sincronia: { ...cibernarium.hechos.sincronia, motivo: 'conocido', valor: 'sincrona' },
      idiomas_declarados: { ...cibernarium.hechos.idiomas_declarados, motivo: 'no_consta_en_evidencia', valor: null },
    },
  };
  const calculado = enriquecerIdiomaNivel(curso, { idiomaRevisado: null }).idioma;
  assert.deepEqual(calculado.valores, ['ca']);
  assert.equal(calculado.alcance, 'historial-cibernarium');
  assert.equal(calculado.origen, 'faro');
  assert.deepEqual(enriquecerIdiomaNivel(curso, { idiomaRevisado: null }).idioma, calculado);
  const confirmado = {
    ...curso,
    hechos: {
      ...curso.hechos,
      idiomas_declarados: { ...curso.hechos.idiomas_declarados, motivo: 'conocido', alcance: 'edicion', valor: ['es'] },
    },
  } satisfies OfertaCatalogo;
  assert.deepEqual(enriquecerIdiomaNivel(confirmado).idioma.valores, ['es']);
  const testigo = {
    ...confirmado,
    unidad: { ...confirmado.unidad, id: 'cibernarium-edicion:101' },
  };
  const catalogo = entrega as unknown as EntregaCatalogo;
  const primera = { ...catalogo, corte_proyeccion_utc: curso.corte_evaluacion_utc, ofertas: [curso] };
  assert.deepEqual(orientadorDelCatalogo(primera)(curso)?.valores, ['ca']);
  assert.equal(orientadorDelCatalogo({ ...primera, ofertas: [testigo, curso] })(curso), null);
  // Un año después, sin ninguna observación que lo contradiga, el idioma por historial sigue igual.
  const unAnoDespues = { ...curso, corte_evaluacion_utc: '2027-11-19T00:00:00Z' };
  assert.deepEqual(enriquecerIdiomaNivel(unAnoDespues, { idiomaRevisado: null }).idioma, calculado);
  const entregaUnAnoDespues = { ...primera, corte_proyeccion_utc: unAnoDespues.corte_evaluacion_utc };
  assert.deepEqual(orientadorDelCatalogo(entregaUnAnoDespues)(unAnoDespues), calculado);
  assert.equal(orientadorDelCatalogo({ ...entregaUnAnoDespues, ofertas: [testigo, unAnoDespues] })(unAnoDespues), null);
});

test('el temario oficial orienta por código, título y referencia propia de FUNDAE', () => {
  const referencia = fundae.referencias[0];
  assert.ok(referencia);
  const url = 'https://agora.fundae.es/Oferta/RecuperarDifusionesRFO?codigoTitulacion=CTRD0022';
  const curso: OfertaCatalogo = {
    ...fundae,
    unidad: { ...fundae.unidad, programa_id: 'fundae:oferta:programa:CTRD0022' },
    titulo_programa: 'OFIMÁTICA: APLICACIONES INFORMÁTICAS DE GESTIÓN',
    idioma_programa: { valores: ['es'], url, sha256: referencia.sha256 },
    referencias: [{ ...referencia, url }],
  };
  assert.equal(nivelFundae(curso)?.valor, 'inicial');
  assert.equal(nivelFundae(curso)?.origen, 'faro');
  assert.equal(nivelFundae({ ...curso, referencias: [] }), null);
  assert.equal(nivelFundae({ ...curso, titulo_programa: 'Excel avanzado para macroprogramación' }), null);
});
