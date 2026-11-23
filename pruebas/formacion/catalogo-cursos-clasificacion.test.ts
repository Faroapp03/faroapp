import assert from 'node:assert/strict';
import test from 'node:test';
import { CLASIFICACION_CATALOGO_SHA256, metadatosClasificados } from '../../src/catalogo-cursos/clasificacion.ts';
import revisada from '../../src/catalogo-cursos/clasificacion-revisada.json' with { type: 'json' };
import { consultarCatalogo } from '../../src/catalogo-cursos/consulta.ts';
import { TEMAS_CURSOS } from '../../src/catalogo-cursos/temas.ts';
import { TEXTOS_CATALOGO_CURSOS as ca } from '../../web/idiomas/ca/catalogo-cursos.js';
import { TEXTOS_CATALOGO_CURSOS as es } from '../../web/idiomas/es/catalogo-cursos.js';
import {
  CATALOGO_CLASIFICACION as catalogo,
  REFERENCIA_CLASIFICACION as REFERENCIA,
} from '../ayudas/catalogo-clasificacion.ts';

const programas = [...new Map(catalogo.ofertas.map((oferta) => [oferta.unidad.programa_id, oferta])).values()];
const ahora = Date.parse('2026-10-25T20:30:00Z');
const filtros = { texto: '', idioma: '', modalidad: '', nivel: '', tema: '', orden: 'nombre' };
const ESPERADOS = {
  programas: 504,
  ofertas: 709,
  fuente: 242,
  faro: 262,
  ambiguos: 0,
  historicos: 6,
};
const NIVELES = { inicial: 500, intermedio: 161, avanzado: 48, 'no-indicado': 0 };

function oferta(id: string) {
  const encontrada = catalogo.ofertas.find((o) => o.unidad.id === id);
  assert.ok(encontrada, id);
  return encontrada;
}

test('el sidecar cubre los 504 programas de la entrega exacta sin rutas privadas ni materias huérfanas', () => {
  assert.equal(CLASIFICACION_CATALOGO_SHA256, REFERENCIA.sha256);
  assert.equal(revisada.programas.length, ESPERADOS.programas);
  assert.equal(new Set(revisada.programas.map((p) => p.programaId)).size, ESPERADOS.programas);
  assert.doesNotMatch(JSON.stringify(revisada), /archivo_evidencia_local|snapshot_sqlite|\/Users\/|plataforma_datos/u);
  for (const original of programas) {
    const revision = revisada.programas.find((p) => p.programaId === original.unidad.programa_id);
    assert.equal(revision?.titulo, original.titulo_programa);
    assert.equal(revision?.proveedorId, original.proveedor_id);
    const metadata = metadatosClasificados(original);
    assert.ok(metadata.temas.length > 0 && !metadata.temas.includes('no-indicado'), original.titulo_programa);
    assert.ok(metadata.temas.every((tema) => TEMAS_CURSOS.includes(tema)));
    assert.ok(metadata.motivoTemas.es && metadata.motivoTemas.ca);
  }
});

test('declara procedencia y razones: 236 fuentes primarias, seis extractos históricos y orientación Faro separada', () => {
  const niveles = programas.map((o) => metadatosClasificados(o).nivel);
  for (const [origen, n] of Object.entries({
    fuente: ESPERADOS.fuente,
    faro: ESPERADOS.faro,
    'por-confirmar': ESPERADOS.ambiguos,
  })) {
    assert.equal(niveles.filter((nivel) => nivel.origen === origen).length, n);
  }
  const fuente = niveles.filter((n) => n.origen === 'fuente');
  assert.ok(fuente.every((n) => n.literal && n.alcance && n.escala && n.evidencia));
  const historicos = fuente.filter((n) => n.evidencia?.naturaleza === 'extracto_derivado_historico');
  assert.equal(historicos.length, ESPERADOS.historicos);
  assert.ok(historicos.every((n) => /extracto.*22 de octubre/u.test(n.motivo.es)));
  for (const nivel of niveles) {
    assert.ok(nivel.motivo.es && nivel.motivo.ca);
    assert.equal(nivel.valor === null, nivel.origen === 'por-confirmar');
    if (nivel.origen === 'faro') {
      assert.equal(nivel.literal, null);
      assert.ok(nivel.motivo.es.startsWith('Faro'));
    }
  }
});

test('el mismo ID con título o proveedor cambiado no hereda una clasificación revisada', () => {
  const original = oferta('cibervoluntarios:material:10059787763');
  assert.equal(metadatosClasificados(original).nivel.valor, 'intermedio');
  for (const cambio of [{ titulo_programa: 'Otro contenido' }, { proveedor_id: 'otro' }]) {
    const distinto = metadatosClasificados({ ...original, ...cambio });
    assert.deepEqual(distinto.temas, ['no-indicado']);
    assert.equal(distinto.nivel.valor, null);
  }
  assert.equal(
    metadatosClasificados({ ...original, unidad: { ...original.unidad, programa_id: 'otro' } }).nivel.valor,
    null,
  );
});

test('todos los niveles se pueden filtrar conservando las 709 ofertas y su procedencia', () => {
  const original = JSON.stringify(catalogo);
  const todos = consultarCatalogo(catalogo, filtros, ahora);
  assert.equal(todos.ofertas.length, ESPERADOS.ofertas);
  for (const [nivel, esperado] of Object.entries(NIVELES)) {
    const consulta = consultarCatalogo(catalogo, { ...filtros, nivel }, ahora);
    assert.equal(consulta.ofertas.length, esperado);
    assert.equal(consulta.total, ESPERADOS.ofertas);
    assert.equal(todos.cuentas.get('nivel')?.get(nivel) ?? 0, esperado);
  }
  assert.equal(JSON.stringify(catalogo), original);
});

test('un nivel sin evidencia no satisface un filtro de dificultad', () => {
  const original = oferta('cibervoluntarios:material:10059787763');
  const sinEvidencia = { ...original, referencias: [] };
  assert.equal(metadatosClasificados(sinEvidencia).nivel.valor, null);
  const copia = { ...catalogo, ofertas: [sinEvidencia] };
  assert.equal(consultarCatalogo(copia, { ...filtros, nivel: 'intermedio' }, ahora).ofertas.length, 0);
  assert.deepEqual(consultarCatalogo(copia, { ...filtros, nivel: 'no-indicado' }, ahora).ofertas, [sinEvidencia]);
  assert.deepEqual(consultarCatalogo(copia, filtros, ahora).ofertas, [sinEvidencia]);
});

test('cada tema y nivel de los controles dispone de rótulos ES/CA', () => {
  for (const idioma of [es, ca]) {
    const diccionario: Readonly<Record<string, string>> = idioma;
    for (const tema of TEMAS_CURSOS) {
      assert.ok(diccionario[`catalogo.tema.${tema}`]);
      assert.ok(diccionario[`catalogo.icono.${tema}`]);
    }
    for (const nivel of Object.keys(NIVELES)) {
      assert.ok(diccionario[`catalogo.nivel.${nivel}`]);
    }
    for (const origen of ['fuente', 'faro', 'por-confirmar']) {
      assert.ok(diccionario[`catalogo.nivel.origen.${origen}`]);
    }
  }
});

test('la búsqueda encuentra materias revisadas y sus nombres traducidos aunque el título no los contenga', () => {
  const artificial = catalogo.ofertas.find(
    (o) => metadatosClasificados(o).temas.includes('ia') && /inteligencia artificial/iu.test(o.titulo_programa),
  );
  assert.ok(artificial);
  assert.ok(consultarCatalogo(catalogo, { ...filtros, texto: 'ia' }, ahora).ofertas.includes(artificial));
  const oficina = catalogo.ofertas.find((o) => metadatosClasificados(o).temas.includes('ofimatica'));
  assert.ok(oficina);
  for (const idioma of ['es', 'ca'] as const) {
    const nombresTemas = new Map([['ofimatica', 'Ofimática']] as const);
    const resultado = consultarCatalogo(catalogo, { ...filtros, texto: 'OFIMATICA' }, ahora, { idioma, nombresTemas });
    assert.ok(resultado.ofertas.includes(oficina));
  }
});

test('los filtros conservan todas las materias revisadas y no prestan la revisión a otra identidad', () => {
  const mixta = catalogo.ofertas.find((o) => metadatosClasificados(o).temas.length > 1);
  assert.ok(mixta);
  for (const tema of metadatosClasificados(mixta).temas) {
    assert.ok(consultarCatalogo(catalogo, { ...filtros, tema }, ahora).ofertas.includes(mixta));
  }
  const ajena = { ...mixta, proveedor_id: 'proveedor-sintetico-sin-revision' };
  const copia = { ...catalogo, ofertas: [ajena] };
  for (const tema of metadatosClasificados(mixta).temas) {
    assert.equal(consultarCatalogo(copia, { ...filtros, tema }, ahora).ofertas.length, 0);
  }
  assert.deepEqual(consultarCatalogo(copia, { ...filtros, tema: 'no-indicado' }, ahora).ofertas, [ajena]);
});
