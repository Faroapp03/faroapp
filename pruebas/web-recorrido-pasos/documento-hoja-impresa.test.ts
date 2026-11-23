// Regla del producto para el PDF, aplicada a la hoja de formación: se imprime entera, en las páginas A4 que
// necesite, sin ocultar apartados, abreviar contenido ni reducir la letra para cumplir un número de hojas; y el folio
// dice la página real. Se comprueba la aplicación; el reparto real
// en páginas lo mide la batería de navegador (pruebas/navegadores/formacion.ts) sobre el PDF.
import './aislar.ts';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { beforeEach, mock, test } from 'node:test';
import { TEXTOS_FORMACION as CA } from '../../web/idiomas/ca/formacion.js';
import { TEXTOS_FORMACION as ES } from '../../web/idiomas/es/formacion.js';
import type { HojaConfirmada } from '../../web/scripts/recorrido/estado.js';
import { fijarIdioma } from '../../web/scripts/textos.js';
import { planDePrueba } from '../fixtures/plan-formacion.ts';
import { casoDeFormacion } from '../fixtures/seleccion-formacion.ts';
import { Nodo, pagina, prepararDom } from './dom.ts';
import { reiniciarInterfaz } from './interfaz-doble.ts';

/** Módulo de la hoja y estado del recorrido real. */
const COPIAS = [
  {
    copia: 'aplicación',
    hoja: await import('../../web/scripts/recorrido/documento-hoja.js'),
    recorrido: await import('../../web/scripts/recorrido/estado.js'),
  },
];

type Medio = 'general' | 'impresion' | 'pantalla';
type Regla = { selectores: string[]; declaraciones: Map<string, string>; cuerpo: string; medio: Medio };

const leer = (ruta: string) => readFileSync(new URL(ruta, import.meta.url), 'utf8');
const COPIAS_CSS = ['../../web/estilos/recorrido/documento-hoja.css'];
const COPIAS_JS = ['../../web/scripts/recorrido/documento-hoja.js'];
// La letra más pequeña de la hoja de impresión aprobada (pruebas/informe/informe-breve-impreso-completo.test.ts).
const MINIMO_PT = 6.84;
// Un objetivo extenso, como el de una tarea larga escrita por la persona.
const REPETICIONES_OBJETIVO = 40;
const UNA_HORA_MS = 3_600_000;
// Lo único que el papel oculta de la hoja: el aviso de error, la hoja bloqueada por vigencia y, según lo que se
// imprima, el otro documento (`.imprimir-…`). El folio de pantalla lo oculta plan-formacion.css.
const OCULTABLES = new Set(['.hd-error-impresion', '.formacion-no-imprimible .rc-hoja-documento .hd']);
const MEDIDAS_DE_LETRA = /^(?:font|font-size|--hd-texto|--hd-pequeno)$/u;
/** El índice que sigue a la llave que cierra la que abre en `abre`. */
function cierre(texto: string, abre: number): number {
  let nivel = 1;
  let fin = abre + 1;
  const paso: Record<string, number> = { '{': 1, '}': -1 };
  while (nivel > 0 && fin < texto.length) {
    nivel += paso[texto[fin] ?? ''] ?? 0;
    fin += 1;
  }
  return fin;
}

/** Las declaraciones propias de un cuerpo, sin las de sus reglas anidadas (las cajas de margen de @page). */
function declaraciones(cuerpo: string): Map<string, string> {
  const sinAnidados = cuerpo.replace(/[^;{}]*\{[^{}]*\}/gu, '');
  return new Map(
    sinAnidados
      .split(';')
      .map((parte) => parte.split(':'))
      .filter((partes) => partes.length >= 2)
      .map(([nombre, ...valor]) => [(nombre ?? '').trim(), valor.join(':').trim()]),
  );
}

/** El medio de las reglas de un @media: solo papel si nombra print, solo pantalla si empieza por screen. */
function medioDe(cabecera: string, exterior: Medio): Medio {
  if (/\bprint\b/u.test(cabecera)) {
    return 'impresion';
  }
  return /^@media\s+screen\b/u.test(cabecera) ? 'pantalla' : exterior;
}

/** Los selectores de una cabecera, separados por las comas que no van dentro de paréntesis (:not, :is…). */
function selectoresDe(cabecera: string): string[] {
  if (cabecera.startsWith('@')) {
    return [cabecera];
  }
  return cabecera.split(/,(?![^(]*\))/u).map((s) => s.trim().replace(/\s+/gu, ' '));
}

/** Las reglas de una hoja de estilo, en orden, con el medio en que se aplican: todos, solo papel o solo pantalla. */
function reglas(css: string, medio: Medio = 'general'): Regla[] {
  const texto = css.replace(/\/\*[\s\S]*?\*\//gu, '');
  const salida: Regla[] = [];
  let i = 0;
  for (let abre = texto.indexOf('{'); abre >= 0; abre = texto.indexOf('{', i)) {
    const cabecera = texto.slice(i, abre).trim();
    const fin = cierre(texto, abre);
    const cuerpo = texto.slice(abre + 1, fin - 1);
    i = fin;
    if (cabecera.startsWith('@media')) {
      salida.push(...reglas(cuerpo, medioDe(cabecera, medio)));
    } else {
      salida.push({ selectores: selectoresDe(cabecera), declaraciones: declaraciones(cuerpo), cuerpo, medio });
    }
  }
  return salida;
}

/** Lo que queda al imprimir para un selector y una propiedad: la última declaración que se aplica en papel. */
function enPapel(lista: readonly Regla[], selector: string, propiedad: string): string | undefined {
  return lista
    .filter(
      ({ medio, selectores, declaraciones: d }) =>
        medio !== 'pantalla' && selectores.includes(selector) && d.has(propiedad),
    )
    .at(-1)
    ?.declaraciones.get(propiedad);
}

/** Los selectores que una regla exclusiva de impresión oculta (display: none o visibility: hidden). */
function ocultosEnPapel(lista: readonly Regla[]): string[] {
  return lista
    .filter(
      ({ medio, declaraciones: d }) =>
        medio === 'impresion' && (d.get('display') === 'none' || /hidden|collapse/u.test(d.get('visibility') ?? '')),
    )
    .flatMap(({ selectores }) => selectores);
}

/** Recortes y alturas que siguen en vigor al imprimir (en reglas generales o de papel). */
function recortesEnPapel(lista: readonly Regla[]): string[] {
  return lista
    .filter(({ medio }) => medio !== 'pantalla')
    .flatMap(({ selectores, declaraciones: d }) =>
      [...d.entries()]
        .filter(
          ([nombre, valor]) =>
            (/^overflow(?:-[xy])?$/u.test(nombre) && /hidden|clip/u.test(valor)) ||
            (nombre === 'max-height' && /\d/u.test(valor)) ||
            (nombre === 'text-overflow' && valor === 'ellipsis') ||
            /line-clamp$/u.test(nombre),
        )
        .map(([nombre, valor]) => `${selectores.join(', ')} → ${nombre}: ${valor}`),
    );
}

/** Alto fijo de la hoja al imprimir: ninguna regla que se aplique en papel le da alto ni proporción. */
function altosDeLaHoja(lista: readonly Regla[]): string[] {
  return lista
    .filter(({ medio, selectores }) => medio !== 'pantalla' && selectores.some((s) => /\.hd-hoja(?:[.:[]|$)/u.test(s)))
    .flatMap(({ selectores, declaraciones: d, medio }) =>
      ['height', 'min-height', 'max-height', ...(medio === 'impresion' ? ['aspect-ratio'] : [])]
        .filter((propiedad) => d.has(propiedad) && !/^(?:auto|none)$/u.test(d.get(propiedad) ?? ''))
        .map((propiedad) => `${selectores.join(', ')} → ${propiedad}: ${d.get(propiedad)}`),
    );
}

/** Lo que en papel cambia la letra o el tamaño: medidas de letra, zoom, scale y transform que no sea un desplazamiento. */
function cambiosDeLetraEnPapel(lista: readonly Regla[]): string[] {
  const cambia = (nombre: string, valor: string) =>
    MEDIDAS_DE_LETRA.test(nombre) ||
    (nombre === 'zoom' && !/^(?:normal|1|100%)$/u.test(valor)) ||
    (nombre === 'scale' && valor !== 'none') ||
    (nombre === 'transform' && !/^(?:none|(?:translate[XYZ3d]*\([^)]*\)\s*)+)$/u.test(valor));
  return lista
    .filter(({ medio, selectores }) => medio === 'impresion' && !selectores[0]?.startsWith('@page'))
    .flatMap(({ selectores, declaraciones: d }) =>
      [...d.entries()]
        .filter(([nombre, valor]) => cambia(nombre, valor))
        .map(([nombre, valor]) => `${selectores.join(', ')} → ${nombre}: ${valor}`),
    );
}

// La separación de los bloques del cuerpo en papel, que sustituye al gap de pantalla.
const SEPARACION_EN_PAPEL = '.hd-hoja > .hd-cuerpo > * + *';

for (const ruta of COPIAS_CSS) {
  const css = leer(ruta);
  const lista = reglas(css);

  test(`en papel la hoja crece con su contenido, en flujo de bloque y en su página con nombre (${ruta})`, () => {
    assert.deepEqual(altosDeLaHoja(lista), []);
    assert.equal(enPapel(lista, '.hd-hoja', 'aspect-ratio'), 'auto');
    assert.equal(enPapel(lista, '.hd-hoja', 'display'), 'block');
    assert.equal(enPapel(lista, '.hd-cuerpo', 'display'), 'block');
    assert.equal(enPapel(lista, SEPARACION_EN_PAPEL, 'margin-top'), 'var(--hd-espacio)');
    assert.equal(enPapel(lista, '.hd-hoja', 'width'), '210mm');
    assert.equal(enPapel(lista, '.hd-hoja', 'page'), 'formacion');
    assert.equal(enPapel(lista, '.hd-hoja', 'break-after'), 'page');
    assert.equal(enPapel(lista, '.hd-hoja:last-child', 'break-after'), 'auto');
    assert.deepEqual(recortesEnPapel(lista), []);
    assert.doesNotMatch(css, /\.hd-medida|297mm|296mm/u);
  });

  test(`el pie va al final del contenido y no se queda solo en una página (${ruta})`, () => {
    const margen = (enPapel(lista, '.hd-pie', 'margin') ?? '').split(/\s+/u);
    assert.match(margen.length <= 2 ? (margen[0] ?? '') : (margen[2] ?? ''), /^0(?:[a-z]+)?$/u);
    // El aire bajo el pie lo da el margen de la página: WebKit ignora break-before: avoid y llevaría ese aire solo a
    // otra página.
    assert.equal(enPapel(lista, '.hd-pie', 'padding-bottom'), '0');
    assert.equal(enPapel(lista, '.hd-pie', 'break-before'), 'avoid');
    assert.equal(enPapel(lista, '.hd-pie', 'break-inside'), 'avoid');
  });

  test(`el folio impreso lo numera la página con el total real (${ruta})`, () => {
    const pagina = lista.find(({ selectores }) => selectores[0] === '@page formacion');
    assert.ok(pagina, 'la hoja imprime en su propia página con nombre');
    assert.match(pagina.declaraciones.get('size') ?? '', /^A4\b/u);
    assert.equal(pagina.declaraciones.get('margin'), '10mm 0 12mm');
    const folio = /@bottom-right\s*\{([^}]*)\}/u.exec(pagina.cuerpo)?.[1] ?? '';
    assert.match(folio, /content:\s*counter\(page\)\s*" \/ "\s*counter\(pages\)/u);
    const tamano = /font-size:\s*([\d.]+)pt/u.exec(folio)?.[1];
    assert.ok(tamano && Number(tamano) >= MINIMO_PT, `letra del folio: ${tamano} pt`);
  });

  test(`en papel solo se ocultan el aviso y la hoja caducada (${ruta})`, () => {
    const ocultos = ocultosEnPapel(lista);
    assert.deepEqual(
      ocultos.filter((selector) => !selector.startsWith('.imprimir-') && !OCULTABLES.has(selector)),
      [],
    );
    assert.ok(ocultos.includes('.hd-error-impresion'), 'el aviso de error');
    // La composición de la hoja no cambia la letra ni el tamaño al imprimir.
    assert.deepEqual(cambiosDeLetraEnPapel(lista), []);
  });
}

// Firefox abre una página en blanco para el final de los ascendientes con página «auto»: al imprimir el informe solo,
// la raíz va en la página del informe. Con la hoja o «los dos» no hace falta, y en Firefox añadiría una página.
// La única regla que da página a la raíz en cada hoja: la página propia del informe o el informe solo del recorrido.
const PAGINA_DE_LA_RAIZ: Readonly<Record<string, readonly string[]>> = {
  '../../web/estilos/informe-breve.css': ['html:has(> body > main.informe-breve) → informe'],
  '../../web/estilos/recorrido/documento-hoja.css': ['html.imprimir-informe → informe'],
};

/** Las reglas que se aplican en papel y dan página a la raíz (`html` o `:root`), con su medio si no es solo papel. */
function paginasDeLaRaiz(lista: readonly Regla[]): string[] {
  return lista
    .filter(({ medio, declaraciones: d }) => medio !== 'pantalla' && d.has('page'))
    .flatMap(({ medio, selectores, declaraciones: d }) =>
      selectores
        .filter((s) => /^(?:html|:root)(?![\w-])/u.test(s))
        .map((s) => `${s} → ${d.get('page')}${medio === 'impresion' ? '' : ` (${medio})`}`),
    );
}

// WebKit no aplica las páginas con nombre: imprime en la página por defecto de informe-breve.css, que deja aire
// arriba y abajo en las páginas de continuación y ningún margen a los lados (la hoja mide 210 mm). El aire no pasa de
// 4,5 mm: WebKit compone la hoja 1 de formación en 292,4 mm y con 4 mm le quedan 1,85 mm de holgura; con 10 o 12 mm
// la hoja no cabe y deja páginas casi vacías (medido en WebKit, bloque D del paso 5).
const MARGEN_VERTICAL_MAXIMO_MM = 4.5;
test('la página por defecto del informe deja margen arriba y abajo y ninguno a los lados', () => {
  for (const ruta of ['../../web/estilos/informe-breve.css']) {
    const pagina = reglas(leer(ruta)).filter(({ selectores }) => selectores[0] === '@page');
    assert.equal(pagina.length, 1, ruta);
    assert.match(pagina[0]?.declaraciones.get('size') ?? '', /^A4\b/u, ruta);
    const [arriba = '', lados = arriba, abajo = arriba] = (pagina[0]?.declaraciones.get('margin') ?? '').split(/\s+/u);
    for (const margen of [arriba, abajo]) {
      assert.match(margen, /^\d+(?:\.\d+)?mm$/u, `${ruta}: margen vertical en milímetros`);
      const mm = Number.parseFloat(margen);
      assert.ok(mm > 0 && mm <= MARGEN_VERTICAL_MAXIMO_MM, `${ruta}: margen vertical entre 0 y 4,5 mm (${margen})`);
    }
    assert.match(lados, /^0(?:[a-z]+)?$/u, `${ruta}: margen lateral`);
  }
});

// WebKit imprime en negro los degradados repetidos: ninguna hoja de estilo de la web los usa.
test('ninguna hoja de estilo de la web usa degradados repetidos', () => {
  const conRepetidos = ['../../web/estilos/'].flatMap((carpeta) =>
    readdirSync(new URL(carpeta, import.meta.url), { recursive: true })
      .map(String)
      .filter(
        (archivo) => archivo.endsWith('.css') && /repeating-[a-z-]*gradient\(/u.test(leer(`${carpeta}${archivo}`)),
      )
      .map((archivo) => `${carpeta}${archivo}`),
  );
  assert.deepEqual(conRepetidos, []);
});

test('al imprimir el informe solo, la raíz va en la página del informe y no deja una página en blanco al final', () => {
  const halladas = Object.fromEntries(
    Object.keys(PAGINA_DE_LA_RAIZ).map((ruta) => [ruta, paginasDeLaRaiz(reglas(leer(ruta)))]),
  );
  assert.deepEqual(halladas, PAGINA_DE_LA_RAIZ);
});

test('el último aviso de estado del recorrido describe la pantalla: no se imprime delante del informe', () => {
  for (const pagina of ['../../web/recorrido.html']) {
    assert.match(leer(pagina), /<p class="solo-lectores" id="rc-estado" role="status"/u, pagina);
  }
  assert.ok(ocultosEnPapel(reglas(leer('../../web/estilos/recorrido/pantallas.css'))).includes('#rc-estado'));
});

test('ninguna copia bloquea la impresión por longitud ni conserva sus textos', () => {
  for (const ruta of COPIAS_JS) {
    const fuente = leer(ruta);
    assert.doesNotMatch(fuente, /cabeEnDosHojas|conEstilosDeImpresion|medidas-de-impresion|desbordamiento/u, ruta);
    assert.doesNotMatch(fuente, /cabe en dos|cap en dues|dos páginas|dues pàgines/u, ruta);
  }
  for (const textos of [ES, CA]) {
    assert.equal(Reflect.get(textos, 'formacion.doc.desbordamiento'), undefined);
  }
});

/** Hoja confirmada con su plan y un objetivo extenso: se imprime entera, sin recortar. */
function hojaLarga(): HojaConfirmada {
  const caso = casoDeFormacion();
  return {
    seleccion: caso.seleccion,
    plan: {
      ...planDePrueba('es'),
      objetivo: 'Preparar una tarea con privacidad y contraste. '.repeat(REPETICIONES_OBJETIVO),
    },
    preferencias: caso.preferencias,
    objetivo: 'Preparar una tarea con privacidad y contraste.',
    idioma: 'es',
    fecha: caso.seleccion.calculado_el,
  } as unknown as HojaConfirmada;
}

/** La raíz del documento con las clases que usa la impresión (el doble del DOM no tiene toggle ni remove). */
class Raiz extends Nodo {
  override get classList() {
    const clases = () => this.className.split(/\s+/u).filter(Boolean);
    return {
      contains: (clase: string) => clases().includes(clase),
      add: (...nuevas: string[]) => {
        this.className = [...new Set([...clases(), ...nuevas])].join(' ');
      },
      remove: (...quitar: string[]) => {
        this.className = clases()
          .filter((c) => !quitar.includes(c))
          .join(' ');
      },
      toggle: (clase: string, poner: boolean) => {
        this.className = [...clases().filter((c) => c !== clase), ...(poner ? [clase] : [])].join(' ');
        return poner;
      },
    };
  }
}

beforeEach(() => {
  prepararDom();
  for (const { recorrido } of COPIAS) {
    recorrido.reiniciarEstado();
  }
  reiniciarInterfaz();
  fijarIdioma('es');
  pagina.documentElement = new Raiz('html');
  const paso = new Nodo('div');
  paso.id = 'paso-4';
  const host = new Nodo('div');
  host.id = 'hoja-de-ruta';
  host.className = 'rc-hoja-documento';
  Object.assign(host, {
    prepend: (nodo: Nodo) => {
      const primero = host.children[0];
      if (primero) {
        primero.before(nodo);
      } else {
        host.append(nodo);
      }
    },
  });
  paso.append(host);
  pagina.body.append(paso);
});

const enRaiz = (clase: string) => pagina.documentElement.classList.contains(clase);

for (const { copia, hoja, recorrido } of COPIAS) {
  test(`una hoja vigente con un objetivo extenso se imprime entera; una caducada sigue bloqueada con su aviso (${copia})`, () => {
    const c = hojaLarga();
    recorrido.estado.hojaDeRuta = c;
    hoja.pintarDocumentoDeLaHoja();
    const preparada = Date.parse(c.plan.confirmadoEl);
    const reloj = mock.method(Date, 'now', () => preparada + UNA_HORA_MS);
    try {
      assert.equal(hoja.prepararHojaParaImprimir(), true);
      assert.equal(pagina.getElementById('hd-error-impresion'), null);
      assert.equal(enRaiz('formacion-no-imprimible'), false);
      assert.equal(pagina.body.querySelectorAll('.pe-ficha-compacta').length, c.plan.elecciones.length);
      assert.ok(
        pagina.body.querySelector('.pe-objetivo')?.textContent === c.plan.objetivo,
        'El objetivo no se recorta',
      );
      const limite = c.plan.elecciones[0]?.oferta.cierra_el;
      assert.ok(limite);
      reloj.mock.mockImplementation(() => Date.parse(limite));
      assert.equal(hoja.prepararHojaParaImprimir(), false);
      const aviso = pagina.getElementById('hd-error-impresion');
      assert.equal(aviso?.textContent, ES['formacion.doc.expirada']);
      assert.equal(pagina.activeElement, aviso);
      assert.equal(enRaiz('formacion-no-imprimible'), true);
      // Sin documento que imprimir no imprime y no deja el bloqueo ni el aviso del intento anterior.
      pagina.body.querySelector('#hoja-de-ruta .hd')?.remove();
      assert.equal(hoja.prepararHojaParaImprimir(), false);
      assert.equal(pagina.getElementById('hd-error-impresion'), null);
      assert.equal(enRaiz('formacion-no-imprimible'), false);
    } finally {
      reloj.mock.restore();
    }
  });
}

test('cada clase .hd-* de la hoja de estilo la pinta un guion de la hoja: no quedan reglas sin uso', () => {
  const guiones = [
    '../../web/scripts/recorrido/plan-formacion/documento.js',
    '../../web/scripts/recorrido/documento-hoja.js',
  ]
    .map(leer)
    .join('\n');
  for (const ruta of COPIAS_CSS) {
    const clases = new Set([...leer(ruta).matchAll(/\.(hd-[\w-]+)/gu)].map((m) => m[1] ?? ''));
    const sinUso = [...clases].filter((clase) => !new RegExp(`['" ]${clase}['" ]`, 'u').test(guiones));
    assert.deepEqual(sinUso, [], ruta);
  }
});
