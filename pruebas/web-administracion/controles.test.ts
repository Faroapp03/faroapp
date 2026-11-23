import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { PoliticaControles } from '../../src/administracion/controles.ts';
import { crearClientePanel, type EstadoClientePanel } from '../../web/administracion/cliente.js';
import { leerDocumentoControles, leerPoliticaControles } from '../../web/administracion/contratos.js';
import { panelInstitucional } from '../ayudas/conectividad.ts';
import { activarIdiomaPanel } from './idiomas.ts';
import { prepararPanel } from './panel-dom.ts';

const INICIO = 1_000_000,
  INACTIVIDAD = 900_000,
  ABSOLUTA = 28_800_000;
const apagada: PoliticaControles = { version: 2, api: 'deshabilitada', mcp: false, a2a: false };
function activa(): EstadoClientePanel {
  return {
    estado: 'activa',
    ocupado: false,
    conflicto: false,
    aviso: null,
    datos: null,
    trabajos: null,
    activacion: null,
    controles: { ...apagada, revision: 0 },
    sesion: {
      estado: 'activa',
      iniciadaEn: INICIO,
      ultimaActividadEn: INICIO,
      caducaPorInactividadEn: INICIO + INACTIVIDAD,
      caducaAbsolutaEn: INICIO + ABSOLUTA,
    },
  };
}
test('el contrato web solo admite V2 y rechaza modos de altas sin traducirlos', () => {
  assert.deepEqual(leerPoliticaControles(apagada), apagada);
  assert.deepEqual(leerDocumentoControles({ ...apagada, revision: 2 }), { ...apagada, revision: 2 });
  for (const obsoleta of [
    { ...apagada, version: 1 },
    { ...apagada, api: 'habilitada-altas-cerradas' },
    { ...apagada, api: 'habilitada-altas-abiertas' },
    { ...apagada, api: true },
  ]) {
    assert.throws(() => leerPoliticaControles(obsoleta));
  }
});
test('el HTML ofrece tres interruptores independientes y ninguna alta pública', () => {
  const html = readFileSync(new URL('../../web/administracion/index.html', import.meta.url), 'utf8');
  for (const id of ['api', 'mcp', 'a2a']) {
    assert.match(html, new RegExp(`<input id="${id}" type="checkbox"`));
  }
  assert.doesNotMatch(html, /<select id="api"|habilitada-altas-/u);
});
test('cada interruptor conserva su propio valor al guardar, traducir y perder la sesión', async (t) => {
  const p = await prepararPanel(t);
  t.after(() => activarIdiomaPanel());
  p.publicar(activa());
  let revision = 0;
  for (const elegida of [
    { ...apagada, api: 'habilitada' as const },
    { ...apagada, mcp: true },
    { ...apagada, a2a: true },
    { ...apagada, api: 'habilitada' as const, mcp: true, a2a: true },
  ]) {
    p.campo('api').checked = elegida.api === 'habilitada';
    p.campo('mcp').checked = elegida.mcp;
    p.campo('a2a').checked = elegida.a2a;
    p.campo('api').dispatchEvent(new Event('change'));
    p.cambiarIdioma('ca');
    p.campo('guardar').dispatchEvent(new Event('click'));
    assert.deepEqual(p.registros.at(-1), elegida);
    const confirmada = activa();
    assert.ok(confirmada.estado === 'activa');
    p.publicar({ ...confirmada, controles: { ...elegida, revision: ++revision } });
  }
  p.publicar({ estado: 'sustituida', aviso: 'sesion_sustituida' });
  for (const id of ['api', 'mcp', 'a2a']) {
    assert.equal(p.campo(id).checked, false);
  }
});
for (const modo of ['Node', 'binding'] as const) {
  test(`${modo}: la UI guarda las ocho combinaciones V2 en la autoridad real`, async () => {
    const p = await panelInstitucional(modo);
    try {
      const cliente = crearClientePanel({
        pedir: async (ruta, opciones) =>
          p.panel.responder(
            p.peticion(
              String(ruta).replace('/administracion/api/', ''),
              JSON.parse(String(opciones?.body)),
              new Headers(opciones?.headers).get('x-faro-sesion') ?? undefined,
            ),
          ),
        alCambiar: () => {},
      });
      assert.equal((await cliente.abrir()).estado, 'activa');
      for (const api of ['deshabilitada', 'habilitada'] as const) {
        for (const mcp of [false, true]) {
          for (const a2a of [false, true]) {
            const politica: PoliticaControles = { version: 2, api, mcp, a2a };
            const estado = await cliente.cambiar(politica);
            assert.ok(estado.estado === 'activa');
            const guardada = await p.controles.leerControles();
            assert.deepEqual(estado.controles, guardada);
            assert.deepEqual(guardada, { ...politica, revision: estado.controles.revision });
            assert.equal(estado.conflicto, false);
          }
        }
      }
    } finally {
      p.cerrar();
    }
  });
}

test('la capacidad vigilante ausente se trata como no disponible', async (t) => {
  const p = await prepararPanel(t);
  p.publicar(activa());
  assert.equal(p.campo('vigilante').hidden, false);
  assert.equal(p.campo('comprobar-vigilante').disabled, true);
  assert.match(p.campo('estado-vigilante').textContent, /no está configurado o no está disponible/u);
  p.campo('comprobar-vigilante').dispatchEvent(new Event('click'));
  assert.ok(!p.llamadas.includes('vigilante'));
});

test('con capacidad, comprobar es una acción distinta y al sustituir la sesión se borra la vista', async (t) => {
  const p = await prepararPanel(t, { controles: true, actualizacion: true, vigilante: true });
  p.publicar(activa());
  assert.equal(p.campo('vigilante').hidden, false);
  p.campo('comprobar-vigilante').dispatchEvent(new Event('click'));
  p.campo('comprobar-vigilante').dispatchEvent(new Event('click'));
  await new Promise((resolver) => setImmediate(resolver));
  assert.equal(p.llamadas.filter((x) => x === 'vigilante').length, 1);
  assert.ok(!p.llamadas.includes('actualizar-datos'));
  assert.match(p.campo('estado-vigilante').textContent, /No se ha podido confirmar/u);
  p.publicar({ estado: 'sustituida', aviso: 'sesion_sustituida' });
  assert.equal(p.campo('vigilante').hidden, true);
  assert.doesNotMatch(p.campo('estado-vigilante').textContent, /No se ha podido confirmar/u);
});

test('un rechazo de configuración se explica dentro del vigilante y se traduce', async (t) => {
  const p = await prepararPanel(t, { controles: true, actualizacion: true, vigilante: true });
  const estado = activa();
  assert.equal(estado.estado, 'activa');
  if (estado.estado !== 'activa') {
    return;
  }
  p.publicar(estado);
  p.campo('comprobar-vigilante').dispatchEvent(new Event('click'));
  p.publicar({ ...estado, aviso: 'vigilante_configuracion_invalida' });
  await new Promise((resolver) => setImmediate(resolver));
  assert.match(p.campo('estado-vigilante').textContent, /Corrígela en la configuración del servicio/u);
  p.cambiarIdioma('ca');
  assert.match(p.campo('estado-vigilante').textContent, /Corregeix-la a la configuració del servei/u);
});
