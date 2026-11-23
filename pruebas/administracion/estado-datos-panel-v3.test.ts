/** El contrato v3 no confunde una recomposición local con recuperación de la consulta remota. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { type EstadoDatosPanelV3, leerEstadoDatosPanel } from '../../src/administracion/estado-datos.js';

type Mutable<T> = T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;
type Documento = Mutable<EstadoDatosPanelV3>;
function documento(): Documento {
  return JSON.parse(readFileSync(new URL('../fixtures/estado-datos-v3.json', import.meta.url), 'utf8'));
}
function seguimiento(d: Documento) {
  const fila = d.seguimientoRemoto[0];
  assert.ok(fila);
  return fila;
}

function pendiente(d: Documento) {
  const fila = seguimiento(d).incidenciasPendientes[0];
  assert.ok(fila);
  return fila;
}

test('v3 conserva último fallo, positiva anterior y éxito local separados e inmutables', () => {
  const d = documento();
  const salida = leerEstadoDatosPanel(d);
  assert.deepEqual(salida, d);
  assert.equal(salida.version, d.version);
  if (salida.version !== d.version) {
    assert.fail('Versión perdida');
  }
  assert.equal(salida.fuentes[0]?.ultimaOperacion?.resultado, 'local');
  assert.equal(salida.seguimientoRemoto[0]?.ultimoIntento?.resultado, 'fallo');
  assert.equal(salida.seguimientoRemoto[0]?.incidenciasPendientes.length, 1);
  assert.ok(salida.comprobaciones.conjuntos[0]?.ultimaComprobacion);
  assert.ok(Object.isFrozen(salida.seguimientoRemoto[0]?.incidenciasPendientes));
  seguimiento(d).incidenciasPendientes.splice(0);
  assert.equal(salida.seguimientoRemoto[0]?.incidenciasPendientes.length, 1);
});
test('una migración de fila local permite desconocido sin inventar resultado remoto', () => {
  const d = documento();
  seguimiento(d).ultimoIntento = null;
  seguimiento(d).incidenciasPendientes = [];
  assert.deepEqual(leerEstadoDatosPanel(d), d);
});
test('v3 rechaza pendientes de otra fuente, resueltos, duplicados o sin último intento', () => {
  const cambios: ((d: Documento) => void)[] = [
    (d) => {
      seguimiento(d).fuente = 'otra';
    },
    (d) => {
      seguimiento(d).ultimoIntento = null;
    },
    (d) => {
      const fila = seguimiento(d);
      fila.incidenciasPendientes.push(...fila.incidenciasPendientes);
    },
    (d) => {
      pendiente(d).conjunto = 'externo';
    },
    (d) => {
      pendiente(d).operacion.resultado = 'local';
    },
    (d) => {
      const positiva = d.comprobaciones.conjuntos[0]?.ultimaComprobacion;
      assert.ok(positiva);
      positiva.fecha = '2026-10-16T12:00:12Z';
    },
  ];
  for (const cambiar of cambios) {
    const d = documento();
    cambiar(d);
    assert.throws(() => leerEstadoDatosPanel(d));
  }
});
test('v3 no ejecuta getters, toJSON ni propiedades heredadas del seguimiento remoto', () => {
  let accesos = 0;
  const d = documento();
  const adulterado = {
    ...seguimiento(d),
    get ultimoIntento() {
      accesos++;
      return null;
    },
  };
  assert.throws(() => leerEstadoDatosPanel({ ...d, seguimientoRemoto: [adulterado] }));
  assert.throws(() =>
    leerEstadoDatosPanel({
      ...d,
      seguimientoRemoto: [
        {
          ...seguimiento(d),
          toJSON() {
            accesos++;
            return {};
          },
        },
      ],
    }),
  );
  assert.equal(accesos, 0);
});
