import './idiomas.ts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { EstadoDatosPanel } from '../../src/administracion/estado-datos.js';
import { leerEstadoDatosPanel } from '../../src/administracion/estado-datos.js';
import type { RetenidosDatos } from '../../src/administracion/retenidos-datos.js';
import { mostrarRetenidos } from '../../web/administracion/vista-retenidos.js';
import { TEXTOS_RETENIDOS as TEXTOS_CA } from '../../web/idiomas/ca/panel-retenidos.js';
import { TEXTOS_RETENIDOS as TEXTOS_ES } from '../../web/idiomas/es/panel-retenidos.js';
import { instantaneaSalud } from '../ayudas/salud-datos.ts';
import { type Elemento, html, instalar, nodo } from '../web-informe-lectura/dom-doble.ts';
import { activarIdiomaPanel } from './idiomas.ts';
import { fijarReloj } from './reloj-fijo.ts';

const CIFRAS_SHA = 64;
const HUELLA = 'd'.repeat(CIFRAS_SHA);
const VERSION_RETENIDOS = 6;
// El censo del SOC pendiente se cuenta en tres frases: sus cifras, cuándo se consultó y qué significa.
const PARRAFOS_DEL_CENSO = 3;
const NADA: RetenidosDatos = {
  cuarentena: { lectura: 'leida', cambios: [] },
  censoSoc: { lectura: 'leida', pendiente: null },
};
const UN_CAMBIO: RetenidosDatos = {
  ...NADA,
  cuarentena: {
    lectura: 'leida',
    cambios: [
      {
        archivo: 'cursos.json',
        grupo: ['cursos.json', 'cursos_indice.json'],
        perdidas: [{ medida: 'entradas', antes: 1250, despues: 700 }],
        desdeUtc: '2026-11-11T05:10:00Z',
        ultimaUtc: '2026-11-14T05:10:00.123456Z',
        vigenteSha256: HUELLA,
        exportadoSha256: HUELLA,
        aceptadaUtc: null,
      },
    ],
  },
};

/** El estado pasa por el lector, como en el panel: la vista nunca recibe un bloque que no cumpla el contrato. */
function estadoV6(retenidos: RetenidosDatos): EstadoDatosPanel {
  return leerEstadoDatosPanel({ ...instantaneaSalud(), version: VERSION_RETENIDOS, retenidos });
}
function pintar(datos: EstadoDatosPanel | null) {
  const bloque = nodo('section', { hidden: '' });
  const lista = nodo('div');
  mostrarRetenidos({ bloque: html(bloque), lista: html(lista) }, datos);
  return { bloque, lista };
}
const parrafos = (lista: Elemento) => lista.querySelectorAll('p').map((p) => p.textContent);

test('sin cambios retenidos, o con un estado anterior a la v6, el bloque no se pinta', (t) => {
  instalar(t);
  for (const datos of [null, leerEstadoDatosPanel(instantaneaSalud()), estadoV6(NADA)]) {
    const { bloque, lista } = pintar(datos);
    assert.equal(bloque.hidden, true);
    assert.equal(lista.childNodes.length, 0);
  }
  const { bloque, lista } = pintar(estadoV6(UN_CAMBIO));
  assert.equal(bloque.hidden, false);
  mostrarRetenidos({ bloque: html(bloque), lista: html(lista) }, estadoV6(NADA));
  assert.equal(bloque.hidden, true);
  assert.equal(lista.childNodes.length, 0);
});

test('un cambio retenido se pinta con su archivo, sus cifras, su fecha y lo que significa, en castellano', (t) => {
  instalar(t);
  fijarReloj(t);
  activarIdiomaPanel('es');
  const { bloque, lista } = pintar(estadoV6(UN_CAMBIO));
  assert.equal(bloque.hidden, false);
  assert.equal(lista.querySelectorAll('ul li').length, 1);
  assert.equal(lista.querySelector('li h4')?.textContent, 'Archivo de datos cursos.json');
  assert.deepEqual(parrafos(lista), [
    'Había 1.250 entradas publicadas y esta actualización trae 700.',
    'Se retuvo por primera vez hace 3 días, el 11 nov. 2026 a las 6:10.',
    'La última actualización lo volvió a comprobar hoy a las 6:10.',
    'Con este archivo se conservan también: cursos_indice.json.',
    'Se conserva lo publicado hasta que alguien lo revise.',
  ]);
});

test('el mismo cambio y el censo del SOC pendiente se pintan en catalán', (t) => {
  instalar(t);
  fijarReloj(t);
  activarIdiomaPanel('ca');
  t.after(() => activarIdiomaPanel('es'));
  const pendiente = { cursosOferta: 120, cursosCopia: 1300, huella: HUELLA, consultadoEn: '2026-11-13T05:20:00Z' };
  const { lista } = pintar(estadoV6({ ...UN_CAMBIO, censoSoc: { lectura: 'leida', pendiente } }));
  assert.deepEqual(
    lista.querySelectorAll('li h4').map((h) => h.textContent),
    ['Fitxer de dades cursos.json', 'Oferta de cursos del SOC'],
  );
  const textos = parrafos(lista);
  assert.equal(textos[0], 'Hi havia 1.250 entrades publicades i aquesta actualització en porta 700.');
  assert.match(textos[1] ?? '', /^Es va retenir per primera vegada fa 3 dies, l’11 de nov\. .*2026 a les 6:10\.$/u);
  assert.deepEqual(textos.slice(-PARRAFOS_DEL_CENSO), [
    'L’última consulta va portar 120 cursos i l’oferta publicada en té 1.300.',
    'Es va consultar ahir a les 6:20.',
    'Es conserva l’oferta publicada fins que algú revisi la nova.',
  ]);
});

test('una parte que no se pudo leer se dice con qué hacer, y un cambio aceptado dice cuándo se publicará', (t) => {
  instalar(t);
  fijarReloj(t);
  activarIdiomaPanel('es');
  const ilegible = pintar(
    estadoV6({
      cuarentena: { lectura: 'ilegible', cambios: null },
      censoSoc: { lectura: 'ilegible', pendiente: null },
    }),
  );
  assert.equal(ilegible.bloque.hidden, false);
  assert.deepEqual(
    ilegible.lista.querySelectorAll('li h4').map((h) => h.textContent),
    ['Archivos de datos', 'Oferta de cursos del SOC'],
  );
  assert.ok(parrafos(ilegible.lista).every((p) => p.startsWith('No se ha podido leer') && p.includes('Vuelve a')));
  const [cambio] = UN_CAMBIO.cuarentena.cambios ?? [];
  assert.ok(cambio);
  const aceptado = { ...cambio, aceptadaUtc: '2026-11-14T08:00:00Z' };
  const { lista } = pintar(estadoV6({ ...NADA, cuarentena: { lectura: 'leida', cambios: [aceptado] } }));
  assert.equal(
    parrafos(lista).at(-1),
    'Alguien aceptó este cambio hoy a las 9:00. Se publicará con la próxima actualización, siempre que no traiga menos datos de los aceptados.',
  );
});

test('los textos de los cambios retenidos tienen las mismas claves y las mismas marcas en los dos idiomas', () => {
  assert.deepEqual(Object.keys(TEXTOS_CA), Object.keys(TEXTOS_ES));
  const marcas = (plantilla: string) => [...plantilla.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
  for (const [clave, plantilla] of Object.entries(TEXTOS_ES)) {
    assert.deepEqual(marcas(TEXTOS_CA[clave as keyof typeof TEXTOS_CA]), marcas(plantilla), clave);
  }
});

test('el bloque vive en Fuentes, bajo el estado de las fuentes, con su encabezado y fuera de las regiones vivas', () => {
  const pagina = readFileSync(new URL('../../web/administracion/index.html', import.meta.url), 'utf8');
  const bloque = /<section id="retenidos-datos" hidden aria-labelledby="titulo-retenidos">([\s\S]*?)<\/section>/u.exec(
    pagina,
  );
  assert.ok(bloque?.[1]);
  // Bajo el título del apartado (h2) y el de la tarjeta de datos (h3), el bloque lleva un h4.
  assert.match(bloque[1], /^\s*<h4 id="titulo-retenidos" data-texto="panel.retenidos.titulo">/u);
  assert.match(bloque[1], /<div id="retenidos-lista"><\/div>/u);
  assert.doesNotMatch(bloque[1], /aria-live|role="status"/u);
  const datos = pagina.indexOf('<section id="datos"');
  const inicio = pagina.indexOf('<section id="retenidos-datos"');
  // Entre el comienzo de la tarjeta de datos y el bloque no se cierra ninguna sección: el bloque está dentro, bajo su h3.
  assert.ok(datos > 0 && datos < inicio && !pagina.slice(datos, inicio).includes('</section>'));
  assert.ok(pagina.indexOf('<div id="estado-datos"') < inicio);
  assert.match(pagina.slice(datos, inicio), /<h3 id="titulo-datos"/u);
  assert.ok(pagina.indexOf('id="apartado-fuentes"') < datos, 'la tarjeta vive en el apartado Fuentes');
});
