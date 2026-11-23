// Pinta el informe breve «La IA y tu trabajo» en HTML, en hojas A4 (estilos/informe-breve.css): la hoja 1, sobre la
// IA y las tareas de la persona (informe-breve/hoja-ia.ts), y la hoja 2, sobre el mercado de trabajo de su ocupación
// (informe-breve/hoja-mercado.ts). Siempre son dos: el breve no lleva formación, y la hoja de ruta de formación es la
// un documento independiente de la selección acreditada local. Es la plantilla laboral común: lo que cambia aquí cambia en todos
// los informes nuevos. Todo texto variable pasa por escapar(); las medidas van en atributos data-* (sin estilos en
// línea), que la web convierte en propiedades de CSS (scripts/informe.js).

import { esIdioma, type Idioma } from '../comun/idioma.ts';
import { formasLeidas, tituloParaVer } from '../comun/titulo-breve.js';
import type { Informe } from '../dominio/tipos-informe.ts';
import type { InformeBreve } from '../dominio/tipos-informe-breve.ts';
import { escapar } from './html.ts';
import { consultaDeLasTareas, tareasConsultables } from './informe-breve/consulta-tareas.ts';
import { contextoDeDatos } from './informe-breve/contexto-de-datos.ts';
import { contextoCensal } from './informe-breve/contexto-sectorial.ts';
import { detalleEstadisticoIa, hojaDeLaIa } from './informe-breve/hoja-ia.ts';
import { detalleDelMercado, hojaDelMercado } from './informe-breve/hoja-mercado.ts';
import { texto } from './informe-breve/idioma.ts';
import { lenguaDe } from './lengua-html.ts';

/** Las hojas del informe breve: «Tu trabajo y la IA» y «El mercado laboral». */
const HOJAS = 2;

/** Baja un nivel cada encabezado: incrustado, el informe cuelga del h1 de la página que lo recibe. */
function bajarUnNivelLosEncabezados(html: string): string {
  return html.replace(
    /<(\/?)h([1-5])\b/g,
    (_etiqueta, cierre: string, nivel: string) => `<${cierre}h${Number(nivel) + 1}`,
  );
}

/** El título de la ocupación como se ve y, para los lectores de pantalla, sus dos formas enteras (también lo usan las pruebas). */
export function titulos(informe: Informe): { titulo: string; tituloVisto: string; tituloTexto: string } {
  const lengua = lenguaDe(informe);
  const original = informe.ocupacion.titulo;
  const idiomaDelTitulo = lengua.idiomaDe(original);
  const idioma = esIdioma(idiomaDelTitulo) ? idiomaDelTitulo : lengua.idioma;
  const visto = tituloParaVer(original, idioma);
  const formas = formasLeidas(original, idioma);
  const dato = lengua.dato(original, visto);
  const tituloVisto = dato;
  const titulo =
    formas === null
      ? tituloVisto
      : `${tituloVisto}<span class="solo-lectores"${idiomaDelTitulo !== lengua.idioma ? ` lang="${escapar(idiomaDelTitulo)}"` : ''}> (${escapar(formas)})</span>`;
  return { titulo, tituloVisto, tituloTexto: escapar(visto) };
}

/** Los botones del final: imprimir o guardar en PDF, borrar y empezar de nuevo. */
function cierre(idioma: Idioma): string {
  return `<div class="cierre ib-cierre">
        <p class="estado" id="estado" role="status"></p>
        <div class="acciones">
          <button type="button" class="principal" id="imprimir">${texto(idioma, 'Imprimir o guardar en PDF')}</button>
          <button type="button" class="secundaria" id="borrar">${texto(idioma, 'Borrar el informe y lo escrito')}</button>
          <a class="secundaria" href="recorrido.html">${texto(idioma, 'Empezar de nuevo')}</a>
        </div>
      </div>`;
}

/**
 * El informe breve completo. En una página propia es su <main>; `incrustado` (la API para el recorrido) lo devuelve en
 * un <div>, con los encabezados un nivel más abajo.
 *
 * @param breve - Las cifras y decisiones del informe breve (dominio/informe-breve.ts).
 * @param informe - El informe completo del que sale (para su idioma y sus datos sin traducir).
 * @param opciones - `incrustado`: si se devuelve un <div> en vez de la página propia.
 * @returns El HTML del informe breve.
 */
export function renderizarInformeBreve(
  breve: InformeBreve,
  informe: Informe,
  {
    incrustado = false,
    ejemplo = false,
    conMarca = ejemplo,
  }: { incrustado?: boolean; ejemplo?: boolean; conMarca?: boolean } = {},
): string {
  const lengua = lenguaDe(informe);
  const tareas = tareasConsultables(breve, informe);
  const ambito = { breve, lengua, tareas, ejemplo, hojas: HOJAS, ...titulos(informe) };
  const etiqueta = incrustado ? 'div' : 'main';
  const id = incrustado ? 'informe-contenido' : 'contenido';
  const tituloPdf = texto(
    lengua.idioma,
    'La IA y tu trabajo · {0}',
    tituloParaVer(informe.ocupacion.titulo, lengua.idioma),
  );
  const nombrePdf = ejemplo ? texto(lengua.idioma, 'Ejemplo ficticio · {0}', tituloPdf) : tituloPdf;
  // API y ejemplo exponen la procedencia del cálculo; el breve habitual la conserva en su JSON.
  const marca = conMarca && informe.marcaIa ? ` data-marca-ia="${escapar(JSON.stringify(informe.marcaIa))}"` : '';
  const fuenteDigital =
    conMarca && informe.marcaIa?.fuenteDigital
      ? ` data-fuente-digital="${escapar(informe.marcaIa.fuenteDigital)}"`
      : '';
  const mercado = hojaDelMercado(ambito);
  const segundaHoja = incrustado ? mercado : bajarUnNivelLosEncabezados(mercado);
  const html = `<${etiqueta} id="${id}" class="informe-breve" lang="${lengua.idioma}" data-titulo-pdf="${escapar(nombrePdf)}"${fuenteDigital}${marca}>
      <div class="documento">${hojaDeLaIa(ambito)}${segundaHoja}</div>
      ${consultaDeLasTareas(tareas, lengua)}
      ${contextoDeDatos(breve, lengua.idioma)}
      ${contextoCensal(breve.sectores, lengua.idioma)}
      ${detalleEstadisticoIa(ambito)}
      ${bajarUnNivelLosEncabezados(detalleDelMercado(ambito))}
      ${cierre(lengua.idioma)}
    </${etiqueta}>`;
  return incrustado ? bajarUnNivelLosEncabezados(html) : html;
}
