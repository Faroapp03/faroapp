// La estructura y la accesibilidad básica de cada página: el idioma, un solo título, un solo h1 y un solo main, el
// enlace «Saltar al contenido» al principio, ids sin repetir y que existen cuando se citan, campos con etiqueta e
// imágenes con alt. Contraste, foco y lectores de pantalla requieren además una comprobación en navegador.

import { type DefaultTreeAdapterMap, parse } from 'parse5';
import { aperturas, type Etiqueta, etiquetasDe } from './etiquetas.ts';

interface AmbitoHtml {
  inicio: number;
  fin: number;
  padre: number | null;
}

/** El contenido de template no pertenece al documento activo, tampoco si contiene otra plantilla. */
function ambitosDe(html: string): { contenidos: string[]; padres: (number | null)[]; problemas: string[] } {
  const ambitos: AmbitoHtml[] = [{ inicio: 0, fin: html.length, padre: null }];
  const problemas: string[] = [];
  function visitar(nodo: DefaultTreeAdapterMap['node'], padre: number): void {
    let hijos = 'childNodes' in nodo ? nodo.childNodes : [];
    let ambito = padre;
    if ('content' in nodo) {
      const lugar = nodo.sourceCodeLocation;
      if (!lugar?.startTag || !lugar.endTag) {
        problemas.push('plantilla <template> sin apertura o cierre completo');
        return;
      }
      ambito = ambitos.length;
      ambitos.push({ inicio: lugar.startTag.endOffset, fin: lugar.endTag.startOffset, padre });
      hijos = nodo.content.childNodes;
    }
    for (const hijo of hijos) {
      visitar(hijo, ambito);
    }
  }
  visitar(parse(html, { sourceCodeLocationInfo: true }), 0);
  const contenidos = ambitos.map((ambito, indice) => {
    let contenido = html.slice(ambito.inicio, ambito.fin);
    for (const hijo of ambitos.filter((otro) => otro.padre === indice)) {
      const inicio = hijo.inicio - ambito.inicio;
      const fin = hijo.fin - ambito.inicio;
      contenido = contenido.slice(0, inicio) + ' '.repeat(fin - inicio) + contenido.slice(fin);
    }
    return contenido;
  });
  return { contenidos, padres: ambitos.map(({ padre }) => padre), problemas };
}

/** Atributos que se comprueban cuando citan otros elementos de la página por su id (listas separadas por espacios). */
const REFERENCIAS_A_ID = Object.freeze([
  'for',
  'aria-labelledby',
  'aria-describedby',
  'aria-controls',
  'aria-owns',
  'aria-details',
  'aria-errormessage',
  'aria-activedescendant',
  'aria-flowto',
]);
/** Los campos de formulario que necesitan una etiqueta (con la excepción de INPUTS_SIN_ETIQUETA). */
const CAMPOS = new Set(['input', 'select', 'textarea']);
/** Los tipos de <input> que no necesitan etiqueta: se nombran por su valor o no se ven. */
const INPUTS_SIN_ETIQUETA = new Set(['hidden', 'submit', 'button', 'reset', 'image']);

/** El enlace de salto es lo primero de <body>; su destino existe y no lleva el atributo hidden. No evalúa CSS. */
function comprobarEnlaceDeSalto(pagina: string, html: string): string[] {
  const salto = /<body[^>]*>\s*<a class="salto" href="#([^"]+)"/.exec(html);
  if (!salto) {
    return [`${pagina}: el enlace «Saltar al contenido» no es lo primero de <body>`];
  }
  const destino = aperturas(etiquetasDe(html)).find(({ atributos }) => atributos.get('id') === salto[1]);
  if (!destino) {
    return [`${pagina}: el enlace de salto apunta a #${salto[1]}, que no existe`];
  }
  if (destino.atributos.has('hidden')) {
    return [`${pagina}: el enlace de salto apunta a un elemento oculto`];
  }
  return [];
}

/** Un único <title>, con texto (puede llevar la clave de su traducción, data-texto). */
function comprobarTitulo(pagina: string, html: string): string[] {
  const titulos = [...html.matchAll(/<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/gi)].map(([, texto = '']) => texto.trim());
  if (titulos.length !== 1) {
    return [`${pagina}: tiene ${titulos.length} <title> y debe tener uno`];
  }
  return titulos[0] ? [] : [`${pagina}: el <title> está vacío`];
}

/** Ids repetidos y referencias (for, aria-labelledby, aria-describedby, aria-controls…) a ids que no existen. */
function comprobarIds(pagina: string, etiquetas: Etiqueta[], externos: ReadonlySet<string> = new Set()): string[] {
  const ids = etiquetas.map((etiqueta) => etiqueta.atributos.get('id')).filter((id) => typeof id === 'string');
  const vistos = new Set<string>();
  const repetidos = new Set<string>();
  for (const id of ids) {
    (vistos.has(id) ? repetidos : vistos).add(id);
  }
  const problemas = [...repetidos].map((id) => `${pagina}: el id «${id}» está repetido`);
  const existentes = new Set([...externos, ...ids]);
  for (const { nombre, atributos } of etiquetas) {
    for (const atributo of REFERENCIAS_A_ID) {
      const citados = (atributos.get(atributo) ?? '').split(/\s+/).filter(Boolean);
      for (const citado of citados.filter((id) => !existentes.has(id))) {
        problemas.push(`${pagina}: ${atributo}="${citado}" en <${nombre}> apunta a un id que no existe`);
      }
    }
  }
  return problemas;
}

/** Si un campo necesita etiqueta: los de CAMPOS, salvo los <input> de INPUTS_SIN_ETIQUETA (por su `type`). */
function necesitaEtiqueta({ nombre, atributos }: Etiqueta): boolean {
  return CAMPOS.has(nombre) && !(nombre === 'input' && INPUTS_SIN_ETIQUETA.has(atributos.get('type') ?? ''));
}

/** Un campo tiene nombre si lo apunta un <label for>, si lleva aria-label o aria-labelledby. */
function tieneEtiqueta(campo: Etiqueta, conFor: ReadonlySet<string>): boolean {
  const { atributos } = campo;
  const id = atributos.get('id');
  if (id && conFor.has(id)) {
    return true;
  }
  return Boolean(atributos.get('aria-label')?.trim() || atributos.get('aria-labelledby')?.trim());
}

/** Cada campo tiene etiqueta: un <label for>, un <label> que lo envuelve, aria-label o aria-labelledby. */
function comprobarEtiquetasDeCampos(pagina: string, etiquetas: Etiqueta[]): string[] {
  const conFor = new Set(
    aperturas(etiquetas, 'label')
      .map((label) => label.atributos.get('for'))
      .filter((id) => typeof id === 'string'),
  );
  const problemas: string[] = [];
  let dentroDeLabel = 0;
  for (const etiqueta of etiquetas) {
    if (etiqueta.nombre === 'label') {
      dentroDeLabel += etiqueta.cierre ? -1 : 1;
    }
    if (etiqueta.cierre || !necesitaEtiqueta(etiqueta) || dentroDeLabel > 0) {
      continue;
    }
    if (!tieneEtiqueta(etiqueta, conFor)) {
      problemas.push(`${pagina}: campo sin etiqueta (${etiqueta.texto})`);
    }
  }
  return problemas;
}

/** Toda imagen tiene el atributo alt; el contenido y su adecuación se revisan aparte. */
function comprobarAlt(pagina: string, etiquetas: Etiqueta[]): string[] {
  return aperturas(etiquetas, 'img')
    .filter((imagen) => !imagen.atributos.has('alt'))
    .map((imagen) => `${pagina}: imagen sin alt (${imagen.texto})`);
}

/**
 * La estructura y la accesibilidad básica de una página.
 *
 * @param pagina - La ruta de la página, desde web/, para los mensajes.
 * @param html - Su HTML, sin comentarios.
 * @returns Un aviso por fallo; vacío si la página cumple.
 */
export function comprobarPagina(pagina: string, html: string): string[] {
  const ambitos = ambitosDe(html);
  const problemas = ambitos.problemas.map((problema) => `${pagina}: ${problema}`);
  const activo = ambitos.contenidos[0] ?? html;
  const etiquetasPorAmbito = ambitos.contenidos.map(etiquetasDe);
  const [etiquetasActivas = []] = etiquetasPorAmbito;
  if (aperturas(etiquetasActivas, 'html')[0]?.atributos.get('lang') !== 'es') {
    problemas.push(`${pagina}: falta <html lang="es">`);
  }
  const cuentaDeH1 = [...activo.matchAll(/<h1[\s>]/g)].length;
  if (cuentaDeH1 !== 1) {
    problemas.push(`${pagina}: tiene ${cuentaDeH1} h1 y debe tener uno`);
  }
  const principales = [...activo.matchAll(/<main[\s>]/g)].length;
  if (principales !== 1) {
    problemas.push(`${pagina}: tiene ${principales} <main> y debe tener uno`);
  }
  problemas.push(...comprobarEnlaceDeSalto(pagina, activo), ...comprobarTitulo(pagina, activo));
  if (/apple-mobile-web-app-capable/.test(html)) {
    problemas.push(`${pagina}: usa la etiqueta obsoleta apple-mobile-web-app-capable`);
  }
  const idsPorAmbito: ReadonlySet<string>[] = [];
  for (const [indice, etiquetas] of etiquetasPorAmbito.entries()) {
    const abiertas = aperturas(etiquetas);
    const padre = ambitos.padres[indice];
    const externos = padre == null ? new Set<string>() : (idsPorAmbito[padre] ?? new Set<string>());
    const contexto = indice === 0 ? pagina : `${pagina} (plantilla ${indice})`;
    problemas.push(
      ...comprobarAlt(contexto, abiertas),
      ...comprobarIds(contexto, abiertas, externos),
      ...comprobarEtiquetasDeCampos(contexto, etiquetas),
    );
    idsPorAmbito.push(new Set([...externos, ...abiertas.flatMap(({ atributos }) => atributos.get('id') ?? [])]));
  }
  return problemas;
}
