import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { CABECERA_CONTRATO, CONTRATO_API } from '../../src/api/metadatos-http.ts';
import { MAX_TAREA, MAX_TAREAS_INFORME } from '../../src/comun/protocolo-web.ts';
import type { Entrada } from '../../src/dominio/tipos-entrada.ts';
import { motorDeCursos } from '../../src/plataforma/motor-de-cursos.ts';
import { crearApiLocal } from '../../src/plataforma/navegador/api-local.ts';
import { cargarDatos } from '../../src/plataforma/node/datos.ts';
import { FECHA_DEL_INFORME } from '../ayudas/fecha-del-informe.ts';
import { construirInformeConFormacion } from '../ayudas/informe-con-formacion.ts';

const DATOS = cargarDatos(fileURLToPath(new URL('../../datos/', import.meta.url)));
const CORRECTO = 200;
const HOJAS = 2;
const REPETICIONES = 4;
const ORIGEN = 'https://api-html.test';

function entrada(extrema: boolean): Entrada {
  return {
    isco08: '7512',
    fecha: FECHA_DEL_INFORME,
    sinIa: true,
    tareas: extrema
      ? Array.from({ length: MAX_TAREAS_INFORME }, (_, i) => ({
          id: `t${i}`,
          texto:
            `Tarea ${i}: ${'Revisar documentos, comprobar los resultados y explicar personalmente las decisiones de cada expediente. '.repeat(REPETICIONES)}`.slice(
              0,
              MAX_TAREA,
            ),
          tiempo: 'mucho' as const,
        }))
      : [
          {
            id: 'uno',
            texto: 'Tarea oficial 7512-1',
            tiempo: 'algo',
            referencia: { tareaOit: '7512-1', relacion: 'propia' },
          },
        ],
  };
}

for (const idioma of ['es', 'ca'] as const) {
  for (const extrema of [false, true]) {
    test(`HTML laboral ${idioma}, ${extrema ? '30 tareas largas' : 'oficial'}: dos hojas y JSON completo intacto`, async (t) => {
      t.mock.method(globalThis, 'fetch', () => assert.fail('La prueba de ruta no admite red'));
      const api = await crearApiLocal({ datos: DATOS, motorDeCursos });
      const peticion = entrada(extrema);
      const respuesta = await api(
        new Request(`${ORIGEN}/api/informe?formato=html`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', [CABECERA_CONTRATO]: String(CONTRATO_API) },
          body: JSON.stringify({ ...peticion, idioma }),
        }),
      );
      assert.equal(respuesta.status, CORRECTO);
      const cuerpo = (await respuesta.json()) as { informe: unknown; html: string; breve?: unknown };
      assert.equal((cuerpo.html.match(/<section class="hoja ib"/gu) ?? []).length, HOJAS);
      assert.equal(cuerpo.html.includes('id="descargar"'), false);
      assert.equal(cuerpo.html.includes('id="imprimir"'), true);
      assert.equal(Object.hasOwn(cuerpo, 'breve'), false);
      const esperado = construirInformeConFormacion(peticion, DATOS, { idioma });
      assert.deepEqual(cuerpo.informe, JSON.parse(JSON.stringify(esperado)));
      assert.ok(cuerpo.html.includes('data-marca-ia="'));
      assert.equal(respuesta.headers.get(CABECERA_CONTRATO), String(CONTRATO_API));
    });
  }
}
