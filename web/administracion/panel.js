import { textoAviso } from './avisos-panel.js';
import { DIAGNOSTICO_CLASIFICACION } from './clasificacion-catalogo.js';
import { confirmarCambio, resumenCambioControles, resumenCambioSecciones } from './confirmacion-cambios.js';
import { crearDeshacer } from './deshacer-cambio.js';
import { vigilarGestos } from './gestos-panel.js';
import { repintarConservando } from './retraduccion-panel.js';
import { mostrarSeguimiento } from './seguimiento-panel.js';
import { crearVistaAccesos } from './vista-accesos.js';
import { crearVistaClasificacion } from './vista-clasificacion.js';
import { crearVistaInstituciones } from './vista-instituciones.js';
import { crearVistaOcultas } from './vista-ocultas.js';
import './sitio.js';
import './navegacion-panel.js';
import { alCambiarIdioma } from '../scripts/idioma.js';
import { resolver, texto as textoPanel, traducible } from '../scripts/textos.js';
/** Vista del panel: el cliente conserva la sesión; esta capa solo muestra estados confirmados. */

import { leerPoliticaSecciones } from '../scripts/secciones-contrato.js';
import { escucharActividad } from './actividad-panel.js';
import { crearApartadoEncuesta } from './apartado-encuesta.js';
import { crearArmazon } from './armazon-panel.js';
import { abrirPanelYConsultar, consultarCapacidades } from './capacidades.js';
import { crearClientePanel } from './cliente.js';
import { SECCIONES_DEL_APARTADO } from './secciones-del-panel.js';
import { mostrarServicio } from './servicio-panel.js';
import { mostrarEstadoActivacion } from './vista-activacion.js';
import { mostrarFuentes } from './vista-fuentes.js';
import { detalleDeSolicitud, mostrarEstadoTrabajos, trabajoPendiente } from './vista-trabajos.js';
import { crearVistaVigilante } from './vista-vigilante.js';

/** @typedef {import('./cliente.js').EstadoClientePanel} EstadoClientePanel */
/** @typedef {import('../scripts/secciones-contrato.js').PoliticaSecciones} PoliticaSecciones */
/** @typedef {import('../../src/administracion/controles.ts').DocumentoControles} DocumentoControles */
/** @typedef {import('../../src/administracion/controles.ts').PoliticaControles} PoliticaControles */

const SONDEO_MS = 5000;
const ACTIVIDAD_MS = 60000;
const MAX_CONSULTAS_TRABAJO = 12;

/** @template {HTMLElement} T @param {string} id @param {{new(...args: never[]): T}} tipo @returns {T} */
function elemento(id, tipo) {
  const encontrado = document.getElementById(id);
  if (!(encontrado instanceof tipo)) {
    throw new Error(`Falta un elemento del panel: ${id}`);
  }
  return encontrado;
}
const vista = {
  estado: elemento('estado', HTMLParagraphElement),
  reconectar: elemento('reconectar', HTMLButtonElement),
  controles: elemento('controles', HTMLElement),
  campos: elemento('campos', HTMLFieldSetElement),
  revision: elemento('revision', HTMLParagraphElement),
  api: elemento('api', HTMLInputElement),
  guardar: elemento('guardar', HTMLButtonElement),
  consultarControles: elemento('consultar-controles', HTMLButtonElement),
  estadoRevisionControles: elemento('estado-revision-controles', HTMLParagraphElement),
  datos: elemento('datos', HTMLElement),
  consultarDatos: elemento('consultar-datos', HTMLButtonElement),
  estadoDatos: elemento('estado-datos', HTMLElement),
  retenidos: elemento('retenidos-datos', HTMLElement),
  retenidosLista: elemento('retenidos-lista', HTMLElement),
  trabajos: elemento('trabajos', HTMLElement),
  consultarTrabajo: elemento('consultar-trabajo', HTMLButtonElement),
  actualizarDatos: elemento('actualizar-datos', HTMLButtonElement),
  reintentarPendientes: elemento('reintentar-pendientes', HTMLButtonElement),
  retirarTrabajo: elemento('retirar-trabajo', HTMLButtonElement),
  reconciliarTrabajo: elemento('reconciliar-trabajo', HTMLButtonElement),
  estadoTrabajos: elemento('estado-trabajos', HTMLElement),
  seguimientoTrabajo: elemento('seguimiento-trabajo', HTMLParagraphElement),
  activacion: elemento('activacion', HTMLElement),
  consultarActivacion: elemento('consultar-activacion', HTMLButtonElement),
  estadoActivacion: elemento('estado-activacion', HTMLElement),
};
const vistaSecciones = {
  raiz: elemento('secciones', HTMLElement),
  consultar: elemento('consultar-secciones', HTMLButtonElement),
  estado: elemento('estado-secciones', HTMLParagraphElement),
  campos: elemento('campos-secciones', HTMLFieldSetElement),
  guardar: elemento('guardar-secciones', HTMLButtonElement),
};
// Las secciones sin interruptor en este apartado (la Encuesta, que lo tiene en el suyo, y las que no tienen páginas)
// conservan al guardar el valor que se consultó, sin que el panel lo cambie.
const camposSecciones = SECCIONES_DEL_APARTADO.map(({ id }) => ({
  id,
  campo: elemento(`seccion-${id}`, HTMLInputElement),
}));
let revisionSeccionesMostrada = -1;
/** La política de la revisión mostrada: de ella salen, al guardar, las claves sin interruptor.
 * @type {PoliticaSecciones | null}
 */
let seccionesMostradas = null;
let borradorSecciones = false;
let borradorControles = false;
const interruptores = Object.fromEntries(['mcp', 'a2a'].map((id) => [id, elemento(id, HTMLInputElement)]));
let revisionMostrada = -1;
let ultimaActividad = 0;
let huboActividad = false;
let sinConexion = !navigator.onLine;
let activa = false;
const gestos = vigilarGestos(() => activa && !sinConexion && !document.hidden);
/** @type {import('../scripts/textos.js').Traducible|null} */
let avisoPersistente = null;
let consultasRestantes = MAX_CONSULTAS_TRABAJO;
let turnoTrabajo = false;
let trabajoMostrado = '';
/** @type {import('../../src/administracion/trabajos.ts').EstadoTrabajos|null} */
let trabajosMostrados = null;
/** @type {import('./estado-datos.js').EstadoDatosPanel|null} */
let datosMostrados = null;
/** @type {import('./estado-activacion.js').EstadoActivacion|null} */
let activacionMostrada = null;
/** @type {import('./cliente-cierre.js').ResultadoCierre|null} */
let resultadoCierre = null;
/** @type {EstadoClientePanel | null} */
let ultimoEstado = null;
const ocultas = crearVistaOcultas((tipo, pagina) => cliente.consultarOcultas(tipo, pagina));
const clasificacion = crearVistaClasificacion(DIAGNOSTICO_CLASIFICACION);
const accesos = crearVistaAccesos((pagina) => cliente.consultarAccesos(pagina));
const deshacer = crearDeshacer({
  boton: elemento('deshacer', HTMLButtonElement),
  aviso: elemento('estado-deshacer', HTMLParagraphElement),
  // Deshacer se pinta como cualquier guardado confirmado: los interruptores se repintan con lo que confirme el servidor.
  aplicar: (tipo, politica) => {
    revisionMostrada = -1;
    revisionSeccionesMostrada = -1;
    avisoPersistente = null;
    if (tipo === 'controles') {
      void cliente.cambiar(/** @type {PoliticaControles} */ (/** @type {unknown} */ (politica)));
    } else {
      void cliente.cambiarSecciones(leerPoliticaSecciones(/** @type {PoliticaSecciones} */ (politica)));
    }
  },
});
// La visibilidad de la Encuesta cambia la misma política que el apartado «Secciones», y se deshace igual.
const encuesta = crearApartadoEncuesta({
  cliente: () => cliente,
  contenedor: elemento('vista-encuesta-visibilidad', HTMLElement),
  cambiarSecciones: (anterior, politica) => enviarSecciones(anterior, politica),
});
const instituciones = crearVistaInstituciones({
  consultarInstituciones: () => cliente.consultarInstituciones(),
  invitarInstitucion: (entrada) => cliente.invitarInstitucion(entrada),
  renovarInvitacion: (id) => cliente.renovarInvitacion(id),
  retirarInstitucion: (id) => cliente.retirarInstitucion(id),
  retirarClaveInstitucion: (id, claveId) => cliente.retirarClaveInstitucion(id, claveId),
  descartarInvitacion: () => cliente.descartarInvitacion(),
});
let capacidades = { controles: false, actualizacion: false, vigilante: false };
/** @type {ReturnType<typeof crearVistaVigilante>|null} */
let vigilante = null;
const { inicio, sesion, administradores } = crearArmazon({
  cliente: () => cliente,
  abrir: abrirSesion,
  repintar: () => ultimoEstado && mostrar(ultimoEstado),
  libre: () => ultimoEstado?.estado === 'activa' && !ultimoEstado.ocupado && !sinConexion,
  elemento: (id) => elemento(id, HTMLElement),
});
let cliente = crearClientePanel({ alCambiar: mostrar });
vigilante = crearVistaVigilante(cliente);
consultarCapacidades((dato) => {
  capacidades = dato;
  if (ultimoEstado) {
    mostrar(ultimoEstado);
  }
});

/** @param {string} nombre @returns {HTMLInputElement} */
function interruptor(nombre) {
  const campo = interruptores[nombre];
  if (!campo) {
    throw new Error('Control administrativo desconocido');
  }
  return campo;
}
/** @param {DocumentoControles} controles */
function mostrarControles(controles) {
  vista.revision.textContent = textoPanel('panel.revision');
  if (controles.revision === revisionMostrada) {
    return;
  }
  revisionMostrada = controles.revision;
  vista.api.checked = controles.api === 'habilitada';
  interruptor('mcp').checked = controles.mcp;
  interruptor('a2a').checked = controles.a2a;
}
function retirarSecciones() {
  vistaSecciones.raiz.hidden = true;
  vistaSecciones.campos.disabled = true;
  vistaSecciones.campos.hidden = true;
  vistaSecciones.consultar.disabled = true;
  vistaSecciones.guardar.disabled = true;
  vistaSecciones.estado.textContent = '';
  for (const { campo } of camposSecciones) {
    campo.checked = false;
  }
  revisionSeccionesMostrada = -1;
  seccionesMostradas = null;
  borradorSecciones = false;
  borradorControles = false;
  vista.consultarControles.disabled = true;
  vista.estadoRevisionControles.textContent = '';
}
function retirarControles() {
  clasificacion.retirar();
  vigilante?.retirar();
  instituciones.retirar();
  ocultas.retirar();
  accesos.retirar();
  encuesta.retirar();
  gestos.terminar();
  retirarSecciones();
  vista.controles.hidden = true;
  vista.campos.disabled = true;
  vista.api.checked = false;
  for (const campo of Object.values(interruptores)) {
    campo.checked = false;
  }
  vista.revision.textContent = '';
  revisionMostrada = -1;
  vista.datos.hidden = true;
  datosMostrados = null;
  mostrarFuentes(vista, null);
  vista.consultarDatos.disabled = true;
  vista.trabajos.hidden = true;
  vista.consultarTrabajo.disabled = true;
  vista.actualizarDatos.disabled = true;
  vista.reintentarPendientes.disabled = true;
  vista.retirarTrabajo.disabled = true;
  vista.reconciliarTrabajo.disabled = true;
  trabajosMostrados = null;
  trabajoMostrado = '';
  vista.estadoTrabajos.replaceChildren();
  vista.seguimientoTrabajo.textContent = '';
  vista.activacion.hidden = true;
  vista.consultarActivacion.disabled = true;
  activacionMostrada = null;
  vista.estadoActivacion.replaceChildren();
}
/** @param {EstadoClientePanel} estado @returns {string} */
function mensaje(estado) {
  if (estado.estado === 'sustituida') {
    return textoAviso('sesion_sustituida');
  }
  if (estado.aviso && textoAviso(estado.aviso)) {
    return textoAviso(estado.aviso) ?? '';
  }
  if (estado.estado === 'activa') {
    if (avisoPersistente) {
      return resolver(avisoPersistente);
    }
    return estado.ocupado ? textoPanel('panel.sesion.comprobando') : textoPanel('panel.sesion.activa');
  }
  const textos = {
    inicial: textoPanel('panel.sesion.inicial'),
    cargando: textoPanel('panel.sesion.cargando'),
    cerrada: textoPanel('panel.sesion.cerrada'),
    caducada: textoPanel('panel.sesion.caducada'),
    error: textoPanel('panel.sesion.error'),
    desconectada: textoPanel('panel.sesion.desconectada'),
  };
  return textos[estado.estado];
}
/** El sondeo no debe borrar un aviso que la persona todavía tiene que revisar. @param {EstadoClientePanel} estado */
function recordarAviso(estado) {
  if (estado.estado !== 'activa') {
    avisoPersistente = null;
  } else if (!estado.ocupado && estado.aviso) {
    avisoPersistente = traducible(`panel.aviso.${estado.aviso}`);
  }
}
/** @param {EstadoClientePanel} estado */
function mostrar(estado) {
  ultimoEstado = estado;
  mostrarServicio(estado, sinConexion);
  encuesta.mostrar(estado, sinConexion);
  deshacer.observar(estado);
  const estabaActiva = activa;
  activa = estado.estado === 'activa';
  recordarAviso(estado);
  vista.estado.textContent = sinConexion ? textoAviso('sin_conexion') : mensaje(estado);
  vista.reconectar.hidden = estado.estado !== 'desconectada';
  vista.reconectar.disabled = sinConexion;
  sesion.mostrar(estado);
  administradores.alCambiarEstado();
  if (estado.estado === 'activa' && !sinConexion) {
    inicio.mostrar(estado, { idSesion: sesion.idSesion, avisos: vigilante?.situacionAvisos() ?? null });
    mostrarControlesActivos(estado);
    instituciones.mostrar(estado);
    ocultas.mostrar(estado);
    accesos.mostrar(estado);
    mostrarSecciones(estado);
    mostrarDatos(estado);
    vigilante?.mostrar(capacidades.vigilante, estado.ocupado, estado.aviso);
    mostrarTrabajos(estado);
    mostrarActivacion(estado);
  } else {
    retirarControles();
  }
  if (estabaActiva && !activa) {
    vista.estado.focus();
  }
}
/** @param {Extract<EstadoClientePanel,{estado:'activa'}>} estado */
function mostrarControlesActivos(estado) {
  vista.controles.hidden = false;
  vista.campos.disabled = !capacidades.controles || estado.ocupado || !!estado.controlesPendientes;
  vista.guardar.disabled = vista.campos.disabled;
  vista.consultarControles.disabled = estado.ocupado;
  vista.estadoRevisionControles.textContent = estado.controlesPendientes
    ? textoPanel('panel.controles.pendientes')
    : '';
  if (!capacidades.controles) {
    vista.estadoRevisionControles.textContent = textoPanel('panel.controles.no_disponibles');
  }
  if (!estado.controlesPendientes) {
    mostrarControles(estado.controles);
  }
}

/** @param {Extract<EstadoClientePanel,{estado:'activa'}>} estado */
function mostrarSecciones(estado) {
  vistaSecciones.raiz.hidden = false;
  vistaSecciones.consultar.disabled = estado.ocupado;
  const documento = estado.secciones;
  vistaSecciones.campos.disabled = estado.ocupado || !documento || !!estado.seccionesPendientes;
  vistaSecciones.campos.hidden = !documento && !borradorSecciones;
  vistaSecciones.guardar.disabled = vistaSecciones.campos.disabled;
  if (documento && !estado.seccionesPendientes && documento.revision !== revisionSeccionesMostrada) {
    for (const { id, campo } of camposSecciones) {
      campo.checked = documento.secciones[id];
    }
    revisionSeccionesMostrada = documento.revision;
    seccionesMostradas = documento.secciones;
    borradorSecciones = false;
  }
  vistaSecciones.estado.textContent = textoSecciones(estado);
}
/** @param {Extract<EstadoClientePanel,{estado:'activa'}>} estado */
function textoSecciones(estado) {
  if (estado.avisoSecciones) {
    return textoAviso(estado.avisoSecciones);
  }
  if (estado.secciones && !estado.seccionesPendientes) {
    return textoPanel('panel.secciones.confirmadas', { revision: estado.secciones.revision });
  }
  return textoPanel('panel.secciones.pendientes');
}
function consultarSecciones() {
  if (vistaSecciones.consultar.disabled || vistaSecciones.raiz.hidden) {
    return;
  }
  if (borradorSecciones && !window.confirm(textoPanel('panel.secciones.reemplazar'))) {
    return;
  }
  borradorSecciones = false;
  revisionSeccionesMostrada = -1;
  avisoPersistente = null;
  void cliente.consultarSecciones();
}
function guardarSecciones() {
  if (
    vistaSecciones.guardar.disabled ||
    vistaSecciones.campos.disabled ||
    vistaSecciones.raiz.hidden ||
    !seccionesMostradas
  ) {
    return;
  }
  const politica = { ...seccionesMostradas };
  for (const { id, campo } of camposSecciones) {
    politica[id] = campo.checked;
  }
  if (!confirmarCambio(resumenCambioSecciones(seccionesMostradas, politica))) {
    // Al rechazar el resumen, los interruptores vuelven a lo confirmado y no se envía nada.
    revisionSeccionesMostrada = -1;
    if (ultimoEstado) {
      mostrar(ultimoEstado);
    }
    return;
  }
  enviarSecciones(seccionesMostradas, politica);
}
/** Envía una política de secciones y, si el envío sale, ofrece deshacerlo.
 * @param {PoliticaSecciones} anterior @param {PoliticaSecciones} politica */
function enviarSecciones(anterior, politica) {
  avisoPersistente = null;
  const antes = ultimoEstado;
  void cliente.cambiarSecciones(leerPoliticaSecciones(politica));
  prepararDeshacerSiSale('secciones', anterior, politica, antes);
}
/** Deshacer solo se ofrece si el envío ha salido de verdad: panel libre antes y ocupado en el mismo turno. Un envío
 * que no sale (trabajo en curso, controles por consultar) no deja nada que deshacer ni un cambio que tomar por propio.
 * @param {'controles'|'secciones'} tipo @param {Record<string,unknown>} anterior @param {Record<string,unknown>} enviado
 * @param {EstadoClientePanel|null} antes */
function prepararDeshacerSiSale(tipo, anterior, enviado, antes) {
  const despues = /** @type {EstadoClientePanel|null} */ (ultimoEstado);
  if (antes?.estado === 'activa' && !antes.ocupado && despues?.estado === 'activa' && despues.ocupado) {
    deshacer.preparar(tipo, anterior, enviado, antes);
  }
}

/** @param {Extract<EstadoClientePanel, {estado:'activa'}>} estado */
function mostrarDatos(estado) {
  clasificacion.mostrar(estado.sesion.iniciadaEn);
  vista.datos.hidden = false;
  vista.consultarDatos.disabled = estado.ocupado;
  if (datosMostrados !== estado.datos) {
    datosMostrados = estado.datos;
    mostrarFuentes(vista, estado.datos, estado.datosDeLaActualizacionAnterior);
  }
}
/** @param {Extract<EstadoClientePanel, {estado:'activa'}>} estado */
function mostrarTrabajos(estado) {
  vista.trabajos.hidden = false;
  vista.consultarTrabajo.disabled = estado.ocupado;
  const bloqueado =
    !capacidades.actualizacion ||
    estado.ocupado ||
    !estado.trabajos ||
    trabajoPendiente(estado.trabajos) ||
    estado.aviso === 'revision_trabajos_conflictiva';
  vista.actualizarDatos.hidden = !capacidades.actualizacion;
  vista.reintentarPendientes.hidden = !capacidades.actualizacion;
  vista.retirarTrabajo.hidden = !capacidades.actualizacion;
  vista.reconciliarTrabajo.hidden = !capacidades.actualizacion;
  vista.actualizarDatos.disabled = bloqueado;
  vista.reintentarPendientes.disabled = bloqueado;
  const pendiente = trabajoPendiente(estado.trabajos);
  const recuperacionBloqueada =
    !capacidades.actualizacion || estado.ocupado || !pendiente || estado.aviso === 'revision_trabajos_conflictiva';
  vista.retirarTrabajo.disabled = recuperacionBloqueada;
  vista.reconciliarTrabajo.disabled = recuperacionBloqueada || !estado.trabajos?.ultimoTrabajo?.runId;
  if (trabajosMostrados !== estado.trabajos || !vista.estadoTrabajos.childNodes.length) {
    trabajosMostrados = estado.trabajos;
    mostrarEstadoTrabajos(vista.estadoTrabajos, estado.trabajos);
  }
  const id = estado.trabajos?.ultimoTrabajo?.solicitudId ?? '';
  if (id !== trabajoMostrado) {
    trabajoMostrado = id;
    consultasRestantes = MAX_CONSULTAS_TRABAJO;
  }
  mostrarSeguimiento(vista.seguimientoTrabajo, trabajosMostrados, consultasRestantes);
}
/** @param {Extract<EstadoClientePanel, {estado:'activa'}>} estado */
function mostrarActivacion(estado) {
  vista.activacion.hidden = false;
  vista.consultarActivacion.disabled = estado.ocupado;
  if (activacionMostrada !== estado.activacion || !vista.estadoActivacion.childNodes.length) {
    activacionMostrada = estado.activacion;
    mostrarEstadoActivacion(vista.estadoActivacion, estado.activacion, { cerrar: cerrarPublicacion, resultadoCierre });
  }
}
/** Lo que pasó con la última petición de cierre se dice junto a la activación, que se vuelve a leer después. */
function cerrarPublicacion() {
  void cliente.cerrarPublicacion().then((resultado) => {
    resultadoCierre = resultado;
    activacionMostrada = null;
    return cliente.consultarActivacion();
  });
}
function consultarTrabajo() {
  if (vista.consultarTrabajo.disabled || vista.trabajos.hidden) {
    return;
  }
  avisoPersistente = null;
  consultasRestantes = MAX_CONSULTAS_TRABAJO;
  turnoTrabajo = false;
  void cliente.consultarTrabajo();
}
/** @param {'actualizar-datos'|'reintentar-pendientes'} accion */
function solicitarActualizacion(accion) {
  const boton = accion === 'actualizar-datos' ? vista.actualizarDatos : vista.reintentarPendientes;
  if (boton.disabled || vista.trabajos.hidden) {
    return;
  }
  avisoPersistente = null;
  consultasRestantes = MAX_CONSULTAS_TRABAJO;
  turnoTrabajo = false;
  void cliente.actualizarDatos(accion);
}
/** La confirmación corresponde al trabajo visto, aunque una lectura lo sustituya durante el diálogo.
 * @param {'retirar'|'reconciliar'} accion */
function recuperarTrabajo(accion) {
  const boton = accion === 'retirar' ? vista.retirarTrabajo : vista.reconciliarTrabajo;
  const visto = trabajosMostrados?.ultimoTrabajo;
  if (boton.disabled || vista.trabajos.hidden || !visto) {
    return;
  }
  const detalle = detalleDeSolicitud(visto);
  const pregunta =
    accion === 'retirar'
      ? textoPanel('panel.trabajo.confirmar-retirada', { detalle })
      : textoPanel('panel.trabajo.confirmar-reconciliacion', { detalle });
  if (!window.confirm(pregunta)) {
    return;
  }
  const actual = trabajosMostrados?.ultimoTrabajo;
  if (
    boton.disabled ||
    vista.trabajos.hidden ||
    actual?.solicitudId !== visto.solicitudId ||
    actual?.revisionReserva !== visto.revisionReserva
  ) {
    avisoPersistente = traducible('panel.trabajo.cambiado');
    if (ultimoEstado) {
      mostrar(ultimoEstado);
    }
    return;
  }
  avisoPersistente = null;
  if (accion === 'retirar') {
    void cliente.retirarTrabajo();
  } else {
    void cliente.reconciliarTrabajo();
  }
}
/** La lista cerrada evita enviar campos del documento o del DOM que no pertenecen a la política. @returns {PoliticaControles} */
function politicaElegida() {
  if (ultimoEstado?.estado !== 'activa') {
    throw new Error('No hay controles confirmados para guardar');
  }
  return {
    version: 2,
    api: vista.api.checked ? 'habilitada' : 'deshabilitada',
    mcp: interruptor('mcp').checked,
    a2a: interruptor('a2a').checked,
  };
}
/** Solo una interacción real y visible puede prolongar la sesión; el sondeo no es actividad. @param {Event} evento */
function registrarActividad(evento) {
  if (!evento.isTrusted || !activa || sinConexion || document.hidden) {
    return;
  }
  huboActividad = true;
}
function comprobarVisible() {
  if (document.hidden) {
    gestos.terminar();
    return;
  }
  if (gestos.enCurso()) {
    return;
  }
  if (activa && !sinConexion && !document.hidden && ultimoEstado?.estado === 'activa' && !ultimoEstado.ocupado) {
    const ahora = performance.now();
    if (huboActividad && ahora - ultimaActividad >= ACTIVIDAD_MS) {
      ultimaActividad = ahora;
      huboActividad = false;
      void cliente.mantener();
    } else if (turnoTrabajo && consultasRestantes > 0 && trabajoPendiente(trabajosMostrados)) {
      turnoTrabajo = false;
      consultasRestantes--;
      mostrarSeguimiento(vista.seguimientoTrabajo, trabajosMostrados, consultasRestantes);
      void cliente.consultarTrabajo();
    } else {
      turnoTrabajo = true;
      void cliente.comprobar();
    }
  }
}
/** Retomar la sesión propia llega aquí desde su botón de la bienvenida o al recargar la pestaña que la abrió.
 * @param {boolean} retomar */
function abrirSesion(retomar) {
  const lecturas = { retomar, actualizacion: capacidades.actualizacion };
  return abrirPanelYConsultar(
    cliente,
    () => borradorSecciones,
    () => ultimoEstado,
    lecturas,
  );
}
vista.reconectar.addEventListener('click', () => {
  void cliente.comprobar();
});
vista.guardar.addEventListener('click', () => {
  if (vista.campos.disabled || vista.controles.hidden) {
    return;
  }
  const politica = politicaElegida();
  if (!confirmarCambio(resumenCambioControles(ultimoEstado, politica))) {
    // Como en las secciones: rechazar devuelve los interruptores a lo confirmado y no envía nada.
    revisionMostrada = -1;
    borradorControles = false;
    if (ultimoEstado?.estado === 'activa') {
      mostrarControles(ultimoEstado.controles);
    }
    return;
  }
  avisoPersistente = null;
  borradorControles = false;
  revisionMostrada = -1;
  const antes = ultimoEstado;
  void cliente.cambiar(politica);
  if (antes?.estado === 'activa') {
    const { api, mcp, a2a } = antes.controles;
    prepararDeshacerSiSale('controles', { version: 2, api, mcp, a2a }, { ...politica }, antes);
  }
});
vista.consultarControles.addEventListener('click', () => {
  if (vista.consultarControles.disabled || vista.controles.hidden) {
    return;
  }
  if (borradorControles && !window.confirm(textoPanel('panel.controles.reemplazar'))) {
    return;
  }
  borradorControles = false;
  revisionMostrada = -1;
  avisoPersistente = null;
  void cliente.consultarControles();
});
for (const campo of [vista.api, ...Object.values(interruptores)]) {
  campo.addEventListener('change', () => {
    borradorControles = true;
  });
}
for (const { campo } of camposSecciones) {
  campo.addEventListener('change', () => {
    borradorSecciones = true;
  });
}
vistaSecciones.consultar.addEventListener('click', consultarSecciones);
vistaSecciones.guardar.addEventListener('click', guardarSecciones);
vista.consultarDatos.addEventListener('click', () => {
  if (vista.consultarDatos.disabled || vista.datos.hidden) {
    return;
  }
  avisoPersistente = null;
  void cliente.consultarDatos();
});
vista.consultarTrabajo.addEventListener('click', consultarTrabajo);
vista.retirarTrabajo.addEventListener('click', () => recuperarTrabajo('retirar'));
vista.reconciliarTrabajo.addEventListener('click', () => recuperarTrabajo('reconciliar'));
vista.consultarActivacion.addEventListener('click', () => {
  if (vista.consultarActivacion.disabled || vista.activacion.hidden) {
    return;
  }
  avisoPersistente = null;
  void cliente.consultarActivacion();
});
vista.actualizarDatos.addEventListener('click', () => solicitarActualizacion('actualizar-datos'));
vista.reintentarPendientes.addEventListener('click', () => solicitarActualizacion('reintentar-pendientes'));
escucharActividad(document, registrarActividad);
document.addEventListener('visibilitychange', comprobarVisible);
window.addEventListener('focus', comprobarVisible);
window.addEventListener('offline', () => {
  sinConexion = true;
  retirarControles();
  vista.estado.textContent = textoAviso('sin_conexion');
  vista.reconectar.disabled = true;
  void cliente.comprobar();
});
window.addEventListener('online', () => {
  sinConexion = false;
  if (ultimoEstado && ultimoEstado.estado !== 'activa') {
    mostrar(ultimoEstado);
  }
  void cliente.comprobar();
});
let sondeo = window.setInterval(comprobarVisible, SONDEO_MS);
window.addEventListener('pagehide', () => {
  window.clearInterval(sondeo);
  cliente.destruir();
  activa = false;
  ultimoEstado = null;
  retirarControles();
});
window.addEventListener('pageshow', (evento) => {
  if (evento.persisted) {
    sinConexion = !navigator.onLine;
    huboActividad = false;
    ultimaActividad = performance.now();
    cliente = crearClientePanel({ alCambiar: mostrar });
    sondeo = window.setInterval(comprobarVisible, SONDEO_MS);
    void sesion.consultarBienvenida();
  }
});
void sesion.consultarBienvenida();

alCambiarIdioma(() => {
  sesion.traducir();
  clasificacion.traducir();
  vigilante?.traducir();
  instituciones.traducir();
  ocultas.traducir();
  accesos.traducir();
  encuesta.traducir();
  administradores.traducir();
  const mostrados = datosMostrados;
  const anteriores = ultimoEstado?.estado === 'activa' && ultimoEstado.datosDeLaActualizacionAnterior;
  if (mostrados) {
    repintarConservando(vista.estadoDatos, () => mostrarFuentes(vista, mostrados, anteriores));
  }
  trabajosMostrados = null;
  activacionMostrada = null;
  if (ultimoEstado) {
    mostrar(ultimoEstado);
  }
});
