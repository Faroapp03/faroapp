import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { construirInforme } from '../../src/dominio/informe.ts';
import { construirInformeBreve } from '../../src/dominio/informe-breve.ts';
import { cargarDatos } from '../../src/plataforma/node/datos.ts';
import { tareasConsultables } from '../../src/presentacion/informe-breve/consulta-tareas.ts';
import { renderizarInformeBreve } from '../../src/presentacion/informe-breve.ts';

const datos = cargarDatos(fileURLToPath(new URL('../../datos/', import.meta.url)));
const MINIMO_ENTERO = 0.72,
  MAXIMO_ENTERO = 0.75,
  MINIMO_FRACCIONARIO = 0.7212,
  MAXIMO_FRACCIONARIO = 0.7567;
for (const idioma of ['es', 'ca'] as const) {
  test(`${idioma}: el margen evita ceros sobrantes y conserva las fracciones y los datos originales`, () => {
    const informe = construirInforme(
      {
        isco08: '4110',
        fecha: '2026-10-23',
        tareas: [
          {
            id: 't1',
            texto: 'Comprobar documentos',
            tiempo: 'mucho',
            referencia: { tareaOit: '4110-1', relacion: 'propia' },
          },
        ],
      },
      datos,
      { idioma, formacion: null },
    );
    const tarea = informe.tareas[0];
    assert.ok(tarea);
    tarea.margen = [MINIMO_ENTERO, MAXIMO_ENTERO];
    const breve = construirInformeBreve(informe, datos);
    const antes = JSON.stringify({ informe, breve });
    assert.equal(tareasConsultables(breve, informe)[0]?.margen, '72–75');
    const html = renderizarInformeBreve(breve, informe);
    // El margen se ve en «Detalle de todas las tareas», que se muestra en pantalla y se imprime entero.
    assert.match(html, /<td>72–75<\/td>/u);
    assert.doesNotMatch(html, /Margen entre modelos|Marge entre models|72,00–75,00/u);
    assert.match(html, idioma === 'es' ? /No son personas\./u : /No són persones\./u);
    assert.equal(JSON.stringify({ informe, breve }), antes);
    tarea.margen = [MINIMO_FRACCIONARIO, MAXIMO_FRACCIONARIO];
    assert.equal(tareasConsultables(breve, informe)[0]?.margen, '72,12–75,67');
  });
}
