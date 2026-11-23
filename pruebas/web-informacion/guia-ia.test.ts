// La guía «Qué es la IA»: el desafío (scripts/desafio-ia.js), el glosario por temas (scripts/glosario.js) y sus textos
// en castellano y catalán. Se prueban con la página real convertida al doble de etapas-doble.ts; sitio.js no se carga.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { after, type TestContext, test } from 'node:test';
import ca from '../../web/idiomas/ca.js';
import es from '../../web/idiomas/es.js';
import { fijarIdioma, registrarDiccionario } from '../../web/scripts/textos.js';
import { navegador } from '../web-controles/ayudas.js';
import { abrirEtapas, Pieza } from './etapas-doble.ts';

const WEB = new URL('../../web/', import.meta.url);
const PAGINA = readFileSync(new URL('entender-ia.html', WEB), 'utf8');
const DESAFIO = new URL('scripts/desafio-ia.js', WEB);
const GLOSARIO = new URL('scripts/glosario.js', WEB);
const SITIO = new URL('scripts/sitio.js', WEB);
const hooks = registerHooks({
  load(url, contexto, siguiente) {
    if (url === SITIO.href) {
      return { format: 'module', source: '', shortCircuit: true };
    }
    return siguiente(url, contexto);
  },
});
after(() => hooks.deregister());
registrarDiccionario('es', es);
registrarDiccionario('ca', ca);
/** idioma.js lee la página al cargarse: se importa cuando el doble ya está montado. */
const idioma = () => import('../../web/scripts/idioma.js');
const { PaginaIncompleta } = await import('../../web/scripts/dom.js');

/** Las doce respuestas correctas, en el orden del HTML. */
const CORRECTAS = ['a', 'b', 'c', 'a', 'c', 'b', 'a', 'c', 'b', 'c', 'a', 'b'];
/** Las partes de la guía que se pueden recomendar releer. */
const PARTES = ['paso-1', 'paso-2', 'paso-3', 'paso-4', 'paso-5', 'glosario'];
const TOTAL = CORRECTAS.length;
/** Las letras de las opciones de cada situación. */
const LETRAS = ['a', 'b', 'c'];
/** Los términos del glosario. */
const TERMINOS = 28;
/** Los términos de la jerga de la IA que el glosario debe tener. */
const IMPRESCINDIBLES = [
  'ia',
  'generativa',
  'sistema',
  'algoritmo',
  'modelo',
  'aprendizaje',
  'profundo',
  'red',
  'lenguaje',
  'entrenamiento',
  'datos-entrenamiento',
  'token',
  'contexto',
  'parametros',
  'fecha-corte',
  'multimodal',
  'instruccion',
  'respuesta',
  'asistente',
  'agente',
  'alucinacion',
  'sesgo',
  'deepfake',
  'decision',
  'supervision',
  'alfabetizacion',
  'uso-general',
  'reglamento',
];
/** Palabras comunes que no son jerga de la IA: no van en el glosario. */
const COMUNES = ['borrador', 'datos', 'patron', 'prediccion', 'transparencia', 'privacidad', 'automatizacion'];
/** Las referencias de la guía. */
const REFERENCIAS = 8;
/** Partidas de prueba, una letra por pregunta: «x», se falla; «·», se acierta. */
const FALLOS_UNA_POR_PARTE = '·x······x··x';
const FALLOS_DE_DOS_PARTES = 'xxxx········';
const FALLOS_DOS = 'x···x·······';
const FALLO_UNO = '··x·········';
/** Si la pregunta de esa posición se falla en la partida. */
const seFalla = (partida: string, posicion: number) => partida[posicion] === 'x';

let instancia = 0;
/** Lo que el desafío ha tocado de almacenamiento o cookies: debe quedar vacío. */
let accesos: string[] = [];

/** La página en el doble, con almacenamiento y cookies vigilados, y el desafío cargado. */
async function abrirDesafio(t: TestContext, html = PAGINA) {
  fijarIdioma('es');
  const pagina = abrirEtapas(t, html);
  accesos = [];
  const vigilado = (nombre: string) =>
    new Proxy(
      {},
      {
        get: (_, propiedad) => {
          accesos.push(`${nombre}.${String(propiedad)}`);
          return () => null;
        },
      },
    );
  const documento = globalThis.document;
  Object.defineProperty(documento, 'cookie', {
    configurable: true,
    get: () => {
      accesos.push('cookie');
      return '';
    },
    set: () => accesos.push('cookie='),
  });
  navegador(t, {
    localStorage: vigilado('localStorage'),
    sessionStorage: vigilado('sessionStorage'),
    indexedDB: vigilado('indexedDB'),
  });
  await import(`${DESAFIO.href}?guia=${++instancia}`);
  const juego = pagina.raiz.querySelector('[data-desafio-juego]') as Pieza;
  const lista = pagina.raiz.querySelector('[data-desafio-lista]') as Pieza;
  const de = (selector: string) => juego.querySelector(selector) as Pieza;
  return {
    pagina,
    juego,
    lista,
    de,
    botones: () => juego.querySelectorAll('.desafio-opcion') as Pieza[],
    boton: (letra: string) => juego.querySelector(`.desafio-opcion[data-opcion="${letra}"]`) as Pieza,
    siguiente: () => juego.querySelectorAll('.boton-accion')[0] as Pieza,
    repetir: () => juego.querySelectorAll('.boton-accion')[1] as Pieza,
  };
}
type Desafio = Awaited<ReturnType<typeof abrirDesafio>>;
const pulsar = (pieza: Pieza | undefined) => pieza?.dispatchEvent(new Event('click', { cancelable: true }));
const otraLetra = (letra: string) => (letra === 'a' ? 'b' : 'a');

/** Responde todas las preguntas: bien salvo las que la partida marca con «x». */
function jugar(desafio: Desafio, partida = '') {
  for (const [posicion, correcta] of CORRECTAS.entries()) {
    pulsar(desafio.boton(seFalla(partida, posicion) ? otraLetra(correcta) : correcta));
    pulsar(desafio.siguiente());
  }
}

test('el HTML trae doce situaciones con tres opciones, una sola correcta, su porqué y la parte que repasar', () => {
  const pagina = PAGINA;
  const situaciones = [...pagina.matchAll(/<li\s+class="desafio-situacion"[\s\S]*?<\/details>/g)].map(
    ([trozo]) => trozo,
  );
  assert.equal(situaciones.length, TOTAL);
  for (const [posicion, trozo] of situaciones.entries()) {
    const numero = posicion + 1;
    assert.deepEqual(
      [...trozo.matchAll(/data-opcion="(\w)"/g)].map(([, letra]) => letra),
      ['a', 'b', 'c'],
      `${numero}`,
    );
    assert.deepEqual(
      [...trozo.matchAll(/data-opcion="(\w)"\s+data-correcta/g)].map(([, letra]) => letra),
      [CORRECTAS[posicion]],
    );
    // En la versión sin JavaScript, «Correcto.» va en el porqué de la misma opción.
    const veredictos = [...trozo.matchAll(/data-texto="entender-ia\.desafio\.(correcto|incorrecto)"/g)].map(
      ([, v]) => v,
    );
    assert.deepEqual(
      veredictos,
      ['a', 'b', 'c'].map((letra) => (letra === CORRECTAS[posicion] ? 'correcto' : 'incorrecto')),
    );
    const repaso = trozo.match(/data-repaso="([\w-]+)"/)?.[1];
    assert.ok(repaso && PARTES.includes(repaso), `${numero}: ${repaso}`);
  }
  // Las respuestas correctas no siguen un patrón: hay tantas «a» como «b» y «c».
  for (const letra of ['a', 'b', 'c']) {
    assert.equal(CORRECTAS.filter((correcta) => correcta === letra).length, TOTAL / LETRAS.length);
  }
  assert.match(
    pagina,
    /<details>\s*<summary data-texto="entender-ia\.desafio\.ver-respuesta"/,
    'sin JavaScript, se lee',
  );
  assert.match(pagina, /<noscript[\s>]/);
});

test('con JavaScript, el desafío sustituye a la lista: un fieldset con botones, la pregunta 1 y nada respondido', async (t) => {
  const { juego, lista, de, botones, siguiente } = await abrirDesafio(t);
  assert.equal(lista.hidden, true);
  assert.equal(juego.hidden, false);
  assert.equal(de('.desafio-progreso').textContent, 'Pregunta 1 de 12');
  assert.equal(de('fieldset legend h3').textContent, es['entender-ia.desafio.1.pregunta']);
  assert.deepEqual(
    botones().map((boton) => [boton.tagName, (boton as unknown as { type: string }).type, boton.textContent]),
    ['a', 'b', 'c'].map((letra) => ['BUTTON', 'button', es[`entender-ia.desafio.1.${letra}`]]),
  );
  assert.equal(de('.desafio-explicacion').getAttribute('aria-live'), 'polite');
  assert.equal(de('.desafio-explicacion').children.length, 0);
  assert.equal(siguiente().hidden, true);
});

test('al acertar, la opción se pinta en verde con ✓, se explica por qué y las opciones quedan bloqueadas', async (t) => {
  const { de, boton, botones, siguiente } = await abrirDesafio(t);
  pulsar(boton('a'));
  assert.ok(boton('a').classList.contains('es-correcta'));
  assert.equal(boton('a').querySelector('.desafio-marca')?.textContent, '✓');
  assert.equal(boton('a').querySelector('.desafio-marca')?.getAttribute('aria-hidden'), 'true');
  assert.deepEqual(
    boton('a')
      .querySelectorAll('.solo-lectores')
      .map((pieza) => pieza.textContent),
    ['Correcta', 'Tu respuesta'],
  );
  assert.ok(botones().every((otro) => otro.getAttribute('aria-disabled') === 'true'));
  assert.ok(!boton('b').classList.contains('es-incorrecta') && !boton('b').querySelector('.desafio-marca'));
  const explicacion = de('.desafio-explicacion p');
  assert.ok(explicacion.classList.contains('es-correcta'));
  assert.equal(explicacion.textContent, `Correcto. ${es['entender-ia.desafio.1.a.porque']}`);
  assert.equal(siguiente().hidden, false);
  assert.equal(siguiente().textContent, 'Siguiente pregunta');
  // Bloqueadas: tocar otra no cambia nada.
  pulsar(boton('b'));
  assert.ok(!boton('b').classList.contains('es-incorrecta'));
  assert.equal(de('.desafio-explicacion p').textContent, `Correcto. ${es['entender-ia.desafio.1.a.porque']}`);
});

test('al fallar, la elegida se pinta en rojo con ✗ y la correcta en verde con ✓, con su palabra para lectores', async (t) => {
  const { de, boton } = await abrirDesafio(t);
  pulsar(boton('b'));
  assert.ok(boton('b').classList.contains('es-incorrecta'));
  assert.equal(boton('b').querySelector('.desafio-marca')?.textContent, '✗');
  assert.deepEqual(
    boton('b')
      .querySelectorAll('.solo-lectores')
      .map((pieza) => pieza.textContent),
    ['Incorrecta', 'Tu respuesta'],
  );
  assert.ok(boton('a').classList.contains('es-correcta'));
  assert.deepEqual(
    boton('a')
      .querySelectorAll('.solo-lectores')
      .map((pieza) => pieza.textContent),
    ['Correcta'],
  );
  assert.ok(!boton('c').classList.contains('es-correcta') && !boton('c').classList.contains('es-incorrecta'));
  const explicacion = de('.desafio-explicacion p');
  assert.ok(explicacion.classList.contains('es-incorrecta'));
  assert.equal(explicacion.textContent, `No es correcto. ${es['entender-ia.desafio.1.b.porque']}`);
});

test('«Siguiente pregunta» solo avanza tras responder, lleva el foco al enunciado sin saltos y la región se conserva', async (t) => {
  const { de, boton, siguiente } = await abrirDesafio(t);
  const region = de('.desafio-explicacion');
  pulsar(siguiente());
  assert.equal(de('.desafio-progreso').textContent, 'Pregunta 1 de 12', 'sin responder no se avanza');
  pulsar(boton('a'));
  pulsar(siguiente());
  assert.equal(de('.desafio-progreso').textContent, 'Pregunta 2 de 12');
  assert.equal(de('fieldset legend h3').textContent, es['entender-ia.desafio.2.pregunta']);
  assert.equal(Pieza.enfocado?.pieza, de('fieldset legend h3'));
  assert.deepEqual(Pieza.enfocado?.opciones, { preventScroll: true });
  assert.equal(de('.desafio-explicacion'), region, 'la región aria-live es la misma de antes');
  assert.equal(region.children.length, 0);
  assert.equal(siguiente().hidden, true);
});

test('al final: «N de 12», qué releer con su enlace y cuántas preguntas; el foco va al resultado', async (t) => {
  const desafio = await abrirDesafio(t);
  for (const [posicion, correcta] of CORRECTAS.entries()) {
    pulsar(desafio.boton(seFalla(FALLOS_UNA_POR_PARTE, posicion) ? otraLetra(correcta) : correcta));
    if (posicion === TOTAL - 1) {
      assert.equal(desafio.siguiente().textContent, 'Ver el resultado');
    }
    pulsar(desafio.siguiente());
  }
  const resultado = desafio.de('.desafio-resultado');
  assert.equal(resultado.hidden, false);
  assert.equal(desafio.de('.desafio-pregunta').hidden, true);
  assert.equal(desafio.de('.desafio-cifra').textContent, '9 de 12');
  assert.equal(desafio.de('.desafio-valoracion').textContent, es['entender-ia.desafio.bien']);
  const filas = desafio.de('.desafio-repaso').children;
  assert.deepEqual(
    filas.map((fila) => {
      const enlace = fila.querySelector('a') as Pieza & { href?: string };
      return [enlace.href, fila.textContent];
    }),
    [
      ['#paso-1', `${es['entender-ia.etapa.1']} (1 pregunta)`],
      ['#paso-4', `${es['entender-ia.etapa.4']} (1 pregunta)`],
      ['#glosario', `${es['entender-ia.etapa.6']} (1 pregunta)`],
    ],
  );
  assert.equal(Pieza.enfocado?.pieza, resultado);
});

test('el recuento agrupa las preguntas de una misma parte y cambia la valoración', async (t) => {
  const desafio = await abrirDesafio(t);
  jugar(desafio, FALLOS_DE_DOS_PARTES);
  assert.equal(desafio.de('.desafio-cifra').textContent, '8 de 12');
  assert.equal(desafio.de('.desafio-valoracion').textContent, es['entender-ia.desafio.repasar']);
  assert.deepEqual(
    desafio.de('.desafio-repaso').children.map((fila) => fila.textContent),
    [`${es['entender-ia.etapa.1']} (3 preguntas)`, `${es['entender-ia.etapa.2']} (1 pregunta)`],
  );
});

test('«Volver a empezar» reinicia: pregunta 1, sin aciertos ni fallos; y con todas bien no hay nada que releer', async (t) => {
  const desafio = await abrirDesafio(t);
  jugar(desafio, FALLOS_DOS);
  assert.equal(desafio.de('.desafio-cifra').textContent, '10 de 12');
  pulsar(desafio.repetir());
  assert.equal(desafio.de('.desafio-resultado').hidden, true);
  assert.equal(desafio.de('.desafio-pregunta').hidden, false);
  assert.equal(desafio.de('.desafio-progreso').textContent, 'Pregunta 1 de 12');
  assert.ok(desafio.botones().every((boton) => !boton.hasAttribute('aria-disabled')));
  assert.equal(Pieza.enfocado?.pieza, desafio.de('fieldset legend h3'));
  jugar(desafio);
  assert.equal(desafio.de('.desafio-cifra').textContent, '12 de 12');
  assert.equal(desafio.de('.desafio-valoracion').textContent, es['entender-ia.desafio.todas']);
  assert.equal(desafio.de('.desafio-repaso').children.length, 0);
  assert.equal(desafio.de('.desafio-repaso').hidden, true);
});

test('no guarda nada: ni localStorage, ni sessionStorage, ni IndexedDB, ni cookies, ni red', async (t) => {
  const desafio = await abrirDesafio(t);
  jugar(desafio, FALLO_UNO);
  pulsar(desafio.repetir());
  jugar(desafio);
  assert.deepEqual(accesos, []);
  const codigo = readFileSync(DESAFIO, 'utf8').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(
    codigo,
    /localStorage|sessionStorage|indexedDB|cookie|fetch\(|XMLHttpRequest|sendBeacon|setTimeout|setInterval/,
  );
});

test('el desafío ya pintado cambia de idioma con la página', async (t) => {
  const desafio = await abrirDesafio(t);
  pulsar(desafio.boton('c'));
  fijarIdioma('ca');
  (await idioma()).reescribirTextos();
  assert.equal(desafio.de('.desafio-progreso').textContent, 'Pregunta 1 de 12');
  assert.equal(desafio.de('fieldset legend h3').textContent, ca['entender-ia.desafio.1.pregunta']);
  assert.equal(
    desafio.de('.desafio-explicacion p').textContent,
    `No és correcte. ${ca['entender-ia.desafio.1.c.porque']}`,
  );
  assert.equal(desafio.siguiente().textContent, ca['entender-ia.desafio.siguiente']);
  fijarIdioma('es');
});

test('una situación sin respuesta correcta no cumple el contrato: falla y la lista se queda', async (t) => {
  const roto = PAGINA.replace(/data-opcion="a" data-correcta/, 'data-opcion="a"');
  fijarIdioma('es');
  const pagina = abrirEtapas(t, roto);
  await assert.rejects(import(`${DESAFIO.href}?guia=${++instancia}`), PaginaIncompleta);
  assert.equal((pagina.raiz.querySelector('[data-desafio-lista]') as Pieza).hidden, false);
  assert.equal((pagina.raiz.querySelector('[data-desafio-juego]') as Pieza).hidden, true);
});

// ---------- Glosario ----------

/** Los términos del glosario, tal como se leen, en el orden de la página. */
const terminos = (raiz: Pieza) =>
  (raiz.querySelector('[data-glosario]') as Pieza).children.map(
    (entrada) => entrada.querySelector('dt')?.textContent ?? '',
  );
/** Los id de las entradas, en el orden de la página. */
const idsDe = (raiz: Pieza) => (raiz.querySelector('[data-glosario]') as Pieza).children.map((entrada) => entrada.id);

test('el glosario es una pestaña con una sola lista de 28 términos de la jerga de la IA, sin grupos', (t) => {
  const { raiz, porId } = abrirEtapas(t, PAGINA);
  const glosario = porId('glosario');
  assert.ok(glosario.hasAttribute('data-etapa'));
  assert.equal(glosario.querySelectorAll('[data-glosario]').length, 1);
  assert.equal(glosario.querySelectorAll('.glosario-indice, .glosario-tema').length, 0, 'sin índice ni temas');
  const entradas = idsDe(raiz);
  assert.equal(entradas.length, TERMINOS);
  for (const id of IMPRESCINDIBLES) {
    assert.ok(entradas.includes(`termino-${id}`), id);
  }
  // Fuera las palabras comunes: solo jerga de la IA.
  for (const comun of COMUNES) {
    assert.ok(!entradas.includes(`termino-${comun}`), comun);
  }
  assert.equal(es['entender-ia.glosario.contexto.termino'], 'Contexto (ventana de contexto)');
  for (const entrada of glosario.querySelectorAll('.glosario-entrada')) {
    const claves = entrada.querySelectorAll('dd p').map((parrafo) => parrafo.dataset.texto ?? '');
    assert.match(claves[0] ?? '', /\.definicion$/, entrada.id);
    assert.match(claves[1] ?? '', /\.ejemplo$/, entrada.id);
    assert.ok(es[claves[1] ?? '']?.startsWith('Ejemplo: '), entrada.id);
    assert.ok(ca[claves[1] ?? '']?.startsWith('Exemple: '), entrada.id);
    const explicado = entrada.querySelector('.glosario-explicado a');
    if (explicado) {
      assert.match(explicado.getAttribute('href') ?? '', /^#paso-[1-5]$/, entrada.id);
    }
  }
  // El inglés, marcado con su idioma, como se oye.
  const ingles = glosario.querySelectorAll('dt [lang="en"], dt[lang="en"]').map((pieza) => pieza.textContent);
  assert.deepEqual(ingles.sort(), [
    'AI Act',
    'Deepfake',
    'LLM',
    'Output',
    'Prompt',
    'chatbot',
    'deep learning',
    'knowledge cutoff',
    'machine learning',
  ]);
});

test('en castellano el HTML ya está en orden alfabético; en catalán se reordena con el orden alfabético catalán', async (t) => {
  const { raiz } = abrirEtapas(t, PAGINA);
  const ordenado = (lista: string[], idioma: string) =>
    [...lista].sort(new Intl.Collator(idioma, { sensitivity: 'base' }).compare);
  assert.deepEqual(terminos(raiz), ordenado(terminos(raiz), 'es'));
  const idsAntes = idsDe(raiz);
  fijarIdioma('es');
  await import(`${GLOSARIO.href}?guia=${++instancia}`);
  assert.deepEqual(idsDe(raiz), idsAntes, 'en castellano no se mueve nada');
  const { cambiarIdioma } = await idioma();
  await cambiarIdioma('ca');
  const enCatalan = terminos(raiz);
  assert.deepEqual(enCatalan, ordenado(enCatalan, 'ca'));
  assert.ok(enCatalan.includes('Xarxa neuronal') && enCatalan.includes('Biaix algorítmic'));
  assert.ok(idsDe(raiz).indexOf('termino-sesgo') < idsAntes.indexOf('termino-sesgo'), '«Biaix» sube con la B');
  assert.deepEqual([...idsDe(raiz)].sort(), [...idsAntes].sort(), 'mismas entradas, otro orden');
  await cambiarIdioma('es');
  assert.deepEqual(idsDe(raiz), idsAntes, 'de vuelta al castellano, el orden de partida');
});

// ---------- Textos ----------

/** Las claves que la página o sus guiones usan, sin las de los valores de los marcadores. */
function clavesUsadas(): Set<string> {
  const usadas = new Set([...PAGINA.matchAll(/data-texto(?:-[\w-]+)?="([^"]+)"/g)].map(([, clave]) => clave ?? ''));
  for (const archivo of ['scripts/desafio-ia.js', 'scripts/ejemplo-ia.js', 'scripts/etapas.js']) {
    for (const [, clave] of readFileSync(new URL(archivo, WEB), 'utf8').matchAll(/'(entender-ia\.[\w.-]+)'/g)) {
      usadas.add(clave ?? '');
    }
  }
  for (const [, clave] of PAGINA.matchAll(/data-(?:repaso-texto|etapas-clave-[\w]+)="([^"]+)"/g)) {
    usadas.add(clave ?? '');
  }
  return usadas;
}

test('cada clave de la guía existe en castellano y en catalán, con los mismos marcadores, y no sobra ninguna', () => {
  const usadas = clavesUsadas();
  // El ejemplo arma sus claves con el número de la frase y de la palabra.
  for (const clave of Object.keys(es).filter((clave) =>
    /^entender-ia\.ejemplo\.\d\.(frase|palabra\.\d)$/.test(clave),
  )) {
    usadas.add(clave);
  }
  const marcas = (texto: string) => [...texto.matchAll(/\{\w+\}/g)].map(([marca]) => marca).sort();
  for (const clave of usadas) {
    assert.ok(es[clave]?.trim(), `ES ${clave}`);
    assert.ok(ca[clave]?.trim(), `CA ${clave}`);
    assert.deepEqual(marcas(es[clave] ?? ''), marcas(ca[clave] ?? ''), clave);
  }
  const sobrantes = Object.keys(es).filter((clave) => clave.startsWith('entender-ia.') && !usadas.has(clave));
  assert.deepEqual(sobrantes, []);
});

test('el HTML lleva escrito el castellano de cada clave, para leerse sin JavaScript', () => {
  for (const [, clave, contenido] of PAGINA.matchAll(/data-texto="(entender-ia\.[\w.-]+)"[^>]*>([^<{]+)</g)) {
    const escrito = (contenido ?? '').replace(/\s+/g, ' ').trim();
    const esperado = (es[clave ?? ''] ?? '').split('{')[0]?.replace(/\s+/g, ' ').trim() ?? '';
    assert.ok(esperado.startsWith(escrito) || escrito.startsWith(esperado), `${clave}: «${escrito}»`);
  }
});

test('la guía dice «spam», no dice que la IA «suele fallar» y no contiene ninguna frase prohibida', () => {
  const textos = [
    PAGINA,
    ...Object.entries({ ...es, ...ca })
      .filter(([clave]) => clave.startsWith('entender-ia.'))
      .map(([, v]) => v),
  ].join('\n');
  for (const prohibido of [
    /correo no deseado/i,
    /no deseados?/i,
    /correo basura/i,
    /correu brossa/i,
    /herramienta potente/i,
    /sabe más que tú/i,
    /eina potent/i,
    /en sap més que tu/i,
    /suele fallar/i,
    /sol fallar/i,
    /AI4K12/i,
    /que sepa lo suficiente/i,
  ]) {
    assert.doesNotMatch(textos, prohibido);
  }
  assert.match(es['entender-ia.p1.ley'] ?? '', /que la crean o la usan que ayuden a su personal a entenderla/);
});

test('las referencias: ocho, con el artículo 14 del Reglamento y sin citas sueltas', () => {
  const referencias = [...PAGINA.matchAll(/<li id="ref-(\d+)"/g)].map(([, n]) => Number(n));
  assert.deepEqual(
    referencias,
    Array.from({ length: REFERENCIAS }, (_, posicion) => posicion + 1),
  );
  assert.match(es['entender-ia.referencia.5'] ?? '', /Artículos 3\.1, 4, 14 y 113/);
  // Los artículos 4 y 113 se citan con su redacción vigente, la del Reglamento (UE) 2026/1744, y con su enlace.
  const vigenteEs = /Los artículos 4 y 113 se citan con la redacción que les da el Reglamento \(UE\) 2026\/1744/;
  const vigenteCa = /Els articles 4 i 113 es citen amb la redacció que els dona el Reglament \(UE\) 2026\/1744/;
  assert.match(es['entender-ia.referencia.5'] ?? '', vigenteEs);
  assert.match(ca['entender-ia.referencia.5'] ?? '', vigenteCa);
  assert.match(PAGINA.replace(/\s+/g, ' '), vigenteEs);
  assert.match(PAGINA, /<li id="ref-5".*?href="https:\/\/eur-lex\.europa\.eu\/eli\/reg\/2026\/1744\/oj".*?<\/li/s);
  const citadas = new Set([...PAGINA.matchAll(/href="#ref-(\d+)"/g)].map(([, n]) => Number(n)));
  assert.deepEqual(
    [...citadas].sort((a, b) => a - b),
    referencias,
    'cada referencia se cita y cada cita existe',
  );
});
