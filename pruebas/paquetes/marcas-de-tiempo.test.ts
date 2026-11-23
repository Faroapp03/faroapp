// Las marcas de tiempo del análisis (src/comun/marcas-de-tiempo.ts): existen con sus nombres estables, están
// documentadas y en uso, no escriben en la consola y no cambian lo que carga el paquete.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, test } from 'node:test';
import { inicioDelTramo, MEDIDAS, medirTramo } from '../../src/comun/marcas-de-tiempo.ts';
import { MANIFIESTO } from '../../src/plataforma/archivos-del-paquete.ts';
import { cargarPaquete } from '../../src/plataforma/navegador/paquete.ts';

const BASE = new URL('https://paquete.test/paquete/0123456789abcdef/');
const RAIZ = new URL('../../', import.meta.url);
const NOMBRE = /^faro:(pagina|worker|datos|motor):[a-z-]+$/;
/** Los archivos que anotan las medidas, en la página, el Worker y el motor del navegador. */
const QUIENES_MIDEN = [
  'web/scripts/motor-local/cliente.js',
  'web/scripts/motor-local/worker.js',
  'web/scripts/recorrido/ocupacion-local.js',
  'web/scripts/recorrido/conversacion.js',
  'src/plataforma/navegador/paquete.ts',
  'src/plataforma/navegador/motor.ts',
];
const fetchOriginal = globalThis.fetch;
const medirOriginal = performance.measure.bind(performance);

beforeEach(() => performance.clearMeasures());
afterEach(() => {
  globalThis.fetch = fetchOriginal;
  performance.measure = medirOriginal;
  performance.clearMeasures();
});

/** Un paquete mínimo servido por un fetch simulado; devuelve las direcciones pedidas, en orden. */
function servirPaqueteMinimo(): string[] {
  const archivos = new Map(
    Object.entries({
      'esco.json': { competencias: [], ocupaciones: {} },
      'oit.json': { ocupaciones: {}, tareas: {} },
      'clasificaciones.json': {},
      'exposicion-cambra.json': {},
      'textos.json': { tareas: {}, competencias_por_ocupacion: {} },
    }).map(([archivo, datos]) => [archivo, new TextEncoder().encode(JSON.stringify(datos))]),
  );
  const manifiesto = new TextEncoder().encode(
    JSON.stringify(
      Object.fromEntries(
        [...archivos].map(([archivo, bytes]) => [
          archivo,
          { sha256: createHash('sha256').update(bytes).digest('hex') },
        ]),
      ),
    ),
  );
  const pedidos: string[] = [];
  globalThis.fetch = async (recurso) => {
    const archivo = new URL(recurso instanceof Request ? recurso.url : String(recurso)).pathname.slice(
      BASE.pathname.length,
    );
    pedidos.push(archivo);
    const bytes = archivo === MANIFIESTO ? manifiesto : archivos.get(archivo);
    return bytes ? new Response(bytes) : new Response(null, { status: 404 });
  };
  return pedidos;
}

/** Las medidas faro:* anotadas, como nombre y detalle. */
function anotadas(): { nombre: string; detalle: unknown }[] {
  return performance
    .getEntriesByType('measure')
    .filter((m) => m.name.startsWith('faro:'))
    .map((m) => ({ nombre: m.name, detalle: (m as PerformanceMeasure).detail ?? null }));
}

test('los nombres son estables, únicos, documentados y todos se anotan en algún punto del camino', () => {
  const nombres = Object.values(MEDIDAS);
  assert.equal(new Set(nombres).size, nombres.length);
  for (const nombre of nombres) {
    assert.match(nombre, NOMBRE);
  }
  const guia = readFileSync(new URL('pruebas/navegadores/README.md', RAIZ), 'utf8');
  const seccion = guia.slice(guia.indexOf('## Desglose del análisis'));
  assert.ok(seccion.length < guia.length, 'la guía de los ensayos tiene la sección «Desglose del análisis»');
  const codigo = QUIENES_MIDEN.map((ruta) => readFileSync(new URL(ruta, RAIZ), 'utf8')).join('\n');
  for (const [clave, nombre] of Object.entries(MEDIDAS)) {
    assert.ok(seccion.includes(`\`${nombre}\``), `${nombre} está documentada`);
    assert.ok(codigo.includes(`MEDIDAS.${clave},`), `${nombre} se anota en el camino del análisis`);
  }
});

test('un tramo queda en la línea temporal con su detalle y sin escribir en la consola', (contexto) => {
  const consola = (['log', 'info', 'warn', 'error', 'debug'] as const).map((metodo) =>
    contexto.mock.method(console, metodo),
  );
  const inicio = inicioDelTramo();
  medirTramo(MEDIDAS.calculo, inicio, { ruta: '/local/recorrido-v2/paso' });
  medirTramo(MEDIDAS.paquete, inicio);
  assert.deepEqual(anotadas(), [
    { nombre: 'faro:worker:calculo', detalle: { ruta: '/local/recorrido-v2/paso' } },
    { nombre: 'faro:datos:paquete', detalle: null },
  ]);
  assert.ok(consola.every((espia) => espia.mock.callCount() === 0));
});

test('la carga del paquete anota cada lectura, huella, JSON y preparación, y el paquete entero', async () => {
  servirPaqueteMinimo();
  await cargarPaquete(BASE);
  const medidas = anotadas();
  const de = (nombre: string) => medidas.filter((m) => m.nombre === nombre).map((m) => m.detalle);
  const partes = ['esco.json', 'oit.json', 'clasificaciones.json', 'exposicion-cambra.json', 'textos.json'];
  assert.deepEqual(
    de(MEDIDAS.lectura)
      .map((d) => (d as { archivo: string }).archivo)
      .sort(),
    [MANIFIESTO, ...partes].sort(),
  );
  assert.ok(de(MEDIDAS.lectura).every((d) => Number.isInteger((d as { bytes: number }).bytes)));
  for (const nombre of [MEDIDAS.huella, MEDIDAS.json, MEDIDAS.preparacion]) {
    assert.deepEqual(
      de(nombre)
        .map((d) => (d as { archivo: string }).archivo)
        .sort(),
      [...partes].sort(),
      nombre,
    );
  }
  assert.deepEqual(de(MEDIDAS.paquete), [{ partes: 5 }]);
});

test('con o sin línea temporal, el paquete carga lo mismo, en el mismo orden y con la misma versión', async () => {
  const pedidosCon = servirPaqueteMinimo();
  const con = await cargarPaquete(BASE);
  performance.measure = (() => undefined) as unknown as typeof performance.measure;
  const pedidosSin = servirPaqueteMinimo();
  const sin = await cargarPaquete(BASE);
  assert.deepEqual(pedidosCon, pedidosSin);
  assert.deepEqual(con, sin);
  assert.deepEqual(Object.keys(con.datos), Object.keys(sin.datos));
});
