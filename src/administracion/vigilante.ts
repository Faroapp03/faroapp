/** Vigilancia pura independiente: no despacha, publica, consulta fuentes ni certifica un pulso continuo. */
import { diaUtc, MS_POR_DIA } from '../comun/tiempo.ts';
import type { EstadoActivacionPrivado } from './activacion.ts';
import { type ConfiguracionProgramada, leerCronDiario } from './configuracion-programada.ts';
import { type ConfiguracionVigilante, leerConfiguracionVigilante } from './configuracion-vigilante.ts';
import { type EstadoDatosPanel, leerEstadoDatosPanel } from './estado-datos.js';
import { esEnteroTrabajo, exigirTrabajo } from './estado-trabajos.js';
import { type EventoProgramado, leerEventoProgramado, MAX_EVENTOS_PROGRAMADOS } from './programacion-trabajos.ts';
import { evaluarComprobacionesDatos, resumirSaludDatos } from './salud-datos.js';
import {
  type EstadoTrabajos,
  type EstadoTrabajosPrivado,
  estadoPublicoTrabajos,
  leerEstadoTrabajosPrivado,
} from './trabajos.ts';
import { avisoSinPublicar, observarActivacion } from './vigilante-activacion.ts';
export interface MarcaProgramacion {
  readonly version: 1;
  readonly ultimoEventoEn: number | null;
  readonly registradoEn: number;
  /** Del más reciente al más antiguo; cada evento con su resultado, su motivo y, si falló, su fase. */
  readonly eventos: readonly EventoProgramado[];
}
export type OrigenDatosVigilante = 'recibo' | 'lectura-local';
export interface EntradasVigilante {
  readonly origenDatos?: OrigenDatosVigilante;
  readonly programacion: MarcaProgramacion;
  readonly trabajo: EstadoTrabajosPrivado;
  readonly datos: EstadoDatosPanel | null;
  readonly activacion: EstadoActivacionPrivado;
  readonly candidatoPendiente?: Readonly<{ solicitudId: string; desde: number; creadoEn: number }>;
}
export interface SoporteVigilante {
  readonly instanteUtc: string | null;
  readonly identidad: string;
}
/** Clave de orden para UTC contractual; conserva el original fuera de esta comparación. */
export function claveInstanteVigilante(instante: string): string {
  exigirTrabajo(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{6})?Z$/.test(instante));
  const finSegundos = 19;
  const segundoCivil = instante.slice(0, finSegundos);
  exigirTrabajo(new Date(`${segundoCivil}Z`).toISOString() === `${segundoCivil}.000Z`);
  return instante.includes('.') ? instante : instante.replace('Z', '.000000Z');
}
export interface DecisionVigilante {
  readonly clave: string;
  readonly estado: 'incidencia' | 'conforme';
  readonly motivo: string;
  readonly observadoEn: number;
  readonly referencia: string;
  readonly soporte?: SoporteVigilante;
  readonly canales?: readonly Readonly<{ canal: string; observadoEn: number; soporte: SoporteVigilante }>[];
}
export interface EvaluacionVigilante {
  readonly version: 1;
  readonly estado: 'deshabilitado' | 'evaluado';
  readonly evaluadoEn: number;
  readonly pulsoContinuo: 'no-instrumentado';
  readonly entregaActiva: 'sin-observacion-actual';
  readonly trabajoObservado: EstadoTrabajos | null;
  readonly eventosProgramados: readonly EventoProgramado[];
  readonly activacionObservada: Readonly<{
    fase: string;
    actualizadoEn: number;
    versionId: string | null;
    deploymentId: string | null;
  }> | null;
  readonly decisiones: readonly DecisionVigilante[];
  readonly mantenimiento: ReturnType<typeof resumirSaludDatos> | null;
  readonly fechaDatos: readonly Readonly<{ fuente: string; fecha: string | null }>[];
}
const MAX_FECHA_MS = 8_640_000_000_000_000;
function decision(
  clave: string,
  incidencia: boolean,
  motivo: string,
  soporte: { observadoEn: number; referencia: string },
): DecisionVigilante {
  return Object.freeze({ clave, estado: incidencia ? 'incidencia' : 'conforme', motivo, ...soporte });
}
function eventoEsperado(cron: string, ahora: number): number {
  const [minuto, hora] = leerCronDiario(cron).split(' ').map(Number);
  exigirTrabajo(minuto !== undefined && hora !== undefined);
  const fecha = new Date(ahora);
  const evento = Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate(), hora, minuto);
  return evento > ahora ? evento - MS_POR_DIA : evento;
}
function observarEjecutor(entradas: EntradasVigilante, config: ConfiguracionVigilante, ahora: number) {
  const trabajo = leerEstadoTrabajosPrivado(entradas.trabajo).ultimoTrabajo;
  if (trabajo === null) {
    return decision('ejecutor', false, 'sin_trabajo_reservado', { observadoEn: ahora, referencia: 'sin-trabajo' });
  }
  exigirTrabajo(trabajo.actualizadoEn <= ahora);
  const soporte = { observadoEn: ahora, referencia: `${trabajo.solicitudId}:${trabajo.revisionReserva}` };
  if (trabajo.estado === 'terminado') {
    const fallo = ['rechazado', 'despacho-rechazado', 'ejecucion-sin-recibo'].includes(
      trabajo.resultado?.resultado ?? '',
    );
    return decision(
      'ejecutor',
      fallo,
      fallo ? 'trabajo_terminado_sin_resultado_admitido' : 'trabajo_terminado',
      soporte,
    );
  }
  // Un permiso negado con evidencia es una incidencia desde que se registra: no espera al plazo de inicio.
  if (!trabajo.inicioConfirmado && trabajo.inicioRechazado !== undefined) {
    exigirTrabajo(trabajo.inicioRechazado.en <= ahora);
    return decision('ejecutor', true, 'inicio_rechazado', soporte);
  }
  if (!trabajo.inicioConfirmado) {
    return decision('ejecutor', ahora >= trabajo.creadoEn + config.plazoInicioMs, 'inicio_no_confirmado', soporte);
  }
  return decision(
    'ejecutor',
    ahora >= trabajo.actualizadoEn + config.plazoCierreMs,
    'inicio_confirmado_sin_cierre',
    soporte,
  );
}
/** Un evento consumido no supera la marca; un fallo sin consumir solo exige no ser posterior al corte. */
function eventoDentroDeLaMarca(e: EventoProgramado, marca: MarcaProgramacion, ahora: number): boolean {
  if (e.resultado === 'fallida') {
    return e.registradoEn <= ahora;
  }
  return e.registradoEn <= marca.registradoEn && marca.ultimoEventoEn !== null && e.eventoEn <= marca.ultimoEventoEn;
}
function leerEventosProgramados(marca: MarcaProgramacion, ahora: number): readonly EventoProgramado[] {
  exigirTrabajo(Array.isArray(marca.eventos) && marca.eventos.length <= MAX_EVENTOS_PROGRAMADOS);
  const eventos = marca.eventos.map(leerEventoProgramado);
  exigirTrabajo(
    eventos.every(
      (e, i) => eventoDentroDeLaMarca(e, marca, ahora) && (i === 0 || e.eventoEn < (eventos[i - 1]?.eventoEn ?? 0)),
    ),
  );
  return Object.freeze(eventos);
}
/**
 * Apagada a propósito es apagada con una pausa declarada y vigente (hasta su día UTC, incluido). Sin pausa, o con la
 * pausa vencida, es una incidencia: los datos no se actualizan solos. Solo avisa.
 */
function decisionProgramacionApagada(programada: ConfiguracionProgramada, ahora: number): DecisionVigilante {
  const enPausa = programada.pausaHasta !== undefined && diaUtc(ahora) <= programada.pausaHasta;
  return decision('programador', !enPausa, enPausa ? 'programacion_en_pausa' : 'programacion_apagada', {
    observadoEn: ahora,
    referencia: `apagada:${programada.pausaHasta ?? 'sin-pausa'}`,
  });
}
function observarProgramacion(
  marca: MarcaProgramacion,
  programada: ConfiguracionProgramada | undefined,
  config: ConfiguracionVigilante,
  ahora: number,
) {
  exigirTrabajo(marca.version === 1 && esEnteroTrabajo(marca.registradoEn) && marca.registradoEn <= ahora);
  exigirTrabajo(
    marca.ultimoEventoEn === null ||
      (esEnteroTrabajo(marca.ultimoEventoEn) && marca.ultimoEventoEn <= marca.registradoEn),
  );
  if (!programada) {
    return [];
  }
  if (!programada.habilitada) {
    return [decisionProgramacionApagada(programada, ahora)];
  }
  // El evento nuevo aún en margen no borra la falta de uno anterior ya exigible.
  const esperado = eventoEsperado(programada.cron, ahora - config.plazoEventoMs);
  const exigible = esperado >= config.activadoEn;
  const falta = exigible && (marca.ultimoEventoEn === null || marca.ultimoEventoEn < esperado);
  return [
    decision('programador', falta, falta ? 'evento_esperado_sin_registro' : 'sin_evento_vencido', {
      observadoEn: ahora,
      referencia: `${esperado}:${marca.ultimoEventoEn ?? 'sin-evento'}`,
    }),
  ];
}
function seguimientoFuente(datos: EstadoDatosPanel, id: string) {
  // Por presencia del campo: cada versión nueva conserva el seguimiento sin tener que nombrarla aquí.
  return 'seguimientoRemoto' in datos ? datos.seguimientoRemoto?.find((f) => f.fuente === id) : null;
}
function soporteTemporal(instanteUtc: string | null | undefined, identidad: unknown) {
  return {
    observadoEn: instanteUtc ? Date.parse(instanteUtc) : 0,
    soporte: { instanteUtc: instanteUtc ?? null, identidad: JSON.stringify(identidad) },
  };
}
function instanteMasReciente(positiva: string | null, fallida: string | null) {
  if (positiva === null || fallida === null) {
    return positiva ?? fallida;
  }
  return claveInstanteVigilante(positiva) > claveInstanteVigilante(fallida) ? positiva : fallida;
}
function canalesConjuntos(datos: EstadoDatosPanel, id: string) {
  if (datos.version === 1) {
    return [];
  }
  const seguimiento = seguimientoFuente(datos, id);
  return datos.comprobaciones.conjuntos
    .filter((c) => c.fuente === id)
    .map((c) => {
      const pendiente = seguimiento?.incidenciasPendientes.find((p) => p.conjunto === c.id)?.operacion;
      const positiva = c.ultimaComprobacion?.fecha ?? null;
      const fallida = pendiente?.finEn ?? pendiente?.inicioEn ?? null;
      // Comparación textual completa solo dentro del mismo conjunto.
      const instante = instanteMasReciente(positiva, fallida);
      return {
        canal: `conjunto:${c.id}`,
        ...soporteTemporal(instante, { positiva: c.ultimaComprobacion, pendiente: pendiente ?? null }),
      };
    });
}
/** Canales independientes: una reconstrucción local no constituye soporte causal remoto. */
function canalesFuente(datos: EstadoDatosPanel, id: string) {
  const modulo = datos.modulos.find((m) => m.id === id);
  const operacion = datos.version === 1 ? null : datos.fuentes.find((f) => f.id === id)?.ultimaOperacion;
  const remota = seguimientoFuente(datos, id)?.ultimoIntento ?? (operacion?.remoto ? operacion : null);
  return Object.freeze([
    { canal: 'local', ...soporteTemporal(modulo?.ultimoIntento, modulo ?? null) },
    { canal: 'remoto', ...soporteTemporal(remota?.finEn ?? remota?.inicioEn, remota ?? null) },
    ...canalesConjuntos(datos, id),
  ]);
}
function decisionesConjuntos(datos: EstadoDatosPanel, ahora: number): DecisionVigilante[] {
  const decisiones: DecisionVigilante[] = [];
  for (const c of evaluarComprobacionesDatos(datos, ahora)) {
    if (c.estado !== 'no-remota') {
      const declarada = datos.version === 1 ? null : datos.comprobaciones.conjuntos.find((fila) => fila.id === c.id);
      decisiones.push({
        ...decision(`conjunto:${c.id}`, c.estado !== 'comprobada', `comprobacion_${c.estado}`, {
          observadoEn: c.ultimaComprobacion ? Date.parse(c.ultimaComprobacion) : 0,
          // Soporte mínimo admitido: conserva precisión e identidad del recibo, sin duplicar la copia fijada.
          referencia: JSON.stringify({
            version: 2,
            ultimaComprobacion: c.ultimaComprobacion,
            proximaComprobacion: c.proximaComprobacion,
            identidad: JSON.stringify(declarada?.ultimaComprobacion ?? null),
          }),
        }),
        soporte: {
          instanteUtc: c.ultimaComprobacion,
          identidad: JSON.stringify(declarada?.ultimaComprobacion ?? null),
        },
      });
    }
  }
  return decisiones;
}
function observarFuentes(datos: EstadoDatosPanel, ahora: number) {
  const salud = resumirSaludDatos(datos, ahora);
  const decisiones: DecisionVigilante[] = [];
  for (const fuente of salud.operativas) {
    if (['incidencia', 'atencion', 'comprobada', 'local'].includes(fuente.estado)) {
      const canales = canalesFuente(datos, fuente.id);
      decisiones.push({
        ...decision(
          `fuente:${fuente.id}`,
          ['incidencia', 'atencion'].includes(fuente.estado),
          `mantenimiento_${fuente.estado}`,
          {
            observadoEn: Math.max(...canales.map((c) => c.observadoEn)),
            referencia: `${fuente.ultimaConsulta ?? 'sin-consulta'}:${fuente.resultadoConsulta ?? 'sin-resultado'}`,
          },
        ),
        canales,
      });
    }
  }
  decisiones.push(...decisionesConjuntos(datos, ahora));
  return { salud, decisiones };
}
/** Contrasta el DTO con el instante fiable del corte, sin consultar ni registrar otra autoridad. */
export function validarDatosVigilante(entrada: unknown, ahora: number): EstadoDatosPanel {
  const datos = leerEstadoDatosPanel(entrada);
  exigirTrabajo(Date.parse(datos.observadoEn) <= ahora);
  return datos;
}
function observarDatos(
  entrada: EstadoDatosPanel | null,
  config: ConfiguracionVigilante,
  ahora: number,
  origen: OrigenDatosVigilante,
) {
  if (entrada === null) {
    return {
      mantenimiento: null,
      fechaDatos: [],
      decisiones: [
        decision(
          origen === 'recibo' ? 'lectura-datos' : 'lectura-local',
          true,
          origen === 'recibo' ? 'sin_observacion_correlacionada' : 'lectura_local_no_disponible',
          {
            observadoEn: ahora,
            referencia: 'sin-observacion',
          },
        ),
      ],
    };
  }
  const datos = validarDatosVigilante(entrada, ahora);
  const observadoEn = Date.parse(datos.observadoEn);
  const antigua = ahora >= observadoEn + config.plazoObservacionMs;
  const { salud, decisiones } = observarFuentes(datos, ahora);
  decisiones.unshift(
    origen === 'recibo'
      ? decision(
          'lectura-datos',
          antigua,
          antigua ? 'observacion_de_mantenimiento_antigua' : 'observacion_disponible',
          {
            observadoEn: ahora,
            referencia: datos.observadoEn,
          },
        )
      : decision('lectura-local', false, 'lectura_local_disponible', {
          observadoEn: ahora,
          referencia: 'dto-validado',
        }),
    decision(
      'cobertura-datos',
      datos.version === 1,
      datos.version === 1 ? 'legado_sin_comprobaciones_por_conjunto' : 'contrato_con_comprobaciones',
      { observadoEn: ahora, referencia: `version:${datos.version}` },
    ),
  );
  return {
    mantenimiento: salud,
    fechaDatos: Object.freeze(datos.fuentes.map((f) => Object.freeze({ fuente: f.id, fecha: f.fecha }))),
    decisiones,
  };
}
/** El reloj debe representar un instante UTC válido antes de consultar o registrar hechos. */
export function validarRelojVigilante(config: ConfiguracionVigilante, ahora: number): void {
  exigirTrabajo(esEnteroTrabajo(ahora) && ahora <= MAX_FECHA_MS && ahora >= config.activadoEn);
}
export function evaluarVigilante(
  entradaConfig: unknown,
  programada: ConfiguracionProgramada | undefined,
  entradas: EntradasVigilante | null,
  ahora: number,
): EvaluacionVigilante {
  const config = leerConfiguracionVigilante(entradaConfig);
  validarRelojVigilante(config, ahora);
  const base = {
    version: 1,
    evaluadoEn: ahora,
    pulsoContinuo: 'no-instrumentado',
    entregaActiva: 'sin-observacion-actual',
  } as const;
  if (!config.habilitado) {
    return Object.freeze({
      ...base,
      estado: 'deshabilitado',
      trabajoObservado: null,
      eventosProgramados: [],
      activacionObservada: null,
      decisiones: [],
      mantenimiento: null,
      fechaDatos: [],
    });
  }
  exigirTrabajo(entradas !== null);
  const origen = entradas.origenDatos ?? 'recibo';
  exigirTrabajo(origen === 'recibo' || origen === 'lectura-local');
  const datos = observarDatos(entradas.datos, config, ahora, origen);
  // Sin lectura local no se confirma recuperación de otra autoridad por omisión.
  const decisiones =
    origen === 'lectura-local' && entradas.datos === null
      ? [...datos.decisiones, ...avisoSinPublicar(entradas, ahora, true)]
      : [
          observarEjecutor(entradas, config, ahora),
          ...observarProgramacion(entradas.programacion, programada, config, ahora),
          ...avisoSinPublicar(entradas, ahora),
          ...datos.decisiones,
        ];
  return Object.freeze({
    ...base,
    estado: 'evaluado',
    trabajoObservado: estadoPublicoTrabajos(entradas.trabajo),
    eventosProgramados: leerEventosProgramados(entradas.programacion, ahora),
    activacionObservada: observarActivacion(entradas.activacion, ahora),
    mantenimiento: datos.mantenimiento,
    fechaDatos: datos.fechaDatos,
    decisiones: Object.freeze(decisiones),
  });
}
