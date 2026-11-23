/**
 * Guardia de los textos de la portada y de la pantalla de acceso, en castellano y en catalán: tuteo, neutralidad,
 * nombres admitidos, paridad entre idiomas y con el HTML inicial, y el aviso de demasiados intentos atado a la ventana
 * del limitador. Lee los diccionarios exportados y el HTML servido (nodos de texto, título, aria-label, alt y noscript).
 * Cada patrón se prueba también con un caso que debe fallar. El vocabulario vetado se escribe partido para que este
 * archivo no se señale a sí mismo.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type DefaultTreeAdapterTypes, parse } from 'parse5';
import { VENTANA_MS } from '../../src/plataforma/acceso-publico/limite-continuo-sqlite.ts';
import { AVISO_SIN_JAVASCRIPT, PAGINA_ACCESO_WEB } from '../../src/plataforma/cloudflare/acceso-web-pagina.ts';
import { PORTADA_PUBLICA, TEXTOS_PORTADA } from '../../src/plataforma/cloudflare/portada-publica.ts';
import { TEXTOS_ACCESO } from '../../src/plataforma/cloudflare/textos-acceso.ts';

type Textos = Readonly<Record<string, string>>;
interface Pantalla {
  readonly nombre: string;
  readonly html: string;
  readonly textos: Readonly<{ es: Textos; ca: Textos }>;
  /** Claves que no están en el HTML inicial porque solo aparecen tras una interacción o al llegar la fecha de apertura. */
  readonly tardias: readonly string[];
}

const PANTALLAS: readonly Pantalla[] = [
  { nombre: 'portada', html: PORTADA_PUBLICA, textos: TEXTOS_PORTADA, tardias: ['iniciada'] },
  {
    nombre: 'acceso',
    html: PAGINA_ACCESO_WEB,
    textos: TEXTOS_ACCESO,
    tardias: ['error-credenciales', 'error-intentos', 'error-saturacion', 'error-servicio', 'progreso'],
  },
];

/**
 * Textos del HTML inicial que no son del diccionario catalán: el nombre en el título y el logotipo, y
 * los avisos que se muestran sin guion, que llevan las dos frases porque nadie puede cambiar el idioma.
 */
const FIJOS_DEL_HTML = new Set([
  'Faro',
  'FARO',
  AVISO_SIN_JAVASCRIPT.ca,
  AVISO_SIN_JAVASCRIPT.es,
  TEXTOS_ACCESO.es['carga-fallida'],
]);

/** La línea de derechos de la portada dice el año de la obra. */
const CON_ANO: ReadonlySet<string> = new Set([TEXTOS_PORTADA.es.derechos, TEXTOS_PORTADA.ca.derechos]);

const ROTULO_DEL_RELOJ = 'Compte enrere de la demo privada';
/** El anuncio se admite únicamente en estas claves, en el rótulo del reloj y en los dos párrafos correspondientes. */
const ANUNCIO = new Map([
  ['portada.es.cuenta', 'La demo privada comienza en'],
  ['portada.es.iniciada', 'La demo privada ha comenzado'],
  ['portada.es.fecha', '1 de diciembre de 2026 · 00:00 Madrid'],
  ['portada.ca.cuenta', 'La demo privada comença d’aquí a'],
  ['portada.ca.iniciada', 'La demo privada ha començat'],
  ['portada.ca.fecha', '1 de desembre de 2026 · 00:00 Madrid'],
  ['portada.html.p#cuenta-estado.texto', TEXTOS_PORTADA.ca.cuenta],
  ['portada.html.p#cuenta-fecha.texto', TEXTOS_PORTADA.ca.fecha],
  ['portada.html.div#cuenta.aria-label', ROTULO_DEL_RELOJ],
]);
const MARCADORES = new Map([
  ['div#cuenta.aria-label', ROTULO_DEL_RELOJ],
  ...['dias', 'horas', 'minutos', 'segundos'].map((unidad) => [`strong#cuenta-${unidad}.texto`, '00'] as const),
]);

/** Únicas palabras con mayúscula admitidas fuera del inicio de una frase: el nombre, siglas y lugares de la foto. */
const NOMBRES_ADMITIDOS = new Set(['Faro', 'FARO', 'IA', 'JavaScript', 'Trwyn', 'Du', 'Penmon', 'Gales', 'Gal·les']);

/** Palabra entera, con límites que entienden las letras con acento: \b solo conoce las letras ASCII. */
function palabra(cuerpo: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${cuerpo})(?![\\p{L}\\p{N}])`, 'iu');
}

interface Regla {
  readonly motivo: string;
  readonly patron: RegExp;
  /** Un texto que la regla debe rechazar: demuestra que la guardia muerde. */
  readonly ejemplo: string;
}

const US = 'us';
const VOST = 'vost';
const DE = 'de';
const BIEN = 'bienven';
const BEN = 'benving';

const TUTEO: readonly Regla[] = [
  { motivo: 'usted', patron: palabra(`${US}ted(?:es)?`), ejemplo: `Si ${US}ted quiere, puede entrar.` },
  { motivo: 'le de cortesía', patron: palabra('le'), ejemplo: 'Le pedimos la contraseña.' },
  {
    motivo: 'su o sus de cortesía',
    patron: palabra('sus?\\s+(?:credenciales|usuario|contraseña|cuenta|navegador|sesión|datos)'),
    ejemplo: 'Revisa sus credenciales.',
  },
  {
    motivo: 'puede de cortesía (el impersonal «se puede» no trata a nadie)',
    patron: palabra('(?<!se\\s+)puede\\s+(?:acceder|entrar|volver)'),
    ejemplo: 'Ya puede entrar.',
  },
  {
    motivo: 'imperativo de usted',
    patron: palabra('ingrese|introduzca|revise|vuelva|compruebe|escriba|pulse|acceda|espere|disculpe'),
    ejemplo: 'Compruebe la contraseña.',
  },
  { motivo: 'por favor', patron: palabra('por\\s+favor'), ejemplo: 'Por favor, entra.' },
  { motivo: 'vostè', patron: palabra(`${VOST}(?:è|ès)`), ejemplo: `Si ${VOST}è vol, pot entrar.` },
  {
    motivo: 'possessiu de cortesia',
    patron: palabra('la seva|les seves|el seu|els seus'),
    ejemplo: 'Comprova les seves dades.',
  },
  {
    motivo: 'imperatiu de vostè',
    patron: palabra('introdueixi|comprovi|torni|accedeixi|escrigui|premi|esperi'),
    ejemplo: 'Torni-ho a provar.',
  },
  {
    motivo: 'imperatiu plural',
    patron: palabra('activeu|introduïu|comproveu|torneu|escriviu|premeu|accediu'),
    ejemplo: 'Activeu el navegador.',
  },
  { motivo: 'si us plau', patron: palabra('si\\s+us\\s+plau'), ejemplo: 'Si us plau, entra.' },
];

const NEUTRALIDAD: readonly Regla[] = [
  { motivo: 'versión de muestra', patron: palabra(`${DE}mo`), ejemplo: `Faro en ${DE}mo privada.` },
  { motivo: 'nombre de producto antiguo', patron: palabra(`Faro\\s+A${'pp'}`), ejemplo: `Entra en Faro A${'pp'}.` },
  { motivo: 'dominio', patron: new RegExp(`faro${'app'}\\.org`, 'iu'), ejemplo: `Visita faro${'app'}.org.` },
  { motivo: 'entrega', patron: palabra('entregas?'), ejemplo: 'Entra en la entrega privada.' },
  { motivo: 'ensayo', patron: palabra('ensayo'), ejemplo: 'Es un ensayo.' },
  { motivo: 'bienvenida con género', patron: palabra(`${BIEN}id[oa]s?`), ejemplo: `${BIEN}ido a Faro.` },
  { motivo: 'benvinguda amb gènere', patron: palabra(`${BEN}u(?:t|da|ts|des)`), ejemplo: `${BEN}ut a Faro.` },
  { motivo: 'fecha', patron: palabra('\\d{1,2}/\\d{1,2}(?:/\\d{2,4})?'), ejemplo: 'Abre el 3/11.' },
  { motivo: 'año', patron: palabra('(?:19|20)\\d{2}'), ejemplo: 'Edición de 2026.' },
  { motivo: 'hora', patron: palabra('\\d{1,2}:\\d{2}'), ejemplo: 'Abre a las 9:30.' },
];

/** Problemas de un texto frente a una lista de reglas. */
function incumplidas(texto: string, reglas: readonly Regla[]): string[] {
  return reglas.filter(({ patron }) => patron.test(texto)).map(({ motivo }) => motivo);
}

/** Palabras con mayúscula que no empiezan frase y no están en la lista de nombres admitidos. */
function nombresNoAdmitidos(texto: string): string[] {
  const ajenos: string[] = [];
  for (const { 0: encontrada, index } of texto.matchAll(/(?<![\p{L}\p{N}])\p{Lu}[\p{L}\p{N}·’'-]*/gu)) {
    const antes = texto.slice(0, index).trimEnd();
    const iniciaFrase = antes === '' || /[.!?:·]$/u.test(antes);
    if (!iniciaFrase && !NOMBRES_ADMITIDOS.has(encontrada)) {
      ajenos.push(encontrada);
    }
  }
  return ajenos;
}

/** Cada texto visible o accesible conserva su elemento de origen para acotar las excepciones del reloj. */
function recogerTexto(nodo: DefaultTreeAdapterTypes.ChildNode, padre: string, salida: [string, string][]) {
  if ('value' in nodo && nodo.value.trim()) {
    salida.push([`${padre}.texto`, nodo.value.trim()]);
  }
  if (!('tagName' in nodo)) {
    return;
  }
  const id = nodo.attrs.find(({ name }) => name === 'id')?.value;
  const origen = id ? `${nodo.tagName}#${id}` : nodo.tagName;
  for (const { name, value } of nodo.attrs) {
    if (['aria-label', 'title', 'alt'].includes(name) && value.trim()) {
      salida.push([`${origen}.${name}`, value.trim()]);
    }
  }
  const contenedor = nodo.tagName === 'template' ? (nodo as DefaultTreeAdapterTypes.Template).content : nodo;
  for (const hijo of contenedor.childNodes) {
    recogerTexto(hijo, origen, salida);
  }
}

function textosDelHtml(html: string): [string, string][] {
  const sinCodigo = html
    .replace(/<(style|script)>[\s\S]*?<\/\1>/g, '')
    .replace(/<svg[\s\S]*?<\/svg>/g, '')
    .replace(/F<\/span>ARO/g, 'FARO');
  const textos: [string, string][] = [];
  for (const nodo of parse(sinCodigo, { scriptingEnabled: false }).childNodes) {
    recogerTexto(nodo, '', textos);
  }
  return textos;
}

/** Todos los textos de las dos pantallas, con su procedencia para el mensaje de error. */
function todosLosTextos(): ReadonlyArray<readonly [string, string]> {
  const textos: Array<readonly [string, string]> = [];
  for (const { nombre, html, textos: diccionario } of PANTALLAS) {
    for (const idioma of ['es', 'ca'] as const) {
      for (const [clave, texto] of Object.entries(diccionario[idioma])) {
        textos.push([`${nombre}.${idioma}.${clave}`, texto]);
      }
    }
    for (const [elemento, texto] of textosDelHtml(html)) {
      textos.push([`${nombre}.html.${elemento}`, texto]);
    }
  }
  for (const [idioma, texto] of Object.entries(AVISO_SIN_JAVASCRIPT)) {
    textos.push([`acceso.noscript.${idioma}`, texto]);
  }
  return textos;
}

test('cada patrón de la guardia rechaza su caso negativo y acepta los textos aprobados de muestra', () => {
  for (const { motivo, patron, ejemplo } of [...TUTEO, ...NEUTRALIDAD]) {
    assert.ok(patron.test(ejemplo), `${motivo}: el patrón no rechaza «${ejemplo}»`);
  }
  assert.deepEqual(nombresNoAdmitidos('Escribe tu Usuario aquí.'), ['Usuario']);
  assert.deepEqual(nombresNoAdmitidos('Faro de Trwyn Du en Penmon, Gales. Entra en Faro.'), []);
  assert.deepEqual(incumplidas('Comprueba el usuario y la contraseña y vuelve a intentarlo.', TUTEO), []);
  assert.deepEqual(incumplidas('Comprova’ls i torna-ho a provar.', TUTEO), []);
  assert.deepEqual(incumplidas('Ahora no se puede entrar en Faro.', TUTEO), []);
});

test('las dos pantallas tratan de tú, en singular, en castellano y en catalán', () => {
  const problemas = todosLosTextos().flatMap(([origen, texto]) =>
    incumplidas(texto, TUTEO).map((motivo) => `${origen}: ${motivo} en «${texto}»`),
  );
  assert.deepEqual(problemas, []);
});

function faltasDeNeutralidad(origen: string, texto: string): string[] {
  if (ANUNCIO.get(origen) === texto) {
    return [];
  }
  return incumplidas(texto, NEUTRALIDAD).filter((motivo) => !(motivo === 'año' && CON_ANO.has(texto)));
}

test('las dos pantallas son neutras fuera de los textos del anuncio de estreno', () => {
  const problemas = todosLosTextos().flatMap(([origen, texto]) =>
    faltasDeNeutralidad(origen, texto).map((motivo) => `${origen}: ${motivo} en «${texto}»`),
  );
  assert.deepEqual(problemas, []);
  assert.deepEqual(faltasDeNeutralidad('portada.html.p.texto', TEXTOS_PORTADA.ca.cuenta), ['versión de muestra']);
  assert.deepEqual(faltasDeNeutralidad('portada.es.fecha', '2 de diciembre de 2026 · 00:00 Madrid'), ['año', 'hora']);
});

test('fuera del inicio de una frase solo aparecen los nombres admitidos', () => {
  const problemas = todosLosTextos().flatMap(([origen, texto]) =>
    nombresNoAdmitidos(texto)
      .filter((nombre) => !(nombre === 'Madrid' && ANUNCIO.get(origen) === texto))
      .map((nombre) => `${origen}: «${nombre}» en «${texto}»`),
  );
  assert.deepEqual(problemas, []);
});

test('el anuncio del estreno y los cuatro marcadores existen en sus lugares', () => {
  const textos = new Map(todosLosTextos());
  for (const [origen, esperado] of ANUNCIO) {
    assert.equal(textos.get(origen), esperado, origen);
  }
  for (const [elemento, esperado] of MARCADORES) {
    assert.equal(textos.get(`portada.html.${elemento}`), esperado, elemento);
  }
});

/** Problemas de un diccionario: claves distintas por idioma, textos vacíos o que pedirían escapes en el HTML. */
function problemasDeDiccionario(nombre: string, textos: Pantalla['textos']): string[] {
  const claves = (idioma: 'es' | 'ca') => Object.keys(textos[idioma]).sort().join(', ');
  const problemas =
    claves('es') === claves('ca') ? [] : [`${nombre}: claves distintas (es: ${claves('es')}; ca: ${claves('ca')})`];
  for (const idioma of ['es', 'ca'] as const) {
    for (const [clave, texto] of Object.entries(textos[idioma])) {
      if (texto.trim() === '' || /[&<>"]/.test(texto)) {
        problemas.push(`${nombre}.${idioma}.${clave} está vacío o pide escapes en el HTML: «${texto}»`);
      }
    }
  }
  return problemas;
}

/** Problemas del HTML inicial frente al diccionario catalán, en los dos sentidos. */
function problemasDelHtml({ nombre, html, textos, tardias }: Pantalla): string[] {
  const problemas = html.startsWith('<!doctype html><html lang="ca"')
    ? []
    : [`${nombre}: el HTML inicial no está en catalán`];
  const delHtml = textosDelHtml(html);
  const catalan = new Set(Object.values(textos.ca));
  for (const [elemento, texto] of delHtml) {
    if (
      catalan.has(texto) ||
      FIJOS_DEL_HTML.has(texto) ||
      (nombre === 'portada' && MARCADORES.get(elemento) === texto)
    ) {
      continue;
    }
    problemas.push(`${nombre}: el HTML inicial muestra «${texto}», que no está en el diccionario catalán`);
  }
  const visibles = new Set(delHtml.map(([, texto]) => texto));
  for (const [clave, texto] of Object.entries(textos.ca)) {
    if (!tardias.includes(clave) && !visibles.has(texto)) {
      problemas.push(`${nombre}: la página servida no muestra la clave ${clave} («${texto}»)`);
    }
  }
  return problemas;
}

/** Problemas de paridad de una pantalla: su diccionario y su HTML inicial. */
function problemasDeParidad(pantalla: Pantalla): string[] {
  return [...problemasDeDiccionario(pantalla.nombre, pantalla.textos), ...problemasDelHtml(pantalla)];
}

test('castellano y catalán tienen las mismas claves, y el HTML inicial lleva exactamente el catalán', () => {
  const problemas = PANTALLAS.flatMap(problemasDeParidad);
  if (!PORTADA_PUBLICA.includes('<title>Faro</title>')) {
    problemas.push('portada: el título no es «Faro»');
  }
  if (!PAGINA_ACCESO_WEB.includes(`<title>${TEXTOS_ACCESO.ca.pestana}</title>`)) {
    problemas.push('acceso: el título inicial no es el del diccionario catalán');
  }
  for (const idioma of ['ca', 'es'] as const) {
    const aviso = AVISO_SIN_JAVASCRIPT[idioma];
    if (aviso.trim() === '' || !PAGINA_ACCESO_WEB.includes(`<p lang="${idioma}">${aviso}</p>`)) {
      problemas.push(`acceso: el aviso sin JavaScript no lleva la frase en ${idioma} marcada con su idioma`);
    }
    if (!PAGINA_ACCESO_WEB.includes(`<p lang="${idioma}">${TEXTOS_ACCESO[idioma]['carga-fallida']}</p>`)) {
      problemas.push(`acceso: el aviso de carga fallida no lleva la frase en ${idioma} marcada con su idioma`);
    }
  }
  if (TEXTOS_PORTADA.es.derechos !== TEXTOS_PORTADA.ca.derechos) {
    problemas.push('portada: la línea de derechos no es la misma en los dos idiomas');
  }
  if (PAGINA_ACCESO_WEB.includes(TEXTOS_PORTADA.ca.derechos)) {
    problemas.push('acceso: la línea de derechos es solo de la portada');
  }
  assert.deepEqual(problemas, []);
});

test('la paridad rechaza claves distintas, textos vacíos y un HTML inicial que no es el del catalán', () => {
  const falsa: Pantalla = {
    nombre: 'falsa',
    html: '<!doctype html><html lang="es"><body><p>Hola</p></body></html>',
    textos: { es: { saludo: 'Hola' }, ca: { salutacio: '' } },
    tardias: [],
  };
  assert.deepEqual(problemasDeParidad(falsa), [
    'falsa: claves distintas (es: saludo; ca: salutacio)',
    'falsa.ca.salutacio está vacío o pide escapes en el HTML: «»',
    'falsa: el HTML inicial no está en catalán',
    'falsa: el HTML inicial muestra «Hola», que no está en el diccionario catalán',
    'falsa: la página servida no muestra la clave salutacio («»)',
  ]);
});

test('el aviso de credenciales nombra a la vez el usuario y la contraseña: no desvela cuál de los dos falla', () => {
  const nombra = (texto: string, palabras: readonly string[]) => palabras.every((p) => palabra(p).test(texto));
  assert.ok(nombra(TEXTOS_ACCESO.es['error-credenciales'], ['usuario', 'contraseña']));
  assert.ok(nombra(TEXTOS_ACCESO.ca['error-credenciales'], ['usuari', 'contrasenya']));
  assert.equal(nombra('La contraseña no es correcta.', ['usuario', 'contraseña']), false);
});

const CUARTO_DE_HORA_MS = 900_000;
const DIEZ_MINUTOS_MS = 600_000;

/** Duración de la ventana del limitador, dicha como la dice el aviso de demasiados intentos. */
const DURACION_DICHA: ReadonlyMap<number, Readonly<{ es: string; ca: string }>> = new Map([
  [CUARTO_DE_HORA_MS, { es: 'un cuarto de hora', ca: 'un quart d’hora' }],
]);

/** Problemas del aviso de demasiados intentos frente a la ventana del limitador. */
function avisoDeIntentos(ventanaMs: number, textos: Readonly<{ es: Textos; ca: Textos }>): string[] {
  const dicha = DURACION_DICHA.get(ventanaMs);
  if (!dicha) {
    return [`la ventana del limitador es de ${ventanaMs} ms: hay que decirla en el aviso de demasiados intentos`];
  }
  return (['es', 'ca'] as const)
    .filter((idioma) => !(textos[idioma]['error-intentos'] ?? '').includes(dicha[idioma]))
    .map((idioma) => `el aviso de demasiados intentos en ${idioma} no dice «${dicha[idioma]}»`);
}

test('el aviso de demasiados intentos dice la espera que fija la ventana del limitador', () => {
  assert.deepEqual(avisoDeIntentos(VENTANA_MS, TEXTOS_ACCESO), []);
  assert.deepEqual(avisoDeIntentos(DIEZ_MINUTOS_MS, TEXTOS_ACCESO), [
    'la ventana del limitador es de 600000 ms: hay que decirla en el aviso de demasiados intentos',
  ]);
  const sinEspera = { es: { 'error-intentos': 'Espera un rato.' }, ca: { 'error-intentos': 'Espera.' } };
  assert.deepEqual(avisoDeIntentos(CUARTO_DE_HORA_MS, sinEspera), [
    'el aviso de demasiados intentos en es no dice «un cuarto de hora»',
    'el aviso de demasiados intentos en ca no dice «un quart d’hora»',
  ]);
});
