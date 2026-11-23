/**
 * La bienvenida del panel real ante quien no puede entrar (no figura en la lista o le falta el segundo factor) y al
 * recargar: la sesión abierta en esta misma pestaña se retoma sin preguntar; la de otra pestaña o la de otra entrada
 * de Access siguen pidiendo el botón «Cerrar aquella y abrirla aquí».
 */
import assert from 'node:assert/strict';
import { type TestContext, test } from 'node:test';
import { crearClientePanel, FalloPanel } from '../../web/administracion/cliente.js';
import { activarIdiomaPanel } from './idiomas.ts';
import { pestanaDePrueba, prepararPanel, respuestasSesion } from './panel-dom.ts';

const QUINCE_MINUTOS = 900_000;
const OCHO_HORAS = 28_800_000;
const MARCA = 'faro-panel-sesion-de-esta-pestana';
const DESDE = 1_000_000;
const entrada = { correo: 'ana@faro.invalid', idEntrada: 'E-7K2M9QXA', entradaEn: DESDE };
const propia = (idEntrada = 'E-7K2M9QXA') => ({
  correo: 'ana@faro.invalid',
  desde: DESDE,
  cierrePorInactividadEn: DESDE + QUINCE_MINUTOS,
  limiteEn: DESDE + OCHO_HORAS,
  idSesion: 'S-4H8RZT1C',
  idEntrada,
  propia: true,
});
const turno = () => new Promise((resolver) => setImmediate(resolver));
async function preparar(t: TestContext, bienvenida: unknown, marca: string | null = null) {
  respuestasSesion.bienvenida = bienvenida;
  pestanaDePrueba.clear();
  if (marca !== null) {
    pestanaDePrueba.set(MARCA, marca);
  }
  t.after(() => {
    respuestasSesion.bienvenida = { ...entrada, ocupacion: null };
    pestanaDePrueba.clear();
    activarIdiomaPanel();
  });
  const p = await prepararPanel(t);
  await turno();
  return p;
}

test('quien no figura como administrador ve por qué no puede entrar, sin botón de abrir', async (t) => {
  const p = await preparar(t, new FalloPanel('no_es_administrador', true));
  const bienvenida = p.campo('bienvenida-panel');
  assert.match(bienvenida.textContent, /No puedes entrar en el Panel de Control/u);
  assert.match(bienvenida.textContent, /Tu correo no figura como administrador/u);
  assert.equal(bienvenida.querySelector('button'), null);
  p.cambiarIdioma('ca');
  assert.match(p.campo('bienvenida-panel').textContent, /No pots entrar al Tauler de Control/u);
});

test('sin el segundo factor exigido, la bienvenida explica cómo registrarlo', async (t) => {
  const p = await preparar(t, new FalloPanel('segundo_factor_requerido', true));
  assert.match(p.campo('bienvenida-panel').textContent, /tienes que registrar un segundo factor/u);
});

test('el cliente real reconoce los dos rechazos de permiso de la bienvenida', async () => {
  for (const error of ['no_es_administrador', 'segundo_factor_requerido']) {
    const cliente = crearClientePanel({
      pedir: async () => Response.json({ error }, { status: 403 }),
      alCambiar: () => {},
    });
    await assert.rejects(cliente.leerSesionUnica('sesion/bienvenida'), (fallo) => {
      assert.ok(fallo instanceof FalloPanel);
      assert.equal(fallo.aviso, error);
      return true;
    });
    cliente.destruir();
  }
});

test('al recargar la pestaña que abrió la sesión, se retoma sin preguntar y una sola vez', async (t) => {
  const p = await preparar(t, { ...entrada, ocupacion: propia() }, 'S-4H8RZT1C');
  assert.deepEqual(
    p.llamadas.filter((l) => l === 'retomar' || l === 'abrir'),
    ['retomar'],
  );
  p.publicar({ estado: 'error', aviso: 'panel_ocupado' });
  await turno();
  assert.deepEqual(
    p.llamadas.filter((l) => l === 'retomar' || l === 'abrir'),
    ['retomar'],
    'si retomar falla, la decisión vuelve al botón',
  );
});

test('otra pestaña del mismo navegador, sin la marca, sigue pidiendo el botón', async (t) => {
  const p = await preparar(t, { ...entrada, ocupacion: propia() });
  assert.equal(p.llamadas.includes('retomar'), false);
  assert.match(
    p.campo('bienvenida-panel').querySelector('button')?.textContent ?? '',
    /Cerrar aquella y abrirla aquí/u,
  );
});

test('con la marca de otra sesión o desde otra entrada de Access, tampoco se retoma solo', async (t) => {
  const otraSesion = await preparar(t, { ...entrada, ocupacion: propia() }, 'S-0000AAAA');
  assert.equal(otraSesion.llamadas.includes('retomar'), false);
});

test('desde otra entrada de Access (otro dispositivo), la marca no basta', async (t) => {
  const otraEntrada = await preparar(t, { ...entrada, ocupacion: propia('E-0000BBBB') }, 'S-4H8RZT1C');
  assert.equal(otraEntrada.llamadas.includes('retomar'), false);
});

test('al abrirse la sesión en esta pestaña queda su marca, y al cerrarla se borra', async (t) => {
  const p = await preparar(t, { ...entrada, ocupacion: null });
  respuestasSesion.bienvenida = { ...entrada, ocupacion: propia() };
  p.publicar({
    estado: 'activa',
    ocupado: false,
    conflicto: false,
    aviso: null,
    datos: null,
    trabajos: null,
    activacion: null,
    sesion: {
      estado: 'activa',
      iniciadaEn: Date.now(),
      ultimaActividadEn: Date.now(),
      caducaPorInactividadEn: Date.now() + QUINCE_MINUTOS,
      caducaAbsolutaEn: Date.now() + OCHO_HORAS,
    },
    controles: { version: 2, revision: 1, api: 'deshabilitada', mcp: false, a2a: false },
  });
  await turno();
  assert.equal(pestanaDePrueba.get(MARCA), 'S-4H8RZT1C');
  p.publicar({ estado: 'cerrada', aviso: null });
  assert.equal(pestanaDePrueba.has(MARCA), false);
});
