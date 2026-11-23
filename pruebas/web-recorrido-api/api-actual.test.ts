import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { IDENTIDAD_WEB } from '../../src/comun/identidad-web.ts';
import { CABECERA_CONTRATO, CONTRATO_API } from '../../src/comun/protocolo-web.ts';
import { construirInforme } from '../../src/dominio/informe.ts';
import { construirInformeBreve } from '../../src/dominio/informe-breve.ts';
import { motorDeCursos } from '../../src/plataforma/motor-de-cursos.ts';
import { crearApiLocal } from '../../src/plataforma/navegador/api-local.ts';
import { cargarDatos } from '../../src/plataforma/node/datos.ts';
import { renderizarInformeBreve } from '../../src/presentacion/informe-breve.ts';
import { informeAdmitido } from '../../web/scripts/confianza/informe.js';
import { FECHA_DEL_INFORME } from '../ayudas/fecha-del-informe.ts';

const { fichaDeGrupo, gruposHijos, informeEnHtml } = await import('../../web/scripts/recorrido/api.js');

import { olvidarLlamadas } from '../../web/scripts/recorrido/memoria-llamadas.js';
import { fijarIdioma } from '../../web/scripts/textos.js';
import { prepararApi } from './ayudas.ts';

const DATOS = cargarDatos(fileURLToPath(new URL('../../datos/', import.meta.url)));
const ENTRADA = {
  isco08: '7512',
  fecha: FECHA_DEL_INFORME,
  sinIa: true,
  tareas: [
    {
      id: 'uno',
      texto: 'Tarea oficial 7512-1',
      tiempo: 'algo' as const,
      referencia: { tareaOit: '7512-1', relacion: 'propia' as const },
    },
  ],
};
const OCUPACION = {
  isco08: ENTRADA.isco08,
  esco: null,
  isco08Secundario: null,
  palabra: '',
  titulo: '',
  origen: 'jerarquia' as const,
};

test('API6 actual factual: datos y HTML ES/CA exactos contra renderizador admitido', async (t) => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('No se permite ninguna red real'));
  const api = await crearApiLocal({ datos: DATOS, motorDeCursos });
  await prepararApi(t, async (p) => {
    const headers = new Headers(p.opciones.headers);
    headers.set('user-agent', IDENTIDAD_WEB['User-Agent']);
    const r = await api(new Request(new URL(p.ruta, 'https://contrato.invalid'), { ...p.opciones, headers }));
    assert.equal(r.headers.get(CABECERA_CONTRATO), String(CONTRATO_API));
    return r;
  });
  assert.equal((await fichaDeGrupo(ENTRADA.isco08)).isco08, ENTRADA.isco08);
  assert.ok((await gruposHijos('7')).length > 0);
  for (const idioma of ['es', 'ca'] as const) {
    fijarIdioma(idioma);
    olvidarLlamadas();
    const obtenido = await informeEnHtml(
      { ocupacion: OCUPACION, fecha: FECHA_DEL_INFORME, tareas: ENTRADA.tareas, sinIa: true },
      idioma,
    );
    // El breve no lleva formación: sus dos hojas salen del informe sin la formación del motor de cursos.
    const completo = construirInforme(ENTRADA, DATOS, { idioma, formacion: null });
    const esperado = renderizarInformeBreve(construirInformeBreve(completo, DATOS), completo, { incrustado: true });
    assert.equal(obtenido.html, esperado);
    assert.equal(obtenido.html.split('<section class="hoja ').length - 1, 2);
    // La web solo pinta el informe si pasa su filtro de confianza: el breve tiene que pasarlo.
    assert.doesNotThrow(() => informeAdmitido(obtenido.html));
    assert.deepEqual(obtenido.avisos, []);
  }
});
