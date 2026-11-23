import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { BASES, pedir, prepararPaquete, servicio } from './ayudas.ts';

const CIFRAS_VERSION = 16;
const NO_DISPONIBLE = 503;
const pedirDatos = (sw: ReturnType<typeof servicio>, version: string) =>
  pedir(sw, `paquete/${version}/datos.json`, { method: 'GET', mode: 'cors' });
const estadoEsperado = (version: string, completo: boolean) => ({ type: 'ESTADO_DEL_PAQUETE', version, completo });
const huella = (texto: string) => createHash('sha256').update(texto).digest('hex');
const estadoDe = async (sw: ReturnType<typeof servicio>, revisar = false) =>
  JSON.parse(JSON.stringify(await prepararPaquete(sw, revisar)));
function conservarAnterior(sw: ReturnType<typeof servicio>) {
  const anterior = new Map([[sw.urlDe('paquete/anterior/datos.json'), new Response('ANTERIOR')]]);
  sw.guardadas.set('faro-paquete-anterior', anterior);
  return anterior;
}
type Fallo = 'json-roto' | 'lectura-fallida' | 'objeto-vacio' | 'lista-vacia' | 'otra-huella';

function manifiestoIlegible(fallo: Fallo): Response {
  if (fallo === 'objeto-vacio') {
    return new Response('{}');
  }
  if (fallo === 'lista-vacia') {
    return new Response('[]');
  }
  if (fallo === 'otra-huella') {
    return new Response(JSON.stringify({ 'ajeno.json': { sha256: huella('AJENO') } }));
  }
  if (fallo === 'json-roto') {
    return new Response('{');
  }
  return new Response(
    new ReadableStream({
      start(control) {
        control.error(new Error('No se puede leer el cuerpo guardado'));
      },
    }),
  );
}

for (const base of BASES) {
  for (const fallo of ['json-roto', 'lectura-fallida', 'objeto-vacio', 'lista-vacia', 'otra-huella'] as const) {
    test(`manifiesto ${fallo}: no confirma la copia y permite repararla sin perder datos: ${base}`, async () => {
      const datos = '{"valor":"conservado"}';
      const manifiesto = JSON.stringify({ 'datos.json': { sha256: huella(datos) } });
      const version = huella(manifiesto).slice(0, CIFRAS_VERSION);
      const sw = servicio(base, { paquete: version });
      const claveManifiesto = sw.urlDe(`paquete/${version}/manifiesto.json`);
      const claveDatos = sw.urlDe(`paquete/${version}/datos.json`);
      const ilegible = manifiestoIlegible(fallo);
      const actual = new Map([
        [claveManifiesto, ilegible],
        [claveDatos, new Response(datos)],
        [sw.urlDe(`paquete/${version}/ajeno.json`), new Response('AJENO')],
      ]);
      const anterior = conservarAnterior(sw);
      sw.guardadas.set(`faro-paquete-${version}`, actual);
      sw.registro.waiting = {};

      assert.deepEqual(await estadoDe(sw), estadoEsperado(version, false));
      assert.equal(actual.has(claveManifiesto), false, 'un intento fallido no deja el marcador de completa');
      assert.equal(await actual.get(claveDatos)?.clone().text(), datos);
      assert.equal(sw.guardadas.get('faro-paquete-anterior'), anterior);
      assert.deepEqual(sw.borradas, [], 'una reparación fallida conserva todas las otras copias');
      assert.ok(sw.avisos.length > 0, 'la imposibilidad de comprobar y reparar queda diagnosticada');

      sw.conectar();
      sw.red.respuesta = () => new Response(manifiesto);
      assert.deepEqual(await estadoDe(sw), estadoEsperado(version, true));
      assert.equal(await actual.get(claveManifiesto)?.clone().text(), manifiesto);
      assert.equal(await actual.get(claveDatos)?.clone().text(), datos);
      assert.equal(sw.guardadas.get('faro-paquete-anterior'), anterior);
      assert.ok(
        sw.peticiones.every((url) => url === claveManifiesto),
        'no vuelve a descargar el archivo conservado',
      );
      const antes = [...sw.peticiones];
      await prepararPaquete(sw);
      assert.deepEqual(sw.peticiones, antes, 'la reparación completa es idempotente');
    });
  }
}

for (const base of BASES) {
  for (const fallo of ['ajeno', 'ilegible'] as const) {
    test(`repara un recurso ausente y otro ${fallo} sin perder la copia anterior: ${base}`, async () => {
      const datos = '{"valor":"correcto"}';
      const conservado = '{"valor":"conservado"}';
      const manifiesto = JSON.stringify({
        'datos.json': { sha256: huella(datos) },
        'conservado.json': { sha256: huella(conservado), origenes: { prueba: 'metadatos permitidos' } },
      });
      const version = huella(manifiesto).slice(0, CIFRAS_VERSION);
      const sw = servicio(base, { paquete: version });
      const claveManifiesto = sw.urlDe(`paquete/${version}/manifiesto.json`);
      const claveDatos = sw.urlDe(`paquete/${version}/datos.json`);
      const claveConservado = sw.urlDe(`paquete/${version}/conservado.json`);
      const actual = new Map([
        [claveManifiesto, new Response(manifiesto)],
        [claveConservado, fallo === 'ilegible' ? manifiestoIlegible('lectura-fallida') : new Response('AJENO')],
      ]);
      const anterior = conservarAnterior(sw);
      sw.guardadas.set(`faro-paquete-${version}`, actual);

      assert.equal((await estadoDe(sw)).completo, false);
      assert.equal(sw.guardadas.get('faro-paquete-anterior'), anterior);
      assert.deepEqual(sw.borradas, []);
      assert.equal((await pedirDatos(sw, version)).estado, NO_DISPONIBLE);

      sw.conectar();
      sw.red.respuesta = (url) => new Response(url === claveManifiesto ? manifiesto : 'RESPUESTA INCORRECTA');
      assert.equal((await estadoDe(sw, true)).completo, false, 'no confirma recursos descargados sin su huella');
      assert.equal(actual.has(claveManifiesto), false);
      assert.equal(sw.guardadas.get('faro-paquete-anterior'), anterior);
      assert.deepEqual(sw.borradas, []);

      const respuestas = new Map([
        [claveManifiesto, manifiesto],
        [claveDatos, datos],
        [claveConservado, conservado],
      ]);
      sw.red.respuesta = (url) => new Response(respuestas.get(url));
      assert.equal((await estadoDe(sw, true)).completo, true);
      assert.equal(await actual.get(claveManifiesto)?.clone().text(), manifiesto);
      assert.equal(await actual.get(claveConservado)?.clone().text(), conservado);
      assert.equal((await pedirDatos(sw, version)).cuerpo, datos);
      assert.deepEqual(sw.borradas, ['faro-paquete-anterior'], 'solo retira la anterior con la candidata íntegra');
      const antes = [...sw.peticiones];
      assert.equal((await estadoDe(sw)).completo, true);
      assert.deepEqual(sw.peticiones, antes);
    });
  }

  for (const contenido of [
    '{}',
    '[]',
    'null',
    JSON.stringify({ 'datos.json': {} }),
    JSON.stringify({ 'datos.json': { sha256: 'no-es-una-huella' } }),
    JSON.stringify({ 'manifiesto.json': { sha256: huella('AJENO') } }),
    JSON.stringify({ '../ajeno.json': { sha256: huella('AJENO') } }),
  ]) {
    test(`rechaza un manifiesto fuera de contrato aunque tenga la huella publicada: ${contenido}: ${base}`, async () => {
      const version = huella(contenido).slice(0, CIFRAS_VERSION);
      const sw = servicio(base, { paquete: version });
      const anterior = conservarAnterior(sw);
      sw.conectar();
      sw.red.respuesta = () => new Response(contenido);
      assert.equal((await estadoDe(sw)).completo, false);
      assert.equal(sw.guardadas.get(`faro-paquete-${version}`)?.size, 0);
      assert.equal(sw.guardadas.get('faro-paquete-anterior'), anterior);
      assert.deepEqual(sw.borradas, []);
      assert.ok(sw.peticiones.every((url) => url === sw.urlDe(`paquete/${version}/manifiesto.json`)));
    });
  }
}

for (const base of BASES) {
  for (const origen of ['red', 'otra-copia'] as const) {
    test(`una copia anterior ilegible no bloquea la reparación desde ${origen}: ${base}`, async () => {
      const datos = '{"valor":"correcto"}';
      const manifiesto = JSON.stringify({ 'datos.json': { sha256: huella(datos) } });
      const version = huella(manifiesto).slice(0, CIFRAS_VERSION);
      const sw = servicio(base, { paquete: version });
      const anterior = conservarAnterior(sw);
      anterior.set(sw.urlDe('paquete/anterior/datos.json'), manifiestoIlegible('lectura-fallida'));
      sw.conectar();
      const claveManifiesto = sw.urlDe(`paquete/${version}/manifiesto.json`);
      const claveDatos = sw.urlDe(`paquete/${version}/datos.json`);
      sw.red.respuesta = (url) => new Response(url === claveManifiesto ? manifiesto : 'NO COINCIDE');
      assert.deepEqual(await estadoDe(sw), estadoEsperado(version, false));
      assert.equal(sw.guardadas.get('faro-paquete-anterior'), anterior);
      assert.deepEqual(sw.borradas, []);
      sw.peticiones.length = 0;
      if (origen === 'otra-copia') {
        sw.guardadas.set('faro-paquete-otra', new Map([[sw.urlDe('paquete/otra/datos.json'), new Response(datos)]]));
      } else {
        sw.red.respuesta = (url) => new Response(url === claveManifiesto ? manifiesto : datos);
      }
      assert.deepEqual(await estadoDe(sw), estadoEsperado(version, true));
      assert.equal((await pedirDatos(sw, version)).cuerpo, datos);
      assert.equal(sw.peticiones.includes(claveDatos), origen === 'red');
      const antes = [...sw.peticiones];
      assert.deepEqual(await estadoDe(sw), estadoEsperado(version, true));
      assert.deepEqual(sw.peticiones, antes);
    });
  }
}
