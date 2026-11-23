// «Qué vigilar», en la hoja 2 del informe breve: las señales con fecha (empresas, personas de su grupo, ofertas que
// mencionan la IA y normas europeas), con lo que dice cada una hoy, cómo ha ido y su próxima fecha. Los estados salen
// de los datos y del registro de hechos, comparados con la fecha del informe.

import { conArticulo, fechaCorta, mesYAnioEnFrase, partesDelDia } from '../../comun/fechas.js';
import { numero } from '../../comun/formato.ts';
import type { Idioma } from '../../comun/idioma.ts';
import { NORMAS_DE_ALTO_RIESGO, OFERTAS_QUE_MENCIONAN_IA } from '../../dominio/hechos-del-informe-breve.ts';
import type { InformeBreve, SenalBreve, UsoBreve } from '../../dominio/tipos-informe-breve.ts';
import { escapar } from '../html.ts';
import type { LenguaHtml } from '../lengua-html.ts';
import { periodoEmpresarial } from './contexto-de-datos.ts';
import { texto as t } from './idioma.ts';
import { sello } from './piezas.ts';
import { GRANDES_GRUPOS } from './textos.ts';

/** Una fecha AAAA-MM-DD como «22 oct. 2026» y «22 d’oct. del 2026». */
function fechaEscrita(iso: string, idioma: Idioma): string {
  return fechaCorta(partesDelDia(iso), idioma);
}

/** «desde el 2 dic. 2027» y «des del 2 de des. del 2027» (o «des de l’1…»). */
function desdeEl(iso: string, idioma: Idioma): string {
  const partes = partesDelDia(iso);
  return conArticulo(fechaCorta(partes, idioma), partes.dia, idioma, 'desde');
}

/** Qué dice la próxima fecha de una señal; va también en la fila (data-proxima), para que se pueda comprobar sin leerla. */
type EstadoDeLaProxima =
  | 'publicada'
  | 'sin-fecha'
  | 'futura'
  | 'en-aplicacion'
  | 'publicada-segun-calendario'
  | 'prevista'
  | 'por-confirmar';
/**
 * Una fecha prevista no acredita una publicación, y una ya pasada no se presenta como próxima: sin una edición
 * publicada observada, queda por confirmar, salvo que el evento ya pasado del calendario traiga sus valores publicados.
 * Las normas conservan su fecha de aplicación.
 */
function estadoDeLaProxima(senal: SenalBreve, hoy: string): EstadoDeLaProxima {
  if (publicadaHasta(senal, hoy)) {
    return 'publicada';
  }
  if (senal.proxima === null) {
    return 'sin-fecha';
  }
  if (senal.proxima > hoy) {
    return 'futura';
  }
  if (senal.clave === 'normas') {
    return 'en-aplicacion';
  }
  if (senal.publicadaSegunCalendario) {
    return 'publicada-segun-calendario';
  }
  return senal.proxima === hoy ? 'prevista' : 'por-confirmar';
}

/** Lo que se sabe de una edición ya publicada que el informe aún no incorpora, con la fecha en que se observó. */
function edicionPublicada(publicada: NonNullable<SenalBreve['publicada']>, idioma: Idioma): string {
  const partes = partesDelDia(publicada.observada);
  const observada = conArticulo(fechaCorta(partes, idioma), partes.dia, idioma, 'el');
  return publicada.conMicrodatos
    ? t(
        idioma,
        'El INE publicó la edición de {0}; Faro lo comprobó {1}. La incorporará cuando haya comprobado que se puede comparar con la anterior.',
        publicada.anio,
        observada,
      )
    : t(
        idioma,
        'El INE publicó la edición de {0}; Faro lo comprobó {1}. La incorporará cuando el INE publique los datos detallados de la encuesta.',
        publicada.anio,
        observada,
      );
}

/** La edición publicada que el informe puede citar: una observación posterior a su fecha no la sabía. */
function publicadaHasta(senal: SenalBreve, hoy: string): SenalBreve['publicada'] {
  return senal.publicada && senal.publicada.observada <= hoy ? senal.publicada : undefined;
}

/** El texto de la columna según su estado; con una edición publicada dice cuál y la frase entera va bajo «Qué mirar». */
function proximaFecha(senal: SenalBreve, estado: EstadoDeLaProxima, hoy: string, idioma: Idioma): string {
  const proxima = senal.proxima ?? '';
  switch (estado) {
    case 'publicada':
      return t(idioma, 'Publicada la de {0}', publicadaHasta(senal, hoy)?.anio ?? '');
    case 'sin-fecha':
      return t(idioma, 'Sin fecha fija');
    case 'futura':
      return fechaEscrita(proxima, idioma);
    case 'en-aplicacion':
      return t(idioma, 'En aplicación {0}', desdeEl(proxima, idioma));
    case 'publicada-segun-calendario':
      return t(idioma, 'Publicada la de {0}', senal.publicadaSegunCalendario ?? '');
    case 'prevista':
      return t(idioma, 'Fecha prevista: {0}', fechaEscrita(proxima, idioma));
    default:
      return t(idioma, 'Fecha por confirmar');
  }
}

/** El mes y el año de una fecha AAAA-MM-DD: «agosto de 2026», o en catalán con su artículo, «l’agost del 2026». */
function mesYAnio(iso: string, idioma: Idioma): string {
  return mesYAnioEnFrase(partesDelDia(iso), idioma);
}

/** Cómo ha ido la cifra de uso: el primer año de la encuesta que trae el paquete, o desde cuándo se mide. */
function comoHaIdoElUso(uso: UsoBreve, idioma: Idioma): string {
  const [primero] = uso.aniosMedidos;
  return uso.aniosMedidos.length > 1 && primero
    ? t(idioma, 'Se mide desde {0}', escapar(primero))
    : t(idioma, 'Primer año que se mide');
}

/**
 * La fila de las normas de alto riesgo, con el estado que da su registro: aprobadas sin aplicar hasta su fecha de
 * aplicación y en aplicación desde ese día; y el aplazamiento desde la fecha que tenían antes.
 */
function filaDeLasNormas(hoy: string, idioma: Idioma): [string, string, string] {
  const aplicadas = NORMAS_DE_ALTO_RIESGO.aplicacion <= hoy;
  return [
    t(
      idioma,
      'Normas europeas para la IA que selecciona, evalúa o despide personas<small>Antes, la empresa deberá avisar a la plantilla.</small>',
    ),
    t(idioma, aplicadas ? 'Aprobadas y en aplicación' : 'Aprobadas, aún sin aplicar'),
    t(idioma, 'Aplazadas: iban a aplicarse en {0}', mesYAnio(NORMAS_DE_ALTO_RIESGO.aplazadaDesde, idioma)),
  ];
}

/** Una cifra de empresas conserva su población y periodo: no es una tasa de personas. */
function filaEmpresarial(empresas: InformeBreve['empresas'], idioma: Idioma): [string, string, string] | null {
  if (!empresas || empresas.cataluna.total === null) {
    return null;
  }
  return [
    t(idioma, 'Uso de IA: empresas catalanas con Internet (10 o más personas)'),
    `<b>${numero(empresas.cataluna.total, 2)}</b> de cada 100 (${escapar(periodoEmpresarial(empresas.vigencia.periodo))})`,
    t(idioma, empresas.encuesta.ruptura ? 'Ruptura de serie; sin comparación' : 'Sin serie comparable en este paquete'),
  ];
}

/** Lo que dice cada señal: qué mirar, la situación hoy y cómo ha ido. */
function filaDeSenal(senal: SenalBreve, breve: InformeBreve, lengua: LenguaHtml): [string, string, string] | null {
  const idioma = lengua.idioma;
  switch (senal.clave) {
    case 'empresas':
      return filaEmpresarial(breve.empresas, idioma);
    case 'personas': {
      const uso = breve.uso;
      if (!uso) {
        return null;
      }
      const gran = uso.granGrupo ? GRANDES_GRUPOS[uso.granGrupo] : undefined;
      const grupo = gran ? t(idioma, gran.corto) : (uso.grupo ?? '');
      const donde = uso.ambito === 'espana' ? t(idioma, ', en España') : '';
      const publicada = publicadaHasta(senal, breve.fecha);
      const nota = publicada ? `<small>${escapar(edicionPublicada(publicada, idioma))}</small>` : '';
      return [
        lengua.texto(t(idioma, 'Personas de tu grupo ({0}) que usan IA para trabajar{1}', grupo, donde)) + nota,
        `<b>${uso.deCada100}</b> de cada 100 (${escapar(uso.anio)})`,
        comoHaIdoElUso(uso, idioma),
      ];
    }
    case 'ofertas-ia':
      return [
        t(idioma, 'Ofertas de empleo que mencionan la IA, en España'),
        `<b>${OFERTAS_QUE_MENCIONAN_IA.deCada100}</b> de cada 100 (${OFERTAS_QUE_MENCIONAN_IA.anio})`,
        '—',
      ];
    default:
      return filaDeLasNormas(breve.fecha, idioma);
  }
}

/** «Qué vigilar»: datos y normas con fecha. */
export function queVigilar(breve: InformeBreve, lengua: LenguaHtml): string {
  const idioma = lengua.idioma;
  const cabeceras = (['Qué mirar', 'Situación hoy', 'Cómo ha ido', 'Próxima fecha'] as const)
    .map((cabecera) => `<th scope="col">${t(idioma, cabecera)}</th>`)
    .join('');
  const filas = breve.senales
    .map((senal) => {
      const fila = filaDeSenal(senal, breve, lengua);
      if (fila === null) {
        return '';
      }
      const estado = estadoDeLaProxima(senal, breve.fecha);
      const celdas = [...fila, escapar(proximaFecha(senal, estado, breve.fecha, idioma))];
      return `<tr data-proxima="${estado}">${celdas.map((celda) => `<td>${celda}</td>`).join('')}</tr>`;
    })
    .join('');
  return `<section aria-label="${t(idioma, 'Qué vigilar')}">
  <h2 class="ib-seccion"><span>${t(idioma, 'Qué vigilar')}</span><small>${t(idioma, 'Datos y normas con fecha.')} ${sello('oficial', 'INE', idioma)} ${sello('estudio', 'Indeed', idioma)} ${sello('norma', t(idioma, 'Reglamento de IA'), idioma)}</small></h2>
  <table class="ib-tabla ib-tabla-tendencias"><thead><tr>${cabeceras}</tr></thead><tbody>${filas}</tbody></table>
</section>`;
}
