// Las peticiones de la pantalla del recorrido al motor del dispositivo. No son rutas de la API pública (no existen
// en el servidor ni en OpenAPI): solo las atiende el Worker del motor (motor.ts, en esta carpeta), con el mismo
// transporte que el resto del recorrido (web/scripts/motor-local/cliente.js). El texto de la persona no sale del
// dispositivo. Cada petición es completa (el motor de preguntas no guarda estado): la pantalla manda el texto y todas
// las respuestas, y el motor reconstruye el paso.

import {
  type Atributos,
  avisoDeModeracion,
  buscarAMano,
  enlazar,
  estadoDeLaIa,
  familias,
  gruposDeFamilia,
  MAX_RESPUESTAS_DEL_RECORRIDO,
  pasoDePantalla,
  type Respuesta,
  resultado,
} from '../../../motores/ocupaciones/src/index.ts';
import type { PeticionLocal } from '../../api/cuerpo-local.ts';
import { esIdioma, type Idioma } from '../../comun/idioma.ts';
import type { Datos } from '../../dominio/tipos-paquete.ts';
import type { Aviso } from '../../seguridad/avisos.ts';
import { MAX_RELATO } from '../../seguridad/limites.ts';

/** El prefijo de estas peticiones: fuera de /api/, para que nadie las confunda con la API pública. */
export const PREFIJO_LOCAL = '/local/recorrido-v2/';
/**
 * Límite de respuestas compartido con el motor. Incluye las tandas de la lista final y las confirmaciones
 * para que una petición válida del recorrido no exceda el contrato del transporte.
 */
const MAX_RESPUESTAS = MAX_RESPUESTAS_DEL_RECORRIDO;
const MAX_IDENTIFICADOR = 200;
const GRUPO = /^\d{4}$/;
const FAMILIA = /^\d{2}$/;
const ESCO = /^[\d.]{1,20}$/;
const TAREA = /^\d{4}-\d{1,3}$/;

const BIEN = 200;
const MAL = 400;
const NO_EXISTE = 404;

function json(estado: number, cuerpo: unknown): Response {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

class PeticionInvalida extends Error {
  override name = 'PeticionInvalida';
}

function objeto(valor: unknown): Record<string, unknown> {
  if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) {
    throw new PeticionInvalida('se espera un objeto');
  }
  return valor as Record<string, unknown>;
}

function texto(valor: unknown, max = MAX_RELATO): string {
  if (typeof valor !== 'string' || valor.length > max) {
    throw new PeticionInvalida('texto inválido');
  }
  return valor;
}

function idioma(valor: unknown): Idioma {
  if (!esIdioma(valor)) {
    throw new PeticionInvalida('idioma inválido');
  }
  return valor;
}

function codigo(valor: unknown, patron: RegExp): string {
  if (typeof valor !== 'string' || !patron.test(valor)) {
    throw new PeticionInvalida('código inválido');
  }
  return valor;
}

function respuestas(valor: unknown): Respuesta[] {
  if (!Array.isArray(valor) || valor.length > MAX_RESPUESTAS) {
    throw new PeticionInvalida('respuestas inválidas');
  }
  return valor.map((r) => {
    const o = objeto(r);
    return { pregunta: texto(o.pregunta, MAX_IDENTIFICADOR), opcion: texto(o.opcion, MAX_IDENTIFICADOR) };
  });
}

function elegidas(valor: unknown): string[] {
  if (valor === undefined || valor === null) {
    return [];
  }
  if (!Array.isArray(valor) || valor.length > MAX_RESPUESTAS) {
    throw new PeticionInvalida('tareas elegidas inválidas');
  }
  return valor.map((id) => codigo(id, TAREA));
}

async function cuerpo(peticion: PeticionLocal): Promise<Record<string, unknown>> {
  try {
    return objeto(JSON.parse(peticion.body ?? ''));
  } catch (error) {
    throw error instanceof PeticionInvalida ? error : new PeticionInvalida('el cuerpo no es JSON');
  }
}

/** Si una petición del Worker es de la pantalla del recorrido. */
export function esPeticionLocal(url: string): boolean {
  try {
    return new URL(url).pathname.startsWith(PREFIJO_LOCAL);
  } catch {
    return false;
  }
}

/** Si una petición del Worker es un paso del recorrido: la única que usa la IA de vectores y el clasificador. */
export function esPeticionDePaso(url: string): boolean {
  try {
    return new URL(url).pathname === `${PREFIJO_LOCAL}paso`;
  } catch {
    return false;
  }
}

/**
 * Atiende una petición de la pantalla: `paso`, `buscar`, `familias`, `familia`, `resultado` o `enlazar`, todas por
 * POST con un cuerpo JSON. Responde 400 si el cuerpo no vale y 404 si la operación o el grupo no existen.
 */
export async function responderLocal(
  datos: Datos,
  atributos: () => Atributos,
  peticion: PeticionLocal,
): Promise<Response> {
  const operacion = new URL(peticion.url).pathname.slice(PREFIJO_LOCAL.length);
  if (peticion.method !== 'POST') {
    return json(NO_EXISTE, { error: 'operación desconocida' });
  }
  try {
    const c = await cuerpo(peticion);
    if (c.segundaOpinion !== undefined && c.segundaOpinion !== null) {
      throw new PeticionInvalida('La petición local no admite una segunda opinión externa');
    }
    const parada = await moderar(c);
    if (parada) {
      return json(BIEN, { parada });
    }
    return operar(datos, atributos, operacion, c);
  } catch (error) {
    if (error instanceof PeticionInvalida) {
      return json(MAL, { error: error.message });
    }
    throw error;
  }
}

/**
 * La moderación de lo que ha escrito la persona antes de usarlo, con la política y los avisos de
 * seguridad/moderacion.ts: el del 024 si hay riesgo de autolesión. Si para, la pantalla no sigue.
 */
async function moderar(c: Record<string, unknown>): Promise<Aviso | null> {
  const escrito = [c.texto, c.tarea].filter((x): x is string => typeof x === 'string' && x.trim() !== '');
  if (!escrito.length) {
    return null;
  }
  return avisoDeModeracion(escrito.map((x) => texto(x)).join('\n'), c.idioma === undefined ? 'es' : idioma(c.idioma));
}

function operar(datos: Datos, atributos: () => Atributos, operacion: string, c: Record<string, unknown>): Response {
  switch (operacion) {
    case 'paso': {
      const r = pasoDePantalla(datos, atributos(), {
        texto: texto(c.texto),
        idioma: idioma(c.idioma),
        respuestas: respuestas(c.respuestas),
        // Lo contado en «Lo cuento con mis palabras» también va aparte: sus tareas dan pistas de grupo
        // (servicio.ts, tareasContadas). Sin esto, el navegador hacía menos que lo medido.
        ...(c.anadido === undefined ? {} : { anadido: texto(c.anadido) }),
      });
      // Qué IA estaba cargada al calcular el paso (previa-fusion.ts, estadoDeLaIa): la pantalla avisa si falta, y las
      // pruebas lo comprueban.
      return json(BIEN, { ...r, lectura: { ...r.lectura, ...estadoDeLaIa() } });
    }
    case 'buscar':
      return json(BIEN, { ocupaciones: buscarAMano(datos, texto(c.texto), idioma(c.idioma)) });
    case 'familias':
      return json(BIEN, { familias: familias(datos) });
    case 'familia':
      return json(BIEN, { grupos: gruposDeFamilia(datos, codigo(c.codigo, FAMILIA)) });
    case 'resultado': {
      const esco = c.esco === undefined || c.esco === null ? undefined : codigo(c.esco, ESCO);
      const r = resultado(datos, {
        grupo: codigo(c.grupo, GRUPO),
        texto: texto(c.texto),
        elegidas: elegidas(c.elegidas),
        ...(esco ? { esco } : {}),
      });
      return r ? json(BIEN, r) : json(NO_EXISTE, { error: 'grupo desconocido' });
    }
    case 'enlazar':
      return json(BIEN, { enlace: enlazar(datos, { grupo: codigo(c.grupo, GRUPO), tarea: texto(c.tarea) }) });
    default:
      return json(NO_EXISTE, { error: 'operación desconocida' });
  }
}
