import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { EntregaCatalogo } from '../../src/catalogo-cursos/contrato.ts';
import { comprobarDatosDeFicha, comprobarTotalDePaginas, consultaDelCatalogo } from './formacion.ts';
import { comprobarCorrespondenciaAnual } from './recorrido.ts';

const catalogo = JSON.parse(
  readFileSync(new URL('../fixtures/catalogo-cursos-publico.utf8', import.meta.url), 'utf8'),
) as EntregaCatalogo;

test('el cotejo vincula ID, oferta y proveedor del catálogo', () => {
  const consulta = consultaDelCatalogo(catalogo);
  const oferta = catalogo.ofertas[0];
  assert.ok(oferta);
  const dato = consulta.buscar(oferta.unidad.id);
  assert.ok(dato);
  assert.equal(dato.oferta.url, oferta.url);
  assert.equal(dato.proveedor, catalogo.proveedores.find((p) => p.id === oferta.proveedor_id)?.nombre);
  assert.equal(consulta.buscar('unidad-inexistente'), null);
});

test('la ficha no puede omitir el límite, comprobación o modalidad publicados', () => {
  const original = catalogo.ofertas[0];
  assert.ok(original);
  const oferta = {
    ...original,
    comprobado_el: '2026-10-01T00:00:00Z',
    cierra_el: '2026-12-31T22:59:00Z',
    hechos: {
      ...original.hechos,
      modalidad: { ...original.hechos.modalidad, motivo: 'conocido' as const, valor: 'en-linea' },
    },
  };
  // Las fechas van en hora de Barcelona y escritas como en Cursos: el 23:59 solo cierra el día y no se escribe.
  const comprobada = 'Faro comprobó la oferta el 1 de octubre de 2026.';
  const limite = 'El proveedor indica que la oferta está publicada hasta el 31 de diciembre de 2026.';
  const modalidad = 'Modalidad: En línea';
  comprobarDatosDeFicha(`${modalidad} ${limite} ${comprobada}`, oferta, 'es');
  assert.throws(() => comprobarDatosDeFicha(`${modalidad} ${comprobada}`, oferta, 'es'));
  assert.throws(() => comprobarDatosDeFicha(`${modalidad} ${limite}`, oferta, 'es'));
  assert.throws(() => comprobarDatosDeFicha(`${limite} ${comprobada}`, oferta, 'es'));
  // Con el límite en UTC en lugar de en hora de Barcelona, la ficha no se da por buena.
  const enUtc = limite.replace('31 de diciembre de 2026', '31 de diciembre de 2026 a las 22:59');
  assert.throws(() => comprobarDatosDeFicha(`${modalidad} ${enUtc} ${comprobada}`, oferta, 'es'));
  // Sin límite publicado, una ficha que presenta uno tampoco se admite.
  const sinLimite = { ...oferta, cierra_el: null };
  comprobarDatosDeFicha(`${modalidad} ${comprobada}`, sinLimite, 'es');
  assert.throws(() => comprobarDatosDeFicha(`${modalidad} ${limite} ${comprobada}`, sinLimite, 'es'));
});

test('la ficha en catalán se coteja con un texto fijo, el mismo en cualquier navegador', () => {
  const original = catalogo.ofertas[0];
  assert.ok(original);
  const oferta = { ...original, comprobado_el: '2026-10-01T00:00:00Z', cierra_el: '2026-12-31T22:59:00Z' };
  // En catalán, el día 1 lleva el artículo apostrofado: «l’1», no «el 1».
  const comprobada = 'Faro va comprovar l’oferta l’1 d’octubre del 2026.';
  const limite = 'El proveïdor indica que l’oferta està publicada fins al 31 de desembre del 2026.';
  comprobarDatosDeFicha(`${limite} ${comprobada}`, oferta, 'ca');
  assert.throws(() => comprobarDatosDeFicha(`${limite} ${comprobada.replace('l’1', 'el 1')}`, oferta, 'ca'));
  const finsAlU = { ...oferta, cierra_el: '2026-11-30T23:30:00Z' };
  const limiteAlU = 'El proveïdor indica que l’oferta està publicada fins a l’1 de desembre del 2026, a les 0:30.';
  comprobarDatosDeFicha(`${limiteAlU} ${comprobada}`, finsAlU, 'ca');
  assert.throws(() =>
    comprobarDatosDeFicha(`${limiteAlU.replace('fins a l’1', 'fins al 1')} ${comprobada}`, finsAlU, 'ca'),
  );
  // La fecha abreviada («31 de des. del 2026») no es la forma de Faro y no se admite.
  assert.throws(() =>
    comprobarDatosDeFicha(`${limite.replace('31 de desembre del', '31 de des. del')} ${comprobada}`, oferta, 'ca'),
  );
  assert.throws(() =>
    comprobarDatosDeFicha(`${limite} ${comprobada.replace('1 d’octubre del', '1 d’oct. del')}`, oferta, 'ca'),
  );
});

test('la guardia del PDF laboral admite dos páginas y rechaza tres', async () => {
  const { comprobarPdfDelInforme } = await import('./recorrido.ts');
  assert.equal(comprobarPdfDelInforme(['1/2 primera', '2/2 segunda'], ['primera', 'segunda']), 2);
  assert.throws(() => comprobarPdfDelInforme(['1/3 primera', '2/3 segunda', '3/3 tercera'], ['primera', 'segunda']));
});

test('la guardia física exige dos páginas de formación y cuatro para ambos', () => {
  const DOS = 2;
  const TRES = 3;
  const CUATRO = 4;
  const CINCO = 5;
  comprobarTotalDePaginas(DOS, false);
  comprobarTotalDePaginas(CUATRO, true);
  assert.throws(() => comprobarTotalDePaginas(TRES, false));
  assert.throws(() => comprobarTotalDePaginas(CINCO, true));
});

test('cada año y cifra del gráfico coincide en orden con la tabla impresa', () => {
  comprobarCorrespondenciaAnual(['2024', '2025'], ['1.234*', '987'], ['1.234', '2024', '987', '2025']);
  assert.throws(() =>
    comprobarCorrespondenciaAnual(['2024', '2025'], ['1.234*', '987'], ['1.234', '2024', '988', '2025']),
  );
  assert.throws(() =>
    comprobarCorrespondenciaAnual(['2024', '2025'], ['1.234*', '987'], ['1.234', '2025', '987', '2024']),
  );
});
