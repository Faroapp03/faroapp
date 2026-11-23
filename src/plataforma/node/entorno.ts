// Variables del perfil de configuración de Node. El perfil usa
// el formato CLAVE=valor que Cloudflare lee en local (.dev.vars); nunca se imprimen sus valores. Perfil por defecto:
// .dev.vars. Con FARO_PERFIL=local se lee .dev.vars.local, y así con cualquier nombre.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ErrorDeProcesamiento } from '../../comun/error-de-procesamiento.ts';
import { variablesDelServicio } from '../variables-del-servicio.ts';
import { leerTextoConfiguracion } from './lectura-configuracion.ts';
import { RUTAS } from './rutas.ts';

/** Variables de configuración de un perfil, por nombre. */
export type Entorno = Record<string, string>;

/** Una línea CLAVE=valor; el valor puede ir entre comillas. */
const LINEA_PERFIL = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/;

/** El archivo de un perfil: .dev.vars o, con nombre, .dev.vars.<nombre>. */
function rutaPerfil(perfil?: string): string {
  if (perfil !== undefined && /[/\\\0]/u.test(perfil)) {
    throw new ErrorDeProcesamiento(
      'no_configurado',
      'El nombre del perfil no puede contener separadores de ruta ni NUL',
    );
  }
  return join(RUTAS.raiz, perfil ? `.dev.vars.${perfil}` : '.dev.vars');
}

/** Las variables de un perfil, línea a línea; lo que no es CLAVE=valor (comentarios, líneas vacías) se ignora. */
function analizarPerfil(contenido: string): Entorno {
  const variables: Entorno = {};
  for (const linea of contenido.split('\n')) {
    const par = linea.match(LINEA_PERFIL);
    const [, nombre, valor] = par ?? [];
    if (nombre !== undefined && valor !== undefined) {
      variables[nombre] = valor.replace(/^["']|["']$/g, '');
    }
  }
  return variables;
}

/**
 * Lee las variables de datos y seguridad del perfil de configuración.
 *
 * @param perfil - El nombre del perfil (.dev.vars.<perfil>), o ninguno para .dev.vars.
 * @returns Sus variables, por nombre.
 * @throws {Error} Si el perfil no existe.
 */
export function leerEntorno(perfil: string | undefined = process.env.FARO_PERFIL): Entorno {
  const ruta = rutaPerfil(perfil);
  if (!existsSync(ruta)) {
    throw new Error(
      `No existe el perfil de configuración ${perfil ?? '(por defecto)'}: copia .dev.vars.example como .dev.vars`,
    );
  }
  return variablesDelServicio(analizarPerfil(leerTextoConfiguracion(ruta)));
}

/**
 * Lee el perfil si existe; sin él se usan los valores por defecto.
 *
 * @param perfil - El nombre del perfil (.dev.vars.<perfil>), o ninguno para .dev.vars.
 * @returns Sus variables, por nombre, o ninguna si el perfil no existe.
 */
export function leerEntornoSiExiste(perfil: string | undefined = process.env.FARO_PERFIL): Entorno {
  const ruta = rutaPerfil(perfil);
  return existsSync(ruta) ? variablesDelServicio(analizarPerfil(leerTextoConfiguracion(ruta))) : {};
}

/** Configuración del servicio desde el perfil local y las variables explícitas del proceso. */
export interface EntornoDelServidor {
  variables: Entorno;
}
export function leerEntornoDelServidor(): EntornoDelServidor {
  return { variables: leerEntornoSiExiste() };
}
