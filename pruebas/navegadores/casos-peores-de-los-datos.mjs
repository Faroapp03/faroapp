/**
 * Los casos de la hoja 2 del informe que más exigen a su altura, sacados de los datos reales en cada idioma: la
 * ocupación con el título más largo (aparece en el antetítulo, en el encabezado y en el pie), la que lleva el nombre de
 * grupo más largo en «Qué vigilar», la de las frases de mercado más largas y la que muestra más sellos distintos. Así, un
 * cambio de datos que alargue un texto se mide solo, sin tocar la guardia de navegador.
 */
import { construirInforme } from '../../src/dominio/informe.ts';
import { construirInformeBreve } from '../../src/dominio/informe-breve.ts';
import { renderizarInformeBreve, titulos } from '../../src/presentacion/informe-breve.ts';

const CIFRAS_DEL_GRUPO = 4;
const FECHA = '2026-10-23';
const TAREAS = 3;
const NOTA_INICIAL = 0.8;
const SALTO = 0.2;
const MEDIO_MARGEN = 0.05;
/** Cuánto pesa un tipo de sello distinto frente a sus repeticiones, al elegir la ocupación con más sellos. */
const PESO_DE_UN_TIPO = 1000;

/** @typedef {{ ocupacionEsco?: string, isco08: string }} Ocupacion */
/** @typedef {import('../../src/dominio/tipos-paquete.ts').Datos} Datos */

/**
 * Las ocupaciones de los datos: cada ESCO con su grupo y cada grupo ISCO-08 de cuatro cifras.
 * @param {Datos} datos
 * @returns {Ocupacion[]}
 */
export function ocupacionesDeLosDatos(datos) {
  return [
    ...Object.entries(datos.esco.ocupaciones).map(([codigo, ocupacion]) => ({
      ocupacionEsco: codigo,
      isco08: ocupacion.isco08,
    })),
    ...Object.keys(datos.clasificaciones.isco08_es)
      .filter((codigo) => codigo.length === CIFRAS_DEL_GRUPO)
      .map((codigo) => ({ isco08: codigo })),
  ];
}

/**
 * Las tareas de un informe cualquiera: la hoja 2 no depende de ellas.
 * @returns {import('../../src/dominio/tipos-entrada.ts').TareaEntrada[]}
 */
function tareasDeEjemplo() {
  return Array.from({ length: TAREAS }, (_, i) => {
    const valor = NOTA_INICIAL - i * SALTO;
    return {
      id: `t${i + 1}`,
      texto: `Atender llamadas ${i}`,
      tiempo: 'mucho',
      estimacion: {
        valor,
        margen: [valor - MEDIO_MARGEN, valor + MEDIO_MARGEN],
        origen: 'faro',
        referencias: 'ocupacion',
        incierta: false,
      },
    };
  });
}

/** @param {string} html */
const sinEtiquetas = (html) => html.replace(/<[^>]*>/gu, '');
/**
 * @param {string} html
 * @param {RegExp} patron - Con un grupo: el HTML del texto.
 * @returns {number[]} La longitud del texto de cada coincidencia.
 */
const longitudes = (html, patron) => [...html.matchAll(patron)].map(([, texto]) => sinEtiquetas(texto ?? '').length);
/** @param {number[]} valores */
const sumar = (valores) => valores.reduce((suma, valor) => suma + valor, 0);

/**
 * Lo que mide la hoja 2 de una ocupación para elegir los casos: título, grupo, frases de mercado y sellos.
 * @param {Ocupacion} ocupacion
 * @param {Datos} datos
 * @param {'es' | 'ca'} idioma
 * @returns {Record<string, number>}
 */
function medidasDe(ocupacion, datos, idioma) {
  const informe = construirInforme({ ...ocupacion, fecha: FECHA, tareas: tareasDeEjemplo() }, datos, {
    idioma,
    formacion: null,
  });
  const html = renderizarInformeBreve(construirInformeBreve(informe, datos), informe);
  const hoja2 = html.slice(html.lastIndexOf('<section class="hoja '));
  const sellos = [...hoja2.matchAll(/data-tipo="([^"]+)"/gu)].map(([, tipo]) => tipo);
  return {
    titulo: titulos(informe).tituloTexto.length,
    grupo: Math.max(0, ...longitudes(hoja2, /<tr data-proxima="[^"]*"><td>([\s\S]*?)<\/td>/gu)),
    mercado:
      sumar(longitudes(hoja2, /<div class="ib-tarjeta"[^>]*>[\s\S]*?<p>([\s\S]*?)<\/p>/gu)) +
      sumar(longitudes(hoja2, /<p class="ib-p2-frase">([\s\S]*?)<\/p>/gu)),
    sellos: new Set(sellos).size * PESO_DE_UN_TIPO + sellos.length,
  };
}

/** Los criterios de elección: la medida que decide cada caso. */
/** @type {Record<string, string>} */
const CRITERIOS = { titulo: 'peorTitulo', grupo: 'peorGrupo', mercado: 'peorMercado', sellos: 'peorSellos' };

/**
 * La ocupación que gana en cada criterio de la hoja 2, en `idioma`: la primera de los datos si hay empate.
 *
 * @param {Datos} datos - El paquete de datos.
 * @param {'es' | 'ca'} idioma - El idioma del informe.
 * @returns {Record<string, Ocupacion & { medida: number }>} Un caso por criterio.
 */
export function casosPeoresDeLosDatos(datos, idioma) {
  /** @type {Record<string, Ocupacion & { medida: number }>} */
  const mejores = {};
  for (const ocupacion of ocupacionesDeLosDatos(datos)) {
    const medidas = medidasDe(ocupacion, datos, idioma);
    for (const [criterio, nombre] of Object.entries(CRITERIOS)) {
      const medida = medidas[criterio] ?? 0;
      if (!mejores[nombre] || medida > (mejores[nombre]?.medida ?? 0)) {
        mejores[nombre] = { ...ocupacion, medida };
      }
    }
  }
  return mejores;
}
