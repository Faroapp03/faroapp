// Áreas del Inicio del Panel de Control, calculadas solo con lo que el cliente ya ha leído del servidor. Lo que no ha
// llegado se dice «Sin dato»: aquí nunca se supone un estado ni se inventa una cifra.
import { cifra } from '../scripts/cifras.js';
import { SECCIONES_WEB } from '../scripts/secciones-contrato.js';
import { texto } from '../scripts/textos.js';
import { resumirSaludDatos } from './salud-datos.js';
import { horaPanel } from './vista-sesion-unica.js';

/** @typedef {import('./cliente.js').EstadoClientePanel} EstadoClientePanel */
/** @typedef {Extract<EstadoClientePanel,{estado:'activa'}>} EstadoActivo */
/** @typedef {import('./estado-visual.js').TonoEstado} TonoEstado */
/** @typedef {{sinLeer:boolean,disponible:boolean,verificacion:string|null,canalCorreo:string|null}} SituacionAvisos */
/** @typedef {{id:string,nombre:string,tono:TonoEstado,estado:string,detalle:string,cuando:number|null,enlace:string}} Area */
/** @typedef {Readonly<{activos:number,pendientes:number,atencion:readonly string[]}>} ResumenAdministradores */

/** @param {string} clave @param {Record<string,string|number>} [valores] */
const t = (clave, valores) => texto(`panel.inicio.${clave}`, valores);
/** @param {string} id @param {string} enlace @returns {Area} */
function sinDato(id, enlace) {
  return { id, nombre: t(`area.${id}`), tono: 'nada', estado: t('estado.sin-dato'), detalle: '', cuando: null, enlace };
}
/** El área con su estado comprobado: tono, palabra (por su clave), detalle y hora de comprobación.
 * @param {Area} area @param {[TonoEstado, string, string, number|null]} estado */
const con = (area, [tono, palabra, detalle, cuando]) => ({
  ...area,
  tono,
  estado: t(`estado.${palabra}`),
  detalle,
  cuando,
});

/** Cuántas fuentes en uso están bien y cuáles tienen incidencia, por su nombre. @param {EstadoActivo} estado */
export function resumirFuentes(estado) {
  if (!estado.datos) {
    return null;
  }
  const salud = resumirSaludDatos(estado.datos);
  const bien = salud.operativas.filter((f) => f.estado === 'comprobada' || f.estado === 'local');
  const incidencias = salud.operativas.filter((f) => f.estado === 'atencion' || f.estado === 'incidencia');
  return { bien: bien.length, total: salud.operativas.length, incidencias: incidencias.map((f) => f.nombre), salud };
}
/** Los avisos de la regla de retirada de cada fuente, con su nombre: se activó sola o volvió a modo de prueba, y lo
 * que su último ciclo retira por encima del umbral, con su cifra.
 * @param {ReturnType<typeof resumirSaludDatos>} salud */
export function avisosDeRetirada(salud) {
  return salud.operativas.flatMap(({ nombre, retirada, retiradaAmplia }) => [
    ...(retirada ? [t(`retirada.${retirada.cambio}`, { fuente: nombre, decisiones: cifra(retirada.decisiones) })] : []),
    ...(retiradaAmplia ? [avisoDeRetiradaAmplia(nombre, retiradaAmplia)] : []),
  ]);
}
const POR_CIEN = 100;
/** La parte de los cursos leídos que retira, en un porcentaje entero, como la escribe una persona.
 * @param {string} fuente @param {import('./retirada-datos.js').RetiradaAmpliaDatos} amplia */
function avisoDeRetiradaAmplia(fuente, { retiradas, cursos }) {
  const porcentaje = Math.round((POR_CIEN * retiradas) / cursos);
  return t('retirada.amplia', { fuente, retiradas: cifra(retiradas), cursos: cifra(cursos), porcentaje });
}
/** @param {EstadoActivo} estado */
function areaFuentes(estado) {
  const area = sinDato('fuentes', '#apartado-fuentes');
  const resumen = resumirFuentes(estado);
  if (!resumen || !estado.datos) {
    return area;
  }
  const cuando = Date.parse(estado.datos.observadoEn);
  const recuento = t('fuentes-bien', { bien: resumen.bien, total: resumen.total });
  const anterior = estado.datosDeLaActualizacionAnterior ? [t('fuentes-anteriores')] : [];
  const incidencias = resumen.incidencias.length ? [resumen.incidencias.join(', ')] : [];
  const retirada = avisosDeRetirada(resumen.salud);
  const detalle = [...anterior, recuento, ...incidencias, ...retirada].join(' · ');
  const global = resumen.salud.global;
  if (global === 'atencion') {
    return con(area, ['fallo', 'atencion', detalle, cuando]);
  }
  if (global === 'incidencia') {
    return con(area, ['atencion', 'incidencia', detalle, cuando]);
  }
  // Un cambio de modo de la regla de retirada no es una incidencia, pero lo ha de ver quien administra.
  if (retirada.length) {
    return con(area, ['atencion', 'atencion', detalle, cuando]);
  }
  return con(area, [
    resumen.bien === resumen.total ? 'bien' : 'curso',
    resumen.bien === resumen.total ? 'bien' : 'pendiente',
    detalle,
    cuando,
  ]);
}
/**
 * Pasos del paquete que el panel sabe nombrar, por su nombre en el diario del supervisor. Un paso que no está aquí ni
 * es una fuente conocida no se muestra: la frase dice entonces solo la causa.
 */
const PASOS_NOMBRADOS = Object.freeze([
  'paquete',
  'exportar',
  'componer-catalogo',
  'incorporar-globales',
  'preparar-globales',
  'preparar-biblioteca',
  'preparar-informe',
  'cotejar-web',
  'comprobar-datos',
  'sustituir',
]);
/** @param {EstadoActivo} estado @param {string|null} paso @returns {string|null} */
function pasoEnPalabras(estado, paso) {
  if (paso === null) {
    return null;
  }
  if (PASOS_NOMBRADOS.includes(paso)) {
    return t(`trabajo.paso.${paso}`);
  }
  const salud = estado.datos ? resumirSaludDatos(estado.datos) : null;
  const fuente = salud ? [...salud.operativas, ...salud.otras].find((f) => f.id === paso) : undefined;
  return fuente ? t('trabajo.paso.fuente', { fuente: fuente.nombre }) : null;
}
/** Por qué no terminó la última actualización, en palabras. @param {EstadoActivo} estado
 * @param {import('./estado-trabajos.js').UltimoFallo} fallo */
function noTermino(estado, fallo) {
  const causa = t(`trabajo.causa.${fallo.causa}`);
  const paso = pasoEnPalabras(estado, fallo.paso);
  return paso ? t('trabajo.no-termino', { causa, paso }) : t('trabajo.no-termino-sin-paso', { causa });
}
/** @param {EstadoActivo} estado */
function areaActualizacion(estado) {
  const area = sinDato('actualizacion', '#apartado-actualizaciones');
  const trabajo = estado.trabajos?.ultimoTrabajo;
  if (!trabajo) {
    return area;
  }
  if (trabajo.estado !== 'terminado') {
    return con(area, ['curso', 'en-curso', t('desde', { hora: horaPanel(trabajo.creadoEn) }), trabajo.actualizadoEn]);
  }
  const resultado = trabajo.resultado?.resultado;
  if (resultado === 'validado' || resultado === 'sin-pendientes') {
    return con(area, ['bien', 'bien', t(`trabajo.${resultado}`), trabajo.actualizadoEn]);
  }
  if (resultado === 'retirado') {
    return con(area, ['nada', 'retirada', t('trabajo.retirado'), trabajo.actualizadoEn]);
  }
  const fallo = trabajo.resultado?.ultimoFallo;
  return con(area, ['fallo', 'fallo', fallo ? noTermino(estado, fallo) : t('trabajo.fallo'), trabajo.actualizadoEn]);
}
/** @param {EstadoActivo} estado */
function areaPublicados(estado) {
  const area = sinDato('publicados', '#apartado-publicaciones');
  const registro = estado.activacion?.ultimaActivacion;
  if (!registro) {
    return area;
  }
  if (registro.fase === 'confirmada') {
    return con(area, ['bien', 'bien', t('publicacion.confirmada'), registro.actualizadoEn]);
  }
  if (registro.fase === 'rechazada' || registro.fase === 'abandonada') {
    return con(area, ['fallo', 'fallo', t('publicacion.no-completada'), registro.actualizadoEn]);
  }
  return con(area, ['curso', 'en-curso', t('publicacion.en-curso'), registro.actualizadoEn]);
}
/** @param {EstadoActivo} estado @param {number|null} cuando */
function areaWeb(estado, cuando) {
  const area = sinDato('web', '#apartado-secciones');
  if (!estado.secciones) {
    return area;
  }
  const conPaginas = SECCIONES_WEB.filter(({ rutas }) => rutas.length > 0);
  const abiertas = conPaginas.filter(({ id }) => estado.secciones?.secciones[id]).length;
  const detalle = t('secciones-abiertas', { abiertas, total: conPaginas.length });
  return abiertas ? con(area, ['bien', 'abierta', detalle, cuando]) : con(area, ['nada', 'cerrada', detalle, cuando]);
}
/** @param {EstadoActivo} estado @param {number|null} cuando */
function areaConectividad(estado, cuando) {
  const area = sinDato('conectividad', '#apartado-conectividad');
  if (estado.controlesPendientes) {
    return con(area, ['atencion', 'pendiente', t('conexiones-pendientes'), cuando]);
  }
  const { api, mcp, a2a } = estado.controles;
  const activas = Number(api === 'habilitada') + Number(mcp) + Number(a2a);
  const detalle = t('conexiones-activas', { activas });
  return activas ? con(area, ['bien', 'activa', detalle, cuando]) : con(area, ['nada', 'sin-activar', detalle, cuando]);
}
/**
 * Accesos: con la lista de administradores leída, cuántos hay activos y pendientes, y sus avisos de atención; sin ella,
 * si se han consultado las claves de acceso. @param {EstadoActivo} estado
 * @param {ResumenAdministradores|null} administradores @param {(dato:object|null|undefined)=>number|null} recibido
 */
function areaAccesos(estado, administradores, recibido) {
  if (administradores) {
    const { activos, pendientes, atencion } = administradores;
    const detalle = [t('administradores', { activos, pendientes }), ...atencion].join(' · ');
    const tono = atencion.length ? ['atencion', 'pendiente'] : ['bien', 'bien'];
    return con(sinDato('accesos', '#apartado-administradores'), [
      /** @type {TonoEstado} */ (tono[0]),
      /** @type {string} */ (tono[1]),
      detalle,
      recibido(administradores),
    ]);
  }
  const area = sinDato('accesos', '#apartado-claves');
  return estado.accesos ? con(area, ['bien', 'consultado', t('accesos-consultados'), recibido(estado.accesos)]) : area;
}
/** @param {SituacionAvisos|null} avisos @param {number|null} cuando */
function areaAvisos(avisos, cuando) {
  const area = sinDato('avisos', '#apartado-avisos');
  if (!avisos || avisos.sinLeer) {
    return area;
  }
  if (!avisos.disponible || avisos.canalCorreo === 'no-configurado') {
    return con(area, ['nada', 'sin-activar', t('avisos.sin-canal'), cuando]);
  }
  if (avisos.verificacion === 'verificado') {
    return con(area, ['bien', 'bien', t('avisos.verificado'), cuando]);
  }
  return con(area, ['atencion', 'pendiente', t(`avisos.${avisos.verificacion ?? 'sin_destino'}`), cuando]);
}
/**
 * @param {EstadoActivo} estado
 * @param {{idSesion:string|null, avisos:SituacionAvisos|null, administradores?:ResumenAdministradores|null, recibido:(dato:object|null|undefined)=>number|null}} contexto
 * @returns {readonly Area[]}
 */
export function areasDelServicio(estado, contexto) {
  const { recibido } = contexto;
  const panel = con(sinDato('panel', '#apartado-registro'), [
    'bien',
    'abierto',
    contexto.idSesion ? t('panel-sesion', { id: contexto.idSesion }) : t('panel-abierto'),
    estado.sesion.ultimaActividadEn,
  ]);
  return Object.freeze([
    areaFuentes(estado),
    areaActualizacion(estado),
    areaPublicados(estado),
    areaWeb(estado, recibido(estado.secciones)),
    // Los accesos y la encuesta se consultan en su apartado: el Inicio no los lee por su cuenta.
    areaAccesos(estado, contexto.administradores ?? null, recibido),
    panel,
    sinDato('encuesta', '#apartado-encuesta'),
    areaAvisos(contexto.avisos, recibido(contexto.avisos)),
    areaConectividad(estado, recibido(estado.controles)),
  ]);
}
/** Lo grave primero (fallo), después lo que pide atención; lo que está bien o sin dato no se lista. @param {readonly Area[]} areas */
export function requiereAtencion(areas) {
  const peso = { fallo: 0, atencion: 1 };
  return areas
    .filter((a) => a.tono === 'fallo' || a.tono === 'atencion')
    .sort(
      (a, b) => peso[/** @type {'fallo'|'atencion'} */ (a.tono)] - peso[/** @type {'fallo'|'atencion'} */ (b.tono)],
    );
}
