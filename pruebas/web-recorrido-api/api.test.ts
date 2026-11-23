import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CABECERA_CONTRATO, CONTRATO_API } from '../../web/scripts/protocolo-web.js';
import { ErrorFaro, esCancelacion } from '../../web/scripts/recorrido/api/errores.js';

const { cancelarPeticiones } = await import('../../web/scripts/recorrido/api/transporte.js');
const { completarTraducciones, fichaDeGrupo, gruposHijos, informeEnHtml } = await import(
  '../../web/scripts/recorrido/api.js'
);

import { datoEn, olvidarTraducciones } from '../../web/scripts/recorrido/datos-traducidos.js';
import { olvidarLlamadas } from '../../web/scripts/recorrido/memoria-llamadas.js';
import { fijarIdioma } from '../../web/scripts/textos.js';
import { fijarMotor } from '../web-recorrido-transporte/motor-local-doble.ts';
import { cuerpo, FECHA, HTML, OCUPACION, prepararApi, respuesta } from './ayudas.ts';

const CONFLICTO = 409;
const FICHA = { isco08: '4226', titulo: 'Recepcionistas', tareas: [], ocupaciones: [] };
const RESPUESTAS: Record<string, unknown> = {
  '/api/informe?formato=breve&reloj=dispositivo': { html: HTML, avisos: [] },
  '/api/grupos/4226': FICHA,
  '/api/grupos?padre=42': { hijos: [] },
};

function comprobarCabeceras(peticiones: { opciones: RequestInit }[]) {
  for (const p of peticiones) {
    assert.equal(new Headers(p.opciones.headers).get(CABECERA_CONTRATO), String(CONTRATO_API));
    assert.equal(p.opciones.mode, 'same-origin');
  }
}

test('fachada: tres rutas/métodos/cuerpos y cabecera del contrato vigente exactos, sin mutar entradas', async (t) => {
  const peticiones = await prepararApi(t, (p) => respuesta(RESPUESTAS[p.ruta]));
  const tareas = [{ id: 't1', texto: 'Dar citas', tiempo: 'algo' as const }];
  const entrada = { ocupacion: OCUPACION, fecha: FECHA, tareas };
  const antes = structuredClone(entrada);
  assert.deepEqual(await informeEnHtml(entrada, 'ca'), { html: HTML, avisos: [] });
  assert.equal((await fichaDeGrupo('4226')).titulo, FICHA.titulo);
  assert.deepEqual(await gruposHijos('42'), []);
  const ocupacion = { isco08: '4226', ocupacionEsco: '4226.1.1' };
  assert.deepEqual(
    peticiones.map((p) => [
      p.opciones.method ?? 'GET',
      p.ruta,
      p.opciones.body === undefined ? null : cuerpo(p.opciones),
    ]),
    [
      [
        'POST',
        '/api/informe?formato=breve&reloj=dispositivo',
        {
          ...ocupacion,
          isco08Secundario: '4229',
          ocupacionPersona: 'recepcionista',
          grupoPropuestoPorIa: true,
          fecha: FECHA,
          tareas,
          idioma: 'ca',
        },
      ],
      ['GET', '/api/grupos/4226', null],
      ['GET', '/api/grupos?padre=42', null],
    ],
  );
  comprobarCabeceras(peticiones);
  assert.deepEqual(entrada, antes);
});

test('HTML ilegible y versión incompatible se propagan como ErrorFaro, sin falsear éxito', async (t) => {
  await prepararApi(t, () => new Response('<h1>Interrumpida</h1>'));
  const entrada = { ocupacion: OCUPACION, fecha: FECHA, tareas: [] };
  await assert.rejects(informeEnHtml(entrada, 'es'), ErrorFaro);
  fijarMotor(async () => Response.json({ html: HTML }, { headers: { [CABECERA_CONTRATO]: String(CONTRATO_API + 1) } }));
  await assert.rejects(informeEnHtml(entrada, 'es'), (e) => e instanceof ErrorFaro && e.codigo === CONFLICTO);
});

test('fichas e hijos codifican parámetros; completar traducciones solo consulta lecturas pendientes', async (t) => {
  const peticiones = await prepararApi(t, (p) =>
    respuesta(
      p.ruta.includes('/grupos?')
        ? { hijos: [] }
        : { ...FICHA, ...(p.ruta.includes('idioma=ca') ? { titulo_ca: 'Recepcionistes' } : {}) },
    ),
  );
  await fichaDeGrupo('4226');
  await gruposHijos('4&padre=2');
  assert.equal(peticiones[1]?.ruta, '/api/grupos?padre=4%26padre%3D2');
  fijarIdioma('ca');
  assert.equal(await completarTraducciones(), true);
  assert.equal(datoEn('Recepcionistas', 'ca'), 'Recepcionistes');
  const antes = peticiones.length;
  assert.equal(await completarTraducciones(), false);
  assert.equal(peticiones.length, antes);
  assert.ok(peticiones.every((p) => p.opciones.method === undefined));
});

test('fallo de ficha se elimina de memoria y admite reintento con datos válidos', async (t) => {
  let falla = true;
  const peticiones = await prepararApi(t, () => (falla ? respuesta({}, { status: 503 }) : respuesta(FICHA)));
  await assert.rejects(fichaDeGrupo('4226'), ErrorFaro);
  falla = false;
  assert.equal((await fichaDeGrupo('4226')).titulo, FICHA.titulo);
  await fichaDeGrupo('4226');
  assert.equal(peticiones.length, 2);
});

test('respuesta vieja cancelada no registra traducción ni borra la ficha de la nueva conversación', async (t) => {
  const enviada = Promise.withResolvers<void>();
  let controlador: ReadableStreamDefaultController<Uint8Array> | undefined;
  let antigua = true;
  const peticiones = await prepararApi(t, () => {
    if (!antigua) {
      return respuesta({ ...FICHA, titulo_ca: 'Recepcionistes noves' });
    }
    return new Response(
      new ReadableStream<Uint8Array>({
        start(c) {
          controlador = c;
          enviada.resolve();
        },
      }),
      { headers: { [CABECERA_CONTRATO]: String(CONTRATO_API) } },
    );
  });
  fijarIdioma('ca');
  const anterior = fichaDeGrupo('4226');
  const error = assert.rejects(anterior, esCancelacion);
  await enviada.promise;
  cancelarPeticiones();
  olvidarLlamadas();
  olvidarTraducciones();
  antigua = false;
  const nueva = await fichaDeGrupo('4226');
  assert.ok(controlador);
  controlador.enqueue(new TextEncoder().encode(JSON.stringify({ ...FICHA, titulo_ca: 'Recepcionistes antigues' })));
  controlador.close();
  await error;
  assert.deepEqual(await fichaDeGrupo('4226'), nueva);
  assert.equal(peticiones.length, 2);
  assert.equal(datoEn(FICHA.titulo, 'ca'), 'Recepcionistes noves');
});
