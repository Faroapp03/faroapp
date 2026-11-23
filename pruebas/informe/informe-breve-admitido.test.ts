// Un informe válido debe admitirse completo; los fallos de estructura no pueden dejar un documento parcial.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { construirInformeBreve } from '../../src/dominio/informe-breve.ts';
import { cargarDatos } from '../../src/plataforma/node/datos.ts';
import { renderizarInformeBreve } from '../../src/presentacion/informe-breve.ts';
import { informeAdmitido } from '../../web/scripts/confianza/informe.js';
import { construirInformeConFormacion as construirInforme } from '../ayudas/informe-con-formacion.ts';

const DATOS = cargarDatos(fileURLToPath(new URL('../../datos/', import.meta.url)));
const FECHA = '2026-10-21';
/** Oficina, cocina, enfermería, conducción y panadería: grupos con y sin formación, y títulos con y sin traducir. */
const GRUPOS = ['4110', '5120', '2221', '8322', '7512'] as const;

function entrada(isco08: string) {
  return {
    isco08,
    fecha: FECHA,
    sinIa: true,
    tareas: [
      {
        id: 'uno',
        texto: `Tarea oficial ${isco08}-1`,
        tiempo: 'algo' as const,
        referencia: { tareaOit: `${isco08}-1`, relacion: 'propia' as const },
      },
    ],
  };
}

for (const isco08 of GRUPOS) {
  for (const idioma of ['es', 'ca'] as const) {
    test(`el informe breve de ${isco08} en ${idioma}, con sus dos hojas, pasa el filtro de la web`, () => {
      const informe = construirInforme(entrada(isco08), DATOS, { idioma });
      const html = renderizarInformeBreve(construirInformeBreve(informe, DATOS), informe, { incrustado: true });
      assert.doesNotThrow(() => informeAdmitido(html));
      assert.equal(html.split('<section class="hoja ').length - 1, 2);
      assert.ok(html.includes(idioma === 'ca' ? 'Full 2 de 2' : 'Hoja 2 de 2'));
    });
  }
}
