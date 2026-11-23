import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { construirInforme } from '../../src/dominio/informe.ts';
import { construirInformeBreve } from '../../src/dominio/informe-breve.ts';
import { cargarDatos } from '../../src/plataforma/node/datos.ts';
import { contextoDeDatos } from '../../src/presentacion/informe-breve/contexto-de-datos.ts';

const DATOS = cargarDatos(fileURLToPath(new URL('../../datos/', import.meta.url)));

/** El informe breve de una ocupación con datos de empresas, con sus capturas tomadas en el instante dado. */
function breveConCopia(instante: string) {
  const informe = construirInforme(
    {
      isco08: '4110',
      fecha: '2026-11-15',
      sinIa: true,
      tareas: [{ id: 'una', texto: 'Tarea', tiempo: 'mucho', referencia: { tareaOit: '4110-1', relacion: 'propia' } }],
    },
    DATOS,
    { idioma: 'es', formacion: null },
  );
  const breve = construirInformeBreve(informe, DATOS);
  const empresas = breve.empresas;
  const primera = empresas?.capturas[0];
  assert.ok(empresas && primera);
  return { ...breve, empresas: { ...empresas, capturas: [{ ...primera, descargado_utc: instante }] } };
}

test('la copia se fecha con el día de Barcelona, también pasada la medianoche y en verano', () => {
  const casos: [string, string][] = [
    ['2026-11-14T22:59:59+00:00', '14/11/2026'],
    ['2026-11-14T23:40:38+00:00', '15/11/2026'],
    ['2026-07-14T21:59:59+00:00', '14/07/2026'],
    ['2026-07-14T22:00:00+00:00', '15/07/2026'],
  ];
  for (const [instante, dia] of casos) {
    assert.match(contextoDeDatos(breveConCopia(instante), 'es'), new RegExp(`Copia: ${dia}<`, 'u'));
  }
});
