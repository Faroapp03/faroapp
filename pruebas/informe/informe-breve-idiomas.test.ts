import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseFragment } from 'parse5';
import { construirInforme } from '../../src/dominio/informe.ts';
import { construirInformeBreve } from '../../src/dominio/informe-breve.ts';
import { cargarDatos } from '../../src/plataforma/node/datos.ts';
import { TEXTOS_BREVES_CA, texto } from '../../src/presentacion/informe-breve/idioma.ts';
import { finDelPeriodo, periodo } from '../../src/presentacion/informe-breve/periodos.ts';
import { renderizarInformeBreve } from '../../src/presentacion/informe-breve.ts';
import { informeAdmitido } from '../../web/scripts/confianza/informe.js';

const DATOS = cargarDatos(fileURLToPath(new URL('../../datos/', import.meta.url)));
const FECHA = '2026-10-23';
const HOJAS = 2;

function caso(idioma: 'es' | 'ca', isco08 = '4110') {
  const informe = construirInforme(
    {
      isco08,
      fecha: FECHA,
      sinIa: true,
      tareas: [
        {
          id: 'una',
          texto: 'Tarea oficial',
          tiempo: 'mucho',
          referencia: { tareaOit: `${isco08}-1`, relacion: 'propia' },
        },
      ],
    },
    DATOS,
    { idioma, formacion: null },
  );
  return { informe, breve: construirInformeBreve(informe, DATOS) };
}

test('el informe breve catalán traduce las dos hojas, narrativas, tablas, leyendas y acciones PDF', () => {
  const { informe, breve } = caso('ca');
  const html = renderizarInformeBreve(breve, informe, { incrustado: true });
  assert.doesNotThrow(() => informeAdmitido(html));
  assert.equal(html.split('<section class="hoja ').length - 1, HOJAS);
  for (const texto of [
    'La teva feina i la IA',
    'Les tasques de la teva ocupació',
    'Les teves tasques, una a una',
    'El teu mercat laboral',
    'Contractació',
    'Total de contractes per any',
    'Qui treballa en la teva ocupació',
    'Com llegir aquest informe',
    'D’on surt cada dada',
    'Imprimir o desar en PDF',
    'Esborrar l’informe i el que has escrit',
  ]) {
    assert.ok(html.includes(texto), texto);
  }
  assert.match(html, /class="informe-breve" lang="ca" data-titulo-pdf="La IA i la teva feina/);
  assert.doesNotMatch(
    html,
    /Tus tareas|El mercado laboral|En pocas palabras|Confianza |Fecha prevista:|Fuentes<\/b>|que la media de Cataluña|Con mayoría de|Mujeres y hombres a partes/u,
  );
});

type Nodo = {
  nodeName: string;
  tagName?: string;
  value?: string;
  attrs?: { name: string; value: string }[];
  childNodes?: Nodo[];
};

function contenido(nodo: Nodo): string {
  return nodo.value ?? (nodo.childNodes ?? []).map(contenido).join(' ');
}

function contenidoSinLineaDePapel(nodo: Nodo): string {
  return esLineaDePapel(nodo) ? '' : (nodo.value ?? (nodo.childNodes ?? []).map(contenidoSinLineaDePapel).join(' '));
}

function atributoDelInforme(nodo: Nodo, nombre: string): string | undefined {
  const propio = nodo.attrs?.find(({ name }) => name === nombre)?.value;
  return (
    propio ?? nodo.childNodes?.map((hijo) => atributoDelInforme(hijo, nombre)).find((valor) => valor !== undefined)
  );
}

// Qué tareas caben en la hoja impresa depende de la longitud de los textos de cada idioma: las marcas de papel
// (data-solo-pantalla y la línea ib-tareas-fuera) no son estructura y no se cuentan; todo lo demás, sí.
function esLineaDePapel(nodo: Nodo): boolean {
  return (
    nodo.attrs?.some(({ name, value }) => name === 'class' && value.split(' ').includes('ib-tareas-fuera')) ?? false
  );
}

function estructura(nodo: Nodo): unknown[] {
  if (esLineaDePapel(nodo)) {
    return [];
  }
  const atributos = (nodo.attrs ?? []).filter(
    ({ name }) => !['lang', 'aria-label', 'data-titulo-pdf', 'data-solo-pantalla'].includes(name),
  );
  return [
    ...(atributos.length ? [{ etiqueta: nodo.tagName, atributos }] : []),
    ...(nodo.childNodes ?? []).flatMap(estructura),
  ];
}

for (const isco08 of ['4110', '5120', '2221', '8331', '5411', '7549', '1411']) {
  test(`ES y CA conservan cifras, estructura, gráficos y atributos del informe de ${isco08}`, () => {
    const castellano = caso('es', isco08);
    const catalan = caso('ca', isco08);
    const es = parseFragment(renderizarInformeBreve(castellano.breve, castellano.informe, { incrustado: true }));
    const ca = parseFragment(renderizarInformeBreve(catalan.breve, catalan.informe, { incrustado: true }));
    assert.deepEqual(estructura(ca), estructura(es));
    const cifras = (nodo: Nodo) => contenidoSinLineaDePapel(nodo).match(/\d+(?:[.,]\d+)*/g);
    assert.deepEqual(cifras(ca), cifras(es));
  });
}

test('los nombres oficiales desconocidos conservan contenido, escape e idioma; no se traducen como texto propio', () => {
  const { informe, breve } = caso('ca');
  const nombre = 'Denominación <oficial> {1}';
  const tarea = 'Original task <script> {0}';
  informe.ocupacion.titulo = nombre;
  informe.sinTraducir = [
    { texto: nombre, idioma: 'es' },
    { texto: tarea, idioma: 'en' },
  ];
  breve.ocupacion.titulo = nombre;
  const primera = breve.tareas[0];
  assert.ok(primera);
  breve.tareas = [{ ...primera, nombre: tarea }];
  breve.menosExpuestas = breve.tareas;
  if (breve.uso) {
    breve.uso = { ...breve.uso, granGrupo: null, grupo: nombre };
  }
  const html = renderizarInformeBreve(breve, informe, { incrustado: true });
  assert.match(html, /<span lang="es">Denominación &lt;oficial&gt; \{1\}<\/span>/);
  assert.match(html, /<span lang="en">Original task &lt;script&gt; \{0\}<\/span>/);
  assert.doesNotMatch(html, /<oficial>|<script>/);
  assert.ok(contenido(parseFragment(html)).includes(nombre));
  assert.equal(texto('ca', 'personas del grupo «{0}»', nombre), `persones del grup «${nombre}»`);
});

test('los periodos conservan el corte, localizan sus meses y mantienen las denominaciones ajenas a la gramática', () => {
  assert.equal(periodo('12 meses a abril de 2026', 'ca'), '12 mesos fins a l’abril del 2026');
  assert.equal(periodo('junio de 2026', 'ca'), 'juny del 2026');
  assert.equal(finDelPeriodo('octubre de 2026', 'ca'), 'a l’octubre del 2026');
  assert.equal(finDelPeriodo('junio de 2026', 'ca'), 'al juny del 2026');
  assert.equal(periodo('Periodo <original>', 'ca'), '<span lang="es">Periodo &lt;original&gt;</span>');
  assert.equal(periodo('12 meses a abril de 2026', 'es'), '12 meses a abril de 2026');
});

test('todas las plantillas catalanas conservan exactamente los marcadores del texto de partida', () => {
  const marcas = (valor: string) => [...valor.matchAll(/\{(\d+)\}/g)].map((m) => m[1]).sort();
  for (const [es, ca] of Object.entries(TEXTOS_BREVES_CA)) {
    assert.ok(ca.trim(), es);
    assert.deepEqual(marcas(ca), marcas(es), es);
  }
});

for (const idioma of ['es', 'ca'] as const) {
  test(`la salida de ejemplo ${idioma} conserva su marca completa sin alterar el breve habitual`, () => {
    const { breve, informe } = caso(idioma);
    const ejemplo = parseFragment(renderizarInformeBreve(breve, informe, { ejemplo: true }));
    assert.equal(atributoDelInforme(ejemplo, 'data-marca-ia'), JSON.stringify(informe.marcaIa));
    assert.equal(atributoDelInforme(ejemplo, 'data-fuente-digital'), informe.marcaIa?.fuenteDigital ?? undefined);
    assert.ok(contenido(ejemplo).includes(idioma === 'es' ? 'Ejemplo ficticio' : 'Exemple fictici'));
    const normal = parseFragment(renderizarInformeBreve(breve, informe));
    assert.equal(atributoDelInforme(normal, 'data-marca-ia'), undefined);
  });
}

test('la conclusión de los métodos habla de Faro en tercera persona, nunca en plural, en los dos idiomas', () => {
  const frases = {
    es: /\d+ métodos de medida que Faro ha comprobado sitúan tu ocupación /u,
    ca: /\d+ mètodes de mesura que Faro ha comprovat situen la teva ocupació /u,
  };
  for (const idioma of ['es', 'ca'] as const) {
    for (const isco08 of ['4110', '7411']) {
      const { informe, breve } = caso(idioma, isco08);
      const html = renderizarInformeBreve(breve, informe, { incrustado: true });
      assert.match(html, frases[idioma], `${idioma} ${isco08}`);
      assert.doesNotMatch(html, /hemos comprobado|hem comprovat/u, `${idioma} ${isco08}`);
    }
  }
});
