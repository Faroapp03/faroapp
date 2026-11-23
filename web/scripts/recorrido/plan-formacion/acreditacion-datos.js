// Selecciona solo certificados comprobados del informe de la ocupación vigente.
import { camposDe, listaDe, textoDe } from '../../json.js';

/** @import { AcreditacionPlan, IdiomaPlan } from './contrato.js' */
/** @typedef {{esco:string|null,isco08:string,idioma:IdiomaPlan}} Identidad */
const NIVEL_MAXIMO = 3;
/** @param {unknown} valor @param {string} dominio */
function enlaceOficial(valor, dominio) {
  try {
    const url = new URL(textoDe(valor));
    return url.protocol === 'https:' && url.hostname === dominio && !url.username && !url.password ? url.href : '';
  } catch {
    return '';
  }
}
/** @param {unknown} valor @param {Omit<AcreditacionPlan,'codigo'|'nombre'|'nivel'|'relacion'|'enlaceBoe'>} origen
 * @returns {AcreditacionPlan[]} */
function certificado(valor, origen) {
  const dato = camposDe(valor);
  const codigo = textoDe(dato.codigo);
  const nombre = textoDe(dato.nombre);
  const enlaceBoe = enlaceOficial(dato.enlaceBoe, 'www.boe.es');
  if (
    !/^[A-Z]{4}\d{4}$/.test(codigo) ||
    !nombre ||
    !enlaceBoe ||
    (dato.nivel !== 1 && dato.nivel !== 2 && dato.nivel !== NIVEL_MAXIMO) ||
    (dato.relacion !== 'ocupacion' && dato.relacion !== 'grupo')
  ) {
    return [];
  }
  return [{ ...origen, codigo, nombre, nivel: dato.nivel, relacion: dato.relacion, enlaceBoe }];
}
/** No usa los certificados del SEPE que no se han comprobado individualmente.
 * @param {unknown} datos @param {Identidad} identidad @returns {AcreditacionPlan[]} */
export function leerAcreditaciones(datos, identidad) {
  const informe = camposDe(datos);
  const ocupacion = camposDe(informe.ocupacion);
  if (ocupacion.esco !== identidad.esco || ocupacion.isco08 !== identidad.isco08) {
    return [];
  }
  const bloque = camposDe(informe.acreditacion);
  const tramite = listaDe(bloque.enlaces)
    .map((v) => enlaceOficial(camposDe(v).url, 'tramits.gencat.cat'))
    .find((url) => url && new URL(url).pathname.endsWith('/21900_Acreditat'));
  const comprobado = textoDe(bloque.comprobado);
  const fuente = textoDe(bloque.fuente);
  if (!tramite || !fuente || !/^\d{4}-\d{2}-\d{2}$/.test(comprobado)) {
    return [];
  }
  const origen = {
    ocupacion: identidad.esco ?? '',
    idioma: identidad.idioma,
    tramite,
    fuente,
    comprobado,
    ofertaActualizada: textoDe(bloque.ofertaActualizada),
  };
  return listaDe(bloque.certificados).flatMap((valor) => certificado(valor, origen));
}
