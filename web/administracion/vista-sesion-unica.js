// Vista de la sesión única del Panel de Control: bienvenida, banda de sesión, aviso de cierre y registro de accesos.
// Solo estructura semántica con clases propias y estables, y textos por claves; ningún texto se interpreta como HTML.
// Cada dato de la sesión queda también en un atributo data-* para que el diseño pueda mostrarlo como quiera.
import { horaEscrita, partesEnZona } from '../scripts/fechas.js';
import { texto } from '../scripts/textos.js';
import { marcaEstado } from './estado-visual.js';
import { fechaPanel } from './fechas-panel.js';

/** @typedef {import('../../src/administracion/sesion-unica.ts').BienvenidaPanel} BienvenidaPanel */
/** @typedef {import('../../src/administracion/sesion-unica.ts').FilaRegistroPanel} FilaRegistroPanel */
/** @typedef {import('../../src/administracion/sesion.ts').SesionPanelActiva} SesionPanelActiva */
/** @typedef {import('./estado-visual.js').TonoEstado} TonoEstado */
/**
 * @typedef {object} DatosBanda
 * @property {string} idSesion
 * @property {string} idEntrada
 * @property {string} correo
 * @property {number} entradaEn
 * @property {SesionPanelActiva} sesion
 */
/** @typedef {'cerrada'|'inactividad'|'duracion'|'sustituida'} FinSesion */

/** Dos minutos antes del cierre por inactividad la banda lo dice una vez, sin cuenta atrás. */
export const AVISO_CIERRE_MS = 120_000;

/** Hora de Cataluña en formato de 24 horas, igual en castellano y en catalán. @param {number} instante */
export function horaPanel(instante) {
  return horaEscrita(partesEnZona(instante));
}
/** @param {string} etiqueta @param {string} clase @param {string} [contenido] */
function pieza(etiqueta, clase, contenido) {
  const elemento = document.createElement(etiqueta);
  elemento.className = clase;
  if (contenido !== undefined) {
    elemento.textContent = contenido;
  }
  return elemento;
}
/** @param {string} clase @param {string} accion @param {string} clave */
function boton(clase, accion, clave) {
  const elemento = pieza('button', clase, texto(clave));
  elemento.setAttribute('type', 'button');
  elemento.setAttribute('data-accion', accion);
  return elemento;
}
/** @param {HTMLElement} lista @param {string} clave @param {string} valor */
function dato(lista, clave, valor) {
  lista.append(pieza('dt', 'sesion-unica-dato', texto(clave)), pieza('dd', 'sesion-unica-valor', valor));
}
/** @param {NonNullable<BienvenidaPanel['ocupacion']>} ocupacion */
function textoOcupada(ocupacion) {
  const desde = horaPanel(ocupacion.desde);
  return ocupacion.correo === null
    ? texto('panel.sesion-unica.ocupada-sin-usuario', { desde })
    : texto('panel.sesion-unica.ocupada', { desde, correo: ocupacion.correo });
}
/** La lectura de la derecha: quién ha entrado, con qué entrada y si el panel está libre. @param {BienvenidaPanel} b */
function tuEntrada(b) {
  const columna = pieza('div', 'sesion-unica-entrada');
  columna.append(pieza('p', 'sesion-unica-rotulo', texto('panel.sesion-unica.tu-entrada')));
  const lista = pieza('dl', 'sesion-unica-lectura');
  dato(lista, 'panel.sesion-unica.usuario', b.correo);
  dato(lista, 'panel.sesion-unica.dato.entrada', b.idEntrada);
  dato(lista, 'panel.sesion-unica.dato.verificacion', texto('panel.sesion-unica.verificacion'));
  dato(lista, 'panel.sesion-unica.dato.hora', horaPanel(b.entradaEn));
  const ocupado = b.ocupacion?.idSesion
    ? texto('panel.sesion-unica.panel-ocupado-id', { id: b.ocupacion.idSesion })
    : texto('panel.sesion-unica.panel-ocupado');
  dato(lista, 'panel.sesion-unica.dato.panel', b.ocupacion ? ocupado : texto('panel.sesion-unica.panel-libre'));
  columna.append(lista);
  return columna;
}
/** @param {BienvenidaPanel} bienvenida @returns {{ nota: HTMLElement | null, accion: HTMLElement | null }} */
function situacion(bienvenida) {
  const ocupacion = bienvenida.ocupacion;
  if (ocupacion === null) {
    return { nota: null, accion: boton('sesion-unica-abrir', 'abrir', 'panel.sesion-unica.abrir') };
  }
  if (ocupacion.propia) {
    return {
      nota: pieza('p', 'sesion-unica-ocupada', texto('panel.sesion-unica.propia')),
      accion: boton('sesion-unica-retomar', 'retomar', 'panel.sesion-unica.retomar'),
    };
  }
  return { nota: pieza('p', 'sesion-unica-ocupada', textoOcupada(ocupacion)), accion: null };
}

/**
 * Bienvenida antes de los controles: quién ha entrado, por qué hay una sesión única y qué puede hacer ahora.
 * @param {HTMLElement} destino @param {BienvenidaPanel} bienvenida @param {string | null} [aviso]
 * @returns {{ accion: HTMLElement | null }} El botón que abre o retoma la sesión, si lo hay.
 */
export function pintarBienvenida(destino, bienvenida, aviso = null) {
  const seccion = pieza('section', 'sesion-unica-bienvenida');
  seccion.setAttribute('data-correo', bienvenida.correo);
  seccion.setAttribute('data-id-entrada', bienvenida.idEntrada);
  seccion.setAttribute('data-entrada-en', String(bienvenida.entradaEn));
  const principal = pieza('div', 'sesion-unica-principal');
  const titulo = pieza('h2', 'sesion-unica-titulo', texto('panel.sesion-unica.titulo'));
  titulo.setAttribute('tabindex', '-1');
  principal.append(pieza('p', 'sesion-unica-verificada', texto('panel.sesion-unica.verificada')), titulo);
  if (aviso !== null) {
    const nota = pieza('p', 'sesion-unica-aviso', aviso);
    nota.setAttribute('role', 'status');
    principal.append(nota);
  }
  const { nota, accion } = situacion(bienvenida);
  if (nota !== null) {
    principal.append(nota);
  }
  principal.append(pieza('p', 'sesion-unica-explicacion', texto('panel.sesion-unica.explicacion')));
  if (accion !== null) {
    principal.append(accion);
  }
  seccion.append(principal, tuEntrada(bienvenida));
  destino.replaceChildren(seccion);
  return { accion };
}

/** Qué ha pasado con la sesión al volver a la bienvenida. @param {FinSesion} fin @param {number} instante */
export function avisoDeFin(fin, instante) {
  return texto(`panel.sesion-unica.fin.${fin}`, { hora: horaPanel(instante) });
}

/** El aviso aparece desde dos minutos antes del cierre previsto. @param {SesionPanelActiva} sesion @param {number} ahora */
function debeAvisarCierre(sesion, ahora) {
  return ahora >= sesion.caducaPorInactividadEn - AVISO_CIERRE_MS && ahora < sesion.caducaPorInactividadEn;
}
/** Todos los datos de la sesión, en atributos para el diseño. @param {HTMLElement} banda @param {DatosBanda} datos */
function exponerDatos(banda, datos) {
  const { sesion } = datos;
  const atributos = {
    'data-id-sesion': datos.idSesion,
    'data-id-entrada': datos.idEntrada,
    'data-correo': datos.correo,
    'data-entrada-en': String(datos.entradaEn),
    'data-abierta-en': String(sesion.iniciadaEn),
    'data-actividad-en': String(sesion.ultimaActividadEn),
    'data-cierre-inactividad-en': String(sesion.caducaPorInactividadEn),
    'data-limite-en': String(sesion.caducaAbsolutaEn),
  };
  for (const [nombre, valor] of Object.entries(atributos)) {
    banda.setAttribute(nombre, valor);
  }
}
/** @param {DatosBanda} datos */
function resumenDeBanda(datos) {
  const resumen = pieza('p', 'sesion-unica-banda-texto');
  const punto = pieza('span', 'sesion-unica-punto');
  punto.setAttribute('aria-hidden', 'true');
  resumen.append(
    punto,
    pieza('span', 'sesion-unica-banda-nombre', texto('panel.sesion-unica.nombre')),
    ' ',
    pieza('span', 'sesion-unica-id', datos.idSesion),
    ' ',
    pieza(
      'span',
      'sesion-unica-desde',
      texto('panel.sesion-unica.desde', { hora: horaPanel(datos.sesion.iniciadaEn) }),
    ),
  );
  return resumen;
}
/**
 * La inicial del usuario en un círculo; al pulsarla se despliega su correo y «Cerrar sesión». Escape lo recoge.
 * @param {string} correo @param {HTMLElement} cerrar
 */
function cuentaDeBanda(correo, cerrar) {
  const cuenta = pieza('div', 'sesion-unica-cuenta');
  const inicial = pieza('button', 'sesion-unica-avatar', (Array.from(correo.trim())[0] ?? '?').toUpperCase());
  inicial.setAttribute('type', 'button');
  inicial.setAttribute('aria-label', texto('panel.sesion-unica.cuenta', { correo }));
  inicial.setAttribute('aria-expanded', 'false');
  inicial.setAttribute('aria-controls', 'sesion-unica-menu');
  const menu = pieza('div', 'sesion-unica-menu');
  menu.id = 'sesion-unica-menu';
  menu.hidden = true;
  menu.append(pieza('p', 'sesion-unica-banda-usuario', correo), cerrar);
  /** @param {boolean} abierto */
  const desplegar = (abierto) => {
    menu.hidden = !abierto;
    inicial.setAttribute('aria-expanded', String(abierto));
  };
  inicial.addEventListener('click', () => desplegar(menu.hidden === true));
  cuenta.addEventListener('keydown', (evento) => {
    if (/** @type {KeyboardEvent} */ (evento).key === 'Escape' && !menu.hidden) {
      desplegar(false);
      inicial.focus();
    }
  });
  cuenta.append(inicial, menu);
  return cuenta;
}
/**
 * La sesión en la barra superior mientras está abierta: su id y desde qué hora; la inicial de quien la tiene, con su
 * correo y «Cerrar sesión»; cerca del cierre por inactividad, el aviso para seguir.
 * @param {HTMLElement} destino @param {DatosBanda} datos @param {number} ahora
 * @returns {{ cerrar: HTMLElement, seguir: HTMLElement | null }}
 */
export function pintarBanda(destino, datos, ahora) {
  const { sesion } = datos;
  const banda = pieza('div', 'sesion-unica-banda');
  banda.setAttribute('role', 'region');
  banda.setAttribute('aria-label', texto('panel.sesion-unica.abierta'));
  exponerDatos(banda, datos);
  banda.append(resumenDeBanda(datos));
  /** @type {HTMLElement | null} */
  let seguir = null;
  if (debeAvisarCierre(sesion, ahora)) {
    const aviso = pieza('div', 'sesion-unica-aviso-cierre');
    aviso.setAttribute('role', 'status');
    const hora = horaPanel(sesion.caducaPorInactividadEn);
    seguir = boton('sesion-unica-seguir', 'seguir', 'panel.sesion-unica.seguir');
    aviso.append(pieza('p', 'sesion-unica-aviso-texto', texto('panel.sesion-unica.aviso-cierre', { hora })), seguir);
    banda.append(aviso);
  }
  const cerrar = boton('sesion-unica-cerrar', 'cerrar', 'panel.sesion-unica.cerrar');
  banda.append(cuentaDeBanda(datos.correo, cerrar));
  destino.replaceChildren(banda);
  return { cerrar, seguir };
}

/**
 * Confirmación de apertura: un anillo que se completa y una marca que se dibuja, una sola vez; con movimiento reducido,
 * la marca ya completa y solo el texto.
 * @param {HTMLElement} destino @param {boolean} movimientoReducido
 */
export function mostrarApertura(destino, movimientoReducido) {
  const confirmacion = pieza('div', 'sesion-unica-abierta');
  confirmacion.setAttribute('role', 'status');
  const marca = pieza('span', movimientoReducido ? 'sesion-unica-marca' : 'sesion-unica-marca sesion-unica-transicion');
  marca.setAttribute('aria-hidden', 'true');
  marca.append(pieza('span', 'sesion-unica-anillo'), pieza('span', 'sesion-unica-check'));
  confirmacion.append(marca, pieza('p', 'sesion-unica-abierta-texto', texto('panel.sesion-unica.abierta')));
  destino.replaceChildren(confirmacion);
  return confirmacion;
}
/** El identificador llega después de abrir: se añade a la confirmación sin volver a dibujar la marca.
 * @param {HTMLElement} confirmacion @param {string} idSesion */
export function anadirIdApertura(confirmacion, idSesion) {
  confirmacion.append(pieza('p', 'sesion-unica-abierta-id', texto('panel.sesion-unica.solo-tu', { id: idSesion })));
}

/** Frase de cada fila del registro, sin jerga: qué hizo el usuario o qué pasó con su sesión. @param {FilaRegistroPanel} fila */
export function fraseDeRegistro(fila) {
  const id = fila.idSesion ?? '';
  switch (fila.tipo) {
    case 'sesion-caducada':
      return texto(`panel.sesion-unica.registro.sesion-caducada.${fila.motivo ?? 'inactividad'}`, { id });
    case 'apertura-rechazada':
      return fila.titular === null
        ? texto('panel.sesion-unica.registro.apertura-rechazada-sin-usuario')
        : texto('panel.sesion-unica.registro.apertura-rechazada', { titular: fila.titular });
    default:
      return texto(`panel.sesion-unica.registro.${fila.tipo}`, { id, titular: fila.titular ?? '' });
  }
}
/** @type {Readonly<Record<string, TonoEstado>>} */
const TONO_DE_REGISTRO = Object.freeze({
  'sesion-abierta': 'bien',
  'sesion-cerrada': 'nada',
  'sesion-caducada': 'atencion',
  'sesion-retomada': 'curso',
  'apertura-rechazada': 'fallo',
  'administrador-anadido': 'bien',
  'administrador-retirado': 'nada',
  'cloudflare-actualizado': 'bien',
  'cloudflare-fallido': 'atencion',
});
/** El identificador de sesión va en su propia pieza para que no se parta entre líneas. @param {string} frase
 * @param {string|null} id @returns {(string|HTMLElement)[]} */
function conIdEntero(frase, id) {
  const posicion = id ? frase.indexOf(id) : -1;
  if (!id || posicion < 0) {
    return [frase];
  }
  return [frase.slice(0, posicion), pieza('span', 'sesion-unica-id', id), frase.slice(posicion + id.length)];
}
/** La actividad de una fila: estado con icono y palabra (las entradas no lo llevan) y su frase. @param {FilaRegistroPanel} fila */
export function actividadDeRegistro(fila) {
  const celda = pieza('span', 'sesion-unica-actividad');
  const tono = TONO_DE_REGISTRO[fila.tipo];
  if (tono !== undefined) {
    celda.append(marcaEstado(tono, texto(`panel.sesion-unica.registro.estado.${fila.tipo}`)), ' · ');
  }
  celda.append(...conIdEntero(fraseDeRegistro(fila), fila.idSesion));
  return celda;
}
/** Lo más reciente primero, sea cual sea el orden de llegada. @param {readonly FilaRegistroPanel[]} filas */
export function ordenarRegistro(filas) {
  return [...filas].sort((a, b) => b.instante - a.instante);
}
/** @param {HTMLElement} fila @param {string} clase @param {string|HTMLElement} contenido */
function celda(fila, clase, contenido) {
  const td = pieza('td', `sesion-unica-celda ${clase}`);
  td.append(contenido);
  fila.append(td);
}
/** @param {FilaRegistroPanel} fila @param {number} ahora */
function lineaDeRegistro(fila, ahora) {
  const atenuada = fila.tipo === 'entrada' ? ' sesion-unica-fila-atenuada' : '';
  const linea = pieza('tr', `sesion-unica-fila sesion-unica-fila-${fila.tipo}${atenuada}`);
  if (fila.idEntrada !== null) {
    linea.setAttribute('data-id-entrada', fila.idEntrada);
  }
  if (fila.idSesion !== null) {
    linea.setAttribute('data-id-sesion', fila.idSesion);
  }
  celda(linea, 'sesion-unica-celda-fecha', fechaPanel(fila.instante, ahora));
  celda(linea, 'sesion-unica-correo', fila.correo);
  celda(linea, 'sesion-unica-celda-suceso', actividadDeRegistro(fila));
  celda(linea, 'sesion-unica-celda-entrada', fila.idEntrada ?? '—');
  celda(linea, 'sesion-unica-celda-sesion', fila.idSesion ?? '—');
  return linea;
}
const COLUMNAS_REGISTRO = Object.freeze([
  'panel.sesion-unica.registro.fecha',
  'panel.sesion-unica.usuario',
  'panel.sesion-unica.registro.actividad',
  'panel.sesion-unica.dato.entrada',
  'panel.sesion-unica.dato.sesion',
]);
/**
 * Registro del panel: lo más reciente arriba y las entradas atenuadas, para seguir entró → abrió → cerró.
 * @param {HTMLElement} destino @param {readonly FilaRegistroPanel[]} filas @param {number} [ahora]
 */
export function pintarRegistro(destino, filas, ahora = Date.now()) {
  if (filas.length === 0) {
    destino.replaceChildren(pieza('p', 'sesion-unica-registro-vacio', texto('panel.sesion-unica.registro.vacio')));
    return;
  }
  const tabla = pieza('table', 'sesion-unica-registro-tabla');
  const cabecera = pieza('tr', 'sesion-unica-registro-cabecera');
  for (const clave of COLUMNAS_REGISTRO) {
    const titulo = pieza('th', 'sesion-unica-celda', texto(clave));
    titulo.setAttribute('scope', 'col');
    cabecera.append(titulo);
  }
  const cuerpo = pieza('tbody', 'sesion-unica-registro-filas');
  cuerpo.append(...ordenarRegistro(filas).map((fila) => lineaDeRegistro(fila, ahora)));
  const encabezado = pieza('thead', 'sesion-unica-registro-encabezado');
  encabezado.append(cabecera);
  tabla.append(encabezado, cuerpo);
  destino.replaceChildren(tabla);
}
