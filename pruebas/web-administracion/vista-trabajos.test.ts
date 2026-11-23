import './idiomas.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ACCIONES_TRABAJO, accion } from '../../src/administracion/estado-trabajos.js';
import type { EstadoTrabajos, ResultadoTrabajo, TrabajoActualizacion } from '../../src/administracion/trabajos.ts';
import type { EstadoClientePanel } from '../../web/administracion/cliente.js';
import { CLAVE_TEXTO_DE_LA_ACCION, mostrarEstadoTrabajos } from '../../web/administracion/vista-trabajos.js';
import { TEXTOS_PANEL as TEXTOS_CA } from '../../web/idiomas/ca/panel.js';
import { TEXTOS_PANEL as TEXTOS_ES } from '../../web/idiomas/es/panel.js';
import { html, instalar, nodo } from '../web-informe-lectura/dom-doble.ts';
import { prepararPanel } from './panel-dom.ts';
import { fijarReloj } from './reloj-fijo.ts';

const INICIO = Date.parse('2026-10-17T12:00:00Z');
const INACTIVIDAD = 900_000;
const ABSOLUTA = 28_800_000;
const CONSULTAS_MAXIMAS = 12;
const TICKS_AMPLIOS = 40;
const LONGITUD_HUELLA = 16;
const PRIMEROS_TURNOS = 4;
function trabajo(cambios: Partial<TrabajoActualizacion> = {}): TrabajoActualizacion {
  return {
    solicitudId: '00000000-0000-4000-8000-000000000001',
    revisionReserva: 1,
    revisionBase: 0,
    accion: 'actualizar-datos',
    creadoEn: INICIO,
    actualizadoEn: INICIO,
    estado: 'despachado',
    runId: '123',
    runAttempt: '1',
    resultado: null,
    ...cambios,
  };
}
function estadoTrabajos(ultimoTrabajo: TrabajoActualizacion | null = null): EstadoTrabajos {
  return { version: 1, revision: ultimoTrabajo ? 1 : 0, ultimoTrabajo };
}
function activa(trabajos: EstadoTrabajos | null = null, cambios: Record<string, unknown> = {}): EstadoClientePanel {
  return {
    estado: 'activa',
    ocupado: false,
    conflicto: false,
    aviso: null,
    datos: null,
    activacion: null,
    trabajos,
    sesion: {
      estado: 'activa',
      iniciadaEn: INICIO,
      ultimaActividadEn: INICIO,
      caducaPorInactividadEn: INICIO + INACTIVIDAD,
      caducaAbsolutaEn: INICIO + ABSOLUTA,
    },
    controles: {
      version: 2,
      revision: 0,
      api: 'deshabilitada',
      mcp: false,
      a2a: false,
    },
    ...cambios,
  };
}
function terminado(resultado: ResultadoTrabajo['resultado']): TrabajoActualizacion {
  return trabajo({
    estado: 'terminado',
    resultado: {
      resultado,
      veredicto: resultado === 'validado' ? 'verde' : null,
      terminadoEn: '2026-10-17T12:01:00Z',
      huellaPaquete: resultado === 'validado' ? 'a'.repeat(LONGITUD_HUELLA) : null,
      error: resultado === 'rechazado' ? 'actualizacion_no_completada' : null,
    },
  });
}

test('la lectura inicial y los avisos inciertos bloquean acciones; consultar permite recuperar', async (t) => {
  const p = await prepararPanel(t);
  assert.equal(p.campo('trabajos').hidden, true);
  p.publicar(activa());
  assert.equal(p.campo('consultar-trabajo').disabled, false);
  for (const id of ['actualizar-datos', 'reintentar-pendientes']) {
    assert.equal(p.campo(id).disabled, true);
    p.campo(id).dispatchEvent(new Event('click'));
  }
  assert.deepEqual(p.llamadas, []);
  p.campo('consultar-trabajo').dispatchEvent(new Event('click'));
  assert.deepEqual(p.llamadas, ['trabajo']);
  p.publicar(activa(estadoTrabajos()));
  assert.equal(p.campo('actualizar-datos').disabled, false);
  assert.equal(p.campo('reintentar-pendientes').disabled, false);
  p.campo('actualizar-datos').dispatchEvent(new Event('click'));
  p.campo('reintentar-pendientes').dispatchEvent(new Event('click'));
  assert.deepEqual(p.llamadas.slice(1), ['actualizar-datos', 'reintentar-pendientes']);
  p.publicar(activa(estadoTrabajos(), { aviso: 'revision_trabajos_conflictiva' }));
  assert.equal(p.campo('actualizar-datos').disabled, true);
  assert.equal(p.campo('consultar-trabajo').disabled, false);
  p.publicar(activa(null, { aviso: 'actualizacion_incierta' }));
  assert.equal(p.campo('actualizar-datos').disabled, true);
  assert.match(p.campo('estado').textContent, /No se ha podido confirmar que la actualización se haya pedido/);
});

test('ocupación y trabajo pendiente bloquean solicitudes sin presentar éxito ni sustituir datos', async (t) => {
  const p = await prepararPanel(t);
  p.publicar(activa(estadoTrabajos(), { ocupado: true }));
  assert.equal(p.campo('consultar-trabajo').disabled, true);
  assert.equal(p.campo('actualizar-datos').disabled, true);
  for (const estado of ['despacho-incierto', 'despachado'] as const) {
    p.publicar(activa(estadoTrabajos(trabajo({ estado }))));
    assert.equal(p.campo('actualizar-datos').disabled, true);
    assert.equal(p.campo('consultar-trabajo').disabled, false);
    assert.match(
      p.campo('estado-trabajos').textContent,
      estado === 'despachado' ? /Solicitud enviada al sistema de actualización/ : /Solicitada/,
    );
    assert.equal(p.campo('estado-datos').textContent, '');
    assert.doesNotMatch(p.campo('estado-trabajos').textContent, /Todo actualizado/);
  }
});

test('candidato y sin pendientes explican sus límites; resultados rechazados conservan fechas y error', async (t) => {
  fijarReloj(t);
  const p = await prepararPanel(t);
  for (const resultado of [
    'validado',
    'sin-pendientes',
    'rechazado',
    'despacho-rechazado',
    'ejecucion-sin-recibo',
    'retirado',
  ] as const) {
    p.publicar(activa(estadoTrabajos(terminado(resultado))));
    const texto = p.campo('estado-trabajos').textContent;
    const detalle = p.campo('estado-trabajos').querySelector('details');
    assert.ok(detalle);
    assert.match(detalle.textContent, new RegExp(`resultado${resultado}`));
    // En el detalle técnico, la hora de Cataluña (CEST en octubre) y la UTC con la que se coteja el registro.
    assert.match(
      texto,
      /Solicitada hace 28 días, el 17 oct. 2026 a las 14:00 \(registro en UTC: 2026-10-17T12:00:00.000Z\)/,
    );
    assert.match(
      texto,
      /Terminada hace 28 días, el 17 oct. 2026 a las 14:01 \(registro en UTC: 2026-10-17T12:01:00Z\)/,
    );
    assert.doesNotMatch(texto, /Todo actualizado/);
    assert.equal(p.campo('actualizar-datos').disabled, false);
    if (resultado === 'validado') {
      assert.match(texto, /Datos nuevos preparados, aún no publicados/);
      assert.doesNotMatch(texto, /candidato/iu);
    }
    if (resultado === 'sin-pendientes') {
      assert.match(texto, /sin nada pendiente.*no garantiza que todas las fuentes/);
    }
    if (resultado === 'rechazado') {
      assert.match(texto, /La actualización no se ha completado/);
    }
  }
});

test('sondeo limitado alterna sesión y trabajo, se pausa oculto y no renueva actividad', async (t) => {
  const p = await prepararPanel(t);
  p.publicar(activa(estadoTrabajos(trabajo())));
  for (let i = 0; i < TICKS_AMPLIOS; i++) {
    p.tick();
  }
  assert.equal(p.llamadas.filter((s) => s === 'trabajo').length, CONSULTAS_MAXIMAS);
  assert.equal(p.llamadas.includes('mantener'), false);
  assert.deepEqual(p.llamadas.slice(0, PRIMEROS_TURNOS), ['comprobar', 'trabajo', 'comprobar', 'trabajo']);
  assert.match(p.campo('seguimiento-trabajo').textContent, /seguimiento automático ha terminado/);
  const total = p.llamadas.length;
  p.documento.hidden = true;
  p.tick();
  assert.equal(p.llamadas.length, total);
  p.documento.hidden = false;
  p.campo('consultar-trabajo').dispatchEvent(new Event('click'));
  p.tick();
  p.tick();
  assert.equal(p.llamadas.filter((s) => s === 'trabajo').length, CONSULTAS_MAXIMAS + 2);
  assert.match(p.campo('seguimiento-trabajo').textContent, /limitado/);
});

test('sin red, sesión sustituida y retirada de pestaña retiran todos los trabajos y bloquean acciones', async (t) => {
  const p = await prepararPanel(t);
  p.publicar(activa(estadoTrabajos(trabajo())));
  p.ventana.dispatchEvent(new Event('offline'));
  assert.equal(p.campo('trabajos').hidden, true);
  assert.equal(p.campo('actualizar-datos').disabled, true);
  assert.equal(p.campo('estado-trabajos').textContent, '');
  p.ventana.dispatchEvent(new Event('online'));
  p.publicar({ estado: 'sustituida', aviso: 'sesion_sustituida' });
  assert.equal(p.campo('trabajos').hidden, true);
  assert.match(p.campo('estado').textContent, /el panel se ha abierto en otro lugar/);
  const total = p.llamadas.length;
  p.tick();
  assert.equal(p.llamadas.length, total);
  p.publicar(activa(estadoTrabajos(trabajo())));
  p.ventana.dispatchEvent(new Event('pagehide'));
  assert.equal(p.reloj.size, 0);
  assert.equal(p.campo('trabajos').hidden, true);
  assert.equal(p.llamadas.at(-1), 'destruir');
  p.ventana.dispatchEvent(new Event('focus'));
  assert.equal(p.llamadas.at(-1), 'destruir');
});

test('las fechas admitidas fuera del rango Date no rompen la vista y el texto nunca se interpreta como HTML', (t) => {
  instalar(t);
  const destino = nodo('div');
  const base = terminado('validado');
  assert.ok(base.resultado);
  mostrarEstadoTrabajos(
    html(destino),
    estadoTrabajos({
      ...base,
      creadoEn: Number.MAX_SAFE_INTEGER,
      resultado: { ...base.resultado, terminadoEn: '<img src=x onerror=alert(1)>' },
    }),
  );
  assert.match(destino.textContent, /Fecha no representable/);
  assert.match(destino.textContent, /<img src=x/);
  assert.equal(destino.querySelector('img'), null);
});

test('recuperar exige confirmación explícita del trabajo visto y explica los límites de cada operación', async (t) => {
  const p = await prepararPanel(t);
  const pendiente = estadoTrabajos(trabajo());
  p.publicar(activa(pendiente));
  assert.equal(p.campo('retirar-trabajo').disabled, false);
  assert.equal(p.campo('reconciliar-trabajo').disabled, false);
  assert.match(p.campo('estado-trabajos').textContent, /Solicitud: 00000000-0000-4000-8000-000000000001/);
  p.alConfirmar(() => false);
  p.campo('retirar-trabajo').dispatchEvent(new Event('click'));
  p.campo('reconciliar-trabajo').dispatchEvent(new Event('click'));
  assert.deepEqual(p.llamadas, []);
  // La confirmación nombra la solicitud por su fecha, en hora de Cataluña; el identificador queda en el detalle técnico.
  assert.match(p.confirmaciones[0] ?? '', /retirar esta solicitud\? La solicitud se creó .*2026.*no se detendrá/);
  assert.match(
    p.confirmaciones[1] ?? '',
    /comprobar cómo terminó.*La solicitud se creó .*2026.*No se publica ningún dato/,
  );
  assert.doesNotMatch(p.confirmaciones.join(' '), /00000000-0000-4000-8000-000000000001|GitHub|Reconciliar/u);
  p.alConfirmar(() => true);
  p.campo('retirar-trabajo').dispatchEvent(new Event('click'));
  p.campo('reconciliar-trabajo').dispatchEvent(new Event('click'));
  assert.deepEqual(p.llamadas, ['retirar', 'reconciliar']);
});

test('una confirmación nunca cambia de trabajo si llega una lectura nueva durante el diálogo', async (t) => {
  const p = await prepararPanel(t);
  const primero = trabajo();
  p.publicar(activa(estadoTrabajos(primero)));
  p.alConfirmar(() => {
    p.publicar(
      activa(estadoTrabajos(trabajo({ solicitudId: '00000000-0000-4000-8000-000000000002', revisionReserva: 2 }))),
    );
    return true;
  });
  p.campo('retirar-trabajo').dispatchEvent(new Event('click'));
  assert.deepEqual(p.llamadas, []);
  assert.match(p.campo('estado').textContent, /La actualización que veías ha cambiado/);
  p.publicar(activa(estadoTrabajos(primero)));
  p.alConfirmar(() => {
    p.publicar(activa(estadoTrabajos(trabajo({ revisionReserva: 2 }))));
    return true;
  });
  p.campo('reconciliar-trabajo').dispatchEvent(new Event('click'));
  assert.deepEqual(p.llamadas, []);
});

test('ocupación, conflicto, retirada final y sesión sustituida impiden recuperaciones y eliminan sus datos', async (t) => {
  const p = await prepararPanel(t);
  for (const estado of [
    activa(),
    activa(estadoTrabajos(trabajo()), { ocupado: true }),
    activa(estadoTrabajos(trabajo()), { aviso: 'revision_trabajos_conflictiva' }),
    activa(estadoTrabajos(terminado('retirado'))),
    { estado: 'sustituida', aviso: 'sesion_sustituida' } as const,
  ]) {
    p.publicar(estado);
    for (const id of ['retirar-trabajo', 'reconciliar-trabajo']) {
      assert.equal(p.campo(id).disabled, true);
      p.campo(id).dispatchEvent(new Event('click'));
    }
  }
  assert.deepEqual(p.llamadas, []);
  assert.deepEqual(p.confirmaciones, []);
  assert.equal(p.campo('estado-trabajos').textContent, '');
  p.publicar(activa(estadoTrabajos(trabajo({ runId: null }))));
  assert.equal(p.campo('reconciliar-trabajo').disabled, true);
  assert.equal(p.campo('retirar-trabajo').disabled, false);
});

test('avisos de recuperación conservan el resultado auténtico sin anunciar publicación ni cancelación', async (t) => {
  const p = await prepararPanel(t);
  p.publicar(activa(estadoTrabajos(trabajo()), { aviso: 'trabajo_en_curso' }));
  assert.match(p.campo('estado').textContent, /sigue en marcha.*no se ha publicado nada/);
  assert.match(p.campo('estado-trabajos').textContent, /Solicitud enviada al sistema de actualización/);
  p.publicar(activa(null, { aviso: 'recuperacion_incierta' }));
  assert.match(p.campo('estado').textContent, /No se ha podido confirmar la operación.*Consulta cómo va/);
  assert.equal(p.campo('retirar-trabajo').disabled, true);
  assert.equal(p.campo('consultar-trabajo').disabled, false);
  p.publicar(activa(estadoTrabajos(terminado('retirado')), { aviso: 'trabajo_retirado' }));
  assert.match(p.campo('estado').textContent, /Solicitud retirada.*no se ha detenido/);
  assert.match(p.campo('estado-trabajos').textContent, /retirada antes de que empezara/);
  p.publicar(activa(estadoTrabajos(trabajo()), { aviso: 'revision_trabajos_conflictiva' }));
  assert.match(p.campo('estado').textContent, /no admite esta operación.*Revisa/);
  p.tick();
  p.tick();
  assert.equal(p.llamadas.includes('retirar'), false);
  assert.equal(p.llamadas.includes('reconciliar'), false);
});

test('el entorno privado deshabilita controles y oculta operaciones de actualización', async (t) => {
  const p = await prepararPanel(t, { controles: false, actualizacion: false });
  p.publicar(activa(estadoTrabajos()));
  assert.equal(p.campo('campos').disabled, true);
  assert.equal(p.campo('guardar').disabled, true);
  assert.match(p.campo('estado-revision-controles').textContent, /no está disponible/);
  for (const id of ['actualizar-datos', 'reintentar-pendientes', 'retirar-trabajo', 'reconciliar-trabajo']) {
    assert.equal(p.campo(id).hidden, true);
    assert.equal(p.campo(id).disabled, true);
    p.campo(id).dispatchEvent(new Event('click'));
  }
  assert.deepEqual(p.llamadas, []);
});

test('un envío confirmado no afirma que haya comenzado, en los dos idiomas', async (t) => {
  instalar(t);
  const { fijarIdioma } = await import('../../web/scripts/textos.js');
  const destino = document.createElement('div');
  fijarIdioma('es');
  mostrarEstadoTrabajos(destino, estadoTrabajos(trabajo()));
  assert.match(destino.textContent ?? '', /Solicitud enviada al sistema de actualización; todavía no hay resultado/u);
  assert.doesNotMatch(destino.textContent ?? '', /En curso|en marcha/u);
  fijarIdioma('ca');
  mostrarEstadoTrabajos(destino, estadoTrabajos(trabajo()));
  assert.match(destino.textContent ?? '', /Sol·licitud enviada al sistema d’actualització; encara no hi ha resultat/u);
  assert.doesNotMatch(destino.textContent ?? '', /En curs|en marxa/u);
  fijarIdioma('es');
});

test('el panel sabe nombrar cada acción de la lista cerrada, en castellano y en catalán', () => {
  assert.equal(ACCIONES_TRABAJO.every(accion), true);
  assert.deepEqual(Object.keys(CLAVE_TEXTO_DE_LA_ACCION).sort(), [...ACCIONES_TRABAJO].sort());
  for (const clave of Object.values(CLAVE_TEXTO_DE_LA_ACCION)) {
    for (const textos of [TEXTOS_ES, TEXTOS_CA]) {
      assert.equal(typeof textos[clave], 'string', clave);
      assert.ok((textos[clave] ?? '').length > 0, clave);
    }
  }
});
