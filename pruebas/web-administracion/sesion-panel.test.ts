/** La sesión única enganchada al panel real (panel.js) con su DOM de pruebas: de la bienvenida al panel y de vuelta. */
import assert from 'node:assert/strict';
import { type TestContext, test } from 'node:test';
import type { EstadoClientePanel } from '../../web/administracion/cliente.js';
import { activarIdiomaPanel } from './idiomas.ts';
import { prepararPanel, respuestasSesion } from './panel-dom.ts';

const QUINCE_MINUTOS = 900_000;
const OCHO_HORAS = 28_800_000;
const DOCE_MINUTOS = 720_000;
const MINUTO = 60_000;
const entrada = { correo: 'ana@faro.invalid', idEntrada: 'E-7K2M9QXA', entradaEn: 1_000_000 };
const ocupacion = (propia: boolean, desde: number) => ({
  correo: propia ? 'ana@faro.invalid' : 'berta@faro.invalid',
  desde,
  cierrePorInactividadEn: desde + QUINCE_MINUTOS,
  limiteEn: desde + OCHO_HORAS,
  idSesion: propia ? 'S-4H8RZT1C' : null,
  idEntrada: propia ? 'E-7K2M9QXA' : null,
  propia,
});
function activa(ultimaActividadEn = Date.now()): EstadoClientePanel {
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
      iniciadaEn: ultimaActividadEn,
      ultimaActividadEn,
      caducaPorInactividadEn: ultimaActividadEn + QUINCE_MINUTOS,
      caducaAbsolutaEn: ultimaActividadEn + OCHO_HORAS,
    },
    controles: { version: 2, revision: 1, api: 'deshabilitada', mcp: false, a2a: false },
  };
}
const turno = () => new Promise((resolver) => setImmediate(resolver));
async function preparar(t: TestContext, bienvenida: unknown = { ...entrada, ocupacion: null }) {
  respuestasSesion.bienvenida = bienvenida;
  respuestasSesion.registro = { registro: [] };
  t.after(() => {
    respuestasSesion.bienvenida = { ...entrada, ocupacion: null };
    activarIdiomaPanel();
  });
  const p = await prepararPanel(t);
  await turno();
  return p;
}
/** El botón principal de la bienvenida, si lo hay. */
const accion = (p: Awaited<ReturnType<typeof preparar>>) => p.campo('bienvenida-panel').querySelector('button');

test('al entrar, la bienvenida dice quién ha entrado y abre la sesión única sin retomar', async (t) => {
  const p = await preparar(t);
  assert.match(p.campo('bienvenida-panel').textContent, /Bienvenido al Panel de Control/);
  assert.match(p.campo('bienvenida-panel').textContent, /Usuarioana@faro\.invalidEntradaE-7K2M9QXA/);
  assert.equal(p.campo('armazon-panel').hidden, true);
  assert.equal(accion(p)?.textContent, 'Abrir sesión única');
  accion(p)?.dispatchEvent(new Event('click'));
  assert.ok(p.llamadas.includes('abrir'));
  assert.ok(!p.llamadas.includes('retomar'));
  p.cambiarIdioma('ca');
  assert.equal(accion(p)?.textContent, 'Obrir la sessió única');
});

test('ocupada por otro usuario: solo quién la tiene y desde qué hora, sin botón', async (t) => {
  const desde = Date.parse('2026-11-23T09:12:00Z');
  const p = await preparar(t, { ...entrada, ocupacion: ocupacion(false, desde) });
  assert.match(
    p.campo('bienvenida-panel').textContent,
    /El Panel de Control está abierto por berta@faro\.invalid desde las 10:12\./,
  );
  assert.equal(accion(p), null);
  p.cambiarIdioma('ca');
  assert.match(p.campo('bienvenida-panel').textContent, /està obert per berta@faro\.invalid des de les 10:12\./);
});

test('propia en otro dispositivo: «Cerrar aquella y abrirla aquí» es lo único que retoma', async (t) => {
  const p = await preparar(t, { ...entrada, ocupacion: ocupacion(true, Date.now()) });
  assert.match(p.campo('bienvenida-panel').textContent, /Tienes el Panel de Control abierto en otro dispositivo\./);
  assert.equal(accion(p)?.textContent, 'Cerrar aquella y abrirla aquí');
  accion(p)?.dispatchEvent(new Event('click'));
  assert.deepEqual(
    p.llamadas.filter((l) => l === 'abrir' || l === 'retomar'),
    ['retomar'],
  );
});

test('al abrir: marca de una vez, después el panel con la sesión en la barra y «Cerrar sesión»', async (t) => {
  const p = await preparar(t);
  respuestasSesion.bienvenida = { ...entrada, ocupacion: ocupacion(true, Date.now()) };
  p.publicar(activa());
  assert.match(p.campo('bienvenida-panel').textContent, /^Sesión única abierta/);
  assert.equal(p.campo('bienvenida-panel').querySelectorAll('.sesion-unica-transicion').length, 1);
  await turno();
  assert.match(p.campo('bienvenida-panel').textContent, /S-4H8RZT1C · solo tú puedes hacer cambios ahora/);
  p.vencerPlazos();
  await turno();
  assert.equal(p.campo('armazon-panel').hidden, false);
  assert.equal(p.campo('bienvenida-panel').hidden, true);
  p.publicar(activa());
  assert.match(p.campo('sesion-barra').textContent, /^Sesión única S-4H8RZT1C · desde \d\d:\d\d/);
  const cerrar = p.campo('sesion-barra').querySelector('.sesion-unica-cerrar');
  assert.equal(cerrar?.textContent, 'Cerrar sesión');
  cerrar?.dispatchEvent(new Event('click'));
  assert.ok(p.llamadas.includes('cerrar'));
  assert.match(p.campo('registro-panel-lista').textContent, /Todavía no hay accesos registrados\./);
});

test('a los 13 minutos sin actividad avisa una vez y «Seguir con la sesión» la mantiene', async (t) => {
  const p = await preparar(t);
  respuestasSesion.bienvenida = { ...entrada, ocupacion: ocupacion(true, Date.now()) };
  p.publicar(activa());
  await turno();
  p.vencerPlazos();
  p.publicar(activa(Date.now() - DOCE_MINUTOS));
  assert.doesNotMatch(p.campo('sesion-barra').textContent, /si no haces nada/);
  p.publicar(activa(Date.now() - QUINCE_MINUTOS + MINUTO));
  assert.match(p.campo('sesion-barra').textContent, /Tu sesión única se cerrará a las \d\d:\d\d si no haces nada\./);
  p.campo('sesion-barra').querySelector('.sesion-unica-seguir')?.dispatchEvent(new Event('click'));
  assert.ok(p.llamadas.includes('mantener'));
});

test('al cerrar, la bienvenida vuelve diciendo qué ha pasado; si otro la abrió antes, dice quién', async (t) => {
  const p = await preparar(t);
  respuestasSesion.bienvenida = { ...entrada, ocupacion: ocupacion(true, Date.now()) };
  p.publicar(activa());
  await turno();
  p.vencerPlazos();
  respuestasSesion.bienvenida = { ...entrada, ocupacion: null };
  p.publicar({ estado: 'cerrada', aviso: null });
  await turno();
  assert.equal(p.campo('armazon-panel').hidden, true);
  assert.equal(p.campo('sesion-barra').textContent, '');
  assert.match(p.campo('bienvenida-panel').textContent, /Has cerrado la sesión única\. Puedes abrirla de nuevo/);
  respuestasSesion.bienvenida = { ...entrada, ocupacion: ocupacion(false, Date.now()) };
  p.publicar({ estado: 'error', aviso: 'panel_ocupado' });
  await turno();
  assert.match(p.campo('bienvenida-panel').textContent, /abierto por berta@faro\.invalid/);
  assert.match(p.campo('estado').textContent, /Otro usuario ha abierto el Panel de Control antes que tú/);
});

test('sin correo verificado, la bienvenida dice qué ha pasado y qué hacer, sin botón', async (t) => {
  const p = await preparar(t, null);
  assert.match(p.campo('bienvenida-panel').textContent, /No se ha podido comprobar tu entrada en el Panel de Control/);
  assert.equal(accion(p), null);
});
