import './idiomas.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { politicaSeccionesInicial } from '../../src/administracion/secciones-web.js';
import type { EstadoClientePanel } from '../../web/administracion/cliente.js';
import { prepararPanel } from './panel-dom.ts';

type Activa = Extract<EstadoClientePanel, { estado: 'activa' }>;
const INICIO = 1_000_000;
const INACTIVIDAD = 900_000;
const ABSOLUTA = 28_800_000;
// Revisiones compartidas posteriores al propio cambio (que deja la 2).
const AJENA = 3;
const SIGUIENTE = 4;
function activa(revision: number, cambios: Partial<Activa> = {}): Activa {
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
    secciones: { version: 3, revision, secciones: politicaSeccionesInicial() },
    ...cambios,
  };
}
const cambios = (llamadas: string[]) => llamadas.filter((l) => l === 'cambiar').length;

test('deshacer un cambio de controles vuelve a guardar lo anterior con la revisión que dejó el propio cambio', async (t) => {
  const p = await prepararPanel(t);
  p.publicar(activa(1));
  p.campo('api').checked = false;
  p.campo('api').dispatchEvent(new Event('change'));
  p.campo('guardar').dispatchEvent(new Event('click'));
  assert.equal(cambios(p.llamadas), 1);
  assert.equal(p.campo('deshacer').hidden, true, 'hasta que se ve el cambio confirmado no se ofrece');
  const tras = activa(2);
  p.publicar({ ...tras, controles: { ...tras.controles, api: 'deshabilitada' } });
  assert.equal(p.campo('deshacer').hidden, false);
  p.alConfirmar(() => false);
  p.campo('deshacer').dispatchEvent(new Event('click'));
  assert.match(p.confirmaciones.at(-1) ?? '', /Encender la API para aplicaciones/u);
  assert.equal(cambios(p.llamadas), 1, 'rechazar el resumen no deshace');
  p.alConfirmar(() => true);
  p.campo('deshacer').dispatchEvent(new Event('click'));
  assert.equal(cambios(p.llamadas), 2);
  assert.deepEqual(p.registros.at(-1), { version: 2, api: 'habilitada', mcp: true, a2a: false });
  assert.equal(p.campo('deshacer').hidden, true, 'deshacer solo se ofrece una vez');
});

test('si otra sesión cambia algo después, o vence el plazo, no se deshace', async (t) => {
  const p = await prepararPanel(t);
  p.publicar(activa(1));
  p.campo('mcp').checked = false;
  p.campo('mcp').dispatchEvent(new Event('change'));
  p.campo('guardar').dispatchEvent(new Event('click'));
  const tras = activa(2);
  p.publicar({ ...tras, controles: { ...tras.controles, mcp: false } });
  assert.equal(p.campo('deshacer').hidden, false);
  const ajena = activa(AJENA);
  p.publicar({ ...ajena, controles: { ...ajena.controles, mcp: false, a2a: true } });
  assert.equal(p.campo('deshacer').hidden, true);
  assert.match(p.campo('estado-deshacer').textContent, /ya no se puede deshacer/u);
  p.campo('deshacer').dispatchEvent(new Event('click'));
  assert.equal(cambios(p.llamadas), 1);
  // Un cambio propio que no se ha deshecho a tiempo deja de ofrecerse al vencer su único plazo.
  p.campo('a2a').checked = false;
  p.campo('a2a').dispatchEvent(new Event('change'));
  p.campo('guardar').dispatchEvent(new Event('click'));
  p.publicar({ ...activa(SIGUIENTE), controles: { ...ajena.controles, revision: SIGUIENTE, mcp: false, a2a: false } });
  assert.equal(p.campo('deshacer').hidden, false);
  p.vencerPlazos();
  assert.equal(p.campo('deshacer').hidden, true);
});

test('un cambio de controles posterior retira la oferta de deshacer secciones, que comparten revisión', async (t) => {
  const p = await prepararPanel(t);
  p.publicar(activa(1));
  p.campo('seccion-biblioteca').checked = false;
  p.campo('seccion-biblioteca').dispatchEvent(new Event('change'));
  p.campo('guardar-secciones').dispatchEvent(new Event('click'));
  assert.ok(p.llamadas.includes('guardar-secciones'));
  const cerrada = { ...politicaSeccionesInicial(), biblioteca: false };
  // El servidor confirma las secciones con la revisión 2; los controles se ven aún con la 1.
  p.publicar(activa(1, { secciones: { version: 3, revision: 2, secciones: cerrada } }));
  assert.equal(p.campo('deshacer').hidden, false);
  // Leer los controles con la misma revisión compartida (2) no retira la oferta; una posterior (3), sí.
  p.publicar(activa(2, { secciones: { version: 3, revision: 2, secciones: cerrada } }));
  assert.equal(p.campo('deshacer').hidden, false);
  p.publicar(activa(AJENA, { secciones: { version: 3, revision: 2, secciones: cerrada } }));
  assert.equal(p.campo('deshacer').hidden, true);
});

test('al rechazar el resumen de controles, sus interruptores vuelven a lo confirmado', async (t) => {
  const p = await prepararPanel(t);
  p.publicar(activa(1));
  p.alConfirmar(() => false);
  p.campo('mcp').checked = false;
  p.campo('mcp').dispatchEvent(new Event('change'));
  p.campo('guardar').dispatchEvent(new Event('click'));
  assert.equal(cambios(p.llamadas), 0);
  assert.equal(p.campo('mcp').checked, true);
});

test('si el envío no sale, no se ofrece deshacer y un cambio ajeno idéntico no se toma por propio', async (t) => {
  const { enviosDePrueba } = await import('./panel-dom.ts');
  enviosDePrueba.salen = false;
  t.after(() => {
    enviosDePrueba.salen = true;
  });
  const p = await prepararPanel(t);
  p.publicar(activa(1));
  p.campo('api').checked = false;
  p.campo('api').dispatchEvent(new Event('change'));
  p.campo('guardar').dispatchEvent(new Event('click'));
  const ajena = activa(2);
  p.publicar({ ...ajena, controles: { ...ajena.controles, api: 'deshabilitada' } });
  assert.equal(p.campo('deshacer').hidden, true);
});

const LONGITUD_TOKEN = 43;
/** El cliente real sobre un transporte que confirma cada cambio con la revisión siguiente, y un deshacer conectado. */
async function clienteConDeshacer() {
  const { crearClientePanel } = await import('../../web/administracion/cliente.js');
  const { crearDeshacer } = await import('../../web/administracion/deshacer-cambio.js');
  const { Campo } = await import('./panel-dom-comun.ts');
  const sesion = activa(1).sesion;
  let revision = 1;
  const envios: { politica: unknown; revisionEsperada: unknown }[] = [];
  const pedir: typeof fetch = async (url, opciones) => {
    const ruta = String(url);
    if (ruta.endsWith('sesion/abrir')) {
      return Response.json({ token: 'A'.repeat(LONGITUD_TOKEN), sesion });
    }
    const controles = { version: 2, revision, api: 'habilitada', mcp: true, a2a: false };
    if (ruta.endsWith('controles/leer')) {
      return Response.json({ estado: 'activa', sesion, controles });
    }
    const cuerpo = JSON.parse(String(opciones?.body));
    envios.push(cuerpo);
    revision += 1;
    return Response.json({ estado: 'cambiado', sesion, controles: { ...cuerpo.politica, revision } });
  };
  const boton = new Campo('button');
  const estados: EstadoClientePanel[] = [];
  const deshacer = crearDeshacer({
    boton: boton as never,
    aviso: new Campo('p') as never,
    aplicar: (_tipo, politica) => void cliente.cambiar(politica as never),
  });
  const cliente = crearClientePanel({
    pedir,
    alCambiar: (estado) => {
      estados.push(estado);
      deshacer.observar(estado);
    },
  });
  return { cliente, deshacer, boton, envios, ultimo: () => estados.at(-1) as Activa };
}

test('con el cliente real, deshacer envía lo anterior con la revisión que dejó el propio cambio', async (t) => {
  const global = globalThis as unknown as Record<string, unknown>;
  const anterior = global.window;
  global.window = { setTimeout: () => 1, clearTimeout: () => {}, confirm: () => true };
  t.after(() => {
    global.window = anterior;
  });
  const { cliente, deshacer, boton, envios, ultimo } = await clienteConDeshacer();
  await cliente.abrir();
  const antes = ultimo();
  const politica = { version: 2, api: 'deshabilitada', mcp: true, a2a: false } as const;
  const envio = cliente.cambiar(politica);
  assert.equal(ultimo().ocupado, true, 'el envío sale en el mismo turno');
  deshacer.preparar('controles', { version: 2, api: 'habilitada', mcp: true, a2a: false }, { ...politica }, antes);
  await envio;
  assert.equal(boton.hidden, false);
  boton.dispatchEvent(new Event('click'));
  await new Promise((resolver) => setImmediate(resolver));
  assert.deepEqual(envios, [
    { politica, revisionEsperada: 1 },
    { politica: { version: 2, api: 'habilitada', mcp: true, a2a: false }, revisionEsperada: 2 },
  ]);
  cliente.destruir();
});

test('si el panel ya estaba ocupado al guardar, no se ofrece deshacer aunque luego quede ocupado', async (t) => {
  const p = await prepararPanel(t);
  p.publicar(activa(1, { ocupado: true }));
  // Simula un interruptor y un botón que siguen habilitados con el panel ocupado.
  p.campo('campos').disabled = false;
  p.campo('controles').hidden = false;
  p.campo('api').checked = false;
  p.campo('guardar').dispatchEvent(new Event('click'));
  const tras = activa(2);
  p.publicar({ ...tras, controles: { ...tras.controles, api: 'deshabilitada' } });
  assert.equal(p.campo('deshacer').hidden, true);
});

test('un estado que llega con conflicto no se toma por el propio cambio, aunque coincida con lo enviado', async (t) => {
  const p = await prepararPanel(t);
  p.publicar(activa(1));
  p.campo('api').checked = false;
  p.campo('api').dispatchEvent(new Event('change'));
  p.campo('guardar').dispatchEvent(new Event('click'));
  const tras = activa(2, { conflicto: true });
  p.publicar({ ...tras, controles: { ...tras.controles, api: 'deshabilitada' } });
  assert.equal(p.campo('deshacer').hidden, true);
});
