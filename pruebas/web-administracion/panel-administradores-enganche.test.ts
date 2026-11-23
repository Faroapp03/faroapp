/**
 * El apartado «Administradores» enganchado en el panel real: la lista se monta con el correo de la bienvenida, el
 * Inicio cuenta activos y pendientes en «Accesos» y sus avisos de atención aparecen en «Requiere atención». La
 * operación del cliente deja la sesión igual ante un error propio de la lista y trata cualquier otro rechazo como el
 * resto del panel.
 */
import './idiomas.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate as turno } from 'node:timers/promises';
import type { Administrador } from '../../src/administracion/administradores.ts';
import { politicaSeccionesInicial } from '../../src/administracion/secciones-web.js';
import type { EstadoClientePanel } from '../../web/administracion/cliente.js';
import { crearOperacionesAdministradores } from '../../web/administracion/cliente-administradores.js';
import { administradoresDePrueba, prepararPanel } from './panel-dom.ts';

type Activa = Extract<EstadoClientePanel, { estado: 'activa' }>;
const INICIO = 1_000_000;
const CORRECTO = 200;
const CONFLICTO = 409;
const PROHIBIDO = 403;
const QUINCE_MINUTOS = 900_000;
const OCHO_HORAS = 28_800_000;
const FILAS_DE_LA_LISTA = 4;

function activa(): Activa {
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
      caducaPorInactividadEn: INICIO + QUINCE_MINUTOS,
      caducaAbsolutaEn: INICIO + OCHO_HORAS,
    },
    controles: { version: 2, revision: 1, api: 'habilitada', mcp: true, a2a: false },
    secciones: { version: 3, revision: 1, secciones: politicaSeccionesInicial() },
  };
}
const fila = (correo: string, estado: Administrador['estado']): Administrador => ({
  correo,
  estado,
  anadidoPor: null,
  anadidoEn: INICIO,
  ultimaEntrada: null,
  segundoFactor: null,
});
const LISTA = {
  administradores: [
    fila('ana@faro.invalid', 'activo'),
    fila('berta@faro.invalid', 'activo'),
    fila('carla@faro.invalid', 'pendiente'),
    fila('dora@faro.invalid', 'retirada-pendiente'),
  ],
  maximo: 50,
  sincronizacion: { estado: 'configurada' },
};

/** La fila «Accesos» de «Estado del servicio», buscada por su nombre. */
function filaDeAccesos(campo: Awaited<ReturnType<typeof prepararPanel>>['campo']) {
  return campo('inicio-estado')
    .querySelectorAll('tr')
    .find((fila) => fila.querySelector('th')?.textContent === 'Accesos');
}
test('«Actualizar» del Inicio lee la lista, la monta con «tú» y la resume en «Accesos» y «Requiere atención»', async (t) => {
  administradoresDePrueba.pedidos = [];
  administradoresDePrueba.respuestas = { 'administradores/leer': { estado: CORRECTO, cuerpo: LISTA } };
  t.after(() => {
    administradoresDePrueba.respuestas = {};
  });
  const p = await prepararPanel(t);
  p.publicar(activa());
  p.campo('inicio-actualizar').dispatchEvent(new Event('click'));
  await turno();
  await turno();
  assert.deepEqual(administradoresDePrueba.pedidos, [{ ruta: 'administradores/leer', cuerpo: {} }]);
  const vista = p.campo('vista-administradores');
  const filas = vista.querySelectorAll('.administradores-fila');
  assert.equal(filas.length, FILAS_DE_LA_LISTA);
  const propia = filas.find((linea) => linea.getAttribute('data-correo') === 'ana@faro.invalid');
  assert.match(propia?.textContent ?? '', /ana@faro\.invalid · tú/u);
  const accesos = filaDeAccesos(p.campo);
  assert.match(accesos?.textContent ?? '', /Accesos/u);
  assert.match(accesos?.textContent ?? '', /Administradores activos: 2\. Pendientes de su primera entrada: 1\./u);
  assert.equal(accesos?.querySelector('a')?.getAttribute('href'), '#apartado-administradores');
  const atencion = p.campo('inicio-atencion').textContent;
  assert.match(atencion, /Requiere atención: dora@faro\.invalid ya no puede entrar/u);
});

test('pedida con el panel ocupado, la lista se lee al quedar libre, una sola vez, y llena la barra de órdenes', async (t) => {
  administradoresDePrueba.pedidos = [];
  administradoresDePrueba.respuestas = { 'administradores/leer': { estado: CORRECTO, cuerpo: LISTA } };
  t.after(() => {
    administradoresDePrueba.respuestas = {};
  });
  const p = await prepararPanel(t);
  p.publicar({ ...activa(), ocupado: true });
  p.cambiarIdioma('es');
  await turno();
  assert.deepEqual(administradoresDePrueba.pedidos, []);
  p.publicar(activa());
  await turno();
  await turno();
  p.publicar(activa());
  await turno();
  assert.deepEqual(administradoresDePrueba.pedidos, [{ ruta: 'administradores/leer', cuerpo: {} }]);
  assert.equal(p.campo('vista-administradores').querySelectorAll('.administradores-fila').length, FILAS_DE_LA_LISTA);
  assert.equal(p.campo('administradores-resumen').textContent, '4 administradores · 1 invitación pendiente');
  assert.equal(p.campo('administradores-exportar').disabled, false);
});

test('al entrar en Administradores se lee la lista si aún no se ha leído; si falla, la tarjeta lo explica', async (t) => {
  administradoresDePrueba.pedidos = [];
  administradoresDePrueba.respuestas = {};
  const p = await prepararPanel(t);
  p.publicar(activa());
  location.hash = '#apartado-administradores';
  p.ventana.dispatchEvent(new Event('hashchange'));
  await turno();
  await turno();
  assert.deepEqual(administradoresDePrueba.pedidos, [{ ruta: 'administradores/leer', cuerpo: {} }]);
  const vista = p.campo('vista-administradores');
  assert.match(vista.textContent, /No se ha podido leer la lista de administradores\. Vuelve a leerla/u);
  assert.match(vista.textContent, /Volver a leer la lista/u);
  administradoresDePrueba.respuestas = { 'administradores/leer': { estado: CORRECTO, cuerpo: LISTA } };
  p.ventana.dispatchEvent(new Event('hashchange'));
  await turno();
  await turno();
  assert.equal(administradoresDePrueba.pedidos.length, 2);
  assert.equal(vista.querySelectorAll('.administradores-fila').length, FILAS_DE_LA_LISTA);
  // Ya leída, volver al apartado no la repite.
  p.ventana.dispatchEvent(new Event('hashchange'));
  await turno();
  assert.equal(administradoresDePrueba.pedidos.length, 2);
  location.hash = '';
});

test('sin la lista leída, «Accesos» sigue diciendo «Sin dato» y el panel no inventa cifras', async (t) => {
  administradoresDePrueba.respuestas = {};
  const p = await prepararPanel(t);
  p.publicar(activa());
  const accesos = filaDeAccesos(p.campo);
  assert.match(accesos?.textContent ?? '', /AccesosSin dato/u);
});

/** Un privado y unas ayudas mínimas, con lo que cada prueba quiere que responda el servidor. */
function operaciones(respuesta: { estado: number; cuerpo: unknown }, estado: EstadoClientePanel = activa()) {
  const anotado = { activadas: 0, rechazadas: 0, mutacion: null as boolean | null };
  const privado = { estado, token: 'token', trabajo: null, sesion: activa().sesion } as never;
  const ayudas = {
    ejecutar: async (_p: unknown, _o: string, accion: (trabajo: { mutacion: boolean }) => Promise<void>) => {
      const trabajo = { mutacion: false };
      try {
        await accion(trabajo);
      } catch {
        // El cliente real lo atiende en `fallo`: aquí basta con saber que se rechazó.
      }
      anotado.mutacion = trabajo.mutacion;
    },
    enviar: async () => respuesta,
    vigente: () => true,
    rechazar: () => {
      anotado.rechazadas++;
      throw new Error('rechazada');
    },
    activar: () => {
      anotado.activadas++;
    },
  } as never;
  return { ...crearOperacionesAdministradores(privado, ayudas), anotado };
}

test('un error propio de la lista llega a la vista y la sesión sigue igual', async () => {
  const respuesta = { estado: CONFLICTO, cuerpo: { error: 'lista_llena' } };
  const o = operaciones(respuesta);
  assert.deepEqual(await o.pedirAdministradores('administradores/anadir', { correo: 'eva@faro.invalid' }), respuesta);
  assert.deepEqual(o.anotado, { activadas: 1, rechazadas: 0, mutacion: true });
});

test('la sesión inactiva, sustituida o sin permiso se rechaza como en el resto del panel', async () => {
  for (const respuesta of [
    { estado: PROHIBIDO, cuerpo: { error: 'sesion_inactiva' } },
    { estado: CONFLICTO, cuerpo: { error: 'sesion_sustituida' } },
    { estado: PROHIBIDO, cuerpo: { error: 'no_es_administrador' } },
  ]) {
    const o = operaciones(respuesta);
    assert.deepEqual(
      await o.pedirAdministradores('administradores/retirar', { correo: 'eva@faro.invalid' }),
      respuesta,
    );
    assert.deepEqual(o.anotado, { activadas: 0, rechazadas: 1, mutacion: true });
  }
});

test('leer no es una mutación; sin sesión activa o con otra ruta no sale nada', async () => {
  const o = operaciones({ estado: CORRECTO, cuerpo: LISTA });
  await o.pedirAdministradores('administradores/leer', {});
  assert.equal(o.anotado.mutacion, false);
  const cerrada = operaciones({ estado: CORRECTO, cuerpo: LISTA }, { estado: 'cerrada', aviso: null });
  assert.deepEqual(await cerrada.pedirAdministradores('administradores/leer', {}), { estado: 0, cuerpo: null });
  assert.deepEqual(await o.pedirAdministradores('controles/cambiar', {}), { estado: 0, cuerpo: null });
  assert.equal(cerrada.anotado.mutacion, null);
});
