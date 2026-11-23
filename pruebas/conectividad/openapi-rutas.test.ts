// Contraste entre dos inventarios independientes: documento público y enrutador ejecutado.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { ARCHIVO_OPENAPI, OPERACIONES, type Operacion } from '../../herramientas/api/openapi.ts';
import { RUTAS_API, type Ruta } from '../../src/api/api.ts';

// El método se amplía a cualquier texto para que el contraste también pueda recibir uno que la API no monta.
type Publicada = Pick<Operacion, 'ruta' | 'ejemplo'> & { metodo: string };
type Montada = Pick<Ruta, 'patron'> & { metodo: string };

function comprobar(operaciones: readonly Publicada[], rutas: readonly Montada[]): void {
  assert.equal(operaciones.length, rutas.length, 'Debe publicarse cada ruta REST ordinaria');
  const cubiertas = new Set<Montada>();
  for (const operacion of operaciones) {
    const camino = new URL(operacion.ejemplo, 'https://example.test').pathname;
    const plantilla = operacion.ruta.split('/');
    const segmentos = camino.split('/');
    assert.equal(segmentos.length, plantilla.length, 'El ejemplo debe respetar la ruta publicada');
    for (const [indice, segmento] of plantilla.entries()) {
      assert.ok(
        segmento === segmentos[indice] || (/^\{[a-zA-Z][a-zA-Z0-9_]*\}$/.test(segmento) && segmentos[indice]),
        `El ejemplo ${camino} no corresponde a ${operacion.ruta}`,
      );
    }
    const coincidencias = rutas.filter((ruta) => ruta.metodo === operacion.metodo && ruta.patron.test(camino));
    assert.equal(coincidencias.length, 1, `${operacion.metodo} ${camino}: ruta única`);
    const ruta = coincidencias[0];
    assert.ok(ruta);
    assert.equal(cubiertas.has(ruta), false, `Dos operaciones documentan la misma ruta: ${camino}`);
    cubiertas.add(ruta);
  }
  assert.equal(cubiertas.size, rutas.length, 'Ninguna ruta montada queda sin documentar');
}

test('los ejemplos OpenAPI corresponden uno a uno con las rutas REST montadas y su método', () => {
  comprobar(OPERACIONES, RUTAS_API);
  const publicado = JSON.parse(readFileSync(ARCHIVO_OPENAPI, 'utf8')) as {
    paths: Record<string, Record<string, unknown>>;
  };
  for (const operacion of OPERACIONES) {
    assert.ok(
      publicado.paths[operacion.ruta]?.[operacion.metodo.toLowerCase()],
      `Falta en el documento servido: ${operacion.ruta}`,
    );
  }
});

test('el contraste detecta ruta omitida, ejemplo incorrecto, método distinto y patrón ambiguo', () => {
  assert.throws(() => comprobar(OPERACIONES.slice(1), RUTAS_API));
  assert.throws(() =>
    comprobar(
      [{ ...OPERACIONES[0], metodo: 'GET', ruta: '/api/salud', ejemplo: '/api/inexistente' }, ...OPERACIONES.slice(1)],
      RUTAS_API,
    ),
  );
  assert.throws(() =>
    comprobar(
      [{ ...OPERACIONES[0], metodo: 'POST', ruta: '/api/salud', ejemplo: '/api/salud' }, ...OPERACIONES.slice(1)],
      RUTAS_API,
    ),
  );
  assert.throws(() =>
    comprobar([{ metodo: 'GET', ruta: '/api/distinta', ejemplo: '/api/salud' }, ...OPERACIONES.slice(1)], RUTAS_API),
  );
  assert.throws(() => comprobar(OPERACIONES, [{ metodo: 'GET', patron: /^\/api\// }, ...RUTAS_API.slice(1)]));
});
