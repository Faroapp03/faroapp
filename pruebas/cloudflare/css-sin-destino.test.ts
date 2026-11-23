/**
 * Guardia del CSS de la portada y de la pantalla de acceso: cada selector de su estilo tiene destino en su propio HTML,
 * y ninguna regla queda entera anulada por otra posterior con el mismo selector y en el mismo contexto. Las
 * pseudoclases, los pseudoelementos y los selectores de atributo no cuentan: dependen de la interacción o de estados
 * que pone el guion, como data-tema o data-guion.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type DefaultTreeAdapterTypes, parse } from 'parse5';
import { PAGINA_ACCESO_WEB } from '../../src/plataforma/cloudflare/acceso-web-pagina.ts';
import { PORTADA_PUBLICA } from '../../src/plataforma/cloudflare/portada-publica.ts';

interface Regla {
  /** La regla @media que la contiene, o vacío en el nivel superior. */
  readonly contexto: string;
  readonly selectores: readonly string[];
  readonly propiedades: readonly string[];
}
interface Elemento {
  readonly etiqueta: string;
  readonly atributos: ReadonlyMap<string, string>;
  readonly padre: Elemento | null;
}

/** Bloques que no declaran estilo de elementos: tipografías y fotogramas de animación. */
const SIN_SELECTORES = /^@(?:font-face|keyframes)\b/;

/** El guion crea los dígitos al pintar y marca el cambio de segundo y la apertura. portada-cuenta los observa. */
const SELECTORES_DEL_RELOJ = ['.digito', '.digito.cambia', '.cuenta .digito', '.cuenta-estado.abierta'] as const;

/** Posición del cierre del bloque que abre la llave en «inicio», contando las llaves anidadas. */
function cierreDeBloque(css: string, inicio: number): number {
  let nivel = 0;
  for (let i = inicio; i < css.length; i++) {
    if (css[i] === '{') {
      nivel++;
    } else if (css[i] === '}' && --nivel === 0) {
      return i;
    }
  }
  throw new Error('CSS con una llave sin cerrar');
}

/** Reglas de estilo del CSS en orden, con su contexto @media; sin @font-face ni @keyframes. */
function reglasDe(css: string, contexto = ''): Regla[] {
  const reglas: Regla[] = [];
  let posicion = 0;
  while (posicion < css.length) {
    const llave = css.indexOf('{', posicion);
    if (llave === -1) {
      break;
    }
    const cabecera = css.slice(posicion, llave).trim();
    const cierre = cierreDeBloque(css, llave);
    const cuerpo = css.slice(llave + 1, cierre);
    if (cabecera.startsWith('@media')) {
      reglas.push(...reglasDe(cuerpo, cabecera));
    } else if (!SIN_SELECTORES.test(cabecera)) {
      reglas.push({
        contexto,
        selectores: cabecera.split(',').map((selector) => selector.trim()),
        propiedades: cuerpo
          .split(';')
          .map((declaracion) => declaracion.split(':')[0]?.trim() ?? '')
          .filter((propiedad) => propiedad !== ''),
      });
    }
    posicion = cierre + 1;
  }
  return reglas;
}

/** Elementos del documento, cada uno con su padre. */
function elementosDe(html: string): Elemento[] {
  const elementos: Elemento[] = [];
  const recorrer = (nodo: DefaultTreeAdapterTypes.ParentNode, padre: Elemento | null) => {
    for (const hijo of nodo.childNodes) {
      if (!('tagName' in hijo)) {
        continue;
      }
      const elemento = {
        etiqueta: hijo.tagName,
        atributos: new Map(hijo.attrs.map(({ name, value }) => [name, value])),
        padre,
      };
      elementos.push(elemento);
      recorrer(hijo.tagName === 'template' ? (hijo as DefaultTreeAdapterTypes.Template).content : hijo, elemento);
    }
  };
  recorrer(parse(html), null);
  return elementos;
}

/** Si un selector simple compuesto (sin combinadores) describe al elemento. */
function cumpleCompuesto(elemento: Elemento, compuesto: string): boolean {
  const etiqueta = /^[a-z][\w-]*/i.exec(compuesto)?.[0];
  if (etiqueta && etiqueta !== elemento.etiqueta) {
    return false;
  }
  const clases = new Set((elemento.atributos.get('class') ?? '').split(/\s+/));
  return [...compuesto.replace(/\[[^\]]*\]/g, '').matchAll(/([.#])([\w-]+)/g)].every(([, tipo, nombre]) =>
    tipo === '.' ? clases.has(nombre ?? '') : elemento.atributos.get('id') === nombre,
  );
}

/** Si la cadena de compuestos, leída de derecha a izquierda, describe al elemento y a sus antecesores. */
function cumpleCadena(elemento: Elemento, partes: readonly string[], indice: number): boolean {
  if (!cumpleCompuesto(elemento, partes[indice] ?? '')) {
    return false;
  }
  if (indice === 0) {
    return true;
  }
  const hijoDirecto = partes[indice - 1] === '>';
  const siguiente = hijoDirecto ? indice - 2 : indice - 1;
  for (let antecesor = elemento.padre; antecesor; antecesor = antecesor.padre) {
    if (cumpleCadena(antecesor, partes, siguiente)) {
      return true;
    }
    if (hijoDirecto) {
      return false;
    }
  }
  return false;
}

/** Si algún elemento del documento cumple el selector, sin pseudoclases ni pseudoelementos. */
function tieneDestino(selector: string, elementos: readonly Elemento[], dinamicos: readonly string[]): boolean {
  if (dinamicos.includes(selector)) {
    return true;
  }
  const partes = selector
    .replace(/::?[\w-]+(?:\([^)]*\))?/g, '')
    .replace(/\s*>\s*/g, ' > ')
    .trim()
    .split(/\s+/)
    .map((parte) => parte || '*');
  return elementos.some((elemento) => cumpleCadena(elemento, partes, partes.length - 1));
}

/** Reglas sin destino y reglas anuladas enteras por otras posteriores, descritas para el mensaje de error. */
function problemasDelEstilo(html: string, selectoresDinamicos: readonly string[] = []): string[] {
  const css = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1];
  assert.ok(css, 'la página no tiene estilo');
  const elementos = elementosDe(html);
  const reglas = reglasDe(css);
  const problemas: string[] = [];
  for (const [posicion, { contexto, selectores, propiedades }] of reglas.entries()) {
    for (const selector of selectores) {
      const donde = `${contexto ? `${contexto} ` : ''}${selector}`;
      if (!tieneDestino(selector, elementos, selectoresDinamicos)) {
        problemas.push(`sin destino: ${donde}`);
        continue;
      }
      const posteriores = new Set(
        reglas
          .slice(posicion + 1)
          .filter((otra) => otra.contexto === contexto && otra.selectores.includes(selector))
          .flatMap((otra) => otra.propiedades),
      );
      if (propiedades.every((propiedad) => posteriores.has(propiedad))) {
        problemas.push(`anulada por otra posterior: ${donde}{${propiedades.join(';')}}`);
      }
    }
  }
  return problemas;
}

test('cada regla de la portada tiene destino en el HTML o en un estado del reloj y ninguna queda anulada entera', () => {
  assert.deepEqual(problemasDelEstilo(PORTADA_PUBLICA, SELECTORES_DEL_RELOJ), []);
});

test('cada regla del CSS de la pantalla de acceso tiene destino en su HTML y ninguna queda anulada entera', () => {
  assert.deepEqual(problemasDelEstilo(PAGINA_ACCESO_WEB), []);
});

test('la guardia señala selectores sin destino y reglas anuladas, y acepta estados, pseudoclases e hijos', () => {
  const html =
    '<!doctype html><html data-tema="oscuro"><head><style>' +
    '.caja h2{margin:0}.caja>p{margin:0}html[data-guion] .caja{color:red}.caja a:hover{color:blue}' +
    'main>.caja{color:red}@media(max-width:700px){.caja{color:red}.caja{color:blue;margin:0}}' +
    '@font-face{font-family:X;src:url(data:font/woff2;base64,AAAA)}@keyframes f{from{opacity:0}to{opacity:1}}' +
    '</style></head><body><main><div class="caja"><a href="/">x</a></div></main></body></html>';
  assert.deepEqual(problemasDelEstilo(html), [
    'sin destino: .caja h2',
    'sin destino: .caja>p',
    'anulada por otra posterior: @media(max-width:700px) .caja{color}',
  ]);
});

test('los estados del reloj no amparan otra clase ni otro antecesor', () => {
  const html = '<style>.digito{color:red}.reloj .digito{color:red}.digito.otro{color:red}</style>';
  assert.deepEqual(problemasDelEstilo(html, SELECTORES_DEL_RELOJ), [
    'sin destino: .reloj .digito',
    'sin destino: .digito.otro',
  ]);
  assert.ok(problemasDelEstilo(html).includes('sin destino: .digito'));
});
