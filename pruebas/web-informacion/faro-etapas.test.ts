// Pestañas, enlaces, citas, controles y textos ES/CA de «Qué es Faro».
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import ca from '../../web/idiomas/ca.js';
import es from '../../web/idiomas/es.js';
import { registrarDiccionario } from '../../web/scripts/textos.js';
import { entradaConSri } from '../ayudas/web-construida.ts';
import { abrirEtapas, Pieza } from './etapas-doble.ts';

const WEB = new URL('../../web/', import.meta.url);
const PAGINA = readFileSync(new URL('que-es-faro.html', WEB), 'utf8');
const ETAPAS = new URL('../../web/scripts/etapas.js', import.meta.url);
/** Las pestañas: su id y su nombre en castellano y en catalán. */
const PESTANAS = [
  ['que-es', 'Qué es Faro', 'Què és Faro'],
  ['como-funciona', 'Cómo funciona', 'Com funciona'],
  ['tus-datos', 'Tu privacidad', 'La teva privadesa'],
  ['conectividad', 'Conectividad', 'Connectivitat'],
] as const;
/** Los fragmentos que se enlazaban antes de esta versión y la pestaña que abren ahora. */
const FRAGMENTOS_ANTIGUOS = [
  ['#que-es', 'que-es'],
  ['#como-funciona', 'como-funciona'],
  ['#tus-datos', 'tus-datos'],
  ['#resultados', 'como-funciona'],
  ['#estado', 'como-funciona'],
  ['#t-estado', 'como-funciona'],
  ['#alcance', 'como-funciona'],
  ['#ref-3', 'como-funciona'],
] as const;
/** Expresiones que no deben aparecer como promesas en la web pública. */
const RETIRADO = [
  /Qué funciona y qué falta/,
  /Què funciona i què falta/,
  />\s*(?:Todavía no|Encara no)\s*</,
  /código abierto/i,
  /codi obert/i,
];
/** La extensión de la página, en palabras de <main>: de 1.200 a 1.600 de lectura, más pestañas, controles y referencias. */
const REFERENCIAS = 5;
const MINIMO_TEXTOS = 15;
const PALABRAS = { minimo: 250, maximo: 950 } as const;
const posicion = (id: string) => PESTANAS.findIndex(([otro]) => otro === id);

registrarDiccionario('es', es);
registrarDiccionario('ca', ca);

let instancia = 0;
const cargar = () => import(`${ETAPAS.href}?faro=${++instancia}`);
type Pagina = ReturnType<typeof abrirEtapas>;
/** La posición de la pestaña visible, comprobando que hay una sola. */
function actual({ etapas }: Pagina): number {
  const visibles = etapas.flatMap((etapa, indice) => (etapa.classList.contains('etapa--actual') ? [indice] : []));
  assert.equal(visibles.length, 1);
  return visibles[0] ?? -1;
}

test('cuatro pestañas en orden, con su nombre en castellano y en catalán y sus propias líneas de estado', (t) => {
  const { etapas, enlaces, contenedor, raiz } = abrirEtapas(t, PAGINA);
  assert.deepEqual(
    etapas.map((etapa) => etapa.id),
    PESTANAS.map(([id]) => id),
  );
  assert.deepEqual(
    enlaces.map((enlace) => [enlace.getAttribute('href'), enlace.querySelector('.etapas-nombre')?.dataset.texto]),
    PESTANAS.map(([id], indice) => [`#${id}`, `que-es-faro.etapa.${indice + 1}`]),
  );
  for (const [indice, [, nombreEs, nombreCa]] of PESTANAS.entries()) {
    assert.equal(es[`que-es-faro.etapa.${indice + 1}`], nombreEs);
    assert.equal(ca[`que-es-faro.etapa.${indice + 1}`], nombreCa);
  }
  for (const atributo of ['data-etapas-clave-paso', 'data-etapas-clave-rotulo']) {
    const clave = contenedor.getAttribute(atributo) ?? '';
    assert.ok(es[clave] && ca[clave], atributo);
  }
  for (const etapa of etapas) {
    assert.ok(etapa.querySelector('h2'), `#${etapa.id} empieza por su título`);
  }
  const cabecera = raiz.querySelector('.seccion-cabecera') as Pieza;
  assert.ok(!contenedor.contains(cabecera), 'la cabecera queda fuera de las pestañas');
  assert.equal(cabecera.querySelector('h1')?.dataset.texto, 'comun.titulo.faro');
  assert.equal(cabecera.querySelector('.entradilla')?.dataset.texto, 'que-es-faro.intro');
  assert.match(PAGINA, /<link rel="stylesheet" href="estilos\/etapas\.css" \/>/);
  assert.match(PAGINA, /<link rel="stylesheet" href="estilos\/que-es-faro\.css" \/>/);
  assert.match(PAGINA, /<script\s+type="module"\s+src="scripts\/etapas\.js"\s*><\/script>/);
  assert.ok(entradaConSri('que-es-faro.html'));
});

test('los fragmentos antiguos siguen existiendo, una sola vez, en la pestaña equivalente; las citas llevan a su referencia', (t) => {
  const { raiz, porId } = abrirEtapas(t, PAGINA);
  const ids = (raiz.querySelectorAll('[id]') as Pieza[]).map((pieza) => pieza.id);
  assert.equal(new Set(ids).size, ids.length, 'sin ids repetidos');
  for (const [fragmento, pestana] of FRAGMENTOS_ANTIGUOS) {
    const destino = porId(fragmento.slice(1));
    assert.ok(destino, fragmento);
    assert.ok(porId(pestana).contains(destino), `${fragmento} está en #${pestana}`);
  }
  const citas = (raiz.querySelectorAll('[data-etapa] sup a') as Pieza[]).map((cita) => cita.getAttribute('href'));
  assert.deepEqual(citas, []);
  for (let indice = 1; indice <= REFERENCIAS; indice++) {
    const referencia = porId(`ref-${indice}`);
    assert.equal(referencia.tagName, 'LI');
    assert.equal(referencia.dataset.texto, `que-es-faro.referencia.${indice}`);
    assert.ok(porId('como-funciona').contains(referencia));
  }
});

test('los controles llevan a la pestaña siguiente y a la anterior; la última termina en «Empezar», también sin JS', (t) => {
  const { etapas } = abrirEtapas(t, PAGINA);
  const ultima = etapas.length - 1;
  for (const [indice, etapa] of etapas.entries()) {
    const enlaces = etapa.querySelector('[data-etapas-controles]')?.querySelectorAll('a') ?? [];
    const siguiente = enlaces.find((enlace) => enlace.classList.contains('etapas-siguiente'));
    const anterior = enlaces.find((enlace) => enlace.classList.contains('etapas-anterior'));
    if (indice < ultima) {
      assert.equal(siguiente?.getAttribute('href'), `#${PESTANAS[indice + 1]?.[0]}`);
      assert.equal(
        siguiente?.querySelector('.etapas-siguiente-nombre')?.dataset.texto,
        `que-es-faro.etapa.${indice + 2}`,
      );
      assert.deepEqual(
        siguiente?.querySelector('.etapas-siguiente-rotulo')?.children.map((cifra) => cifra.textContent),
        [String(indice + 2), String(etapas.length)],
      );
    } else {
      assert.equal(siguiente, undefined, 'la última no repite «Empezar»');
    }
    assert.equal(anterior?.getAttribute('href'), indice > 0 ? `#${PESTANAS[indice - 1]?.[0]}` : undefined);
  }
  const final = etapas[ultima]?.querySelector('.seccion-siguiente');
  assert.equal(final?.querySelector('.boton-empezar')?.getAttribute('href'), 'recorrido.html');
  assert.equal(final?.querySelector('strong')?.dataset.texto, 'que-es-faro.siguiente');
  assert.equal(final?.closest('[data-etapas-controles]') ?? null, null, 'visible sin JavaScript');
});

test('cada fragmento, nuevo o antiguo, abre su pestaña y lleva a su destino', async (t) => {
  const pagina = abrirEtapas(t, PAGINA);
  await cargar();
  assert.equal(actual(pagina), 0, 'sin fragmento, la primera');
  assert.deepEqual(Pieza.desplazadas, []);
  for (const [fragmento, pestana] of [
    ...FRAGMENTOS_ANTIGUOS,
    ['#fuentes', 'como-funciona'],
    ['#todo-faro', 'que-es'],
    ['#conectividad', 'conectividad'],
  ]) {
    const abierta = abrirEtapas(t, PAGINA, fragmento);
    await cargar();
    assert.equal(actual(abierta), posicion(pestana), fragmento);
    const destino = abierta.porId(fragmento.slice(1));
    const esperado = destino.hasAttribute('data-etapa') ? abierta.contenedor : destino;
    assert.deepEqual(Pieza.desplazadas, [esperado], fragmento);
  }
});

test('el enlace a «Cómo funciona» abre la segunda pestaña desde su principio', async (t) => {
  const pagina = abrirEtapas(t, PAGINA);
  await cargar();
  pagina.navegar('#como-funciona');
  assert.equal(actual(pagina), posicion('como-funciona'));
  assert.equal(Pieza.enfocado?.pieza, pagina.porId('como-funciona').querySelector('h2'));
});

test('el HTML dice lo mismo que el diccionario castellano, y el catalán tiene cada texto con sus marcadores', (t) => {
  const { raiz } = abrirEtapas(t, PAGINA);
  const normal = (texto: string) => texto.replace(/\s+/g, ' ').trim();
  const conTexto = (raiz.querySelectorAll('[data-texto]') as Pieza[]).filter((pieza) =>
    String(pieza.dataset.texto).startsWith('que-es-faro.'),
  );
  assert.ok(conTexto.length > MINIMO_TEXTOS);
  for (const pieza of conTexto) {
    const clave = String(pieza.dataset.texto);
    const original = es[clave];
    assert.ok(original && ca[clave], clave);
    const esperado = original.replace(/\{(\d)\}/g, (_, n) => pieza.children[Number(n)]?.textContent ?? '');
    assert.equal(normal(pieza.textContent), normal(esperado), clave);
    assert.deepEqual(ca[clave].match(/\{\d\}/g), original.match(/\{\d\}/g), clave);
  }
});

test('la página cuenta lo que hace con una extensión de lectura, sin promesas ni la lista de carencias', (t) => {
  const { raiz } = abrirEtapas(t, PAGINA);
  const principal = raiz.querySelector('main') as Pieza;
  const texto = principal.textContent.replace(/\s+/g, ' ');
  const palabras = texto.split(/\s+/).filter((palabra) => /[\p{L}\d]/u.test(palabra)).length;
  assert.ok(
    palabras >= PALABRAS.minimo && palabras <= PALABRAS.maximo,
    `${palabras} palabras, con navegación y referencias`,
  );
  for (const prohibida of [/mejorar[áa] tu empleabilidad/i, /garantiza/i, /riesgo (?:bajo|m[ií]nimo)/i]) {
    assert.doesNotMatch(texto, prohibida);
  }
  assert.match(texto, /no predicen tu futuro/);
  assert.match(texto, /no evalúa a las personas/i);
});

test('ni la web pública ni sus diccionarios llevan «Qué funciona y qué falta», «Todavía no» ni la promesa de código abierto', () => {
  const paginas = readdirSync(WEB).filter((archivo) => archivo.endsWith('.html'));
  assert.ok(paginas.includes('que-es-faro.html'));
  for (const archivo of paginas) {
    const html = readFileSync(new URL(archivo, WEB), 'utf8');
    for (const patron of RETIRADO) {
      assert.doesNotMatch(html, patron, archivo);
    }
  }
  for (const [lengua, diccionario] of [
    ['es', es],
    ['ca', ca],
  ] as const) {
    const textos = Object.values(diccionario).join('\n');
    for (const patron of RETIRADO) {
      assert.doesNotMatch(textos, patron, lengua);
    }
    assert.ok(!Object.keys(diccionario).some((clave) => clave.startsWith('como-funciona.estado.')), lengua);
  }
});
