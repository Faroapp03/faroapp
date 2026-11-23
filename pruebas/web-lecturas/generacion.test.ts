import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { esPropia, FUENTE_PROPIA } from '../../herramientas/web/lecturas/referencias.ts';
import { comoRegistro, leerRegistro, NIVELES, TIPOS } from '../../herramientas/web/lecturas/registro.ts';
import { desactualizados, generar, porNivel } from '../../herramientas/web/lecturas.ts';
import { proyectarObservaciones } from '../../src/biblioteca/observaciones-lecturas.ts';
import { TEXTOS_LECTURAS as ca } from '../../web/idiomas/ca/lecturas.js';
import { TEXTOS_LECTURAS as es } from '../../web/idiomas/es/lecturas.js';

const registro = leerRegistro();
const LONGITUD_SHA = 64;
const SHA_DE_PRUEBA = 'a'.repeat(LONGITUD_SHA);
const SIETE_DIAS_MS = 604_800_000;
const HTTP_NO_ENCONTRADO = 404;
type Lectura = (typeof registro.lecturas)[number];
/** El registro entero con una lectura cambiada por otra versión suya: ningún segmento queda vacío. */
const conCambio = (cambiada: Lectura) => ({
  ...registro,
  lecturas: registro.lecturas.map((lectura) => (lectura.id === cambiada.id ? cambiada : lectura)),
});
/** Una lectura de fuera, con enlace https://. */
const externa = registro.lecturas.find((lectura) => lectura.enlace?.startsWith('https://'));
assert.ok(externa);

test('el registro reproduce exactamente las páginas y los diccionarios existentes', () => {
  assert.deepEqual(desactualizados(), []);
  const { diccionarios } = generar(registro);
  assert.deepEqual(diccionarios.es, es);
  assert.deepEqual(diccionarios.ca, ca);
});

test('minutos inválidos se rechazan antes de generar cifras o HTML', () => {
  const primera = registro.lecturas[0];
  assert.ok(primera);
  const NEGATIVO = -1;
  const FRACCION = 1.5;
  for (const minutos of [NEGATIVO, 0, FRACCION, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => comoRegistro({ ...registro, lecturas: [{ ...primera, minutos }] }), /forma esperada/);
  }
});

test('una lectura que no se lee en castellano ni en catalán se rechaza, con su nombre; con el inglés de más, entra', () => {
  const primera = registro.lecturas[0];
  assert.ok(primera);
  for (const idiomas of [['en'], ['en', 'fr'], []]) {
    assert.throws(
      () => comoRegistro({ ...registro, lecturas: [...registro.lecturas, { ...primera, id: 'solo-ingles', idiomas }] }),
      (error: unknown) =>
        error instanceof Error &&
        error.message === 'datos/lecturas.json: la lectura "solo-ingles" no se puede leer en castellano ni en catalán',
      JSON.stringify(idiomas),
    );
  }
  // Con el inglés además del castellano y el catalán, entra y lo dice en los dos idiomas, en su orden.
  const triple = { ...externa, idiomas: ['en', 'ca', 'es'] };
  const { diccionarios } = generar(comoRegistro(conCambio(triple)));
  assert.equal(diccionarios.es['lecturas.idiomas.es-ca-en'], 'Castellano, catalán e inglés');
  assert.equal(diccionarios.ca['lecturas.idiomas.es-ca-en'], 'Castellà, català i anglès');
});

test('enlaces ejecutables, malformados o fuera de las fichas se rechazan antes de publicar', () => {
  for (const enlace of [
    'javascript:alert(1)',
    'https://',
    'fichas/../../inicio.html',
    '//otro.example/f.pdf',
    'inicio.html',
  ]) {
    assert.throws(() => generar(conCambio({ ...externa, enlace })), /enlace/, enlace);
  }
  assert.throws(() => generar(conCambio({ ...externa, enlace_ca: 'javascript:alert(1)' })), /enlace/);
});

test('referencias y claves rotas se rechazan; los textos se escapan al generar', () => {
  const primera = registro.lecturas[0];
  assert.ok(primera);
  assert.throws(() => generar({ ...registro, lecturas: [...registro.lecturas, primera] }), /está repetido/);
  assert.throws(() => generar(conCambio({ ...primera, tema: 'no-existe' })), /tema/);
  assert.throws(
    () => generar({ ...registro, lecturas: [...registro.lecturas, { ...primera, id: 'a"b' }] }),
    /identificador/,
  );
  const conTexto = { ...primera, es: { ...primera.es, titulo: '<img onerror="alert(1)">' } };
  const html = generar(conCambio(conTexto)).paginas['biblioteca.html'];
  assert.ok(html);
  assert.ok(html.includes('&lt;img onerror=&quot;alert(1)&quot;&gt;'));
  assert.ok(!html.includes('<img onerror='));
});

test('el segmento sale del tipo; sin segmento ni sección una lectura entra; un tipo desconocido o un segmento vacío, no', async (contexto) => {
  const { tema: _tema, ...sinTema } = externa;
  await contexto.test('las entradas no llevan segmento ni sección, ni el registro tiene segmentos temáticos', () => {
    const crudo = JSON.parse(readFileSync(new URL('../../datos/lecturas.json', import.meta.url), 'utf8'));
    assert.equal(crudo.segmentos, undefined);
    for (const lectura of crudo.lecturas) {
      assert.ok(!('segmento' in lectura) && !('seccion' in lectura), lectura.id);
    }
  });
  await contexto.test('una lectura con campos segmento y sección también vale: no se leen', () => {
    const antigua = { ...externa, id: 'antigua', segmento: 'cualquiera', seccion: 'biblioteca' };
    assert.doesNotThrow(() => generar(comoRegistro({ ...registro, lecturas: [...registro.lecturas, antigua] })));
  });
  await contexto.test('sin tema, una lectura entra; con un tema que no existe, no', () => {
    assert.doesNotThrow(() => generar(conCambio(sinTema)));
    assert.throws(() => generar(conCambio({ ...externa, tema: 'no-existe' })), /tema «no-existe»/);
  });
  await contexto.test('un tipo fuera de guía, informe y nota no tiene la forma esperada', () => {
    assert.throws(() => comoRegistro({ ...registro, lecturas: [{ ...externa, tipo: 'cartel' }] }), /forma esperada/);
  });
  await contexto.test('un segmento sin lecturas se rechaza', () => {
    const sinNotas = registro.lecturas.filter((lectura) => lectura.tipo !== 'nota');
    assert.throws(() => generar({ ...registro, lecturas: sinNotas }), /segmento «notas» no tiene lecturas/);
  });
  await contexto.test('falta el nombre de un segmento', () => {
    const { 'biblioteca.tipos.informe': _fuera, ...textos } = registro.textos;
    assert.throws(() => generar({ ...registro, textos }), /biblioteca\.tipos\.informe/);
  });
  await contexto.test('lectura externa sin enlace, no; sin formato, sí: lo que abre sale de su dirección', () => {
    assert.throws(() => generar(conCambio({ ...externa, enlace: null })), /enlace/);
    const { formato: _formato, ...sinFormato } = externa;
    const abre = (enlace: string) => {
      const html = generar(conCambio({ ...sinFormato, enlace })).paginas['biblioteca.html'] ?? '';
      const desde = html.indexOf(`id="abre-${externa.id}"`);
      return html.slice(desde, html.indexOf('</dd>', desde));
    };
    assert.match(abre('https://ejemplo.org/guia.pdf'), /<span>PDF<\/span>/);
    assert.match(abre('https://ejemplo.org/guia'), /data-texto="lecturas\.formato\.web">Página web</);
  });
  await contexto.test('una página de Faro o una guía en preparación, solo del Equipo Faro', () => {
    assert.throws(() => generar(conCambio({ ...externa, enlace: 'inicio.html' })), /enlace no admitido/);
    assert.doesNotThrow(() => generar(conCambio({ ...externa, fuente: 'Equipo Faro', enlace: 'inicio.html' })));
    assert.doesNotThrow(() => generar(conCambio({ ...externa, fuente: 'Equipo Faro', enlace: null })));
  });
});

test('una selección nueva sin segmento ni sección entra sin tocar el generador: 20 por tipo, cada una en su pestaña', () => {
  const { tema: _tema, subtipo: _subtipo, ...base } = externa;
  const POR_TIPO = 20;
  const MESES = 9;
  const SIN_FECHA = 4;
  const nuevas = TIPOS.flatMap(({ tipo }) =>
    Array.from({ length: POR_TIPO }, (_, n) => ({
      ...base,
      id: `nueva-${tipo}-${n}`,
      tipo,
      nivel: NIVELES[n % NIVELES.length],
      fecha: { ...base.fecha, iso: n % SIN_FECHA === 0 ? null : `2026-0${(n % MESES) + 1}-01` },
    })),
  );
  const html = generar(comoRegistro({ ...registro, lecturas: nuevas })).paginas['biblioteca.html'] ?? '';
  for (const { tipo, segmento } of TIPOS) {
    const desde = html.indexOf(`id="${segmento}"`);
    const seccion = html.slice(desde, html.indexOf('</section>', desde));
    assert.equal(seccion.match(/data-filtrable/g)?.length, POR_TIPO, segmento);
    assert.equal(seccion.match(new RegExp(`data-tipo="${tipo}"`, 'g'))?.length, POR_TIPO, segmento);
  }
});

/** Comprueba el orden de dos lecturas seguidas del mismo nivel. */
function comprobarPar(lectura: Lectura, siguiente: Lectura): void {
  const pendiente = (otra: Lectura) => Number(otra.enlace === null);
  assert.ok(pendiente(lectura) <= pendiente(siguiente), `${lectura.id}: en preparación, al final`);
  if (pendiente(lectura) || pendiente(siguiente)) {
    return;
  }
  assert.ok(Number(esPropia(lectura)) >= Number(esPropia(siguiente)), `${lectura.id}: lo propio, primero`);
  if (esPropia(lectura) !== esPropia(siguiente)) {
    return;
  }
  const [x, y] = [lectura.fecha.iso, siguiente.fecha.iso];
  if (x !== null && y !== null) {
    assert.ok(x >= y, `${lectura.id} (${x}) → ${siguiente.id} (${y}): de la más reciente a la más antigua`);
  } else {
    assert.ok(x !== null || y === null, `${lectura.id}: sin fecha, al final`);
  }
  if (x === y) {
    assert.ok(lectura.es.titulo.localeCompare(siguiente.es.titulo, 'es') <= 0, `${lectura.id}: por título`);
  }
}

test('dentro de cada nivel: lo propio de Faro, después por fecha de la más reciente y al final lo que no tiene fecha', () => {
  const ordenadas = porNivel(registro.lecturas);
  for (const [posicion, lectura] of ordenadas.entries()) {
    const siguiente = ordenadas[posicion + 1];
    if (!siguiente) {
      break;
    }
    const [a, b] = [NIVELES.indexOf(lectura.nivel), NIVELES.indexOf(siguiente.nivel)];
    assert.ok(a <= b, `${lectura.id} → ${siguiente.id}: nivel`);
    if (a === b) {
      comprobarPar(lectura, siguiente);
    }
  }
  assert.ok(
    registro.lecturas.some((lectura) => lectura.fecha.iso === null),
    'la selección tiene lecturas sin fecha',
  );
});

test('con un registro de prueba: lo propio de Faro abre su nivel, aunque sea antiguo o no tenga fecha; lo que está en preparación lo cierra', () => {
  const deFuera = registro.lecturas.filter(
    (lectura) => lectura.tipo === 'informe' && lectura.nivel === 'empezar' && !esPropia(lectura),
  );
  const [base] = deFuera;
  assert.ok(base && deFuera.some((lectura) => lectura.fecha.iso !== null));
  const { enlace_ca: _ca, ...sinCatalan } = base;
  const ficha = {
    ...sinCatalan,
    id: 'prueba-ficha',
    enlace: 'fichas/generalitat-registro-ia.pdf',
    fecha: { ...base.fecha, iso: '2001-01' },
  };
  const pagina = {
    ...sinCatalan,
    id: 'prueba-pagina',
    fuente: FUENTE_PROPIA,
    enlace: 'entender-ia.html',
    fecha: { ...base.fecha, iso: null },
  };
  const pendiente = {
    ...sinCatalan,
    id: 'prueba-pendiente',
    fuente: FUENTE_PROPIA,
    enlace: null,
    fecha: { ...base.fecha, iso: '2099-01-01' },
  };
  const esperado = ['prueba-ficha', 'prueba-pagina', ...porNivel(deFuera).map(({ id }) => id), 'prueba-pendiente'];
  assert.deepEqual(
    porNivel([pendiente, ...deFuera, pagina, ficha]).map(({ id }) => id),
    esperado,
  );
  // Y así sale en la pestaña «Informes» de la página generada.
  const html =
    generar(comoRegistro({ ...registro, lecturas: [...registro.lecturas, pendiente, pagina, ficha] })).paginas[
      'biblioteca.html'
    ] ?? '';
  const desde = html.indexOf('id="informes"');
  const ids = [...html.slice(desde, html.indexOf('</section>', desde)).matchAll(/data-lectura="([^"]+)"/g)].map(
    ([, id]) => id,
  );
  assert.deepEqual(ids.slice(0, esperado.length), esperado);
});

test('cada recurso local enlazado existe y conserva procedencia y firma PDF', () => {
  const FIRMA_PDF = '%PDF-';
  for (const lectura of registro.lecturas) {
    assert.ok(lectura.fuente.trim() && lectura.licencia.trim());
    assert.match(lectura.consultado, /^\d{4}-\d{2}-\d{2}$/);
    for (const enlace of [lectura.enlace, lectura.enlace_ca]) {
      if (enlace && !enlace.startsWith('https://')) {
        const archivo = new URL(`../../web/${enlace}`, import.meta.url);
        assert.ok(existsSync(archivo), enlace);
        if (enlace.endsWith('.pdf')) {
          assert.equal(readFileSync(archivo).subarray(0, FIRMA_PDF.length).toString(), FIRMA_PDF);
        }
      }
    }
  }
});

test('cada lectura enlazada tiene un destino único dentro del segmento de su tipo', () => {
  const html = readFileSync(new URL('../../web/biblioteca.html', import.meta.url), 'utf8');
  for (const { tipo, segmento } of TIPOS) {
    const desde = html.indexOf(`id="${segmento}"`);
    assert.ok(desde >= 0, segmento);
    const seccion = html.slice(desde, html.indexOf('</section>', desde));
    for (const lectura of registro.lecturas.filter((lectura) => lectura.tipo === tipo && lectura.enlace !== null)) {
      const destino = `id="abre-${lectura.id}"`;
      assert.equal(html.split(destino).length - 1, 1, `${lectura.id}: destino único`);
      assert.ok(seccion.includes(destino), `${lectura.id}: en ${segmento}`);
    }
  }
});

test('los filtros y las páginas parten ocultos y cada enlace aparte declara apertura y protección', () => {
  const html = readFileSync(new URL('../../web/biblioteca.html', import.meta.url), 'utf8');
  assert.match(html, /hidden\s+data-filtros=/);
  assert.equal(html.match(/data-paginas\s+hidden/g)?.length, TIPOS.length);
  const aparte = [...html.matchAll(/<a\s[^>]*target="_blank"[^>]*>/g)];
  assert.ok(aparte.length > 0);
  for (const [etiqueta] of aparte) {
    assert.match(etiqueta, /rel="noopener noreferrer"/);
    const id = /aria-describedby="([^"]+)"/.exec(etiqueta)?.[1];
    assert.ok(id && html.includes(`id="${id}"`));
  }
});

test('el HTML sin JavaScript no enlaza un destino no seguro y conserva todas las fichas', () => {
  const lectura = registro.lecturas.find((fila) => fila.enlace_ca);
  assert.ok(lectura?.enlace);
  const proyeccion = {
    objetivo: `${lectura.id}:enlace`,
    id: lectura.id,
    campo: 'enlace',
    url: lectura.enlace,
    estado: 'no_comprobado',
    abrir: false,
    motivo: 'destino_no_seguro',
    comprobado_utc: null,
    ultimo_intento_utc: '2026-10-23T12:00:00Z',
    cuerpo_sha256: null,
    incidencia: null,
  };
  const html = generar(registro, [proyeccion]).paginas['biblioteca.html'];
  assert.ok(html);
  const desde = html.indexOf(`data-lectura="${lectura.id}"`);
  const ficha = html.slice(desde, html.indexOf('</li>', desde));
  assert.match(ficha, /<a aria-disabled="true" data-enlace-es=/);
  assert.match(ficha, /data-abrir-es="false"/);
  assert.match(ficha, /data-abrir-ca="true"/);
  assert.ok(!ficha.includes('data-comprobado-'));
  assert.equal(html.match(/data-lectura=/g)?.length, registro.lecturas.length);
});

/** Captura del contrato de enlaces_lecturas: confirmada o 404, en `instante` (plazo técnico de 7 días). */
function capturaDe(url: string, confirmada: boolean, instante: string) {
  const vence = new Date(Date.parse(instante) + SIETE_DIAS_MS).toISOString().replace('.000Z', 'Z');
  const comun = { url, capturado_utc: instante, error_tipo: null, vence_utc: vence };
  return confirmada
    ? {
        ...comun,
        url_final: url,
        cuerpo_sha256: SHA_DE_PRUEBA,
        content_type: 'text/html',
        resultado: 'respuesta',
        codigo_http: null,
        estado: 'verificado',
        identidad_acreditada: true,
        lectura_tecnica: { estado: 'legible_html' },
      }
    : {
        ...comun,
        url_final: null,
        cuerpo_sha256: null,
        content_type: '',
        resultado: 'http_error',
        codigo_http: HTTP_NO_ENCONTRADO,
        estado: 'http_no_encontrado',
        identidad_acreditada: false,
        lectura_tecnica: { estado: 'http_error' },
      };
}

test('la proyección real de confirmado y después 404 genera la fecha, la incidencia y el enlace abierto', () => {
  const lectura = externa;
  assert.ok(lectura.enlace);
  const objetivo = { objetivo: `${lectura.id}:enlace`, id: lectura.id, campo: 'enlace', url: lectura.enlace };
  const confirmada = capturaDe(lectura.enlace, true, '2026-10-20T08:00:00Z');
  const ausente = capturaDe(lectura.enlace, false, '2026-10-22T08:00:00Z');
  const { objetivos } = proyectarObservaciones({
    catalogoSha256: SHA_DE_PRUEBA,
    objetivos: [objetivo],
    ahora: '2026-10-25T09:00:00Z',
    observaciones: {
      version: 2,
      catalogo_sha256: SHA_DE_PRUEBA,
      validez_dias: 7,
      revision_editorial: 'fuera_del_alcance',
      objetivos: [
        {
          ...objetivo,
          estado: ausente.estado,
          ultimo_intento: ausente,
          ultima_confirmacion: confirmada,
          ultima_evidencia: ausente,
        },
      ],
      verificados: 0,
    },
  });
  assert.equal(objetivos[0]?.estado, 'comprobado_antes_con_evidencia_contraria');
  const html = generar(registro, objetivos).paginas['biblioteca.html'];
  assert.ok(html);
  const desde = html.indexOf(`data-lectura="${lectura.id}"`);
  const ficha = html.slice(desde, html.indexOf('</li>', desde));
  assert.match(ficha, /data-comprobado-es="2026-10-20T08:00:00Z"/);
  assert.match(ficha, /data-incidencia-es="2026-10-22T08:00:00Z"/);
  assert.match(ficha, /<a href="/);
  assert.ok(!html.includes('data-vence-'));
});

test('los rótulos Inicial, Lectura e Idioma conservan sus claves aunque ES y CA coincidan', () => {
  const { paginas, diccionarios } = generar(registro);
  const html = paginas['biblioteca.html'];
  assert.ok(html);
  for (const clave of ['lecturas.niveles.empezar', 'lecturas.vistazo.lectura', 'lecturas.vistazo.idioma']) {
    assert.ok(html.includes(`data-texto="${clave}"`), clave);
    assert.equal(diccionarios.es[clave], registro.textos[clave]?.es);
    assert.equal(diccionarios.ca[clave], registro.textos[clave]?.ca);
  }
  assert.doesNotMatch(html, /<dt>(Lectura|Idioma)<\/dt>|<span>Inicial<\/span>/u);
});
