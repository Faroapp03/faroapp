// El papel conserva las dos hojas del informe, con la serie anual en tabla y las consultas ampliadas en pantalla.
// No se abrevian tareas ni se reduce la letra; el folio dice la página real.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { type DefaultTreeAdapterTypes, parse, parseFragment } from 'parse5';
import { construirInforme } from '../../src/dominio/informe.ts';
import { construirInformeBreve } from '../../src/dominio/informe-breve.ts';
import { cargarDatos } from '../../src/plataforma/node/datos.ts';
import { columnasPorAnio, ROTULO_IMPRESO, semicirculo } from '../../src/presentacion/informe-breve/graficos.ts';
import { texto } from '../../src/presentacion/informe-breve/idioma.ts';
import { renderizarInformeBreve } from '../../src/presentacion/informe-breve.ts';

type Nodo = DefaultTreeAdapterTypes.Node;
type Regla = { selectores: string[]; declaraciones: Map<string, string>; impresion: boolean; exclusiva: boolean };

const CSS = readFileSync(new URL('../../web/estilos/informe-breve.css', import.meta.url), 'utf8');
const IMPRESION_JS = readFileSync(new URL('../../web/scripts/pdf/impresion.js', import.meta.url), 'utf8');
const DATOS = cargarDatos(fileURLToPath(new URL('../../datos/', import.meta.url)));
// La letra más pequeña de la hoja de impresión aprobada: el monoespaciado de la banda, 1,15 % del ancho A4 (6,846 pt),
// medida en el PDF del ejemplo aprobado como 6,84 pt.
const MINIMO_PT = 6.84;
// La hoja impresa mide 210 mm de ancho: 1cqi son 2,1 mm; una pulgada, 72 pt y 25,4 mm.
const MM_POR_CQI = 2.1;
const PUNTOS_POR_PULGADA = 72;
const MM_POR_PULGADA = 25.4;
// Los contratos por año del ejemplo publicado: seis años, con caída desde el máximo.
const CONTRATOS = '7611 10041 10179 9221 9332 9385'.split(' ').map(Number);
// Un máximo por encima de todos los contratos del ejemplo, para ponerlo en el año que se quiera.
const MAXIMO_DE_PRUEBA = 13179;
// El máximo en el antepenúltimo, en el penúltimo y en el primero de los seis años.
const ANIOS_DEL_MAXIMO = '3 4 0'.split(' ').map(Number);
// La base del rótulo, al menos 3 unidades por encima de la línea del corchete: la tinta no la toca.
const SOBRE_LA_LINEA = 3;
// Dos y tres años de datos: un gráfico más estrecho que el rótulo de la caída.
const POCOS_ANIOS = '2 3'.split(' ').map(Number);
const LETRA_DEL_GRAFICO = '.informe-breve .ib-columnas-v2 text';
// La escala «de 100» del indicador, su último texto, y el alto del indicador al imprimir. En papel la figura tiene alto
// fijo (--ib-fig-h, 13,2cqi de la hoja A4) y el SVG ocupa lo que dejan sus rellenos, sus bordes y el pie de figura: sus
// 112 unidades de alto miden 73,6 px (escala 0,657), medido en Chromium y en Firefox. No se deriva del CSS porque depende
// del alto real del pie de figura (su letra y sus líneas); el tamaño impreso real lo mide la batería de navegadores en el
// PDF (comprobarLetraDelPdf, pruebas/navegadores/recorrido.ts). 1 px son 0,75 pt.
const LETRA_DE_LA_ESCALA = '.informe-breve .ib-indicador text:last-of-type';
const ALTO_IMPRESO_DEL_INDICADOR_PX = 73.6;
const PT_POR_PX = 0.75;
// Una exposición de ejemplo y su margen entre modelos.
const EXPOSICION = 62;
const MARGEN_DE_LA_EXPOSICION = '60 65'.split(' ').map(Number) as [number, number];
const TAREAS = 30;
// Lo único que la impresión puede ocultar: los botones del final, el número de hoja de pantalla (lo sustituye el folio
// de la página) y lo que la página autónoma pone fuera del informe.
const OCULTABLES = new Set([
  '.informe-breve .ib-cierre',
  '.informe-breve .ib-folio-hoja',
  '.informe-breve .hoja-pie-folio',
  'body:has(> main.informe-breve) > :not(main.informe-breve)',
]);
// Recortes que se aplican también al imprimir y no ocultan nada que se vea: el texto para lectores de pantalla, que
// tampoco se ve en pantalla, y la altura del gráfico de columnas, igual en pantalla y en papel (el SVG se escala dentro).
const RECORTES_SIN_OCULTAR = new Set(['.informe-breve .solo-lectores', '.informe-breve .ib-columnas-v2']);
// Lo único que impresion.js puede cambiar mientras se imprime: el título y el idioma.
const OCULTAR_DESDE_JS =
  /\.hidden\b|\.style\b|classList\.(?:add|remove|toggle|replace)|setAttribute|removeAttribute|\.remove\(|removeChild|replaceChildren|replaceWith|innerHTML|outerHTML|textContent\s*=|innerText\s*=|insertRule|adoptedStyleSheets|CSSStyleSheet/u;

/** El índice que sigue a la llave que cierra la que abre en `abre`. */
function cierre(texto: string, abre: number): number {
  let nivel = 1;
  let fin = abre + 1;
  while (nivel > 0 && fin < texto.length) {
    if (texto[fin] === '{') {
      nivel += 1;
    } else if (texto[fin] === '}') {
      nivel -= 1;
    }
    fin += 1;
  }
  return fin;
}

/** Las consultas de un @media: si alguna se aplica al imprimir (no se limita a screen) y si alguna es solo de impresión
 * (nombra print, con o sin only, o niega screen). */
function medio(cabecera: string): { conImpresion: boolean; nombraImpresion: boolean } {
  const consultas = cabecera
    .slice('@media'.length)
    .split(',')
    .map((consulta) => consulta.trim().toLowerCase());
  const soloPantalla = (consulta: string) => /^(only\s+)?screen\b|^not\s+print\b/u.test(consulta);
  return {
    conImpresion: consultas.some((consulta) => !soloPantalla(consulta)),
    nombraImpresion: consultas.some((consulta) => /^(only\s+)?print\b|^not\s+screen\b/u.test(consulta)),
  };
}

/** Los selectores de una regla anidada: «&» es el de la regla que la contiene; sin «&», es un descendiente suyo. */
function anidados(padres: readonly string[], cabecera: string): string[] {
  const propios = cabecera.split(',').map((selector) => selector.trim().replace(/\s+/gu, ' '));
  if (padres.length === 0) {
    return propios;
  }
  return padres.flatMap((padre) =>
    propios.map((selector) => (selector.includes('&') ? selector.replaceAll('&', padre) : `${padre} ${selector}`)),
  );
}

/** Las reglas de estilo con sus declaraciones, también las anidadas y las de dentro de @supports, @container o @layer;
 * si se aplican al imprimir (fuera de @media o en uno que no se limita a screen) y si son exclusivas de impresión
 * (dentro de un @media que nombra print o niega screen, o @page). */
function reglas(css: string): Regla[] {
  const salida: Regla[] = [];
  leerBloque(css.replace(/\/\*[\s\S]*?\*\//gu, ''), { impresion: true, exclusiva: false, padres: [] }, salida);
  return salida;
}

type Contexto = { impresion: boolean; exclusiva: boolean; padres: readonly string[] };

/** Las reglas de un bloque (la hoja entera, el cuerpo de una regla o el de una regla @), en orden. */
function leerBloque(texto: string, contexto: Contexto, salida: Regla[]): void {
  let i = 0;
  for (let abre = texto.indexOf('{'); abre >= 0; abre = texto.indexOf('{', i)) {
    // En el cuerpo de una regla, lo anterior a la regla anidada son declaraciones de la que la contiene.
    const cabecera = (texto.slice(i, abre).split(/[;}]/u).at(-1) ?? '').trim();
    const fin = cierre(texto, abre);
    const cuerpo = texto.slice(abre + 1, fin - 1);
    i = fin;
    if (cabecera.startsWith('@page')) {
      salida.push({
        selectores: [cabecera],
        declaraciones: declaraciones(cuerpo),
        impresion: contexto.impresion,
        exclusiva: true,
      });
    } else if (cabecera.startsWith('@')) {
      leerArroba(cabecera, cuerpo, contexto, salida);
    } else {
      const selectores = anidados(contexto.padres, cabecera);
      salida.push({
        selectores,
        declaraciones: declaraciones(cuerpo),
        impresion: contexto.impresion,
        exclusiva: contexto.exclusiva,
      });
      leerBloque(cuerpo, { ...contexto, padres: selectores }, salida);
    }
  }
}

/** Una regla @ que agrupa reglas (@media, @supports, @container, @layer…): sus reglas, con lo que dice su consulta. */
function leerArroba(cabecera: string, cuerpo: string, contexto: Contexto, salida: Regla[]): void {
  const consulta = cabecera.startsWith('@media') ? medio(cabecera) : { conImpresion: true, nombraImpresion: false };
  const dentro = {
    impresion: contexto.impresion && consulta.conImpresion,
    exclusiva: contexto.exclusiva || consulta.nombraImpresion,
    padres: contexto.padres,
  };
  // Dentro de una regla, un @media o un @supports pueden llevar declaraciones de esa misma regla.
  if (contexto.padres.length > 0) {
    salida.push({
      selectores: [...contexto.padres],
      declaraciones: declaraciones(cuerpo),
      impresion: dentro.impresion,
      exclusiva: dentro.exclusiva,
    });
  }
  leerBloque(cuerpo, dentro, salida);
}

/** Las declaraciones propias de un cuerpo, sin las de sus reglas anidadas (a cualquier profundidad). */
function declaraciones(cuerpo: string): Map<string, string> {
  let sinAnidados = cuerpo;
  for (let antes = ''; antes !== sinAnidados; ) {
    antes = sinAnidados;
    sinAnidados = sinAnidados.replace(/[^;{}]*\{[^{}]*\}/gu, '');
  }
  return new Map(
    sinAnidados
      .split(';')
      .map((parte) => parte.split(':'))
      .filter((partes) => partes.length >= 2)
      .map(([nombre, ...valor]) => [(nombre ?? '').trim(), valor.join(':').trim()]),
  );
}

function textos(nodo: Nodo, dentroDe: string | null, clase: string, salida: { texto: string; dentro: boolean }[]) {
  const propia =
    'tagName' in nodo && nodo.attrs.some(({ name, value }) => name === 'class' && value.split(' ').includes(clase));
  const marca = propia ? clase : dentroDe;
  if ('value' in nodo && 'nodeName' in nodo && nodo.nodeName === '#text') {
    salida.push({ texto: nodo.value, dentro: marca !== null });
  }
  if ('childNodes' in nodo) {
    for (const hijo of nodo.childNodes) {
      textos(hijo, marca, clase, salida);
    }
  }
  return salida;
}

function conClase(nodo: Nodo, clase: string): Nodo[] {
  const propios =
    'tagName' in nodo && nodo.attrs.some(({ name, value }) => name === 'class' && value.split(' ').includes(clase))
      ? [nodo]
      : [];
  return [...propios, ...('childNodes' in nodo ? nodo.childNodes.flatMap((hijo) => conClase(hijo, clase)) : [])];
}

/** Los recortes (overflow, max-height, clip-path o clip) que siguen en vigor al imprimir, por selector y propiedad. */
function recortesEnVigor(deImpresion: readonly Regla[]): string[] {
  const recorta: Record<string, (valor: string) => boolean> = {
    overflow: (valor) => /hidden|clip/u.test(valor),
    'overflow-x': (valor) => /hidden|clip/u.test(valor),
    'overflow-y': (valor) => /hidden|clip/u.test(valor),
    'max-height': (valor) => /\d/u.test(valor),
    'clip-path': (valor) => valor !== 'none',
    clip: (valor) => valor !== 'auto',
  };
  // La última declaración de cada selector y propiedad es la que queda al imprimir (mismo selector, mismo peso).
  const ultimas = new Map<string, { selector: string; recorta: boolean }>();
  for (const { selectores, declaraciones: d } of deImpresion) {
    for (const [nombre, valor] of d) {
      for (const selector of nombre in recorta ? selectores : []) {
        ultimas.set(`${selector} → ${nombre}`, { selector, recorta: recorta[nombre]?.(valor) === true });
      }
    }
  }
  return [...ultimas]
    .filter(
      ([, { selector, recorta: si }]) =>
        si && !RECORTES_SIN_OCULTAR.has(selector) && !/::(?:before|after)$/u.test(selector),
    )
    .map(([clave]) => clave);
}

/** Lo que amplía, reduce o transforma la hoja al imprimir: zoom, scale, transform que no sea un desplazamiento y anchos
 * de la hoja o del documento distintos del A4. */
function cambiosDeTamano(deImpresion: readonly Regla[]): string[] {
  const deLaHoja = (selectores: readonly string[]) => selectores.some((s) => /\.(?:hoja|documento)$/u.test(s));
  return deImpresion.flatMap(({ selectores, declaraciones: d, exclusiva }) =>
    [...d.entries()]
      .filter(
        ([nombre, valor]) =>
          (nombre === 'zoom' && !/^(?:normal|1|100%)$/u.test(valor)) ||
          (nombre === 'scale' && valor !== 'none') ||
          (nombre === 'transform' && !/^(?:none|(?:translate[XYZ3d]*\([^)]*\)\s*)+)$/u.test(valor)) ||
          (exclusiva && /^(?:min-|max-)?width$/u.test(nombre) && deLaHoja(selectores) && valor !== '210mm'),
      )
      .map(([nombre, valor]) => `${selectores.join(', ')} → ${nombre}: ${valor}`),
  );
}

const DE_IMPRESION = reglas(CSS).filter(({ impresion }) => impresion);

test('solo las consultas ampliadas, las tareas que no caben y el gráfico sustituido por tabla quedan fuera del papel', () => {
  const ocultos = DE_IMPRESION.filter(
    ({ declaraciones: d }) =>
      d.get('display') === 'none' ||
      /hidden|collapse/u.test(d.get('visibility') ?? '') ||
      /^0*(?:\.0*)?%?$/u.test(d.get('opacity') ?? '1') ||
      d.get('content-visibility') === 'hidden',
  ).flatMap(({ selectores }) => selectores.filter((selector) => !OCULTABLES.has(selector)));
  // La tabla y la línea de las tareas que faltan están ocultas en pantalla y se muestran en papel; las consultas, las
  // tareas que no caben en la hoja 1 (data-solo-pantalla) y el gráfico permanecen en pantalla.
  assert.deepEqual(ocultos, [
    '.informe-breve .ib-tareas-fuera',
    '.informe-breve [data-solo-pantalla]',
    '.informe-breve .ib-serie-papel',
    '.informe-breve .ib-contexto',
    '.informe-breve .ib-figura-ancha',
  ]);
  const tabla = DE_IMPRESION.filter(({ selectores }) => selectores.includes('.informe-breve .ib-serie-papel'));
  assert.equal(tabla.at(-1)?.declaraciones.get('display'), 'block');
  const linea = DE_IMPRESION.filter(({ selectores }) => selectores.includes('.informe-breve .ib-tareas-fuera'));
  assert.equal(linea.at(-1)?.declaraciones.get('display'), 'block');
  assert.doesNotMatch(CSS, /data-sintesis/u);
  assert.doesNotMatch(IMPRESION_JS, /sintesis|dataset\./iu);
  // Tampoco desde JS: impresion.js no oculta, quita ni reescribe nada del informe al imprimir.
  assert.doesNotMatch(IMPRESION_JS.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gmu, ''), OCULTAR_DESDE_JS);
});

test('al imprimir la hoja mide el ancho A4 y nada la amplía, la reduce ni la transforma', () => {
  // La letra de la hoja va en unidades del ancho de su contenedor (cqi): el ancho de la hoja fija el tamaño impreso.
  for (const selector of ['.informe-breve .hoja', '.informe-breve .documento']) {
    const ancho = DE_IMPRESION.filter(
      ({ selectores, declaraciones: d }) => selectores.includes(selector) && d.has('width'),
    );
    assert.equal(ancho.at(-1)?.declaraciones.get('width'), '210mm', selector);
  }
  assert.deepEqual(cambiosDeTamano(DE_IMPRESION), []);
});

test('al imprimir no hay recortes ni puntos suspensivos, y la hoja crece con su contenido', () => {
  for (const { selectores, declaraciones: d, exclusiva } of DE_IMPRESION) {
    const donde = selectores.join(', ');
    assert.notEqual(d.get('text-overflow'), 'ellipsis', donde);
    assert.equal(d.get('-webkit-line-clamp') ?? d.get('line-clamp'), undefined, donde);
    if (exclusiva) {
      assert.doesNotMatch(d.get('max-height') ?? '', /\d/u, donde);
      assert.notEqual(d.get('overflow'), 'hidden', donde);
    }
  }
  // La hoja impresa no tiene alto ni proporción: ninguna regla que se aplique al imprimir se los da (tampoco las
  // generales), y su overflow no recorta (recortesEnVigor, más abajo).
  const medidasDeLaHoja = DE_IMPRESION.flatMap(({ selectores, declaraciones: d }) =>
    selectores.some((selector) => /\.hoja(?:[.:[]|$)/u.test(selector))
      ? ['height', 'min-height', 'max-height', 'aspect-ratio']
          .filter((propiedad) => d.has(propiedad) && !/^(?:auto|none)$/u.test(d.get(propiedad) ?? ''))
          .map((propiedad) => `${selectores.join(', ')} → ${propiedad}: ${d.get(propiedad)}`)
      : [],
  );
  assert.deepEqual(medidasDeLaHoja, []);
  for (const { selectores, declaraciones: d } of DE_IMPRESION) {
    if (selectores.some((selector) => selector.includes('.hoja'))) {
      assert.doesNotMatch(d.get('height') ?? '', /mm|cm|in|px/u, selectores.join(', '));
    }
  }
  // Las reglas generales también se imprimen: ningún recorte (overflow, max-height, clip-path o clip) queda en vigor al
  // imprimir, salvo los que no ocultan nada y los adornos sin texto (::before y ::after).
  assert.deepEqual(recortesEnVigor(DE_IMPRESION), []);
});

test('la impresión no reduce la letra: el papel usa los tamaños de la hoja aprobada', () => {
  const exclusivas = DE_IMPRESION.filter(({ exclusiva }) => exclusiva);
  // Ninguna regla exclusiva de impresión cambia el tamaño de letra ni redefine las medidas de letra de la hoja.
  const medidasDeLetra = /^--(t-xs|t-s|t-m|ib-mono|ib-h1|ib-cifra|ib-s|ib-bluf|ib-h3|ib-fig-num)$/u;
  // Las nuevas piezas tienen su propio tamaño en papel y su control de legibilidad.
  const nuevas =
    /^\.informe-breve \.(?:ib-carta|ib-anillo|ib-fuente-breve|ib-barras-compactas|ib-mes-nombre|ib-bloque-tareas > \.ib-seccion|ib-subtitulo-tareas|ib-mercado \.ib-(?:estado|tarjeta-titulo))/u;
  const minimoCarta = 1.15;
  for (const { selectores, declaraciones } of exclusivas) {
    if (selectores.every((selector) => nuevas.test(selector) || selector === '.informe-breve .ib-carta-eje')) {
      const tamano = declaraciones.get('font-size');
      if (tamano) {
        const cqi = /^([\d.]+)cqi$/u.exec(tamano);
        assert.ok(cqi && Number(cqi[1]) >= minimoCarta, tamano);
      }
    }
  }
  const cambios = exclusivas
    .filter(({ selectores }) => !selectores.some((selector) => nuevas.test(selector)))
    .filter(({ selectores }) => !selectores[0]?.startsWith('@page'))
    .flatMap(({ selectores, declaraciones: d }) =>
      [...d.keys()]
        .filter((nombre) => nombre === 'font-size' || nombre === 'font' || medidasDeLetra.test(nombre))
        // Solo el font-size de las reglas del gráfico de columnas y de la escala del indicador, que únicamente pueden
        // subir: se comprueba más abajo.
        .filter(
          (nombre) =>
            !(
              nombre === 'font-size' &&
              selectores.length === 1 &&
              [LETRA_DEL_GRAFICO, LETRA_DE_LA_ESCALA].includes(selectores[0] ?? '')
            ),
        )
        .map((nombre) => `${selectores.join(', ')} → ${nombre}: ${d.get(nombre)}`),
    );
  assert.deepEqual(cambios, []);
  // El folio de la página, que no está en la hoja, no baja de la letra más pequeña de la hoja aprobada.
  for (const { selectores, declaraciones: d } of exclusivas.filter(({ selectores: s }) => s[0]?.startsWith('@page'))) {
    const valor = d.get('font-size');
    if (valor !== undefined) {
      const pt = /^([\d.]+)pt$/u.exec(valor);
      assert.ok(pt && Number(pt[1]) >= MINIMO_PT, `${selectores.join(', ')}: ${valor}`);
    }
  }
});

test('al imprimir, el texto del gráfico de columnas sube a la letra mínima de la hoja aprobada y nunca baja', () => {
  // El SVG se escala a la altura máxima de su regla general (en cqi de la hoja A4): cada unidad de su viewBox mide
  // alto × 2,1 mm / alto del viewBox. Ningún texto del gráfico, con la letra de impresión, baja de la letra mínima, y
  // esa letra no es menor que ninguna de las de pantalla.
  const altoMaximo = DE_IMPRESION.findLast(
    ({ selectores, declaraciones: d }) => selectores.includes('.informe-breve .ib-columnas-v2') && d.has('max-height'),
  )?.declaraciones.get('max-height');
  const cqi = /^([\d.]+)cqi$/u.exec(altoMaximo ?? '')?.[1];
  assert.ok(cqi, `altura máxima del gráfico en cqi: ${altoMaximo}`);
  const svg = columnasPorAnio({
    etiquetas: ['2020-21', '2021-22', '2022-23', '2023-24', '2024-25', '2025-26'],
    valores: CONTRATOS,
    publicado: [false, false, false, false, false, true],
    caida: '−8 % desde el máximo',
    letrasDeLaCaida: 0,
    rotulo: 'Contratos por año',
  });
  const altoDelViewBox = Number(/viewBox="0 0 [\d.]+ ([\d.]+)"/u.exec(svg)?.[1]);
  const deLaPantalla = [...svg.matchAll(/font-size="([\d.]+)"/gu)].map(([, tamano]) => Number(tamano));
  assert.ok(altoDelViewBox > 0 && deLaPantalla.length > 0);
  const reglas = DE_IMPRESION.filter(
    ({ selectores, exclusiva }) => exclusiva && selectores.includes(LETRA_DEL_GRAFICO),
  );
  const impresa = Number(/^([\d.]+)px$/u.exec(reglas.at(-1)?.declaraciones.get('font-size') ?? '')?.[1]);
  const ptPorUnidad = (Number(cqi) * MM_POR_CQI * PUNTOS_POR_PULGADA) / MM_POR_PULGADA / altoDelViewBox;
  assert.ok(impresa * ptPorUnidad >= MINIMO_PT, `${impresa} unidades son ${(impresa * ptPorUnidad).toFixed(2)} pt`);
  assert.ok(impresa >= Math.max(...deLaPantalla), 'la letra del gráfico no baja al imprimir');
  // En pantalla, el gráfico conserva sus tamaños: la regla solo existe dentro de la impresión.
  assert.ok(
    DE_IMPRESION.filter(({ selectores }) => selectores.includes(LETRA_DEL_GRAFICO)).every(({ exclusiva }) => exclusiva),
  );
});

test('al imprimir, el «de 100» del indicador sube a la letra mínima de la hoja aprobada en el CSS de la aplicación', () => {
  // El «de 100» es el último texto del indicador, y el único de su tamaño: la regla no toca la cifra.
  const svg = semicirculo(EXPOSICION, MARGEN_DE_LA_EXPOSICION, `${EXPOSICION} de 100`, 'de 100');
  const altoDelViewBox = Number(/viewBox="0 0 [\d.]+ ([\d.]+)"/u.exec(svg)?.[1]);
  assert.ok(altoDelViewBox > 0);
  const textos = [...svg.matchAll(/<text [^>]*font-size="([\d.]+)"[^>]*>([^<]*)<\/text>/gu)];
  assert.equal(textos.length, 2);
  assert.equal(textos.at(-1)?.[2], 'de 100');
  const deLaPantalla = Number(textos.at(-1)?.[1]);
  for (const ruta of ['../../web/estilos/informe-breve.css']) {
    const deImpresion = reglas(readFileSync(new URL(ruta, import.meta.url), 'utf8')).filter(
      ({ impresion }) => impresion,
    );
    const propias = deImpresion.filter(({ selectores }) => selectores.includes(LETRA_DE_LA_ESCALA));
    assert.ok(propias.length > 0, `${ruta}: regla de la escala del indicador en papel`);
    // En pantalla, el indicador conserva su tamaño: la regla solo existe dentro de la impresión.
    assert.ok(
      propias.every(({ exclusiva }) => exclusiva),
      `${ruta}: la regla es solo de impresión`,
    );
    const impresa = Number(/^([\d.]+)px$/u.exec(propias.at(-1)?.declaraciones.get('font-size') ?? '')?.[1]);
    const puntos = ((impresa * ALTO_IMPRESO_DEL_INDICADOR_PX) / altoDelViewBox) * PT_POR_PX;
    assert.ok(puntos >= MINIMO_PT, `${ruta}: ${impresa} unidades son ${puntos.toFixed(2)} pt`);
    assert.ok(impresa >= deLaPantalla, `${ruta}: la letra del indicador no baja al imprimir`);
  }
});

/** Las piezas del corchete de un gráfico de columnas: su línea con las dos patillas, el rótulo y el ancho del gráfico. */
function corcheteDe(svg: string) {
  const trazo =
    /<path d="M([\d.]+),([\d.]+) L([\d.]+),([\d.]+) L([\d.]+),([\d.]+) L([\d.]+),([\d.]+)" fill="none"/u.exec(svg);
  const rotulo = /<text x="([\d.]+)" y="([\d.]+)"[^>]*>(−[^<]*)<\/text>/u.exec(svg);
  const total = Number(/viewBox="0 0 ([\d.]+) /u.exec(svg)?.[1]);
  assert.ok(trazo && rotulo && total > 0, 'el gráfico lleva corchete y rótulo');
  const [, x1, patillaDelMaximo, , linea, x2, , , patillaDelUltimo] = trazo.map(Number);
  return {
    desde: x1 ?? 0,
    hasta: x2 ?? 0,
    linea: linea ?? 0,
    patillas: [(patillaDelMaximo ?? 0) - (linea ?? 0), (patillaDelUltimo ?? 0) - (linea ?? 0)],
    x: Number(rotulo[1]),
    y: Number(rotulo[2]),
    texto: rotulo[3] ?? '',
    total,
  };
}

test('el rótulo de la caída va encima del corchete: no tapa su línea ni sus patillas ni sale del gráfico', () => {
  const impresa = DE_IMPRESION.filter(
    ({ selectores, exclusiva }) => exclusiva && selectores.includes(LETRA_DEL_GRAFICO),
  )
    .at(-1)
    ?.declaraciones.get('font-size');
  assert.equal(impresa, `${ROTULO_IMPRESO.tamano}px`);
  const idiomas = ['es', 'ca'] as const;
  // Caídas de una, dos y tres cifras.
  for (const pico of ANIOS_DEL_MAXIMO) {
    for (const caida of ['8 %', '23 %', '100 %']) {
      const letrasDeLaCaida = Math.max(
        ...idiomas.map((otro) => [...texto(otro, '−{0} desde el máximo', caida)].length),
      );
      for (const idioma of idiomas) {
        const svg = columnasPorAnio({
          etiquetas: ['2020-21', '2021-22', '2022-23', '2023-24', '2024-25', '2025-26'],
          valores: CONTRATOS.map((valor, i) => (i === pico ? MAXIMO_DE_PRUEBA : valor)),
          publicado: [false, false, false, false, false, true],
          caida: texto(idioma, '−{0} desde el máximo', caida),
          letrasDeLaCaida,
          rotulo: 'Contratos por año',
        });
        const c = corcheteDe(svg);
        const donde = `${idioma}, máximo en ${pico}, −${caida}`;
        assert.doesNotMatch(svg, /<rect/u, `${donde}: nada pinta encima del corchete`);
        assert.ok(c.hasta > c.desde && c.patillas.every((largo) => largo > 0), `${donde}: línea y dos patillas`);
        assert.ok(
          c.linea - c.y >= SOBRE_LA_LINEA && c.y - ROTULO_IMPRESO.tamano >= 0,
          `${donde}: rótulo encima de la línea, con aire, y dentro del gráfico`,
        );
        const mitad = (letrasDeLaCaida * ROTULO_IMPRESO.anchoPorLetra * ROTULO_IMPRESO.tamano) / 2;
        assert.ok(c.x - mitad >= 0 && c.x + mitad <= c.total, `${donde}: el rótulo no sale del gráfico (${c.x})`);
      }
    }
  }
});

test('con dos o tres años de datos, el rótulo de la caída cabe en el gráfico y no tapa columnas ni corchete', () => {
  for (const anios of POCOS_ANIOS) {
    for (const idioma of ['es', 'ca'] as const) {
      const rotulo = texto(idioma, '−{0} desde el máximo', '100 %');
      const svg = columnasPorAnio({
        etiquetas: Array.from({ length: anios }, (_, i) => `202${i}-2${i + 1}`),
        valores: Array.from({ length: anios }, (_, i) => (i === 0 ? MAXIMO_DE_PRUEBA : (CONTRATOS[i] ?? 0))),
        publicado: Array.from({ length: anios }, () => true),
        caida: rotulo,
        letrasDeLaCaida: [...texto('es', '−{0} desde el máximo', '100 %')].length,
        rotulo: 'Contratos por año',
      });
      const c = corcheteDe(svg);
      const mitad = ([...rotulo].length * ROTULO_IMPRESO.anchoPorLetra * ROTULO_IMPRESO.tamano) / 2;
      const donde = `${idioma}, ${anios} años`;
      assert.ok(
        c.x - mitad >= 0 && c.x + mitad <= c.total,
        `${donde}: el rótulo cabe (${c.x} ± ${mitad} en ${c.total})`,
      );
      assert.ok(c.hasta > c.desde && c.patillas.every((largo) => largo > 0), `${donde}: línea y dos patillas`);
      const columnas = [...svg.matchAll(/<path d="M([\d.]+),[\d.]+ L[\d.]+,[\d.]+ Q/gu)].map(([, x]) => Number(x));
      assert.equal(columnas.length, anios, `${donde}: todas las columnas`);
      assert.ok(
        columnas.every((x) => x >= 0 && x <= c.total),
        `${donde}: las columnas dentro del gráfico`,
      );
    }
  }
});

test('el gráfico de columnas es el mismo en es y ca: solo cambia el texto del rótulo', () => {
  let conCaida = 0;
  for (const isco08 of ['4110', '4226', '4322']) {
    const graficos = (['es', 'ca'] as const).map((idioma) => {
      const informe = construirInforme(
        { isco08, fecha: '2026-10-23', sinIa: true, tareas: [{ id: 't0', texto: 'Tarea', tiempo: 'mucho' as const }] },
        DATOS,
        { idioma, formacion: null },
      );
      const html = renderizarInformeBreve(construirInformeBreve(informe, DATOS), informe);
      return /<svg class="ib-columnas-v2"[\s\S]*?<\/svg>/u.exec(html)?.[0] ?? '';
    });
    const [es, ca] = graficos.map((svg) => svg.replace(/aria-label="[^"]*"|>[^<]*</gu, ''));
    assert.ok(es, `${isco08}: hay gráfico de columnas`);
    assert.equal(es, ca, `${isco08}: la misma geometría en es y ca`);
    conCaida += graficos[0]?.includes('desde el máximo') ? 1 : 0;
  }
  assert.ok(conCaida > 0, 'al menos un caso con caída');
});

/** Los hijos elemento de un nodo. */
function hijos(nodo: Nodo): Elemento[] {
  return 'childNodes' in nodo ? nodo.childNodes.filter((hijo): hijo is Elemento => 'tagName' in hijo) : [];
}

/** La etiqueta y las clases de un elemento («div.ib-cuerpo»). */
function firma(elemento: Elemento): string {
  const clases = (elemento.attrs.find(({ name }) => name === 'class')?.value ?? '').split(' ').filter(Boolean);
  return [elemento.tagName, ...clases].join('.');
}

// Qué valor de un atajo de margin o padding da cada lado (arriba, derecha, abajo, izquierda), según lleve 1, 2, 3 o 4.
const LADOS_DEL_ATAJO = ['0000', '0101', '0121', '0123'];
// Una tarea propia larga: con ella y muchas más, la hoja 1 puede no caber en su página.
const TAREA_LARGA = 'Atender y registrar las consultas de los clientes por teléfono, por correo y en persona';
const VECES_LA_TAREA_LARGA = 4;

/** El valor de un lado (0 arriba, 1 derecha, 2 abajo, 3 izquierda) en un atajo de margin o padding. */
function lado(atajo: string, indice: number): string | undefined {
  const valores = atajo.split(/\s+(?![^(]*\))/u).filter(Boolean);
  const posicion = LADOS_DEL_ATAJO[valores.length - 1]?.[indice];
  return posicion === undefined ? undefined : valores[Number(posicion)];
}

/** Lo que fija cada regla del selector, en orden, en un lado de margin o padding (por el atajo o por la propiedad). */
function lados(lista: readonly Regla[], selector: string, propiedad: 'margin' | 'padding', indice: number): string[] {
  const nombre = `${propiedad}-${['top', 'right', 'bottom', 'left'][indice]}`;
  return lista
    .filter(({ selectores }) => selectores.includes(selector))
    .flatMap(({ declaraciones: d }) =>
      [...d].flatMap(([propia, valor]) => {
        if (propia === nombre) {
          return [valor];
        }
        const suyo = propia === propiedad ? lado(valor, indice) : undefined;
        return suyo === undefined ? [] : [suyo];
      }),
    );
}

/** Las hojas de un informe con muchas tareas, una de ellas muy larga. */
function hojasLargas(idioma: 'es' | 'ca'): Nodo[] {
  const informe = construirInforme(
    {
      isco08: '4110',
      fecha: '2026-10-23',
      sinIa: true,
      tareas: Array.from({ length: TAREAS }, (_, i) => ({
        id: `t${i}`,
        texto: i === 0 ? Array(VECES_LA_TAREA_LARGA).fill(TAREA_LARGA).join('; ') : `Tarea ${i}`,
        tiempo: 'mucho' as const,
      })),
    },
    DATOS,
    { idioma, formacion: null },
  );
  const html = parseFragment(renderizarInformeBreve(construirInformeBreve(informe, DATOS), informe));
  return conClase(html, 'hoja');
}

test('cada hoja termina con su último bloque y su pie en un mismo cierre, y nada más va dentro', () => {
  const ultimos = ['div.ib-tuyo', 'p.ib-fuentes'];
  for (const idioma of ['es', 'ca'] as const) {
    const hojas = hojasLargas(idioma);
    assert.equal(hojas.length, 2, idioma);
    for (const [indice, hoja] of hojas.entries()) {
      const donde = `${idioma}, hoja ${indice + 1}`;
      assert.deepEqual(hijos(hoja).map(firma), ['div.ib-banda', 'div.ib-cuerpo', 'div.ib-final'], donde);
      const [, cuerpo, final] = hijos(hoja) as [Elemento, Elemento, Elemento];
      assert.deepEqual(hijos(final).map(firma), ['div.ib-cuerpo', 'footer.hoja-pie'], donde);
      const [cierreDelCuerpo] = hijos(final) as [Elemento];
      assert.deepEqual(hijos(cierreDelCuerpo).map(firma), [ultimos[indice]], donde);
      const clase = (ultimos[indice] ?? '').split('.')[1] ?? '';
      assert.equal(conClase(cuerpo, clase).length, 0, `${donde}: el último bloque no se repite en el cuerpo`);
      assert.ok(hijos(cuerpo).length > 1, `${donde}: el cuerpo conserva los demás bloques`);
    }
  }
});

test('al imprimir, el último bloque y el pie no se separan y el pie no deja aire propio en otra página', () => {
  // Firefox no respeta break-before: avoid en el pie: con una hoja que no cabe, deja en la página siguiente el pie solo
  // o su aire. El cierre (último bloque y pie) no se parte, y el aire bajo el pie lo da el margen de la página.
  const final = DE_IMPRESION.filter(
    ({ selectores, exclusiva }) => exclusiva && selectores.includes('.informe-breve .ib-final'),
  );
  assert.equal(
    final.findLast(({ declaraciones: d }) => d.has('break-inside'))?.declaraciones.get('break-inside'),
    'avoid',
  );
  for (const propiedad of ['margin', 'padding'] as const) {
    const abajo = lados(DE_IMPRESION, '.informe-breve .hoja-pie', propiedad, 2).at(-1) ?? '0';
    assert.match(abajo, /^0(?:[a-z]+)?$/u, `${propiedad} inferior del pie al imprimir: ${abajo}`);
  }
  const conRuptura = DE_IMPRESION.filter(
    ({ selectores, declaraciones: d }) => selectores.includes('.informe-breve .hoja-pie') && d.has('break-before'),
  );
  assert.equal(conRuptura.length, 0, 'el pie no depende de break-before');
});

test('en pantalla el cierre de la hoja conserva las medidas: el mismo hueco, el mismo relleno y el mismo pie', () => {
  const enPantalla = reglas(CSS).filter(({ exclusiva }) => !exclusiva);
  const ultima = (selector: string, propiedad: string) =>
    enPantalla
      .findLast(({ selectores, declaraciones: d }) => selectores.includes(selector) && d.has(propiedad))
      ?.declaraciones.get(propiedad);
  const cuerpo = '.informe-breve .ib-cuerpo';
  const cierreDelCuerpo = '.informe-breve .ib-final > .ib-cuerpo';
  // El último bloque se separa del anterior lo mismo que los demás bloques entre sí (el gap del cuerpo).
  assert.equal(ultima(cuerpo, 'gap'), 'var(--ib-gap)');
  assert.deepEqual(lados(enPantalla, cierreDelCuerpo, 'padding', 0), ['var(--ib-gap)']);
  // El relleno inferior del cuerpo pasa al cierre: 1cqi en la hoja y 64 px en el móvil.
  assert.deepEqual(lados(enPantalla, cierreDelCuerpo, 'padding', 2), ['1cqi', '64px']);
  assert.deepEqual(lados(enPantalla, cuerpo, 'padding', 0), ['0']);
  assert.deepEqual(lados(enPantalla, cuerpo, 'padding', 1), ['var(--ib-m)']);
  assert.deepEqual(lados(enPantalla, cuerpo, 'padding', 2), ['0']);
  // El cierre se compone como la hoja, en columna, y el pie conserva sus márgenes de pantalla y de móvil.
  assert.equal(ultima('.informe-breve .ib-final', 'display'), 'flex');
  assert.equal(ultima('.informe-breve .ib-final', 'flex-direction'), 'column');
  const margenes = enPantalla
    .filter(({ selectores }) => selectores.includes('.informe-breve .hoja-pie'))
    .flatMap(({ declaraciones: d }) => (d.has('margin') ? [d.get('margin')] : []));
  assert.deepEqual(margenes, ['3cqi var(--margen)', '24px var(--margen) 18px']);
});

test('el folio impreso no lleva un total fijo: lo numera la página con su total real', () => {
  const pagina = DE_IMPRESION.find(({ selectores }) => selectores[0] === '@page informe');
  assert.ok(pagina, 'el informe imprime en su propia página con nombre');
  const folio = /@page informe\s*\{[^}]*@bottom-right\s*\{([^}]*)\}/u.exec(CSS)?.[1] ?? '';
  assert.match(folio, /content:\s*counter\(page\)\s*" \/ "\s*counter\(pages\)/u);
  // El folio de la página no baja de la letra más pequeña de la hoja aprobada.
  const tamano = /font-size:\s*([\d.]+)pt/u.exec(folio)?.[1];
  assert.ok(tamano && Number(tamano) >= MINIMO_PT);
  const conPagina = DE_IMPRESION.filter(({ declaraciones: d }) => d.get('page') === 'informe').flatMap(
    ({ selectores }) => selectores,
  );
  assert.ok(conPagina.includes('.informe-breve .hoja'));
  for (const idioma of ['es', 'ca'] as const) {
    const informe = construirInforme(
      {
        isco08: '4110',
        fecha: '2026-10-23',
        sinIa: true,
        tareas: Array.from({ length: TAREAS }, (_, i) => ({
          id: `t${i}`,
          texto: `Tarea ${i}`,
          tiempo: 'mucho' as const,
        })),
      },
      DATOS,
      { idioma, formacion: null },
    );
    const html = parseFragment(renderizarInformeBreve(construirInformeBreve(informe, DATOS), informe));
    // Todo «Hoja N de M» y todo «N / M» del pie están en las piezas que la impresión sustituye por el folio real.
    const folio = idioma === 'es' ? /Hoja \d+ de \d+/u : /Full \d+ de \d+/u;
    const banda = textos(html, null, 'ib-folio-hoja', []).filter(({ texto }) => folio.test(texto));
    const pies = conClase(html, 'hoja-pie');
    assert.equal(pies.length, 2);
    const pie = pies.flatMap((nodo) =>
      textos(nodo, null, 'hoja-pie-folio', []).filter(({ texto }) => /^\d+ \/ \d+$/u.test(texto.trim())),
    );
    assert.equal(banda.length, 2);
    assert.equal(pie.length, 2);
    assert.ok(banda.every(({ dentro }) => dentro));
    assert.ok(pie.every(({ dentro }) => dentro));
  }
});

type Elemento = DefaultTreeAdapterTypes.Element;
const PAGINAS_DEL_RECORRIDO = ['../../web/recorrido.html'];
// Lo que no ocupa sitio en el flujo aunque esté delante del informe: lo que no se pinta y el texto de los lectores de
// pantalla (posición absoluta, base-documento.css). La descripción de los enlaces que abren otra pestaña solo se usa
// como aria-describedby y siempre lleva hidden.
const SIN_CAJA = new Set(['head', 'template', 'noscript', 'script', 'style', 'link', 'meta', 'dialog']);
const SIEMPRE_OCULTOS = new Set(['rc-abre-en-otra-pestana']);

const atributo = (elemento: Elemento, nombre: string) => elemento.attrs.find((a) => a.name === nombre)?.value;

/** Los elementos que quedan delante de #informe sin contenerlo: la raíz de cada rama anterior al informe. */
function delanteDelInforme(nodo: Nodo, salida: Elemento[] = []): { salida: Elemento[]; encontrado: boolean } {
  for (const hijo of 'childNodes' in nodo ? nodo.childNodes : []) {
    if (!('tagName' in hijo)) {
      continue;
    }
    if (atributo(hijo, 'id') === 'informe') {
      return { salida, encontrado: true };
    }
    const dentro = delanteDelInforme(hijo, []);
    if (dentro.encontrado) {
      return { salida: [...salida, ...dentro.salida], encontrado: true };
    }
    salida.push(hijo);
  }
  return { salida, encontrado: false };
}

/** Un selector simple (etiqueta, #id, .clases y :empty, sin combinadores) que nombra al elemento. */
function nombraA(selector: string, elemento: Elemento): boolean {
  const partes = /^([a-z][\w-]*)?((?:[#.][\w-]+)*)(:empty)?$/u.exec(selector);
  if (!partes) {
    return false;
  }
  const clases = (atributo(elemento, 'class') ?? '').split(/\s+/u);
  const nombres = (partes[2] ?? '').match(/[#.][\w-]+/gu) ?? [];
  return (
    (partes[1] === undefined || partes[1] === elemento.tagName) &&
    nombres.every((n) => (n.startsWith('#') ? atributo(elemento, 'id') === n.slice(1) : clases.includes(n.slice(1)))) &&
    (partes[3] === undefined || elemento.childNodes.length === 0)
  );
}

test('al imprimir el recorrido, ninguna caja queda en el flujo delante del informe (la página 1 no sale en blanco)', () => {
  for (const ruta of PAGINAS_DEL_RECORRIDO) {
    const html = readFileSync(new URL(ruta, import.meta.url), 'utf8');
    const hojas = [...html.matchAll(/href="([^"]+\.css)"/gu)].map(
      ([, hoja]) => new URL(hoja ?? '', new URL(ruta, import.meta.url)),
    );
    const ocultan = [...new Set(hojas.map(String))]
      .flatMap((hoja) => reglas(readFileSync(new URL(hoja), 'utf8')))
      .filter(({ impresion, declaraciones: d }) => impresion && d.get('display') === 'none')
      .flatMap(({ selectores }) => selectores);
    const { salida, encontrado } = delanteDelInforme(parse(html));
    assert.ok(encontrado, ruta);
    const enElFlujo = salida
      .filter((elemento) => !SIN_CAJA.has(elemento.tagName))
      .filter((elemento) => !(atributo(elemento, 'class') ?? '').split(/\s+/u).includes('solo-lectores'))
      .filter((elemento) => !SIEMPRE_OCULTOS.has(atributo(elemento, 'id') ?? ''))
      .filter((elemento) => !ocultan.some((selector) => nombraA(selector, elemento)))
      .map((elemento) => `${elemento.tagName}#${atributo(elemento, 'id') ?? ''}.${atributo(elemento, 'class') ?? ''}`);
    assert.deepEqual(enElFlujo, [], ruta);
  }
});

/** Las hojas que enlaza una página, en su orden, con su atributo media si lo lleva y si es hoja del informe. */
function hojasDe(html: string): { hoja: string; media: string | undefined; delInforme: boolean }[] {
  return [...html.matchAll(/<link\b[^>]*>/gu)]
    .map(([etiqueta]) => etiqueta)
    .filter((etiqueta) => /\brel="stylesheet"/u.test(etiqueta))
    .map((etiqueta) => ({
      hoja: /\bhref="([^"]+)"/u.exec(etiqueta)?.[1] ?? '',
      media: /\bmedia="([^"]+)"/u.exec(etiqueta)?.[1],
      delInforme: /\sdata-hoja-informe\b/u.test(etiqueta),
    }));
}

test('el informe de ejemplo enlaza las hojas del informe del recorrido en su mismo orden, tras las comunes', () => {
  const sinComentarios = (ruta: string) =>
    readFileSync(new URL(ruta, import.meta.url), 'utf8').replace(/<!--[\s\S]*?-->/gu, '');
  const delRecorrido = hojasDe(sinComentarios('../../web/recorrido.html'))
    .filter(({ delInforme }) => delInforme)
    .map(({ hoja }) => hoja);
  assert.deepEqual(delRecorrido, [
    'estilos/informe/como-lo-sabemos-y-cierre.css',
    'estilos/informe/pantallas-e-impresion.css',
    'estilos/informe-breve.css',
  ]);
  const delEjemplo = hojasDe(sinComentarios('../../web/informe-ejemplo.html'));
  // En el ejemplo se aplican desde el principio, sin media: el informe ya está en la página.
  assert.ok(delEjemplo.every(({ media }) => media === undefined));
  // pantallas-e-impresion.css no entra: lo que oculta al imprimir ya lo oculta informe-breve.css en su página
  // autónoma (todo lo que no es el informe y su cierre).
  assert.deepEqual(
    delEjemplo.map(({ hoja }) => hoja),
    [
      'estilos/tipografias.css',
      'estilos/tokens.css',
      'estilos/base.css',
      ...delRecorrido.filter((hoja) => hoja !== 'estilos/informe/pantallas-e-impresion.css'),
    ],
  );
});

test('en papel, el informe y sus descendientes conservan sus colores aunque se imprima sin gráficos de fondo', () => {
  // Sin print-color-adjust: exact, el navegador que imprime sin fondos quita el marino de la banda y deja su texto claro
  // sobre blanco. Lo declara la propia hoja del informe: el ejemplo público y el HTML de la API no cargan
  // pantallas-e-impresion.css.
  for (const ruta of ['../../web/estilos/informe-breve.css']) {
    const deImpresion = reglas(readFileSync(new URL(ruta, import.meta.url), 'utf8')).filter(
      ({ impresion, exclusiva }) => impresion && exclusiva,
    );
    for (const selector of ['.informe-breve', '.informe-breve *']) {
      const valor = deImpresion
        .findLast(({ selectores, declaraciones: d }) => selectores.includes(selector) && d.has('print-color-adjust'))
        ?.declaraciones.get('print-color-adjust');
      assert.equal(valor, 'exact', `${ruta}: ${selector}`);
    }
  }
});
