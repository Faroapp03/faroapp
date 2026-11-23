import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { diaDeCursado, esCalendario } from '../../src/catalogo-cursos/calendarios.ts';
import { consultarCatalogo } from '../../src/catalogo-cursos/consulta.ts';
import type { CalendarioCatalogo, OfertaCatalogo } from '../../src/catalogo-cursos/contrato.ts';
import { esEntregaCatalogo } from '../../src/catalogo-cursos/forma.ts';
import { leerCatalogo } from '../../src/catalogo-cursos/lectura.ts';

const BASE = leerCatalogo(
  readFileSync(new URL('../fixtures/catalogo-cursos-publico.utf8', import.meta.url)),
  JSON.parse(readFileSync(new URL('../fixtures/catalogo-cursos-publico.referencia.json', import.meta.url), 'utf8')),
);
const AHORA = Date.parse('2026-10-22T11:00:00Z');
function oferta(id: string, valor: CalendarioCatalogo | null): OfertaCatalogo {
  const original = BASE.ofertas[0];
  assert.ok(original);
  return {
    ...original,
    titulo_programa: id,
    unidad: { tipo: 'edicion', id, programa_id: 'programa' },
    hechos: {
      ...original.hechos,
      coste_formacion_tipo: { ...original.hechos.coste_formacion_tipo, valor: 'gratis_formacion', motivo: 'conocido' },
      calendario_formacion: valor
        ? {
            valor,
            motivo: 'conocido',
            alcance: 'edicion',
            unidad: null,
            moneda: null,
            vigencia: { comprobado_el: '2026-10-22T10:00:00Z' },
          }
        : original.hechos.calendario_formacion,
    },
  };
}
const periodo = (inicio: string, fin: string | null = null): CalendarioCatalogo => ({
  tipo: 'periodo-formativo',
  inicio,
  fin,
});

test('calendarios cerrados conservan precisión y rechazan días u horas imposibles y periodos invertidos', () => {
  for (const valor of [
    periodo('2026-10-25'),
    periodo('2026-10-25T10:00'),
    periodo('2026-10-25T10:00:00.123456+01:00'),
  ]) {
    assert.equal(esCalendario(valor), true);
  }
  for (const valor of [
    periodo('2026-02-30'),
    periodo('0000-01-01'),
    periodo('2026-10-25T24:00'),
    periodo('2026-10-25T10:60'),
    periodo('2026-10-25T10:00+24:00'),
    periodo('2026-10-26', '2026-10-25'),
    periodo('2026-10-25T12:00', '2026-10-25T10:00'),
    periodo('2026-10-25T12:00-00:00', '2026-10-25T10:00-00:00'),
    { ...periodo('2026-10-25'), url: 'https://example.org' },
    { tipo: 'sesiones', sesiones: [] },
    { tipo: 'sesiones', inicio: '2026-10-25', fin: '2026-10-26' },
  ]) {
    assert.equal(esCalendario(valor), false, JSON.stringify(valor));
  }
  assert.equal(esCalendario(periodo('2026-10-25T10:00+01:00', '2026-10-25T09:30Z')), true);
  assert.equal(esCalendario(periodo('2026-10-25T10:00+01:00', '2026-10-25T08:30Z')), false);
});

test('la forma pública exige calendario de su campo, edición y plazo propio', () => {
  const fila = oferta('edicion', periodo('2026-10-25'));
  const dto = { ...BASE, ofertas: [fila], cobertura: { recurso: 0, edicion: 1 } };
  assert.equal(esEntregaCatalogo(dto), true);
  for (const cambio of [
    { alcance: 'unidad' },
    { valor: { tipo: 'matricula', inicio: '2026-10-25', fin: null } },
    { vigencia: undefined },
    { valor: { tipo: 'sesiones', sesiones: [] } },
  ]) {
    const otra = {
      ...fila,
      hechos: { ...fila.hechos, calendario_formacion: { ...fila.hechos.calendario_formacion, ...cambio } },
    };
    assert.equal(esEntregaCatalogo({ ...dto, ofertas: [otra] }), false);
  }
});

test('el orden usa formación y sesiones futuras; matrícula, título y asincronía no inventan una fecha', () => {
  const sinFecha = oferta('A sin fechas', null);
  const pronto = oferta('Z primero', periodo('2026-10-23'));
  const tarde = oferta('B después', periodo('2026-10-25'));
  const matricula = {
    ...sinFecha,
    hechos: {
      ...sinFecha.hechos,
      calendario_matricula: {
        ...pronto.hechos.calendario_formacion,
        valor: { tipo: 'matricula' as const, inicio: '2026-10-22', fin: null },
      },
    },
  };
  assert.equal(diaDeCursado(matricula, AHORA), undefined);
  const dto = { ...BASE, ofertas: [matricula, tarde, pronto], cobertura: { recurso: 0, edicion: 3 } };
  const filtros = { texto: '', idioma: '', modalidad: '', orden: 'proximos' };
  assert.deepEqual(
    consultarCatalogo(dto, filtros, AHORA).ofertas.map((o) => o.unidad.id),
    ['Z primero', 'B después', 'A sin fechas'],
  );
  assert.deepEqual(
    consultarCatalogo(dto, { ...filtros, orden: 'nombre' }, AHORA).ofertas.map((o) => o.unidad.id),
    ['A sin fechas', 'B después', 'Z primero'],
  );
  const sesiones = oferta('sesiones', {
    tipo: 'sesiones',
    sesiones: [
      { inicio: '2026-10-22T08:00Z', fin: '2026-10-22T09:00Z' },
      { inicio: '2026-10-24T10:00', fin: '2026-10-24T12:00' },
    ],
  });
  assert.equal(diaDeCursado(sesiones, AHORA), '2026-10-24');
});

test('una comprobación antigua sigue ordenando; calendarios disjuntos no se usan y se conservan los hechos', () => {
  const fila = oferta('periodo', periodo('2026-10-20', '2026-10-25'));
  assert.equal(diaDeCursado(fila, AHORA), '2026-10-22');
  const dias = Date.parse('2026-10-24T10:00:00Z');
  const tarde = consultarCatalogo({ ...BASE, ofertas: [fila] }, { texto: '', idioma: '', modalidad: '' }, dias)
    .ofertas[0];
  assert.equal(tarde?.hechos.calendario_formacion.motivo, 'conocido');
  assert.ok(tarde);
  assert.equal(diaDeCursado(tarde, dias), '2026-10-24');
  assert.equal(fila.hechos.calendario_formacion.motivo, 'conocido');
  const disjunta = {
    ...fila,
    hechos: {
      ...fila.hechos,
      calendario_aula: {
        ...fila.hechos.calendario_formacion,
        valor: { tipo: 'ventana-acceso' as const, inicio: '2026-11-01', fin: '2026-11-30' },
      },
    },
  };
  assert.equal(diaDeCursado(disjunta, AHORA), undefined);
});

test('medianoche y zonas distintas conservan el orden real sin convertir fechas civiles en instantes', () => {
  const futura = oferta('futura', periodo('2026-10-22T23:30:00Z'));
  assert.equal(diaDeCursado(futura, Date.parse('2026-10-22T22:30:00Z')), '2026-10-23');
  const base = oferta('solape', periodo('2026-10-25T00:15+02:00', '2026-10-25T01:00+02:00'));
  const solape = {
    ...base,
    hechos: {
      ...base.hechos,
      calendario_aula: {
        ...base.hechos.calendario_formacion,
        valor: { tipo: 'ventana-acceso' as const, inicio: '2026-10-24T21:00Z', fin: '2026-10-24T23:30Z' },
      },
    },
  };
  assert.equal(diaDeCursado(solape, Date.parse('2026-10-24T20:00Z')), '2026-10-25');
  assert.equal(diaDeCursado(oferta('civil', periodo('2026-10-25')), AHORA), '2026-10-25');
  assert.equal(diaDeCursado(oferta('local', periodo('2026-10-25T00:15')), AHORA), '2026-10-25');
  assert.deepEqual(base.hechos.calendario_formacion.valor, periodo('2026-10-25T00:15+02:00', '2026-10-25T01:00+02:00'));
});
