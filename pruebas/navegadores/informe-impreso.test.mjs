/**
 * La hoja impresa del informe breve ocupa sus dos páginas con cualquier entrada que Faro admite. Casos: el corriente
 * (tres tareas oficiales, con los estados más largos de la columna «Próxima fecha»), el habitual más cargado (las 12
 * tareas que Faro recoge de un relato, de 60 a 120 caracteres, en el idioma del informe), el más largo (30 tareas de 300
 * caracteres, estimadas por Faro, inciertas y con sus dos frases de 220 caracteres) y los que más exigen a la
 * estimación de tareas-en-papel.ts: 30 tareas de 300 caracteres de letras anchas, 30 de una sola palabra de 300
 * caracteres sin espacios, 30 de una palabra corta, una mezcla de todas y, para «Tus tareas menos expuestas», las
 * dos de MAX_TAREA letras anchas (no cabe ninguna) y solo la segunda así (cabe una); tareas de `¾`, con espacios de
 * Unicode entre letras (U+00A0, U+2003, U+3000), con emojis y en chino y japonés; una sola tarea de 300 letras anchas
 * (la línea de papel habla de «tu tarea», en singular); y, con 3 y con 12 tareas, las dos ocupaciones ESCO de los datos de
 * título más largo (el más largo que se ve, 1324.3.1.6.11, y el más largo escrito, 3323.2.4) y, en cada idioma, los casos
 * peores de la hoja 2 que salen de los datos (casos-peores-de-los-datos.mjs: título, grupo de «Qué vigilar», frases de
 * mercado y sellos). Además, en cada motor, ningún carácter medible (INTERVALOS_MEDIBLES, tareas-en-papel.ts), todos
 * medidos uno a uno, mide más que el avance que le da ese módulo (peso normal y negrita). Un informe posterior al 2/12/2027
 * lleva las normas ya en aplicación y, con la fecha de la encuesta TIC-H puesta en el día del informe y sin edición
 * publicada, esa fila como fecha prevista (sus filas lo dicen en data-proxima). La prueba mide, no compara textos. En
 * los tres motores y en los dos idiomas, con el medio de impresión emulado: ninguna celda de «Qué vigilar» desborda en
 * horizontal, ninguna hoja pasa del área útil de su página (el A4 menos los márgenes de su @page informe), las filas de
 * tarea impresas no se parten entre páginas, la hoja 2 empieza página, la línea de papel sale solo si hay tareas fuera
 * y sus cifras son las filas impresas y el total (lo mismo con las menos expuestas), y con las 12 tareas se imprimen al
 * menos MIN_IMPRESAS_DE_DOCE. En Chromium, con el PDF real: exactamente 2 páginas en todos los casos, una por hoja, y
 * cada tarea impresa entera en una sola página. Cada medida queda en el informe de la prueba. Las hojas de estilo
 * son las de informe-ejemplo.html.
 *
 * El plan de formación (la hoja de ruta), pintado por la web (crearDocumentoDelPlan) con las hojas de estilo de
 * recorrido.html y solo la hoja de ruta en papel (CASOS_DEL_PLAN): sin cursos, con uno, con dos y los más largos que
 * puede pintar «Tus primeras sesiones» con su tope de filas. En los tres motores y en los dos idiomas ninguna hoja pasa del área útil de su página
 * (@page formacion); en Chromium el PDF tiene una página por hoja: una sin cursos, dos con ellos.
 *
 * El papel: con el tema noche y con el claro, el informe en su página propia (como informe-ejemplo.html) y el paso 4
 * del recorrido imprimiendo el informe, el plan y los dos juntos. En los tres motores, con el medio de impresión
 * emulado, la página se imprime en el esquema claro, el fondo de html y de body es blanco o transparente y fuera de las
 * hojas no queda ningún bloque con fondo oscuro que salga en el espacio de la página que las hojas no ocupan.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit } from 'playwright-core';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { MAX_FRASE } from '../../src/comun/limites-frases.ts';
import { MAX_TAREA, MAX_TAREAS_INFORME } from '../../src/comun/protocolo-web.ts';
import { construirInforme } from '../../src/dominio/informe.ts';
import { construirInformeBreve } from '../../src/dominio/informe-breve.ts';
import { cargarDatos } from '../../src/plataforma/node/datos.ts';
import {
  avanceDelCaracter,
  esMedible,
  INTERVALOS_MEDIBLES,
} from '../../src/presentacion/informe-breve/tareas-en-papel.ts';
import { renderizarInformeBreve } from '../../src/presentacion/informe-breve.ts';
import { planDePrueba } from '../fixtures/plan-formacion.ts';
import { casosPeoresDeLosDatos } from './casos-peores-de-los-datos.mjs';
import { leerPdf } from './recorrido.ts';
import { cerrarSinSustituir, conPlazo, lanzarConPlazo, recursosDelCaso } from './recursos-del-caso.mjs';

const WEB = new URL('../../web/', import.meta.url);
const PLAZO_MS = 30_000;
/** Un día después de que las normas europeas de alto riesgo empiecen a aplicarse: su estado más largo. */
const DESPUES_DE_APLICARSE = '2027-12-03';
/** Las hojas que imprime el informe breve. */
const HOJAS = 2;
/** Las páginas del PDF de Chromium en todos los casos: una por hoja. */
const PAGINAS_DEL_PDF = HOJAS;
/**
 * Las tareas que, como mínimo, imprime la hoja 1 con las 12 tareas de un relato: la estimación es prudente, pero no
 * tanto que deje la hoja medio vacía.
 */
const MIN_IMPRESAS_DE_DOCE = 2;
/** Los caracteres de las tareas de un relato corriente: ni una palabra suelta ni un párrafo. */
const MIN_TAREA_CORRIENTE = 60;
const MAX_TAREA_CORRIENTE = 120;
/** El alto de un A4, en milímetros, y los píxeles CSS de un milímetro (96 por pulgada de 25,4 mm). */
const ALTO_DEL_A4_MM = 297;
const PIXELES_POR_PULGADA = 96;
const MM_POR_PULGADA = 25.4;
const PIXELES_POR_MM = PIXELES_POR_PULGADA / MM_POR_PULGADA;

/**
 * El alto útil de la página del informe, en píxeles CSS, con uno de redondeo: el A4 menos los márgenes de arriba y de
 * abajo de su `@page informe`, leídos de web/estilos/informe-breve.css.
 */
async function altoUtilDeLaPagina() {
  const estilo = await readFile(new URL('estilos/informe-breve.css', WEB), 'utf8');
  const margen = /@page informe\s*\{[^}]*?\bmargin:\s*([^;]+);/u.exec(estilo)?.[1];
  assert.ok(margen, 'informe-breve.css declara los márgenes de @page informe');
  const medidas = margen
    .trim()
    .split(/\s+/u)
    .map((medida) => {
      assert.match(medida, /^\d+(?:\.\d+)?mm$|^0$/u, `el margen ${medida} va en milímetros`);
      return Number.parseFloat(medida);
    });
  // CSS: un valor para los cuatro lados, dos (vertical y horizontal), tres (arriba, horizontal, abajo) o cuatro.
  const [arriba = 0, , abajo = arriba] = medidas.length === 2 ? [medidas[0], 0, medidas[0]] : medidas;
  return Math.ceil((ALTO_DEL_A4_MM - arriba - abajo) * PIXELES_POR_MM) + 1;
}
/** Los estados de la próxima fecha que alargan la columna y que este informe tiene que llevar. */
const ESTADOS_LARGOS = ['en-aplicacion', 'prevista'];

/** Las hojas de estilo que carga la página real del informe (informe-ejemplo.html), en su orden. */
async function estilosDeLaPagina() {
  const pagina = await readFile(new URL('informe-ejemplo.html', WEB), 'utf8');
  // Cada <link>, con sus atributos en cualquier orden: los de rel="stylesheet", por su href.
  const estilos = [...pagina.matchAll(/<link\b[^>]*>/gu)]
    .map(([enlace]) => enlace)
    .filter((enlace) => /\brel=["']?stylesheet["']?/u.test(enlace))
    .map((enlace) => /\bhref=["']([^"']+)["']/u.exec(enlace)?.[1] ?? '');
  assert.ok(estilos.length > 0, 'informe-ejemplo.html carga sus hojas de estilo');
  return estilos;
}
const TIPOS = {
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

/** Las tareas del caso corriente: tres tareas oficiales de la oficinista, de texto corto. */
function tareasCorrientes(_idioma) {
  return ['4110-1', '4110-2', '4110-3'].map((tareaOit, i) => ({
    id: `t${i + 1}`,
    texto: ['Comprobar documentos', 'Archivar expedientes', 'Atender llamadas'][i],
    tiempo: ['mucho', 'poco', 'algo'][i],
    referencia: { tareaOit, relacion: 'propia' },
  }));
}

/** Las tareas de un relato corriente, en cada idioma: las que Faro recoge como máximo (MAX_TAREAS), de 60 a 120 caracteres. */
const RELATOS = {
  es: [
    'Atender las llamadas de los clientes y anotar sus peticiones en la hoja de seguimiento',
    'Preparar los pedidos de la semana y comprobar que coinciden con el albarán del proveedor',
    'Revisar las facturas recibidas, clasificarlas por proveedor y pasarlas a contabilidad',
    'Contestar los correos de la oficina y derivar cada consulta a la persona responsable',
    'Organizar la agenda de la dirección, las reuniones y los viajes del equipo comercial',
    'Archivar en papel y en digital los contratos firmados con su fecha de vencimiento',
    'Dar la bienvenida a las visitas, avisar a quien corresponda y entregar las acreditaciones',
    'Actualizar la base de datos de clientes cuando cambian sus datos de contacto o de pago',
    'Preparar los informes mensuales de ventas con gráficos para la reunión del equipo',
    'Pedir presupuestos a varios proveedores y comparar precios, plazos y condiciones de pago',
    'Enseñar a las personas que se incorporan cómo funcionan los programas de la oficina',
    'Resolver incidencias con los envíos: llamar a la empresa de transporte y avisar al cliente',
  ],
  ca: [
    'Atendre les trucades dels clients i anotar les seves peticions al full de seguiment',
    "Preparar les comandes de la setmana i comprovar que coincideixen amb l'albarà del proveïdor",
    'Revisar les factures rebudes, classificar-les per proveïdor i passar-les a comptabilitat',
    "Respondre els correus de l'oficina i derivar cada consulta a la persona responsable",
    "Organitzar l'agenda de la direcció, les reunions i els viatges de l'equip comercial",
    'Arxivar en paper i en digital els contractes signats amb la seva data de venciment',
    'Donar la benvinguda a les visites, avisar qui correspongui i lliurar les acreditacions',
    'Actualitzar la base de dades de clients quan canvien les dades de contacte o de pagament',
    "Preparar els informes mensuals de vendes amb gràfics per a la reunió de l'equip",
    'Demanar pressupostos a diversos proveïdors i comparar preus, terminis i condicions de pagament',
    "Ensenyar a les persones que s'incorporen com funcionen els programes de l'oficina",
    "Resoldre incidències amb els enviaments: trucar a l'empresa de transport i avisar el client",
  ],
};

/** El tiempo y la nota con su margen (de 0 a 1) de las tareas estimadas de los casos largos, que se reparten por turnos. */
const TIEMPOS_Y_NOTAS = [
  { tiempo: 'mucho', valor: 0.2, minimo: 0.1, maximo: 0.3 },
  { tiempo: 'algo', valor: 0.5, minimo: 0.4, maximo: 0.6 },
  { tiempo: 'poco', valor: 0.8, minimo: 0.7, maximo: 0.9 },
];

/** Una estimación de Faro del turno `i` de TIEMPOS_Y_NOTAS, con las frases de la IA que se le den. */
function estimacionDeFaro(i, incierta, frases) {
  const { valor, minimo, maximo } = TIEMPOS_Y_NOTAS[i % TIEMPOS_Y_NOTAS.length];
  return { valor, margen: [minimo, maximo], origen: 'faro', referencias: 'ocupacion', incierta, ...frases };
}

/** El informe habitual más cargado: las tareas de RELATOS en `idioma`, todas estimadas por Faro y una de cada dos inciertas. */
function tareasDeUnRelato(idioma) {
  return RELATOS[idioma].map((texto, i) => {
    assert.ok(
      texto.length >= MIN_TAREA_CORRIENTE && texto.length <= MAX_TAREA_CORRIENTE,
      `la tarea «${texto}» mide de ${MIN_TAREA_CORRIENTE} a ${MAX_TAREA_CORRIENTE} caracteres`,
    );
    return {
      id: `t${i + 1}`,
      texto,
      tiempo: TIEMPOS_Y_NOTAS[i % TIEMPOS_Y_NOTAS.length].tiempo,
      estimacion: estimacionDeFaro(i, i % 2 === 0, {}),
    };
  });
}

/** Las palabras con que se escriben los textos largos: corrientes, para que el texto se parta como el de una persona. */
const PALABRAS = ['revisar', 'las', 'solicitudes', 'de', 'los', 'clientes', 'y', 'registrar', 'cada', 'cambio', 'en'];

/** Un texto de `longitud` unidades UTF-16 exactas, de palabras corrientes y sin espacio al final (el informe lo recorta). */
function textoDeLongitud(longitud, semilla) {
  let texto = '';
  for (let i = semilla; texto.length < longitud; i += 1) {
    texto += `${PALABRAS[i % PALABRAS.length]} `;
  }
  return texto.slice(0, longitud).replace(/\s$/u, 'a');
}

/**
 * El informe más largo que admite Faro: MAX_TAREAS_INFORME tareas de MAX_TAREA caracteres, todas estimadas por Faro,
 * con su margen, marcadas como inciertas (el sello de Faro y «Incierta» van junto al nombre) y con las dos frases de la
 * IA de MAX_FRASE caracteres.
 */
function tareasMaximas(_idioma) {
  return Array.from({ length: MAX_TAREAS_INFORME }, (_, i) => ({
    id: `t${i + 1}`,
    texto: textoDeLongitud(MAX_TAREA, i),
    tiempo: TIEMPOS_Y_NOTAS[i % TIEMPOS_Y_NOTAS.length].tiempo,
    estimacion: estimacionDeFaro(i, true, {
      iaPodria: textoDeLongitud(MAX_FRASE, i),
      loTuyo: textoDeLongitud(MAX_FRASE, i + 1),
    }),
  }));
}

/** Las palabras de letras anchas (las de más avance de Space Grotesk). */
const PALABRAS_ANCHAS = ['MWMW', 'mwmw', 'WMW', 'mmww', 'WWMM', 'wmw'];

/** Un texto de `longitud` unidades UTF-16 exactas con las palabras de `palabras`, sin espacio al final. */
function textoCon(palabras, longitud, semilla) {
  let texto = '';
  for (let i = semilla; texto.length < longitud; i += 1) {
    texto += `${palabras[i % palabras.length]} `;
  }
  return texto.slice(0, longitud).replace(/\s$/u, 'W');
}

/** Las longitudes de las tareas de los casos que exigen a la estimación, por turnos: de una línea a MAX_TAREA. */
const LONGITUDES = [...'40 90 150'.split(' ').map(Number), MAX_TAREA];
/**
 * Las notas de las dos tareas menos expuestas de esos casos, por debajo de todas las de TIEMPOS_Y_NOTAS: la primera
 * es la menos expuesta de todas y va primero en «Tus tareas menos expuestas».
 */
const NOTAS_MENOS_EXPUESTAS = [
  { valor: 0.02, minimo: 0, maximo: 0.05 },
  { valor: 0.05, minimo: 0, maximo: 0.1 },
];

/** Las menos expuestas de una palabra: dejan sitio a las filas y el caso mide la estimación de las filas. */
function menosDeUnaPalabra(i) {
  return `${PALABRAS[i]}${i}`;
}

/**
 * MAX_TAREAS_INFORME tareas estimadas por Faro e inciertas (con sus dos marcas junto al nombre), con el texto de
 * `textoDe` para cada turno. Las dos primeras son las menos expuestas, con el texto de `menosDe`.
 */
function tareasQueExigen(textoDe, menosDe = menosDeUnaPalabra) {
  return Array.from({ length: MAX_TAREAS_INFORME }, (_, i) => {
    const menos = i < NOTAS_MENOS_EXPUESTAS.length;
    const { valor, minimo, maximo } = menos ? NOTAS_MENOS_EXPUESTAS[i] : TIEMPOS_Y_NOTAS[i % TIEMPOS_Y_NOTAS.length];
    return {
      id: `t${i + 1}`,
      texto: menos ? menosDe(i) : textoDe(i),
      tiempo: TIEMPOS_Y_NOTAS[i % TIEMPOS_Y_NOTAS.length].tiempo,
      estimacion: { valor, margen: [minimo, maximo], origen: 'faro', referencias: 'ocupacion', incierta: true },
    };
  });
}

/** Un texto de letras anchas de la longitud del turno `i`. */
function textoAncho(i) {
  return textoCon(PALABRAS_ANCHAS, LONGITUDES[i % LONGITUDES.length], i);
}

/** Un texto de letras anchas sin espacios, de la longitud del turno `i`: el navegador lo parte por caracteres. */
function textoSinEspacios(i) {
  return textoAncho(i).replaceAll(' ', 'm');
}

/** Tareas de letras anchas, de 40 a 300 caracteres. */
function tareasAnchas(_idioma) {
  return tareasQueExigen(textoAncho);
}

/** Tareas de una sola palabra larga, sin espacios, de 40 a 300 caracteres. */
function tareasSinEspacios(_idioma) {
  return tareasQueExigen(textoSinEspacios);
}

/** Un texto de MAX_TAREA caracteres de letras anchas. */
function textoAnchoMaximo(i) {
  return textoCon(PALABRAS_ANCHAS, MAX_TAREA, i);
}

/** Tareas anchas con las dos menos expuestas de MAX_TAREA caracteres de letras anchas: en papel no cabe ninguna. */
function tareasConLasMenosAnchas(_idioma) {
  return tareasQueExigen(textoAncho, textoAnchoMaximo);
}

/** Tareas anchas con la menos expuesta de una palabra y la segunda de MAX_TAREA letras anchas: en papel cabe una. */
function tareasConUnaMenosAncha(_idioma) {
  return tareasQueExigen(textoAncho, (i) => (i === 0 ? menosDeUnaPalabra(i) : textoAnchoMaximo(i)));
}

/** Tareas de una palabra corta. */
function tareasDeUnaPalabra(_idioma) {
  return tareasQueExigen((i) => `${PALABRAS[i % PALABRAS.length]}${i}`);
}

/** Una mezcla, por turnos: de un relato, de palabras corrientes de 300 caracteres, anchas, sin espacios y de una palabra. */
function tareasMezcladas(idioma) {
  const textos = [
    (i) => RELATOS[idioma][i % RELATOS[idioma].length],
    (i) => textoDeLongitud(MAX_TAREA, i),
    textoAncho,
    textoSinEspacios,
    (i) => `${PALABRAS[i % PALABRAS.length]}${i}`,
  ];
  return tareasQueExigen((i) => textos[i % textos.length](i));
}

/** Los espacios de Unicode que el navegador no colapsa ni parte como un espacio: el no separable, el cuadratín y el ideográfico. */
const ESPACIOS_DE_UNICODE = ['\u00a0', '\u2003', '\u3000'];

/** Un texto de la longitud del turno `i` con letras anchas separadas por espacios de Unicode, sin ningún espacio corriente. */
function textoConEspaciosDeUnicode(i) {
  const longitud = LONGITUDES[i % LONGITUDES.length];
  let texto = '';
  for (let k = i; texto.length < longitud; k += 1) {
    texto += `${PALABRAS_ANCHAS[k % PALABRAS_ANCHAS.length]}${ESPACIOS_DE_UNICODE[k % ESPACIOS_DE_UNICODE.length]}`;
  }
  return texto.slice(0, longitud).replace(/[\u00a0\u2003\u3000]$/u, 'W');
}

/** Una letra y, tras ella, un solo espacio de Unicode repetido hasta MAX_TAREA caracteres y otra letra: una palabra de 300. */
function textoDeUnEspacioRepetido(i) {
  return `a${ESPACIOS_DE_UNICODE[i % ESPACIOS_DE_UNICODE.length].repeat(MAX_TAREA - 2)}b`;
}

/** De cada cuántas tareas con espacios de Unicode una es de un solo espacio repetido. */
const UNA_DE_CADA = 5;

/** Tareas con espacios de Unicode entre letras, por turnos, y una de un solo espacio repetido. */
function tareasConEspaciosDeUnicode(_idioma) {
  return tareasQueExigen((i) => (i % UNA_DE_CADA === 0 ? textoDeUnEspacioRepetido(i) : textoConEspaciosDeUnicode(i)));
}

/** Tareas de `¾` seguidos (105 por fila, como mínimo) y de palabras de `¾`, de 40 a MAX_TAREA caracteres. */
function tareasConTresCuartos(_idioma) {
  return tareasQueExigen((i) =>
    i % 2 === 0
      ? '¾'.repeat(MAX_TAREA)
      : textoCon(['¾¾¾¾¾¾¾', '¾¾¾', '¾¾¾¾¾¾¾¾¾¾¾'], LONGITUDES[i % LONGITUDES.length], i),
  );
}

/** Los `¾` por tarea que bastan para llenar tres líneas de la fila y no caber en la hoja. */
const TRES_CUARTOS_POR_TAREA = 105;

/** Tareas con las dos menos expuestas de `¾` en MAX_TAREA caracteres: el avance de `¾` es de los mayores del latín. */
function tareasConTresCuartosEnLasMenos(_idioma) {
  return tareasQueExigen(
    (i) => '¾'.repeat(TRES_CUARTOS_POR_TAREA + (i % 2)),
    () => '¾'.repeat(MAX_TAREA),
  );
}

/** Tareas de emojis, con espacios y sin ellos: cada emoji son dos unidades UTF-16 y ocupa más que una letra ancha. */
function tareasConEmojis(_idioma) {
  const emojis = ['😀', '🚀', '🧑‍💻', '👨‍👩‍👧‍👦', '🇪🇸'];
  return tareasQueExigen(
    (i) =>
      i % 2 === 0
        ? emojis[i % emojis.length].repeat(Math.floor(MAX_TAREA / emojis[i % emojis.length].length))
        : textoCon(emojis, MAX_TAREA, i),
    (i) => emojis[i].repeat(Math.floor(MAX_TAREA / emojis[i].length)),
  );
}

/** Tareas en chino y japonés, con espacios y sin ellos: el navegador las parte entre cualquier par de caracteres. */
function tareasEnCjk(_idioma) {
  const palabras = ['漢字語日本', '中文汉语', 'あいうえお', 'アイウエオ', '한국어'];
  return tareasQueExigen(
    (i) =>
      i % 2 === 0
        ? palabras[i % palabras.length].repeat(MAX_TAREA).slice(0, MAX_TAREA)
        : textoCon(palabras, MAX_TAREA, i),
    () => '漢'.repeat(MAX_TAREA),
  );
}

/** Una sola tarea de MAX_TAREA letras anchas: no cabe en la hoja impresa y la línea de papel habla de «tu tarea». */
function unaSolaTareaAncha(_idioma) {
  return [
    {
      id: 't1',
      texto: textoAnchoMaximo(0),
      tiempo: 'mucho',
      estimacion: estimacionDeFaro(0, true, {}),
    },
  ];
}

/** Las tareas del informe con pocas tareas. */
const POCAS_TAREAS = 3;

/** Las tareas de un relato corriente, solo las tres primeras: el informe con pocas tareas y un título de ocupación largo. */
function tresTareasDeUnRelato(idioma) {
  return tareasDeUnRelato(idioma).slice(0, POCAS_TAREAS);
}

/**
 * La ocupación de los casos que no son la de la oficinista (4110): las ocupaciones ESCO de los datos con el título más
 * largo que se ve (1324.3.1.6.11: 157 caracteres en castellano y 146 en catalán) y más largo escrito (3323.2.4: 237 y
 * 241 caracteres con sus dos formas enteras; se ven 122 y 125).
 */
const OCUPACIONES_DE_LOS_CASOS = {
  tituloVistoDoce: { ocupacionEsco: '1324.3.1.6.11', isco08: '1324' },
  tituloVistoTres: { ocupacionEsco: '1324.3.1.6.11', isco08: '1324' },
  tituloEscritoDoce: { ocupacionEsco: '3323.2.4', isco08: '3323' },
  tituloEscritoTres: { ocupacionEsco: '3323.2.4', isco08: '3323' },
};

/**
 * Los casos de la hoja 2 sacados de los datos en cada idioma (casos-peores-de-los-datos.mjs): la ocupación del título más
 * largo, la del nombre de grupo más largo en «Qué vigilar», la de las frases de mercado más largas y la de más sellos.
 * Se eligen antes de servir las páginas.
 */
const CASOS_DE_LA_HOJA_2 = ['peorTitulo', 'peorGrupo', 'peorMercado', 'peorSellos'];
/** Esos casos por idioma: la ocupación elegida en cada uno. */
const PEORES = { es: {}, ca: {} };

/**
 * Los casos que mide la prueba: el informe corriente, el habitual más cargado, el más largo que admite Faro y los que
 * más exigen a la estimación de las filas.
 */
const CASOS = {
  corriente: tareasCorrientes,
  doce: tareasDeUnRelato,
  maximo: tareasMaximas,
  anchas: tareasAnchas,
  sinEspacios: tareasSinEspacios,
  unaPalabra: tareasDeUnaPalabra,
  mezcla: tareasMezcladas,
  menosAnchas: tareasConLasMenosAnchas,
  unaMenos: tareasConUnaMenosAncha,
  tresCuartos: tareasConTresCuartos,
  tresCuartosEnLasMenos: tareasConTresCuartosEnLasMenos,
  espaciosDeUnicode: tareasConEspaciosDeUnicode,
  emojis: tareasConEmojis,
  cjk: tareasEnCjk,
  unaSolaTarea: unaSolaTareaAncha,
  tituloVistoDoce: tareasDeUnRelato,
  tituloVistoTres: tresTareasDeUnRelato,
  tituloEscritoDoce: tareasDeUnRelato,
  tituloEscritoTres: tresTareasDeUnRelato,
  ...Object.fromEntries(CASOS_DE_LA_HOJA_2.map((caso) => [caso, tresTareasDeUnRelato])),
};

/**
 * El informe de una oficinista, en `idioma`, con las tareas del `caso` y la fecha posterior a la aplicación de las
 * normas, en su página propia (`<main>`) o, `incrustado`, como lo pinta el recorrido.
 */
function informeDelCaso(idioma, caso, incrustado = false) {
  const datos = cargarDatos(fileURLToPath(new URL('../../datos/', import.meta.url)));
  const tareas = CASOS[caso](idioma);
  const { medida: _medida, ...peor } = PEORES[idioma][caso] ?? {};
  const ocupacion = OCUPACIONES_DE_LOS_CASOS[caso] ?? (CASOS_DE_LA_HOJA_2.includes(caso) ? peor : { isco08: '4110' });
  const informe = construirInforme({ ...ocupacion, fecha: '2026-10-23', tareas }, datos, { idioma, formacion: null });
  const construido = construirInformeBreve(informe, datos);
  // La fila de las personas, con su fecha prevista en el día del informe y sin edición publicada: el estado «prevista».
  const senales = construido.senales.map((senal) =>
    senal.clave === 'personas'
      ? { ...senal, proxima: DESPUES_DE_APLICARSE, publicada: undefined, publicadaSegunCalendario: undefined }
      : senal,
  );
  const breve = { ...construido, fecha: DESPUES_DE_APLICARSE, senales };
  return renderizarInformeBreve(breve, informe, { incrustado });
}

/**
 * La página del informe del `caso` en `idioma`, como informe-ejemplo.html. Con `tema`, en el tema que pone
 * scripts/tema-inicial.js en <html>; sin él, sigue al sistema.
 */
function paginaDelInforme(idioma, estilos, caso, tema) {
  const enlaces = estilos.map((ruta) => `<link rel="stylesheet" href="/${ruta}" />`).join('');
  const conTema = tema ? ` data-tema="${tema}"` : '';
  return `<!doctype html><html lang="${idioma}"${conTema}><head><meta charset="utf-8" /><title>Informe</title>${enlaces}</head><body>${informeDelCaso(idioma, caso)}</body></html>`;
}

/**
 * Un texto de la persona o del catálogo en el plan de formación, largo a propósito: el objetivo y el motivo de cada
 * curso, de MAX_TAREA caracteres.
 */
const TEXTO_LARGO_DEL_PLAN = textoDeLongitud(MAX_TAREA, 0);
/** Los días de la semana (de 1 a 7) y los minutos más cortos que admite el plan: el calendario con más sesiones. */
const DIAS_DE_LA_SEMANA = 7;
const TODA_LA_SEMANA = Array.from({ length: DIAS_DE_LA_SEMANA }, (_, i) => i + 1);
const MINUTOS_MINIMOS_DEL_PLAN = 15;

/**
 * Los casos del plan de formación (planDePrueba): sin cursos (una hoja), con uno, con dos y los cuatro más largos que
 * pinta «Tus primeras sesiones» con sus siete filas (vista-agenda.js), todos con los textos largos de
 * planConTextosLargos. Las sesiones oficiales caen en el día de fecha más larga del idioma y en el anterior.
 * - lleno: siete fechas de estudio sin recorte. Los dos cursos, sin sincronía publicada, se turnan los siete días de la
 *   semana a 15 minutos; con la nota de la agenda provisional.
 * - largo: la agenda recortada con sus dos notas. El primer curso, de 2 horas, a 15 minutos los siete días; el segundo,
 *   con sus dos sesiones oficiales lejanas y una sin hora publicada: la nota de las sesiones sin hora, dos fechas de
 *   estudio, la nota de recorte con el día en que empieza el segundo curso y la de la agenda provisional.
 * - oficial: siete filas sin recorte con el máximo de sesiones oficiales. El primer curso estudia sus 2 horas en un solo
 *   día; el segundo tiene sus dos sesiones lunes y martes: una fecha de estudio y dos con sesión.
 * - recorte: la nota de recorte más larga con cuatro fechas de estudio. Como el largo, sin la sesión sin hora: cuatro
 *   fechas del primer curso y la nota con el día y la hora en que empieza el segundo.
 * Las hojas que imprime cada caso: una sin cursos y dos con ellos.
 */
const CASOS_DEL_PLAN = {
  cero: { hojas: 1, plan: (idioma) => ({ ...planDePrueba(idioma), elecciones: [] }) },
  uno: {
    hojas: 2,
    plan: (idioma) => ({ ...planDePrueba(idioma), elecciones: planDePrueba(idioma).elecciones.slice(0, 1) }),
  },
  dos: { hojas: 2, plan: (idioma) => planDePrueba(idioma) },
  lleno: { hojas: 2, plan: planLleno },
  largo: { hojas: 2, plan: planConLasDosNotas, recortada: true },
  oficial: { hojas: 2, plan: planConSesionesOficiales },
  recorte: { hojas: 2, plan: planRecortado, recortada: true },
};

/** La fecha oficial más larga de cada idioma (fechaOficial), en martes: septiembre en castellano y febrero en catalán. */
const DIA_MAS_LARGO = { es: '2027-09-28', ca: '2027-02-23' };
/** El caso oficial estudia lunes y martes, con tiempo para las 2 horas del primer curso en un solo día. */
const LUNES_Y_MARTES = [1, 2];
const MINUTOS_DEL_CASO_OFICIAL = 120;

/** Un curso de duración y ritmo conocidos: el cronograma lo reparte entero, y dos así van uno tras otro. */
function cursoAsincrono(eleccion) {
  const hechos = eleccion.oferta.hechos;
  return {
    ...eleccion,
    oferta: {
      ...eleccion.oferta,
      hechos: { ...hechos, sincronia: { ...hechos.sincronia, valor: 'asincrona', motivo: 'conocido' } },
    },
  };
}

/** Un curso con sus sesiones publicadas por el proveedor ({inicio, fin} con hora y huso). */
function cursoConSesiones(eleccion, sesiones) {
  return {
    ...eleccion,
    oferta: {
      ...eleccion.oferta,
      unidad: { ...eleccion.oferta.unidad, tipo: 'edicion' },
      hechos: {
        ...eleccion.oferta.hechos,
        calendario_formacion: {
          valor: { tipo: 'sesiones', sesiones },
          motivo: 'conocido',
          unidad: null,
          moneda: null,
          alcance: 'edicion',
          vigencia: { comprobado_el: '2026-10-22T10:00:00Z' },
        },
      },
    },
  };
}

/** Una sesión el `dia` (AAAA-MM-DD) de `desde` a `hasta` (HH:MM en UTC). */
function sesion(dia, desde, hasta) {
  return { inicio: `${dia}T${desde}:00Z`, fin: `${dia}T${hasta}:00Z` };
}

/** Un día en milisegundos. */
const DIA_MS = 86_400_000;

/** El día anterior a `dia` (AAAA-MM-DD): en el mismo mes, con la fecha igual de larga. */
function diaAnterior(dia) {
  return new Date(Date.parse(`${dia}T12:00:00Z`) - DIA_MS).toISOString().slice(0, 10);
}

/** Las dos sesiones oficiales lejanas: el día de fecha más larga del idioma y el anterior, de 15 minutos. */
function sesionesLejanas(idioma) {
  return [diaAnterior(DIA_MAS_LARGO[idioma]), DIA_MAS_LARGO[idioma]].map((dia) => sesion(dia, '17:30', '17:45'));
}

/** La nota de recorte con cuatro fechas de estudio (CASOS_DEL_PLAN.recorte). */
function planRecortado(idioma) {
  const plan = planConTextosLargos(idioma);
  const [primero, segundo] = plan.elecciones;
  return {
    ...plan,
    disponibilidad: { dias: TODA_LA_SEMANA, minutosPorDia: MINUTOS_MINIMOS_DEL_PLAN },
    elecciones: [cursoAsincrono(primero), cursoConSesiones(segundo, sesionesLejanas(idioma))],
  };
}

/** La agenda recortada con sus dos notas (CASOS_DEL_PLAN.largo). */
function planConLasDosNotas(idioma) {
  const plan = planRecortado(idioma);
  const [primero, segundo] = plan.elecciones;
  const sinHora = { inicio: '2026-11-24T18:30:00-00:00', fin: '2026-11-24T18:45:00-00:00' };
  return {
    ...plan,
    elecciones: [primero, cursoConSesiones(segundo, [...sesionesLejanas(idioma), sinHora])],
  };
}

/** Siete fechas de estudio sin recorte (CASOS_DEL_PLAN.lleno). */
function planLleno(idioma) {
  return {
    ...planConTextosLargos(idioma),
    disponibilidad: { dias: TODA_LA_SEMANA, minutosPorDia: MINUTOS_MINIMOS_DEL_PLAN },
  };
}

/** Una fecha de estudio y dos con sesión oficial: las siete filas sin recorte (CASOS_DEL_PLAN.oficial). */
function planConSesionesOficiales(idioma) {
  const plan = planConTextosLargos(idioma);
  const [primero, segundo] = plan.elecciones;
  return {
    ...plan,
    disponibilidad: { dias: LUNES_Y_MARTES, minutosPorDia: MINUTOS_DEL_CASO_OFICIAL },
    elecciones: [cursoAsincrono(primero), cursoConSesiones(segundo, sesionesLejanas(idioma))],
  };
}

/** El plan de dos cursos con los textos más largos: objetivo, motivos, proveedor y acreditación (CASOS_DEL_PLAN). */
function planConTextosLargos(idioma) {
  const plan = planDePrueba(idioma);
  return {
    ...plan,
    objetivo: TEXTO_LARGO_DEL_PLAN,
    elecciones: plan.elecciones.map((eleccion) => ({
      ...eleccion,
      proveedor: `${eleccion.proveedor} · Consorci per a la Formació Contínua de Catalunya`,
      motivo: { es: TEXTO_LARGO_DEL_PLAN, ca: TEXTO_LARGO_DEL_PLAN },
    })),
    acreditacion: {
      codigo: 'ADGG0208',
      nombre: textoDeLongitud(MAX_TAREA / 2, 1),
      nivel: 2,
      relacion: 'grupo',
      enlaceBoe: 'https://www.boe.es/ejemplo',
      ocupacion: '4110',
      idioma,
      tramite: 'https://ejemplo.invalid/tramite',
      fuente: 'https://ejemplo.invalid/fuente',
      comprobado: '2026-10-06',
    },
  };
}

/** Las hojas de estilo del recorrido (recorrido.html), donde se imprime el plan de formación. */
async function estilosDelRecorrido() {
  const pagina = await readFile(new URL('recorrido.html', WEB), 'utf8');
  return [...pagina.matchAll(/href="(estilos\/[^"]+\.css)"/gu)].map(([, ruta]) => ruta);
}

/**
 * La página del plan del `caso` en `idioma`: el documento que pinta la web (crearDocumentoDelPlan) en su lugar del
 * recorrido, imprimiendo solo la hoja de ruta. `window.planListo` dice si se pintó o por qué no.
 */
function paginaDelPlan(idioma, estilos, caso) {
  const plan = JSON.stringify(CASOS_DEL_PLAN[caso].plan(idioma));
  const enlaces = estilos.map((ruta) => `<link rel="stylesheet" href="/${ruta}" />`).join('');
  return `<!doctype html><html lang="${idioma}" class="imprimir-hoja"><head><meta charset="utf-8" /><title>Plan</title>${enlaces}</head><body><main><section id="paso-4"><div class="rc-hoja-documento"></div></section></main><script type="module">import { crearDocumentoDelPlan } from '/scripts/recorrido/plan-formacion/documento.js';
try { document.querySelector('.rc-hoja-documento').append(crearDocumentoDelPlan(${plan})); window.planListo = 'sí'; } catch (error) { window.planListo = String(error); }</script></body></html>`;
}

/** Los dos temas de la pantalla, como los pone scripts/tema-inicial.js en <html>: lo impreso no depende de ellos. */
const TEMAS = ['oscuro', 'claro'];
/** Lo que se imprime desde el paso 4 del recorrido (scripts/recorrido/impresion.js): el informe, el plan o los dos. */
const IMPRESIONES_DEL_RECORRIDO = ['informe', 'hoja', 'los-dos'];

/**
 * El paso 4 del recorrido en `tema`, con la estructura de recorrido.html (body.rc-cuerpo, main#contenido.rc-pagina,
 * #paso-4 con el informe incrustado y el plan de dos cursos) y la clase de html que pone la `impresion`. Así se
 * imprime sobre la paleta del recorrido, que es la que pinta el fondo de la página.
 */
function paginaDelRecorrido(estilos, impresion, tema) {
  const plan = JSON.stringify(CASOS_DEL_PLAN.dos.plan('es'));
  const enlaces = estilos.map((ruta) => `<link rel="stylesheet" href="/${ruta}" />`).join('');
  return `<!doctype html><html lang="es" data-tema="${tema}" class="imprimir-${impresion}"><head><meta charset="utf-8" /><title>Recorrido</title>${enlaces}</head><body class="rc-cuerpo" data-paso="4"><main id="contenido" class="rc-pagina"><div class="rc-informe" id="paso-4"><div id="informe" lang="es">${informeDelCaso('es', 'corriente', true)}</div><div id="hoja-de-ruta" class="rc-hoja-documento"></div></div></main><script type="module">import { crearDocumentoDelPlan } from '/scripts/recorrido/plan-formacion/documento.js';
try { document.getElementById('hoja-de-ruta').append(crearDocumentoDelPlan(${plan})); window.planListo = 'sí'; } catch (error) { window.planListo = String(error); }</script></body></html>`;
}

/** Sirve las páginas del informe y del plan y los estilos, guiones y tipografías de la web, solo en 127.0.0.1. */
async function servir() {
  const estilos = await estilosDeLaPagina();
  const delRecorrido = await estilosDelRecorrido();
  const paginas = Object.fromEntries([
    ...Object.keys(CASOS).flatMap((caso) =>
      ['es', 'ca'].map((idioma) => [`/${caso}-${idioma}.html`, paginaDelInforme(idioma, estilos, caso)]),
    ),
    ...Object.keys(CASOS_DEL_PLAN).flatMap((caso) =>
      ['es', 'ca'].map((idioma) => [`/plan-${caso}-${idioma}.html`, paginaDelPlan(idioma, delRecorrido, caso)]),
    ),
    ...TEMAS.flatMap((tema) => [
      [`/papel-ejemplo-${tema}.html`, paginaDelInforme('es', estilos, 'corriente', tema)],
      ...IMPRESIONES_DEL_RECORRIDO.map((impresion) => [
        `/papel-${impresion}-${tema}.html`,
        paginaDelRecorrido(delRecorrido, impresion, tema),
      ]),
    ]),
  ]);
  return new Promise((resolver) => {
    const servidor = createServer(async (peticion, respuesta) => {
      const ruta = new URL(peticion.url ?? '/', 'http://127.0.0.1').pathname;
      if (Object.hasOwn(paginas, ruta)) {
        respuesta.writeHead(ESTADO_HTTP.correcto, { 'content-type': 'text/html; charset=utf-8' }).end(paginas[ruta]);
        return;
      }
      const tipo = TIPOS[extname(ruta)];
      if (!tipo || ruta.includes('..')) {
        respuesta.writeHead(ESTADO_HTTP.noEncontrado).end();
        return;
      }
      try {
        respuesta
          .writeHead(ESTADO_HTTP.correcto, { 'content-type': tipo })
          .end(await readFile(new URL(ruta.slice(1), WEB)));
      } catch {
        respuesta.writeHead(ESTADO_HTTP.noEncontrado).end();
      }
    });
    servidor.listen(0, '127.0.0.1', () => resolver(servidor));
  });
}

/** Por cada celda de «Qué vigilar», cuánto sobresale su contenido en horizontal (0 si cabe) y si tiene texto. */
function medirCeldas(pagina) {
  return pagina.evaluate(() =>
    [...document.querySelectorAll('.ib-tabla-tendencias td')].map((celda) => {
      const rango = document.createRange();
      rango.selectNodeContents(celda);
      const caja = celda.getBoundingClientRect();
      const texto = rango.getBoundingClientRect();
      return {
        texto: celda.textContent?.trim() ?? '',
        sobra: Math.max(0, celda.scrollWidth - celda.clientWidth, Math.ceil(texto.right - caja.right)),
      };
    }),
  );
}

/**
 * Los estados de «Próxima fecha» de la tabla (data-proxima), el alto de cada hoja y el de sus bloques (los hijos de la
 * hoja y los del cuerpo), con la impresión emulada.
 */
function medirHojas(pagina) {
  return pagina.evaluate(() => {
    const alto = (elemento) => Math.ceil(elemento.getBoundingClientRect().height);
    const nombre = (elemento) => elemento.getAttribute('aria-label') || elemento.className || elemento.tagName;
    return {
      estados: [...document.querySelectorAll('.ib-tabla-tendencias tr[data-proxima]')].map((fila) =>
        fila.getAttribute('data-proxima'),
      ),
      altos: [...document.querySelectorAll('.documento > .hoja')].map(alto),
      bloques: [...document.querySelectorAll('.documento > .hoja')].map((hoja) =>
        [...hoja.children].flatMap((hijo) =>
          hijo.classList.contains('ib-cuerpo')
            ? [...hijo.children].map((bloque) => `${nombre(bloque)}: ${alto(bloque)}`)
            : [`${nombre(hijo)}: ${alto(hijo)}`],
        ),
      ),
    };
  });
}

/**
 * Las páginas de un PDF por su árbol de páginas: el /Count del nodo /Pages raíz, el único sin /Parent. Así no se toma
 * por el número de páginas el /Count de un nodo intermedio ni el primero que aparezca.
 * @param {Buffer} pdf
 */
function paginasDelPdf(pdf) {
  const objetos = [...pdf.toString('latin1').matchAll(/\d+ \d+ obj([\s\S]*?)endobj/gu)].map(([, cuerpo]) => cuerpo);
  const raices = objetos.filter((cuerpo) => /\/Type\s*\/Pages\b/u.test(cuerpo) && !/\/Parent\b/u.test(cuerpo));
  assert.equal(raices.length, 1, 'El PDF tiene un solo árbol de páginas');
  return Number(/\/Count\s+(\d+)/u.exec(raices[0] ?? '')?.[1]);
}

/** @type {import('node:http').Server | undefined} */
let servidor;
/** El alto útil de la página del informe, leído de su estilo antes de los casos. */
let altoUtil = 0;
before(async () => {
  const datos = cargarDatos(fileURLToPath(new URL('../../datos/', import.meta.url)));
  for (const idioma of ['es', 'ca']) {
    PEORES[idioma] = casosPeoresDeLosDatos(datos, idioma);
  }
  servidor = await servir();
  altoUtil = await altoUtilDeLaPagina();
});
after(() => new Promise((resolver) => (servidor ? servidor.close(() => resolver(undefined)) : resolver(undefined))));

/** Abre la página del informe del `caso` en `idioma` con el medio de impresión emulado. */
async function abrir(navegador, caso, idioma) {
  const direccion = servidor?.address();
  assert.ok(direccion && typeof direccion === 'object', 'El servidor de la prueba está escuchando');
  const contexto = await navegador.newContext({ viewport: { width: 794, height: 1123 } });
  const pagina = await contexto.newPage();
  await conPlazo(
    pagina.goto(`http://127.0.0.1:${direccion.port}/${caso}-${idioma}.html`),
    PLAZO_MS,
    'el informe no se abrió',
  );
  await pagina.emulateMedia({ media: 'print' });
  await conPlazo(
    pagina.evaluate(() => document.fonts.ready.then(() => undefined)),
    PLAZO_MS,
    'las tipografías no cargaron',
  );
  return { contexto, pagina };
}

/**
 * Cómo parte el motor la hoja impresa, con el medio de impresión emulado: lo que dice cada fila de tarea sobre
 * partirse entre páginas y si cada hoja, salvo la última, obliga a que la siguiente empiece página.
 */
function medirSaltos(pagina) {
  return pagina.evaluate(() => {
    const salto = (elemento, propiedad) => getComputedStyle(elemento).getPropertyValue(propiedad).trim();
    const hojas = [...document.querySelectorAll('.documento > .hoja')];
    return {
      filas: [...document.querySelectorAll('.ib-tarea')]
        .filter((fila) => getComputedStyle(fila).display !== 'none')
        .map((fila) => salto(fila, 'break-inside')),
      despuesDeCadaHoja: hojas.slice(0, -1).map((hoja) => salto(hoja, 'break-after')),
    };
  });
}

/**
 * Las tareas de la hoja 1 con la impresión emulada: cuántas hay, el texto de las que se imprimen, el alto y las líneas
 * de cada una (las cajas de su nombre y de sus marcas) y, si la hay, las cifras de la línea de papel.
 */
function medirTareas(pagina) {
  return pagina.evaluate(() => {
    const filas = [...document.querySelectorAll('.ib-tarea')];
    const impresas = filas.filter((fila) => getComputedStyle(fila).display !== 'none');
    const visible = (elemento) => elemento && getComputedStyle(elemento).display !== 'none';
    const cifrasDe = (selector) => {
      const linea = document.querySelector(selector);
      return visible(linea) ? [...(linea.textContent ?? '').matchAll(/\d+/gu)].map(([cifra]) => Number(cifra)) : null;
    };
    const lineaDe = (selector) => {
      const linea = document.querySelector(selector);
      return visible(linea) ? (linea.textContent ?? '') : null;
    };
    const vista = visible(document.querySelector('.ib-bloque-tareas .ib-tareas-fuera'))
      ? document.querySelector('.ib-bloque-tareas .ib-tareas-fuera')
      : null;
    const lineas = (selector, fila) => fila.querySelector(selector)?.getClientRects().length ?? 0;
    const menos = [...document.querySelectorAll('.ib-menos li')];
    return {
      menos: {
        total: menos.length,
        impresas: menos.filter(visible).length,
        cifras: cifrasDe('.ib-tuyo .ib-tareas-fuera'),
        linea: lineaDe('.ib-tuyo .ib-tareas-fuera'),
      },
      total: filas.length,
      textos: impresas.map((fila) => fila.querySelector('.ib-tarea-nombre')?.textContent ?? ''),
      filas: impresas.map(
        (fila) =>
          `${Math.ceil(fila.getBoundingClientRect().height)}/${lineas('.ib-tarea-nombre', fila)}+${lineas('.ib-tarea-marcas', fila)}`,
      ),
      cifras: cifrasDe('.ib-bloque-tareas .ib-tareas-fuera'),
      linea: lineaDe('.ib-bloque-tareas .ib-tareas-fuera'),
      alto: vista ? Math.ceil(vista.getBoundingClientRect().height) : 0,
    };
  });
}

/** Cuánto de la hoja, en píxeles, pasa del área útil de su página (0 si cabe). */
function sobra(alto) {
  return Math.max(0, alto - altoUtil);
}

/** El resumen de las medidas de un caso, para el informe de la prueba: alto y exceso de cada hoja y alto de sus bloques. */
function resumen(donde, altos, bloques) {
  const hojas = altos.map(
    (alto, i) => `hoja ${i + 1}: ${alto} px (área útil ${altoUtil} px, sobran ${sobra(alto)} px)`,
  );
  return `${donde}: ${hojas.join('; ')}. Bloques: ${bloques.map((hoja) => hoja.join(', ')).join(' | ')}`;
}

/** Las menos expuestas que se imprimen en los casos hechos para ellas: ninguna de las dos anchas, una si la otra lo es. */
const MENOS_IMPRESAS = { menosAnchas: 0, unaMenos: 1 };

/** Las cifras de la línea de papel cuando falta alguna tarea: las impresas y el total, solo el total o ninguna. */
function cifrasEsperadas(impresas, total) {
  if (impresas) {
    return [impresas, total];
  }
  return total === 1 ? [] : [total];
}

/**
 * La línea de papel de una lista: sin línea si se imprimen todas; si no, con las impresas y el total (o solo el total
 * si no se imprime ninguna, y sin cifras si es una sola).
 */
function comprobarLaLinea(impresas, total, cifras, donde) {
  if (impresas === total) {
    assert.equal(cifras, null, `${donde}: con todas impresas no hay línea de papel`);
  } else {
    // Con una sola tarea que no cabe, la línea la nombra en singular y no lleva cifras.
    assert.deepEqual(cifras, cifrasEsperadas(impresas, total), `${donde}: la línea de papel cuadra`);
  }
}

/**
 * Las tareas de la hoja impresa: en pantalla, todas; la línea de papel, solo si falta alguna, con las impresas y el
 * total (o solo el total si no cabe ninguna); con las 12 de un relato, al menos MIN_IMPRESAS_DE_DOCE.
 */
function comprobarLasTareas(tareas, caso, idioma, donde) {
  assert.equal(tareas.total, CASOS[caso](idioma).length, `${donde}: en pantalla están todas las tareas`);
  const impresas = tareas.textos.length;
  comprobarLaLinea(impresas, tareas.total, tareas.cifras, `${donde}, la lista`);
  comprobarLaLinea(tareas.menos.impresas, tareas.menos.total, tareas.menos.cifras, `${donde}, las menos expuestas`);
  // Una sola tarea que no cabe se nombra en singular: nunca «Tus 1 tareas» ni «Les teves 1 tasques».
  for (const linea of [tareas.linea, tareas.menos.linea]) {
    assert.doesNotMatch(linea ?? '', /\b1 (?:tareas|tasques)\b/u, `${donde}: la línea de papel concuerda en singular`);
  }
  if (caso === 'unaSolaTarea') {
    assert.equal(impresas, 0, `${donde}: la tarea de 300 letras anchas no cabe en la hoja impresa`);
    assert.match(
      tareas.linea ?? '',
      /^(?:Tu tarea|La teva tasca) /u,
      `${donde}: la línea de papel habla de una sola tarea`,
    );
  }
  if (caso in MENOS_IMPRESAS) {
    assert.equal(tareas.menos.impresas, MENOS_IMPRESAS[caso], `${donde}: las menos expuestas que caben en papel`);
  }
  if (caso === 'doce') {
    assert.ok(
      impresas >= MIN_IMPRESAS_DE_DOCE,
      `${donde}: se imprimen al menos ${MIN_IMPRESAS_DE_DOCE} de las 12 tareas (${impresas})`,
    );
  }
}

for (const [nombre, motor] of [
  ['chromium', chromium],
  ['firefox', firefox],
  ['webkit', webkit],
]) {
  test(`${nombre}: impresa, ninguna celda desborda, cada hoja cabe en su página, la línea de papel cuadra y los saltos de página son los previstos`, async (t) => {
    const recursos = recursosDelCaso(t);
    const navegador = await lanzarConPlazo(motor, { headless: true }, t.name, { recursos });
    try {
      for (const caso of Object.keys(CASOS)) {
        for (const idioma of ['es', 'ca']) {
          const donde = `${caso}, ${idioma}`;
          const { contexto, pagina } = await abrir(navegador, caso, idioma);
          const celdas = await medirCeldas(pagina);
          assert.ok(celdas.length > 0 && celdas.every((celda) => celda.texto), `${donde}: la tabla tiene sus celdas`);
          assert.deepEqual(
            celdas.filter((celda) => celda.sobra > 0),
            [],
            `${donde}: las celdas caben en su columna`,
          );
          const { estados, altos, bloques } = await medirHojas(pagina);
          t.diagnostic(resumen(`${nombre}, ${donde}`, altos, bloques));
          // Un caso de los datos lleva las filas que tenga su ocupación; los estados largos se exigen a los demás.
          for (const estado of CASOS_DE_LA_HOJA_2.includes(caso) ? [] : ESTADOS_LARGOS) {
            assert.ok(estados.includes(estado), `${donde}: la tabla lleva el estado ${estado}`);
          }
          assert.equal(altos.length, HOJAS, `${donde}: el informe tiene sus hojas`);
          const tareas = await medirTareas(pagina);
          t.diagnostic(
            `${nombre}, ${donde}: ${tareas.textos.length} de ${tareas.total} tareas impresas; ${tareas.menos.impresas} de ${tareas.menos.total} menos expuestas; línea de papel ${tareas.alto} px; filas (alto/líneas del nombre+de las marcas): ${tareas.filas.join(' ')}`,
          );
          comprobarLasTareas(tareas, caso, idioma, donde);
          assert.deepEqual(
            altos.filter((alto) => alto > altoUtil),
            [],
            `${donde}: cada hoja cabe en el área útil de su página (${altoUtil} px)`,
          );
          const { filas, despuesDeCadaHoja } = await medirSaltos(pagina);
          assert.deepEqual(
            filas.filter((salto) => salto !== 'avoid'),
            [],
            `${donde}: ninguna fila de tarea se parte entre páginas`,
          );
          assert.deepEqual(despuesDeCadaHoja, ['page'], `${donde}: la hoja 2 empieza página`);
          await contexto.close();
        }
      }
    } finally {
      await cerrarSinSustituir(() => recursos.cerrar(navegador), 'el navegador no se cerró');
    }
  });
}

/** Todos los caracteres medibles (INTERVALOS_MEDIBLES, tareas-en-papel.ts): se miden uno a uno, sin muestras. */
function caracteresMedidos() {
  const medidos = [];
  for (const { desde, hasta } of INTERVALOS_MEDIBLES) {
    for (let codigo = desde; codigo <= hasta; codigo += 1) {
      const caracter = String.fromCodePoint(codigo);
      if (esMedible(caracter)) {
        medidos.push(caracter);
      }
    }
  }
  return medidos;
}

/** Cuántas veces se repite un carácter al medirlo: así cuenta también cómo se junta con otro igual. */
const REPETICIONES = 12;
/** Lo que puede pasar el avance medido del asignado, en em, por el redondeo del motor a fracciones de píxel. */
const TOLERANCIA_EM = 0.003;

/**
 * Mide en la página el avance, en em, de cada carácter con la letra y el tamaño de `selector` (un elemento que ya está
 * en la página: se mide dentro de su padre para heredar sus estilos), en una sola línea que no se parte.
 */
function medirAvances(pagina, caracteres, { clase, padre, etiqueta }) {
  return pagina.evaluate(
    ({ lista, clase, padre, tag, veces }) => {
      const contenedor = document.querySelector(padre);
      const li = document.createElement(contenedor?.tagName === 'OL' || contenedor?.tagName === 'UL' ? 'li' : 'div');
      li.setAttribute(
        'style',
        'position:absolute;visibility:hidden;width:max-content;white-space:pre;overflow-wrap:normal',
      );
      const medida = document.createElement(tag);
      medida.className = clase;
      medida.setAttribute('style', 'display:inline;white-space:pre;overflow-wrap:normal');
      li.append(medida);
      contenedor?.append(li);
      const tamano = Number.parseFloat(getComputedStyle(medida).fontSize);
      const resultado = lista.map((caracter) => {
        medida.textContent = caracter.repeat(veces);
        const rango = document.createRange();
        rango.selectNodeContents(medida);
        return rango.getBoundingClientRect().width / veces / tamano;
      });
      const estilo = getComputedStyle(medida);
      const fuente = `${estilo.fontWeight} ${estilo.fontFamily}`;
      li.remove();
      return { resultado, fuente };
    },
    { lista: caracteres, clase, padre, tag: etiqueta, veces: REPETICIONES },
  );
}

const BASE_HEXADECIMAL = 16;
const CIFRAS_DEL_CODIGO = 4;
const DECIMALES = 3;

/** El punto de código de un carácter en hexadecimal, en mayúsculas y de cuatro cifras como mínimo. */
function codigoHexadecimal(caracter) {
  return caracter.codePointAt(0).toString(BASE_HEXADECIMAL).toUpperCase().padStart(CIFRAS_DEL_CODIGO, '0');
}

/** Los caracteres cuyo avance medido pasa del que les da tareas-en-papel.ts, con los dos valores. */
function excesos(caracteres, medidos, negrita) {
  return caracteres.flatMap((caracter, i) => {
    const asignado = avanceDelCaracter(caracter, negrita);
    const medido = medidos[i];
    if (medido <= asignado + TOLERANCIA_EM) {
      return [];
    }
    return [
      `U+${codigoHexadecimal(caracter)} «${caracter}» mide ${medido.toFixed(DECIMALES)} em y se le da ${asignado.toFixed(DECIMALES)}`,
    ];
  });
}

for (const [nombre, motor] of [
  ['chromium', chromium],
  ['firefox', firefox],
  ['webkit', webkit],
]) {
  test(`${nombre}: ningún carácter mide más que el avance que le da tareas-en-papel.ts, en peso normal y en negrita`, async (t) => {
    const recursos = recursosDelCaso(t);
    const navegador = await lanzarConPlazo(motor, { headless: true }, t.name, { recursos });
    try {
      const { contexto, pagina } = await abrir(navegador, 'anchas', 'es');
      const caracteres = caracteresMedidos();
      const normal = await medirAvances(pagina, caracteres, {
        clase: 'ib-tarea-nombre',
        padre: '.ib-tareas',
        etiqueta: 'span',
      });
      const negrita = await medirAvances(pagina, caracteres, {
        clase: 'ib-menos-nombre',
        padre: '.ib-menos',
        etiqueta: 'b',
      });
      t.diagnostic(
        `${nombre}: ${caracteres.length} caracteres medidos; letra de las tareas: ${normal.fuente}; de las menos expuestas: ${negrita.fuente}`,
      );
      assert.deepEqual(
        [
          ...excesos(caracteres, normal.resultado, false).map((exceso) => `peso normal: ${exceso}`),
          ...excesos(caracteres, negrita.resultado, true).map((exceso) => `negrita: ${exceso}`),
        ],
        [],
        `${nombre}: avances que pasan de la cota`,
      );
      await contexto.close();
    } finally {
      await cerrarSinSustituir(() => recursos.cerrar(navegador), 'el navegador no se cerró');
    }
  });
}

/** El texto de una página del PDF sin espacios ni saltos, para buscar en él un texto que el motor haya partido en líneas. */
function compacto(texto) {
  return texto.normalize('NFC').replace(/\s+/gu, '');
}

/** Las páginas del PDF de la hoja `indice` sola: las demás hojas se ocultan mientras se imprime. */
async function paginasDeLaHoja(pagina, indice) {
  await pagina.evaluate((solo) => {
    document.querySelectorAll('.documento > .hoja').forEach((hoja, i) => {
      hoja.style.display = i === solo ? '' : 'none';
    });
  }, indice);
  const pdf = await conPlazo(pagina.pdf({ preferCSSPageSize: true }), PLAZO_MS, 'el PDF de una hoja no se generó');
  await pagina.evaluate(() => {
    document.querySelectorAll('.documento > .hoja').forEach((hoja) => {
      hoja.style.display = '';
    });
  });
  return paginasDelPdf(pdf);
}

test('chromium: el PDF del informe tiene exactamente sus dos páginas, una por hoja, y cada tarea impresa está entera', async (t) => {
  const recursos = recursosDelCaso(t);
  const navegador = await lanzarConPlazo(chromium, { headless: true }, t.name, { recursos });
  try {
    for (const caso of Object.keys(CASOS)) {
      for (const idioma of ['es', 'ca']) {
        const donde = `${caso}, ${idioma}`;
        const { contexto, pagina } = await abrir(navegador, caso, idioma);
        const { altos } = await medirHojas(pagina);
        assert.equal(altos.length, HOJAS, `${donde}: el informe tiene sus hojas`);
        const { textos: impresas } = await medirTareas(pagina);
        const pdf = await conPlazo(pagina.pdf({ preferCSSPageSize: true }), PLAZO_MS, 'el PDF no se generó');
        const paginas = paginasDelPdf(pdf);
        const porHoja = [await paginasDeLaHoja(pagina, 0), await paginasDeLaHoja(pagina, 1)];
        t.diagnostic(`chromium, ${donde}: ${paginas} páginas en el PDF; cada hoja sola, ${porHoja.join(' y ')}`);
        assert.equal(paginas, PAGINAS_DEL_PDF, `${donde}: el PDF tiene ${PAGINAS_DEL_PDF} páginas`);
        assert.deepEqual(porHoja, [1, 1], `${donde}: cada hoja impresa sola ocupa una página`);
        const textos = leerPdf(pdf).map((hoja) => compacto(hoja.texto));
        assert.deepEqual(
          impresas.map(compacto).filter((tarea) => !textos.some((pagina) => pagina.includes(tarea))),
          [],
          `${donde}: cada tarea impresa está entera en una sola página del PDF`,
        );
        await contexto.close();
      }
    }
  } finally {
    await cerrarSinSustituir(() => recursos.cerrar(navegador), 'el navegador no se cerró');
  }
});

/** Los márgenes de arriba y de abajo de la página del plan (@page formacion, documento-hoja.css), en milímetros. */
const MARGENES_DEL_PLAN_MM = 22;
/** El A4 menos esos márgenes, en píxeles CSS. */
const ALTO_UTIL_DEL_PLAN = Math.floor((ALTO_DEL_A4_MM - MARGENES_DEL_PLAN_MM) * PIXELES_POR_MM);

/** Abre la página del plan del `caso` en `idioma`, ya pintado y con el medio de impresión emulado. */
async function abrirPlan(navegador, caso, idioma) {
  const direccion = servidor?.address();
  assert.ok(direccion && typeof direccion === 'object', 'El servidor de la prueba está escuchando');
  const contexto = await navegador.newContext({ viewport: { width: 794, height: 1123 } });
  const pagina = await contexto.newPage();
  await conPlazo(
    pagina.goto(`http://127.0.0.1:${direccion.port}/plan-${caso}-${idioma}.html`),
    PLAZO_MS,
    'el plan no se abrió',
  );
  await conPlazo(
    pagina.waitForFunction(() => window.planListo),
    PLAZO_MS,
    'el plan no se pintó',
  );
  assert.equal(await pagina.evaluate(() => window.planListo), 'sí', `plan ${caso}, ${idioma}: se pinta`);
  await pagina.emulateMedia({ media: 'print' });
  await conPlazo(
    pagina.evaluate(() => document.fonts.ready.then(() => undefined)),
    PLAZO_MS,
    'las tipografías no cargaron',
  );
  return { contexto, pagina };
}

/**
 * El alto de cada hoja del plan impreso, las fechas de «Tus primeras sesiones» y si su agenda está recortada y, si se
 * pide, las páginas de su PDF (null si no).
 */
async function medirPlan(pagina, conPdf) {
  const { altos, agenda } = await pagina.evaluate(() => ({
    altos: [...document.querySelectorAll('.hd-hoja')].map((hoja) => Math.ceil(hoja.getBoundingClientRect().height)),
    agenda: {
      fechas: document.querySelectorAll('.pe-tabla-agenda tbody tr').length,
      recortada: Boolean(document.querySelector('.pe-agenda-recortada')),
    },
  }));
  const pdf = conPdf ? await conPlazo(pagina.pdf({ preferCSSPageSize: true }), PLAZO_MS, 'el PDF no se generó') : null;
  return { altos, agenda, paginas: pdf ? paginasDelPdf(pdf) : null };
}

/** Lo medido en un plan, para el informe de la prueba. */
function medidasDelPlan(donde, { altos, agenda, paginas }) {
  const recorte = agenda.recortada ? ' recortada' : '';
  const pdf = paginas === null ? '' : `; ${paginas} páginas en el PDF`;
  return `${donde}: hojas de ${altos.join(' y ')} px (área útil ${ALTO_UTIL_DEL_PLAN} px), ${agenda.fechas} fechas en la agenda${recorte}${pdf}`;
}

for (const [nombre, motor] of [
  ['chromium', chromium],
  ['firefox', firefox],
  ['webkit', webkit],
]) {
  test(`${nombre}: el plan de formación impreso cabe en sus hojas, cada una en su página`, async (t) => {
    const recursos = recursosDelCaso(t);
    const navegador = await lanzarConPlazo(motor, { headless: true }, t.name, { recursos });
    try {
      for (const [caso, { hojas, recortada = false }] of Object.entries(CASOS_DEL_PLAN)) {
        for (const idioma of ['es', 'ca']) {
          const donde = `plan ${caso}, ${idioma}`;
          const { contexto, pagina } = await abrirPlan(navegador, caso, idioma);
          const medidas = await medirPlan(pagina, nombre === 'chromium');
          const { altos, agenda, paginas } = medidas;
          t.diagnostic(`${nombre}, ${medidasDelPlan(donde, medidas)}`);
          assert.equal(agenda.recortada, recortada, `${donde}: la agenda dice si recorta sus fechas`);
          assert.equal(altos.length, hojas, `${donde}: el plan tiene sus hojas`);
          assert.deepEqual(
            altos.filter((alto) => alto > ALTO_UTIL_DEL_PLAN),
            [],
            `${donde}: cada hoja cabe en su página`,
          );
          if (paginas !== null) {
            assert.equal(paginas, hojas, `${donde}: el PDF tiene una página por hoja`);
          }
          await contexto.close();
        }
      }
    } finally {
      await cerrarSinSustituir(() => recursos.cerrar(navegador), 'el navegador no se cerró');
    }
  });
}

/**
 * La luminancia relativa de WCAG 2.x: el canal de 0 a 255, su paso a lineal y el peso de cada canal. El medio es la
 * luminancia en la que un color contrasta lo mismo con el blanco que con el negro.
 */
const LUMINANCIA = {
  maximoDelCanal: 255,
  umbralLineal: 0.03928,
  divisorLineal: 12.92,
  desplazamiento: 0.055,
  escala: 1.055,
  exponente: 2.4,
  pesoRojo: 0.2126,
  pesoVerde: 0.7152,
  pesoAzul: 0.0722,
  medio: 0.179,
};
/** Los canales de color de un rgb() o rgba() del navegador; el cuarto, la opacidad. */
const CANALES_DE_COLOR = 3;

/** Oscuro: un color opaco más cercano al negro que al blanco (su luminancia relativa, por debajo del medio). */
function esOscuro(color) {
  const partes = (color.match(/\d+(?:\.\d+)?/gu) ?? []).map(Number);
  const opacidad = partes[CANALES_DE_COLOR] ?? 1;
  if (partes.length < CANALES_DE_COLOR || opacidad === 0) {
    return false;
  }
  const lineal = (canal) => {
    const valor = canal / LUMINANCIA.maximoDelCanal;
    return valor <= LUMINANCIA.umbralLineal
      ? valor / LUMINANCIA.divisorLineal
      : ((valor + LUMINANCIA.desplazamiento) / LUMINANCIA.escala) ** LUMINANCIA.exponente;
  };
  const [rojo, verde, azul] = partes.map(lineal);
  const luminancia = LUMINANCIA.pesoRojo * rojo + LUMINANCIA.pesoVerde * verde + LUMINANCIA.pesoAzul * azul;
  return luminancia < LUMINANCIA.medio;
}

/**
 * El papel de lo impreso, con el medio de impresión emulado: el fondo calculado de html y de body, el esquema de color
 * de html (con el oscuro, el motor pinta oscuro el lienzo que ningún fondo cubre) y los bloques con fondo oscuro que
 * quedan fuera de las hojas (.hoja del informe, .hd-hoja del plan), que el motor imprimiría en el espacio de la página
 * que las hojas no ocupan.
 */
async function medirElPapel(pagina) {
  const medida = await pagina.evaluate(() => {
    const fondo = (elemento) => getComputedStyle(elemento).backgroundColor;
    const nombre = (elemento) =>
      [elemento.localName, elemento.id && `#${elemento.id}`, ...[...elemento.classList].map((clase) => `.${clase}`)]
        .filter(Boolean)
        .join('');
    const fondosFuera = [...document.body.querySelectorAll('*')]
      .filter((elemento) => !elemento.closest('.hoja, .hd-hoja') && elemento.getClientRects().length > 0)
      .map((elemento) => ({ nombre: nombre(elemento), fondo: fondo(elemento) }));
    return {
      html: fondo(document.documentElement),
      body: fondo(document.body),
      esquema: getComputedStyle(document.documentElement).colorScheme,
      fondosFuera,
    };
  });
  const { fondosFuera, ...papel } = medida;
  const oscurosFuera = fondosFuera
    .filter(({ fondo }) => esOscuro(fondo))
    .map(({ nombre, fondo }) => `${nombre} (${fondo})`);
  return { ...papel, oscurosFuera };
}

/** El fondo de la página en papel: blanco o transparente (el blanco del papel). */
function esPapel(color) {
  return ['rgb(255, 255, 255)', 'rgba(0, 0, 0, 0)', 'transparent'].includes(color);
}

/** Abre una de las páginas del papel, con el plan pintado si lo lleva y con el medio de impresión emulado. */
async function abrirPapel(navegador, nombre) {
  const direccion = servidor?.address();
  assert.ok(direccion && typeof direccion === 'object', 'El servidor de la prueba está escuchando');
  const contexto = await navegador.newContext({ viewport: { width: 794, height: 1123 } });
  const pagina = await contexto.newPage();
  await conPlazo(
    pagina.goto(`http://127.0.0.1:${direccion.port}/papel-${nombre}.html`),
    PLAZO_MS,
    `${nombre}: la página no se abrió`,
  );
  if (!nombre.startsWith('ejemplo-')) {
    await conPlazo(
      pagina.waitForFunction(() => window.planListo),
      PLAZO_MS,
      `${nombre}: el plan no se pintó`,
    );
    assert.equal(await pagina.evaluate(() => window.planListo), 'sí', `${nombre}: el plan se pinta`);
  }
  await pagina.emulateMedia({ media: 'print' });
  return { contexto, pagina };
}

for (const [nombre, motor] of [
  ['chromium', chromium],
  ['firefox', firefox],
  ['webkit', webkit],
]) {
  test(`${nombre}: lo impreso sale en papel blanco con los dos temas, en el informe, en el plan y en los dos juntos`, async (t) => {
    const recursos = recursosDelCaso(t);
    const navegador = await lanzarConPlazo(motor, { headless: true }, t.name, { recursos });
    try {
      for (const tema of TEMAS) {
        for (const impresion of ['ejemplo', ...IMPRESIONES_DEL_RECORRIDO]) {
          const donde = `${impresion}-${tema}`;
          const { contexto, pagina } = await abrirPapel(navegador, donde);
          const papel = await medirElPapel(pagina);
          t.diagnostic(
            `${nombre}, ${donde}: html ${papel.html} (esquema ${papel.esquema}), body ${papel.body}, ${papel.oscurosFuera.length} bloques oscuros fuera de las hojas`,
          );
          assert.equal(papel.esquema, 'light', `${donde}: la página se imprime en el esquema claro`);
          assert.ok(esPapel(papel.html), `${donde}: el fondo de html es papel blanco (${papel.html})`);
          assert.ok(esPapel(papel.body), `${donde}: el fondo de body es papel blanco (${papel.body})`);
          assert.deepEqual(papel.oscurosFuera, [], `${donde}: fuera de las hojas no queda ningún bloque oscuro`);
          await contexto.close();
        }
      }
    } finally {
      await cerrarSinSustituir(() => recursos.cerrar(navegador), 'el navegador no se cerró');
    }
  });
}
