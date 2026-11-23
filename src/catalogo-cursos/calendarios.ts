/** Fechas publicadas por edición: conserva precisión civil, hora local y zona explícita. */
import { fechaIso, partesEnZona, ZONA_BARCELONA } from '../comun/fechas.js';
import { esObjeto } from '../comun/json.ts';
import type { CalendarioCatalogo, OfertaCatalogo, PeriodoCalendario } from './contrato.ts';

const FECHA = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?(Z|[+-]\d{2}:\d{2})?)?$/u;
const MAX_SESIONES = 1_000;
const CAMPOS_PERIODO = 3;
const MICROS_POR_MILI = 1_000n;
const MICROS_POR_MINUTO = 60_000_000n;
const HORAS_DIA = 24;
const MINUTOS_HORA = 60;
const MICROS_DIGITOS = 6;
const LONGITUD_DIA = 10;
interface FechaPublicada {
  readonly dia: string;
  readonly clase: 'civil' | 'local' | 'instante';
  readonly clave: bigint;
}
function desfaseZona(zona: string | undefined): number | undefined {
  if (!zona || zona === 'Z') {
    return 0;
  }
  const [horas, minutos] = zona.slice(1).split(':').map(Number);
  if (horas === undefined || minutos === undefined || horas >= HORAS_DIA || minutos >= MINUTOS_HORA) {
    return undefined;
  }
  return (horas * MINUTOS_HORA + minutos) * (zona[0] === '-' ? -1 : 1);
}
function claseFecha(hora: string | undefined, zona: string | undefined): FechaPublicada['clase'] {
  if (hora === undefined) {
    return 'civil';
  }
  return !zona || zona === '-00:00' ? 'local' : 'instante';
}
function horaValida(p: RegExpExecArray): boolean {
  return Number(p[2] ?? 0) < HORAS_DIA && Number(p[3] ?? 0) < MINUTOS_HORA && Number(p[4] ?? 0) < MINUTOS_HORA;
}
function fechaPublicada(valor: unknown): FechaPublicada | undefined {
  if (typeof valor !== 'string') {
    return undefined;
  }
  const p = FECHA.exec(valor);
  if (!p?.[1] || p[1].startsWith('0000') || !horaValida(p)) {
    return undefined;
  }
  const dia = p[1];
  const civil = Date.parse(`${dia}T00:00:00Z`);
  const minutosZona = desfaseZona(p[6]);
  if (
    !Number.isFinite(civil) ||
    new Date(civil).toISOString().slice(0, LONGITUD_DIA) !== dia ||
    minutosZona === undefined
  ) {
    return undefined;
  }
  const base = Date.parse(`${dia}T${p[2] ?? '00'}:${p[3] ?? '00'}:${p[4] ?? '00'}Z`);
  return {
    dia,
    clase: claseFecha(p[2], p[6]),
    clave:
      BigInt(base) * MICROS_POR_MILI +
      BigInt((p[5] ?? '').padEnd(MICROS_DIGITOS, '0')) -
      BigInt(minutosZona) * MICROS_POR_MINUTO,
  };
}
export function esDiaCivil(valor: unknown): valor is string {
  return fechaPublicada(valor)?.clase === 'civil';
}
function esPeriodo(valor: unknown): valor is PeriodoCalendario {
  if (!esObjeto(valor) || Object.keys(valor).length !== 2 || !('inicio' in valor) || !('fin' in valor)) {
    return false;
  }
  const inicio = valor.inicio === null ? null : fechaPublicada(valor.inicio);
  const fin = valor.fin === null ? null : fechaPublicada(valor.fin);
  return (
    inicio !== undefined &&
    fin !== undefined &&
    !!(inicio || fin) &&
    (!inicio || !fin || inicio.clase !== fin.clase || inicio.clave <= fin.clave)
  );
}
/** Una sesión no es un intervalo global; claves adicionales y días imposibles se rechazan. */
export function esCalendario(valor: unknown): valor is CalendarioCatalogo {
  if (!esObjeto(valor)) {
    return false;
  }
  if (valor.tipo === 'sesiones') {
    return (
      Object.keys(valor).length === 2 &&
      Array.isArray(valor.sesiones) &&
      valor.sesiones.length > 0 &&
      valor.sesiones.length <= MAX_SESIONES &&
      Array.from(valor.sesiones).every(esPeriodo)
    );
  }
  return (
    ['matricula', 'periodo-formativo', 'ventana-acceso'].includes(String(valor.tipo)) &&
    Object.keys(valor).length === CAMPOS_PERIODO &&
    esPeriodo({ inicio: valor.inicio, fin: valor.fin })
  );
}
function periodos(calendario: CalendarioCatalogo): readonly PeriodoCalendario[] {
  return calendario.tipo === 'sesiones' ? calendario.sesiones : [calendario];
}
function diaActual(ahora: number): string {
  return fechaIso(partesEnZona(ahora, ZONA_BARCELONA));
}
export function diaCivilDeInstante(instante: bigint): string {
  const ajuste = instante < 0n ? MICROS_POR_MILI - 1n : 0n;
  return diaActual(Number((instante - ajuste) / MICROS_POR_MILI));
}
function diaDeFecha(fecha: FechaPublicada | undefined): string | undefined {
  if (!fecha) {
    return undefined;
  }
  if (fecha.clase !== 'instante') {
    return fecha.dia;
  }
  return diaCivilDeInstante(fecha.clave);
}
function diaDisponible(periodo: PeriodoCalendario, hoy: string, ahora: number): string | undefined {
  const comienzo = fechaPublicada(periodo.inicio);
  const termino = fechaPublicada(periodo.fin);
  if (termino?.clase === 'instante' && termino.clave < BigInt(ahora) * MICROS_POR_MILI) {
    return undefined;
  }
  const inicio = diaDeFecha(comienzo);
  const fin = diaDeFecha(termino);
  if (!inicio || (fin && fin < hoy)) {
    return undefined;
  }
  // Solo los instantes con zona explícita se convierten al día de Cataluña.
  if (inicio >= hoy) {
    return inicio;
  }
  return fin && fin >= hoy ? hoy : undefined;
}
function limitesComparables(
  calendario: CalendarioCatalogo,
): { inicio: FechaPublicada; fin: FechaPublicada } | undefined {
  const p = periodos(calendario);
  const inicios = p.map((s) => fechaPublicada(s.inicio));
  const finales = p.map((s) => fechaPublicada(s.fin));
  const clase = inicios[0]?.clase;
  if (!clase || [...inicios, ...finales].some((fecha) => !fecha || fecha.clase !== clase)) {
    return undefined;
  }
  const comparar = (a: FechaPublicada | undefined, b: FechaPublicada | undefined) => {
    if (!a || !b || a.clave === b.clave) {
      return 0;
    }
    return a.clave < b.clave ? -1 : 1;
  };
  const inicio = inicios.sort(comparar)[0];
  const fin = finales.sort(comparar).at(-1);
  return inicio && fin ? { inicio, fin } : undefined;
}
function sonDisjuntos(a: CalendarioCatalogo, b: CalendarioCatalogo): boolean {
  const x = limitesComparables(a);
  const y = limitesComparables(b);
  if (!x || !y || x.inicio.clase !== y.inicio.clase) {
    return false;
  }
  return x.fin.clave < y.inicio.clave || y.fin.clave < x.inicio.clave;
}
/** Ordena por día de formación o acceso, nunca matrícula; no decide la visibilidad. */
export function diaDeCursado(
  oferta: {
    readonly hechos: Readonly<
      Record<
        'calendario_formacion' | 'calendario_aula',
        Pick<OfertaCatalogo['hechos']['calendario_formacion'], 'valor' | 'motivo'>
      >
    >;
  },
  ahora: number,
): string | undefined {
  const formacion = oferta.hechos.calendario_formacion;
  const aula = oferta.hechos.calendario_aula;
  if ([formacion, aula].some((h) => h.motivo === 'declaraciones_contradictorias')) {
    return undefined;
  }
  const f = formacion.motivo === 'conocido' && esCalendario(formacion.valor) ? formacion.valor : undefined;
  const a = aula.motivo === 'conocido' && esCalendario(aula.valor) ? aula.valor : undefined;
  if (f && a && sonDisjuntos(f, a)) {
    return undefined;
  }
  const calendario = f ?? a;
  if (!calendario) {
    return undefined;
  }
  const hoy = diaActual(ahora);
  return periodos(calendario)
    .flatMap((p) => {
      const dia = diaDisponible(p, hoy, ahora);
      return dia ? [dia] : [];
    })
    .sort()[0];
}
