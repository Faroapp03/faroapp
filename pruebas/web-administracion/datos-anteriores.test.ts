/**
 * Con una actualización reservada que todavía no ha dejado sus datos, el servidor envía la última observación admitida
 * con la marca `deLaActualizacionAnterior`, y «Fuentes» lo dice. Sin la marca no se añade nada: el panel no lo deduce.
 */
import './idiomas.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { leerEstadoDatosPanel } from '../../src/administracion/estado-datos.js';
import { leerLecturaDatos } from '../../web/administracion/contratos.js';
import { mostrarFuentes } from '../../web/administracion/vista-fuentes.js';
import { instantaneaSalud } from '../ayudas/salud-datos.ts';
import { html, instalar, nodo } from '../web-informe-lectura/dom-doble.ts';
import { activarIdiomaPanel } from './idiomas.ts';

const NOTA = /Estos datos son de la última actualización completada/u;
const INICIO_MS = 1_795_000_000_000;
const INACTIVIDAD_MS = 900_000;
const ABSOLUTA_MS = 28_800_000;
const SESION = {
  estado: 'activa',
  iniciadaEn: INICIO_MS,
  ultimaActividadEn: INICIO_MS,
  caducaPorInactividadEn: INICIO_MS + INACTIVIDAD_MS,
  caducaAbsolutaEn: INICIO_MS + ABSOLUTA_MS,
};

function pintar(t: test.TestContext, deLaActualizacionAnterior?: boolean) {
  instalar(t);
  const vista = { estadoDatos: nodo('div'), retenidos: nodo('section'), retenidosLista: nodo('div') };
  mostrarFuentes(
    {
      estadoDatos: html(vista.estadoDatos),
      retenidos: html(vista.retenidos),
      retenidosLista: html(vista.retenidosLista),
    },
    leerEstadoDatosPanel(instantaneaSalud()),
    deLaActualizacionAnterior,
  );
  return vista.estadoDatos.textContent;
}

test('con la marca del servidor, «Fuentes» avisa de que los datos son de la actualización anterior', (t) => {
  assert.match(pintar(t, true), NOTA);
});

test('sin la marca, o con ella en falso, no se añade nada', (t) => {
  assert.doesNotMatch(pintar(t, false), NOTA);
  assert.doesNotMatch(pintar(t), NOTA);
});

test('el aviso se lee también en catalán', (t) => {
  activarIdiomaPanel('ca');
  t.after(() => activarIdiomaPanel());
  assert.match(pintar(t, true), /Aquestes dades són de l’última actualització completada/u);
});

test('el lector cerrado del cliente admite la marca y rechaza la respuesta sin ella o con otro valor', () => {
  const datos = instantaneaSalud();
  const lectura = leerLecturaDatos({ estado: 'activa', sesion: SESION, datos, deLaActualizacionAnterior: true });
  assert.equal(lectura.deLaActualizacionAnterior, true);
  assert.deepEqual(lectura.datos, leerEstadoDatosPanel(datos));
  assert.equal(
    leerLecturaDatos({ estado: 'activa', sesion: SESION, datos, deLaActualizacionAnterior: false })
      .deLaActualizacionAnterior,
    false,
  );
  assert.throws(() => leerLecturaDatos({ estado: 'activa', sesion: SESION, datos }));
  assert.throws(() => leerLecturaDatos({ estado: 'activa', sesion: SESION, datos, deLaActualizacionAnterior: 'si' }));
});
