// Escribe la página «Biblioteca» a partir del registro de lecturas (datos/lecturas.json): la parte generada de
// web/biblioteca.html (entre sus dos comentarios de marca) y su tramo en los módulos web/idiomas/es/lecturas.js y
// web/idiomas/ca/lecturas.js. La Biblioteca reparte las lecturas en tres segmentos por su tipo (Guías, Informes y
// Notas), que se leen como pestañas (scripts/etapas.js, variante «segmentos»), con un solo filtro, el nivel, y una
// paginación al pie de cada segmento (las dos, en scripts/lecturas.js). Cada lectura es una ficha con los datos de un
// vistazo: el tipo con su icono, la fuente y la lengua, el título enlazado al original, el resumen, «Por qué
// te puede interesar» y una franja con el nivel, los minutos y qué abre el enlace. El HTML en castellano y los
// diccionarios se generan juntos a partir de la misma entrada editorial.
// Uso: node herramientas/web/lecturas.ts [--comprobar]   (--comprobar no escribe: falla si algo no está al día;
// lo usa pruebas/web-lecturas/generacion.test.ts)

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ProyeccionEnlace } from '../../src/biblioteca/observaciones-lecturas.ts';
import { IDIOMAS, type Idioma } from '../../src/comun/idioma.ts';
import { compararPorCodigo } from '../../src/comun/orden.js';
import { compararTexto } from '../../src/comun/orden-alfabetico.ts';
import { escapar } from '../../src/presentacion/html.ts';
import { formatearTextoConBiome } from '../comun/archivos.ts';
import { ejecutar, orden } from '../comun/opciones.ts';
import { cargarProyeccionLecturas } from './lecturas/observaciones.ts';
import { comprobarReferencias, esPropia } from './lecturas/referencias.ts';
import {
  type Lectura,
  leerRegistro,
  NIVELES,
  type PorIdioma,
  type Registro,
  RegistroInvalido,
  TIPOS,
} from './lecturas/registro.ts';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
type Observaciones = ReadonlyMap<string, ProyeccionEnlace>;

/** Las marcas entre las que va la parte generada de cada página. */
const MARCA_INICIO = '<!-- Parte generada por node herramientas/web/lecturas.ts desde ../datos/lecturas.json. -->';
const MARCA_FIN = '<!-- Fin de la parte generada. -->';
/** Las marcas entre las que va el tramo generado de cada diccionario. */
const DICCIONARIO_INICIO = '  // ---------- Guías y Biblioteca: lo escribe herramientas/web/lecturas.ts ----------';
const DICCIONARIO_FIN = '  // ---------- Fin de Guías y Biblioteca ----------';
/** El filtro de la Biblioteca: el nivel, que se aplica a la vez en todos los segmentos. (Cada pestaña ya es un tipo.) */
const GRUPOS: Grupo[] = [
  {
    nombre: 'nivel',
    leyenda: 'lecturas.nivel',
    opciones: NIVELES.map((nivel) => [nivel, `lecturas.niveles.${nivel}`]),
  },
];
/** La opción de cada grupo que no excluye nada, con la clave de su texto. */
const OPCION_TODOS: [string, string] = ['todo', 'biblioteca.todos'];
/**
 * Los textos de la barra de filtros y de la paginación, propios de la interfaz y no del catálogo: el rótulo, «Todos»,
 * el recuento del segmento a la vista (que escribe scripts/lecturas.js), «Quitar filtros», el nombre de la navegación
 * entre páginas y el de cada página («Página 2 de 3»), que también escribe el script.
 */
const TEXTOS_DE_LA_BARRA: Record<string, PorIdioma> = {
  'biblioteca.enlace-no-disponible': { es: 'Enlace no disponible', ca: 'Enllaç no disponible' },
  'biblioteca.comprobado': { es: 'Comprobado: {fecha}', ca: 'Comprovat: {fecha}' },
  'biblioteca.enlace-incidencia': {
    es: 'En la última revisión, este enlace no respondió como se esperaba. Si no se abre, busca el documento por su título en la web de la fuente.',
    ca: 'A la darrera revisió, aquest enllaç no va respondre com s’esperava. Si no s’obre, cerca el document pel seu títol al web de la font.',
  },
  'biblioteca.comprobado-con-incidencia': {
    es: 'Comprobado: {fecha}. En la última revisión, este enlace no respondió como se esperaba. Si no se abre, busca el documento por su título en la web de la fuente.',
    ca: 'Comprovat: {fecha}. A la darrera revisió, aquest enllaç no va respondre com s’esperava. Si no s’obre, cerca el document pel seu títol al web de la font.',
  },
  'biblioteca.filtrar-por': { es: 'Filtrar por', ca: 'Filtrar per' },
  'biblioteca.todos': { es: 'Todos', ca: 'Tots' },
  'biblioteca.recuento': { es: '{total} lecturas', ca: '{total} lectures' },
  'biblioteca.recuento-parcial': { es: '{vistas} de {total} lecturas', ca: '{vistas} de {total} lectures' },
  'biblioteca.quitar-filtros': { es: 'Quitar filtros', ca: 'Treure els filtres' },
  'biblioteca.paginas': { es: 'Páginas', ca: 'Pàgines' },
  'biblioteca.pagina': { es: 'Página {numero} de {total}', ca: 'Pàgina {numero} de {total}' },
};
/** Lo que dicen las páginas al pie: la selección de la biblioteca y la de las guías, con sus avisos. */
const AVISOS = ['biblioteca.aviso', 'guias.aviso'];
/**
 * El icono de cada tipo, decorativo (el tipo va escrito al lado): trazos de 24 × 24 del color del texto, que pinta la
 * hoja (estilos/lecturas.css), sin estilos en línea.
 */
const ICONOS: Record<Lectura['tipo'], string> = {
  guia: '<circle cx="12" cy="12" r="9" /><path d="m15.5 8.5-2 5-5 2 2-5z" />',
  informe: '<path d="M4 20h16" /><path d="M7 20v-7M12 20V6M17 20v-10" />',
  nota: '<path d="M6 3.5h9l3.5 3.5v13.5H6z" /><path d="M14.5 3.5V7.5h4M9 12h6M9 15.5h6" />',
};

/** El orden en que se nombran los idiomas de una lectura: castellano, catalán, inglés y, después, los demás. */
const ORDEN_DE_LENGUAS = ['es', 'ca', 'en'];

/** Un grupo de filtros: el nombre de sus botones de opción, la clave de su leyenda y cada opción con la clave de su texto. */
interface Grupo {
  nombre: string;
  leyenda: string;
  opciones: [string, string][];
}

/** Las páginas no se pueden generar o no están al día con el registro. */
class PaginasSinGenerar extends Error {
  override readonly name = 'PaginasSinGenerar';
}

/** Un texto del registro en los dos idiomas; si falta su clave, el error la nombra. */
function textoDe(registro: Registro, clave: string): PorIdioma {
  const texto = registro.textos[clave];
  if (texto === undefined) {
    throw new RegistroInvalido(`datos/lecturas.json: falta el texto «${clave}»`);
  }
  return texto;
}

// Los rótulos de interfaz conservan su clave también cuando hoy coinciden en ambas lenguas.
const ROTULOS_COMUNES = new Set(['lecturas.niveles.empezar', 'lecturas.vistazo.lectura', 'lecturas.vistazo.idioma']);

/**
 * Reúne los textos de la página mientras se escribe: cada texto que cambia de un idioma a otro lleva su clave y va
 * a los dos diccionarios; uno que es igual en los dos (una fecha en cifras, un nombre propio) se escribe sin clave.
 */
class Textos {
  readonly es: Record<string, string> = {};
  readonly ca: Record<string, string> = {};

  /**
   * Un elemento con su texto: `<etiqueta atributos data-texto="clave">texto</etiqueta>`.
   *
   * @param etiqueta - La etiqueta HTML.
   * @param clave - La clave del texto en los diccionarios.
   * @param textos - El texto en los dos idiomas.
   * @param atributos - Los atributos del elemento, ya escritos.
   * @returns El elemento, con el texto en castellano escapado.
   * @throws {PaginasSinGenerar} Si la clave ya tiene otro texto.
   */
  elemento(etiqueta: string, clave: string, textos: PorIdioma, atributos = ''): string {
    const propios = atributos ? ` ${atributos}` : '';
    if (textos.es === textos.ca && !ROTULOS_COMUNES.has(clave)) {
      return `<${etiqueta}${propios}>${escapar(textos.es)}</${etiqueta}>`;
    }
    this.anadir(clave, textos);
    return `<${etiqueta}${propios} data-texto="${clave}">${escapar(textos.es)}</${etiqueta}>`;
  }

  /**
   * Un texto que va a los diccionarios sin elemento en la parte generada (un atributo o la cabecera de la página). La
   * misma clave puede llegar varias veces con el mismo texto (una etiqueta repetida); con otro, un idioma mostraría
   * el texto de otra lectura, así que es un error.
   *
   * @param clave - La clave del texto.
   * @param textos - El texto en los dos idiomas.
   * @throws {PaginasSinGenerar} Si la clave ya tiene otro texto.
   */
  anadir(clave: string, textos: PorIdioma): void {
    for (const idioma of IDIOMAS) {
      const previo = this[idioma][clave];
      if (previo !== undefined && previo !== textos[idioma]) {
        throw new PaginasSinGenerar(
          `La clave «${clave}» tiene dos textos distintos en ${idioma}: «${previo}» y «${textos[idioma]}»`,
        );
      }
    }
    this.es[clave] = textos.es;
    this.ca[clave] = textos.ca;
  }

  /**
   * Quita de los dos diccionarios las claves que empiezan por `prefijo` (las que ya tiene el diccionario común).
   *
   * @param prefijo - El comienzo de las claves que se quitan.
   */
  quitar(prefijo: string): void {
    for (const idioma of IDIOMAS) {
      for (const clave of Object.keys(this[idioma])) {
        if (clave.startsWith(prefijo)) {
          delete this[idioma][clave];
        }
      }
    }
  }
}

/** El texto de la barra de filtros o de la paginación con esa clave, en los dos idiomas. */
function textoDeLaBarra(clave: string): PorIdioma {
  const texto = TEXTOS_DE_LA_BARRA[clave];
  if (texto === undefined) {
    throw new PaginasSinGenerar(`Falta el texto de la barra de filtros «${clave}»`);
  }
  return texto;
}

/** El icono del tipo de una lectura y su nombre («Guía»), a la izquierda de la ficha. */
function columnaDelTipo(lectura: Lectura, registro: Registro, textos: Textos): string {
  const icono =
    `<svg class="lecturas-icono" viewBox="0 0 24 24" width="32" height="32" aria-hidden="true" focusable="false">` +
    `${ICONOS[lectura.tipo]}</svg>`;
  const nombre = textos.elemento(
    'span',
    `lecturas.tipo.${lectura.tipo}`,
    textoDe(registro, `biblioteca.tipo.${lectura.tipo}`),
    'class="lecturas-ficha-rotulo"',
  );
  return `<div class="lecturas-ficha-tipo">${icono}${nombre}</div>`;
}

/**
 * Comprueba que la fecha de publicación tiene la forma AAAA, AAAA-MM o AAAA-MM-DD. La ficha no enseña la fecha,
 * pero la utiliza para ordenar cada nivel de la más reciente a
 * la más antigua.
 */
function comprobarFecha(lectura: Lectura): void {
  const { iso } = lectura.fecha;
  if (iso !== null && !/^\d{4}(?:-\d{2}(?:-\d{2})?)?$/.test(iso)) {
    throw new RegistroInvalido(`${lectura.id}: la fecha «${iso}» no es AAAA, AAAA-MM ni AAAA-MM-DD`);
  }
}

/** La línea sobre el título: solo la fuente. */
function lineaDeLaFuente(lectura: Lectura): string {
  comprobarFecha(lectura);
  return `<p class="lecturas-ficha-fuente"><span>${escapar(lectura.fuente)}</span></p>`;
}

/**
 * El enlace al original: en otra pestaña si es de fuera o una ficha PDF, con lo que abre como descripción accesible. Si
 * la lectura tiene versión en catalán, la lleva en data-enlace-ca: scripts/lecturas.js la pone en el enlace mientras la
 * web está en catalán. Sin script, el enlace es el de siempre.
 */
function enlaceAlOriginal(lectura: Lectura, enlace: string, contenido: string, observaciones: Observaciones): string {
  const aparte = abreEnOtraPestana(enlace) ? ' target="_blank" rel="noopener noreferrer"' : '';
  const es = observaciones.get(`${lectura.id}:enlace`);
  const ca = lectura.enlace_ca ? observaciones.get(`${lectura.id}:enlace_ca`) : es;
  const atributos = (idioma: Idioma, dato: ProyeccionEnlace | undefined): string => {
    const abrir = dato?.abrir ?? true;
    // La fecha de la última confirmación válida se publica con cualquier estado posterior; sin ella, no se inventa.
    return (
      ` data-abrir-${idioma}="${abrir}"` +
      (dato?.comprobado_utc ? ` data-comprobado-${idioma}="${escapar(dato.comprobado_utc)}"` : '') +
      (dato?.incidencia ? ` data-incidencia-${idioma}="${escapar(dato.incidencia.fecha)}"` : '')
    );
  };
  const catalan = lectura.enlace_ca ? ` data-enlace-ca="${escapar(lectura.enlace_ca)}"` : '';
  const destino = es?.abrir === false ? ' aria-disabled="true"' : ` href="${escapar(enlace)}"`;
  return (
    `<a${destino} data-enlace-es="${escapar(enlace)}"${catalan}${atributos('es', es)}${atributos('ca', ca)}` +
    `${aparte} aria-describedby="abre-${lectura.id}">${contenido}</a>`
  );
}

/** El resumen y el «por qué interesa». */
function resumenEInteres(lectura: Lectura, registro: Registro, textos: Textos): string {
  const resumen = { es: lectura.es.resumen, ca: lectura.ca.resumen };
  const interes = { es: lectura.es.interes, ca: lectura.ca.interes };
  return (
    `${textos.elemento('p', `lecturas.${lectura.id}.resumen`, resumen, 'class="lecturas-ficha-resumen"')}` +
    `<p class="lecturas-ficha-interes">` +
    `${textos.elemento('strong', 'lecturas.interes', textoDe(registro, 'lecturas.interes'))} ` +
    `${textos.elemento('span', `lecturas.${lectura.id}.interes`, interes)}</p>`
  );
}

/** El nivel, en texto y en tres barras (decorativas): llenas hasta el nivel de la lectura. */
function nivelConBarras(lectura: Lectura, registro: Registro, textos: Textos): string {
  const posicion = NIVELES.indexOf(lectura.nivel);
  const barras = NIVELES.map(
    (_, otra) => `<span class="lecturas-barra${otra <= posicion ? ' lecturas-barra--llena' : ''}"></span>`,
  ).join('');
  const clave = `lecturas.niveles.${lectura.nivel}`;
  return (
    `<span class="lecturas-nivel"><span class="lecturas-barras" aria-hidden="true">${barras}</span>` +
    `${textos.elemento('span', clave, textoDe(registro, clave))}</span>`
  );
}

/**
 * Los idiomas de la lectura, en una frase: «Castellano», «Castellano y catalán», «Castellano, catalán e inglés»… (el
 * castellano, el catalán y el inglés por ese orden y después los demás). Toda lectura se puede leer en castellano o en
 * catalán: lo exige el registro (lecturas/registro.ts).
 */
function idiomasDeLaLectura(lectura: Lectura, registro: Registro, textos: Textos): string {
  const orden = (codigo: string) => {
    const posicion = ORDEN_DE_LENGUAS.indexOf(codigo);
    return posicion === -1 ? ORDEN_DE_LENGUAS.length : posicion;
  };
  const codigos = [...lectura.idiomas].sort((a, b) => orden(a) - orden(b) || compararPorCodigo(a, b));
  const frase = (idioma: Idioma) => {
    const nombres = codigos.map((codigo) => textoDe(registro, `lecturas.lengua.${codigo}`)[idioma]);
    const ultimo = nombres.pop() ?? '';
    const enlace = idioma === 'es' && /^h?i/i.test(ultimo) ? 'e' : textoDe(registro, 'lecturas.lengua.y')[idioma];
    const unida = nombres.length ? `${nombres.join(', ')} ${enlace} ${ultimo}` : ultimo;
    return unida.charAt(0).toUpperCase() + unida.slice(1);
  };
  return textos.elemento('span', `lecturas.idiomas.${codigos.join('-')}`, { es: frase('es'), ca: frase('ca') });
}

/** Si lo que abre una lectura es un PDF: lo dice su formato o, si no lo tiene, su dirección. */
function esPdf(lectura: Lectura, enlace: string): boolean {
  return lectura.formato ? /\bPDF\b/.test(lectura.formato.es) : /\.pdf(?:$|[?#])/i.test(enlace);
}

/**
 * Qué abre el enlace, con su id para la descripción accesible del enlace: «PDF» o «Página web», con la flecha y,
 * debajo,
 * «en otra pestaña»; una página de Faro, «en esta pestaña»; una guía propia sin enlace dice «En preparación».
 */
function queAbre(lectura: Lectura, registro: Registro, textos: Textos): string {
  const { enlace } = lectura;
  if (enlace === null) {
    return `<dd>${textos.elemento('span', 'guias.preparacion', textoDe(registro, 'guias.preparacion'))}</dd>`;
  }
  if (!abreEnOtraPestana(enlace)) {
    const pagina = textos.elemento('span', 'lecturas.abre.pagina-faro', textoDe(registro, 'lecturas.abre.pagina-faro'));
    const aqui = textos.elemento('small', 'lecturas.en-esta-pestana', textoDe(registro, 'lecturas.en-esta-pestana'));
    return `<dd id="abre-${lectura.id}">${pagina} ${aqui}</dd>`;
  }
  const clave = esPdf(lectura, enlace) ? 'lecturas.formato.pdf' : 'lecturas.formato.web';
  const formato = textos.elemento('span', clave, textoDe(registro, clave));
  const aparte = textos.elemento('small', 'lecturas.en-otra-pestana', textoDe(registro, 'lecturas.en-otra-pestana'));
  return `<dd id="abre-${lectura.id}">${formato}<span aria-hidden="true"> ↗</span> ${aparte}</dd>`;
}

/** La franja de datos de un vistazo: el nivel, los minutos de lectura, los idiomas y qué abre el enlace. */
function vistazo(lectura: Lectura, registro: Registro, textos: Textos): string {
  const rotulo = (clave: string) => textos.elemento('dt', clave, textoDe(registro, clave));
  const unos = textos.elemento('span', 'lecturas.unos', textoDe(registro, 'lecturas.unos'));
  const minutos = textos.elemento('span', 'lecturas.min', textoDe(registro, 'lecturas.min'));
  return (
    `<dl class="lecturas-vistazo"><div>${rotulo('lecturas.nivel')}` +
    `<dd>${nivelConBarras(lectura, registro, textos)}</dd></div>` +
    `<div>${rotulo('lecturas.vistazo.lectura')}<dd>${unos} ${lectura.minutos} ${minutos}</dd></div>` +
    `<div>${rotulo('lecturas.vistazo.idioma')}<dd>${idiomasDeLaLectura(lectura, registro, textos)}</dd></div>` +
    `<div>${rotulo('lecturas.vistazo.abre')}${queAbre(lectura, registro, textos)}</div></dl>`
  );
}

/**
 * La ficha de una lectura: el tipo con su icono a la izquierda; a la derecha, la fuente y la fecha, el título enlazado
 * al original (todo el recuadro es su zona de pulsación), el resumen, «Por qué te puede interesar» y la franja de
 * datos.
 * Una guía propia en preparación no enlaza y lleva el borde discontinuo.
 */
function ficha(lectura: Lectura, registro: Registro, textos: Textos, observaciones: Observaciones): string {
  const titulo = textos.elemento('span', `lecturas.${lectura.id}.titulo`, {
    es: lectura.es.titulo,
    ca: lectura.ca.titulo,
  });
  const enlazado = lectura.enlace === null ? titulo : enlaceAlOriginal(lectura, lectura.enlace, titulo, observaciones);
  const clase = `lecturas-ficha${lectura.enlace === null ? ' lecturas-ficha--pendiente' : ''}`;
  return (
    `<li class="${clase}" data-filtrable data-lectura="${lectura.id}" data-nivel="${lectura.nivel}" ` +
    `data-tipo="${lectura.tipo}">${columnaDelTipo(lectura, registro, textos)}<div class="lecturas-ficha-cuerpo">` +
    `${lineaDeLaFuente(lectura)}<p class="lecturas-ficha-fuente" data-comprobacion-enlace hidden></p><h3 class="lecturas-ficha-titulo">${enlazado}</h3>` +
    `${resumenEInteres(lectura, registro, textos)}${vistazo(lectura, registro, textos)}</div></li>`
  );
}

/** La flecha que indica un desplegable (hacia abajo; la hoja la gira al abrirlo): trazo del color del texto. */
const CHEVRON =
  '<svg class="lecturas-chevron" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">' +
  '<path d="M3.5 6.25 8 10.75l4.5-4.5" /></svg>';

/**
 * Un desplegable de la barra de filtros: un botón («Nivel · Todos») que abre, justo debajo, un panel con un grupo de
 * botones de opción nativos (la selección es única) y, en cada opción, el sitio de su cuenta, que escribe el script. El
 * panel parte cerrado.
 */
function desplegable({ nombre, leyenda, opciones }: Grupo, registro: Registro, textos: Textos): string {
  const idPanel = `filtro-${nombre}-panel`;
  const nombreDelGrupo = textoDe(registro, leyenda);
  const [valorTodos, claveTodos] = OPCION_TODOS;
  const radios = [OPCION_TODOS, ...opciones].map(([valor, clave]) => {
    const texto = clave === claveTodos ? textoDeLaBarra(claveTodos) : textoDe(registro, clave);
    return (
      `<label class="lecturas-opcion"><input type="radio" name="${nombre}" value="${valor}"` +
      `${valor === valorTodos ? ' checked' : ''} /><span class="lecturas-opcion-texto">` +
      `${textos.elemento('span', clave, texto, 'data-opcion')} <span class="lecturas-opcion-n" data-n></span></span></label>`
    );
  });
  const boton =
    `<button type="button" class="lecturas-desplegable-boton" id="filtro-${nombre}-boton" aria-expanded="false" ` +
    `aria-controls="${idPanel}" data-desplegable-boton><span class="lecturas-desplegable-texto">` +
    `${textos.elemento('span', leyenda, nombreDelGrupo, 'class="lecturas-desplegable-nombre"')}` +
    '<span class="lecturas-desplegable-separador" aria-hidden="true"> · </span>' +
    `${textos.elemento('span', claveTodos, textoDeLaBarra(claveTodos), 'class="lecturas-desplegable-valor" data-valor')}</span>` +
    `${CHEVRON}</button>`;
  const panel =
    `<div class="lecturas-desplegable-panel" id="${idPanel}" data-desplegable-panel hidden>` +
    `<fieldset class="lecturas-filtro">${textos.elemento('legend', leyenda, nombreDelGrupo)}` +
    `${radios.join('')}</fieldset></div>`;
  return `<div class="lecturas-desplegable" data-desplegable>${boton}${panel}</div>`;
}

/**
 * La barra de filtros, oculta hasta que el script la activa (sin script se ve todo): el rótulo, el desplegable del
 * nivel
 * y, a la derecha, el recuento del segmento a la vista y «Quitar filtros», que el script enseña solo con algún filtro
 * activo. El recuento se anuncia con la región de estado de cada segmento; el de la barra es solo visual.
 */
function filtros(registro: Registro, textos: Textos): string {
  for (const [clave, texto] of Object.entries(TEXTOS_DE_LA_BARRA)) {
    textos.anadir(clave, texto);
  }
  const rotulo = textos.elemento(
    'p',
    'biblioteca.filtrar-por',
    textoDeLaBarra('biblioteca.filtrar-por'),
    'class="lecturas-filtros-rotulo" aria-hidden="true"',
  );
  const desplegables = GRUPOS.map((grupo) => desplegable(grupo, registro, textos)).join('');
  const quitar = textos.elemento(
    'button',
    'biblioteca.quitar-filtros',
    textoDeLaBarra('biblioteca.quitar-filtros'),
    'type="button" class="lecturas-filtros-quitar" data-quitar hidden',
  );
  const nombre = textoDe(registro, 'biblioteca.filtros');
  textos.anadir('biblioteca.filtros', nombre);
  return (
    `<form class="lecturas-filtros" aria-label="${escapar(nombre.es)}" data-texto-aria-label="biblioteca.filtros" ` +
    `hidden data-filtros="biblioteca">${rotulo}<div class="lecturas-filtros-grupos">${desplegables}</div>` +
    `<div class="lecturas-filtros-estado"><p class="lecturas-filtros-recuento" aria-hidden="true" data-recuento></p>` +
    `${quitar}</div></form>`
  );
}

/** La cabecera de la página: antetítulo, título y entradilla. */
function cabecera(registro: Registro, textos: Textos): string {
  const antetitulo = textos.elemento(
    'p',
    'biblioteca.antetitulo',
    textoDe(registro, 'biblioteca.antetitulo'),
    'class="antetitulo"',
  );
  return (
    `<header class="lecturas-cabecera">${antetitulo}` +
    `${textos.elemento('h1', 'comun.seccion.biblioteca', textoDe(registro, 'comun.seccion.biblioteca'))}` +
    `${textos.elemento('p', 'biblioteca.entradilla', textoDe(registro, 'biblioteca.entradilla'), 'class="entradilla"')}` +
    '</header>'
  );
}

/** Cada segmento de la Biblioteca, en el orden de las pestañas: su id, su tipo y su nombre («Guías»). */
function segmentosDe(registro: Registro): { id: string; tipo: Lectura['tipo']; clave: string; nombre: PorIdioma }[] {
  return TIPOS.map(({ tipo, segmento: id }) => {
    const clave = `biblioteca.tipos.${tipo}`;
    return { id, tipo, clave, nombre: textoDe(registro, clave) };
  });
}

/** La barra de los segmentos, oculta hasta que scripts/etapas.js la activa: un enlace a cada uno, con su nombre. */
function barra(registro: Registro, textos: Textos): string {
  const enlaces = segmentosDe(registro)
    .map(
      ({ id, clave, nombre }) =>
        `<li><a href="#${id}">${textos.elemento('span', clave, nombre, 'class="etapas-nombre"')}</a></li>`,
    )
    .join('');
  const nombre = textoDe(registro, 'biblioteca.segmentos');
  textos.anadir('biblioteca.segmentos', nombre);
  return (
    `<nav class="etapas-barra" aria-label="${escapar(nombre.es)}" data-texto-aria-label="biblioteca.segmentos" ` +
    `data-etapas-barra hidden><ol>${enlaces}</ol></nav>`
  );
}

/**
 * Un segmento: su título, la cuenta de lo que deja ver el filtro (la escribe el script), sus lecturas en ficha, de lo
 * sencillo a lo avanzado, y la navegación entre sus páginas, oculta y vacía hasta que el script la escribe (sin script
 * se ven todas las fichas).
 */
function segmento(
  { id, tipo, clave, nombre }: ReturnType<typeof segmentosDe>[number],
  registro: Registro,
  textos: Textos,
  observaciones: Observaciones,
): string {
  const titulo = `t-${id}`;
  const h2 = textos.elemento('h2', clave, nombre, `id="${titulo}"`);
  const lecturas = porNivel(registro.lecturas.filter((lectura) => lectura.tipo === tipo))
    .map((lectura) => ficha(lectura, registro, textos, observaciones))
    .join('');
  textos.anadir('biblioteca.cuenta', textoDe(registro, 'biblioteca.cuenta'));
  const paginas = textoDeLaBarra('biblioteca.paginas');
  return (
    `<section class="etapa lecturas-bloque" id="${id}" data-etapa aria-labelledby="${titulo}">${h2}` +
    `<p class="lecturas-cuenta" role="status" data-cuenta></p><ul class="lecturas-fichas">${lecturas}</ul>` +
    `<nav class="lecturas-paginas" aria-label="${escapar(paginas.es)}" data-texto-aria-label="biblioteca.paginas" ` +
    `data-paginas hidden><ol class="lecturas-paginas-lista"></ol></nav></section>`
  );
}

/**
 * La parte generada de la Biblioteca: la cabecera; las pestañas de los segmentos, sus filtros y cada segmento, dentro
 * del contenedor de etapas; y los avisos al pie.
 */
function biblioteca(registro: Registro, textos: Textos, observaciones: Observaciones): string {
  const barraDeFiltros = filtros(registro, textos);
  const segmentos = segmentosDe(registro)
    .map((definicion) => segmento(definicion, registro, textos, observaciones))
    .join('');
  const avisos = AVISOS.map((clave) =>
    textos.elemento('p', clave, textoDe(registro, clave), 'class="lecturas-aviso"'),
  ).join('');
  return (
    cabecera(registro, textos) +
    `<div class="etapas" data-etapas="segmentos">${barra(registro, textos)}${barraDeFiltros}` +
    `${segmentos}</div>${avisos}`
  );
}

/**
 * El contenido con el formato de Biome del proyecto, el que exige su puerta.
 *
 * @param ruta - La ruta del archivo desde la raíz: elige el lenguaje.
 * @param contenido - El contenido sin formato.
 * @returns El contenido con formato.
 */
function formatear(ruta: string, contenido: string): string {
  return formatearTextoConBiome(contenido, join(RAIZ, ruta));
}

/**
 * El texto con lo que hay entre las dos marcas cambiado por `nuevo`.
 *
 * @param texto - El archivo entero.
 * @param marcas - La marca de inicio y la de fin.
 * @param nuevo - Lo que va entre ellas.
 * @param ruta - La ruta del archivo, para el mensaje de error.
 * @returns El archivo con la parte nueva.
 * @throws {PaginasSinGenerar} Si faltan las marcas.
 */
function sustituir(texto: string, [inicio, fin]: [string, string], nuevo: string, ruta: string): string {
  const desde = texto.indexOf(inicio);
  const hasta = texto.indexOf(fin);
  if (desde < 0 || hasta < desde) {
    throw new PaginasSinGenerar(`${ruta}: faltan las marcas de la parte generada`);
  }
  return texto.slice(0, desde + inicio.length) + nuevo + texto.slice(hasta);
}

/**
 * Cada archivo que toca el generador, con el contenido que debe tener.
 *
 * @param registro - El registro de lecturas; por omisión, el de datos/lecturas.json.
 * @returns El contenido de cada archivo, por su ruta desde la raíz.
 */
export function archivosDeBiblioteca(registro: Registro = leerRegistro()): Map<string, string> {
  return new Map([...archivosConSuActual(registro)].map(([ruta, { esperado }]) => [ruta, esperado]));
}

/**
 * Cada archivo que toca el generador, con el contenido que tiene y el que debe tener: se lee una sola vez.
 *
 * @param registro - El registro de lecturas.
 * @returns Lo que hay y lo que debe haber, por la ruta desde la raíz.
 */
function archivosConSuActual(registro: Registro): Map<string, { actual: string; esperado: string }> {
  const observaciones = cargarProyeccionLecturas({
    catalogo: join(RAIZ, 'datos/lecturas.json'),
    observaciones: join(RAIZ, 'datos/observaciones-lecturas.json'),
    raizWeb: join(RAIZ, 'web'),
    ahora: new Date().toISOString(),
  });
  const { paginas, diccionarios } = generar(registro, observaciones.objetivos);
  const archivos = new Map<string, { actual: string; esperado: string }>();
  for (const [pagina, parte] of Object.entries(paginas)) {
    const ruta = `web/${pagina}`;
    const actual = readFileSync(join(RAIZ, ruta), 'utf8');
    const esperado = formatear(ruta, sustituir(actual, [MARCA_INICIO, MARCA_FIN], `\n${parte}\n`, ruta));
    archivos.set(ruta, { actual, esperado });
  }
  for (const idioma of IDIOMAS) {
    const ruta = `web/idiomas/${idioma}/lecturas.js`;
    const lineas = Object.keys(diccionarios[idioma])
      .sort()
      .map((clave) => `  ${JSON.stringify(clave)}: ${JSON.stringify(diccionarios[idioma][clave])},\n`);
    const actual = readFileSync(join(RAIZ, ruta), 'utf8');
    const esperado = formatear(
      ruta,
      sustituir(actual, [DICCIONARIO_INICIO, DICCIONARIO_FIN], `\n${lineas.join('')}`, ruta),
    );
    archivos.set(ruta, { actual, esperado });
  }
  return archivos;
}

/**
 * Lo que abre una lectura: un enlace de fuera o un PDF de Faro, siempre en otra pestaña.
 *
 * @param enlace - El enlace de la lectura.
 * @returns Si se abre en otra pestaña.
 */
export function abreEnOtraPestana(enlace: string): boolean {
  return /^https:\/\//.test(enlace) || enlace.startsWith('fichas/');
}

/**
 * De lo sencillo a lo avanzado; dentro de cada nivel, primero el contenido propio de Faro (sus páginas y sus fichas),
 * después por la fecha de publicación, de la más reciente a la más antigua, y luego las que no tienen fecha, por su
 * título en castellano; a igual fecha, también por el título. Las guías propias aún en preparación, que no enlazan a
 * nada, cierran su nivel: no ocupan el principio de la lista.
 *
 * @param lecturas - Las lecturas.
 * @returns Una copia ordenada.
 */
export function porNivel(lecturas: Lectura[]): Lectura[] {
  const sinFecha = (lectura: Lectura) => Number(lectura.fecha.iso === null);
  const pendiente = (lectura: Lectura) => Number(lectura.enlace === null);
  return [...lecturas].sort(
    (a, b) =>
      NIVELES.indexOf(a.nivel) - NIVELES.indexOf(b.nivel) ||
      pendiente(a) - pendiente(b) ||
      Number(esPropia(b)) - Number(esPropia(a)) ||
      sinFecha(a) - sinFecha(b) ||
      compararPorCodigo(b.fecha.iso ?? '', a.fecha.iso ?? '') ||
      compararTexto(a.es.titulo, b.es.titulo, 'es'),
  );
}

/**
 * Lo que se genera: la parte de la Biblioteca y sus textos, en los dos idiomas.
 *
 * @param registro - El registro de lecturas, ya con su forma validada.
 * @returns La parte generada de la página y el tramo de cada diccionario.
 * @throws {RegistroInvalido} Si una referencia del registro está rota, un id se repite o falta un texto.
 * @throws {PaginasSinGenerar} Si una clave de diccionario recibe dos textos distintos.
 */
export function generar(
  registro: Registro,
  observaciones: readonly ProyeccionEnlace[] = [],
): {
  paginas: Record<string, string>;
  diccionarios: Record<Idioma, Record<string, string>>;
} {
  comprobarReferencias(registro);
  const textos = new Textos();
  const paginas = {
    'biblioteca.html': biblioteca(registro, textos, new Map(observaciones.map((dato) => [dato.objetivo, dato]))),
  };
  // El título y la descripción están en la cabecera, fuera de la parte generada.
  for (const clave of ['biblioteca.titulo', 'biblioteca.descripcion']) {
    textos.anadir(clave, textoDe(registro, clave));
  }
  // Los textos que ya tiene el diccionario común (el nombre de la sección) no se repiten en el tramo generado.
  textos.quitar('comun.');
  return { paginas, diccionarios: { es: textos.es, ca: textos.ca } };
}

/**
 * Los archivos que no coinciden con lo que sale del registro.
 *
 * @returns Sus rutas desde la raíz del repositorio.
 */
export function desactualizados(): string[] {
  return [...archivosConSuActual(leerRegistro())]
    .filter(([, { actual, esperado }]) => actual !== esperado)
    .map(([ruta]) => ruta);
}

/** Escribe las páginas y los diccionarios; con --comprobar, solo dice si están al día. */
function principal(): void {
  const uso = 'node herramientas/web/lecturas.ts [--comprobar]';
  const { values } = orden(uso).leer({ options: { comprobar: { type: 'boolean' } } });
  if (values.comprobar) {
    const pendientes = desactualizados();
    if (pendientes.length) {
      throw new PaginasSinGenerar(
        `No están al día con datos/lecturas.json: ${pendientes.join(', ')}. ` +
          'Ejecuta node herramientas/web/lecturas.ts',
      );
    }
    console.log('Biblioteca, al día con datos/lecturas.json.');
    return;
  }
  for (const [ruta, contenido] of archivosDeBiblioteca()) {
    writeFileSync(join(RAIZ, ruta), contenido);
  }
  console.log('Escritas web/biblioteca.html y los textos de web/idiomas/es/lecturas.js y ca/lecturas.js.');
}

if (import.meta.main) {
  await ejecutar(principal);
}
