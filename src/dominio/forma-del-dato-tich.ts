// La forma del dato de la TIC-H que el paquete no puede traer mal: los años que mide y la edición nueva observada. Un
// dato mal formado se corta antes de publicar: lo rechaza la validación de Python (tich.validar) y, si aun así llegara
// al paquete, cargarDatos en Node, con lo que fallan las pruebas e `informe:comprobar`. Si pese a las dos guardias
// llegara a un dispositivo, el corte es de todo o nada: el navegador se queda sin paquete y el Worker falla en cada
// informe que lea la TIC-H, en vez de pintar un año, una fecha o una serie que no ha podido leer.

import { fechaIso, partesEnZona } from '../comun/fechas.js';
import type { DatosTich, EdicionNuevaDeLaTich } from './tipos-contexto.ts';

const ANIO = /^\d{4}$/u;
const GRUPO = /^\d{2}$/u;
const HUELLA = /^[0-9a-f]{64}$/u;
const INSTANTE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/u;
const ESTADOS: readonly EdicionNuevaDeLaTich['estado'][] = ['publicada-sin-microdatos', 'pendiente-de-incorporar'];

function rechazar(motivo: string): never {
  throw new Error(`TIC-H: ${motivo}`);
}

/** Los años que mide el dato, en orden, sin repetir y con el de la edición al final; sin la lista, solo ese año. */
export function aniosMedidos(tich: DatosTich): string[] {
  const anios = tich.anios_medidos ?? [tich.anio];
  const enOrden = anios.every((anio, i) => ANIO.test(anio) && (i === 0 || Number(anios[i - 1]) < Number(anio)));
  if (anios.length === 0 || !enOrden || anios.at(-1) !== tich.anio) {
    rechazar(`los años medidos ${JSON.stringify(anios)} no van en orden, sin repetir y terminando en ${tich.anio}`);
  }
  return [...anios];
}

/**
 * El día de Barcelona (AAAA-MM-DD) en que se observó la edición nueva, tras exigir su forma: la comprobación de las
 * 23:30 UTC ya es del día siguiente.
 */
export function diaObservado(nueva: EdicionNuevaDeLaTich, anioDelDato: string): string {
  const instante = new Date(nueva.observado_utc);
  const valida =
    ESTADOS.includes(nueva.estado) &&
    ANIO.test(nueva.anio) &&
    Number(nueva.anio) > Number(anioDelDato) &&
    INSTANTE.test(nueva.observado_utc) &&
    Number.isFinite(instante.getTime()) &&
    HUELLA.test(nueva.sha256_catalogo);
  if (!valida) {
    rechazar('la edición nueva del dato no tiene la forma esperada');
  }
  return fechaIso(partesEnZona(instante));
}

/** Los grupos sin clase en la edición: códigos de 2 cifras, en orden, sin repetir y ninguno con clase. */
function gruposSinClase(tich: DatosTich): void {
  const grupos = tich.grupos_sin_clase ?? [];
  const validos = grupos.every(
    (grupo, i) =>
      GRUPO.test(grupo) && (i === 0 || (grupos[i - 1] ?? '') < grupo) && !Object.hasOwn(tich.clase_por_isco2, grupo),
  );
  if (!validos) {
    rechazar(`los grupos sin clase ${JSON.stringify(grupos)} no son grupos de 2 cifras, en orden y sin clase`);
  }
}

/** Exige la forma del dato de la TIC-H de un paquete; lo devuelve tal cual. */
export function comprobarTich(tich: DatosTich): DatosTich {
  aniosMedidos(tich);
  gruposSinClase(tich);
  if (tich.edicion_nueva !== undefined) {
    diaObservado(tich.edicion_nueva, tich.anio);
  }
  return tich;
}
