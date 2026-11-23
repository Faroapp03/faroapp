import assert from 'node:assert/strict';
import test from 'node:test';
import { idiomaClasificadoDelCurso } from '../../src/catalogo-cursos/clasificacion.ts';
import { idiomasDelCurso } from '../../src/catalogo-cursos/consulta.ts';
import type { HechoCatalogo, OfertaCatalogo } from '../../src/catalogo-cursos/contrato.ts';
import { CATALOGO_CLASIFICACION as catalogo } from '../ayudas/catalogo-clasificacion.ts';

const complementadas = catalogo.ofertas.filter((oferta) => idiomaClasificadoDelCurso(oferta));
const ESPERADOS = { total: 313, edicion: 160, norma: 28, faro: 125, declaradas: 21 };
/** Ediciones de Cibernàrium cuyo idioma se guardó con el calendario detrás; la entrega lo relee con la regla vigente. */
const RELEIDAS = new Set(
  (
    '1578850 1587837 1588857 1588858 1588894 1590269 1590279 1590943 1590949 1591593 1591995 1592279 1592352 ' +
    '1592398 1592704 1593282 1593803 1593890 1593916 1593917 1610699'
  )
    .split(' ')
    .map((id) => `cibernarium-edicion:${id}`),
);

function ofertaDeAlcance(alcance: 'edicion' | 'norma-general' | 'orientacion'): OfertaCatalogo {
  const oferta = complementadas.find((oferta) => idiomaClasificadoDelCurso(oferta)?.alcance === alcance);
  assert.ok(oferta, alcance);
  return oferta;
}

function conHecho(
  oferta: OfertaCatalogo,
  campo: 'idiomas_declarados' | 'modalidad' | 'sincronia',
  hecho: HechoCatalogo,
) {
  return { ...oferta, hechos: { ...oferta.hechos, [campo]: hecho } };
}

test('313 complementos exactos separan 160 ediciones, 28 normas y 125 orientaciones de confianza baja', () => {
  assert.equal(complementadas.length, ESPERADOS.total);
  const revisiones = complementadas.map(idiomaClasificadoDelCurso);
  assert.equal(revisiones.filter((r) => r?.alcance === 'edicion').length, ESPERADOS.edicion);
  assert.equal(revisiones.filter((r) => r?.alcance === 'norma-general').length, ESPERADOS.norma);
  assert.equal(revisiones.filter((r) => r?.origen === 'faro').length, ESPERADOS.faro);
  for (const oferta of complementadas) {
    const idioma = idiomaClasificadoDelCurso(oferta);
    assert.ok(idioma);
    assert.equal(oferta.hechos.idiomas_declarados.valor, null);
    assert.equal(oferta.hechos.idiomas_declarados.motivo, 'no_consta_en_evidencia');
    assert.ok(idioma.motivo.es && idioma.motivo.ca);
    assert.ok(idioma.evidencias.length > 0);
    for (const evidencia of idioma.evidencias) {
      assert.match(evidencia.url, /^https:\/\//u);
      assert.match(evidencia.sha256, /^[a-f0-9]{64}$/u);
      assert.ok(evidencia.capturadoEl && Number.isFinite(Date.parse(evidencia.capturadoEl)));
    }
    assert.deepEqual(idiomasDelCurso(oferta), idioma.valores);
    assert.ok(Object.isFrozen(idioma) && Object.isFrozen(idioma.valores));
  }
});

test('la norma general conserva el reparto de usos sin afirmar observación de materiales individuales', () => {
  const idioma = idiomaClasificadoDelCurso(ofertaDeAlcance('norma-general'));
  assert.ok(idioma);
  assert.equal(idioma.origen, 'fuente');
  assert.equal(idioma.confianza, 'alta-en-la-norma-general');
  assert.equal(idioma.literal, null);
  assert.deepEqual(idioma.valores, ['ca', 'es']);
  assert.match(idioma.motivo.es, /vídeo en catalán.*subtítulos en castellano/u);
  assert.match(idioma.motivo.es, /no se han observado/u);
  assert.ok(idioma.resumen?.es && idioma.resumen.ca);
});

test('las 125 inferencias mantienen origen Faro, confianza baja y advertencia bilingüe', () => {
  for (const oferta of complementadas) {
    const idioma = idiomaClasificadoDelCurso(oferta);
    if (idioma?.origen !== 'faro') {
      continue;
    }
    assert.equal(idioma.alcance, 'orientacion');
    assert.equal(idioma.confianza, 'baja');
    assert.equal(idioma.literal, null);
    assert.match(idioma.motivo.es, /^Faro/u);
    assert.match(idioma.motivo.ca, /^Faro/u);
    assert.match(idioma.resumen?.es ?? '', /Faro.*confianza baja/u);
    assert.match(idioma.resumen?.ca ?? '', /Faro.*confiança baixa/u);
    assert.match(idioma.motivo.es, /no confirma la lengua/u);
  }
});

test('no se hereda un complemento al cambiar identidad, unidad, tipo o declaración original', () => {
  for (const alcance of ['edicion', 'norma-general', 'orientacion'] as const) {
    const original = ofertaDeAlcance(alcance);
    const cambios: OfertaCatalogo[] = [
      { ...original, titulo_programa: 'Otro contenido' },
      { ...original, proveedor_id: 'otro' },
      { ...original, unidad: { ...original.unidad, programa_id: 'otro' } },
      { ...original, unidad: { ...original.unidad, id: 'otra-edicion' } },
      { ...original, unidad: { ...original.unidad, tipo: 'recurso' } },
      conHecho(original, 'idiomas_declarados', { ...original.hechos.idiomas_declarados, valor: ['en'] }),
      conHecho(original, 'idiomas_declarados', { ...original.hechos.idiomas_declarados, motivo: 'no_interpretable' }),
    ];
    for (const cambiada of cambios) {
      assert.equal(idiomaClasificadoDelCurso(cambiada), null, alcance);
      assert.deepEqual(idiomasDelCurso(cambiada), ['no-indicado']);
    }
  }
});

test('modalidad y sincronía base impiden aplicar normas o inferencias a una oferta cambiada', () => {
  for (const alcance of ['norma-general', 'orientacion'] as const) {
    const original = ofertaDeAlcance(alcance);
    for (const campo of ['modalidad', 'sincronia'] as const) {
      const cambio = conHecho(original, campo, { ...original.hechos[campo], valor: 'mixta' });
      const desconocido = conHecho(original, campo, { ...original.hechos[campo], motivo: 'no_consta_en_evidencia' });
      assert.equal(idiomaClasificadoDelCurso(cambio), null);
      assert.equal(idiomaClasificadoDelCurso(desconocido), null);
      assert.deepEqual(idiomasDelCurso(cambio), ['no-indicado']);
    }
  }
});

test('los hechos nuevos conocidos tienen prioridad y las 21 ediciones releídas declaran su idioma', () => {
  for (const alcance of ['edicion', 'norma-general', 'orientacion'] as const) {
    const original = ofertaDeAlcance(alcance);
    const cambio = conHecho(original, 'idiomas_declarados', {
      ...original.hechos.idiomas_declarados,
      motivo: 'conocido',
      valor: ['English', 'fr'],
    });
    assert.equal(idiomaClasificadoDelCurso(cambio), null);
    assert.deepEqual(idiomasDelCurso(cambio), ['en', 'fr']);
  }
  const releidas = catalogo.ofertas.filter((oferta) => RELEIDAS.has(oferta.unidad.id));
  assert.equal(releidas.length, ESPERADOS.declaradas);
  for (const oferta of releidas) {
    assert.deepEqual(oferta.hechos.idiomas_declarados.valor, ['Català']);
    assert.equal(idiomaClasificadoDelCurso(oferta), null);
    assert.deepEqual(idiomasDelCurso(oferta), ['ca']);
  }
});
