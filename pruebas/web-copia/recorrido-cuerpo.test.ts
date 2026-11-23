import assert from 'node:assert/strict';
import { test } from 'node:test';
import { listasDeLaCopia } from '../../herramientas/web/copia-sin-conexion.ts';
import { archivosPublicados, leer } from '../../herramientas/web/publicados.ts';
import { referenciasJs, resolver } from '../../herramientas/web/referencias.ts';

test('el cuerpo del motor local forma parte del grafo real y del catálogo generado para la copia', () => {
  const paso = 'scripts/recorrido/paso-ocupacion.js';
  const cuerpo = 'scripts/recorrido/cuerpo-local.js';
  const publicados = archivosPublicados();
  assert.ok(publicados.includes(cuerpo), 'El módulo debe publicarse');
  assert.ok(referenciasJs(leer(paso)).some((referencia) => resolver(paso, referencia) === cuerpo));
  const listas = listasDeLaCopia(publicados);
  assert.ok([...listas.archivos, ...listas.bajoDemanda, ...listas.comprobados].includes(cuerpo));
});
