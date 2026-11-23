import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { leerEstadoTrabajos as leerCompartido } from '../../src/administracion/estado-trabajos.js';
import { type EstadoTrabajos, leerEstadoTrabajos as leerServidor } from '../../src/administracion/trabajos.ts';

const AHORA = Date.parse('2026-10-16T12:00:00Z');
const SEGUNDO = 1000;
const MARGEN = 30_000;
const TAM_HUELLA = 16;
const FRACCION = 0.5;
const FIN_SEGUNDO = SEGUNDO - 1;
const ID = '11111111-1111-4111-8111-111111111111';
const BASE = {
  solicitudId: ID,
  revisionReserva: 1,
  revisionBase: 0,
  accion: 'actualizar-datos',
  creadoEn: AHORA,
  actualizadoEn: AHORA,
  runId: null,
  runAttempt: '1',
  estado: 'despacho-incierto',
  resultado: null,
} as const;
const RESULTADO = {
  resultado: 'validado',
  veredicto: 'verde',
  terminadoEn: '2026-10-16T12:00:00Z',
  huellaPaquete: 'a'.repeat(TAM_HUELLA),
  error: null,
} as const;
function estado(
  cambio: Record<string, unknown> = {},
  revision = 1,
): { version: number; revision: number; ultimoTrabajo: Record<string, unknown> } {
  return { version: 1, revision, ultimoTrabajo: { ...BASE, ...cambio } };
}
function terminado(cambio: Record<string, unknown> = {}, runId: string | null = '789', accion = 'actualizar-datos') {
  return estado({ accion, estado: 'terminado', runId, resultado: { ...RESULTADO, ...cambio } });
}
function resultadoDe(leer: (entrada: unknown) => EstadoTrabajos, entrada: unknown) {
  try {
    return { admitido: true, valor: leer(entrada) };
  } catch (error) {
    assert.ok(error instanceof Error);
    return { admitido: false, error: error.message };
  }
}
function comprobar(entrada: unknown, admitido: boolean) {
  const servidor = resultadoDe(leerServidor, entrada);
  const compartido = resultadoDe(leerCompartido, entrada);
  assert.deepEqual(compartido, servidor);
  assert.equal(compartido.admitido, admitido);
  if (!admitido) {
    assert.equal(compartido.error, 'Estado de actualización no válido');
  }
}

test('el servidor reexporta el lector público y éste funciona como módulo independiente del servidor', async () => {
  assert.equal(leerServidor, leerCompartido);
  const origen = readFileSync(new URL('../../src/administracion/estado-trabajos.js', import.meta.url));
  const independiente = await import(`data:text/javascript;base64,${origen.toString('base64')}`);
  assert.deepEqual(independiente.leerEstadoTrabajos(terminado()), leerCompartido(terminado()));
});

test('estados inicial, incierto, despachado y todos los resultados conservan el contrato público', () => {
  comprobar({ version: 1, revision: 0, ultimoTrabajo: null }, true);
  for (const accion of ['actualizar-datos', 'reintentar-pendientes', 'comprobar-programada']) {
    comprobar(estado({ accion }), true);
    comprobar(estado({ accion, estado: 'despachado', runId: '789' }, Number.MAX_SAFE_INTEGER), true);
    comprobar(terminado({}, '789', accion), true);
    for (const resultado of ['sin-pendientes', 'despacho-rechazado', 'retirado', 'ejecucion-sin-recibo']) {
      const sinRun = resultado === 'despacho-rechazado' || resultado === 'retirado';
      comprobar(terminado({ resultado, veredicto: null, huellaPaquete: null }, sinRun ? null : '789', accion), true);
    }
    for (const veredicto of ['verde', 'ámbar', 'rojo', null]) {
      for (const error of ['actualizacion_no_completada', 'actualizacion_no_admitida', 'candidato_no_verificable']) {
        comprobar(terminado({ resultado: 'rechazado', veredicto, huellaPaquete: null, error }, '789', accion), true);
      }
    }
  }
});

function producto<T>(dimensiones: readonly (readonly T[])[]): T[][] {
  return dimensiones.reduce<T[][]>(
    (filas, valores) => filas.flatMap((fila) => valores.map((valor) => [...fila, valor])),
    [[]],
  );
}
function resultadoPermitido(resultado: unknown, veredicto: unknown, huella: unknown, error: unknown) {
  if (resultado === 'validado') {
    // En ámbar, el paquete publica lo actualizado y lo que falló conserva su última versión buena.
    return (veredicto === 'verde' || veredicto === 'ámbar') && huella !== null && error === null;
  }
  if (resultado === 'rechazado') {
    return huella === null && error === 'actualizacion_no_completada';
  }
  return (
    ['sin-pendientes', 'despacho-rechazado', 'retirado', 'ejecucion-sin-recibo'].some((r) => r === resultado) &&
    veredicto === null &&
    huella === null &&
    error === null
  );
}
test('combinaciones de resultado, veredicto, huella, error, estado y ejecución fallan cerrado', () => {
  const combinaciones = producto<unknown>([
    ['validado', 'sin-pendientes', 'rechazado', 'despacho-rechazado', 'retirado', 'ejecucion-sin-recibo', 'otro'],
    ['verde', 'ámbar', 'rojo', null],
    ['a'.repeat(TAM_HUELLA), null],
    [null, 'actualizacion_no_completada', 'inventado'],
    [null, '789'],
    ['despacho-incierto', 'despachado', 'terminado'],
  ]);
  for (const [resultado, veredicto, huellaPaquete, error, runId, estadoTrabajo] of combinaciones) {
    const resultadoValido = resultadoPermitido(resultado, veredicto, huellaPaquete, error);
    const runValido =
      resultado === 'retirado' || (resultado === 'despacho-rechazado' ? runId === null : runId !== null);
    comprobar(
      estado({ estado: estadoTrabajo, runId, resultado: { ...RESULTADO, resultado, veredicto, huellaPaquete, error } }),
      estadoTrabajo === 'terminado' && resultadoValido && runValido,
    );
  }
});

test('revisiones, UUID, acción, intento, ejecución y relojes no admiten coerción ni valores no finitos', () => {
  for (const entrada of [null, undefined, true, 1, 'estado', [], {}, new Date()]) {
    comprobar(entrada, false);
  }
  for (const revision of [-1, FRACCION, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, '1', 0]) {
    comprobar({ ...estado(), revision }, false);
  }
  comprobar({ version: 1, revision: 1, ultimoTrabajo: null }, false);
  comprobar({ ...estado(), version: 2 }, false);
  for (const cambio of [
    { solicitudId: ID.toUpperCase().replace('11111111', 'AAAAAAAA') },
    { solicitudId: ID.replace('-4111-', '-1111-') },
    { solicitudId: 'secreto' },
    { revisionReserva: 0 },
    { revisionReserva: 2 },
    { revisionBase: 1 },
    { accion: 'publicar' },
    { runAttempt: 1 },
    { runAttempt: '2' },
    { runId: '0' },
    { runId: '01' },
    { runId: '9007199254740992' },
    { estado: 'despachado' },
    { estado: 'terminado' },
    { estado: 'otro' },
    { estado: 'despacho-incierto', runId: '789' },
    { actualizadoEn: AHORA - 1 },
  ]) {
    comprobar(estado(cambio), false);
  }
  for (const campo of ['revisionBase', 'revisionReserva', 'creadoEn', 'actualizadoEn']) {
    for (const valor of [-1, FRACCION, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, '1']) {
      comprobar(estado({ [campo]: valor }), false);
    }
  }
  comprobar(estado({ estado: 'despachado', runId: String(Number.MAX_SAFE_INTEGER) }), true);
  for (const cambio of [
    { huellaPaquete: 'A'.repeat(TAM_HUELLA) },
    { huellaPaquete: 'a' },
    { huellaPaquete: 1 },
    { veredicto: 'otro' },
    { error: undefined },
  ]) {
    comprobar(terminado(cambio), false);
  }
});

test('fechas canónicas y margen remoto mantienen límites inclusivos sin normalizar entradas', () => {
  for (const terminadoEn of [
    '2026-02-30T12:00:00Z',
    '2026-10-16T12:00:00.000Z',
    '2026-10-16T12:00:00+00:00',
    '2026-10-16T12:00:00z',
    '2026-10-16',
    '',
    null,
    1,
  ]) {
    comprobar(terminado({ terminadoEn }), false);
  }
  for (const desplazamiento of [-MARGEN - SEGUNDO, -MARGEN, 0, MARGEN, MARGEN + SEGUNDO]) {
    const terminadoEn = new Date(AHORA + desplazamiento).toISOString().replace('.000Z', 'Z');
    comprobar(terminado({ terminadoEn }), Math.abs(desplazamiento) <= MARGEN);
  }
  const redondeado = terminado({ terminadoEn: '2026-10-16T11:59:30Z' });
  redondeado.ultimoTrabajo.creadoEn = AHORA + FIN_SEGUNDO;
  redondeado.ultimoTrabajo.actualizadoEn = AHORA + FIN_SEGUNDO;
  comprobar(redondeado, true);
});

test('cada nivel rechaza propiedades extra, símbolos, prototipos ajenos y accesores sin ejecutarlos', () => {
  let lecturas = 0;
  const base = terminado();
  const niveles = [[], ['ultimoTrabajo'], ['ultimoTrabajo', 'resultado']] as const;
  for (const ruta of niveles) {
    const manipular = (cambiar: (valor: Record<string, unknown>) => void) => {
      const entrada = structuredClone(base);
      let objeto: Record<string, unknown> = entrada;
      for (const clave of ruta) {
        objeto = objeto[clave] as Record<string, unknown>;
      }
      cambiar(objeto);
      comprobar(entrada, false);
    };
    manipular((o) => {
      o.extra = 'no-reflejar';
    });
    manipular((o) => {
      Object.defineProperty(o, 'oculto', { value: 1 });
    });
    manipular((o) => {
      Object.defineProperty(o, Symbol('extra'), { value: 1 });
    });
    manipular((o) => {
      Object.setPrototypeOf(o, { ajeno: true });
    });
    let original: Record<string, unknown> = base;
    for (const clave of ruta) {
      original = original[clave] as Record<string, unknown>;
    }
    for (const clave of Object.keys(original)) {
      manipular((o) => {
        Object.defineProperty(o, clave, {
          get() {
            lecturas++;
            return 'no-reflejar';
          },
          enumerable: true,
        });
      });
      manipular((o) => {
        Object.defineProperty(o, clave, { value: o[clave], enumerable: false });
      });
      manipular((o) => {
        delete o[clave];
      });
    }
  }
  assert.equal(lecturas, 0);
});

test('acepta objetos sin prototipo, copia cada nivel y congela el estado sin mutar la entrada', () => {
  const entrada = terminado();
  Object.setPrototypeOf(entrada, null);
  Object.setPrototypeOf(entrada.ultimoTrabajo, null);
  const resultado = entrada.ultimoTrabajo.resultado;
  assert.ok(resultado && typeof resultado === 'object');
  Object.setPrototypeOf(resultado, null);
  comprobar(entrada, true);
  const salida = leerCompartido(entrada);
  assert.notEqual(salida, entrada);
  assert.notEqual(salida.ultimoTrabajo, entrada.ultimoTrabajo);
  assert.notEqual(salida.ultimoTrabajo?.resultado, entrada.ultimoTrabajo.resultado);
  assert.ok(Object.isFrozen(salida));
  assert.ok(Object.isFrozen(salida.ultimoTrabajo));
  assert.ok(Object.isFrozen(salida.ultimoTrabajo?.resultado));
  assert.ok(!Object.isFrozen(entrada));
  entrada.ultimoTrabajo.runId = null;
  assert.equal(salida.ultimoTrabajo?.runId, '789');
  for (const campo of ['confianza', 'huellaRecibo', 'protocoloInicio', 'inicioConfirmado']) {
    comprobar(estado({ [campo]: 'no-reflejar' }), false);
  }
});
