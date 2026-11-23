/** Entrada local independiente; preparación explícita y cero consultas de red o activación remota. */
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import type { ConfiguracionProgramada } from '../../src/administracion/configuracion-programada.ts';
import { configuracionProgramadaDelEntorno } from '../../src/administracion/configuracion-programada.ts';
import type { ConfiguracionVigilante } from '../../src/administracion/configuracion-vigilante.ts';
import { leerConfiguracionVigilante } from '../../src/administracion/configuracion-vigilante.ts';
import type { LectorEstadoDatosPanel } from '../../src/administracion/estado-datos.js';
import { evaluarVigilante, validarRelojVigilante } from '../../src/administracion/vigilante.ts';
import type { VariablesDelEntorno } from '../../src/comun/entorno.ts';
import { abrirSqlAdministrativoNode } from '../../src/plataforma/acceso-publico/node.ts';
import type { SqlAccesoPublico } from '../../src/plataforma/acceso-publico/sqlite.ts';
import {
  comprobarVigilanteConLecturaLocalSqlite,
  comprobarVigilanteSqlite,
  exigirVigilantePreparadoSqlite,
  leerHistorialVigilanteSqlite,
  prepararVigilanteSqlite,
  registrarFalloLecturaLocalVigilanteSqlite,
} from '../../src/plataforma/acceso-publico/vigilante-sqlite.ts';
import { crearLectorEstadoDatosNode, PLAZO_ESTADO_DATOS_MS } from '../../src/plataforma/node/estado-datos.ts';
import { leerYComprobarVigilante } from '../../src/plataforma/node/lectura-vigilante.ts';

const MAX_CONFIG_BYTES = 4096;
const CABECERA_SQLITE = Buffer.from('SQLite format 3\0');
function leerConfiguracion(ruta: string) {
  const descriptor = openSync(ruta, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const estado = fstatSync(descriptor);
    if (!estado.isFile() || estado.nlink !== 1 || estado.size > MAX_CONFIG_BYTES) {
      throw new Error('Configuración no verificable');
    }
    const bytes = Buffer.alloc(MAX_CONFIG_BYTES + 1);
    let usados = 0;
    while (usados < bytes.length) {
      const n = readSync(descriptor, bytes, usados, bytes.length - usados, null);
      if (n === 0) {
        break;
      }
      usados += n;
    }
    if (usados > MAX_CONFIG_BYTES) {
      throw new Error('Configuración fuera de cota');
    }
    return leerConfiguracionVigilante(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, usados))),
    );
  } finally {
    closeSync(descriptor);
  }
}
/** La operación y las dos rutas son argumentos privados; el JSON solo contiene la política de vigilancia. */
function parametros(args: readonly string[], operaciones: readonly string[]) {
  const [operacion, base, configuracion, ...resto] = args;
  if (
    !operacion ||
    !operaciones.includes(operacion) ||
    !base ||
    !configuracion ||
    resto.length ||
    !isAbsolute(base) ||
    !isAbsolute(configuracion)
  ) {
    throw new Error(
      'Uso: vigilante.ts {preparar|verificar|verificar-local|historial} /base/administrativa.sqlite /configuracion.json',
    );
  }
  return { operacion, base, config: leerConfiguracion(configuracion) };
}
function abrirBase(base: string) {
  const estado = lstatSync(base);
  if (!estado.isFile() || estado.nlink !== 1) {
    throw new Error('Base administrativa no verificable');
  }
  const descriptor = openSync(base, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const cabecera = Buffer.alloc(CABECERA_SQLITE.length);
    if (
      readSync(descriptor, cabecera, 0, cabecera.length, 0) !== cabecera.length ||
      !cabecera.equals(CABECERA_SQLITE)
    ) {
      throw new Error('Base administrativa sin cabecera SQLite verificable');
    }
  } finally {
    closeSync(descriptor);
  }
  return abrirSqlAdministrativoNode(base);
}
/** Conserva el modo por recibo y las operaciones síncronas existentes. */
export function ejecutarVigilanteLocal(
  args: readonly string[],
  variables: VariablesDelEntorno = {},
  reloj: () => number = Date.now,
) {
  const { operacion, base, config } = parametros(args, ['preparar', 'verificar', 'historial']);
  const ahora = reloj();
  validarRelojVigilante(config, ahora);
  if (!config.habilitado) {
    return { codigo: 0, resultado: { origenDatos: 'recibo', ...evaluarVigilante(config, undefined, null, ahora) } };
  }
  const conexion = abrirBase(base);
  try {
    if (operacion === 'preparar') {
      prepararVigilanteSqlite(conexion.sql, config, ahora);
      return { codigo: 0, resultado: { estado: 'preparado' } };
    }
    if (operacion === 'historial') {
      return { codigo: 0, resultado: leerHistorialVigilanteSqlite(conexion.sql, ahora) };
    }
    const programada = configuracionProgramadaDelEntorno(variables);
    const resultado = comprobarVigilanteSqlite(conexion.sql, config, programada, ahora);
    return { codigo: resultado.incidencias.length ? 1 : 0, resultado };
  } finally {
    conexion.close();
  }
}
export interface OpcionesLecturaLocalVigilante {
  readonly leerEstadoDatos?: LectorEstadoDatosPanel;
  readonly senal?: AbortSignal;
}
/** Fallo propio distinto de una incidencia del mantenimiento; conserva la causa privada original. */
export class ErrorLecturaLocalVigilante extends Error {
  readonly codigo = 2;
  readonly resultado: ReturnType<typeof registrarFalloLecturaLocalVigilanteSqlite>;
  constructor(causa: unknown, resultado: ReturnType<typeof registrarFalloLecturaLocalVigilanteSqlite>) {
    super('La lectura local no está disponible; no se confirma recuperación.', { cause: causa });
    this.name = 'ErrorLecturaLocalVigilante';
    this.resultado = resultado;
  }
}
function registrarFallo(
  error: unknown,
  sql: SqlAccesoPublico,
  politica: { config: ConfiguracionVigilante; programada: ConfiguracionProgramada | undefined },
  ahora: number,
): never {
  let resultado: ReturnType<typeof registrarFalloLecturaLocalVigilanteSqlite>;
  try {
    resultado = registrarFalloLecturaLocalVigilanteSqlite(sql, politica.config, politica.programada, ahora);
  } catch (registro) {
    throw new AggregateError([error, registro], 'La lectura local falló y no pudo registrarse.', { cause: error });
  }
  throw new ErrorLecturaLocalVigilante(error, resultado);
}
/** Consulta la instalación del mismo lector del panel: ningún JSON elige rutas, ejecutables o datos. */
export async function ejecutarVigilanteConLecturaLocal(
  args: readonly string[],
  variables: VariablesDelEntorno = {},
  reloj: () => number = Date.now,
  opciones: OpcionesLecturaLocalVigilante = {},
) {
  const { base, config } = parametros(args, ['verificar-local']);
  const inicio = reloj();
  validarRelojVigilante(config, inicio);
  if (!config.habilitado) {
    return {
      codigo: 0,
      resultado: { origenDatos: 'lectura-local', ...evaluarVigilante(config, undefined, null, inicio) },
    };
  }
  const programada = configuracionProgramadaDelEntorno(variables);
  const senal = opciones.senal ?? AbortSignal.timeout(PLAZO_ESTADO_DATOS_MS);
  senal.throwIfAborted();
  // Autoridad inexistente o no verificable: no consultar ni crear una base para simular registro.
  const conexion = abrirBase(base);
  try {
    const resultado = await leerYComprobarVigilante({
      configuracion: config,
      reloj,
      senal,
      lector: opciones.leerEstadoDatos ?? crearLectorEstadoDatosNode(),
      preparar: async () => {
        exigirVigilantePreparadoSqlite(conexion.sql, config, inicio);
        return undefined;
      },
      confirmar: async (datos, ahora) =>
        comprobarVigilanteConLecturaLocalSqlite(
          conexion.sql,
          { configuracion: config, datos, ...(programada ? { programada } : {}) },
          ahora,
        ),
      fallo: async (error, ahora) => registrarFallo(error, conexion.sql, { config, programada }, ahora),
    });
    return { codigo: resultado.incidencias.length ? 1 : 0, resultado };
  } finally {
    conexion.close();
  }
}

if (import.meta.main) {
  try {
    const args = process.argv.slice(2);
    const salida =
      args[0] === 'verificar-local'
        ? await ejecutarVigilanteConLecturaLocal(args, process.env)
        : ejecutarVigilanteLocal(args, process.env);
    console.log(JSON.stringify(salida.resultado));
    process.exitCode = salida.codigo;
  } catch (error) {
    if (error instanceof ErrorLecturaLocalVigilante) {
      console.log(JSON.stringify(error.resultado));
    }
    console.error('El vigilante local no pudo verificar su estado; no se confirma recuperación.');
    process.exitCode = 2;
  }
}
