// FUNDAE: ediciones con plazo abierto y destinatarios publicados, sin inferir admisión personal.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { cargarDatos } from '../../../src/plataforma/node/datos.ts';
import { type EdicionFundae, edicionesAbiertasDeFundae, paraQuienDeFundae } from '../src/formacion-fundae.ts';

const CARPETA = fileURLToPath(new URL('../../../datos/', import.meta.url));
const DATOS = cargarDatos(CARPETA);
const HOY = '2026-10-21';

/** Una edición de prueba, intersectorial y para asalariadas y autónomas, con lo que se cambie. */
function edicion(cambios: Partial<EdicionFundae> = {}): EdicionFundae {
  return {
    id: '1',
    especialidad: 'IFCT0049',
    nombre: 'CHATGPT E INTELIGENCIA ARTIFICAL',
    horas: 60,
    nivel_digital: 'Intermedio',
    entidad: 'ESCUELA DE PRUEBA, SL',
    preinscripcion: { inicio: '2026-09-01', fin: '2026-10-31' },
    colectivos: ['asalariados', 'autonomos', 'administracion-publica', 'desempleados'],
    sector: 'INTERSECTORIAL',
    programa: 'https://www.fundae.es/docs/IFCT0049.pdf',
    ...cambios,
  };
}

test('FUNDAE: el paquete trae sus ediciones, y solo las de plazo abierto cuentan', () => {
  const fundae = DATOS.fundae;
  assert.ok(fundae, 'el paquete trae fundae.json');
  // Cada edición del paquete sale de una ficha que la daba por abierta el día de su consulta.
  assert.ok(fundae.ediciones.length > 0);
  assert.equal(edicionesAbiertasDeFundae(fundae, fundae.consulta).length, fundae.ediciones.length);
  // Antes de abrir y después de cerrar, no.
  const una = { ...fundae, ediciones: [edicion()] };
  assert.equal(edicionesAbiertasDeFundae(una, '2026-08-31').length, 0);
  assert.equal(edicionesAbiertasDeFundae(una, '2026-10-31').length, 1);
  assert.equal(edicionesAbiertasDeFundae(una, '2026-11-01').length, 0);
  assert.deepEqual(edicionesAbiertasDeFundae(undefined, HOY), []);
});

test('FUNDAE: a quién admite cada edición, en una frase', () => {
  assert.equal(
    paraQuienDeFundae(edicion()),
    'Para personas asalariadas, autónomas, de la administración pública y en paro',
  );
  assert.equal(
    paraQuienDeFundae(edicion(), { breve: true }),
    'Para personas asalariadas, autónomas y de la administración pública',
  );
  const sectorial = edicion({ colectivos: ['asalariados', 'erte'], sector: 'FINANZAS Y SEGUROS' });
  assert.equal(
    paraQuienDeFundae(sectorial, { breve: true }),
    'Para personas asalariadas de empresas del sector de finanzas y seguros; no para personas autónomas',
  );
  const sinAsalariadas = edicion({ colectivos: ['autonomos', 'desempleados'] });
  assert.equal(paraQuienDeFundae(sinAsalariadas), 'Para personas autónomas y en paro; no para personas asalariadas');
  assert.equal(
    paraQuienDeFundae(sinAsalariadas, { breve: true }),
    'Para personas autónomas; no para personas asalariadas',
  );
  const deNadieQueTrabaje = edicion({ colectivos: ['administracion-publica', 'erte'] });
  assert.equal(
    paraQuienDeFundae(deNadieQueTrabaje, { breve: true }),
    'Para personas de la administración pública; no para personas asalariadas ni autónomas',
  );
});
