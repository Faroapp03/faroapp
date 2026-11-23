/** Datos publicados de la oferta: no convierte una ausencia en garantía de disponibilidad. */

import { fechaDeCurso, periodoDeCurso } from '../../catalogo-cursos/fechas-de-curso.js';
import { crear } from '../../dom.js';
import { escribir } from '../../idioma.js';
import { conVersiones, enIdioma, traducible } from '../../textos.js';
import { avisosPorConfirmar, textoDelLimite } from '../plan-formacion/ficha-oferta.js';

/** @import { OpcionPlan, RequisitoRevisado } from '../../../../src/seleccion-formacion/contrato.ts' */
/** @param {string} clave */
const t = (clave) => traducible(`formacion.dos.${clave}`);
/** @param {string} clave */
const parrafo = (clave) => escribir(crear('p'), t(clave));
/** @param {string} clave @param {import('../../textos.js').Parte} valor */
const linea = (clave, valor) => crear('p', {}, escribir(crear('span'), t(clave)), ': ', escribir(crear('span'), valor));
/** Un periodo publicado escrito igual que en Cursos, en hora de Barcelona.
 * @param {unknown} hecho @param {string} tipo */
function periodo(hecho, tipo) {
  if (!hecho || typeof hecho !== 'object') {
    return null;
  }
  const h = /** @type {{motivo?:string,valor?:unknown}} */ (hecho);
  if (h.motivo !== 'conocido' || !h.valor || typeof h.valor !== 'object') {
    return null;
  }
  const valor = /** @type {{tipo?:string,inicio?:string|null,fin?:string|null}} */ (h.valor);
  if (valor.tipo !== tipo || (!valor.inicio && !valor.fin)) {
    return null;
  }
  const { inicio, fin } = valor;
  /** @param {'es'|'ca'} idioma */
  const escrito = (idioma) =>
    inicio && fin ? periodoDeCurso(inicio, fin, idioma) : fechaDeCurso(String(inicio ?? fin), idioma);
  return conVersiones({ es: escrito('es'), ca: escrito('ca') });
}
/** Una condición revisada se lee en el idioma de la persona; lo demás, tal como lo publica la ficha y en su idioma.
 * @param {RequisitoRevisado} requisito @returns {import('../../textos.js').Parte} */
export function textoDeRequisito(requisito) {
  if (requisito.resumen) {
    return conVersiones({ es: requisito.resumen.es, ca: requisito.resumen.ca });
  }
  return requisito.idioma ? enIdioma(requisito.descripcion, requisito.idioma) : requisito.descripcion;
}
/** @param {string} clave @param {readonly RequisitoRevisado[]} requisitos */
function bloqueDeRequisitos(clave, requisitos) {
  const elementos = requisitos.map((r) => escribir(crear('li'), textoDeRequisito(r)));
  return crear('div', {}, parrafo(clave), crear('ul', {}, ...elementos));
}
/** Lo mismo que decide el motor: las condiciones, por un lado; lo informativo, aparte y sin presentarlo como condición.
 * @param {OpcionPlan} opcion */
function requisitosDeOpcion(opcion) {
  if (!opcion.aprendizaje) {
    return [parrafo('sin-ficha')];
  }
  const condiciones = opcion.requisitos.filter((r) => r.caso !== 'informativa');
  const informacion = opcion.requisitos.filter((r) => r.caso === 'informativa');
  if (condiciones.length === 0 && informacion.length === 0) {
    return [parrafo('sin-requisitos')];
  }
  return [
    ...(condiciones.length > 0 ? [bloqueDeRequisitos('requisitos', condiciones)] : []),
    ...(informacion.length > 0 ? [bloqueDeRequisitos('informacion', informacion)] : []),
  ];
}
/** @param {OpcionPlan} opcion */
export function condicionesDeOpcion(opcion) {
  const { oferta } = opcion;
  const hechos = oferta.hechos;
  if (!hechos) {
    return [];
  }
  const lista = [parrafo('gratis')];
  const registro = hechos.requiere_registro_previo;
  if (registro.motivo === 'conocido' && typeof registro.valor === 'boolean') {
    lista.push(parrafo(registro.valor ? 'registro-si' : 'registro-no'));
  }
  const catalan = avisosPorConfirmar(opcion, 'ca');
  for (const [indice, es] of avisosPorConfirmar(opcion, 'es').entries()) {
    lista.push(escribir(crear('p'), conVersiones({ es, ca: catalan[indice] ?? es })));
  }
  const limite = { es: textoDelLimite(opcion, 'es'), ca: textoDelLimite(opcion, 'ca') };
  if (limite.es && limite.ca) {
    lista.push(escribir(crear('p'), conVersiones({ es: limite.es, ca: limite.ca })));
  }
  const aula = periodo(hechos.calendario_aula, 'ventana-acceso');
  lista.push(aula ? linea('aula', aula) : parrafo('sin-aula'));
  const matricula = periodo(hechos.calendario_matricula, 'matricula');
  lista.push(matricula ? linea('matricula', matricula) : parrafo('sin-matricula'));
  if (oferta.incidencia_enlace_el) {
    lista.push(parrafo('incidencia'));
  }
  lista.push(...requisitosDeOpcion(opcion));

  return lista;
}
