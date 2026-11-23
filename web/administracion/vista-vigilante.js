// La vista conserva solo lo recibido en esta sesión y diferencia la observación de la evaluación.
import { texto } from '../scripts/textos.js';
import { diaUtc, fechaPanel } from './fechas-panel.js';
import { crearVistaAvisos } from './vista-avisos.js';
import { CLAVE_TEXTO_DE_LA_ACCION } from './vista-trabajos.js';

/** @typedef {import('./vigilante-panel.js').VigilantePanel} Vigilante */
/** @typedef {import('./vigilante-panel.js').HistorialVigilantePanel} Historial */
/** @typedef {import('./vigilante-panel.js').FilaVigilantePanel} Fila */
/** @param {number} valor */
function fecha(valor) {
  if (valor === 0) {
    return texto('panel.no-consta');
  }
  return Number.isFinite(new Date(valor).getTime()) ? fechaPanel(valor) : texto('panel.no-consta');
}
/** @param {HTMLElement} destino @param {string} contenido */
function parrafo(destino, contenido) {
  const p = document.createElement('p');
  p.textContent = contenido;
  destino.append(p);
}
/** La acción corresponde al ámbito observado, no a palabras que se parezcan. */
const ACCIONES = Object.freeze({
  sin_trabajo_reservado: 'trabajo',
  trabajo_terminado_sin_resultado_admitido: 'trabajo',
  inicio_no_confirmado: 'trabajo',
  inicio_rechazado: 'inicio-rechazado',
  inicio_confirmado_sin_cierre: 'trabajo',
  evento_esperado_sin_registro: 'programacion',
  programacion_apagada: 'programacion-apagada',
  sin_observacion_correlacionada: 'mantenimiento',
  lectura_local_no_disponible: 'local',
  observacion_de_mantenimiento_antigua: 'mantenimiento',
  legado_sin_comprobaciones_por_conjunto: 'mantenimiento',
  'comprobacion_sin-observacion': 'comprobacion',
  comprobacion_vencida: 'comprobacion',
  mantenimiento_incidencia: 'mantenimiento',
  mantenimiento_atencion: 'mantenimiento',
  mantenimiento_local: 'local',
});
/** @param {Pick<Fila, 'estado'|'motivo'>} fila */
function accion(fila) {
  if (fila.estado === 'conforme') {
    return texto('panel.vigilante.conforme');
  }
  const tipo = /** @type {Record<string,string>} */ (ACCIONES)[fila.motivo] ?? 'general';
  return texto(`panel.vigilante.accion-${tipo}`);
}
/** @param {{motivo:string,observadoEn:number}} fila */
function cuando(fila) {
  const clave =
    fila.motivo === 'sin_observacion_correlacionada' ? 'panel.vigilante.decidido' : 'panel.vigilante.observado';
  return texto(clave, { fecha: fecha(fila.observadoEn) });
}
/** @param {HTMLElement} destino @param {readonly Fila[]} filas */
function pintarFilas(destino, filas) {
  const lista = document.createElement('ul');
  for (const fila of filas) {
    const item = document.createElement('li');
    item.textContent = `${fila.clave} · ${texto(`panel.vigilante.motivo.${fila.motivo}`)} ${accion(fila)} ${texto(`panel.vigilante.fila-origen.${fila.origen}`)} ${cuando(fila)} ${texto('panel.vigilante.evaluado', { fecha: fecha(fila.evaluadoEn) })}`;
    lista.append(item);
  }
  destino.append(lista);
}
/** @param {HTMLElement} destino @param {Vigilante['areas']} areas */
function pintarAreas(destino, areas) {
  parrafo(destino, texto('panel.vigilante.areas'));
  const lista = document.createElement('ul');
  for (const area of areas) {
    const item = document.createElement('li');
    item.textContent = `${area.clave} · ${texto(`panel.vigilante.motivo.${area.motivo}`)} ${accion(area)} ${cuando(area)}`;
    lista.append(item);
  }
  destino.append(lista);
}
/** @param {HTMLElement} destino @param {Vigilante['ultimoTrabajo']} trabajo */
function pintarTrabajo(destino, trabajo) {
  if (!trabajo) {
    parrafo(destino, texto('panel.trabajo.sin-trabajos'));
    return;
  }
  parrafo(
    destino,
    texto('panel.trabajo.fecha-solicitud', {
      v0: texto(CLAVE_TEXTO_DE_LA_ACCION[trabajo.accion]),
      v1: fecha(trabajo.creadoEn),
    }),
  );
  parrafo(destino, texto('panel.vigilante.trabajo-actualizado', { fecha: fecha(trabajo.actualizadoEn) }));
  const estados = {
    'despacho-incierto': 'panel.trabajo.solicitada-incierta',
    despachado: 'panel.trabajo.en-curso',
    terminado: 'panel.trabajo.sin-resultado',
  };
  const estado = estados[trabajo.estado];
  const resultado = trabajo.resultado ? `panel.trabajo.resultado.${trabajo.resultado}` : estado;
  parrafo(destino, texto(resultado));
}
/**
 * Una fila en lenguaje llano: cuándo, qué pasó y por qué. Si falló, en qué fase y por qué; si la reserva se hizo pero
 * el lanzamiento no se confirmó, el motivo de la reserva va primero y la fila acaba con lo que hará Faro.
 * @param {Vigilante['eventosProgramados'][number]} evento
 */
function filaDelEvento(evento) {
  const comun = { fecha: fecha(evento.eventoEn), motivo: texto(`panel.vigilante.eventos.motivo.${evento.motivo}`) };
  if (!evento.fase) {
    return texto('panel.vigilante.eventos.fila', {
      ...comun,
      resultado: texto(`panel.vigilante.eventos.resultado.${evento.resultado}`),
    });
  }
  const fallo = texto(`panel.vigilante.eventos.motivo-fallo.${evento.motivoFallo}`);
  if (evento.resultado !== 'fallida') {
    return texto('panel.vigilante.eventos.fila-despacho', { ...comun, fallo });
  }
  const fase = texto(`panel.vigilante.eventos.fase.${evento.fase}`);
  return texto('panel.vigilante.eventos.fila', {
    ...comun,
    resultado: texto('panel.vigilante.eventos.resultado.fallida', { fase, fallo }),
  });
}
/** Las comprobaciones programadas que registró el servidor, de la más reciente a la más antigua: cuándo, qué pasó y por
 * qué, en lenguaje llano. @param {HTMLElement} destino @param {Vigilante['eventosProgramados']} eventos */
function pintarEventosProgramados(destino, eventos) {
  if (!eventos.length) {
    parrafo(destino, texto('panel.vigilante.eventos.ninguno'));
    return;
  }
  parrafo(destino, texto('panel.vigilante.eventos.titulo'));
  const lista = document.createElement('ul');
  for (const evento of eventos) {
    const elemento = document.createElement('li');
    elemento.textContent = filaDelEvento(evento);
    lista.append(elemento);
  }
  destino.append(lista);
}
/** El motivo de un correo que no salió es el mismo que explica la tarjeta «Avisos»; el de la URL tiene su frase.
 * @param {import('./vigilante-panel.js').CanalAvisoPanel} canal @param {import('./vigilante-panel.js').IntentoAvisoPanel} intento */
function fraseDelIntento(canal, intento) {
  const base = `panel.vigilante.avisos.${canal.canal}.intento`;
  if (intento.resultado === 'enviado') {
    return texto(`${base}.enviado`, { fecha: fecha(intento.en) });
  }
  return canal.canal === 'correo'
    ? texto(`${base}.fallido`, { fecha: fecha(intento.en), motivo: texto(`panel.avisos.motivo.${intento.motivo}`) })
    : texto(`${base}.fallido.${intento.motivo}`, { fecha: fecha(intento.en) });
}
/**
 * Cada canal de avisos con su estado y su último intento. Sin `avisos` en la respuesta, ningún canal está configurado
 * y no ha habido intentos.
 * @param {HTMLElement} destino @param {Vigilante['avisos']} avisos
 */
function pintarAvisos(destino, avisos) {
  if (!avisos) {
    parrafo(destino, texto('panel.vigilante.avisos.ninguno'));
    return;
  }
  for (const canal of avisos.canales) {
    parrafo(destino, texto(`panel.vigilante.avisos.${canal.canal}.${canal.estado}`));
    if (canal.ultimoIntento) {
      parrafo(destino, fraseDelIntento(canal, canal.ultimoIntento));
    }
  }
}
/** @param {HTMLElement} destino @param {Vigilante} vigilante */
function pintarEvaluacion(destino, vigilante) {
  parrafo(destino, texto('panel.vigilante.evaluado', { fecha: fecha(vigilante.evaluadoEn) }));
  parrafo(destino, texto('panel.vigilante.limite'));
  pintarAreas(destino, vigilante.areas);
  if (!vigilante.areas.some((area) => area.clave === 'programador')) {
    parrafo(destino, texto('panel.vigilante.programacion-no-evaluada'));
  }
  if (vigilante.pausaProgramadaHasta) {
    parrafo(destino, texto('panel.vigilante.programacion-en-pausa', { fecha: diaUtc(vigilante.pausaProgramadaHasta) }));
  }
  parrafo(
    destino,
    texto(vigilante.origenDatos === 'recibo' ? 'panel.vigilante.origen-recibo' : 'panel.vigilante.origen-local'),
  );
  parrafo(
    destino,
    texto(vigilante.incidencias.length ? 'panel.vigilante.incidencias' : 'panel.vigilante.sin-incidencias'),
  );
  pintarFilas(destino, vigilante.incidencias);
  for (const dato of vigilante.fechaDatos) {
    parrafo(
      destino,
      texto('panel.vigilante.fecha-dato', { fuente: dato.fuente, fecha: dato.fecha ?? texto('panel.no-consta') }),
    );
  }
  pintarTrabajo(destino, vigilante.ultimoTrabajo);
  pintarEventosProgramados(destino, vigilante.eventosProgramados);
  pintarAvisos(destino, vigilante.avisos);
}
/** @param {HTMLElement} destino @param {Vigilante|null} vigilante @param {Historial|null} historial @param {string|null} aviso */
export function pintarVigilante(destino, vigilante, historial, aviso) {
  destino.replaceChildren();
  if (aviso) {
    parrafo(destino, texto(aviso));
  }
  if (vigilante) {
    pintarEvaluacion(destino, vigilante);
  } else if (!aviso) {
    parrafo(destino, texto('panel.vigilante.sin-comprobar'));
  }
  if (historial) {
    parrafo(destino, texto('panel.vigilante.historial-revision', { revision: historial.revision }));
    pintarFilas(destino, historial.decisiones);
  }
}
/** @typedef {{comprobarVigilante:()=>Promise<Vigilante|Historial|null>,historialVigilante:(pagina:{despuesDe:number,revisionEsperada:number}|null)=>Promise<Vigilante|Historial|null>}} Cliente */
class VistaVigilante {
  /** @param {Cliente} cliente */
  constructor(cliente) {
    this.cliente = cliente;
    this.raiz = /** @type {HTMLElement} */ (document.getElementById('vigilante'));
    this.contenido = /** @type {HTMLElement} */ (document.getElementById('estado-vigilante'));
    this.comprobar = /** @type {HTMLButtonElement} */ (document.getElementById('comprobar-vigilante'));
    this.historialBoton = /** @type {HTMLButtonElement} */ (document.getElementById('historial-vigilante'));
    this.siguiente = /** @type {HTMLButtonElement} */ (document.getElementById('siguiente-vigilante'));
    /** @type {Vigilante|null} */ this.vigilante = null;
    /** @type {Historial|null} */ this.historial = null;
    /** @type {string|null} */ this.aviso = null;
    this.epoca = 0;
    this.habilitado = false;
    this.activa = false;
    this.ocupado = false;
    this.ocupadoPanel = false;
    /** @type {string|null} */ this.errorVigilante = null;
    this.comprobar.addEventListener('click', () => {
      void this.pedir('comprobar');
    });
    this.historialBoton.addEventListener('click', () => {
      void this.pedir('historial');
    });
    this.siguiente.addEventListener('click', () => {
      void this.pedir('siguiente');
    });
  }
  pintar() {
    this.raiz.hidden = !this.activa;
    this.comprobar.disabled = !this.habilitado || this.ocupado || this.ocupadoPanel;
    this.historialBoton.disabled = this.comprobar.disabled;
    this.siguiente.disabled = this.comprobar.disabled || !this.historial?.siguiente;
    this.siguiente.hidden = !this.historial?.siguiente;
    const aviso = this.activa && !this.habilitado ? 'panel.vigilante.no-disponible' : this.aviso;
    pintarVigilante(this.contenido, this.vigilante, this.historial, aviso);
  }
  /** @param {'comprobar'|'historial'|'siguiente'} tipo */
  async pedir(tipo) {
    if (!this.habilitado || this.ocupado || this.ocupadoPanel || (tipo === 'siguiente' && !this.historial?.siguiente)) {
      return;
    }
    const actual = this.epoca;
    this.ocupado = true;
    this.aviso = null;
    this.pintar();
    const resultado = await this.solicitar(tipo);
    if (actual !== this.epoca) {
      return;
    }
    this.ocupado = false;
    this.recibir(tipo, resultado);
    this.pintar();
  }
  /** @param {'comprobar'|'historial'|'siguiente'} tipo */
  solicitar(tipo) {
    if (tipo === 'comprobar') {
      return this.cliente.comprobarVigilante();
    }
    const historial = this.historial;
    const pagina =
      tipo === 'siguiente' && historial?.siguiente
        ? { despuesDe: historial.siguiente, revisionEsperada: historial.revision }
        : null;
    return this.cliente.historialVigilante(pagina);
  }
  /** @param {'comprobar'|'historial'|'siguiente'} tipo @param {Vigilante|Historial|null} resultado */
  recibir(tipo, resultado) {
    if (!resultado) {
      if (tipo === 'comprobar') {
        this.vigilante = null;
      } else {
        this.historial = null;
      }
      this.aviso = tipo === 'comprobar' ? 'panel.vigilante.error-comprobar' : 'panel.vigilante.error-historial';
      if (this.errorVigilante) {
        this.aviso = `panel.aviso.${this.errorVigilante}`;
      }
    } else if ('incidencias' in resultado) {
      this.vigilante = resultado;
      this.historial = null;
    } else {
      this.historial = resultado;
    }
  }
  /** @param {boolean} disponible @param {boolean} enCurso @param {string|null} aviso */
  mostrar(disponible, enCurso, aviso = null) {
    this.activa = true;
    this.habilitado = disponible;
    this.ocupadoPanel = enCurso;
    this.errorVigilante =
      aviso && ['vigilante_configuracion_invalida', 'vigilante_no_disponible', 'vigilante_conflicto'].includes(aviso)
        ? aviso
        : null;
    this.pintar();
  }
  retirar() {
    this.epoca += 1;
    this.habilitado = false;
    this.activa = false;
    this.ocupado = false;
    this.ocupadoPanel = false;
    this.errorVigilante = null;
    this.vigilante = null;
    this.historial = null;
    this.aviso = null;
    this.pintar();
  }
  traducir() {
    this.pintar();
  }
}
/**
 * La tarjeta «Avisos» va con el vigilante: se enseña y se retira con la sesión, igual que él.
 * @param {Cliente & import('./vista-avisos.js').ClienteAvisos} cliente
 */
export function crearVistaVigilante(cliente) {
  const vigilante = new VistaVigilante(cliente);
  const avisos = crearVistaAvisos(cliente);
  return {
    /** @param {boolean} disponible @param {boolean} enCurso @param {string|null} [aviso] */
    mostrar(disponible, enCurso, aviso = null) {
      vigilante.mostrar(disponible, enCurso, aviso);
      avisos.mostrar(enCurso, aviso);
    },
    retirar() {
      vigilante.retirar();
      avisos.retirar();
    },
    traducir() {
      vigilante.traducir();
      avisos.traducir();
    },
    situacionAvisos: () => avisos.situacion(),
  };
}
