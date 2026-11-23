// El formateador dice la causa del fallo y repite una sola vez cuando Biome agota el plazo.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type EjecutorDeBiome,
  FormatoNoDisponible,
  formatearTextoConBiome,
} from '../../herramientas/comun/archivos.ts';

/** Un error con la forma del que lanza execFileSync al agotar el plazo. */
function errorDePlazo(): Error {
  return Object.assign(new Error('spawnSync node ETIMEDOUT'), {
    code: 'ETIMEDOUT',
    signal: 'SIGTERM',
    status: null,
    stderr: '',
  });
}

/** Los plazos de herramientas/comun/archivos.ts: el del primer intento y el del único reintento. */
const PLAZO_PRIMERO_MS = 30_000;
const PLAZO_REINTENTO_MS = 120_000;

/** Un ejecutor que responde con la lista dada, en orden, y cuenta las llamadas. */
function ejecutorCon(respuestas: readonly (string | Error)[]): {
  ejecutar: EjecutorDeBiome;
  llamadas: () => number;
  plazos: number[];
} {
  let llamadas = 0;
  const plazos: number[] = [];
  const ejecutar: EjecutorDeBiome = (_argumentos, _entrada, plazoMs) => {
    plazos.push(plazoMs);
    const respuesta = respuestas[llamadas++];
    if (respuesta instanceof Error) {
      throw respuesta;
    }
    assert.ok(respuesta !== undefined, 'llamada de más al ejecutor');
    return respuesta;
  };
  return { ejecutar, llamadas: () => llamadas, plazos };
}

test('un plazo agotado seguido de un éxito devuelve el texto y avisa en stderr', (t) => {
  const avisos: string[] = [];
  t.mock.method(process.stderr, 'write', (texto: string) => {
    avisos.push(texto);
    return true;
  });
  const { ejecutar, llamadas, plazos } = ejecutorCon([errorDePlazo(), '<p>hola</p>\n']);
  assert.equal(formatearTextoConBiome('<p>hola</p>', 'inicio.html', ejecutar), '<p>hola</p>\n');
  assert.equal(llamadas(), 2);
  // El reintento tiene un plazo más holgado: si el primero lo agotó, el equipo va cargado.
  assert.deepEqual(plazos, [PLAZO_PRIMERO_MS, PLAZO_REINTENTO_MS]);
  assert.equal(avisos.length, 1);
  assert.match(
    avisos[0] ?? '',
    /se repite el formato de inicio\.html.*plazo de 30000 ms agotado \(ETIMEDOUT, SIGTERM\)/,
  );
});

test('dos plazos agotados lanzan FormatoNoDisponible con la causa', (t) => {
  t.mock.method(process.stderr, 'write', () => true);
  const segundo = errorDePlazo();
  const { ejecutar, llamadas } = ejecutorCon([errorDePlazo(), segundo]);
  assert.throws(
    () => formatearTextoConBiome('<p>hola</p>', 'inicio.html', ejecutar),
    (error: unknown) => {
      assert.ok(error instanceof FormatoNoDisponible);
      assert.match(
        error.message,
        /inicio\.html con Biome tras repetirlo: plazo de 120000 ms agotado \(ETIMEDOUT, SIGTERM\)/,
      );
      assert.equal(error.cause, segundo);
      return true;
    },
  );
  assert.equal(llamadas(), 2);
});

test('un fallo que no es de plazo no se repite y dice el código y stderr', (t) => {
  const avisos: string[] = [];
  t.mock.method(process.stderr, 'write', (texto: string) => {
    avisos.push(texto);
    return true;
  });
  const rechazo = Object.assign(new Error('Command failed'), {
    status: 1,
    signal: null,
    stderr: '\n\u001b[31mmalo.html:1:1 parse ━━━━━━\u001b[0m\n  × Unexpected token\n',
  });
  const { ejecutar, llamadas } = ejecutorCon([rechazo, 'no debe llegar']);
  assert.throws(
    () => formatearTextoConBiome('<p', 'malo.html', ejecutar),
    (error: unknown) => {
      assert.ok(error instanceof FormatoNoDisponible);
      assert.equal(
        error.message,
        'No se puede formatear malo.html con Biome: Biome salió con el código 1: Unexpected token',
      );
      assert.equal(error.cause, rechazo);
      return true;
    },
  );
  assert.equal(llamadas(), 1);
  assert.deepEqual(avisos, []);
});
