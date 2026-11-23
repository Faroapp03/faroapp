// Qué afirmación de requisito pide confirmación: solo una condición revisada o una afirmación sin revisión vigente.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { CompaneroAprendizaje, FichaAprendizaje } from '../../src/seleccion-formacion/contrato.ts';
import { medirRequisitos, type Revision, requisitosDeFicha } from '../../src/seleccion-formacion/requisitos.ts';
import { REVISION_REQUISITOS } from '../../src/seleccion-formacion/requisitos-revisados.ts';
import { seleccionarConRevision } from '../../src/seleccion-formacion/seleccionar.ts';
import { AHORA_FORMACION, casoDeFormacion, PREFERENCIAS_FORMACION } from '../fixtures/seleccion-formacion.ts';

const LITERAL = 'Saber guardar un fichero.';
const CIFRAS_SHA = 64;
const HUELLA = 'c'.repeat(CIFRAS_SHA);
const RAZON = { es: 'Razón sintética.', ca: 'Raó sintètica.' };
const RESUMEN = { es: 'Saber guardar un archivo.', ca: 'Saber desar un fitxer.' };

/** El caso de formación con un requisito publicado, su identificador y una revisión que lo decide. */
function conRequisito() {
  const caso = casoDeFormacion(true);
  const ficha = caso.companero.fichas[0];
  assert.ok(ficha);
  const id = JSON.stringify([ficha.programa_id, 'entrada']);
  const elegir = (revision: Revision, requisitosConfirmados: readonly string[] = []) =>
    seleccionarConRevision({
      catalogo: caso.catalogo,
      companero: caso.companero,
      p: { ...PREFERENCIAS_FORMACION, requisitosConfirmados },
      ahora: AHORA_FORMACION,
      revision,
    });
  return { id, elegir, ficha, companero: caso.companero };
}
const informativa = (id: string, cambios = {}): Revision => ({
  [id]: { tipo: 'descripcion', revisadaSobre: HUELLA, literal: LITERAL, razon: RAZON, ...cambios },
});
const condicion = (id: string): Revision => ({
  [id]: { tipo: 'condicion', revisadaSobre: HUELLA, literal: LITERAL, resumen: RESUMEN, razon: RAZON },
});

test('Un curso cuya única afirmación de requisito es informativa entra en el plan sin confirmar nada', () => {
  const { id, elegir, ficha } = conRequisito();
  const s = elegir(informativa(id));
  assert.deepEqual(s.descartes, []);
  assert.deepEqual(s.requisitosPendientes, []);
  assert.deepEqual(
    s.camino?.recursos.map((r) => r.ficha.programa_id),
    [ficha.programa_id],
  );
  assert.deepEqual(
    requisitosDeFicha(ficha, informativa(id)).map((r) => [r.id, r.caso, r.resumen]),
    [[id, 'informativa', null]],
  );
});
test('Una condición revisada descarta el curso hasta confirmarla y se ofrece con su resumen', () => {
  const { id, elegir } = conRequisito();
  const s = elegir(condicion(id));
  assert.deepEqual(
    s.descartes.map((d) => d.motivo),
    ['requisito_sin_confirmar'],
  );
  assert.deepEqual(
    s.requisitosPendientes.map((r) => [r.id, r.caso, r.resumen, r.descripcion]),
    [[id, 'condicion', RESUMEN, LITERAL]],
  );
  const confirmada = elegir(condicion(id), [id]);
  assert.equal(confirmada.estado, 'parcial');
  assert.deepEqual(confirmada.requisitosPendientes, []);
});
test('Una afirmación sin decisión pide confirmación con su texto publicado y su idioma', () => {
  const { id, elegir, ficha } = conRequisito();
  const s = elegir({});
  assert.deepEqual(
    s.descartes.map((d) => d.motivo),
    ['requisito_sin_confirmar'],
  );
  assert.deepEqual(s.requisitosPendientes, [
    {
      id,
      programa_id: ficha.programa_id,
      caso: 'sin_revisar',
      descripcion: LITERAL,
      idioma: ficha.idioma_ficha,
      resumen: null,
    },
  ]);
  assert.equal(elegir({}, [id]).estado, 'parcial');
});
test('Con la misma frase y otra captura de la página, la decisión se aplica y queda contada como informativa', () => {
  const { id, elegir, companero } = conRequisito();
  const revision = informativa(id, { revisadaSobre: 'd'.repeat(CIFRAS_SHA) });
  const s = elegir(revision);
  assert.deepEqual(s.descartes, []);
  assert.deepEqual(s.requisitosPendientes, []);
  assert.deepEqual(medirRequisitos(companero.fichas, revision), {
    condicion: 0,
    informativa: 1,
    sin_revisar: 0,
    decisiones_literal_distinto: 0,
    decisiones_sin_afirmacion: 0,
    aplicadas_sobre_otra_captura: 1,
  });
});
test('Con otra frase y la misma captura, la decisión deja de aplicarse, sin lanzar, y queda contada', () => {
  const { id, elegir, companero } = conRequisito();
  const revision = informativa(id, { literal: 'Saber guardar un fichero en la nube.' });
  const s = elegir(revision);
  assert.deepEqual(
    s.requisitosPendientes.map((r) => [r.id, r.caso, r.resumen]),
    [[id, 'sin_revisar', null]],
  );
  assert.deepEqual(medirRequisitos(companero.fichas, revision), {
    condicion: 0,
    informativa: 0,
    sin_revisar: 1,
    decisiones_literal_distinto: 1,
    decisiones_sin_afirmacion: 0,
    aplicadas_sobre_otra_captura: 0,
  });
});
test('La medida cuenta cada caso y las decisiones que no corresponden a ninguna afirmación', () => {
  const { id, ficha } = conRequisito();
  const otra = JSON.stringify([ficha.programa_id, 'otra']);
  const segunda: FichaAprendizaje = {
    ...ficha,
    programa_id: 'programa-sintetico-2',
    aprendizaje: {
      ...ficha.aprendizaje,
      afirmaciones: ficha.aprendizaje.afirmaciones.map((a) =>
        a.dimension === 'requisito_entrada' ? { ...a, id: 'entrada' } : a,
      ),
    },
  };
  const id2 = JSON.stringify(['programa-sintetico-2', 'entrada']);
  const revision = { ...condicion(id), ...informativa(id2), ...informativa(otra) };
  assert.deepEqual(medirRequisitos([ficha, segunda], revision), {
    condicion: 1,
    informativa: 1,
    sin_revisar: 0,
    decisiones_literal_distinto: 0,
    decisiones_sin_afirmacion: 1,
    aplicadas_sobre_otra_captura: 0,
  });
  assert.deepEqual(medirRequisitos([ficha], {}), {
    condicion: 0,
    informativa: 0,
    sin_revisar: 1,
    decisiones_literal_distinto: 0,
    decisiones_sin_afirmacion: 0,
    aplicadas_sobre_otra_captura: 0,
  });
});
test('Cada decisión publicada con el motor es coherente: literal, razón y captura; resumen solo en las condiciones', () => {
  for (const [id, decision] of Object.entries(REVISION_REQUISITOS)) {
    assert.ok(decision.literal.trim().length > 0, id);
    assert.ok(decision.razon.es.trim() && decision.razon.ca.trim(), id);
    assert.match(decision.revisadaSobre, /^[0-9a-f]{64}$/u, id);
    if (decision.tipo === 'condicion') {
      assert.ok(decision.resumen.es.trim() && decision.resumen.ca.trim(), id);
    } else {
      assert.equal('resumen' in decision, false, id);
    }
  }
});
test('Ninguna clave de la revisión se repite en su fuente', () => {
  // Un objeto literal con una clave repetida se queda con la última sin avisar: se cuenta en el texto del archivo.
  const fuente = readFileSync(
    new URL('../../src/seleccion-formacion/requisitos-revisados.ts', import.meta.url),
    'utf8',
  );
  const claves = [...fuente.matchAll(/^ {2}'(\[[^']*\])': \{$/gmu)].map((m) => m[1]);
  assert.equal(claves.length, Object.keys(REVISION_REQUISITOS).length);
  assert.equal(new Set(claves).size, claves.length);
});
test('La medida del catálogo de aprendizaje publicado en el árbol', (t) => {
  const carpeta = new URL('../../web/datos/catalogo-aprendizaje/', import.meta.url);
  const archivos = readdirSync(carpeta).filter((n) => n.endsWith('.json'));
  assert.equal(archivos.length, 1);
  const companero: CompaneroAprendizaje = JSON.parse(readFileSync(new URL(archivos[0] ?? '', carpeta), 'utf8'));
  const medida = medirRequisitos(companero.fichas);
  const total = companero.fichas.flatMap((f) => requisitosDeFicha(f)).length;
  assert.equal(medida.condicion + medida.informativa + medida.sin_revisar, total);
  t.diagnostic(`Requisitos publicados: ${total} · ${JSON.stringify(medida)}`);
});
