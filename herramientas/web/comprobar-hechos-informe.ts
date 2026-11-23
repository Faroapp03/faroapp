// Comprobación local del registro editorial: no consulta fuentes ni renueva sus fechas.
import { readFileSync } from 'node:fs';
import { esObjeto } from '../../src/comun/json.ts';
import { hoyUtc, MS_POR_DIA } from '../../src/comun/tiempo.ts';
import { leerHechosDelInforme } from '../../src/dominio/registro-hechos-del-informe.ts';
import { ejecutar, orden } from '../comun/opciones.ts';

const REGISTRO = new URL('../../plataforma_datos/ia_y_trabajo/fuentes/hechos_informe/registro.json', import.meta.url);
const FUENTE = new URL('./fuente.json', REGISTRO);
/** El plazo avisa de revisión pendiente: no invalida hechos ni renueva su comprobación. */
export function comprobarHechosDelInforme(contenido: unknown, hoy: string) {
  return comprobarHechosValidados(leerHechosDelInforme(contenido), hoy);
}

function comprobarHechosValidados(registro: ReturnType<typeof leerHechosDelInforme>, hoy: string) {
  const dia = Date.parse(`${hoy}T00:00:00Z`);
  const revision = Date.parse(`${registro.revision.fecha}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/u.test(hoy) ||
    !Number.isFinite(dia) ||
    new Date(dia).toISOString().slice(0, hoy.length) !== hoy ||
    dia < revision
  ) {
    throw new Error('Hechos del informe: día de control no válido o anterior a la revisión editorial');
  }
  const vence = new Date(revision + registro.revision.plazo_dias * MS_POR_DIA).toISOString().slice(0, hoy.length);
  return {
    version: registro.version,
    revision: registro.revision.fecha,
    vence,
    revision_pendiente: hoy > vence,
    afirmaciones: Object.keys(registro.afirmaciones).length,
    remoto: false,
  };
}

/** Control de la entrada versionada antes de construir; no escribe ni cambia su revisión. */
export function comprobarRegistroHechos(ruta: string | URL = REGISTRO, hoy: string = hoyUtc()) {
  const registro = leerHechosDelInforme(JSON.parse(readFileSync(ruta, 'utf8')));
  const resultado = comprobarHechosValidados(registro, hoy);
  const descriptor: unknown = JSON.parse(readFileSync(FUENTE, 'utf8'));
  if (
    !esObjeto(descriptor) ||
    !esObjeto(descriptor.actualizacion) ||
    descriptor.actualizacion.politica !== 'redactada' ||
    descriptor.actualizacion.red !== false ||
    descriptor.actualizacion.renovar_dias !== registro.revision.plazo_dias
  ) {
    throw new Error('Hechos del informe: plazo o política distintos del registro común');
  }
  return resultado;
}

if (import.meta.main) {
  const uso = 'node herramientas/web/comprobar-hechos-informe.ts [RUTA]';
  const { positionals } = orden(uso).leer({ allowPositionals: true, options: {} });
  if (positionals.length > 1) {
    console.error(`Error: indica como máximo una ruta\nUso: ${uso}`);
    process.exit(2);
  }
  await ejecutar(() => {
    // El lector Python puede pedir otra ruta explícita al validar una copia aislada del registro.
    const ruta = positionals[0] ?? REGISTRO;
    console.log(JSON.stringify(comprobarRegistroHechos(ruta)));
  }, 'Hechos editoriales del informe');
}
