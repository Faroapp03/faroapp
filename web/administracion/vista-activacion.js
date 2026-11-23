import { texto as textoPanel } from '../scripts/textos.js';
import { esFasePrincipalEnCurso } from './estado-activacion.js';
import { detallesDelRegistro } from './estado-visible-panel.js';
import { fechaConUtc } from './fechas-panel.js';
import { mostrarCierre } from './vista-cierre.js';

/** Registro de activación observado: no coteja la versión que se sirve actualmente. */
/** @typedef {import('./estado-activacion.js').EstadoActivacion} EstadoActivacion */
/** @typedef {import('./estado-activacion.js').FaseActivacion} FaseActivacion */
/** @typedef {import('./estado-activacion.js').MotivoAbandono} MotivoAbandono */
/** @typedef {import('./estado-activacion.js').FasePrincipalEnCurso} FasePrincipalEnCurso */
/** @typedef {import('./estado-activacion.js').MotivoDetenida} MotivoDetenida */
/** @typedef {import('./estado-activacion.js').ReintentoObservado} ReintentoObservado */
/** @typedef {import('./estado-activacion.js').ServidoDetenida} ServidoDetenida */

/** @param {HTMLElement} destino @param {string} texto */
function parrafo(destino, texto) {
  const nodo = document.createElement('p');
  nodo.textContent = texto;
  destino.append(nodo);
}
/**
 * Solo una abandonada por `rechazo-previo` que no es ya un reintento, y mientras siga la oportunidad, se vuelve a
 * intentar sola.
 * @param {ReintentoObservado} reintento @returns {string}
 */
function textoDelRechazoPrevio(reintento) {
  // Con el tipo cerrado, un valor del reintento sin texto no compila.
  /** @type {Record<NonNullable<ReintentoObservado>, string>} */
  const textos = {
    previsto: 'panel.activacion.abandono.rechazo-previo',
    'es-reintento': 'panel.activacion.abandono.rechazo-previo-reintento',
    'sin-artefacto': 'panel.activacion.abandono.rechazo-previo-sin-artefacto',
  };
  return reintento === null ? 'panel.activacion.abandono.rechazo-previo-sin-reintento' : textos[reintento];
}
/** Por qué se cerró sin publicar: el error de un rechazo o el motivo de un abandono. */
/** @param {NonNullable<EstadoActivacion['ultimaActivacion']>} activacion @returns {string|null} */
function motivoDelCierre(activacion) {
  if (activacion.error) {
    const errores = {
      candidato_no_verificable: textoPanel('panel.activacion.error.candidato_no_verificable'),
      despliegue_no_admitido: textoPanel('panel.activacion.error.despliegue_no_admitido'),
      servido_distinto: textoPanel('panel.activacion.error.servido_distinto'),
    };
    return errores[activacion.error];
  }
  if (activacion.motivoAbandono) {
    /** @type {Record<MotivoAbandono, string>} */
    const motivos = {
      'a-mano': textoPanel('panel.activacion.abandono.a-mano'),
      'rechazo-previo': textoPanel(textoDelRechazoPrevio(activacion.reintento)),
      'rechazo-proveedor': textoPanel('panel.activacion.abandono.rechazo-proveedor'),
    };
    return motivos[activacion.motivoAbandono];
  }
  return null;
}
/**
 * Una intención detenida no está en curso: dice qué la paró, qué se sirve y qué hacer.
 * @param {MotivoDetenida} motivo @param {ServidoDetenida} servido @returns {string}
 */
function textoDeDetenida(motivo, servido) {
  /** @type {Record<MotivoDetenida, string>} */
  const motivos = {
    'rechazo-previo': textoPanel('panel.activacion.detenida.rechazo-previo'),
    'rechazo-proveedor': textoPanel('panel.activacion.detenida.rechazo-proveedor'),
  };
  // Con el tipo cerrado, un valor de lo servido sin texto no compila.
  /** @type {Record<ServidoDetenida, string>} */
  const servidos = {
    'cursos-nuevo': textoPanel('panel.activacion.detenida.sin-formacion'),
    cambiado: textoPanel('panel.activacion.detenida.cambiado'),
    desconocido: textoPanel('panel.activacion.detenida.desconocido'),
  };
  return `${motivos[motivo]} ${servidos[servido]}`;
}
/** @param {NonNullable<EstadoActivacion['ultimaActivacion']>} activacion @returns {string} */
function textoDeLaFase(activacion) {
  // Con el tipo cerrado, una fase sin texto no compila.
  /** @type {Record<FaseActivacion, string>} */
  const fases = {
    reservada: textoPanel('panel.activacion.fase.reservada'),
    preparada: textoPanel('panel.activacion.fase.preparada'),
    'subiendo-cursos': textoPanel('panel.activacion.fase.subiendo-cursos'),
    'cursos-subida': textoPanel('panel.activacion.fase.cursos-subida'),
    'promoviendo-cursos': textoPanel('panel.activacion.fase.promoviendo-cursos'),
    'cursos-confirmado': textoPanel('panel.activacion.fase.cursos-confirmado'),
    subiendo: textoPanel('panel.activacion.fase.subiendo'),
    subida: textoPanel('panel.activacion.fase.subida'),
    promoviendo: textoPanel('panel.activacion.fase.promoviendo'),
    confirmada: textoPanel('panel.activacion.fase.confirmada'),
    rechazada: textoPanel('panel.activacion.fase.rechazada'),
    abandonada: textoPanel('panel.activacion.fase.abandonada'),
  };
  // Con dos servicios, en las fases del principal la formación figura como no disponible hasta confirmar.
  /** @type {Record<FasePrincipalEnCurso, string>} */
  const deDosServicios = {
    subiendo: textoPanel('panel.activacion.fase-dos-servicios.subiendo'),
    subida: textoPanel('panel.activacion.fase-dos-servicios.subida'),
    promoviendo: textoPanel('panel.activacion.fase-dos-servicios.promoviendo'),
  };
  const fase = activacion.fase;
  if (activacion.motivoDetenida) {
    return textoDeDetenida(activacion.motivoDetenida, activacion.servidoDetenida ?? 'cambiado');
  }
  return activacion.dosServicios && esFasePrincipalEnCurso(fase) ? deDosServicios[fase] : fases[fase];
}
/**
 * @param {HTMLElement} destino @param {EstadoActivacion|null} estado
 * @param {import('./vista-cierre.js').AccionesActivacion} [acciones]
 */
export function mostrarEstadoActivacion(destino, estado, acciones = {}) {
  destino.replaceChildren();
  if (!estado) {
    parrafo(destino, textoPanel('panel.activacion.consulta-inicial'));
    return;
  }
  const activacion = estado.ultimaActivacion;
  if (!activacion) {
    parrafo(destino, textoPanel('panel.activacion.sin-registro'));
    return;
  }
  parrafo(destino, textoDeLaFase(activacion));
  if (activacion.reintento === 'es-reintento' && activacion.fase !== 'abandonada') {
    parrafo(destino, textoPanel('panel.activacion.reintento'));
  }
  const terminal = ['confirmada', 'rechazada', 'abandonada'].includes(activacion.fase);
  if (activacion.datosSinPublicarDesde !== null) {
    parrafo(
      destino,
      // Que la web sigue mostrando lo anterior solo es seguro con la intención terminada.
      textoPanel(terminal ? 'panel.activacion.sin-publicar' : 'panel.activacion.sin-publicar-reintento', {
        v0: fechaConUtc(activacion.datosSinPublicarDesde),
      }),
    );
  }
  const detalle = detallesDelRegistro(destino, { revision: estado.revision, ...activacion });
  parrafo(detalle, textoPanel('panel.solicitud-id', { v0: activacion.solicitudId }));
  parrafo(
    detalle,
    textoPanel('panel.activacion.fechas', {
      v0: fechaConUtc(activacion.creadoEn),
      v1: fechaConUtc(activacion.actualizadoEn),
    }),
  );
  if (activacion.versionId) {
    parrafo(detalle, textoPanel('panel.activacion.version', { v0: activacion.versionId }));
  }
  if (activacion.deploymentId) {
    parrafo(detalle, textoPanel('panel.activacion.despliegue', { v0: activacion.deploymentId }));
  }
  const motivo = motivoDelCierre(activacion);
  if (motivo) {
    parrafo(destino, motivo);
  }
  mostrarCierre(destino, activacion, acciones);
  parrafo(destino, textoPanel('panel.activacion.limite'));
}
