/**
 * Relevo de una activación por el intento siguiente de la ejecución que manda en ella, en la misma transacción: solo
 * con la evidencia de que el intento anterior terminó.
 */
import {
  autoridadActivacion,
  type EvidenciaIntentoActivacionCompletado,
  evidenciaIntentoCoincide,
  leerEvidenciaIntentoActivacion,
  type ResultadoTransicionActivacion,
  type SolicitudActivacion,
} from '../../administracion/activacion.ts';
import type { IdentidadEjecucionGitHub } from '../../administracion/oidc-github.ts';
import { coincide, guardar, leerActivacionSqlite, resultado } from './activacion-sqlite.ts';
import type { SqlAccesoPublico } from './sqlite.ts';
import { identidadCoincide } from './trabajos-sqlite.ts';

export function recuperarActivacionSqlite(
  sql: SqlAccesoPublico,
  solicitud: SolicitudActivacion,
  {
    identidad,
    anterior: entrada,
  }: { identidad: IdentidadEjecucionGitHub; anterior: EvidenciaIntentoActivacionCompletado },
  ahora: number,
): ResultadoTransicionActivacion {
  const estado = leerActivacionSqlite(sql, ahora);
  const a = estado.ultimaActivacion;
  const anterior = leerEvidenciaIntentoActivacion(entrada);
  const autoridad = a && autoridadActivacion(a);
  if (
    !a ||
    !autoridad ||
    !coincide(a, solicitud) ||
    Number(identidad.runAttempt) <= 1 ||
    identidad.runId !== autoridad.runId ||
    !identidadCoincide(identidad, autoridad.confianza, ahora, identidad.runAttempt) ||
    !evidenciaIntentoCoincide(anterior, autoridad) ||
    Number(anterior.runAttempt) !== Number(identidad.runAttempt) - 1
  ) {
    return resultado('conflicto', estado);
  }
  if (a.recuperacion?.intento === identidad.runAttempt) {
    return resultado(
      solicitud.revisionEsperada === a.recuperacion.revisionBase &&
        JSON.stringify(anterior) === JSON.stringify(a.recuperacion.anterior)
        ? 'repetido'
        : 'conflicto',
      estado,
    );
  }
  if (
    solicitud.revisionEsperada !== estado.revision ||
    Number(identidad.runAttempt) <= Number(a.recuperacion?.intento ?? '1')
  ) {
    return resultado('conflicto', estado);
  }
  return guardar(
    sql,
    estado,
    {
      ...a,
      actualizadoEn: ahora,
      recuperacion: { version: 1, intento: identidad.runAttempt, revisionBase: estado.revision, anterior },
    },
    ahora,
  );
}
