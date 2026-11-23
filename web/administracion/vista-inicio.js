// Inicio del Panel de Control: cuatro indicadores, la tabla «Estado del servicio», lo que requiere atención y la
// actividad reciente del registro. Solo pinta lo que ya ha leído el cliente; no consulta nada por su cuenta.
import { texto } from '../scripts/textos.js';
import { lineaCsv } from './archivos-piloto.js';
import { marcaEstado } from './estado-visual.js';
import { icono } from './iconos-panel.js';
import { areasDelServicio, requiereAtencion, resumirFuentes } from './inicio-datos.js';
import { actividadDeRegistro, horaPanel, ordenarRegistro } from './vista-sesion-unica.js';

/** @typedef {import('./inicio-datos.js').Area} Area */
/** @typedef {import('./inicio-datos.js').EstadoActivo} EstadoActivo */
/** @typedef {import('./inicio-datos.js').SituacionAvisos} SituacionAvisos */
/** @typedef {import('./estado-visual.js').TonoEstado} TonoEstado */
/** @typedef {import('./contrato-sesion-unica.js').FilaRegistroPanel} FilaRegistroPanel */
/** @typedef {import('./inicio-datos.js').ResumenAdministradores} ResumenAdministradores */

const FILAS_ACTIVIDAD = 5;
/** El icono de cada área de la tabla, el mismo que su apartado en la navegación. */
const ICONO_DE_AREA = Object.freeze({
  fuentes: 'datos',
  actualizacion: 'actualizar',
  publicados: 'datos',
  web: 'web',
  accesos: 'accesos',
  panel: 'registro',
  encuesta: 'encuesta',
  avisos: 'avisos',
  conectividad: 'web',
});
/** @param {string} clave @param {Record<string,string|number>} [valores] */
const t = (clave, valores) => texto(`panel.inicio.${clave}`, valores);
/** @param {string} etiqueta @param {string} clase @param {string} [contenido] */
function pieza(etiqueta, clase, contenido) {
  const elemento = document.createElement(etiqueta);
  elemento.className = clase;
  if (contenido !== undefined) {
    elemento.textContent = contenido;
  }
  return elemento;
}
/** @param {string} id */
const destino = (id) => document.getElementById(id);

/** Caracteres que caben en una línea de un indicador con la cifra a su tamaño. */
const CIFRA_EN_UNA_LINEA = 14;
/** Una frase sin números que no cabría en una línea a tamaño de cifra («Sin datos suficientes») se escribe más pequeña;
 * las cifras con números conservan siempre su tamaño. @param {string} cifra */
const esFraseLarga = (cifra) => !/\d/u.test(cifra) && cifra.length > CIFRA_EN_UNA_LINEA;
/** Un indicador; si pide atención lleva el borde y el icono de su estado. @param {string} rotulo @param {string} cifra
 * @param {string} pie @param {TonoEstado|null} [aviso] */
function indicador(rotulo, cifra, pie, aviso = null) {
  const tarjeta = pieza('article', aviso ? `panel-kpi panel-kpi--${aviso}` : 'panel-kpi');
  const titulo = pieza('h3', 'panel-kpi-rotulo');
  if (aviso) {
    const marca = pieza('span', `panel-estado panel-estado--${aviso}`);
    marca.append(icono(`estado-${aviso}`));
    titulo.append(marca);
  }
  titulo.append(rotulo);
  const clase = esFraseLarga(cifra) ? 'panel-kpi-cifra panel-kpi-cifra--texto' : 'panel-kpi-cifra';
  tarjeta.append(titulo, pieza('p', clase, cifra), pieza('p', 'panel-kpi-pie', pie));
  return tarjeta;
}
/** Estado general: lo que hay por revisar o, si no hay nada, si todo se ha podido comprobar. @param {readonly Area[]} areas */
function indicadorGeneral(areas) {
  const sinDato = areas.filter((a) => a.estado === t('estado.sin-dato')).length;
  const bien = areas.filter((a) => a.tono === 'bien').length;
  const pie = t(sinDato ? 'kpi.areas-sin-dato' : 'kpi.areas', { bien, total: areas.length, sinDato });
  const problemas = requiereAtencion(areas);
  const [principal] = problemas;
  if (principal) {
    // Lo más grave va primero: el indicador toma su icono y su color.
    return indicador(t('kpi.general'), t('kpi.avisos', { cantidad: problemas.length }), pie, principal.tono);
  }
  // «Todo bien» solo cuando todas las áreas tienen dato: lo que no se ha comprobado no se da por bueno.
  return indicador(t('kpi.general'), t(sinDato ? 'kpi.sin-datos-suficientes' : 'kpi.todo-bien'), pie);
}
/** @param {readonly Area[]} areas @param {EstadoActivo} estado */
function indicadores(areas, estado) {
  const general = indicadorGeneral(areas);
  const fuentes = resumirFuentes(estado);
  const tarjetaFuentes = fuentes
    ? indicador(
        t('kpi.fuentes'),
        `${fuentes.bien} / ${fuentes.total}`,
        fuentes.incidencias.length
          ? t('kpi.con-incidencia', { nombres: fuentes.incidencias.join(', ') })
          : t('kpi.fuentes-bien'),
        fuentes.incidencias.length > 0 ? 'atencion' : null,
      )
    : indicador(t('kpi.fuentes'), t('estado.sin-dato'), t('kpi.sin-leer'));
  const actualizacion = areas.find((a) => a.id === 'actualizacion');
  return [
    general,
    indicador(t('kpi.cursos'), t('estado.sin-dato'), t('kpi.cursos-sin-dato')),
    tarjetaFuentes,
    indicador(
      t('kpi.actualizacion'),
      actualizacion?.estado ?? t('estado.sin-dato'),
      actualizacion?.detalle || t('kpi.sin-leer'),
    ),
  ];
}
/** @param {Area} area */
function filaDeArea(area) {
  const fila = pieza('tr', `panel-tabla-fila panel-tabla-fila--${area.tono}`);
  const nombre = pieza('th', 'panel-tabla-area');
  nombre.setAttribute('scope', 'row');
  nombre.append(icono(ICONO_DE_AREA[/** @type {keyof typeof ICONO_DE_AREA} */ (area.id)]), area.nombre);
  const estado = pieza('td', 'panel-tabla-estado');
  estado.append(marcaEstado(area.tono, area.estado));
  // El chevrón abre el apartado; su nombre accesible dice cuál.
  const enlace = pieza('a', 'panel-tabla-ir');
  enlace.setAttribute('href', area.enlace);
  enlace.setAttribute('aria-label', t('abrir-area', { area: area.nombre }));
  enlace.append(icono('chevron'));
  const ir = pieza('td', 'panel-tabla-celda-ir');
  ir.append(enlace);
  fila.append(
    nombre,
    estado,
    pieza('td', 'panel-tabla-detalle', area.detalle || '—'),
    pieza('td', 'panel-tabla-cuando', area.cuando === null ? '—' : horaPanel(area.cuando)),
    ir,
  );
  return fila;
}
/** Cada fila: icono, área con su estado en palabra, explicación y el botón que lleva a su apartado.
 * @param {Area} area @param {number} posicion */
function elementoDeAtencion(area, posicion) {
  const elemento = pieza('li', 'panel-lista-elemento panel-atencion');
  const marca = pieza('span', `panel-estado panel-estado--${area.tono}`);
  marca.append(icono(`estado-${area.tono}`));
  const que = pieza('p', 'panel-lista-que', area.nombre);
  que.append(' · ', pieza('span', `panel-estado panel-estado--${area.tono}`, area.estado));
  // La primera acción es la principal, como en el resto del panel.
  const accion = pieza('a', posicion === 0 ? 'panel-boton panel-boton--principal' : 'panel-boton');
  accion.textContent = t('atencion.ir', { area: area.nombre });
  accion.setAttribute('href', area.enlace);
  const acciones = pieza('p', 'panel-lista-acciones');
  acciones.append(accion);
  elemento.append(marca, que, pieza('p', 'panel-lista-por', area.detalle), acciones);
  return elemento;
}
/** @param {readonly Area[]} areas */
function listaDeAtencion(areas) {
  const pendientes = requiereAtencion(areas);
  const cuenta = destino('inicio-atencion-cuenta');
  if (cuenta) {
    cuenta.textContent = pendientes.length ? String(pendientes.length) : '';
  }
  if (pendientes.length === 0) {
    return [pieza('p', 'panel-lista-vacia', t('atencion.nada'))];
  }
  return pendientes.map(elementoDeAtencion);
}
/** @param {readonly FilaRegistroPanel[] | null} filas */
function listaDeActividad(filas) {
  if (filas === null) {
    return [pieza('p', 'panel-lista-vacia', t('actividad.sin-dato'))];
  }
  if (filas.length === 0) {
    return [pieza('p', 'panel-lista-vacia', texto('panel.sesion-unica.registro.vacio'))];
  }
  return ordenarRegistro(filas)
    .slice(0, FILAS_ACTIVIDAD)
    .map((fila) => {
      const elemento = pieza(
        'li',
        `panel-lista-elemento panel-actividad${fila.tipo === 'entrada' ? ' panel-actividad--atenuada' : ''}`,
      );
      const que = pieza('p', 'panel-actividad-que');
      que.append(`${fila.correo} · `, actividadDeRegistro(fila));
      elemento.append(pieza('span', 'panel-actividad-hora', horaPanel(fila.instante)), que);
      return elemento;
    });
}
/** El informe que se exporta: la tabla «Estado del servicio» tal como se ve, con la hora de comprobación.
 * El BOM inicial permite abrir los acentos en una hoja de cálculo. @param {readonly Area[]} areas */
export function informeDelServicio(areas) {
  const columnas = ['area', 'estado', 'detalle', 'comprobado'].map((clave) => t(`columna.${clave}`));
  const filas = areas.map((a) => [a.nombre, a.estado, a.detalle, a.cuando === null ? '' : horaPanel(a.cuando)]);
  return `﻿${[columnas, ...filas].map(lineaCsv).join('\r\n')}\r\n`;
}

/** Lo que pinta el Inicio cada vez que cambia el estado del cliente, el registro o los avisos. */
export function crearVistaInicio() {
  /** Instante en que el cliente recibió cada lectura: es la hora de comprobación que ve el usuario. */
  const recibidos = new WeakMap();
  /** @param {object|null|undefined} dato */
  const recibido = (dato) => {
    if (!dato) {
      return null;
    }
    if (!recibidos.has(dato)) {
      recibidos.set(dato, Date.now());
    }
    return recibidos.get(dato) ?? null;
  };
  /** @type {readonly FilaRegistroPanel[] | null} */
  let registro = null;
  /** @type {ResumenAdministradores | null} */
  let administradores = null;
  /** Lo último que se ha pintado: es lo que exporta «Exportar informe». @type {readonly Area[]} */
  let pintadas = [];
  return {
    /** @param {ResumenAdministradores} resumen */
    recibirAdministradores(resumen) {
      administradores = resumen;
    },
    /** @param {readonly FilaRegistroPanel[] | null} filas */
    recibirRegistro(filas) {
      registro = filas;
    },
    /** El informe de lo que se ve ahora, o null si el Inicio aún no se ha pintado. */
    informe() {
      return pintadas.length ? informeDelServicio(pintadas) : null;
    },
    /** @param {EstadoActivo} estado @param {{idSesion:string|null, avisos:SituacionAvisos|null}} contexto */
    mostrar(estado, contexto) {
      const areas = areasDelServicio(estado, { ...contexto, administradores, recibido });
      pintadas = areas;
      destino('inicio-indicadores')?.replaceChildren(...indicadores(areas, estado));
      destino('inicio-estado')?.replaceChildren(...areas.map(filaDeArea));
      destino('inicio-atencion')?.replaceChildren(...listaDeAtencion(areas));
      destino('inicio-actividad')?.replaceChildren(...listaDeActividad(registro));
      // Hay algo que exportar desde que el Inicio se pinta por primera vez.
      destino('inicio-exportar')?.removeAttribute('disabled');
      const comprobado = destino('inicio-comprobado');
      if (comprobado) {
        comprobado.textContent = t('comprobado', { hora: horaPanel(Date.now()) });
      }
    },
  };
}
