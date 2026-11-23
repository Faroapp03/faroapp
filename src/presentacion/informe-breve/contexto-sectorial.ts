// Consulta censal fuera de las hojas A4. El sector de un grupo no identifica el de la persona o su empresa.
import { numero, porcentaje } from '../../comun/formato.ts';
import type { Idioma } from '../../comun/idioma.ts';
import type { ContextoSectorial } from '../../dominio/tipos-contexto-empresarial.ts';
import { escapar } from '../html.ts';
import { texto } from './idioma.ts';
import { desplegableDeConsulta } from './piezas.ts';

const CIFRAS_DEL_ANIO = 4;

/** Denominación o cita oficial en el castellano original del Censo. */
function publicado(dato: string, idioma: Idioma): string {
  return `<span${idioma === 'ca' ? ' lang="es"' : ''}>${escapar(dato)}</span>`;
}

/** Todas las filas publicadas y su resto; no calcula personas del resto a partir de porcentajes redondeados. */
function filas(contexto: ContextoSectorial, idioma: Idioma): string {
  const sectores = contexto.sectores
    .map(
      (s) =>
        `<tr><th scope="row">${escapar(s.codigo)} · ${publicado(s.nombre, idioma)}</th><td class="num">${porcentaje(s.porcentaje, 1)}</td><td class="num">${numero(s.personas)}</td></tr>`,
    )
    .join('');
  const otros =
    contexto.otros === null
      ? ''
      : `<tr><th scope="row">${texto(idioma, 'Otros sectores (resto de la fuente)')}</th><td class="num">${porcentaje(contexto.otros, 1)}</td><td class="num">—</td></tr>`;
  return sectores + otros;
}

/** Periodo y población propios, con el sentido de la remisión declarado sin inventar su motivo. */
function alcance(contexto: ContextoSectorial, idioma: Idioma): string {
  const remision = contexto.remision
    ? `<p>${texto(idioma, 'La fuente remite del grupo {0} al grupo {1}.', escapar(contexto.grupoSolicitado), escapar(contexto.grupoMostrado))}</p>`
    : '';
  return `<p>${texto(idioma, 'Cataluña.')} ${publicado(contexto.fecha, idioma)}. ${texto(idioma, 'Grupo CNO-11 {0}: {1} personas ocupadas de 16 o más años, por lugar de trabajo del establecimiento.', escapar(contexto.grupoMostrado), numero(contexto.personas))}</p>${remision}
  <p>${texto(idioma, 'Actividad CNAE-2009. Este reparto corresponde al grupo de ocupación; no identifica el sector de tu empresa ni mide su uso de IA.')}</p>`;
}

/** Desplegable nativo con el patrón del método ya utilizado por el informe. */
export function contextoCensal(contexto: ContextoSectorial | null, idioma: Idioma): string {
  if (!contexto) {
    return '';
  }
  const titulo = texto(idioma, 'Contexto censal del grupo ({0})', escapar(contexto.periodo.slice(0, CIFRAS_DEL_ANIO)));
  const resto = `
  <table><caption>${texto(idioma, 'Sectores publicados del grupo, no sectores de la persona')}</caption><thead><tr><th scope="col">${texto(idioma, 'Actividad')}</th><th scope="col">${texto(idioma, 'Porcentaje del grupo')}</th><th scope="col">${texto(idioma, 'Personas')}</th></tr></thead><tbody>${filas(contexto, idioma)}</tbody></table>
  <p>${texto(idioma, 'La fuente publica sectores de al menos {0} personas y el {1} del grupo; conserva el resto agrupado cuando lo declara.', numero(contexto.minimoPersonas), porcentaje(contexto.minimoPorcentaje, 1))}</p>
  <p>${texto(idioma, 'Cada celda de actividad suma cuatro provincias con cifras perturbadas por el INE: hasta ±12 personas por celda. Las empresas de trabajo temporal cuentan en su propia actividad, no en la de la empresa usuaria.')}</p>
  <p>${texto(idioma, 'No incluye a quienes no tienen lugar de trabajo consignado; el INE imputa la ocupación en casi una de cada cinco personas.')}</p>
  <p>${publicado(contexto.fuente, idioma)}</p>
  `;
  return `<div class="ib-contexto ib-contexto-censal metodo"><details>${desplegableDeConsulta(titulo, `${alcance(contexto, idioma)}${resto}`)}</details></div>`;
}
