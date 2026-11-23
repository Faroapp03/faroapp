// El informe breve en pantalla (web/estilos/informe-breve.css): la hoja no es más ancha que la ventana, la letra del
// cuerpo no baja de 14 px en una hoja estrecha, el folio del pie no se parte en dos líneas, solo el papel es claro en
// el tema de noche y el rótulo del anillo cabe en su hueco. Lo impreso tiene sus propias pruebas
// (informe-breve-impreso-completo.test.ts).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const CSS = readFileSync(new URL('../../web/estilos/informe-breve.css', import.meta.url), 'utf8');
const ANILLO = readFileSync(
  new URL('../../src/presentacion/informe-breve/tarjetas-contexto.ts', import.meta.url),
  'utf8',
);

/** Una regla con su selector, la condición de @media que la envuelve (o '' si no hay) y sus declaraciones. */
interface Regla {
  medios: string;
  selector: string;
  declaraciones: Map<string, string>;
}

/** @returns las declaraciones de un bloque, propiedad → valor. */
function declaracionesDe(bloque: string): Map<string, string> {
  const declaraciones = new Map<string, string>();
  for (const declaracion of bloque.split(';')) {
    const dos = declaracion.indexOf(':');
    if (dos > 0) {
      declaraciones.set(declaracion.slice(0, dos).trim(), declaracion.slice(dos + 1).trim());
    }
  }
  return declaraciones;
}

/** @returns la condición de la @media que envuelve un bloque, o '' si no hay ninguna. */
function mediosDe(abiertos: readonly string[]): string {
  return abiertos.find((prelude) => prelude.startsWith('@media'))?.replace(/^@media\s*/u, '') ?? '';
}

/** Las reglas de la hoja, sin comentarios. Basta para esta hoja: @media de un nivel y reglas sin anidar. */
function reglas(css: string): Regla[] {
  const limpio = css.replace(/\/\*[\s\S]*?\*\//gu, '');
  const encontradas: Regla[] = [];
  const abiertos: string[] = [];
  let desde = 0;
  // Cada llave abre o cierra un bloque: al abrir se guarda lo que la precede (selector o @regla); al cerrar una regla,
  // lo escrito desde la última llave son sus declaraciones.
  for (const { 0: llave, index } of limpio.matchAll(/[{}]/gu)) {
    if (llave === '{') {
      abiertos.push(limpio.slice(desde, index).trim());
    } else {
      const selector = abiertos.pop() ?? '';
      if (!selector.startsWith('@')) {
        const declaraciones = declaracionesDe(limpio.slice(desde, index));
        encontradas.push({ medios: mediosDe(abiertos), selector: selector.replace(/\s+/gu, ' '), declaraciones });
      }
    }
    desde = index + 1;
  }
  return encontradas;
}

const REGLAS = reglas(CSS);

/** @returns los valores que da a una propiedad cada regla con esa condición de @media. */
function valores(propiedad: string, medios: string): string[] {
  return REGLAS.filter((regla) => regla.medios === medios && regla.declaraciones.has(propiedad)).map(
    (regla) => regla.declaraciones.get(propiedad) ?? '',
  );
}

test('el ancho de la hoja nunca supera el de su contenedor', () => {
  const anchos = REGLAS.flatMap(({ medios, declaraciones }) =>
    declaraciones.has('--ancho-hoja') ? [`${medios || 'todas'} → ${declaraciones.get('--ancho-hoja')}`] : [],
  );
  assert.ok(anchos.length > 0, 'la hoja declara su ancho');
  // 100 % o el menor entre una medida y el 100 %: en una ventana estrecha la hoja se adapta y no desborda.
  for (const ancho of anchos) {
    assert.match(ancho, /→ (?:100%|min\([^,]+,\s*100%\))$/u, ancho);
  }
});

test('en pantalla la letra del cuerpo no baja de 14 px aunque la hoja sea estrecha', () => {
  const MINIMO_PX = 14;
  for (const propiedad of ['--t-xs', '--t-s', '--ib-s']) {
    const enPantalla = valores(propiedad, 'screen');
    assert.equal(enPantalla.length, 1, `${propiedad} tiene una medida de pantalla`);
    const suelo = /^max\((\d+(?:\.\d+)?)px,\s*[\d.]+cqi\)$/u.exec(enPantalla[0] ?? '');
    assert.ok(suelo && Number(suelo[1]) >= MINIMO_PX, `${propiedad}: ${enPantalla[0]}`);
    // Ninguna regla de un ancho concreto la vuelve a fijar por debajo del suelo.
    const porAncho = REGLAS.filter(
      ({ medios, declaraciones }) => /^screen and/u.test(medios) && declaraciones.has(propiedad),
    );
    assert.deepEqual(porAncho, [], propiedad);
  }
});

test('en pantalla el folio del pie no se parte en dos líneas', () => {
  const folio = REGLAS.filter(({ selector }) => selector === '.informe-breve .hoja-pie-folio');
  const enPantalla = folio.filter(({ medios }) => medios === 'screen');
  assert.equal(enPantalla.length, 1);
  assert.equal(enPantalla[0]?.declaraciones.get('white-space'), 'nowrap');
  // Lo impreso no cambia: ninguna regla de papel le toca el espacio en blanco.
  assert.deepEqual(
    folio.filter(({ medios, declaraciones }) => medios !== 'screen' && declaraciones.has('white-space')),
    [],
  );
});

test('solo el papel es claro: el cierre y sus avisos siguen el tema de la página', () => {
  const raiz = REGLAS.filter(({ selector, medios }) => selector === '.informe-breve' && medios === '');
  assert.ok(raiz.length > 0);
  for (const { declaraciones } of raiz) {
    assert.equal(declaraciones.has('color-scheme'), false, 'la raíz del informe no fija un esquema de color');
    assert.equal(declaraciones.has('color'), false, 'la raíz del informe no fija la tinta del papel');
  }
  const papel = REGLAS.find(({ selector }) => selector === '.informe-breve :is(.hoja, .ib-contexto)');
  assert.equal(papel?.declaraciones.get('color-scheme'), 'light');
  assert.equal(papel?.declaraciones.get('color'), 'var(--tinta)');
  // Ninguna otra regla de pantalla devuelve el esquema claro a lo que no es papel.
  const otras = REGLAS.filter(
    ({ selector, medios, declaraciones }) =>
      declaraciones.has('color-scheme') && medios !== 'print' && selector !== papel?.selector,
  );
  assert.deepEqual(otras, []);
});

test('el rótulo del anillo cabe en su hueco con dos cifras y en catalán', () => {
  // El rótulo más ancho, «de 12 tasques» en 0,875rem bajo la cifra, necesita un hueco de 56 px de radio: medido en
  // Chromium con la letra de la página, de esquina a centro.
  const RADIO_NECESARIO_PX = 56;
  const REM_PX = 16;
  const circulo = /viewBox="0 0 (\d+) \d+"[^>]*>\s*<circle cx="\d+" cy="\d+" r="(\d+)"/u.exec(ANILLO);
  assert.ok(circulo, 'el anillo es un círculo dentro de su viewBox');
  const [lado, radio] = [Number(circulo[1]), Number(circulo[2])];
  const regla = (selector: string) => REGLAS.find((r) => r.selector === selector && r.medios === '');
  const trazo = Number(regla('.informe-breve .ib-anillo svg')?.declaraciones.get('stroke-width'));
  assert.ok(trazo > 0, 'el anillo declara el grosor de su trazo');
  const anillo = regla('.informe-breve .ib-anillo');
  const ancho = /^min\(100%,\s*([\d.]+)rem\)$/u.exec(anillo?.declaraciones.get('width') ?? '');
  assert.ok(ancho, 'el anillo declara su ancho en rem');
  const hueco = ((radio - trazo / 2) / lado) * Number(ancho[1]) * REM_PX;
  assert.ok(hueco >= RADIO_NECESARIO_PX, `hueco de ${hueco} px`);
  assert.equal(regla('.informe-breve .ib-anillo-unidad')?.declaraciones.get('font-size'), '0.875rem');
});
