// Resumen del servicio por tema: sale solo de las lecturas que ya tiene el cliente y nunca da por bueno lo que no se
// ha observado. Lo que el servidor no ofrece (la versión que se sirve ahora) se muestra como «sin comprobar».
import { texto } from '../scripts/textos.js';
import { fechaPanel } from './fechas-panel.js';
import { mostrarRevisiones } from './revisiones-panel.js';
import { ESTADOS_SALUD, NOMBRES_TEMAS, resumirSaludDatos } from './salud-datos.js';

/** @typedef {import('./cliente.js').EstadoClientePanel} EstadoClientePanel */
/** @typedef {Extract<EstadoClientePanel,{estado:'activa'}>} EstadoActivo */
/** @typedef {import('./salud-datos.js').EstadoSalud} EstadoSalud */
/** @typedef {import('./salud-datos.js').SaludFuente} SaludFuente */
/** @typedef {'ninguna'|'actualizar'|'equipo'|'esperar'|'consultar'|'revisar-publicacion'} Accion */
/** @typedef {Readonly<{forma:string,tono:string,texto:string}>} Indicador */
/** @typedef {Readonly<{titulo:string,indicador:Indicador,datos:readonly Readonly<[string,string]>[],causa:string,accion:string,enlace?:Readonly<{href:string,texto:string}>}>} FilaServicio */

const t = (/** @type {string} */ clave, /** @type {Record<string,string|number>} */ valores = {}) =>
  texto(`panel.servicio.${clave}`, valores);
/** Qué hacer ante cada estado observado; un estado sin evidencia nunca lleva a «no hace falta hacer nada».
 * @type {Readonly<Record<EstadoSalud,Accion>>} */
const ACCION_POR_ESTADO = Object.freeze({
  atencion: 'equipo',
  incidencia: 'actualizar',
  pendiente: 'actualizar',
  revision: 'equipo',
  'sin-observacion': 'equipo',
  local: 'ninguna',
  comprobada: 'ninguna',
  candidata: 'ninguna',
  externa: 'ninguna',
  'productor-local': 'ninguna',
});

/** @param {EstadoSalud} estado @returns {Indicador} */
function indicadorDe(estado) {
  const { forma, tono } = ESTADOS_SALUD[estado];
  return { forma, tono, texto: texto(`panel.salud.estado.${estado}`) };
}
/** @param {string|null} fecha @param {number} ahora */
function fechaOSinComprobar(fecha, ahora) {
  return fecha === null ? t('sin-comprobar') : fechaPanel(fecha, ahora);
}
/** La fecha más reciente de una lista de instantes ISO; las cadenas no válidas no cuentan. @param {(string|null)[]} fechas */
function masReciente(fechas) {
  /** @type {string|null} */
  let mejor = null;
  for (const fecha of fechas) {
    if (
      fecha !== null &&
      Number.isFinite(Date.parse(fecha)) &&
      (mejor === null || Date.parse(fecha) > Date.parse(mejor))
    ) {
      mejor = fecha;
    }
  }
  return mejor;
}
/** @param {readonly SaludFuente[]} fuentes @param {number} ahora */
function ultimoIntento(fuentes, ahora) {
  const fecha = masReciente(fuentes.map((f) => f.ultimaConsulta));
  const fuente = fuentes.find((f) => f.ultimaConsulta === fecha);
  if (fecha === null || !fuente) {
    return t('sin-intento');
  }
  const resultado = fuente.resultadoConsulta
    ? texto(`panel.datos.operacion.${fuente.resultadoConsulta}`)
    : t('sin-resultado');
  return t('intento', { fecha: fechaPanel(fecha, ahora), resultado });
}
/** @param {readonly SaludFuente[]} fuentes @param {EstadoSalud} estado */
function causaDelTema(fuentes, estado) {
  const afectadas = fuentes.filter((f) => f.estado === estado).map((f) => f.nombre);
  return t(`causa.${estado}`, { fuentes: afectadas.join(', ') });
}
/** @param {{tema:string,fuentes:readonly SaludFuente[],estado:EstadoSalud}} tema @param {number} ahora @returns {FilaServicio} */
function filaDeTema(tema, ahora) {
  const nombre = /** @type {Record<string,string>} */ (NOMBRES_TEMAS)[tema.tema]
    ? texto(`panel.tema.${tema.tema}`)
    : tema.tema;
  const valida = masReciente(tema.fuentes.flatMap((f) => f.comprobaciones.map((c) => c.fecha)));
  return {
    titulo: nombre,
    indicador: indicadorDe(tema.estado),
    datos: [
      [t('ultimo-intento'), ultimoIntento(tema.fuentes, ahora)],
      [t('ultima-valida'), fechaOSinComprobar(valida, ahora)],
    ],
    causa: causaDelTema(tema.fuentes, tema.estado),
    accion: t(`accion.${ACCION_POR_ESTADO[tema.estado]}`),
    // El detalle por fuente ya está en el apartado Fuentes; la fila lleva hasta él en lugar de repetir la tabla.
    enlace: { href: '#panel-fuentes', texto: t('ver-detalle', { tema: nombre }) },
  };
}
/** Forma, tono y texto de la fila de publicación; ninguno se concede sin una lectura que lo respalde.
 * @type {Readonly<Record<'al-dia'|'pendiente'|'en-curso'|'atencion'|'sin-comprobar'|'solo-ultima',Readonly<{forma:string,tono:string}>>>} */
const INDICADORES_PUBLICACION = Object.freeze({
  'al-dia': { forma: '●', tono: 'verde' },
  pendiente: { forma: '▲', tono: 'ambar' },
  'en-curso': { forma: '▲', tono: 'ambar' },
  atencion: { forma: '■', tono: 'rojo' },
  'sin-comprobar': { forma: '○', tono: 'neutro' },
  'solo-ultima': { forma: '○', tono: 'neutro' },
});
/** @param {keyof typeof INDICADORES_PUBLICACION} clave @returns {Indicador} */
function indicadorDePublicacion(clave) {
  return { ...INDICADORES_PUBLICACION[clave], texto: t(`indicador.${clave}`) };
}
/** @typedef {{texto:string,indicador:keyof typeof INDICADORES_PUBLICACION,accion:Accion}} DatosNuevos */
/** El servidor solo da el último trabajo: si no preparó datos, no se sabe si unos anteriores quedaron sin publicar,
 * así que nunca se dice «nada pendiente».
 * @param {string} resultado @param {string} fecha @returns {DatosNuevos} */
function sinDatosNuevos(resultado, fecha) {
  const soloUltima = t('nuevos.solo-ultima');
  if (resultado === 'sin-pendientes' || resultado === 'retirado') {
    // Retirar una solicitud lo decide la persona: no es un fallo y no se pinta como tal.
    const clave = resultado === 'retirado' ? 'nuevos.retirado' : 'nuevos.sin-cambios';
    return {
      texto: `${t(clave, { fecha })} ${soloUltima}`,
      indicador: 'solo-ultima',
      accion: 'revisar-publicacion',
    };
  }
  return { texto: `${t('nuevos.sin-datos', { fecha })} ${soloUltima}`, indicador: 'atencion', accion: 'equipo' };
}
/** Datos nuevos y publicación: se cruzan el último trabajo y el registro de publicación de la misma solicitud.
 * @param {EstadoActivo} estado @param {number} ahora @returns {DatosNuevos} */
function datosNuevos(estado, ahora) {
  if (!estado.trabajos) {
    return { texto: t('nuevos.sin-lectura'), indicador: 'sin-comprobar', accion: 'consultar' };
  }
  const trabajo = estado.trabajos.ultimoTrabajo;
  if (!trabajo) {
    return { texto: t('nuevos.ninguno'), indicador: 'al-dia', accion: 'ninguna' };
  }
  if (trabajo.estado !== 'terminado' || !trabajo.resultado) {
    return {
      texto: t('nuevos.en-curso', { fecha: fechaPanel(trabajo.creadoEn, ahora) }),
      indicador: 'en-curso',
      accion: 'esperar',
    };
  }
  const fecha = fechaPanel(trabajo.resultado.terminadoEn, ahora);
  if (trabajo.resultado.resultado !== 'validado') {
    return sinDatosNuevos(trabajo.resultado.resultado, fecha);
  }
  if (!estado.activacion) {
    return { texto: t('nuevos.preparados-sin-comprobar', { fecha }), indicador: 'sin-comprobar', accion: 'consultar' };
  }
  const publicacion = estado.activacion.ultimaActivacion;
  if (publicacion?.solicitudId !== trabajo.solicitudId) {
    return { texto: t('nuevos.pendientes', { fecha }), indicador: 'pendiente', accion: 'equipo' };
  }
  if (publicacion.fase === 'confirmada') {
    const publicados = fechaPanel(publicacion.actualizadoEn, ahora);
    return { texto: t('nuevos.publicados', { fecha, publicados }), indicador: 'al-dia', accion: 'ninguna' };
  }
  if (publicacion.fase === 'rechazada') {
    return { texto: t('nuevos.rechazados', { fecha }), indicador: 'atencion', accion: 'equipo' };
  }
  return { texto: t('nuevos.publicandose', { fecha }), indicador: 'en-curso', accion: 'esperar' };
}
/** @param {EstadoActivo} estado @param {number} ahora */
function ultimaPublicacion(estado, ahora) {
  if (!estado.activacion) {
    return t('sin-comprobar');
  }
  const registro = estado.activacion.ultimaActivacion;
  if (!registro) {
    return t('publicacion.ninguna');
  }
  return t('publicacion.registrada', {
    fase: texto(`panel.tablero.activacion.${registro.fase}`),
    fecha: fechaPanel(registro.actualizadoEn, ahora),
  });
}
/** @param {EstadoActivo} estado @param {number} ahora @returns {FilaServicio} */
function filaDePublicacion(estado, ahora) {
  const nuevos = datosNuevos(estado, ahora);
  return {
    titulo: t('publicacion.titulo'),
    indicador: indicadorDePublicacion(nuevos.indicador),
    datos: [
      [t('nuevos.etiqueta'), nuevos.texto],
      [t('publicacion.etiqueta'), ultimaPublicacion(estado, ahora)],
      // El servidor no ofrece una lectura de la versión que se sirve; no se deduce del registro de publicación.
      [t('servida.etiqueta'), t('servida.sin-comprobar')],
    ],
    causa: nuevos.texto,
    accion: t(`accion.${nuevos.accion}`),
  };
}

/** Filas del apartado Servicio. Sin sesión activa o sin lecturas no hay filas que afirmen nada.
 * @param {EstadoClientePanel} estado @param {number} [ahora] @returns {readonly FilaServicio[]} */
export function resumirServicio(estado, ahora = Date.now()) {
  if (estado.estado !== 'activa') {
    return [];
  }
  /** @type {FilaServicio[]} */
  const filas = [];
  if (estado.datos) {
    const salud = resumirSaludDatos(estado.datos);
    filas.push(...salud.temas.map((tema) => filaDeTema(tema, ahora)));
  } else {
    filas.push({
      titulo: t('fuentes.titulo'),
      indicador: indicadorDePublicacion('sin-comprobar'),
      datos: [],
      causa: t('fuentes.sin-lectura'),
      accion: t('accion.consultar'),
    });
  }
  filas.push(filaDePublicacion(estado, ahora));
  return filas;
}
/** Sin conexión no hay lectura: se dice, igual que en «Revisiones que tocan», en lugar de dejar el apartado vacío.
 * @returns {FilaServicio} */
function filaSinConexion() {
  return {
    titulo: t('fuentes.titulo'),
    indicador: indicadorDePublicacion('sin-comprobar'),
    datos: [],
    causa: t('sin-conexion'),
    accion: t('accion.consultar'),
  };
}
/** @param {FilaServicio} fila */
function crearFila(fila) {
  const nodo = document.createElement('article');
  nodo.className = `panel-servicio-fila panel-servicio--${fila.indicador.tono}`;
  const titulo = document.createElement('h4');
  titulo.textContent = fila.titulo;
  const indicador = document.createElement('p');
  indicador.className = 'panel-servicio-indicador';
  const forma = document.createElement('span');
  forma.className = 'panel-servicio-forma';
  forma.setAttribute('aria-hidden', 'true');
  forma.textContent = fila.indicador.forma;
  indicador.append(forma, ` ${fila.indicador.texto}`);
  const lista = document.createElement('dl');
  for (const [etiqueta, valor] of fila.datos) {
    const termino = document.createElement('dt');
    termino.textContent = etiqueta;
    const dato = document.createElement('dd');
    dato.textContent = valor;
    lista.append(termino, dato);
  }
  const causa = document.createElement('p');
  causa.className = 'panel-servicio-causa';
  causa.textContent = fila.causa;
  const accion = document.createElement('p');
  accion.className = 'panel-servicio-accion';
  accion.textContent = t('que-hacer', { accion: fila.accion });
  nodo.append(titulo, indicador, lista, causa, accion);
  if (fila.enlace) {
    const enlace = document.createElement('a');
    enlace.setAttribute('href', fila.enlace.href);
    enlace.textContent = fila.enlace.texto;
    const parrafo = document.createElement('p');
    parrafo.append(enlace);
    nodo.append(parrafo);
  }
  return nodo;
}
/** Solo se repinta si cambia lo mostrado, para no repetir lo mismo al lector de pantalla en cada comprobación.
 * @param {EstadoClientePanel} estado @param {boolean} sinConexion */
export function mostrarServicio(estado, sinConexion) {
  mostrarRevisiones(estado, sinConexion);
  const destino = document.getElementById('servicio-temas');
  if (!destino) {
    return;
  }
  const filas = sinConexion ? [filaSinConexion()] : resumirServicio(estado);
  const firma = JSON.stringify(filas);
  if (destino.dataset.servicio === firma) {
    return;
  }
  destino.dataset.servicio = firma;
  destino.replaceChildren(...filas.map(crearFila));
}
