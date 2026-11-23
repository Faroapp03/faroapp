// Lectura de las fuentes oficiales para generar-atributos.ts: el pilar de competencias de ESCO y el censo. Cada
// función devuelve solo lo que el dato respalda.

import type { DatabaseSync } from 'node:sqlite';

/** Las partes del paquete que usa el generador (solo los campos leídos). */
export interface Tablas {
  oit: { ocupaciones: Record<string, unknown>; tareas: Record<string, { isco08: string; indice: number }> };
  textos: { tareas: Record<string, { corto: string; texto_es: string }> };
  catalan: { tareas: Record<string, { corto: string }>; grupos: Record<string, string> };
  clasificaciones: {
    cno11: Record<string, { titulo: string }>;
    isco08_es: Record<string, string>;
    isco08_a_cno11: Record<string, { cno11: string }[]>;
  };
  cataluna: {
    ocupados_cno3: Record<string, { ocupados: number }>;
    /** Total por CNO de 2 cifras: completa los subgrupos de 3 cifras que el Censo no publica. */
    ocupados_cno2?: Record<string, { ocupados: number }>;
  };
  censo: {
    perfil_cno3: Record<string, PerfilCenso>;
    perfil_cno2: Record<string, PerfilCenso>;
  };
}

interface PerfilCenso {
  estudios: { universitarios: number };
  situacion: { cuenta_propia: number };
}

/** Orden por unidades de código UTF-16, igual en todos los sistemas (no depende del idioma). */
export function compararCadenas(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  return a > b ? 1 : 0;
}

/** Grupos del pilar de competencias de ESCO v1.2.1 que forman cada respuesta de «¿Con qué trabajas más?». */
const TRATO: Record<string, number> = { S1: 0, S3: 0, S2: 1, S4: 1, S5: 1, S6: 2, S7: 2, S8: 2 };
/** Competencias esenciales con grupo del pilar necesarias para fiarse del reparto de un grupo. */
const MIN_COMPETENCIAS_PILAR = 12;
/** Conocimientos esenciales con campo ISCED-F necesarios para fiarse del campo de un grupo. */
const MIN_CONOCIMIENTOS_CAMPO = 5;
/** Campos ISCED-F amplios (2013) que se preguntan; 00 (programas genéricos) no distingue oficios. */
const CAMPOS = new Set(['01', '02', '03', '04', '05', '06', '07', '08', '09', '10']);
const DECIMALES = 100;
const CATEGORIAS_TRATO = 3;
const CIFRAS_GRUPO = 4;

const redondear = (x: number): number => Math.round(x * DECIMALES) / DECIMALES;

interface Recuento {
  trato: number[];
  campos: Map<string, number>;
}

/**
 * Por grupo CIUO-08: el reparto de sus competencias esenciales (ESCO) entre personas, información y manos o máquinas
 * (`tr`) y el de sus conocimientos esenciales entre campos ISCED-F (`cm`). Se omite lo que no llega al mínimo.
 */
export function contarPilar(base: DatabaseSync): Map<string, Record<string, unknown>> {
  const filas = base
    .prepare(
      `select distinct substr(o.codigo_esco, 1, ${CIFRAS_GRUPO}) as g, r.ocupacion_uri as u, r.competencia_uri as c,
        substr(json_extract(gs.value, '$.code'), 1, 2) as k
       from relaciones r join ocupaciones o on o.uri = r.ocupacion_uri join competencias c on c.uri = r.competencia_uri,
        json_each(json_extract(c.registro_json, '$.grupos_superiores')) gs
       where r.tipo = 'esencial'`,
    )
    .all() as { g: string; k: string }[];
  const recuentos = new Map<string, Recuento>();
  for (const { g, k } of filas) {
    const r = recuentos.get(g) ?? { trato: Array.from({ length: CATEGORIAS_TRATO }, () => 0), campos: new Map() };
    const t = TRATO[k];
    if (t !== undefined) {
      r.trato[t] = (r.trato[t] ?? 0) + 1;
    } else if (CAMPOS.has(k)) {
      r.campos.set(k, (r.campos.get(k) ?? 0) + 1);
    }
    recuentos.set(g, r);
  }
  return new Map([...recuentos].map(([g, r]) => [g, resumirRecuento(r)]));
}

function resumirRecuento(r: Recuento): Record<string, unknown> {
  const salida: Record<string, unknown> = {};
  const totalTrato = r.trato.reduce((a, b) => a + b, 0);
  if (totalTrato >= MIN_COMPETENCIAS_PILAR) {
    salida.tr = r.trato.map((n) => redondear(n / totalTrato));
  }
  const totalCampos = [...r.campos.values()].reduce((a, b) => a + b, 0);
  if (totalCampos >= MIN_CONOCIMIENTOS_CAMPO) {
    const campos = [...r.campos].sort((a, b) => compararCadenas(a[0], b[0]));
    salida.cm = Object.fromEntries(campos.map(([k, n]) => [k, redondear(n / totalCampos)]));
  }
  return salida;
}

/**
 * Ocupados de cada CNO-11 de 4 cifras repartiendo por igual los de su CNO de 3 cifras entre sus grupos enlazados.
 * Cuando el Censo no publica la cifra de 3 cifras (en Cataluña, todo el subgrupo 59, «protección y seguridad»: policía,
 * bomberos, vigilantes…), se reparte por igual entre esos códigos lo que queda del total oficial de 2 cifras tras
 * restar los de 3 cifras publicados. Antes quedaban a 0, como si no hubiera nadie: la policía (5412) salía «inexistente».
 */
function ocupadosPorCno4(t: Tablas): Map<string, number> {
  const salida = new Map<string, number>();
  // Los códigos de 4 cifras sin cifra de 3 cifras publicada, por su subgrupo de 2 cifras.
  const sinCifra = new Map<string, string[]>();
  for (const [tres, cuatro] of codigosPorCno3(t)) {
    const publicada = t.cataluna.ocupados_cno3[tres]?.ocupados;
    if (publicada === undefined) {
      sinCifra.set(tres.slice(0, 2), [...(sinCifra.get(tres.slice(0, 2)) ?? []), ...cuatro]);
      continue;
    }
    for (const c of cuatro) {
      salida.set(c, publicada / cuatro.size);
    }
  }
  for (const [dos, codigos] of sinCifra) {
    const resto = restoDelCno2(t, dos);
    for (const c of resto > 0 ? codigos : []) {
      salida.set(c, resto / codigos.length);
    }
  }
  return salida;
}

/** Los códigos CNO-11 de 4 cifras enlazados con algún grupo CIUO-08, por su subgrupo de 3 cifras. */
function codigosPorCno3(t: Tablas): Map<string, Set<string>> {
  const hijos = new Map<string, Set<string>>();
  for (const { cno11 } of Object.values(t.clasificaciones.isco08_a_cno11).flat()) {
    const tres = cno11.slice(0, CIFRAS_GRUPO - 1);
    hijos.set(tres, (hijos.get(tres) ?? new Set()).add(cno11));
  }
  return hijos;
}

/** Lo que queda del total oficial de un subgrupo de 2 cifras tras restar sus subgrupos de 3 cifras publicados. */
function restoDelCno2(t: Tablas, dos: string): number {
  const total = t.cataluna.ocupados_cno2?.[dos]?.ocupados ?? 0;
  const publicados = Object.entries(t.cataluna.ocupados_cno3)
    .filter(([tres]) => tres.startsWith(dos))
    .reduce((suma, [, fila]) => suma + fila.ocupados, 0);
  return total - publicados;
}

/** Cuántos grupos CIUO-08 comparten cada CNO-11 de 4 cifras (para repartir sus ocupados). */
function gruposPorCno4(t: Tablas): Map<string, number> {
  const n = new Map<string, number>();
  for (const lista of Object.values(t.clasificaciones.isco08_a_cno11)) {
    for (const { cno11 } of lista) {
      n.set(cno11, (n.get(cno11) ?? 0) + 1);
    }
  }
  return n;
}

function perfilDe(t: Tablas, cno4: string): PerfilCenso | undefined {
  return t.censo.perfil_cno3[cno4.slice(0, CIFRAS_GRUPO - 1)] ?? t.censo.perfil_cno2[cno4.slice(0, 2)];
}

/**
 * Por grupo: los ocupados estimados en Cataluña (`pr`, para el punto de partida) y, ponderados por esos ocupados, el %
 * de universitarios (`un`) y el % por cuenta propia (`cp`) del Censo 2021.
 */
export function priorYCenso(t: Tablas, grupos: readonly string[]): Map<string, Record<string, number>> {
  const ocupados = ocupadosPorCno4(t);
  const reparto = gruposPorCno4(t);
  const salida = new Map<string, Record<string, number>>();
  for (const g of grupos) {
    let peso = 0;
    let univ = 0;
    let propia = 0;
    let conPerfil = 0;
    for (const { cno11 } of t.clasificaciones.isco08_a_cno11[g] ?? []) {
      const p = (ocupados.get(cno11) ?? 0) / (reparto.get(cno11) ?? 1);
      peso += p;
      const perfil = perfilDe(t, cno11);
      if (perfil) {
        conPerfil += p;
        univ += p * perfil.estudios.universitarios;
        propia += p * perfil.situacion.cuenta_propia;
      }
    }
    const fila: Record<string, number> = { pr: Math.round(peso) };
    if (conPerfil > 0) {
      fila.un = redondear(univ / conPerfil / DECIMALES);
      fila.cp = redondear(propia / conPerfil / DECIMALES);
    }
    salida.set(g, fila);
  }
  return salida;
}
