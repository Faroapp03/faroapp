import { planDePrueba } from '../fixtures/plan-formacion.ts';
import './aislar.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { crearAgenda } from '../../web/scripts/recorrido/plan-formacion/agenda.js';
import { calendarioDelPlan } from '../../web/scripts/recorrido/plan-formacion/calendario-ics.js';
import { crearDocumentoDelPlan } from '../../web/scripts/recorrido/plan-formacion/documento.js';
import { type Nodo, prepararDom } from './dom.ts';

type Cronograma = Parameters<typeof calendarioDelPlan>[1];
const OCTETOS_POR_LINEA = 75;

function cronogramaSintetico(): Cronograma {
  return {
    semanas: [{ slots: [{ fecha: '2026-11-09', minutos: 90, indice: 0 }] }],
    sesiones: [
      { indice: 1, inicio: '2026-11-10T09:00:00Z', fin: '2026-11-10T11:00:00Z' },
      { indice: 1, inicio: '2026-11-11T10:00:00-00:00', fin: null },
      { indice: 1, inicio: '2026-10-01T09:00:00Z', fin: null },
    ],
  } as unknown as Cronograma;
}

test('el calendario es iCalendar válido: zona de Madrid, días de estudio enteros y sesiones con su hora', () => {
  const plan = planDePrueba('es');
  const texto = calendarioDelPlan(plan, cronogramaSintetico());
  const lineas = texto.split('\r\n');
  assert.equal(lineas[0], 'BEGIN:VCALENDAR');
  assert.equal(lineas.at(-2), 'END:VCALENDAR');
  assert.equal(lineas.at(-1), '', 'Termina con CRLF');
  assert.doesNotMatch(texto.replace(/\r\n/gu, ''), /\n/u, 'Solo saltos CRLF');
  assert.ok(texto.includes('TZID:Europe/Madrid'));
  assert.equal(texto.match(/BEGIN:VEVENT/gu)?.length, 2, 'Una sesión sin zona y otra pasada no se exportan');
  assert.ok(texto.includes('DTSTART;VALUE=DATE:20261109'));
  assert.ok(texto.includes('DTEND;VALUE=DATE:20261110'));
  assert.ok(texto.includes('DTSTART;TZID=Europe/Madrid:20261110T100000'));
  assert.ok(texto.includes('DTEND;TZID=Europe/Madrid:20261110T120000'));
  assert.ok(texto.includes('SUMMARY:Estudio (1 h 30 min) · Curso sintético de privacidad'));
  assert.ok(texto.includes('SUMMARY:Sesión publicada · Curso sintético de privacidad'));
  assert.ok(texto.includes(`URL:${plan.elecciones[0]?.oferta.url}`));
  const codificador = new TextEncoder();
  assert.ok(
    lineas.every((linea) => codificador.encode(linea).length <= OCTETOS_POR_LINEA),
    'Líneas plegadas a 75 octetos',
  );
  const uids = texto.match(/^UID:.*$/gmu) ?? [];
  assert.equal(new Set(uids).size, uids.length, 'Cada evento tiene su identificador');
});

test('el calendario se escribe en la lengua de la hoja y escapa los caracteres reservados', () => {
  const base = planDePrueba('ca');
  const [primera, ...resto] = base.elecciones;
  assert.ok(primera);
  const titulo = 'Curs; amb, comes\\barres';
  const plan = {
    ...base,
    elecciones: [{ ...primera, oferta: { ...primera.oferta, titulo_programa: titulo } }, ...resto],
  };
  const texto = calendarioDelPlan(plan, cronogramaSintetico()).replace(/\r\n /gu, '');
  assert.ok(texto.includes('SUMMARY:Estudi (1 h 30 min) · Curs\\; amb\\, comes\\\\barres'));
  assert.ok(texto.includes('Sessió publicada'));
  assert.ok(texto.includes('Fitxa oficial del curs: '));
});

test('la hoja ofrece «Añadir a mi calendario» en pantalla con el calendario real del plan', () => {
  prepararDom();
  const plan = planDePrueba('es');
  const documento = crearDocumentoDelPlan(plan) as unknown as Nodo;
  const boton = documento.querySelector('.pe-calendario-ics');
  assert.ok(boton);
  assert.equal(boton.textContent, 'Añadir a mi calendario');
  const cronograma = crearAgenda(plan).cronograma;
  assert.ok(cronograma);
  assert.match(calendarioDelPlan(plan, cronograma), /BEGIN:VEVENT/u);
});

/** Los eventos del calendario, ya desplegados, cada uno como un bloque de texto. */
function eventos(texto: string) {
  return texto
    .replace(/\r\n /gu, '')
    .split('BEGIN:VEVENT')
    .slice(1)
    .map((bloque) => bloque.slice(0, bloque.indexOf('END:VEVENT')));
}

test('cada tipo de evento lleva su nota: el día de estudio lo propone Faro; la sesión la publica el proveedor', () => {
  for (const idioma of ['es', 'ca'] as const) {
    const [estudio, sesion] = eventos(calendarioDelPlan(planDePrueba(idioma), cronogramaSintetico()));
    assert.ok(estudio && sesion);
    const propuesta = idioma === 'ca' ? /Dia d’estudi proposat per Faro/u : /Día de estudio propuesto por Faro/u;
    const publicada =
      idioma === 'ca'
        ? /Sessió publicada pel proveïdor\. Confirma la data i l’horari amb el proveïdor\./u
        : /Sesión publicada por el proveedor\. Confirma la fecha y el horario con el proveedor\./u;
    assert.match(estudio, propuesta);
    assert.doesNotMatch(estudio, publicada);
    assert.match(sesion, publicada);
    assert.doesNotMatch(sesion, propuesta, 'Una sesión del proveedor no es una propuesta de Faro');
    assert.match(estudio, /TRANSP:TRANSPARENT/u, 'Un día de estudio no ocupa la agenda');
    assert.match(sesion, /TRANSP:OPAQUE/u, 'Una sesión publicada ocupa su hora');
  }
});

test('cabecera completa, sesiones en verano y en el día del cambio de hora, y sin sesiones que acaben antes de empezar', () => {
  const plan = planDePrueba('es');
  const cronograma = {
    semanas: [],
    sesiones: [
      { indice: 0, inicio: '2027-06-15T08:00:00Z', fin: '2027-06-15T10:00:00Z' },
      { indice: 0, inicio: '2027-03-28T00:30:00Z', fin: '2027-03-28T01:30:00Z' },
      { indice: 0, inicio: '2026-11-12T10:00:00Z', fin: '2026-11-12T09:00:00Z' },
      { indice: 0, inicio: '2026-11-13T10:00:00Z', fin: '2026-11-13T10:00:00Z' },
    ],
  } as unknown as Cronograma;
  const texto = calendarioDelPlan(plan, cronograma);
  const lineas = texto.split('\r\n');
  assert.equal(lineas[1], 'VERSION:2.0');
  assert.match(lineas[2] ?? '', /^PRODID:-\/\/Faro\/\//u);
  const lista = eventos(texto);
  assert.equal(lista.length, 2, 'Una sesión que acaba antes de empezar, o a la vez, no se exporta');
  const [verano, cambio] = lista;
  assert.ok(verano && cambio);
  assert.match(verano, /DTSTAMP:20261022T110000Z/u, 'El sello es la confirmación del plan, en UTC');
  assert.match(verano, /DTSTART;TZID=Europe\/Madrid:20270615T100000/u, 'En verano Madrid va dos horas por delante');
  assert.match(verano, /DTEND;TZID=Europe\/Madrid:20270615T120000/u);
  assert.match(cambio, /DTSTART;TZID=Europe\/Madrid:20270328T013000/u, 'Antes del cambio, hora de invierno');
  assert.match(cambio, /DTEND;TZID=Europe\/Madrid:20270328T033000/u, 'Después del cambio, hora de verano');
});

test('un retorno de carro suelto en un texto se escapa como salto de línea', () => {
  const base = planDePrueba('es');
  const [primera, ...resto] = base.elecciones;
  assert.ok(primera);
  const plan = {
    ...base,
    elecciones: [{ ...primera, oferta: { ...primera.oferta, titulo_programa: 'Uno\rDos' } }, ...resto],
  };
  const texto = calendarioDelPlan(plan, cronogramaSintetico());
  assert.ok(texto.replace(/\r\n /gu, '').includes('Uno\\nDos'));
  assert.doesNotMatch(texto.replace(/\r\n/gu, ''), /\r/u, 'Ningún retorno de carro fuera de los finales de línea');
});
