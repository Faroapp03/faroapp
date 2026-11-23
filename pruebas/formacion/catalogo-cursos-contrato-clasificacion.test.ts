import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  ALCANCES_CLASIFICACION,
  CatalogoNoValido,
  CERTEZAS_CLASIFICACION,
  ESTADOS_CLASIFICACION,
  IDIOMAS_CLASIFICACION,
  MOTIVOS_POR_CONFIRMAR,
  NIVELES_CLASIFICACION,
  type ReferenciaEntregaCatalogo,
  VERSION_CATALOGO,
  VERSION_CATALOGO_CON_CLASIFICACION,
} from '../../src/catalogo-cursos/contrato.ts';
import { esSha } from '../../src/catalogo-cursos/forma.ts';
import { esClasificacion, MATERIAS_CLASIFICACION } from '../../src/catalogo-cursos/forma-clasificacion.ts';
import { leerCatalogo } from '../../src/catalogo-cursos/lectura.ts';
import { REFERENCIA } from '../../web/scripts/catalogo-cursos/referencia.js';
import { objeto } from '../ayudas/objeto-json.ts';

// La entrega que sirve hoy la web cambia con cada ciclo, en la 6 o en la 7: solo se comprueba que su lector la acepta.
const VIGENTE = new Uint8Array(readFileSync(new URL(`../../web/${REFERENCIA.ruta}`, import.meta.url)));
// Una entrega 6 fija, sacada de la publicada el 18/11 (una oferta de cada proveedor): los casos construidos parten de
// ella para que lo que comprueban no dependa de la versión ni de las ofertas de la entrega del día.
const BASE_V6 = new Uint8Array(readFileSync(new URL('../fixtures/catalogo-cursos-v6.utf8', import.meta.url)));
const REFERENCIA_V6 = referenciaFija('catalogo-cursos-v6');
const EJEMPLOS = objeto(
  JSON.parse(readFileSync(new URL('../fixtures/clasificacion-catalogo-ejemplos.json', import.meta.url), 'utf8')),
);
const VALIDOS = objeto(EJEMPLOS.validos);
const INVALIDOS = (EJEMPLOS.invalidos as unknown[]).map((caso) => objeto(caso));
/** La huella, el tamaño y la revisión declarados junto a una entrega fija de `fixtures/`. */
function referenciaFija(nombre: string): ReferenciaEntregaCatalogo {
  const dato = objeto(
    JSON.parse(readFileSync(new URL(`../fixtures/${nombre}.referencia.json`, import.meta.url), 'utf8')),
  );
  assert.ok(esSha(dato.sha256) && esSha(dato.revision) && typeof dato.bytes === 'number');
  return { sha256: dato.sha256, revision: dato.revision, bytes: dato.bytes };
}

/** «AAAA-MM-DDTHH:MM:SS»: un instante del catálogo hasta los segundos enteros. */
const HASTA_LOS_SEGUNDOS = 19;
const MILIS_POR_SEGUNDO = 1000;

/** El primer segundo entero después del corte de la entrega de base: sale de su propio corte, no de una fecha fija. */
function capturaPosteriorAlCorte(): string {
  const { corte_proyeccion_utc: corte } = leerCatalogo(BASE_V6, REFERENCIA_V6);
  const segundo = Date.parse(`${corte.slice(0, HASTA_LOS_SEGUNDOS)}Z`);
  assert.ok(Number.isFinite(segundo), corte);
  return `${new Date(segundo + MILIS_POR_SEGUNDO).toISOString().slice(0, HASTA_LOS_SEGUNDOS)}Z`;
}

/** La entrega de base con otra versión y el bloque en su primera oferta; el lector no recalcula la revisión. */
function conClasificacion(version: number, bloque: unknown): readonly [Uint8Array, ReferenciaEntregaCatalogo] {
  const dato = objeto(JSON.parse(new TextDecoder().decode(BASE_V6)));
  dato.schema_version = version;
  const [primera] = dato.ofertas as Record<string, unknown>[];
  assert.ok(primera);
  primera.clasificacion = structuredClone(bloque);
  const bytes = new TextEncoder().encode(JSON.stringify(dato));
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  return [bytes, { sha256, bytes: bytes.byteLength, revision: REFERENCIA_V6.revision }];
}

test('una entrega en la versión 6 y sin clasificación se sigue leyendo', () => {
  const catalogo = leerCatalogo(BASE_V6, REFERENCIA_V6);
  assert.equal(catalogo.schema_version, VERSION_CATALOGO);
  assert.ok(catalogo.ofertas.length > 0);
  assert.ok(catalogo.ofertas.every((oferta) => oferta.clasificacion === undefined));
});

test('la entrega que sirve hoy la web se lee con su lector, sea de la versión 6 o de la 7', () => {
  const { schema_version: version } = leerCatalogo(VIGENTE, REFERENCIA);
  assert.ok([VERSION_CATALOGO, VERSION_CATALOGO_CON_CLASIFICACION].includes(version), `versión ${version}`);
});

test('se admite un ejemplo completo de cada estado, solos y juntos', () => {
  for (const [nombre, bloque] of Object.entries(VALIDOS)) {
    assert.ok(esClasificacion(bloque), nombre);
    const leida = leerCatalogo(...conClasificacion(VERSION_CATALOGO_CON_CLASIFICACION, bloque)).ofertas[0];
    assert.deepEqual(leida?.clasificacion, bloque, nombre);
  }
});

test('cada incumplimiento del contrato se rechaza, igual que en el productor', () => {
  for (const caso of INVALIDOS) {
    assert.equal(esClasificacion(caso.bloque), false, String(caso.caso));
    assert.throws(
      () => leerCatalogo(...conClasificacion(VERSION_CATALOGO_CON_CLASIFICACION, caso.bloque)),
      CatalogoNoValido,
      String(caso.caso),
    );
  }
});

test('la versión 6 no admite el bloque y la 7 sin bloques se lee como la 6', () => {
  assert.throws(() => leerCatalogo(...conClasificacion(VERSION_CATALOGO, VALIDOS.completo)), CatalogoNoValido);
  const dato = objeto(JSON.parse(new TextDecoder().decode(BASE_V6)));
  dato.schema_version = VERSION_CATALOGO_CON_CLASIFICACION;
  const bytes = new TextEncoder().encode(JSON.stringify(dato));
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const catalogo = leerCatalogo(bytes, { sha256, bytes: bytes.byteLength, revision: REFERENCIA_V6.revision });
  assert.deepEqual(catalogo.ofertas, leerCatalogo(BASE_V6, REFERENCIA_V6).ofertas);
});

test('una evidencia de clasificación posterior al corte de la entrega se rechaza', () => {
  const bloque = structuredClone(objeto(VALIDOS.fuente));
  const [evidencia] = objeto(bloque.idioma).evidencias as Record<string, unknown>[];
  assert.ok(evidencia);
  evidencia.capturado_utc = capturaPosteriorAlCorte();
  assert.ok(esClasificacion(bloque));
  assert.throws(() => leerCatalogo(...conClasificacion(VERSION_CATALOGO_CON_CLASIFICACION, bloque)), CatalogoNoValido);
});

test('los vocabularios coinciden con los del esquema público', () => {
  const esquema = objeto(
    JSON.parse(
      readFileSync(new URL('../../plataforma_datos/cursos/esquemas/entrega_catalogo.json', import.meta.url), 'utf8'),
    ),
  );
  const definiciones = objeto(esquema.$defs);
  const admitidos = (nombre: string, campo: string): unknown => {
    const valor = objeto(objeto(objeto(definiciones[`dato_${nombre}`]).properties)[campo]);
    const [, admitido] = valor.anyOf as Record<string, unknown>[];
    assert.ok(admitido);
    return admitido.enum ?? objeto(admitido.items).enum;
  };
  assert.deepEqual(admitidos('idioma', 'valores'), [...IDIOMAS_CLASIFICACION]);
  assert.deepEqual(admitidos('nivel', 'valor'), [...NIVELES_CLASIFICACION]);
  assert.deepEqual(admitidos('materia', 'valores'), [...MATERIAS_CLASIFICACION].sort());
  const propiedades = objeto(objeto(definiciones.dato_nivel).properties);
  assert.deepEqual(objeto(propiedades.estado).enum, [...ESTADOS_CLASIFICACION]);
  assert.deepEqual(objeto(propiedades.alcance).enum, [null, ...ALCANCES_CLASIFICACION]);
  assert.deepEqual(objeto(propiedades.certeza).enum, [null, ...CERTEZAS_CLASIFICACION]);
  assert.deepEqual(objeto(propiedades.motivo_por_confirmar).enum, [null, ...MOTIVOS_POR_CONFIRMAR]);
});
