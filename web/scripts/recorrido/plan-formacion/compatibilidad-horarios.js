import { esAsincronaEnPlan } from './sincronia-proveedor.js';

/** Contrasta solo sesiones publicadas con hora y zona. No convierte periodos o acceso al aula en citas. */
/** @import { PlanElegido, OpcionPlan } from './contrato.js' */
/** @typedef {{inicio:number,fin:number,indice:number,desfase:number}} Intervalo */
/** @typedef {{inicio:string,fin:string,indices:number[]}} Conflicto */
const MS_MINUTO = 60_000;
const MS_HORA = 3_600_000;
const MS_DIA = 86_400_000;
const DIAS_SEMANA = 7;
const AJUSTE_LUNES = 6;
const FECHA_HORA = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|([+-])(\d{2}):(\d{2}))$/;
/** @param {string} fecha */
function diaValido(fecha) {
  const instante = Date.parse(`${fecha}T00:00:00Z`);
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(fecha) &&
    Number.isFinite(instante) &&
    new Date(instante).toISOString().slice(0, 10) === fecha
  );
}
/** @param {unknown} fecha */
function instanteDeclarado(fecha) {
  if (typeof fecha !== 'string') {
    return null;
  }
  const partes = FECHA_HORA.exec(fecha);
  if (!partes || fecha.endsWith('-00:00')) {
    return null;
  }
  const [, dia, hora, minuto, segundo, zona, signo, horasZona, minutosZona] = partes;
  const instante = Date.parse(fecha);
  if (
    !dia ||
    !diaValido(dia) ||
    !Number.isFinite(instante) ||
    Number(hora) >= 24 ||
    Number(minuto) >= 60 ||
    Number(segundo ?? 0) >= 60
  ) {
    return null;
  }
  const minutos = zona === 'Z' ? 0 : Number(horasZona) * 60 + Number(minutosZona);
  return { instante, desfase: minutos * MS_MINUTO * (signo === '-' ? -1 : 1) };
}
/** @param {OpcionPlan} opcion @param {number} indice @param {number} umbral */
function sesionesDeOpcion(opcion, indice, umbral) {
  const hecho = opcion.oferta.hechos.calendario_formacion;
  const calendario = hecho.motivo === 'conocido' ? hecho.valor : null;
  if (!calendario || typeof calendario !== 'object' || !('tipo' in calendario) || calendario.tipo !== 'sesiones') {
    return { intervalos: [], incorporacion: false, incompleto: !esAsincronaEnPlan(opcion) };
  }
  /** @type {Intervalo[]} */ const intervalos = [];
  const vistas = new Set();
  let incompleto = calendario.sesiones.length === 0;
  let incorporacion = false;
  for (const sesion of calendario.sesiones) {
    const inicio = instanteDeclarado(sesion.inicio);
    const fin = instanteDeclarado(sesion.fin);
    incorporacion ||= inicio !== null && inicio.instante < umbral;
    if (!inicio || !fin || fin.instante <= inicio.instante) {
      incompleto = true;
      continue;
    }
    if (fin.instante <= umbral) {
      continue;
    }
    const desde = Math.max(inicio.instante, umbral);
    const clave = `${desde}/${fin.instante}`;
    if (!vistas.has(clave)) {
      intervalos.push({ inicio: desde, fin: fin.instante, indice, desfase: inicio.desfase });
      vistas.add(clave);
    }
  }
  return { intervalos, incorporacion, incompleto };
}
/** @param {Intervalo[]} intervalos @returns {Conflicto[]} */
function conflictosEntreCursos(intervalos) {
  const encontrados = new Map();
  for (const a of intervalos) {
    for (const b of intervalos) {
      if (a.indice >= b.indice) {
        continue;
      }
      const inicio = Math.max(a.inicio, b.inicio);
      const fin = Math.min(a.fin, b.fin);
      if (inicio < fin) {
        const indices = [a.indice, b.indice];
        encontrados.set(`${inicio}/${fin}/${indices.join(',')}`, {
          inicio: new Date(inicio).toISOString(),
          fin: new Date(fin).toISOString(),
          indices,
        });
      }
    }
  }
  return [...encontrados.values()].sort((a, b) => a.inicio.localeCompare(b.inicio) || a.fin.localeCompare(b.fin));
}
/** Lunes local representado como fecha UTC ficticia para no depender de la zona del dispositivo.
 * @param {number} instanteLocal */
function lunesLocal(instanteLocal) {
  const fecha = new Date(instanteLocal);
  fecha.setUTCDate(fecha.getUTCDate() - ((fecha.getUTCDay() + AJUSTE_LUNES) % DIAS_SEMANA));
  fecha.setUTCHours(0, 0, 0, 0);
  return fecha.getTime();
}
/** Cada cita usa el desplazamiento horario declarado en su inicio; la duración procede de los instantes reales.
 * @param {Intervalo} intervalo */
function repartirSemanas(intervalo) {
  const partes = [];
  let inicio = intervalo.inicio;
  while (inicio < intervalo.fin) {
    const lunes = lunesLocal(inicio + intervalo.desfase);
    const fin = Math.min(intervalo.fin, lunes + DIAS_SEMANA * MS_DIA - intervalo.desfase);
    partes.push({ semana: new Date(lunes).toISOString().slice(0, 10), inicio, fin, indice: intervalo.indice });
    inicio = fin;
  }
  return partes;
}
/** Unión por curso: una cita repetida o intervalos internos superpuestos no duplican dedicación.
 * @param {{inicio:number,fin:number}[]} intervalos */
function horasUnidas(intervalos) {
  let fin = Number.NEGATIVE_INFINITY;
  let total = 0;
  for (const intervalo of intervalos.sort((a, b) => a.inicio - b.inicio)) {
    total += Math.max(0, intervalo.fin - Math.max(fin, intervalo.inicio));
    fin = Math.max(fin, intervalo.fin);
  }
  return total / MS_HORA;
}
/** Carga publicada, sin compararla con una disponibilidad personal no preguntada.
 * @param {Intervalo[]} intervalos */
function semanasLectivas(intervalos) {
  /** @type {Map<string,{inicio:string,partes:{inicio:number,fin:number}[]}>} */ const porCurso = new Map();
  for (const parte of intervalos.flatMap(repartirSemanas)) {
    const clave = `${parte.indice}/${parte.semana}`;
    const grupo = porCurso.get(clave) ?? { inicio: parte.semana, partes: [] };
    grupo.partes.push(parte);
    porCurso.set(clave, grupo);
  }
  /** @type {Map<string,number>} */ const totales = new Map();
  for (const grupo of porCurso.values()) {
    totales.set(grupo.inicio, (totales.get(grupo.inicio) ?? 0) + horasUnidas(grupo.partes));
  }
  return [...totales].map(([inicio, horas]) => ({ inicio, horas })).sort((a, b) => a.inicio.localeCompare(b.inicio));
}
/** Datos puros para orientar la elección; compatibilidad horaria no acredita inscripción o admisión.
 * `incompleto` y `pendientes` conservan la incertidumbre global por compatibilidad.
 * `incorporacionPendiente` solo recoge inicios de sesión observados antes del umbral;
 * `horariosIncompletos` separa datos horarios ausentes o inválidos.
 * @param {PlanElegido} plan */
export function evaluarHorarios(plan) {
  const { inicio } = plan.preferencias;
  const confirmado = instanteDeclarado(plan.confirmadoEl);
  if (!diaValido(inicio) || !confirmado) {
    throw new TypeError('El plan necesita inicio y confirmación válidos');
  }
  const umbral = Math.max(Date.parse(`${inicio}T00:00:00Z`), confirmado.instante);
  const cursos = plan.elecciones.map((opcion, indice) => sesionesDeOpcion(opcion, indice, umbral));
  const intervalos = cursos.flatMap((curso) => curso.intervalos);
  const incorporacionPendiente = cursos.flatMap((curso, indice) => (curso.incorporacion ? [indice] : []));
  const horariosIncompletos = cursos.flatMap((curso, indice) => (curso.incompleto ? [indice] : []));
  const pendientes = cursos.flatMap((curso, indice) => (curso.incorporacion || curso.incompleto ? [indice] : []));
  const asincronos = plan.elecciones.flatMap((opcion, indice) => (esAsincronaEnPlan(opcion) ? [indice] : []));
  const conflictos = conflictosEntreCursos(intervalos);
  /** @type {'conflicto'|'compatible'|'por-confirmar'} */ let estado = 'compatible';
  if (conflictos.length) {
    estado = 'conflicto';
  } else if (pendientes.length) {
    estado = 'por-confirmar';
  }
  return {
    conflictos,
    semanasLectivas: semanasLectivas(intervalos),
    estado,
    incompleto: pendientes.length > 0,
    pendientes,
    asincronos,
    incorporacionPendiente,
    horariosIncompletos,
  };
}
