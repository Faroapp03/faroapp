/**
 * Comprobaciones del banco de necesidades sobre una raíz del producto (la real o una copia de prueba).
 *
 * Separa dos cosas: la referencia histórica del banco (registro de procedencia, perfiles, contrato, instantánea de
 * anclajes y banco 240), fijada por huella, y la validez del banco frente a los datos vigentes (ocupaciones ESCO con su
 * código ISCO-08, tareas OIT y reglas del contrato). El catálogo de cursos con el que se revisó el banco es procedencia:
 * el catálogo vigente puede cambiar sin tocar perfiles ni expectativas.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const CARPETA_BANCO = 'pruebas/datos/banco-necesidades/';
/**
 * Huella del registro de procedencia. Lo protege entero, también las huellas del catálogo histórico: cambiarlo exige
 * revisar el banco y dejar la revisión registrada en él, nunca sustituir la huella para obtener verde.
 */
export const HUELLA_PROCEDENCIA = '7c4ea071b193f093d7c1e43c0a07258049c8f2c4ef5a9b364280e8d4227942f7';
const PERSONAS_INICIALES = 20;
const PARES_INICIALES = 10;

interface Entrada {
  ocupacion: { esco: string; isco08: string };
  necesidad: {
    tareas: { id: string; dominio: string | null; descripcion: string | null }[];
    tareaObjetivo: string;
    nivelIAActual: string | null;
    nivelIADeseado: string | null;
    objetivo: string;
  };
  acceso: { situacionLaboral: string | null; horasPorSemana: number | null };
}
interface Persona {
  id: string;
  par: string;
  variante: string;
  entrada: Entrada;
  expectativas: string[];
  etiquetasUtilidad: unknown[];
}
interface Par {
  id: string;
  personas: string[];
  campoVariable: string;
  anclajes: string[];
}
export interface Procedencia {
  instantaneaLocal: { ruta: string; sha256: string };
  bancoProtegido: Record<string, string>;
  fuentesDeAnclajes: { id: string; ambito: string; ruta: string; sha256: string }[];
  catalogo: Record<string, string>;
  intervenciones: {
    par: string;
    origen: string;
    campo: string;
    valores: Record<string, string | null>;
    nivelIADeseadoFijo: null;
  }[];
}

export const huella = (raiz: URL, ruta: string): string =>
  createHash('sha256')
    .update(readFileSync(new URL(ruta, raiz)))
    .digest('hex');
const leer = (raiz: URL, ruta: string): unknown => JSON.parse(readFileSync(new URL(ruta, raiz), 'utf8'));
const leerBanco = (raiz: URL, nombre: string): unknown => leer(raiz, `${CARPETA_BANCO}${nombre}`);
const personasYPares = (raiz: URL) => leerBanco(raiz, 'personas.json') as { personas: Persona[]; pares: Par[] };
export const procedenciaDe = (raiz: URL) => leerBanco(raiz, 'procedencia.json') as Procedencia;

/** Elimina únicamente la dimensión declarada para comparar el resto completo de ambas entradas. */
function sinCampo(entrada: Entrada, ruta: string): Entrada {
  const copia = structuredClone(entrada);
  const partes = ruta.split('.');
  const ultima = partes.pop();
  assert.ok(ultima);
  let actual: unknown = copia;
  for (const parte of partes) {
    assert.ok(actual && typeof actual === 'object');
    actual = (actual as Record<string, unknown>)[parte];
  }
  assert.ok(actual && typeof actual === 'object' && Object.hasOwn(actual, ultima), ruta);
  delete (actual as Record<string, unknown>)[ultima];
  return copia;
}

/** Veinte perfiles en diez pares completos, sin huérfanos, y cada par cambia solo su dimensión declarada. */
export function comprobarPares(raiz: URL): void {
  const banco = personasYPares(raiz);
  const anclajes = leerBanco(raiz, 'anclajes.json') as Record<string, unknown>;
  assert.equal(banco.personas.length, PERSONAS_INICIALES);
  assert.equal(banco.pares.length, PARES_INICIALES);
  const personas = new Map(banco.personas.map((persona) => [persona.id, persona]));
  assert.equal(personas.size, banco.personas.length, 'ids de persona únicos');
  assert.equal(new Set(banco.pares.map((par) => par.id)).size, banco.pares.length, 'ids de par únicos');
  const usados: string[] = [];
  for (const par of banco.pares) {
    assert.equal(par.personas.length, 2);
    const [a, b] = par.personas.map((id) => personas.get(id));
    assert.ok(a && b && a.id !== b.id, par.id);
    assert.equal(a.par, par.id);
    assert.equal(b.par, par.id);
    assert.notDeepEqual(a.entrada, b.entrada, `${par.id}: contraste no vacío`);
    assert.deepEqual(sinCampo(a.entrada, par.campoVariable), sinCampo(b.entrada, par.campoVariable), par.id);
    usados.push(...par.personas);
    assert.ok(par.anclajes.length > 0);
    for (const id of par.anclajes) {
      assert.ok(Object.hasOwn(anclajes, id), `${par.id}: anclaje ${id}`);
    }
  }
  assert.deepEqual(usados.sort(), [...personas.keys()].sort(), 'ningún perfil huérfano o utilizado dos veces');
}

/** Conocimiento actual inicial, avanzado y desconocido; n01 y n09 trazados como supuestos sin variar el deseo. */
export function comprobarIntervenciones(raiz: URL): void {
  const banco = personasYPares(raiz);
  const procedencia = procedenciaDe(raiz);
  const niveles = new Set(banco.personas.map((persona) => persona.entrada.necesidad.nivelIAActual));
  assert.ok(niveles.has('inicial') && niveles.has('avanzado') && niveles.has(null));
  for (const id of ['n01', 'n09']) {
    const par = banco.pares.find((par) => par.id === id);
    const intervencion = procedencia.intervenciones.find((intervencion) => intervencion.par === id);
    assert.ok(par && intervencion, `${id}: supuesto de diseño trazado`);
    assert.equal(intervencion.origen, 'intervencion-sintetica');
    assert.equal(par.campoVariable, 'necesidad.nivelIAActual');
    assert.equal(intervencion.campo, par.campoVariable);
    for (const persona of banco.personas.filter((persona) => persona.par === id)) {
      assert.ok(Object.hasOwn(intervencion.valores, persona.variante));
      assert.equal(persona.entrada.necesidad.nivelIAActual, intervencion.valores[persona.variante]);
      assert.equal(persona.entrada.necesidad.nivelIADeseado, intervencion.nivelIADeseadoFijo);
    }
  }
}

/** Validez frente a los datos vigentes: ocupaciones ESCO/ISCO-08, tareas OIT, reglas del contrato y anclajes. */
export function comprobarReferenciasVigentes(raiz: URL): void {
  const banco = personasYPares(raiz);
  const contrato = leerBanco(raiz, 'contrato.json') as { reglas: Record<string, unknown> };
  const anclajes = leerBanco(raiz, 'anclajes.json') as Record<string, { fuente: string; registro: { id: string } }>;
  const esco = leer(raiz, 'datos/esco.json') as { ocupaciones: Record<string, { isco08: string }> };
  const oit = leer(raiz, 'datos/oit.json') as { tareas: Record<string, { isco08: string }> };
  for (const persona of banco.personas) {
    const { ocupacion, necesidad } = persona.entrada;
    assert.equal(
      esco.ocupaciones[ocupacion.esco]?.isco08,
      ocupacion.isco08,
      `${persona.id}: ocupación ESCO ${ocupacion.esco} sin el código ISCO-08 ${ocupacion.isco08} en los datos vigentes`,
    );
    assert.ok(
      necesidad.tareas.some((tarea) => tarea.id === necesidad.tareaObjetivo),
      `${persona.id}: tarea objetivo fuera de sus tareas`,
    );
    for (const tarea of necesidad.tareas) {
      assert.equal(
        oit.tareas[tarea.id]?.isco08,
        ocupacion.isco08,
        `${persona.id}: tarea OIT ${tarea.id} ausente o de otra ocupación en los datos vigentes`,
      );
    }
    assert.ok(persona.expectativas.length > 0);
    for (const regla of persona.expectativas) {
      assert.ok(Object.hasOwn(contrato.reglas, regla), `${persona.id}: regla ${regla} fuera del contrato`);
    }
    assert.deepEqual(persona.etiquetasUtilidad, [], `${persona.id}: la utilidad sigue pendiente de etiquetar`);
  }
  const fuentes = new Set(procedenciaDe(raiz).fuentesDeAnclajes.map((fuente) => fuente.id));
  for (const [id, anclaje] of Object.entries(anclajes)) {
    assert.equal(anclaje.registro.id, id);
    assert.ok(fuentes.has(anclaje.fuente), id);
  }
}

/**
 * Integridad de la referencia histórica: registro de procedencia, perfiles, contrato, instantánea de anclajes y
 * fuentes del producto. No compara el catálogo vigente con el histórico; solo exige que el registro lo documente.
 */
export function comprobarReferenciaHistorica(raiz: URL): void {
  const aviso = 'referencia histórica protegida: revisar el banco y registrar la revisión antes de admitir otra huella';
  assert.equal(huella(raiz, `${CARPETA_BANCO}procedencia.json`), HUELLA_PROCEDENCIA, `${aviso}: procedencia.json`);
  const procedencia = procedenciaDe(raiz);
  assert.ok(Object.keys(procedencia.catalogo).length > 0, 'el catálogo histórico consta en la procedencia');
  for (const [ruta, esperada] of Object.entries(procedencia.bancoProtegido)) {
    assert.equal(huella(raiz, ruta), esperada, `${aviso}: ${ruta}`);
  }
  assert.equal(
    huella(raiz, procedencia.instantaneaLocal.ruta),
    procedencia.instantaneaLocal.sha256,
    `${aviso}: ${procedencia.instantaneaLocal.ruta}`,
  );
  for (const fuente of procedencia.fuentesDeAnclajes.filter((fuente) => fuente.ambito === 'producto')) {
    assert.equal(huella(raiz, fuente.ruta), fuente.sha256, `${aviso}: ${fuente.id}`);
  }
}
