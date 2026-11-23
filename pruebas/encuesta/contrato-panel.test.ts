/** El cliente del panel entiende las respuestas reales del servidor de la encuesta, sin dobles entre los dos. */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { CUESTIONARIO, PREGUNTAS } from '../../src/encuesta/cuestionario.ts';
import {
  CUESTIONARIO_ENCUESTA,
  crearOperacionesEncuesta,
  PREGUNTAS_ENCUESTA,
} from '../../web/administracion/cliente-encuesta.js';
import { montarEncuesta } from './montaje.ts';

type Montaje = Awaited<ReturnType<typeof montarEncuesta>>;
interface Pedido {
  ruta: string;
  cuerpo: unknown;
  token: string;
}

const INVITACIONES = 3;
const DEMASIADO_POCAS = 2;

/** Las operaciones del panel sobre el servidor real: el transporte entrega cada respuesta tal como llega. */
function operacionesDelPanel(montaje: Montaje) {
  const privado = {
    estado: { estado: 'activa', controles: null, conflicto: null },
    token: montaje.token,
    trabajo: null,
  };
  const ayudas = {
    ejecutar: async (panel: typeof privado, _operacion: string, tarea: (trabajo: object) => Promise<void>) => {
      await tarea({ mutacion: false });
      return panel.estado;
    },
    enviar: async (_panel: unknown, _trabajo: unknown, pedido: Pedido) => {
      const respuesta = await montaje.panel(pedido.ruta, pedido.token, pedido.cuerpo);
      return { estado: respuesta.status, cuerpo: await respuesta.json() };
    },
    vigente: () => true,
    activar: (panel: Record<string, unknown>, datos: { sesion: unknown }) => {
      panel.sesion = datos.sesion;
    },
    rechazar: (respuesta: { estado: number }) => {
      throw new Error(`El panel no esperaba la respuesta ${respuesta.estado}`);
    },
  };
  return crearOperacionesEncuesta(privado as never, ayudas as never);
}

/** Lo que el panel ha leído de una respuesta correcta; falla si la dio por error o no llegó a pedirla. */
function leido<T>(resultado: T): Exclude<T, { error: unknown } | null> {
  assert.ok(resultado !== null && !(typeof resultado === 'object' && 'error' in resultado), 'el panel debía leerla');
  return resultado as Exclude<T, { error: unknown } | null>;
}

test('el panel lee sin dobles lo que el servidor responde al crear lotes, consultar y cerrar la encuesta', async () => {
  const panel = operacionesDelPanel(await montarEncuesta(new DatabaseSync(':memory:')));

  const participantes = leido(
    await panel.crearLoteEncuesta({ tipo: 'participante', cantidad: INVITACIONES, nombre: 'Cambra de Comerç' }),
  );
  assert.equal(participantes.lote.nombre, 'Cambra de Comerç');
  assert.deepEqual(
    [participantes.lote.tipo, participantes.lote.emitidos, participantes.lote.consumidos, participantes.lote.sinUsar],
    ['participante', INVITACIONES, 0, INVITACIONES],
  );
  assert.equal(participantes.codigos.length, INVITACIONES);
  for (const { codigo, enlaceRelativo } of participantes.codigos) {
    assert.equal(enlaceRelativo, `/inicio.html#invitacion=${codigo}`);
  }

  const profesionales = leido(
    await panel.crearLoteEncuesta({ tipo: 'profesional', cantidad: INVITACIONES, nombre: 'Observatori comarcal' }),
  );
  for (const { codigo, enlaceRelativo } of profesionales.codigos) {
    assert.equal(enlaceRelativo, `/encuesta.html#codigo=${codigo}`);
  }

  assert.deepEqual(
    await panel.crearLoteEncuesta({ tipo: 'participante', cantidad: DEMASIADO_POCAS, nombre: 'Lote corto' }),
    { error: 'lote_demasiado_pequeno' },
  );

  const abierta = leido(await panel.consultarEncuesta()).encuesta;
  assert.equal(abierta.abierta, true);
  assert.equal(abierta.recuentos, null);
  assert.deepEqual(
    abierta.lotes.map((lote) => lote.nombre),
    ['Cambra de Comerç', 'Observatori comarcal'],
  );

  const cerrada = leido(await panel.cerrarEncuesta()).encuesta;
  assert.equal(cerrada.abierta, false);
  assert.ok(cerrada.recuentos, 'con la encuesta cerrada llegan los recuentos');

  assert.deepEqual(
    await panel.crearLoteEncuesta({ tipo: 'participante', cantidad: INVITACIONES, nombre: 'Tras el cierre' }),
    { error: 'encuesta_cerrada' },
  );
});

test('el panel espera el mismo cuestionario que el servidor: su identificador, sus preguntas y sus valores', () => {
  assert.equal(CUESTIONARIO_ENCUESTA, CUESTIONARIO);
  assert.deepEqual(JSON.parse(JSON.stringify(PREGUNTAS_ENCUESTA)), JSON.parse(JSON.stringify(PREGUNTAS)));
});
