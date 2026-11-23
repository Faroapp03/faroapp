// Contexto consultable fuera de las hojas: metadatos de la fuente, sin completar cifras desconocidas.
import { fechaNumerica, partesEnZona } from '../../comun/fechas.js';
import { fechaConBarras } from '../../comun/formato.ts';
import type { Idioma } from '../../comun/idioma.ts';
import type { InformeBreve } from '../../dominio/tipos-informe-breve.ts';
import { escapar } from '../html.ts';
import { texto } from './idioma.ts';
import { desplegableDeConsulta } from './piezas.ts';

/** El periodo explícito del paquete, no el año de su publicación o de la fecha del informe. */
export function periodoEmpresarial(periodo: string): string {
  const trimestre = /^(\d{4})-T([1-4])$/u.exec(periodo);
  return trimestre ? `${trimestre[2]}T ${trimestre[1]}` : periodo;
}

/** Metadato publicado en castellano: se conserva literal y se marca para la voz del lector. */

function oficial(valor: string, idioma: Idioma): string {
  return idioma === 'ca' ? `<span lang="es">${escapar(valor)}</span>` : escapar(valor);
}

/** La base real del indicador, con la ruptura y capturas del productor admitido. */
export function contextoDeDatos(breve: InformeBreve, idioma: Idioma): string {
  const empresas = breve.empresas;
  if (!empresas) {
    return '';
  }
  const { encuesta } = empresas;
  const detalles = [
    encuesta.medida,
    encuesta.poblacion,
    encuesta.periodo,
    encuesta.denominador,
    encuesta.clasificacion,
    encuesta.ambito,
    encuesta.ruptura,
    encuesta.error,
    empresas.vigencia.calendario,
  ].filter((v): v is string => v !== null);
  const paginaDeLaTabla = empresas.capturas.find((c) => c.tipo === 'notas')?.url;
  const capturas = empresas.capturas
    .map(
      (c) =>
        `<li><a href="${escapar(c.tipo === 'tabla' && paginaDeLaTabla ? paginaDeLaTabla : c.url)}" target="_blank" rel="noopener noreferrer">${texto(idioma, c.tipo === 'tabla' ? 'Tabla oficial' : 'Notas metodológicas')}</a> · ${texto(idioma, 'Copia: {0}', escapar(fechaNumerica(partesEnZona(c.descargado_utc))))}</li>`,
    )
    .join('');
  const resto = `
    <p>${texto(idioma, 'Edición: {0}.', escapar(encuesta.edicion))}</p>
    <p>${texto(idioma, 'Periodo: {0}.', escapar(periodoEmpresarial(empresas.vigencia.periodo)))}</p>
    ${empresas.vigencia.publicado ? `<p>${texto(idioma, 'Publicado: {0}.', escapar(fechaConBarras(empresas.vigencia.publicado)))}</p>` : ''}
    <p><b>${texto(idioma, 'Definición original publicada')}</b></p>
    <ul>${detalles.map((d) => `<li>${oficial(d, idioma)}</li>`).join('')}</ul>
    <p>${oficial(empresas.fuente, idioma)}</p><ul>${capturas}</ul>
  `;
  const primero = `<p>${texto(idioma, 'Describe empresas, no personas ni el uso de IA en tu puesto.')}</p>`;
  return `<div class="ib-contexto metodo"><details>${desplegableDeConsulta(texto(idioma, 'Base de la encuesta empresarial'), `${primero}${resto}`)}</details></div>`;
}
