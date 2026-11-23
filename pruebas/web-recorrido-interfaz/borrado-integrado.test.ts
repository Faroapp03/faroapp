import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { estado, hayAlgoQuePerder, nuevaTarea, reiniciarEstado } from '../../web/scripts/recorrido/estado.js';

const fuente = readFileSync(new URL('../../web/scripts/recorrido.js', import.meta.url), 'utf8');

/** Ejecuta los bytes de las ramas privadas; no simula el arranque del navegador. */
function funcion(nombre: string): string {
  const inicio = fuente.search(new RegExp(`(?:async )?function ${nombre}\\(`));
  assert.ok(inicio >= 0, nombre);
  const fin = fuente.indexOf('\n}', inicio);
  assert.ok(fin > inicio, nombre);
  return fuente.slice(inicio, fin + '\n}'.length);
}

function preparar() {
  reiniciarEstado();
  const vida = new AbortController();
  const pagina = { body: { dataset: {} as Record<string, string> }, documentElement: { dataset: {} } };
  const efectos: string[] = [];
  const carga = Promise.withResolvers<Record<string, unknown>>();
  const entorno = {
    document: pagina,
    hayAlgoQuePerder,
    hayMensajeDeLaPersona: () => false,
    textoEnLaBarra: () => '',
    dejarDeEsperar: () => {
      efectos.push('cancelar');
      vida.abort();
    },
    borrarTodo: () => {
      efectos.push('borrar');
      delete pagina.body.dataset.conversacion;
    },
    traducible: (s: string) => s,
    senalDeCancelacion: () => vida.signal,
    cargarPaso4: () => carga.promise,
    avisarPaso4QueFalta: () => efectos.push('sin-paso'),
  };
  const nombres = ['hayAlgoQueSePerderia', 'alBorrarEnOtraPestana', 'avisarAlSalir', 'abrirResultadoRecibido'];
  const codigo = `${nombres.map(funcion).join('\n')}\n({${nombres.join(',')}})`;
  const ramas = runInNewContext(codigo, entorno) as {
    hayAlgoQueSePerderia(): boolean;
    alBorrarEnOtraPestana(): void;
    avisarAlSalir(e: { preventDefault(): void; returnValue?: string }): void;
    abrirResultadoRecibido(codigo: string): Promise<void>;
  };
  return { vida, pagina, efectos, carga, ramas };
}

test('borrado global reconoce informe recibido visible sin mensaje, borrador ni tareas', () => {
  const p = preparar();
  p.pagina.body.dataset.conversacion = 'empezada';
  assert.equal(estado.ocupacion, null);
  assert.deepEqual(estado.tareas, []);
  assert.equal(p.ramas.hayAlgoQueSePerderia(), true);
  p.ramas.alBorrarEnOtraPestana();
  assert.equal(p.vida.signal.aborted, true);
  assert.ok(p.efectos.includes('borrar'));
  assert.equal(p.pagina.body.dataset.conversacion, undefined);
});

test('borrado global antes de llegar recibido cancela sin añadir conversación a una página vacía', async () => {
  const p = preparar();
  const pendiente = p.ramas.abrirResultadoRecibido('codigo-sintetico');
  p.ramas.alBorrarEnOtraPestana();
  p.carga.resolve({ abrirResultadoRecibido: () => p.efectos.push('informe-tardio') });
  await pendiente;
  assert.equal(p.vida.signal.aborted, true);
  assert.deepEqual(p.efectos, ['cancelar']);
  assert.equal(p.ramas.hayAlgoQueSePerderia(), false);
});

test('recibido visible activa aviso al salir y el borrado sigue retirando el contenido', () => {
  const p = preparar();
  p.pagina.body.dataset.conversacion = 'empezada';
  const salida = { preventDefault: () => p.efectos.push('aviso-salida'), returnValue: 'anterior' };
  p.ramas.avisarAlSalir(salida);
  assert.equal(salida.returnValue, '');
  assert.deepEqual(p.efectos, ['aviso-salida']);
  p.ramas.alBorrarEnOtraPestana();
  assert.deepEqual(p.efectos.slice(-2), ['cancelar', 'borrar']);
});

test('página vacía conserva salida sin aviso; recorrido normal sigue protegido', () => {
  const p = preparar();
  p.ramas.avisarAlSalir({ preventDefault: () => assert.fail('vacío no avisa') });
  assert.equal(p.efectos.length, 0);
  estado.tareas.push(nuevaTarea('Tarea sintética'));
  assert.equal(p.ramas.hayAlgoQueSePerderia(), true);
  p.ramas.alBorrarEnOtraPestana();
  assert.ok(p.efectos.includes('borrar'));
  reiniciarEstado();
});
