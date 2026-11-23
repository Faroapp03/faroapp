import { evaluarHorarios } from './compatibilidad-horarios.js';
import { inicioNoAnterior, validarDisponibilidad } from './disponibilidad-agenda.js';
import { DIA_MS, diaIso, fecha, fechaMadrid, instante } from './fechas-cronograma.js';
import { esAsincronaEnPlan } from './sincronia-proveedor.js';

/** @import { PlanElegido, OpcionPlan } from './contrato.js' */
const MINUTO_MS = 60_000;
const MINUTOS_HORA = 60;
const DIAS_SEMANA = 7;
const LIMITE_DIAS = 366;
const PRIMER_CICLO = 7;
const SEGUNDO_CICLO = 14;
const BLOQUE_MINIMO = 15;

/** @param {OpcionPlan} opcion @param {'calendario_formacion'|'calendario_aula'} campo */
function calendario(opcion, campo) {
  const hecho = opcion.oferta.hechos[campo];
  return hecho.motivo === 'conocido' && hecho.valor && typeof hecho.valor === 'object' && 'tipo' in hecho.valor
    ? hecho.valor
    : null;
}
/** @param {OpcionPlan} opcion */
function horas(opcion) {
  const dato = opcion.oferta.hechos.horas_publicadas;
  return dato.motivo === 'conocido' && typeof dato.valor === 'number' && Number.isFinite(dato.valor) && dato.valor > 0
    ? dato.valor
    : null;
}
/** @typedef {{desde:string,hasta:string|null,parciales:boolean,indeterminada:boolean}} VentanaEstudio */
/** @param {string} valor @returns {string|null} */
function diaDelLimite(valor) {
  if (!valor.includes('T')) {
    return valor.slice(0, 10);
  }
  const numero = Date.parse(valor);
  return !valor.endsWith('-00:00') && /(?:Z|[+-]\d\d:\d\d)$/.test(valor) && Number.isFinite(numero)
    ? fechaMadrid(numero)
    : null;
}
/** @param {VentanaEstudio} ventana @param {string} valor */
function agregarApertura(ventana, valor) {
  const dia = diaDelLimite(valor);
  if (!dia) {
    ventana.indeterminada = true;
    return;
  }
  const parcial = valor.includes('T');
  const primero = parcial ? fecha(instante(dia) + DIA_MS) : dia;
  ventana.parciales ||= parcial;
  if (primero > ventana.desde) {
    ventana.desde = primero;
  }
}
/** @param {VentanaEstudio} ventana @param {string} valor */
function agregarCierre(ventana, valor) {
  const dia = diaDelLimite(valor),
    parcial = valor.includes('T');
  if (!dia) {
    ventana.indeterminada = true;
    return;
  }
  const ultimo = parcial ? fecha(instante(dia) - DIA_MS) : dia;
  ventana.parciales ||= parcial;
  if (!ventana.hasta || ultimo < ventana.hasta) {
    ventana.hasta = ultimo;
  }
}
/** @param {VentanaEstudio} ventana @param {ReturnType<typeof calendario>} c */
function agregarLimite(ventana, c) {
  if (!c || c.tipo === 'sesiones') {
    return;
  }
  if (c.inicio) {
    agregarApertura(ventana, c.inicio);
  }
  if (c.fin) {
    agregarCierre(ventana, c.fin);
  }
}
/** @param {OpcionPlan} opcion @param {string} inicio */
function limites(opcion, inicio) {
  /** @type {VentanaEstudio} */ const ventana = { desde: inicio, hasta: null, parciales: false, indeterminada: false };
  for (const c of [calendario(opcion, 'calendario_formacion'), calendario(opcion, 'calendario_aula')]) {
    agregarLimite(ventana, c);
  }
  return ventana;
}
/** @typedef {{tipo:string,indice?:number,fecha?:string}} AlertaCronograma */
/** @typedef {{inicio:number,fin:number}} IntervaloDia */
/** @typedef {{indice:number,bloque:string,inicio:string|null,fin:string|null}} SesionPublicada */
/** @typedef {{alertas:AlertaCronograma[],sesiones:SesionPublicada[],intervalosPorDia:Map<string,IntervaloDia[]>}} DatosSesiones */
/** Busca el cambio de día civil en Madrid sin suponer que todos los días duran 24 horas. */
/** @param {number} desde @param {number} hasta @param {string} dia */
function finDiaMadrid(desde, hasta, dia) {
  if (fechaMadrid(hasta - 1) === dia) {
    return hasta;
  }
  let bajo = desde,
    alto = hasta;
  while (alto - bajo > 1) {
    const medio = Math.floor((bajo + alto) / 2);
    if (fechaMadrid(medio) === dia) {
      bajo = medio;
    } else {
      alto = medio;
    }
  }
  return alto;
}
/** @param {number} desde @param {number} hasta @param {Map<string,IntervaloDia[]>} dias */
function repartirSesion(desde, hasta, dias) {
  for (let actual = desde; actual < hasta; ) {
    const dia = fechaMadrid(actual);
    const fin = finDiaMadrid(actual, Math.min(hasta, actual + 2 * DIA_MS), dia);
    const partes = dias.get(dia) ?? [];
    partes.push({ inicio: actual, fin });
    dias.set(dia, partes);
    actual = fin;
  }
}
/** @param {SesionPublicada} sesion @param {PlanElegido} plan @param {DatosSesiones} datos */
function registrarSesion(sesion, plan, datos) {
  const { indice } = sesion;
  const a = sesion.inicio,
    b = sesion.fin;
  datos.sesiones.push(sesion);
  const zonaA = a?.match(/(Z|[+-]\d\d:\d\d)$/)?.[1],
    zonaB = b?.match(/(Z|[+-]\d\d:\d\d)$/)?.[1];
  const desde = a ? Date.parse(a) : NaN,
    hasta = b ? Date.parse(b) : NaN;
  if (
    !a ||
    !b ||
    !zonaA ||
    !zonaB ||
    zonaA === '-00:00' ||
    zonaB === '-00:00' ||
    !Number.isFinite(desde) ||
    !Number.isFinite(hasta) ||
    hasta <= desde ||
    hasta - desde > LIMITE_DIAS * DIA_MS
  ) {
    datos.alertas.push({ tipo: 'sesion-por-confirmar', indice });
    return;
  }
  if (fechaMadrid(desde) < plan.preferencias.inicio || desde < Date.parse(plan.confirmadoEl)) {
    datos.alertas.push({ tipo: 'incorporacion-por-confirmar', indice, fecha: fechaMadrid(desde) });
    return;
  }
  repartirSesion(desde, hasta, datos.intervalosPorDia);
}
/** @param {{flexible:boolean,parciales:boolean,sincroniaDesconocida:boolean,estado:string,publicada:number|null,haySesiones:boolean}} curso @param {number} indice @param {DatosSesiones} datos */
function alertarCurso(curso, indice, datos) {
  if (curso.flexible && curso.parciales) {
    datos.alertas.push({ tipo: 'limites-horarios-parciales', indice });
  }
  if (!curso.haySesiones && (curso.estado === 'horario-por-confirmar' || curso.sincroniaDesconocida)) {
    datos.alertas.push({ tipo: 'horario-por-confirmar', indice });
  }
  if (curso.flexible && curso.publicada === null) {
    datos.alertas.push({ tipo: 'duracion-por-confirmar', indice });
  }
}
/** @param {OpcionPlan} opcion @param {number} indice @param {PlanElegido} plan @param {DatosSesiones} datos */
function crearCurso(opcion, indice, plan, datos) {
  const publicada = horas(opcion),
    formacion = calendario(opcion, 'calendario_formacion');
  const hecho = opcion.oferta.hechos.sincronia;
  const sincroniaDesconocida = (hecho.motivo !== 'conocido' || hecho.valor === null) && !esAsincronaEnPlan(opcion);
  const ventana = limites(opcion, plan.preferencias.inicio);
  const flexible =
    (sincroniaDesconocida || esAsincronaEnPlan(opcion)) && formacion?.tipo !== 'sesiones' && !ventana.indeterminada;
  let estado = flexible ? 'planificable' : 'horario-por-confirmar';
  if (formacion?.tipo === 'sesiones') {
    estado = 'sesiones-publicadas';
  }
  alertarCurso(
    {
      flexible,
      parciales: ventana.parciales,
      sincroniaDesconocida,
      estado,
      publicada,
      haySesiones: formacion?.tipo === 'sesiones',
    },
    indice,
    datos,
  );
  if (formacion?.tipo === 'sesiones') {
    if (formacion.sesiones.length === 0) {
      datos.alertas.push({ tipo: 'sesion-por-confirmar', indice });
    }
    for (const sesion of formacion.sesiones) {
      registrarSesion({ ...sesion, indice, bloque: opcion.bloque }, plan, datos);
    }
  }
  return {
    indice,
    bloque: opcion.bloque,
    horasPublicadas: publicada,
    estado,
    provisional: sincroniaDesconocida,
    inicioPrevisto: /** @type {string|null} */ (null),
    finPrevisto: /** @type {string|null} */ (null),
    minutosPlanificados: 0,
    limites: ventana,
  };
}
/** @param {Map<string,IntervaloDia[]>} intervalos */
function minutosOficiales(intervalos) {
  /** @type {Map<string,number>} */ const resultado = new Map();
  for (const [dia, partes] of intervalos) {
    let finAnterior = Number.NEGATIVE_INFINITY,
      minutos = 0;
    for (const parte of partes.sort((a, b) => a.inicio - b.inicio)) {
      minutos += Math.max(0, parte.fin - Math.max(finAnterior, parte.inicio)) / MINUTO_MS;
      finAnterior = Math.max(finAnterior, parte.fin);
    }
    resultado.set(dia, minutos);
  }
  return resultado;
}
/** @param {PlanElegido} plan */
function datosPublicados(plan) {
  /** @type {DatosSesiones} */ const datos = { alertas: [], sesiones: [], intervalosPorDia: new Map() };
  const cursos = plan.elecciones.map((opcion, indice) => crearCurso(opcion, indice, plan, datos));
  if (evaluarHorarios(plan).conflictos.length) {
    datos.alertas.push({ tipo: 'conflicto-sesiones' });
  }
  return {
    cursos,
    sesiones: datos.sesiones,
    oficialesPorDia: minutosOficiales(datos.intervalosPorDia),
    alertas: datos.alertas,
  };
}
/** @typedef {ReturnType<typeof crearCurso>} CursoCronograma */
/** @typedef {{fecha:string,minutos:number,indice:number,bloque:string,oficial:false}} ReservaEstudio */
/** @typedef {{inicio:string,fin:string,capacidadMinutos:number,minutosOficiales:number,slots:ReservaEstudio[]}} SemanaEstudio */
/** @typedef {{disponibilidad:ReturnType<typeof validarDisponibilidad>,flexibles:CursoCronograma[],incompleto:boolean,capacidadPorConfirmar:boolean,turno:number,oficialesPorDia:Map<string,number>,semanas:Map<string,SemanaEstudio>}} ContextoReservas */
/** @param {Map<string,SemanaEstudio>} semanas @param {number} ms */
function semanaPara(semanas, ms) {
  const lunes = ms - (diaIso(ms) - 1) * DIA_MS,
    clave = fecha(lunes);
  if (!semanas.has(clave)) {
    semanas.set(clave, {
      inicio: clave,
      fin: fecha(lunes + (DIAS_SEMANA - 1) * DIA_MS),
      capacidadMinutos: 0,
      minutosOficiales: 0,
      slots: [],
    });
  }
  return /** @type {SemanaEstudio} */ (semanas.get(clave));
}
/** @param {ContextoReservas} contexto @param {AlertaCronograma[]} alertas */
function anotarSesiones(contexto, alertas) {
  const { oficialesPorDia, semanas, disponibilidad } = contexto;
  for (const [dia, minutos] of oficialesPorDia) {
    const ms = instante(dia);
    semanaPara(semanas, ms).minutosOficiales += minutos;
    if (!disponibilidad.dias.includes(diaIso(ms))) {
      alertas.push({ tipo: 'sesion-fuera-disponibilidad', fecha: dia });
    } else if (minutos > disponibilidad.minutosPorDia) {
      alertas.push({ tipo: 'sesion-supera-disponibilidad', fecha: dia });
    }
  }
}
/** @param {CursoCronograma} curso @param {string} dia */
function aceptaDia(curso, dia) {
  return (
    dia >= curso.limites.desde &&
    (!curso.limites.hasta || dia <= curso.limites.hasta) &&
    (curso.horasPublicadas === null || curso.minutosPlanificados < curso.horasPublicadas * 60)
  );
}
/** @param {CursoCronograma} curso @param {number} minutos @param {string} dia @param {SemanaEstudio} semana */
function agregarReserva(curso, minutos, dia, semana) {
  if (minutos <= 0) {
    return;
  }
  semana.slots.push({ fecha: dia, minutos, indice: curso.indice, bloque: curso.bloque, oficial: false });
  curso.inicioPrevisto ??= dia;
  curso.minutosPlanificados += minutos;
}
/** @param {number} libre @param {number} restante @param {number} pendientes @param {boolean} incompleto */
function minutosParaCurso(libre, restante, pendientes, incompleto) {
  if (libre < BLOQUE_MINIMO && restante > libre) {
    return 0;
  }
  const cuota =
    incompleto && pendientes > 1
      ? Math.max(BLOQUE_MINIMO, Math.floor(libre / pendientes / BLOQUE_MINIMO) * BLOQUE_MINIMO)
      : libre;
  return Math.min(libre, cuota, restante);
}
/** @param {ContextoReservas} contexto @param {string} dia @param {number} libre */
function cursosParaDia(contexto, dia, libre) {
  let disponibles = contexto.flexibles.filter((curso) => aceptaDia(curso, dia));
  if (contexto.incompleto && disponibles.length > 1 && libre < BLOQUE_MINIMO * disponibles.length) {
    const giro = contexto.turno % disponibles.length;
    disponibles = [...disponibles.slice(giro), ...disponibles.slice(0, giro)];
    contexto.turno++;
  }
  return disponibles;
}
/** @param {ContextoReservas} contexto @param {CursoCronograma} curso @param {string} dia */
function marcarFinEstimado(contexto, curso, dia) {
  if (
    !contexto.incompleto &&
    curso.horasPublicadas !== null &&
    curso.minutosPlanificados >= curso.horasPublicadas * MINUTOS_HORA
  ) {
    curso.finPrevisto = dia;
  }
}
/** @param {ContextoReservas} contexto @param {number} ms */
function reservarDia(contexto, ms) {
  const { disponibilidad, oficialesPorDia, incompleto, semanas } = contexto;
  if (!disponibilidad.dias.includes(diaIso(ms))) {
    return;
  }
  const dia = fecha(ms);
  let libre = Math.max(0, Math.floor(disponibilidad.minutosPorDia - (oficialesPorDia.get(dia) ?? 0)));
  const disponibles = cursosParaDia(contexto, dia, libre);
  for (const [posicion, curso] of disponibles.entries()) {
    if (libre <= 0) {
      break;
    }
    const restante =
      curso.horasPublicadas === null ? Infinity : Math.max(0, curso.horasPublicadas * 60 - curso.minutosPlanificados);
    const minutos = minutosParaCurso(libre, restante, disponibles.length - posicion, incompleto);
    if (minutos > 0) {
      agregarReserva(curso, minutos, dia, semanaPara(semanas, ms));
      marcarFinEstimado(contexto, curso, dia);
    }
    libre -= minutos;
  }
}
/** @param {ContextoReservas} contexto @param {number} inicioMs */
function planificar(contexto, inicioMs) {
  const limite = contexto.incompleto ? SEGUNDO_CICLO : LIMITE_DIAS;
  for (let i = 0; i < limite && contexto.flexibles.length; i++) {
    const ms = inicioMs + i * DIA_MS,
      dia = fecha(ms);
    reservarDia(contexto, ms);
    if (contexto.incompleto && i + 1 >= PRIMER_CICLO && contexto.flexibles.every((c) => c.inicioPrevisto)) {
      break;
    }
    if (
      !contexto.incompleto &&
      contexto.flexibles.every((c) => c.finPrevisto || (c.limites.hasta && dia > c.limites.hasta))
    ) {
      break;
    }
  }
}
/** @param {CursoCronograma} curso @param {boolean} incompleto @param {string} finHorizonte */
function estadoFinal(curso, incompleto, finHorizonte) {
  if (curso.horasPublicadas === null) {
    return 'duracion-por-confirmar';
  }
  if (curso.finPrevisto) {
    return 'estimado';
  }
  if (incompleto) {
    return 'continuidad-abierta';
  }
  if (curso.limites.parciales) {
    return 'capacidad-por-confirmar';
  }
  if (curso.limites.hasta && curso.limites.hasta <= finHorizonte) {
    return 'capacidad-insuficiente';
  }
  return 'limite-de-planificacion';
}
/** @param {CursoCronograma[]} cursos @param {boolean} incompleto @param {AlertaCronograma[]} alertas @param {string} finHorizonte */
function cerrarCursos(cursos, incompleto, alertas, finHorizonte) {
  for (const curso of cursos) {
    curso.estado = estadoFinal(curso, incompleto, finHorizonte);
    if (['capacidad-insuficiente', 'capacidad-por-confirmar', 'limite-de-planificacion'].includes(curso.estado)) {
      alertas.push({ tipo: curso.estado, indice: curso.indice });
    }
  }
}
/** @param {ContextoReservas} contexto @param {number} inicioMs */
function calcularCapacidades(contexto, inicioMs) {
  for (const semana of contexto.semanas.values()) {
    for (let ms = instante(semana.inicio); ms <= instante(semana.fin); ms += DIA_MS) {
      if (ms >= inicioMs && contexto.disponibilidad.dias.includes(diaIso(ms))) {
        semana.capacidadMinutos += contexto.disponibilidad.minutosPorDia;
      }
    }
  }
}
/** @param {PlanElegido} plan */
export function crearCronogramaEstudio(plan) {
  const disponibilidad = validarDisponibilidad(plan.disponibilidad),
    inicioMs = instante(plan.preferencias.inicio);
  if (!inicioNoAnterior(plan.preferencias.inicio, plan.confirmadoEl)) {
    throw new TypeError('La fecha de inicio es anterior al día de confirmación');
  }
  const { cursos, sesiones, oficialesPorDia, alertas } = datosPublicados(plan);
  const flexibles = cursos.filter((c) => c.estado === 'planificable');
  const capacidadPorConfirmar = alertas.some((a) =>
    ['sesion-por-confirmar', 'horario-por-confirmar', 'incorporacion-por-confirmar', 'conflicto-sesiones'].includes(
      a.tipo,
    ),
  );
  const incompleto = capacidadPorConfirmar || flexibles.some((c) => c.horasPublicadas === null || c.provisional);
  /** @type {ContextoReservas} */ const contexto = {
    disponibilidad,
    flexibles,
    incompleto,
    capacidadPorConfirmar,
    turno: 0,
    oficialesPorDia,
    semanas: new Map(),
  };
  anotarSesiones(contexto, alertas);
  if (alertas.some((a) => ['sesion-fuera-disponibilidad', 'sesion-supera-disponibilidad'].includes(a.tipo))) {
    contexto.capacidadPorConfirmar = true;
    contexto.incompleto = true;
  }
  planificar(contexto, inicioMs);
  cerrarCursos(flexibles, contexto.incompleto, alertas, fecha(inicioMs + (LIMITE_DIAS - 1) * DIA_MS));
  calcularCapacidades(contexto, inicioMs);
  return {
    disponibilidad,
    capacidadPorConfirmar: contexto.capacidadPorConfirmar,
    semanas: [...contexto.semanas.values()].sort((a, b) => a.inicio.localeCompare(b.inicio)),
    cursos: cursos.map(({ limites: _limites, ...curso }) => curso),
    sesiones,
    alertas,
  };
}
