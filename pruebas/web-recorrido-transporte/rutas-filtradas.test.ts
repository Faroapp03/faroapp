import './ayudas.ts';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { cargarDiccionario } from '../../web/idiomas/cargar.js';
import { ERROR_GENERICO, ErrorFaro } from '../../web/scripts/recorrido/api/errores.js';
import { minimizarParaEnviar, RutaSinFiltro, rutaFiltrada } from '../../web/scripts/recorrido/minimizar.js';
import { preparar } from './ayudas.ts';

await cargarDiccionario('es');

const SCRIPTS = fileURLToPath(new URL('../../web/scripts/', import.meta.url));
const API = fileURLToPath(new URL('../../web/scripts/recorrido/api.js', import.meta.url));
const TELEFONO = '654 321 098';
const CORREO = 'laura@example.invalid';
const PALABRAS = `Llamo al ${TELEFONO} y escribo a ${CORREO}`;

/** Los cuerpos de cada ruta de api.js con los datos personales en todos los textos que lleva de la persona. */
const CUERPOS: Record<string, Record<string, unknown>> = {
  informe: { isco08: '4110', fecha: '2026-10-21', tareas: [{ id: 't1', texto: PALABRAS, tiempo: 'poco' }] },
};

/** Los archivos .js de web/scripts, con su ruta. */
async function guiones(carpeta: string): Promise<string[]> {
  const entradas = await readdir(carpeta, { withFileTypes: true, recursive: true });
  return entradas.filter((e) => e.isFile() && e.name.endsWith('.js')).map((e) => `${e.parentPath}/${e.name}`);
}

test('todas las RUTAS de api.js están en la lista cerrada del filtro, y ninguna petición con cuerpo va por otra', async (t) => {
  await preparar(t);
  const { RUTAS } = await import('../../web/scripts/recorrido/api.js');
  assert.deepEqual(Object.keys(RUTAS).sort(), Object.keys(CUERPOS).sort(), 'cada ruta tiene aquí su cuerpo de prueba');
  for (const ruta of Object.values(RUTAS)) {
    assert.ok(rutaFiltrada(ruta), `${ruta} no está en la lista del filtro (minimizar.js, textosPorRuta)`);
  }
  // Solo api.js pide a la API por el transporte, y cada llamada con cuerpo usa una de sus RUTAS.
  const quienPide = [];
  for (const archivo of await guiones(SCRIPTS)) {
    if (
      /import \{[^}]*\bpedir\b[^}]*\} from '[./]*(recorrido\/)?api\/transporte\.js'/.test(
        await readFile(archivo, 'utf8'),
      )
    ) {
      quienPide.push(archivo);
    }
  }
  assert.deepEqual(quienPide, [API]);
  const llamadas = [...(await readFile(API, 'utf8')).matchAll(/\bpedir\(([^,()]+)([,)])/g)];
  assert.ok(llamadas.length > 0);
  for (const [llamada, destino, siguiente] of llamadas) {
    assert.ok(siguiente === ')' || destino?.startsWith('RUTAS.'), `Con cuerpo y sin RUTAS: ${llamada}`);
  }
});

test('cada ruta factual se procesa sin los datos personales de la persona', async (t) => {
  const p = await preparar(t, { responder: () => Response.json({}) });
  const { RUTAS } = await import('../../web/scripts/recorrido/api.js');
  for (const [nombre, ruta] of Object.entries(RUTAS)) {
    p.locales.length = 0;
    await p.transporte.pedir(ruta, structuredClone(CUERPOS[nombre])).catch(() => undefined);
    assert.equal(p.locales.length, 1, `${ruta} sale una vez`);
    const cuerpo = String(p.locales[0]?.opciones.body);
    assert.ok(!cuerpo.includes(TELEFONO) && !cuerpo.includes(CORREO), `${ruta} lleva datos personales: ${cuerpo}`);
  }
});

test('una ruta con cuerpo fuera de la lista no sale, y el fallo se dice; sin cuerpo, sale', async (t) => {
  const errores = t.mock.method(console, 'error', () => undefined);
  const p = await preparar(t);
  await assert.rejects(minimizarParaEnviar('/nueva', { texto: PALABRAS }), RutaSinFiltro);
  await assert.rejects(p.transporte.pedir('/nueva', { texto: PALABRAS }), (error: unknown) => {
    assert.ok(error instanceof ErrorFaro);
    assert.deepEqual(error.explicacion, ERROR_GENERICO);
    return true;
  });
  assert.deepEqual(p.locales, []);
  assert.equal(errores.mock.callCount(), 1);
  assert.ok(errores.mock.calls[0]?.arguments.some((a) => a instanceof RutaSinFiltro));
  await p.transporte.pedir('/grupos?padre=');
  assert.equal(p.locales.length, 1);
});
