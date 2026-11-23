/** La página de la encuesta cuadra con el servidor: las mismas preguntas y valores, la misma ruta y los mismos textos. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { PREGUNTAS } from '../../src/encuesta/cuestionario.ts';
import { RUTA_DE_LA_ENCUESTA } from '../../src/encuesta/punto-publico.ts';
import TEXTOS_CA from '../../web/idiomas/ca.js';
import TEXTOS_ES from '../../web/idiomas/es.js';

const leer = (ruta: string) => readFileSync(new URL(`../../${ruta}`, import.meta.url), 'utf8');
const PAGINA = leer('web/encuesta.html');
const GUION = leer('web/scripts/encuesta.js');
const INFORMACION = leer('web/informacion-y-creditos.html');
/** El texto visible de un trozo de HTML: sin etiquetas y con los espacios reducidos a uno. */
const textoDe = (html: string) =>
  html
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
/** El elemento que lleva ese data-texto, desde su etiqueta de apertura hasta su cierre. */
function elementoCon(html: string, clave: string, etiqueta: string): string {
  const inicio = html.lastIndexOf(`<${etiqueta}`, html.indexOf(`data-texto="${clave}"`));
  const fin = html.indexOf(`</${etiqueta}`, inicio);
  assert.ok(inicio >= 0 && fin > inicio, clave);
  return html.slice(inicio, fin);
}

/** Los nombres y valores de los botones de radio de un formulario de la página. */
function opcionesDe(idFormulario: string): Record<string, string[]> {
  const inicio = PAGINA.indexOf(`id="${idFormulario}"`);
  const fin = PAGINA.indexOf('</form>', inicio);
  assert.ok(inicio > 0 && fin > inicio);
  const opciones: Record<string, string[]> = {};
  for (const [, nombre = '', valor = ''] of PAGINA.slice(inicio, fin).matchAll(/name="([^"]+)" value="([^"]+)"/g)) {
    opciones[nombre] = [...(opciones[nombre] ?? []), valor];
  }
  return opciones;
}

test('cada formulario pregunta exactamente lo que el servidor admite, con los mismos valores y en el mismo orden', () => {
  const comoListas = (tipo: keyof typeof PREGUNTAS) =>
    Object.fromEntries(Object.entries(PREGUNTAS[tipo]).map(([pregunta, valores]) => [pregunta, [...valores]]));
  assert.deepEqual(opcionesDe('encuesta-participante'), comoListas('participante'));
  assert.deepEqual(opcionesDe('encuesta-profesional'), comoListas('profesional'));
});

test('el guion envía a la ruta del servidor y no guarda nada en el dispositivo', () => {
  assert.ok(GUION.includes(`const RUTA = '${RUTA_DE_LA_ENCUESTA}';`));
  assert.doesNotMatch(GUION, /localStorage|sessionStorage|indexedDB|document\.cookie|caches\./);
  assert.match(PAGINA, /<meta name="referrer" content="no-referrer" \/>/);
  assert.match(GUION, /referrerPolicy: 'no-referrer'/);
});

test('todos los textos de la página existen en castellano y en catalán, y el HTML lleva el castellano', () => {
  const claves = [...PAGINA.matchAll(/data-texto(?:-[a-z-]+)?="(encuesta\.[^"]+)"/g)].map(([, clave = '']) => clave);
  const delGuion = [...GUION.matchAll(/`encuesta\.estado\.\$\{clave\}`/g)].length;
  assert.ok(claves.length > 0 && delGuion === 1);
  const es = TEXTOS_ES as Record<string, string>;
  const ca = TEXTOS_CA as Record<string, string>;
  for (const clave of new Set(claves)) {
    assert.ok(es[clave] && ca[clave], clave);
  }
  for (const clave of Object.keys(es).filter((c) => c.startsWith('encuesta.estado.'))) {
    assert.ok(ca[clave], clave);
  }
  // La entradilla es una plantilla: {0} es su enlace, que se traduce aparte.
  const entradilla = (es['encuesta.entradilla'] ?? '-').replace('{0}', es['encuesta.entradilla.enlace'] ?? '-');
  assert.equal(textoDe(elementoCon(PAGINA, 'encuesta.entradilla', 'p')), entradilla);
});

test('la página remite a «Tus datos», que explica la encuesta en un solo lugar y en los dos idiomas', () => {
  const es = TEXTOS_ES as Record<string, string>;
  const ca = TEXTOS_CA as Record<string, string>;
  const entradilla = elementoCon(PAGINA, 'encuesta.entradilla', 'p');
  assert.match(entradilla, /<a href="informacion-y-creditos\.html#t-datos" data-texto="encuesta\.entradilla\.enlace"/);
  for (const textos of [es, ca]) {
    assert.match(textos['encuesta.entradilla'] ?? '', /\{0\}/);
    assert.ok(textos['encuesta.entradilla.enlace']);
  }
  // El párrafo está dentro del apartado de datos y dice lo esencial sin mecanismos internos.
  const datos = INFORMACION.slice(INFORMACION.indexOf('aria-labelledby="t-datos"'));
  const parrafo = elementoCon(
    datos.slice(0, datos.indexOf('</section')),
    'informacion-y-creditos.datos.encuesta',
    'li',
  );
  const clave = 'informacion-y-creditos.datos.encuesta';
  assert.equal(textoDe(parrafo), es[clave]);
  assert.ok(ca[clave]);
  for (const texto of [es[clave] ?? '', ca[clave] ?? '']) {
    assert.match(texto, /anónima|anònima/);
    assert.doesNotMatch(texto, /huella|empremta|hash|SQLite|servidor|base de dades|base de datos|fila/i);
  }
});

const PUNTOS_DE_LA_ESCALA = 5;
/** Las entradas dicen «cinco preguntas»: cada formulario tiene exactamente esas. */
const PREGUNTAS_POR_FORMULARIO = 5;
/** Las etiquetas de los botones de radio de una pregunta, desde «<label» hasta su cierre. */
function etiquetasDe(pregunta: string): string[] {
  const inicio = PAGINA.indexOf(`data-pregunta="${pregunta}"`);
  const grupo = PAGINA.slice(inicio, PAGINA.indexOf('</fieldset', inicio));
  return [...grupo.matchAll(/<label[\s\S]*?<\/label\s*>/g)].map(([etiqueta]) => etiqueta);
}
test('cada punto de la escala muestra su número y su nombre, y su nombre accesible los incluye («4, Bastante»)', () => {
  const escalas = Object.entries({ ...PREGUNTAS.participante, ...PREGUNTAS.profesional })
    .filter(([, valores]) => valores.includes('5'))
    .map(([pregunta]) => pregunta);
  // Comprensión y formación de las personas; las cuatro primeras de las profesionales.
  assert.deepEqual(escalas, [
    'comprension',
    'formacion',
    'ayudaOrientacion',
    'explicarCambio',
    'encajeFormacion',
    'fiabilidad',
  ]);
  const es = TEXTOS_ES as Record<string, string>;
  const ca = TEXTOS_CA as Record<string, string>;
  for (const pregunta of escalas) {
    const puntos = etiquetasDe(pregunta).filter((etiqueta) => /value="[1-5]"/.test(etiqueta));
    assert.equal(puntos.length, PUNTOS_DE_LA_ESCALA, pregunta);
    puntos.forEach((etiqueta, i) => {
      const punto = String(i + 1);
      const clave = `encuesta.escala.${punto}`;
      assert.ok(es[clave] && ca[clave], clave);
      assert.match(etiqueta, new RegExp(`<span class="encuesta-punto">${punto}</span`), pregunta);
      assert.match(etiqueta, new RegExp(`data-texto="${clave}">${es[clave]}</span>`), pregunta);
      // Lo que lee el lector de pantalla es el texto de la etiqueta: el número, una coma solo para él y el nombre.
      assert.equal(textoDe(etiqueta), `${punto}, ${es[clave]}`, pregunta);
    });
  }
  assert.doesNotMatch(PAGINA, /encuesta\.escala\.leyenda/);
  // La formación tiene además su opción aparte, con texto.
  assert.ok(etiquetasDe('formacion').some((e) => /value="sin_ver"/.test(e) && /formacion\.sin-ver/.test(e)));
});

test('ningún formulario tiene campos de texto libre: solo botones de radio, y todos obligatorios', () => {
  for (const id of ['encuesta-participante', 'encuesta-profesional']) {
    const inicio = PAGINA.indexOf(`id="${id}"`);
    const formulario = PAGINA.slice(inicio, PAGINA.indexOf('</form>', inicio));
    assert.doesNotMatch(formulario, /<textarea|<select|contenteditable/);
    const campos = [...formulario.matchAll(/<input\b[^>]*>/g)].map(([campo]) => campo);
    assert.ok(campos.length > 0);
    for (const campo of campos) {
      assert.match(campo, /type="radio"[^>]*required/, campo);
    }
  }
});

test('cada formulario tiene su entrada y su cierre, con las cinco preguntas que tiene', () => {
  const es = TEXTOS_ES as Record<string, string>;
  const ca = TEXTOS_CA as Record<string, string>;
  assert.equal(Object.keys(PREGUNTAS.participante).length, PREGUNTAS_POR_FORMULARIO);
  assert.equal(Object.keys(PREGUNTAS.profesional).length, PREGUNTAS_POR_FORMULARIO);
  for (const clave of ['encuesta.entradilla', 'encuesta.entradilla-profesional']) {
    assert.match(es[clave] ?? '', /cinco preguntas cerradas/, clave);
    assert.match(ca[clave] ?? '', /cinc preguntes tancades/, clave);
  }
  // La entrada de las profesionales empieza oculta: el guion enseña la del tipo del código.
  assert.match(PAGINA, /id="encuesta-entrada-profesional" data-texto="encuesta\.entradilla-profesional" hidden/);
  assert.equal(
    textoDe(elementoCon(PAGINA, 'encuesta.entradilla-profesional', 'p')),
    es['encuesta.entradilla-profesional'],
  );
  assert.equal(textoDe(elementoCon(PAGINA, 'encuesta.gracias.texto', 'p')), es['encuesta.gracias.texto']);
  assert.match(es['encuesta.gracias.texto'] ?? '', /Faro no guarda qué ha respondido cada persona/);
  assert.match(ca['encuesta.gracias.texto'] ?? '', /Faro no guarda què ha respost cada persona/);
});

test('un 503 tiene su propio aviso, distinto del de sin conexión', () => {
  assert.match(GUION, /case NO_DISPONIBLE:\s*return 'no-disponible';/);
  assert.match(GUION, /const NO_DISPONIBLE = 503;/);
  const es = TEXTOS_ES as Record<string, string>;
  const ca = TEXTOS_CA as Record<string, string>;
  for (const textos of [es, ca]) {
    assert.ok(textos['encuesta.estado.no-disponible']);
    assert.notEqual(textos['encuesta.estado.no-disponible'], textos['encuesta.estado.sin-conexion']);
  }
});

/** Lo que hace idioma-inicial.js con una dirección: qué lee de ella, qué escribe en el historial y qué guarda. */
function idiomaInicialCon(direccion: string) {
  const leidas: string[] = [];
  const reemplazos: unknown[][] = [];
  const guardados: [string, string][] = [];
  const url = new URL(direccion);
  const location = new Proxy(
    { href: url.href, search: url.search, hash: url.hash, pathname: url.pathname },
    {
      get(objetivo, nombre) {
        leidas.push(String(nombre));
        return Reflect.get(objetivo, nombre);
      },
    },
  );
  const prohibido = (que: string) => () => assert.fail(`idioma-inicial.js no puede usar ${que}`);
  const document = {
    documentElement: { dataset: {} },
    baseURI: direccion,
    currentScript: { getAttribute: () => 'scripts/idioma-inicial.js' },
    createElement: () => ({}),
    head: { append: () => {} },
    querySelector: (selector: string) => (selector === 'link[rel=manifest]' ? { setAttribute: () => {} } : null),
  };
  runInNewContext(leer('web/scripts/idioma-inicial.js'), {
    document,
    URL,
    URLSearchParams,
    location,
    history: { state: null, replaceState: (...argumentos: unknown[]) => reemplazos.push(argumentos) },
    localStorage: {
      getItem: () => null,
      setItem: (clave: string, valor: string) => guardados.push([clave, valor]),
    },
    sessionStorage: { getItem: prohibido('sessionStorage'), setItem: prohibido('sessionStorage') },
    navigator: { languages: ['es'], sendBeacon: prohibido('sendBeacon') },
    fetch: prohibido('fetch'),
    XMLHttpRequest: prohibido('XMLHttpRequest'),
    WebSocket: prohibido('WebSocket'),
    Image: prohibido('Image'),
    setTimeout: () => 0,
  });
  return { leidas, reemplazos, guardados };
}

test('el código del fragmento solo pasa antes por guiones propios que no lo leen, ni lo guardan ni lo envían', () => {
  const guiones = [...PAGINA.matchAll(/<script[^>]*src="([^"]+)"/g)].map(([, src]) => src);
  assert.deepEqual(guiones, ['scripts/tema-inicial.js', 'scripts/idioma-inicial.js', 'scripts/encuesta.js']);
  // tema-inicial.js no lee la dirección de ninguna forma.
  assert.doesNotMatch(leer('web/scripts/tema-inicial.js'), /location|history|\.hash\b|document\.URL\b|baseURI/);
  // idioma-inicial.js, sin un idioma válido en la consulta, solo lee la consulta: ni la dirección entera ni el fragmento.
  const codigo = '#codigo=PART-0123-4567-89AB-CDEF-GHJK-MNPQ-RSTV';
  for (const consulta of ['', '?idioma=fr', '?otra=1']) {
    const sin = idiomaInicialCon(`https://faro.example/encuesta.html${consulta}${codigo}`);
    assert.deepEqual(sin, { leidas: ['search'], reemplazos: [], guardados: [] }, consulta);
  }
  // Con un idioma válido lee la dirección entera solo para retirarlo: conserva lo demás y el fragmento, guarda solo
  // el idioma y no envía nada.
  const con = idiomaInicialCon(`https://faro.example/encuesta.html?otra=1&idioma=ca${codigo}`);
  assert.deepEqual(con.leidas, ['search', 'href']);
  assert.deepEqual(con.reemplazos, [[null, '', `https://faro.example/encuesta.html?otra=1${codigo}`]]);
  assert.deepEqual(con.guardados, [['faro-idioma', 'ca']]);
  // Del módulo de la página, antes del fragmento solo se evalúa la forma del código, que no importa nada ni toca la
  // página; sitio.js y el resto van después.
  const dependencias = [...GUION.matchAll(/^import (?:.* from )?'([^']+)';$/gm)].map(([, ruta]) => ruta);
  assert.deepEqual(dependencias.slice(0, dependencias.indexOf('./encuesta-fragmento.js')), ['./encuesta-codigo.js']);
  assert.doesNotMatch(leer('web/scripts/encuesta-codigo.js'), /^import|location|document|window|history/m);
});

test('la página no deja caracteres sueltos entre etiquetas', () => {
  // Con el formato del HTML, un «>» al principio de línea cierra la etiqueta anterior; si esa ya estaba cerrada, el
  // «>» se ve como texto en la página.
  assert.doesNotMatch(PAGINA, />\n\s*>/);
});

test('quien llega con su enlace no ve el campo del código: el paso empieza oculto y solo se enseña sin código válido', () => {
  assert.match(PAGINA, /<section class="bloque" id="encuesta-paso-codigo" aria-labelledby="t-encuesta-codigo" hidden>/);
  assert.match(
    GUION,
    /if \(canonico !== null && FORMATO\.test\(canonico\)\) \{\s*empezar\(canonico\);\s*\} else \{\s*pasoCodigo\.hidden = false;/,
  );
  // Ningún texto de la página habla de tarjetas ni de códigos QR: el código de la invitación llega en un enlace.
  const es = TEXTOS_ES as Record<string, string>;
  const ca = TEXTOS_CA as Record<string, string>;
  const textos = Object.keys(es)
    .filter((clave) => clave.startsWith('encuesta.'))
    .flatMap((clave) => [es[clave] ?? '', ca[clave] ?? '']);
  for (const texto of [...textos, PAGINA]) {
    assert.doesNotMatch(texto, /tarjeta|targeta|\bQR\b/i);
  }
  assert.match(es['encuesta.estado.codigo-no-valido'] ?? '', /pide otro/);
  assert.match(ca['encuesta.estado.codigo-no-valido'] ?? '', /demana’n un altre/);
});

test('la página de la encuesta solo olvida la invitación cuando el servidor responde que ha registrado las respuestas', () => {
  // Una sola llamada, dentro de la rama del 200 («registrada»); un rechazo, un 503 o un fallo de red la conservan.
  assert.equal(GUION.match(/olvidarInvitacion\(/g)?.length, 1);
  assert.match(GUION, /const SUMADA = 200;/);
  const rama = GUION.slice(GUION.indexOf('if (estadoHttp === SUMADA) {'));
  assert.ok(rama.indexOf('olvidarInvitacion(codigo)') > 0);
  assert.ok(rama.indexOf('olvidarInvitacion(codigo)') < rama.indexOf('return;'));
});
