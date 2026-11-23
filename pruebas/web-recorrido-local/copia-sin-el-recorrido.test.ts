// La copia sin conexión no se anuncia como lista si le falta la página del recorrido: el service worker lo cuenta en el
// estado del paquete (faltaElRecorrido), y la conversación se queda en «empezar», sin el 100 %.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { leerAvanceDeLaCopia } from '../../web/scripts/paquete-sin-conexion.js';
import { estadoDeLaCopia, porcentajeDeLaPreparacion } from '../../web/scripts/recorrido/avance-de-la-preparacion.js';

const CIEN = 100;
const FASES = new Set(['comprobado', 'motor', 'datos', 'clasificador', 'vectores', 'listo']);

/** La preparación con el motor listo y la copia tal como la cuenta el estado `datos`. */
function conElEstado(datos: unknown) {
  const copia = leerAvanceDeLaCopia(datos);
  assert.ok(copia);
  return { copia, fases: FASES, listo: true };
}

test('con el paquete completo pero sin la página del recorrido, la copia no está lista', () => {
  const preparacion = conElEstado({ type: 'ESTADO_DEL_PAQUETE', version: 'v', completo: true, faltaElRecorrido: true });
  assert.equal(preparacion.copia.completo, false);
  assert.equal(estadoDeLaCopia(preparacion), 'empezar');
  assert.equal(porcentajeDeLaPreparacion(preparacion, { conLaCopia: true }), CIEN - 1);
});

test('con el paquete completo y la página del recorrido, la copia está lista', () => {
  const preparacion = conElEstado({ type: 'ESTADO_DEL_PAQUETE', version: 'v', completo: true });
  assert.equal(estadoDeLaCopia(preparacion), 'lista');
  assert.equal(porcentajeDeLaPreparacion(preparacion, { conLaCopia: true }), CIEN);
});
