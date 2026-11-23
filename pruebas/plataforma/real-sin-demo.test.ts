/**
 * La aplicación real no conoce la demo: ningún archivo del servidor (src/), de los guiones, idiomas y administración de
 * la web, de las páginas reales, de los guiones del producto (scripts/), de las herramientas ni de la documentación
 * (docs/) la nombra, salvo lo que esta guardia admite por nombre y con su motivo. En el código se revisa cada línea; en
 * Markdown, cada frase de cada párrafo, para que admitir una frase no dependa de cómo se corta el párrafo.
 *
 * - CONTRATO_HEREDADO: lo que el real necesita para leer un estado guardado con modo `demo` y recuperarlo a `real`
 *   cuando la demo no está instalada (la restricción de la base solo admite esos dos valores). Es la excepción explícita
 *   a la regla: estado persistido heredado, no una dependencia del real con la extensión. Lo forman la restricción
 *   `CHECK(modo IN ('real','demo'))` de la tabla del modo, los tipos cerrados que la reflejan (`VarianteRecorrido` en
 *   src/plataforma/variantes-recorrido.ts y `ModoRecorrido` en src/administracion/recorrido.ts) y las lecturas y
 *   validaciones de ese mismo valor guardado.
 * - La portada anuncia el estreno privado del 1 de diciembre. Se descuentan únicamente los cinco rótulos aprobados.
 * - TRANSITORIO: lo que todavía se genera con la demo dentro y se resuelve en la construcción por página. Esa lista se
 *   vacía; una entrada que ya no aparece en su archivo falla hasta que se retira.
 *
 * Las entradas marcadas como de la extensión (su línea del registro y lo generado con ella) solo se exigen con alguna
 * extensión instalada: al retirar la última desaparecen de sus archivos sin tocar esta guardia.
 *
 * Las excepciones por archivo se generan desde el registro de extensiones, y la guardia exige que su contenido sea
 * exactamente el generado: `web/scripts/variantes-disponibles.js` y `web/scripts/secciones-contrato.js`, la copia de
 * `src/administracion/secciones-web.js` (revisada aquí) con las rutas de sección del registro.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { artefactosComunes } from '../../herramientas/web/comunes.ts';
import { EXTENSIONES } from '../../src/plataforma/extensiones.ts';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
/** «demo» como palabra o como parte de un identificador (DEMO, modoDemo, .demo, /demo/); no «demostrar». */
const NOMBRA_LA_DEMO = /(?:^|[^A-Za-zÁÉÍÓÚÑáéíóúñ])demo(?![a-záéíóúñ])|Demo(?![a-záéíóúñ])|DEMO(?![A-Z])/u;
const CARPETAS = ['src', 'web/scripts', 'web/idiomas', 'web/administracion', 'scripts', 'herramientas', 'docs'];
/** Código, páginas, documentación y configuración en texto; no los binarios ni las cachés. */
const REVISADOS = /\.(?:[cm]?[jt]s|html|md|json|py|sh)$/u;
/** El final de una frase en Markdown: un signo de cierre seguido de espacio y de algo que no empieza en minúscula. */
const FIN_DE_FRASE = /(?<=[.!?])\s+(?=[^a-záéíóúñ])/u;
const SECCIONES_DEL_REGISTRO = 'web/scripts/secciones-contrato.js';
const GENERADOS_DESDE_EL_REGISTRO = new Set(['web/scripts/variantes-disponibles.js', SECCIONES_DEL_REGISTRO]);
/** La lista medida de pruebas nombra archivos de prueba por su ruta; no es un texto del producto que hable de la demo. */
const LISTAS_DE_ARCHIVOS_DE_PRUEBA = ['scripts/pruebas-que-leen-datos.json'];
/** Lo que la guardia no lee: se genera desde el registro o solo enumera archivos. */
const FUERA_DE_LA_GUARDIA = new Set([...GENERADOS_DESDE_EL_REGISTRO, ...LISTAS_DE_ARCHIVOS_DE_PRUEBA]);
/** Las páginas de la web, por su nombre: una página nueva o retirada se ve aquí y pasa la misma guardia que las demás. */
const PAGINAS_REALES = [
  'accesibilidad.html',
  'activar-acceso.html',
  'biblioteca.html',
  'conectividad.html',
  'creditos.html',
  'cursos.html',
  'datos-globales-mundo.html',
  'datos-globales-ue.html',
  'datos-globales.html',
  'doctor.html',
  'encuesta.html',
  'entender-ia.html',
  'informacion-y-creditos.html',
  'informe-ejemplo.html',
  'inicio.html',
  'instalar.html',
  'no-existe.html',
  'que-es-faro.html',
  'recorrido.html',
  'sin-conexion.html',
  'verificable.html',
].map((nombre) => `web/${nombre}`);
const ANCHO_DE_LA_CITA = 100;

interface Admitida {
  readonly archivo: string | RegExp;
  readonly linea: string | RegExp;
  readonly motivo: string;
  /** La entrada pertenece a la extensión instalada: sin extensiones en el registro no se exige que aparezca. */
  readonly deLaExtension?: true;
}

const CONTRATO_HEREDADO: readonly Admitida[] = [
  {
    archivo: 'src/plataforma/acceso-publico/recorrido-sqlite.ts',
    linea: "CHECK(modo IN ('real','demo'))",
    motivo: 'Restricción de la base: el modo guardado solo puede ser real o demo. Estado persistido heredado.',
  },
  {
    archivo: 'src/administracion/recorrido.ts',
    linea: "export type ModoRecorrido = 'real' | 'demo';",
    motivo: 'Tipo cerrado del modo guardado, el mismo de la restricción de la base.',
  },
  {
    archivo: 'src/administracion/recorrido.ts',
    linea: "if (valor !== 'real' && valor !== 'demo') {",
    motivo: 'leerModo: lee el modo guardado para poder recuperarlo a real.',
  },
  {
    archivo: 'src/administracion/recorrido-http.ts',
    linea: "cuerpo.modo === 'real' || cuerpo.modo === 'demo'",
    motivo: 'Tipo cerrado de la petición: un modo demo sin demo instalada se rechaza después, por el registro.',
  },
  {
    archivo: 'src/plataforma/variantes-recorrido.ts',
    linea: "export type VarianteRecorrido = 'real' | 'demo';",
    motivo: 'Tipo cerrado de la variante, el mismo de la restricción de la base: estado persistido heredado.',
  },
  {
    archivo: 'src/plataforma/cloudflare/acceso-recorrido.ts',
    linea: "(modo.modo === 'real' || modo.modo === 'demo')",
    motivo: 'Validación del modo leído; un modo demo sin demo instalada responde 503.',
  },
  {
    archivo: 'src/plataforma/extensiones-instaladas.ts',
    linea: "export { DEMO } from '../../web/demo/servidor/extension.ts';",
    motivo: 'El registro: la línea que instala la extensión; retirar la demo es borrar su carpeta y esta línea.',
    deLaExtension: true,
  },
  {
    archivo: 'docs/administracion.md',
    linea: /^El modo guardado es `real` o `demo`\.$/u,
    motivo: 'Documentación del modo guardado: el mismo tipo cerrado de la restricción de la base.',
  },
];

const TRANSITORIO: readonly Admitida[] = [];

const PORTADA = 'src/plataforma/cloudflare/portada-publica.ts';
const ROTULOS_DEL_ESTRENO = [
  "cuenta: 'La demo privada comienza en',",
  "iniciada: 'La demo privada ha comenzado',",
  "cuenta: 'La demo privada comença d’aquí a',",
  "iniciada: 'La demo privada ha començat',",
  'id="cuenta" role="timer" aria-label="Compte enrere de la demo privada"',
];

function sinRotulosDelEstreno(archivo: string, texto: string, vistos: Set<string>): string {
  if (archivo !== PORTADA) {
    return texto;
  }
  let resto = texto;
  for (const rotulo of ROTULOS_DEL_ESTRENO) {
    if (resto.includes(rotulo)) {
      vistos.add(rotulo);
      resto = resto.replace(rotulo, '');
    }
  }
  return resto;
}

function archivosDe(carpeta: string): string[] {
  const absoluta = join(RAIZ, carpeta);
  if (!existsSync(absoluta)) {
    return [];
  }
  return readdirSync(absoluta).flatMap((nombre) => {
    const ruta = join(absoluta, nombre);
    if (statSync(ruta).isDirectory()) {
      return archivosDe(relative(RAIZ, ruta));
    }
    return REVISADOS.test(nombre) ? [relative(RAIZ, ruta)] : [];
  });
}

function revisados(): string[] {
  const paginas = readdirSync(join(RAIZ, 'web')).filter((nombre) => nombre.endsWith('.html'));
  return [...CARPETAS.flatMap(archivosDe), ...paginas.map((nombre) => `web/${nombre}`)]
    .map((ruta) => ruta.split('\\').join('/'))
    .sort();
}

/** Lo que se revisa de un archivo, con su línea: cada línea del código y cada frase de los párrafos de Markdown. */
function unidades(archivo: string, texto: string): { linea: number; texto: string }[] {
  const lineas = texto.split('\n');
  if (!archivo.endsWith('.md')) {
    return lineas.map((linea, indice) => ({ linea: indice + 1, texto: linea }));
  }
  const frases: { linea: number; texto: string }[] = [];
  let parrafo: string[] = [];
  let inicio = 0;
  const cerrar = () => {
    for (const frase of parrafo.join(' ').split(FIN_DE_FRASE)) {
      frases.push({ linea: inicio, texto: frase });
    }
    parrafo = [];
  };
  lineas.forEach((linea, indice) => {
    if (!linea.trim()) {
      cerrar();
      return;
    }
    if (!parrafo.length) {
      inicio = indice + 1;
    }
    parrafo.push(linea.trim());
  });
  cerrar();
  return frases;
}

function casa(patron: string | RegExp, valor: string, completo: boolean) {
  if (typeof patron !== 'string') {
    return patron.test(valor);
  }
  return completo ? patron === valor : valor.includes(patron);
}

function admitidaPor(lista: readonly Admitida[], archivo: string, linea: string) {
  return lista.find((entrada) => casa(entrada.archivo, archivo, true) && casa(entrada.linea, linea, false));
}

const ADMITIDAS = [CONTRATO_HEREDADO, TRANSITORIO];
const GUARDIA = 'el real no nombra la demo fuera del contrato heredado y de la lista transitoria';

test(GUARDIA, () => {
  const usadas = new Set<Admitida>();
  const rotulosVistos = new Set<string>();
  const fuera: string[] = [];
  const archivos = revisados();
  assert.deepEqual(
    archivos.filter((ruta) => /^web\/[^/]+\.html$/u.test(ruta)),
    PAGINAS_REALES,
  );
  for (const archivo of archivos) {
    if (FUERA_DE_LA_GUARDIA.has(archivo)) {
      continue;
    }
    for (const { linea, texto } of unidades(archivo, readFileSync(join(RAIZ, archivo), 'utf8'))) {
      if (!NOMBRA_LA_DEMO.test(sinRotulosDelEstreno(archivo, texto, rotulosVistos))) {
        continue;
      }
      const admitida = ADMITIDAS.map((lista) => admitidaPor(lista, archivo, texto)).find(Boolean);
      if (admitida) {
        usadas.add(admitida);
      } else {
        fuera.push(`${archivo}:${linea}: ${texto.trim().slice(0, ANCHO_DE_LA_CITA)}`);
      }
    }
  }
  assert.deepEqual(
    ROTULOS_DEL_ESTRENO.filter((rotulo) => !rotulosVistos.has(rotulo)),
    [],
  );
  const conFugas = new Set(fuera.map((fuga) => fuga.slice(0, fuga.indexOf(':'))));
  assert.deepEqual(
    fuera,
    [],
    `${fuera.length} líneas en ${conFugas.size} archivos nombran la demo sin estar admitidas. Llévalas a la carpeta ` +
      'de la extensión o genéralas desde el registro.',
  );
  const exigidas = ADMITIDAS.flat().filter((entrada) => EXTENSIONES.length > 0 || !entrada.deLaExtension);
  const sinUso = exigidas.filter((entrada) => !usadas.has(entrada));
  assert.deepEqual(
    sinUso.map((entrada) => `${entrada.archivo}: ${entrada.motivo}`),
    [],
    'Estas entradas ya no aparecen en su archivo: retíralas de la lista.',
  );
});

test('el rótulo del estreno solo ampara esas palabras en el archivo de la portada', () => {
  const rotulo = ROTULOS_DEL_ESTRENO[0] ?? '';
  assert.match(sinRotulosDelEstreno('otro.ts', rotulo, new Set()), NOMBRA_LA_DEMO);
  assert.match(sinRotulosDelEstreno(PORTADA, `${rotulo} abrirDemo();`, new Set()), NOMBRA_LA_DEMO);
});

test('las variantes de la web son exactamente las del registro, con sus textos', async () => {
  const { VARIANTES_INSTALADAS } = (await import('../../web/scripts/variantes-disponibles.js')) as {
    VARIANTES_INSTALADAS: Record<string, unknown>;
  };
  const esperadas: Record<string, unknown> = {};
  for (const extension of EXTENSIONES) {
    const carpeta = dirname(extension.entrada);
    const textos: Record<string, Record<string, string>> = {};
    for (const idioma of ['es', 'ca']) {
      const modulo = new URL(`../../web/${carpeta}/idiomas/${idioma}/recorrido.js`, import.meta.url);
      textos[idioma] = ((await import(modulo.href)) as { TEXTOS_EXTENSION: Record<string, string> }).TEXTOS_EXTENSION;
    }
    const del = (clave: string) => ({ es: textos.es?.[clave], ca: textos.ca?.[clave] });
    esperadas[extension.id] = {
      ruta: extension.entrada,
      estado: del(`comun.menu.recorrido.${extension.id}`),
      opcion: del(`panel.recorrido.${extension.id}`),
    };
  }
  assert.deepEqual(JSON.parse(JSON.stringify(VARIANTES_INSTALADAS)), esperadas);
});

test('la copia del contrato de secciones es exactamente la generada desde su fuente y el registro', () => {
  const destino = pathToFileURL(join(RAIZ, SECCIONES_DEL_REGISTRO)).href;
  const generada = [...artefactosComunes()].find(([url]) => url.href === destino)?.[1];
  assert.ok(generada, SECCIONES_DEL_REGISTRO);
  assert.equal(readFileSync(join(RAIZ, SECCIONES_DEL_REGISTRO), 'utf8'), generada, SECCIONES_DEL_REGISTRO);
});

test('con el registro vacío la guardia no exige las entradas de la extensión', () => {
  // Proceso aislado con el doble vacío del registro; ejecuta solo la guardia de este archivo, con su propio informe.
  const { NODE_TEST_CONTEXT: _contexto, ...entorno } = process.env;
  const resultado = spawnSync(
    process.execPath,
    [
      '--import',
      fileURLToPath(new URL('../ayudas/registro-vacio.ts', import.meta.url)),
      '--test-reporter=tap',
      `--test-name-pattern=^${GUARDIA}$`,
      fileURLToPath(import.meta.url),
    ],
    { encoding: 'utf8', env: entorno },
  );
  assert.equal(resultado.status, 0, `${resultado.stdout}\n${resultado.stderr}`);
  assert.match(resultado.stdout, /^# pass 1$/mu);
  assert.match(resultado.stdout, /^# fail 0$/mu);
});
