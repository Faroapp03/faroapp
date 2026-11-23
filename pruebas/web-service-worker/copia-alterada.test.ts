// Lo guardado en la copia sin conexión se vuelve a comprobar al servirlo (H3), dos service workers no llenan a la vez
// la copia del paquete (H4) y un fallo que no es de red no se convierte en «sin conexión» (H8).
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { BASES, pedir, prepararPaquete, servicio } from './ayudas.ts';

const SCRIPT = 'scripts/prueba.js';
const ESTILO = 'estilos/prueba.css';
const RECURSO = { mode: 'cors', method: 'GET' };
const BIEN = 200;
const NO_DISPONIBLE = 503;
const ALTERADO = 'alert("alterado")';

for (const base of BASES) {
  for (const archivo of [SCRIPT, ESTILO]) {
    test(`una entrada alterada en la copia no se sirve: se descarta y se pide a la red: ${archivo}: ${base}`, async () => {
      const sw = servicio(base, { archivos: [archivo] });
      const original = new URL(archivo, base).pathname;
      sw.guardadas.set(sw.nombreCopia, new Map([[sw.urlDe(archivo), new Response(ALTERADO)]]));
      sw.conectar();
      const respuesta = await pedir(sw, archivo, RECURSO);
      assert.equal(respuesta.estado, BIEN);
      assert.equal(respuesta.cuerpo, original);
      assert.deepEqual(sw.peticiones, [sw.urlDe(archivo)]);
      const guardada = sw.guardadas.get(sw.nombreCopia)?.get(sw.urlDe(archivo));
      assert.equal(await guardada?.clone().text(), original, 'la copia queda reparada con lo de esta versión');
      assert.ok(
        sw.avisos.some((aviso) => String(aviso[0]).includes(sw.urlDe(archivo))),
        'queda en la consola',
      );
    });
  }

  test(`sin red, una entrada alterada tampoco se sirve: ${base}`, async () => {
    const sw = servicio(base, { archivos: [SCRIPT] });
    sw.guardadas.set(sw.nombreCopia, new Map([[sw.urlDe(SCRIPT), new Response(ALTERADO)]]));
    const respuesta = await pedir(sw, SCRIPT, RECURSO);
    assert.equal(respuesta.estado, NO_DISPONIBLE);
    assert.notEqual(respuesta.cuerpo, ALTERADO);
  });

  test(`una entrada que cuadra se sirve de la copia, sin red: ${base}`, async () => {
    const sw = servicio(base, { archivos: [SCRIPT] });
    const original = new URL(SCRIPT, base).pathname;
    sw.guardadas.set(sw.nombreCopia, new Map([[sw.urlDe(SCRIPT), new Response(original)]]));
    const respuesta = await pedir(sw, SCRIPT, RECURSO);
    assert.equal(respuesta.cuerpo, original);
    assert.deepEqual(sw.peticiones, []);
    assert.deepEqual(sw.avisos, []);
  });

  test(`un fallo que no es de red no se sirve como «sin conexión»: se relanza: ${base}`, async () => {
    const sw = servicio(base, { archivos: [SCRIPT] });
    sw.conectar();
    sw.red.respuesta = () => {
      throw new RangeError('fallo de programa');
    };
    await assert.rejects(pedir(sw, SCRIPT, RECURSO), RangeError);
  });

  test(`un TypeError del programa tampoco se hace pasar por falta de conexión: ${base}`, async () => {
    const sw = servicio(base, { archivos: [SCRIPT] });
    sw.conectar();
    // Algo que no es una respuesta: leer sus cabeceras es un TypeError del programa, no de la red.
    sw.red.respuesta = () => ({}) as Response;
    await assert.rejects(pedir(sw, SCRIPT, RECURSO), (error: Error) => error.name === 'TypeError');
  });

  test(`sin red, una página de sin conexión alterada no se sirve: queda la página de estado: ${base}`, async () => {
    const cuerpos: Record<string, string> = { 'inicio.html': 'INICIO', 'sin-conexion.html': 'SIN CONEXIÓN' };
    const sw = servicio(base, { cuerpoDe: (ruta) => cuerpos[ruta] ?? ruta });
    sw.guardadas.set(
      sw.nombreCopia,
      new Map([
        [sw.urlDe('inicio.html'), new Response('INICIO', { headers: { 'x-faro-portal': 'publico' } })],
        [sw.urlDe('sin-conexion.html'), new Response(ALTERADO)],
      ]),
    );
    const respuesta = await pedir(sw, 'no-existe.html');
    assert.equal(respuesta.estado, NO_DISPONIBLE);
    assert.equal(
      respuesta.cuerpo,
      sw.evaluar("PAGINAS_DEL_SERVICIO['sin-conexion']").replaceAll('{{inicio}}', sw.urlDe('inicio.html')),
    );
    assert.ok(!respuesta.cuerpo?.includes(ALTERADO), 'nada de la página alterada');
  });

  test(`la falta de red sigue respondiendo con la copia o con un 503 explicado: ${base}`, async () => {
    const sw = servicio(base, { archivos: [SCRIPT] });
    const respuesta = await pedir(sw, SCRIPT, RECURSO);
    assert.equal(respuesta.estado, NO_DISPONIBLE);
    assert.equal(respuesta.cuerpo, 'Recurso no disponible sin conexión.');
  });
}

const huella = (texto: string) => createHash('sha256').update(texto).digest('hex');
const PARTES = 4;
const CIFRAS_VERSION = 16;

test('el service worker activo y el que espera no llenan a la vez la misma copia del paquete', async () => {
  const datos = new Map(Array.from({ length: PARTES }, (_, indice) => [`parte-${indice}.json`, `{"parte":${indice}}`]));
  const manifiesto = JSON.stringify(
    Object.fromEntries([...datos].map(([archivo, texto]) => [archivo, { sha256: huella(texto) }])),
  );
  const version = huella(manifiesto).slice(0, CIFRAS_VERSION);
  const base = BASES[0] ?? '';
  const activo = servicio(base, { paquete: version });
  const queEspera = servicio(base, { paquete: version }, activo.copias, activo.evaluar('navigator.locks'));
  const pedidos = new Map<string, number>();
  for (const sw of [activo, queEspera]) {
    sw.conectar();
    sw.red.respuesta = (url) => {
      const archivo = url.split('/').at(-1) ?? '';
      pedidos.set(archivo, (pedidos.get(archivo) ?? 0) + 1);
      return new Response(archivo === 'manifiesto.json' ? manifiesto : (datos.get(archivo) ?? ''));
    };
  }
  const [uno, otro] = await Promise.all([prepararPaquete(activo), prepararPaquete(queEspera)]);
  for (const estado of [uno, otro]) {
    assert.deepEqual(JSON.parse(JSON.stringify(estado)), { type: 'ESTADO_DEL_PAQUETE', version, completo: true });
  }
  assert.deepEqual(
    [...pedidos.values()].every((veces) => veces === 1),
    true,
    `cada archivo se baja una sola vez: ${JSON.stringify([...pedidos])}`,
  );
});
