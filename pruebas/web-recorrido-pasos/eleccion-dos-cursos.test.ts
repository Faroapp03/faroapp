import './dom.ts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { metadatosClasificados } from '../../src/catalogo-cursos/clasificacion.ts';
import type { OfertaCatalogo } from '../../src/catalogo-cursos/contrato.ts';
import type { SeleccionFormacion } from '../../src/seleccion-formacion/contrato.ts';
import { cargarDiccionario } from '../../web/idiomas/cargar.js';
import { reescribirTextos } from '../../web/scripts/idioma.js';
import { crearPropuesta } from '../../web/scripts/recorrido/propuesta-hoja.js';
import { fijarIdioma } from '../../web/scripts/textos.js';
import { type Nodo, prepararDom } from './dom.ts';
import { opcionSintetica as opcion } from './opcion-sintetica.ts';

await cargarDiccionario('es');
await cargarDiccionario('ca');
const sinAcciones = { alRevisar: () => {}, alExcluir: () => {} };
function entrada(vista: HTMLElement, nombre: string, valor: string) {
  const elegida = [...vista.querySelectorAll('input')].find((x) => x.name.endsWith(nombre) && x.value === valor);
  assert.ok(elegida, `Falta la opción ${valor} de ${nombre}`);
  return elegida;
}
function elegir(vista: HTMLElement, nombre: string, valor: string) {
  const radio = entrada(vista, nombre, valor);
  for (const otra of vista.querySelectorAll('input')) {
    if (otra.name === radio.name) {
      otra.checked = false;
    }
  }
  radio.checked = true;
  radio.dispatchEvent(new Event('change'));
}
const pulsar = (vista: HTMLElement) =>
  (vista.querySelector('.rc-boton-principal') as unknown as Nodo).dispatchEvent(new Event('click'));

test('guarda con dos, con uno o con ninguno y explica antes de pulsar qué se guardará', () => {
  prepararDom();
  fijarIdioma('es');
  const llamadas: (string | null)[][] = [];
  const excluidos: string[] = [];
  const vista = crearPropuesta(
    { opciones: { ia: [opcion('ia', 'a')], digital: [opcion('digital', 'b')] } } as unknown as SeleccionFormacion,
    {
      ...sinAcciones,
      alConfirmar: (a, b) => llamadas.push([a, b]),
      alExcluir: (programa: string) => {
        excluidos.push(programa);
      },
    },
  );
  const estado = vista.querySelector('[role="status"]');
  const boton = vista.querySelector('.rc-boton-principal');
  assert.ok(estado && boton);
  assert.equal(boton.getAttribute('aria-describedby'), estado.id);
  assert.equal(
    [...vista.querySelectorAll('input')].some((x) => x.checked),
    false,
    'Nada se marca por defecto',
  );
  assert.match(estado.textContent ?? '', /no tendrá cursos/u);
  pulsar(vista);
  elegir(vista, '-ia', 'a');
  assert.match(estado.textContent ?? '', /tendrá un curso/u);
  pulsar(vista);
  elegir(vista, '-digital', 'b');
  assert.match(estado.textContent ?? '', /tendrá dos cursos/u);
  pulsar(vista);
  elegir(vista, '-ia', '');
  pulsar(vista);
  assert.deepEqual(llamadas, [
    [null, null],
    ['a', null],
    ['a', 'b'],
    [null, 'b'],
  ]);
  assert.equal(vista.querySelectorAll('.rc-hoja-curso a').length, 2);
  (vista.querySelector('.rc-hoja-curso button') as unknown as Nodo).dispatchEvent(new Event('click'));
  assert.deepEqual(excluidos, ['programa-a']);
});

test('un grupo sin ofertas no bloquea la hoja: se explica y se puede guardar con el otro', () => {
  prepararDom();
  fijarIdioma('es');
  const llamadas: (string | null)[][] = [];
  const vista = crearPropuesta(
    { opciones: { ia: [opcion('ia', 'a')], digital: [] } } as unknown as SeleccionFormacion,
    { ...sinAcciones, alConfirmar: (a, b) => llamadas.push([a, b]) },
  );
  assert.match(
    vista.textContent ?? '',
    /No hay cursos de este grupo con tus condiciones\. Puedes guardar la hoja sin un curso de este grupo o cambiar tus preferencias\./u,
  );
  assert.doesNotMatch(vista.textContent ?? '', /continúa con el informe laboral/u);
  elegir(vista, '-ia', 'a');
  pulsar(vista);
  assert.deepEqual(llamadas, [['a', null]]);
});

test('sin ofertas en ningún grupo propone recursos abiertos de Faro en lugar de un callejón sin salida', () => {
  prepararDom();
  for (const idioma of ['es', 'ca'] as const) {
    fijarIdioma(idioma);
    const llamadas: (string | null)[][] = [];
    const vista = crearPropuesta({ opciones: { ia: [], digital: [] } } as unknown as SeleccionFormacion, {
      ...sinAcciones,
      alConfirmar: (a, b) => llamadas.push([a, b]),
    });
    const bloque = vista.querySelector('.rc-hoja-mientras');
    assert.ok(bloque);
    assert.match(bloque.textContent ?? '', idioma === 'ca' ? /Mentrestant/u : /Mientras tanto/u);
    const destinos = [...bloque.querySelectorAll('a')].map((a) => a.href);
    assert.deepEqual(destinos, ['entender-ia.html', 'entender-ia.html#desafio', 'biblioteca.html']);
    pulsar(vista);
    assert.deepEqual(llamadas, [[null, null]]);
  }
});

test('la fila es compacta y legible: datos clave a la vista, lo demás en «Ver detalles», y lo que no consta se dice', () => {
  prepararDom();
  fijarIdioma('es');
  const conDatos = opcion('ia', 'a', {
    horas_publicadas: 4,
    modalidad: 'en-linea',
    idiomas_declarados: ['ca'],
    sincronia: 'asincrona',
    certificado_gratuito: true,
  });
  const sinDatos = opcion('digital', 'b');
  const vista = crearPropuesta({ opciones: { ia: [conDatos], digital: [sinDatos] } } as unknown as SeleccionFormacion, {
    ...sinAcciones,
    alConfirmar: () => {},
  });
  document.body.append(vista);
  const [primera, segunda] = [...vista.querySelectorAll('.rc-hoja-curso')];
  assert.ok(primera && segunda);
  const resumen = primera.querySelector('.rc-curso-resumen')?.textContent ?? '';
  assert.equal(resumen, 'Proveedor · Duración: 4 h publicadas · Modalidad: En línea · Idioma: catalán');
  assert.equal(
    primera.querySelector('label span')?.getAttribute('lang'),
    'ca',
    'El título oficial se lee en su idioma',
  );
  const detalles = primera.querySelector('details');
  assert.ok(detalles);
  assert.match(detalles.querySelector('summary')?.textContent ?? '', /Ver detalles/u);
  assert.match(detalles.textContent ?? '', /Ritmo: A tu ritmo/u);
  assert.match(detalles.textContent ?? '', /Certificado: Gratuito según la ficha publicada/u);
  assert.match(
    segunda.querySelector('.rc-curso-resumen')?.textContent ?? '',
    /Duración: No consta.*Idioma: por confirmar/u,
  );
  assert.equal(segunda.querySelector('label span')?.getAttribute('lang') ?? null, null);
  fijarIdioma('ca');
  reescribirTextos();
  assert.equal(
    primera.querySelector('.rc-curso-resumen')?.textContent,
    'Proveedor · Durada: 4 h publicades · Modalitat: En línia · Idioma: català',
  );
});

test('la elección muestra el nivel y su origen fuera de detalles en ambos idiomas', () => {
  prepararDom();
  const catalogo = JSON.parse(
    readFileSync(new URL('../fixtures/catalogo-clasificacion-20261025.utf8', import.meta.url), 'utf8'),
  );
  const conocida = (catalogo.ofertas as OfertaCatalogo[]).find(
    (oferta) => metadatosClasificados(oferta).nivel.valor !== null,
  );
  assert.ok(conocida);
  fijarIdioma('es');
  const vista = crearPropuesta(
    {
      opciones: { ia: [opcion('ia', 'a')], digital: [{ ...opcion('digital', 'b'), oferta: conocida }] },
    } as unknown as SeleccionFormacion,
    { ...sinAcciones, alConfirmar: () => {} },
  );
  document.body.append(vista);
  const [sinNivel, conNivel] = [...vista.querySelectorAll('.rc-hoja-curso')];
  assert.ok(sinNivel && conNivel);
  assert.match(
    sinNivel.querySelector('.rc-curso-nivel')?.textContent ?? '',
    /El nivel está por confirmar\. Consulta los requisitos antes de elegir este curso\./u,
  );
  assert.equal(sinNivel.querySelector('details .rc-curso-nivel'), null);
  assert.match(
    conNivel.querySelector('.rc-curso-nivel')?.textContent ?? '',
    /Nivel: (Inicial|Intermedio|Avanzado) · (publicado|orientación|extracto)/u,
  );
  fijarIdioma('ca');
  reescribirTextos();
  assert.match(
    sinNivel.querySelector('.rc-curso-nivel')?.textContent ?? '',
    /El nivell està per confirmar\. Consulta els requisits abans de triar aquest curs\./u,
  );
  assert.match(
    conNivel.querySelector('.rc-curso-nivel')?.textContent ?? '',
    /Nivell: (Inicial|Intermedi|Avançat) · (publicat|orientació|extracte)/u,
  );
});

test('cada propuesta conserva identificadores propios cuando las anteriores siguen en el chat', () => {
  prepararDom();
  fijarIdioma('es');
  const seleccion = {
    opciones: { ia: [opcion('ia', 'a')], digital: [opcion('digital', 'b')] },
  } as unknown as SeleccionFormacion;
  const acciones = { ...sinAcciones, alConfirmar: () => {} };
  const primera = crearPropuesta(seleccion, acciones);
  const segunda = crearPropuesta(seleccion, acciones);
  const a = [...primera.querySelectorAll('input')].map((i) => i.id);
  const b = [...segunda.querySelectorAll('input')].map((i) => i.id);
  assert.ok(a.every((id) => !b.includes(id)));
});

test('enseña el aviso de horarios al elegir ambos cursos y lo actualiza al cambiar una elección', () => {
  prepararDom();
  fijarIdioma('es');
  const seleccion = {
    opciones: { ia: [opcion('ia', 'a')], digital: [opcion('digital', 'b'), opcion('digital', 'c')] },
  } as unknown as SeleccionFormacion;
  const vista = crearPropuesta(seleccion, {
    ...sinAcciones,
    alConfirmar: () => {},
    avisoHorarios: (ia: string, digital: string) => {
      const nodo = document.createElement('p');
      nodo.textContent = `Horarios ${ia} ${digital}`;
      return nodo;
    },
  });
  elegir(vista, '-ia', 'a');
  assert.doesNotMatch(vista.textContent ?? '', /Horarios a b/u);
  elegir(vista, '-digital', 'b');
  assert.match(vista.textContent ?? '', /Horarios a b/u);
  elegir(vista, '-digital', 'c');
  assert.match(vista.textContent ?? '', /Horarios a c/u);
  assert.doesNotMatch(vista.textContent ?? '', /Horarios a b/u);
  elegir(vista, '-digital', '');
  assert.doesNotMatch(vista.textContent ?? '', /Horarios/u);
});

test('los detalles de un curso dicen con frases lo que no consta de él', () => {
  prepararDom();
  fijarIdioma('es');
  const sinDatos = opcion('digital', 'b');
  const vista = crearPropuesta({ opciones: { ia: [], digital: [sinDatos] } } as unknown as SeleccionFormacion, {
    ...sinAcciones,
    alConfirmar: () => {},
  });
  document.body.append(vista);
  const detalles = vista.querySelector('.rc-hoja-curso details')?.textContent ?? '';
  assert.match(detalles, /No consta si este curso pide registrarse\./u);
  assert.match(detalles, /No consta en qué idioma se imparte este curso\./u);
});
