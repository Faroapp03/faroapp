import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { after, test } from 'node:test';
import { aperturas, etiquetasDe } from '../../herramientas/web/etiquetas.ts';
import ca from '../../web/idiomas/ca.js';
import es from '../../web/idiomas/es.js';
import { fijarIdioma, registrarDiccionario } from '../../web/scripts/textos.js';

const EJEMPLO = new URL('../../web/scripts/ejemplo-ia.js', import.meta.url);
const SITIO = new URL('../../web/scripts/sitio.js', import.meta.url);
const hooks = registerHooks({
  load(url, contexto, siguiente) {
    if (url === SITIO.href) {
      return { format: 'module', source: '', shortCircuit: true };
    }
    return siguiente(url, contexto);
  },
});
after(() => hooks.deregister());

// Doble limitado al DOM usado por el ejemplo y por escribir; no simula navegador ni disposición visual.
class Elemento extends EventTarget {
  dataset: Record<string, string> = {};
  children: Elemento[] = [];
  parentElement: Elemento | null = null;
  atributos = new Map<string, string>();
  propiedades = new Map<string, string>();
  style = { setProperty: (nombre: string, valor: string) => this.propiedades.set(nombre, valor) };
  textContent = '';
  lang = '';
  className = '';
  hidden = false;
  append(...hijos: Elemento[]) {
    for (const hijo of hijos) {
      hijo.parentElement = this;
      this.children.push(hijo);
    }
  }
  replaceChildren(...hijos: Elemento[]) {
    this.children = [];
    this.append(...hijos);
  }
  setAttribute(nombre: string, valor: string) {
    this.atributos.set(nombre, valor);
  }
  hasAttribute(nombre: string) {
    return this.atributos.has(nombre);
  }
  removeAttribute(nombre: string) {
    this.atributos.delete(nombre);
    if (nombre === 'data-texto') {
      delete this.dataset.texto;
    }
  }
  closest() {
    return null;
  }
}
class Boton extends Elemento {}
const raiz = new Elemento();
raiz.lang = 'es';
let lista: Elemento | null = null;
let frase: Elemento | null = null;
let mas: Boton | null = null;
let resumen: Elemento | null = null;
let botones: Boton[] = [];
const creados: Elemento[] = [];
const documento = {
  documentElement: raiz,
  getElementById: (id: string) =>
    ({ 'ejemplo-lista': lista, 'ejemplo-frase': frase, 'ejemplo-mas': mas, 'ejemplo-resumen': resumen })[id] ?? null,
  createElement: () => {
    const elemento = new Elemento();
    creados.push(elemento);
    return elemento;
  },
  querySelector: () => null,
  querySelectorAll: (selector: string) => {
    if (selector === '.ejemplo-opcion') {
      return botones;
    }
    return [frase, mas, resumen, ...creados].filter((elemento) => elemento?.dataset.texto);
  },
};
const anteriores = new Map<string, PropertyDescriptor | undefined>();
for (const [nombre, valor] of Object.entries({
  document: documento,
  HTMLElement: Elemento,
  HTMLButtonElement: Boton,
})) {
  anteriores.set(nombre, Object.getOwnPropertyDescriptor(globalThis, nombre));
  Object.defineProperty(globalThis, nombre, { configurable: true, value: valor });
}
after(() => {
  for (const [nombre, descriptor] of anteriores) {
    if (descriptor) {
      Object.defineProperty(globalThis, nombre, descriptor);
    } else {
      Reflect.deleteProperty(globalThis, nombre);
    }
  }
});
registrarDiccionario('es', es);
registrarDiccionario('ca', ca);
const { cambiarIdioma } = await import('../../web/scripts/idioma.js');
const { PaginaIncompleta } = await import('../../web/scripts/dom.js');
let instancia = 0;
function abrir(indices: (string | undefined)[]) {
  lista = new Elemento();
  frase = new Elemento();
  mas = new Boton();
  resumen = new Elemento();
  creados.length = 0;
  botones = indices.map((indice) => {
    const boton = new Boton();
    if (indice !== undefined) {
      boton.dataset.indice = indice;
    }
    return boton;
  });
  return import(`${EJEMPLO.href}?informacion=${++instancia}`);
}
const INDICES = aperturas(etiquetasDe(readFileSync(new URL('../../web/entender-ia.html', import.meta.url), 'utf8')))
  .filter(({ nombre, atributos }) => nombre === 'button' && atributos.get('class') === 'ejemplo-opcion')
  .map(({ atributos }) => atributos.get('data-indice') ?? undefined);

/** Las 20 palabras más probables; se ven 5 y el desplegable enseña las otras 15. */
const FILAS = 20;
const VISIBLES = 5;
/** La palabra más probable de cada ejemplo y su porcentaje, tal como salieron de Salamandra 2B (19/10/2026). */
const PRIMERAS = {
  es: [
    ['centro', '7,0 %'],
    ['cliente', '29,3 %'],
    ['meses', '77,6 %'],
  ],
  ca: [
    ['mercat', '9,3 %'],
    ['client', '42,9 %'],
    ['mesos', '66,0 %'],
  ],
} as const;
/** Una palabra o un número (con los signos propios del catalán), nunca una fila que junte las demás. */
const PALABRA = /^[\p{L}\p{N}·]+$/u;
/** «29,3 %» o «< 0,1 %»: un decimal, coma decimal y espacio que no se parte. */
const CIFRA = /^(?:< )?\d{1,2},\d %$/;

const filas = () => lista?.children ?? [];
const visibles = () => filas().filter((fila) => !fila.hidden);
const palabras = () => filas().map((fila) => fila.children[0]?.textContent ?? '');
const cifras = () => filas().map((fila) => fila.children[2]?.textContent ?? '');
/** Una cifra escrita como número; «< 0,1 %» cuenta como 0. */
const numero = (texto: string) => (texto.startsWith('<') ? 0 : Number.parseFloat(texto.replace(',', '.')));
const anchos = () =>
  filas().map((fila) => Number.parseFloat(fila.children[1]?.children[0]?.propiedades.get('--ancho') ?? ''));
/** Los porcentajes que cita la frase de debajo, en orden: suma, lo que queda y el tope. */
const delResumen = () =>
  [...(resumen?.textContent ?? '').matchAll(/(\d{1,3},\d) %/g)].map(([, n]) =>
    Number.parseFloat((n ?? '').replace(',', '.')),
  );

/** La barra de la palabra más probable ocupa todo el ancho; la suma de todas las palabras, el 100 %. */
const TOTAL = 100;
/** Las cifras van redondeadas a una décima. */
const DECIMA = 0.1;
/** La suma del resumen sale de los porcentajes sin redondear: puede separarse un poco de la de las cifras a la vista. */
const MARGEN_DE_LA_SUMA = 0.3;
const redondear = (valor: number) => Math.round(valor * 10) / 10;

/** Las 20 filas: palabras o números (las siglas en mayúsculas), cifras con un decimal y de mayor a menor. */
function comprobarFilas(idioma: 'es' | 'ca', indice: number) {
  assert.equal(filas().length, FILAS);
  assert.deepEqual([palabras()[0], cifras()[0]], PRIMERAS[idioma][indice]);
  for (const palabra of palabras()) {
    assert.match(palabra, PALABRA, `${idioma} ${indice}`);
  }
  assert.ok(!palabras().some((palabra) => /^(?:iva|cif|nif|dni|cap)$/.test(palabra)), 'siglas en mayúsculas');
  for (const texto of cifras()) {
    assert.match(texto, CIFRA);
  }
  const valores = cifras().map(numero);
  assert.ok(
    valores.every((valor, i) => i === 0 || valor <= (valores[i - 1] ?? 0)),
    `${idioma} ${indice}: de mayor a menor`,
  );
  return valores;
}

/** La más probable ocupa la barra entera; las demás, en proporción (con margen por el redondeo de las cifras, que pesa
 * más cuanto menor es la primera). Las barras no se leen: la cifra ya lo dice. */
function comprobarBarras(valores: number[], contexto: string) {
  assert.equal(anchos()[0], TOTAL);
  const mayor = valores[0] ?? 1;
  const margen = (DECIMA / mayor) * TOTAL + DECIMA;
  for (const [i, ancho] of anchos().entries()) {
    assert.ok(Math.abs(ancho - ((valores[i] ?? 0) / mayor) * TOTAL) <= margen, `${contexto} fila ${i}`);
  }
  for (const fila of filas()) {
    assert.equal(fila.children[1]?.atributos.get('aria-hidden'), 'true');
  }
}

/** La frase de debajo: cuántas se ven, cuánto suman, lo que queda (hasta 100) y el tope de las que no se ven. */
function comprobarResumen(idioma: 'es' | 'ca', valores: number[], vistas: number, contexto: string) {
  assert.ok(
    resumen?.textContent.startsWith(idioma === 'es' ? `Estas ${vistas} palabras` : `Aquestes ${vistas} paraules`),
  );
  const [suma = 0, resto = 0, tope = 0] = delResumen();
  const sumaVisible = valores.slice(0, vistas).reduce((total, valor) => total + valor, 0);
  assert.ok(Math.abs(suma - sumaVisible) <= MARGEN_DE_LA_SUMA, `${contexto}: suma ${suma}`);
  assert.equal(redondear(suma + resto), TOTAL);
  assert.ok(tope <= (valores[vistas - 1] ?? 0) + DECIMA && tope >= DECIMA, `${contexto}: tope ${tope}`);
  if (vistas < FILAS) {
    assert.ok(tope >= (valores[vistas] ?? 0), 'el tope cubre la palabra siguiente a la última a la vista');
  }
}

/** Comprueba el ejemplo pintado: frase, filas, las visibles, barras, resumen, desplegable y selección. */
function comprobarEjemplo(idioma: 'es' | 'ca', indice: number, abierto: boolean) {
  const diccionario = idioma === 'es' ? es : ca;
  const contexto = `${idioma} ${indice}`;
  assert.equal(frase?.textContent, diccionario[`entender-ia.ejemplo.${indice}.frase`]);
  const valores = comprobarFilas(idioma, indice);
  assert.equal(visibles().length, abierto ? FILAS : VISIBLES);
  assert.deepEqual(visibles(), filas().slice(0, visibles().length));
  comprobarBarras(valores, contexto);
  comprobarResumen(idioma, valores, abierto ? FILAS : VISIBLES, contexto);
  assert.equal(mas?.atributos.get('aria-expanded'), String(abierto));
  assert.equal(mas?.textContent, diccionario[abierto ? 'entender-ia.ejemplo.menos' : 'entender-ia.ejemplo.mas']);
  assert.deepEqual(
    botones.map((boton) => boton.atributos.get('aria-pressed')),
    botones.map((_, i) => String(i === indice)),
  );
}

test('los botones reales pintan 20 palabras de mayor a menor, 5 a la vista, con barras y resumen, en ES/CA', async () => {
  fijarIdioma('es');
  await abrir(INDICES);
  assert.deepEqual(INDICES, ['0', '1', '2']);
  comprobarEjemplo('es', 0, false);
  for (const idioma of ['es', 'ca'] as const) {
    fijarIdioma(idioma);
    for (const [indice, boton] of botones.entries()) {
      boton.dispatchEvent(new Event('click'));
      comprobarEjemplo(idioma, indice, false);
    }
  }
});

test('el desplegable muestra de la 6.ª a la 20.ª, se conserva al cambiar de frase y de idioma, y se vuelve a plegar', async () => {
  fijarIdioma('es');
  await abrir(INDICES);
  mas?.dispatchEvent(new Event('click'));
  comprobarEjemplo('es', 0, true);
  botones[2]?.dispatchEvent(new Event('click'));
  comprobarEjemplo('es', 2, true);
  await cambiarIdioma('ca');
  comprobarEjemplo('ca', 2, true);
  mas?.dispatchEvent(new Event('click'));
  comprobarEjemplo('ca', 2, false);
  await cambiarIdioma('es');
  comprobarEjemplo('es', 2, false);
});

test('al cambiar de idioma, el ejemplo elegido se vuelve a pintar con las palabras de la lengua nueva', async () => {
  fijarIdioma('es');
  await abrir(INDICES);
  botones[1]?.dispatchEvent(new Event('click'));
  assert.ok(palabras().includes('IVA'));
  await cambiarIdioma('ca');
  comprobarEjemplo('ca', 1, false);
  assert.equal(palabras()[0], 'client');
  await cambiarIdioma('es');
  comprobarEjemplo('es', 1, false);
});

test("las cifras de la frase de debajo llevan su artículo: en catalán, «l'» delante de 1 y 11", () => {
  assert.equal(es['entender-ia.ejemplo.cifra'], 'el {cifra}');
  assert.equal(es['entender-ia.ejemplo.cifra.vocal'], 'el {cifra}');
  assert.equal(ca['entender-ia.ejemplo.cifra'], 'el {cifra}');
  assert.equal(ca['entender-ia.ejemplo.cifra.vocal'], 'l’{cifra}');
});

test('configuración de índice ausente, vacía, no canónica o fuera de rango falla antes de pintar', async () => {
  for (const indice of [undefined, '', ' ', '01', '1e0', 'NaN', '-1', '0.5', '3', 'Infinity']) {
    await assert.rejects(abrir(['0', indice]), PaginaIncompleta, String(indice));
    assert.equal(lista?.children.length, 0);
    assert.equal(frase?.textContent, '');
  }
});

test('sin la sección o sin botones el guion no pinta', async () => {
  await abrir([]);
  assert.equal(lista?.children.length, 0);
  lista = null;
  frase = null;
  botones = [new Boton()];
  await import(`${EJEMPLO.href}?informacion=${++instancia}`);
  assert.equal(creados.length, 0);
});
