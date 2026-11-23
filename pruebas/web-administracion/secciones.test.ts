import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { setImmediate as turno } from 'node:timers/promises';
import type { PoliticaControles } from '../../src/administracion/controles.ts';
import { crearRouterAdministrativo } from '../../src/administracion/http.ts';
import { politicaSeccionesInicial, SECCIONES_WEB } from '../../src/administracion/secciones-web.js';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { AlmacenSesionPanelSqlite } from '../../src/plataforma/acceso-publico/sesion-sqlite.ts';
import { AlmacenPublicoSqlite, type SqlAccesoPublico } from '../../src/plataforma/acceso-publico/sqlite.ts';
import { crearClientePanel, type EstadoClientePanel } from '../../web/administracion/cliente.js';
import { SECCIONES_DEL_APARTADO } from '../../web/administracion/secciones-del-panel.js';
import { principalDePrueba } from '../ayudas/principal-panel.ts';
import { activa } from './estado-panel.ts';
import { prepararPanel } from './panel-dom.ts';

const ORIGEN = 'https://panel.prueba';
const INICIO = 1_000_000;
const INACTIVIDAD = 900_000;
const ABSOLUTA = 28_800_000;
const politica: PoliticaControles = {
  version: 2,
  api: 'deshabilitada',
  mcp: false,
  a2a: false,
};
async function fixture(t: test.TestContext) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const sql: SqlAccesoPublico = {
    filas: (sentencia, ...valores) => db.prepare(sentencia).all(...valores),
    ejecutar: (sentencia, ...valores) => {
      db.prepare(sentencia).run(...valores);
    },
    transaccion: <T>(accion: () => T): T => {
      db.exec('BEGIN IMMEDIATE');
      try {
        const resultado = accion();
        db.exec('COMMIT');
        return resultado;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
  const publico = new AlmacenPublicoSqlite(sql, { maxClientes: 2 });
  const almacen = new AlmacenSesionPanelSqlite(sql, { ahora: () => INICIO });
  await almacen.prepararPanel(politica);
  const router = crearRouterAdministrativo({
    origen: ORIGEN,
    almacen,
    secciones: almacen,
    guardiaAdministrativa: async () => principalDePrueba('https://access.prueba', 'persona'),
  });
  const pedidos: { ruta: string; cuerpo: unknown; opciones: RequestInit | undefined }[] = [];
  const estados: EstadoClientePanel[] = [];
  const ganchos: { despues?: (ruta: string, respuesta: Response) => Promise<Response> } = {};
  const pedir: typeof fetch = async (ruta, opciones) => {
    const camino = String(ruta);
    pedidos.push({ ruta: camino, cuerpo: JSON.parse(String(opciones?.body)), opciones });
    const headers = new Headers(opciones?.headers);
    headers.set('origin', ORIGEN);
    headers.set('sec-fetch-site', 'same-origin');
    const respuesta = await router(new Request(new URL(camino, ORIGEN), { ...opciones, headers }));
    return ganchos.despues ? ganchos.despues(camino, respuesta) : respuesta;
  };
  const panel = crearClientePanel({ pedir, alCambiar: (estado) => estados.push(estado) });
  t.after(() => panel.destruir());
  return { panel, pedir, almacen, publico, pedidos, estados, ganchos };
}

test('secciones cliente/router: lectura explícita y revisión compartida invalidan el otro formulario', async (t) => {
  const f = await fixture(t);
  assert.equal(activa(await f.panel.abrir()).secciones, null);
  assert.equal(f.pedidos.length, 2);
  await f.panel.consultarSecciones();
  const secciones = { ...politicaSeccionesInicial(), recorrido: false };
  const guardada = activa(await f.panel.cambiarSecciones(secciones));
  assert.equal(guardada.secciones?.revision, 1);
  assert.equal(guardada.controlesPendientes, true);
  assert.deepEqual(await f.publico.leerControles(), { ...politica, revision: 1 });
  assert.deepEqual(
    f.pedidos.slice(-2).map(({ ruta, cuerpo }) => ({ ruta, cuerpo })),
    [
      { ruta: '/administracion/api/secciones/leer', cuerpo: {} },
      { ruta: '/administracion/api/secciones/cambiar', cuerpo: { revisionEsperada: 0, secciones } },
    ],
  );
  await f.panel.comprobar();
  const total = f.pedidos.length;
  await f.panel.cambiar({ ...politica, mcp: true });
  assert.equal(f.pedidos.length, total);
  assert.equal(activa(await f.panel.consultarControles()).controlesPendientes, false);
  const cambiada = activa(await f.panel.cambiar({ ...politica, mcp: true }));
  assert.equal(cambiada.secciones, null);
  assert.equal(cambiada.seccionesPendientes, true);
  const despues = f.pedidos.length;
  await f.panel.cambiarSecciones(politicaSeccionesInicial());
  assert.equal(f.pedidos.length, despues);
  assert.deepEqual((await f.almacen.leerSecciones())?.secciones, secciones);
  for (const pedido of f.pedidos.slice(1)) {
    assert(new Headers(pedido.opciones?.headers).get('x-faro-sesion'));
    assert.equal(pedido.opciones?.cache, 'no-store');
  }
});

test('secciones: revisión cambiada antes de guardar no autoriza el borrador con la nueva revisión', async (t) => {
  const f = await fixture(t);
  await f.panel.abrir();
  await f.panel.consultarSecciones();
  await f.publico.cambiarControles(0, { ...politica, mcp: true });
  const estado = activa(await f.panel.cambiarSecciones({ ...politicaSeccionesInicial(), doctor: false }));
  assert.equal(estado.seccionesPendientes, true);
  assert.equal(estado.avisoSecciones, 'revision_secciones_conflictiva');
  assert.equal(f.pedidos.filter(({ ruta }) => ruta.endsWith('secciones/cambiar')).length, 0);
  await f.panel.consultarSecciones();
  assert.equal(
    activa(await f.panel.cambiarSecciones({ ...politicaSeccionesInicial(), doctor: false })).secciones?.revision,
    2,
  );
});

test('secciones: respuesta perdida y sondeo no reenvían ni levantan la lectura explícita pendiente', async (t) => {
  const f = await fixture(t);
  await f.panel.abrir();
  await f.panel.consultarSecciones();
  f.ganchos.despues = async (ruta, respuesta) => {
    if (ruta.endsWith('secciones/cambiar')) {
      throw new TypeError('respuesta perdida');
    }
    return respuesta;
  };
  const secciones = { ...politicaSeccionesInicial(), guias: false };
  const incierta = activa(await f.panel.cambiarSecciones(secciones));
  assert.equal(incierta.avisoSecciones, 'secciones_inciertas');
  assert.equal(incierta.controlesPendientes, true);
  assert.equal(incierta.secciones, null);
  await f.panel.comprobar();
  const total = f.pedidos.length;
  await f.panel.cambiarSecciones(politicaSeccionesInicial());
  await f.panel.cambiar(politica);
  assert.equal(f.pedidos.length, total);
  delete f.ganchos.despues;
  assert.deepEqual(activa(await f.panel.consultarSecciones()).secciones?.secciones, secciones);
  assert.equal(f.pedidos.filter(({ ruta }) => ruta.endsWith('secciones/cambiar')).length, 1);
});

test('secciones: 409 posterior a lectura conserva borrador pendiente y exige revisar', async (t) => {
  const f = await fixture(t);
  await f.panel.abrir();
  await f.panel.consultarSecciones();
  f.ganchos.despues = async (ruta, respuesta) =>
    ruta.endsWith('secciones/cambiar')
      ? Response.json(
          {
            estado: 'conflicto',
            sesion: activa(f.estados.at(-1) as EstadoClientePanel).sesion,
            secciones: { version: 3, revision: 2, secciones: politicaSeccionesInicial() },
          },
          { status: ESTADO_HTTP.conflicto },
        )
      : respuesta;
  const estado = activa(await f.panel.cambiarSecciones({ ...politicaSeccionesInicial(), doctor: false }));
  assert.equal(estado.seccionesPendientes, true);
  assert.equal(estado.secciones?.revision, 2);
  const total = f.pedidos.length;
  await f.panel.cambiarSecciones(politicaSeccionesInicial());
  assert.equal(f.pedidos.length, total);
});

test('secciones: una confirmación de otra política queda incierta y no permite otro envío', async (t) => {
  const f = await fixture(t);
  await f.panel.abrir();
  await f.panel.consultarSecciones();
  f.ganchos.despues = async (ruta, respuesta) =>
    ruta.endsWith('secciones/cambiar')
      ? Response.json({
          estado: 'cambiado',
          sesion: activa(f.estados.at(-1) as EstadoClientePanel).sesion,
          secciones: { version: 3, revision: 1, secciones: politicaSeccionesInicial() },
        })
      : respuesta;
  const estado = activa(await f.panel.cambiarSecciones({ ...politicaSeccionesInicial(), biblioteca: false }));
  assert.equal(estado.avisoSecciones, 'secciones_inciertas');
  assert.equal(estado.secciones, null);
  const total = f.pedidos.length;
  await f.panel.cambiarSecciones(politicaSeccionesInicial());
  assert.equal(f.pedidos.length, total);
});

test('secciones: expulsión elimina datos y cierre ignora una lectura tardía', async (t) => {
  const f = await fixture(t);
  await f.panel.abrir();
  await f.panel.consultarSecciones();
  const otro = crearClientePanel({ pedir: f.pedir, alCambiar: () => {} });
  t.after(() => otro.destruir());
  // Sin decidir retomar, el otro dispositivo no puede abrir: la sesión propia abierta lo bloquea.
  assert.equal((await otro.abrir()).aviso, 'panel_ocupado');
  await otro.abrir(true);
  assert.equal((await f.panel.cambiarSecciones(politicaSeccionesInicial())).estado, 'sustituida');
  assert(!Object.hasOwn(f.estados.at(-1) as object, 'secciones'));
  const pendiente = Promise.withResolvers<Response>();
  f.ganchos.despues = async (ruta, respuesta) => (ruta.endsWith('secciones/leer') ? pendiente.promise : respuesta);
  const lectura = otro.consultarSecciones();
  await turno();
  const cierre = otro.cerrar();
  pendiente.resolve(Response.json({ secreto: 'tardío' }));
  await Promise.all([lectura, cierre]);
  assert.equal((await otro.comprobar()).estado, 'cerrada');
});

function estadoVista(): Extract<EstadoClientePanel, { estado: 'activa' }> {
  return {
    estado: 'activa',
    ocupado: false,
    conflicto: false,
    aviso: null,
    datos: null,
    trabajos: null,
    activacion: null,
    controles: { ...politica, revision: 0 },
    sesion: {
      estado: 'activa',
      iniciadaEn: INICIO,
      ultimaActividadEn: INICIO,
      caducaPorInactividadEn: INICIO + INACTIVIDAD,
      caducaAbsolutaEn: INICIO + ABSOLUTA,
    },
    secciones: { version: 3, revision: 0, secciones: politicaSeccionesInicial() },
  };
}
test('vista: invalidación cruzada conserva borradores y requiere consulta confirmada', async (t) => {
  const p = await prepararPanel(t);
  const inicial = estadoVista();
  p.publicar(inicial);
  p.campo('mcp').checked = true;
  p.campo('mcp').dispatchEvent(new Event('change'));
  p.campo('seccion-doctor').checked = false;
  p.campo('seccion-doctor').dispatchEvent(new Event('change'));
  p.publicar({ ...inicial, controlesPendientes: true, seccionesPendientes: true, secciones: null });
  assert.equal(p.campo('mcp').checked, true);
  assert.equal(p.campo('seccion-doctor').checked, false);
  assert.equal(p.campo('guardar').disabled, true);
  assert.equal(p.campo('guardar-secciones').disabled, true);
  p.alConfirmar(() => false);
  p.campo('consultar-controles').dispatchEvent(new Event('click'));
  p.campo('consultar-secciones').dispatchEvent(new Event('click'));
  assert.equal(p.llamadas.length, 0);
  p.alConfirmar(() => true);
  p.campo('consultar-controles').dispatchEvent(new Event('click'));
  p.campo('consultar-secciones').dispatchEvent(new Event('click'));
  assert.deepEqual(p.llamadas, ['consultar-controles', 'secciones']);
  p.publicar({
    ...inicial,
    controles: { ...inicial.controles, revision: 1 },
    secciones: { version: 3, revision: 1, secciones: politicaSeccionesInicial() },
  });
  assert.equal(p.campo('mcp').checked, false);
  assert.equal(p.campo('seccion-doctor').checked, true);
});
test('vista: guarda los nueve permisos actuales, no consulta por sondeo y borra al ser expulsada', async (t) => {
  const p = await prepararPanel(t);
  p.publicar(estadoVista());
  p.tick();
  assert(!p.llamadas.includes('secciones'));
  p.campo('seccion-recorrido').checked = false;
  p.campo('guardar-secciones').dispatchEvent(new Event('click'));
  assert.deepEqual(p.registros, [{ ...politicaSeccionesInicial(), recorrido: false }]);
  p.publicar({ estado: 'sustituida', aviso: 'sesion_sustituida' });
  assert.equal(p.campo('secciones').hidden, true);
  assert.equal(p.campo('campos-secciones').disabled, true);
  assert.equal(p.campo('seccion-doctor').checked, false);
  const total = p.llamadas.length;
  p.campo('guardar-secciones').dispatchEvent(new Event('click'));
  p.campo('consultar-secciones').dispatchEvent(new Event('click'));
  assert.equal(p.llamadas.length, total);
});
test('vista: «Cómo funciona», unida a Faro, no tiene interruptor y guarda el valor consultado sin cambiarlo', async (t) => {
  const p = await prepararPanel(t);
  const consultada = { ...politicaSeccionesInicial(), 'como-funciona': false };
  p.publicar({ ...estadoVista(), secciones: { version: 3, revision: 4, secciones: consultada } });
  assert.throws(() => p.campo('seccion-como-funciona'), /Falta campo/);
  p.campo('seccion-que-es-faro').checked = false;
  p.campo('guardar-secciones').dispatchEvent(new Event('click'));
  assert.deepEqual(p.registros, [{ ...consultada, 'que-es-faro': false }]);
});
test('vista: «Guías», unida a la Biblioteca, no tiene interruptor y guarda el valor consultado sin cambiarlo', async (t) => {
  const p = await prepararPanel(t);
  const consultada = { ...politicaSeccionesInicial(), guias: false };
  p.publicar({ ...estadoVista(), secciones: { version: 3, revision: 5, secciones: consultada } });
  assert.throws(() => p.campo('seccion-guias'), /Falta campo/);
  p.campo('seccion-biblioteca').checked = false;
  p.campo('guardar-secciones').dispatchEvent(new Event('click'));
  assert.deepEqual(p.registros, [{ ...consultada, biblioteca: false }]);
});
test('panel: un interruptor por sección con páginas, en el orden del catálogo, y ninguno para «Cómo funciona» ni «Guías»', () => {
  const html = readFileSync(new URL('../../web/administracion/index.html', import.meta.url), 'utf8');
  const interruptores = [...html.matchAll(/<input id="seccion-([a-z-]+)" type="checkbox"/g)].map(([, id]) => id);
  assert.deepEqual(
    interruptores,
    SECCIONES_DEL_APARTADO.map(({ id }) => id),
  );
  // La Encuesta también tiene páginas, pero su interruptor está en su propio apartado.
  assert.deepEqual(
    SECCIONES_WEB.filter(({ rutas }) => rutas.length > 0)
      .map(({ id }) => id)
      .filter((id) => !interruptores.includes(id)),
    ['encuesta'],
  );
  assert.ok(!interruptores.includes('como-funciona'));
  assert.ok(!interruptores.includes('guias'));
  assert.match(html, /<span data-texto="panel.seccion.biblioteca">Biblioteca<\/span>\s*<input id="seccion-biblioteca"/);
});

/** El DOM de prueba no genera gestos nativos: la prueba de navegador sí los ejecuta en Firefox. */
function gesto(
  p: Awaited<ReturnType<typeof prepararPanel>>,
  tipo: string,
  destino = 'guardar-secciones',
  opciones: { tecla?: string; objetivo?: EventTarget } = {},
) {
  const campo = p.campo(destino);
  let etiqueta = 'DIV';
  if (destino === 'guardar-secciones') {
    etiqueta = 'BUTTON';
  } else if (destino.startsWith('seccion-')) {
    etiqueta = 'INPUT';
  }
  Object.defineProperty(campo, 'tagName', {
    value: etiqueta,
    configurable: true,
  });
  if (destino.startsWith('seccion-')) {
    campo.setAttribute('type', 'checkbox');
  }
  const coincide = campo.matches.bind(campo);
  campo.matches = (selector: string) => (selector === ':disabled' ? campo.disabled : coincide(selector));
  const evento = new Event(tipo);
  Object.defineProperties(evento, {
    isTrusted: { value: true },
    target: { value: opciones.objetivo ?? campo },
    button: { value: 0 },
    key: { value: opciones.tecla ?? '' },
  });
  p.documento.dispatchEvent(evento);
}

for (const fin of ['pointercancel', 'pointerup-fuera', 'blur', 'focusout', 'dragstart', 'click', 'otra-tecla']) {
  test(`vista: el sondeo respeta la pulsación y vuelve tras ${fin}`, async (t) => {
    const p = await prepararPanel(t);
    p.publicar(estadoVista());
    p.campo('seccion-biblioteca').checked = false;
    gesto(p, 'pointerdown');
    p.tick();
    assert.deepEqual(p.llamadas, [], 'no empieza una lectura entre pulsar y soltar');
    assert.equal(p.campo('guardar-secciones').disabled, false);
    if (fin === 'blur') {
      p.ventana.dispatchEvent(new Event('blur'));
    } else if (fin === 'pointerup-fuera') {
      gesto(p, 'pointerup', 'estado');
    } else if (fin === 'otra-tecla') {
      gesto(p, 'keydown', 'guardar-secciones', { tecla: 'Escape' });
    } else {
      gesto(p, fin);
    }
    p.tick();
    assert.deepEqual(p.llamadas, ['comprobar'], 'no queda una comprobación bloqueada ni encolada');
    assert.equal(p.campo('seccion-biblioteca').checked, false, 'se conserva el borrador');
  });
}

test('vista: pulsar fuera de un control no bloquea el sondeo', async (t) => {
  const p = await prepararPanel(t);
  p.publicar(estadoVista());
  gesto(p, 'pointerdown', 'estado');
  p.tick();
  assert.deepEqual(p.llamadas, ['comprobar']);
});

for (const tecla of [' ', 'Enter']) {
  test(`vista: ${JSON.stringify(tecla)} protege el gesto hasta su clic y la expulsión lo retira`, async (t) => {
    const p = await prepararPanel(t);
    const inicial = estadoVista();
    p.publicar(inicial);
    gesto(p, 'keydown', 'guardar-secciones', { tecla });
    p.tick();
    assert.deepEqual(p.llamadas, []);
    gesto(p, 'keyup', 'guardar-secciones', { tecla });
    p.tick();
    assert.deepEqual(p.llamadas, []);
    gesto(p, 'click');
    p.campo('guardar-secciones').dispatchEvent(new Event('click'));
    assert.deepEqual(p.llamadas, ['guardar-secciones']);
    p.publicar({ ...inicial, ocupado: true });
    assert.equal(p.campo('guardar-secciones').disabled, true, 'la escritura mantiene el bloqueo');
    p.publicar(inicial);
    gesto(p, 'keydown', 'guardar-secciones', { tecla });
    p.publicar({ estado: 'sustituida', aviso: 'sesion_sustituida' });
    assert.equal(p.campo('secciones').hidden, true);
    assert.equal(p.campo('guardar-secciones').disabled, true);
    p.tick();
    assert.deepEqual(p.llamadas, ['guardar-secciones']);
    p.publicar(inicial);
    p.tick();
    assert.deepEqual(p.llamadas, ['guardar-secciones', 'comprobar'], 'la pulsación de la sesión vieja no sobrevive');
  });
}

test('vista: ocultar o cerrar la página cancela la pulsación y no deja un sondeo pendiente', async (t) => {
  const p = await prepararPanel(t);
  p.publicar(estadoVista());
  gesto(p, 'pointerdown');
  p.documento.hidden = true;
  p.documento.dispatchEvent(new Event('visibilitychange'));
  p.documento.hidden = false;
  p.documento.dispatchEvent(new Event('visibilitychange'));
  assert.deepEqual(p.llamadas, ['comprobar']);
  gesto(p, 'pointerdown');
  p.ventana.dispatchEvent(new Event('pagehide'));
  p.tick();
  assert.equal(p.reloj.size, 0);
  assert.equal(p.campo('secciones').hidden, true);
  assert.deepEqual(p.llamadas, ['comprobar', 'destruir']);
});

for (const etiqueta of [false, true]) {
  test(`vista: soltar sobre un descendiente ${etiqueta ? 'de la etiqueta asociada' : 'del botón'} conserva el gesto`, async (t) => {
    const p = await prepararPanel(t);
    p.publicar(estadoVista());
    const interior = p.campo('estado');
    Object.defineProperty(interior, 'tagName', { value: 'SPAN', configurable: true });
    const destino = etiqueta ? 'seccion-biblioteca' : 'guardar-secciones';
    if (etiqueta) {
      const label = p.campo('estado-revision-controles');
      Object.defineProperties(label, { tagName: { value: 'LABEL' }, control: { value: p.campo(destino) } });
      label.append(interior);
    } else {
      p.campo(destino).append(interior);
    }
    gesto(p, 'pointerdown', destino, { objetivo: interior });
    p.tick();
    assert.deepEqual(p.llamadas, []);
    gesto(p, 'pointerup', destino, { objetivo: interior });
    p.tick();
    assert.deepEqual(p.llamadas, [], 'soltar dentro no termina antes del clic');
    gesto(p, 'click', destino, { objetivo: interior });
    p.tick();
    assert.deepEqual(p.llamadas, ['comprobar']);
  });
}

test('sin lectura confirmada los interruptores no parecen desactivados', async (t) => {
  const p = await prepararPanel(t);
  const inicial = estadoVista();
  p.publicar({ ...inicial, secciones: null, seccionesPendientes: false });
  assert.equal(p.campo('campos-secciones').hidden, true);
  assert.equal(p.campo('guardar-secciones').disabled, true);
  assert.match(p.campo('estado-secciones').textContent, /consulta|consultar/i);
  p.publicar(inicial);
  assert.equal(p.campo('campos-secciones').hidden, false);
});

test('al abrir se leen las secciones de la autoridad antes de mostrar sus interruptores', async (t) => {
  const { abrirPanelYConsultar } = await import('../../web/administracion/capacidades.js');
  const f = await fixture(t);
  await abrirPanelYConsultar(
    f.panel,
    () => false,
    () => f.estados.at(-1) ?? null,
    { retomar: false, actualizacion: false },
  );
  const estado = activa(f.estados.at(-1) as EstadoClientePanel);
  assert.deepEqual(estado.secciones?.secciones, politicaSeccionesInicial());
  assert.deepEqual(
    f.pedidos.map((p) => p.ruta.split('/').slice(-2).join('/')),
    ['sesion/abrir', 'controles/leer', 'secciones/leer', 'datos/estado'],
  );
  // Abrir nunca retoma por su cuenta: la sesión de otro dispositivo solo se cierra con su botón.
  assert.deepEqual(f.pedidos[0]?.cuerpo, { retomar: false });
});

test('la apertura no sustituye un borrador de secciones', async (t) => {
  const { abrirPanelYConsultar } = await import('../../web/administracion/capacidades.js');
  const f = await fixture(t);
  await abrirPanelYConsultar(
    f.panel,
    () => true,
    () => f.estados.at(-1) ?? null,
    { retomar: false, actualizacion: false },
  );
  assert.equal(
    f.pedidos.some((p) => p.ruta.endsWith('secciones/leer')),
    false,
  );
});
