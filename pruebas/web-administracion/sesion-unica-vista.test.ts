import assert from 'node:assert/strict';
import { type TestContext, test } from 'node:test';
import { DURACION_MAXIMA_SESION_PANEL_MS, INACTIVIDAD_SESION_PANEL_MS } from '../../src/administracion/sesion.ts';
import type { BienvenidaPanel, FilaRegistroPanel } from '../../src/administracion/sesion-unica.ts';
import {
  AVISO_CIERRE_MS,
  anadirIdApertura,
  avisoDeFin,
  horaPanel,
  mostrarApertura,
  pintarBanda,
  pintarBienvenida,
  pintarRegistro,
} from '../../web/administracion/vista-sesion-unica.js';
import { navegador } from '../web-controles/ayudas.js';
import { Elemento } from '../web-informe-lectura/dom-doble.ts';
import { activarIdiomaPanel } from './idiomas.ts';

/** 23/11/2026 a las 10:00 en Cataluña (09:00 UTC). */
const INICIO = Date.parse('2026-11-23T09:00:00Z');
/** 01/07/2026 a las 22:05 en Cataluña, en horario de verano. */
const VERANO = Date.parse('2026-07-01T20:05:00Z');
const MINUTO = 60_000;
const TRECE_MINUTOS = 780_000;
const CATORCE_MINUTOS = 840_000;
const VEINTINUEVE_MINUTOS = 1_740_000;
const DIECISEIS_MINUTOS = 960_000;

function dom(t: TestContext) {
  navegador(t, {
    document: {
      createElement: (etiqueta: string) => new Elemento(etiqueta),
      createElementNS: (_espacio: string, etiqueta: string) => new Elemento(etiqueta),
    },
    fetch: () => {
      throw new Error('La vista no consulta la red');
    },
  });
  activarIdiomaPanel();
  t.after(() => activarIdiomaPanel());
  return new Elemento('div');
}
const html = (elemento: Elemento) => elemento as unknown as HTMLElement;
const libre: BienvenidaPanel = {
  correo: 'ana@faro.invalid',
  idEntrada: 'E-7K2M9QXA',
  entradaEn: INICIO,
  ocupacion: null,
};
const sesion = {
  estado: 'activa' as const,
  iniciadaEn: INICIO + MINUTO,
  ultimaActividadEn: INICIO + MINUTO,
  caducaPorInactividadEn: INICIO + MINUTO + INACTIVIDAD_SESION_PANEL_MS,
  caducaAbsolutaEn: INICIO + MINUTO + DURACION_MAXIMA_SESION_PANEL_MS,
};
const banda = {
  idSesion: 'S-4H8RZT1C',
  idEntrada: 'E-7K2M9QXA',
  correo: 'ana@faro.invalid',
  entradaEn: INICIO,
  sesion,
};

test('bienvenida libre: saluda, dice quién ha entrado como «Usuario» y ofrece abrir la sesión única', (t) => {
  const destino = dom(t);
  const { accion } = pintarBienvenida(html(destino), libre);
  assert.match(destino.textContent, /^Identidad verificadaBienvenido al Panel de Control/);
  assert.match(destino.textContent, /Tu entradaUsuarioana@faro\.invalidEntradaE-7K2M9QXA/);
  assert.match(destino.textContent, /VerificaciónCorreo, contraseña y segundo factorHora10:00PanelLibre$/);
  assert.doesNotMatch(destino.textContent, /Persona/);
  assert.match(destino.textContent, /nadie más puede hacer cambios/);
  assert.equal(accion?.textContent, 'Abrir sesión única');
  assert.equal(accion?.getAttribute('data-accion'), 'abrir');
  const seccion = destino.querySelector('.sesion-unica-bienvenida');
  assert.equal(seccion?.getAttribute('data-id-entrada'), 'E-7K2M9QXA');
  assert.equal(seccion?.getAttribute('data-entrada-en'), String(INICIO));
});

test('ocupada por otra persona: sin botón, solo con quién la tiene y desde qué hora', (t) => {
  const destino = dom(t);
  const ocupacion = {
    correo: 'berta@faro.invalid',
    desde: INICIO,
    cierrePorInactividadEn: INICIO + INACTIVIDAD_SESION_PANEL_MS,
    limiteEn: INICIO + DURACION_MAXIMA_SESION_PANEL_MS,
    idSesion: null,
    idEntrada: null,
    propia: false,
  };
  const { accion } = pintarBienvenida(html(destino), { ...libre, ocupacion });
  assert.equal(accion, null);
  assert.equal(
    destino.querySelector('.sesion-unica-ocupada')?.textContent,
    'El Panel de Control está abierto por berta@faro.invalid desde las 10:00.',
  );
  assert.doesNotMatch(destino.textContent, /10:15|18:00/);
  assert.match(destino.textContent, /PanelAbierto$/);
  assert.equal(destino.querySelectorAll('button').length, 0);
  pintarBienvenida(html(destino), { ...libre, ocupacion: { ...ocupacion, correo: null } });
  assert.match(destino.textContent, /abierto por otro usuario desde las 10:00/);
  activarIdiomaPanel('ca');
  pintarBienvenida(html(destino), { ...libre, ocupacion });
  assert.equal(
    destino.querySelector('.sesion-unica-ocupada')?.textContent,
    'El Tauler de Control està obert per berta@faro.invalid des de les 10:00.',
  );
});

test('misma persona en otro dispositivo: lo dice y ofrece cerrar aquella y abrirla aquí', (t) => {
  const destino = dom(t);
  const ocupacion = {
    correo: 'ana@faro.invalid',
    desde: INICIO,
    cierrePorInactividadEn: INICIO,
    limiteEn: INICIO,
    idSesion: 'S-4H8RZT1C',
    idEntrada: 'E-7K2M9QXA',
    propia: true,
  };
  const { accion } = pintarBienvenida(html(destino), { ...libre, ocupacion });
  assert.match(destino.textContent, /Tienes el Panel de Control abierto en otro dispositivo\./);
  assert.equal(accion?.textContent, 'Cerrar aquella y abrirla aquí');
  assert.equal(accion?.getAttribute('data-accion'), 'retomar');
  assert.match(destino.textContent, /PanelAbierto · S-4H8RZT1C$/);
});

test('banda en la barra: id, desde qué hora y la inicial del usuario con su correo y «Cerrar sesión»', (t) => {
  const destino = dom(t);
  const { cerrar, seguir } = pintarBanda(html(destino), banda, INICIO + MINUTO);
  assert.equal(destino.textContent, 'Sesión única S-4H8RZT1C · desde 10:01Aana@faro.invalidCerrar sesión');
  assert.equal(cerrar.textContent, 'Cerrar sesión');
  assert.equal(seguir, null);
  const caja = destino.querySelector('.sesion-unica-banda');
  assert.deepEqual(
    [
      'data-id-sesion',
      'data-id-entrada',
      'data-correo',
      'data-entrada-en',
      'data-abierta-en',
      'data-actividad-en',
      'data-cierre-inactividad-en',
      'data-limite-en',
    ].map((nombre) => caja?.getAttribute(nombre)),
    [
      'S-4H8RZT1C',
      'E-7K2M9QXA',
      'ana@faro.invalid',
      String(INICIO),
      String(sesion.iniciadaEn),
      String(sesion.ultimaActividadEn),
      String(sesion.caducaPorInactividadEn),
      String(sesion.caducaAbsolutaEn),
    ],
  );
  activarIdiomaPanel('ca');
  pintarBanda(html(destino), banda, INICIO + MINUTO);
  assert.equal(destino.textContent, 'Sessió única S-4H8RZT1C · des de 10:01Aana@faro.invalidTancar la sessió');
});

test('la inicial del usuario abre su menú con el correo y «Cerrar sesión»; Escape lo recoge', (t) => {
  const destino = dom(t);
  const { cerrar } = pintarBanda(html(destino), banda, INICIO + MINUTO);
  const inicial = destino.querySelector('.sesion-unica-avatar');
  const menu = destino.querySelector('.sesion-unica-menu');
  assert.equal(inicial?.textContent, 'A');
  assert.equal(inicial?.getAttribute('aria-label'), 'Tu cuenta: ana@faro.invalid');
  assert.equal(menu?.hidden, true);
  assert.equal(menu?.querySelector('.sesion-unica-cerrar'), cerrar as unknown as Elemento);
  inicial?.dispatchEvent(new Event('click'));
  assert.equal(menu?.hidden, false);
  assert.equal(inicial?.getAttribute('aria-expanded'), 'true');
  const teclaEscape = Object.assign(new Event('keydown'), { key: 'Escape' });
  destino.querySelector('.sesion-unica-cuenta')?.dispatchEvent(teclaEscape);
  assert.equal(menu?.hidden, true);
  assert.equal(inicial?.getAttribute('aria-expanded'), 'false');
});

test('aviso de cierre: aparece a los 13 minutos sin actividad y desaparece al seguir con la sesión', (t) => {
  const destino = dom(t);
  assert.equal(TRECE_MINUTOS, INACTIVIDAD_SESION_PANEL_MS - AVISO_CIERRE_MS);
  const antes = pintarBanda(html(destino), banda, sesion.ultimaActividadEn + TRECE_MINUTOS - 1);
  assert.equal(antes.seguir, null);
  const aviso = pintarBanda(html(destino), banda, sesion.ultimaActividadEn + TRECE_MINUTOS);
  assert.equal(aviso.seguir?.textContent, 'Seguir con la sesión');
  assert.match(destino.textContent, /Tu sesión única se cerrará a las 10:16 si no haces nada\./);
  const renovada = {
    ...sesion,
    ultimaActividadEn: INICIO + CATORCE_MINUTOS,
    caducaPorInactividadEn: INICIO + VEINTINUEVE_MINUTOS,
  };
  const tras = pintarBanda(html(destino), { ...banda, sesion: renovada }, INICIO + CATORCE_MINUTOS);
  assert.equal(tras.seguir, null);
  assert.doesNotMatch(destino.textContent, /si no haces nada/);
});

test('al cerrar o caducar, la bienvenida vuelve con un aviso que dice qué ha pasado', (t) => {
  const destino = dom(t);
  pintarBienvenida(html(destino), libre, avisoDeFin('inactividad', INICIO + DIECISEIS_MINUTOS));
  assert.match(destino.textContent, /La sesión única se cerró por inactividad a las 10:16\. Puedes abrirla de nuevo\./);
  assert.equal(destino.querySelector('.sesion-unica-aviso')?.getAttribute('role'), 'status');
  assert.match(avisoDeFin('cerrada', INICIO), /Has cerrado la sesión única/);
  assert.match(avisoDeFin('duracion', INICIO), /al llegar a 8 horas, a las 10:00/);
  assert.match(avisoDeFin('sustituida', INICIO), /en otro dispositivo/);
});

test('apertura: transición de una sola vez; con movimiento reducido no hay transición', (t) => {
  const destino = dom(t);
  const confirmacion = mostrarApertura(html(destino), false);
  assert.equal(destino.textContent, 'Sesión única abierta');
  assert.equal(destino.querySelectorAll('.sesion-unica-transicion').length, 1);
  // El identificador llega después y se añade sin volver a dibujar la marca.
  anadirIdApertura(confirmacion, 'S-4H8RZT1C');
  assert.equal(destino.textContent, 'Sesión única abiertaS-4H8RZT1C · solo tú puedes hacer cambios ahora');
  assert.equal(destino.querySelectorAll('.sesion-unica-transicion').length, 1);
  mostrarApertura(html(destino), true);
  assert.equal(destino.textContent, 'Sesión única abierta');
  assert.equal(destino.querySelectorAll('.sesion-unica-transicion').length, 0);
});

const filas: FilaRegistroPanel[] = [
  {
    instante: INICIO + MINUTO + MINUTO + MINUTO,
    tipo: 'apertura-rechazada',
    correo: 'berta@faro.invalid',
    idEntrada: 'E-BBBBBBBB',
    idSesion: 'S-4H8RZT1C',
    motivo: null,
    titular: 'ana@faro.invalid',
  },
  {
    instante: INICIO + MINUTO + MINUTO,
    tipo: 'sesion-caducada',
    correo: 'ana@faro.invalid',
    idEntrada: 'E-7K2M9QXA',
    idSesion: 'S-4H8RZT1C',
    motivo: 'duracion',
    titular: null,
  },
  {
    instante: INICIO + MINUTO,
    tipo: 'sesion-abierta',
    correo: 'ana@faro.invalid',
    idEntrada: 'E-7K2M9QXA',
    idSesion: 'S-4H8RZT1C',
    motivo: null,
    titular: null,
  },
  {
    instante: INICIO,
    tipo: 'entrada',
    correo: 'ana@faro.invalid',
    idEntrada: 'E-7K2M9QXA',
    idSesion: null,
    motivo: null,
    titular: null,
  },
];

test('registro en castellano y en catalán: columna «Actividad», lo más nuevo arriba y entradas atenuadas', (t) => {
  const destino = dom(t);
  // Llegan desordenadas: la tabla las ordena de la más reciente a la más antigua.
  pintarRegistro(
    html(destino),
    [filas[2], filas[3], filas[0], filas[1]] as FilaRegistroPanel[],
    INICIO + TRECE_MINUTOS,
  );
  const cabecera = destino.querySelectorAll('th').map((celda) => celda.textContent);
  assert.deepEqual(cabecera, ['Fecha y hora', 'Usuario', 'Actividad', 'Entrada', 'Sesión']);
  const sucesos = destino.querySelectorAll('.sesion-unica-celda-suceso').map((celda) => celda.textContent);
  assert.deepEqual(sucesos, [
    'Rechazada · Intentó abrir el panel mientras lo tenía ana@faro.invalid.',
    'Caducada · La sesión S-4H8RZT1C se cerró sola por llegar a 8 horas.',
    'Abierta · Abrió la sesión única S-4H8RZT1C.',
    'Entró en el panel.',
  ]);
  const atenuadas = destino.querySelectorAll('tr.sesion-unica-fila-atenuada').map((fila) => fila.textContent);
  assert.equal(atenuadas.length, 1);
  assert.match(atenuadas[0] ?? '', /Entró en el panel\.E-7K2M9QXA—$/);
  const entradas = destino.querySelectorAll('tr.sesion-unica-fila').map((fila) => fila.getAttribute('data-id-entrada'));
  assert.deepEqual(entradas, ['E-BBBBBBBB', 'E-7K2M9QXA', 'E-7K2M9QXA', 'E-7K2M9QXA']);
  activarIdiomaPanel('ca');
  pintarRegistro(html(destino), filas, INICIO + TRECE_MINUTOS);
  assert.deepEqual(
    destino.querySelectorAll('th').map((celda) => celda.textContent),
    ['Data i hora', 'Usuari', 'Activitat', 'Entrada', 'Sessió'],
  );
  assert.equal(destino.querySelectorAll('.sesion-unica-celda-suceso')[3]?.textContent, 'Va entrar al tauler.');
  assert.equal(
    destino.querySelectorAll('.sesion-unica-celda-suceso')[0]?.textContent,
    'Rebutjada · Va intentar obrir el tauler mentre el tenia ana@faro.invalid.',
  );
  pintarRegistro(html(destino), []);
  assert.equal(destino.textContent, 'Encara no hi ha accessos registrats.');
});

test('la hora es la de Cataluña en 24 horas', () => {
  assert.equal(horaPanel(INICIO), '10:00');
  assert.equal(horaPanel(VERANO), '22:05');
});
