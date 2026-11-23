/**
 * El panel carga contra los elementos del index.html real y engancha el apartado «Encuesta»: el interruptor
 * «Visible en la web» cambia la política de secciones tras confirmar y se puede deshacer como en «Secciones», y lo
 * que lee la vista de la encuesta llega al estado de la ronda.
 */
import './idiomas.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { politicaSeccionesInicial } from '../../src/administracion/secciones-web.js';
import type { EstadoClientePanel } from '../../web/administracion/cliente.js';
import { leerResultadosEncuesta } from '../../web/administracion/cliente-encuesta.js';
import { prepararPanel, respuestasEncuesta } from './panel-dom.ts';
import { enRonda } from './ronda-encuesta.ts';

type Activa = Extract<EstadoClientePanel, { estado: 'activa' }>;
const INICIO = 1_000_000;
const INACTIVIDAD = 900_000;
const ABSOLUTA = 28_800_000;

function activa(revision: number, encuesta = true): Activa {
  return {
    estado: 'activa',
    ocupado: false,
    conflicto: false,
    aviso: null,
    datos: null,
    trabajos: null,
    activacion: null,
    sesion: {
      estado: 'activa',
      iniciadaEn: INICIO,
      ultimaActividadEn: INICIO,
      caducaPorInactividadEn: INICIO + INACTIVIDAD,
      caducaAbsolutaEn: INICIO + ABSOLUTA,
    },
    controles: { version: 2, revision, api: 'habilitada', mcp: true, a2a: false },
    secciones: { version: 3, revision, secciones: { ...politicaSeccionesInicial(), encuesta } },
  };
}
type Campo = Awaited<ReturnType<typeof prepararPanel>>['campo'];
function interruptorVisible(campo: Campo) {
  const encontrado = campo('vista-encuesta-visibilidad').querySelector('#encuesta-visible');
  assert.ok(encontrado, 'el apartado «Encuesta» trae su interruptor');
  return encontrado as unknown as EventTarget & { checked: boolean; disabled: boolean };
}

test('el panel carga con los elementos del index.html real y monta la visibilidad de la encuesta', async (t) => {
  const p = await prepararPanel(t);
  p.publicar(activa(1));
  const campo = interruptorVisible(p.campo);
  assert.equal(campo.checked, true);
  assert.equal(campo.disabled, false);
  assert.equal(p.campo('vista-encuesta-visibilidad').hidden, false);
  p.publicar({ estado: 'cerrada', aviso: null });
  assert.equal(p.campo('vista-encuesta-visibilidad').hidden, true, 'sin sesión no se ofrece');
});

test('ocultar la encuesta envía la política de secciones confirmada y ofrece deshacerlo', async (t) => {
  const p = await prepararPanel(t);
  p.publicar(activa(1));
  const campo = interruptorVisible(p.campo);
  campo.checked = false;
  campo.dispatchEvent(new Event('change'));
  assert.equal(p.confirmaciones.length, 1, 'se confirma antes de enviar');
  assert.deepEqual(
    p.llamadas.filter((l) => l === 'guardar-secciones'),
    ['guardar-secciones'],
  );
  assert.deepEqual(p.registros.at(-1), { ...politicaSeccionesInicial(), encuesta: false });
  p.publicar(activa(2, false));
  assert.equal(p.campo('deshacer').hidden, false, '«Deshacer» se ofrece como en «Secciones»');
  p.campo('deshacer').dispatchEvent(new Event('click'));
  assert.deepEqual(p.registros.at(-1), { ...politicaSeccionesInicial(), encuesta: true });
});

test('rechazar la confirmación deja el interruptor como estaba y no envía nada', async (t) => {
  const p = await prepararPanel(t);
  p.publicar(activa(1));
  p.alConfirmar(() => false);
  const campo = interruptorVisible(p.campo);
  campo.checked = false;
  campo.dispatchEvent(new Event('change'));
  assert.equal(campo.checked, true);
  assert.equal(p.llamadas.includes('guardar-secciones'), false);
});

test('lo que lee la encuesta llega al estado de la ronda del apartado', async (t) => {
  const vacio = { emitidos: 0, consumidos: 0, sinUsar: 0 };
  respuestasEncuesta.consultar = {
    encuesta: leerResultadosEncuesta(
      enRonda({
        cuestionario: 'faro-piloto-2',
        abierta: true,
        lotes: [],
        totales: { participante: vacio, profesional: vacio },
        recuentos: null,
      }),
    ),
  };
  t.after(() => {
    respuestasEncuesta.consultar = null;
  });
  const p = await prepararPanel(t);
  p.publicar(activa(1));
  p.campo('consultar-encuesta').dispatchEvent(new Event('click'));
  await new Promise((resolver) => setImmediate(resolver));
  assert.ok(p.llamadas.includes('encuesta'));
  const ronda = p.campo('vista-encuesta-visibilidad').querySelector('.encuesta-ronda-estado');
  assert.match(ronda?.textContent ?? '', /Abierta/u);
});
