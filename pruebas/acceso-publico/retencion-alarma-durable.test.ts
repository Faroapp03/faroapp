/**
 * Retención física de las huellas de sesión del portal, los contadores de intentos y el registro de los canales de
 * máquina con una sola alarma del objeto durable, reloj sintético y una alarma en memoria que se dispara a mano como lo
 * haría Cloudflare. No acredita un despliegue remoto: comprueba las tablas, no solo que haya alarma.
 */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { type TestContext, test } from 'node:test';
import { sanearClienteDeclarado } from '../../src/administracion/accesos.ts';
import { DIA_CONECTIVIDAD_MS, LIMITES_CONECTIVIDAD } from '../../src/administracion/instituciones.ts';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import {
  AccesoPublicoDurable,
  AlmacenPublicoDurable,
  type EstadoAccesoPublicoDurable,
} from '../../src/plataforma/acceso-publico/durable.ts';
import { VENTANA_MS } from '../../src/plataforma/acceso-publico/limite-continuo-sqlite.ts';
import {
  ProgramadorAlarmaDurable,
  type TareaAlarmaDurable,
} from '../../src/plataforma/acceso-publico/mantenimiento-durable.ts';
import type { ValorSql } from '../../src/plataforma/acceso-publico/sqlite.ts';
import { alarmaDurableDePrueba } from '../ayudas/alarma-durable.ts';

const AHORA = Date.parse('2026-11-03T08:00:00Z');
const SEGUNDO = 1000;
const VIDA_SESION_S = 3600;
const REINTENTO_MS = 3_600_000;
const RETENCION_MS = LIMITES_CONECTIVIDAD.retencionDias * DIA_CONECTIVIDAD_MS;
/** El registro guarda el día del uso, así que vence 30 días después del comienzo de ese día en UTC. */
const VENCE_REGISTRO = Math.floor(AHORA / DIA_CONECTIVIDAD_MS) * DIA_CONECTIVIDAD_MS + RETENCION_MS;
const URL_PRIVADA = 'https://registro-socios.invalid';
const politica = { version: 2, api: 'deshabilitada', mcp: true, a2a: true } as const;
const uso = { canal: 'mcp', consulta: 'ficha_grupo', ...sanearClienteDeclarado('cliente-sdk') } as const;
const LONGITUD_HUELLA = 64;
const huella = (letra: string) => letra.repeat(LONGITUD_HUELLA);
const MINUTO = 60_000;
/** Lo que espera el Worker la respuesta del objeto (PLAZO_CLIENTE_MS), que acota cada operación de la cola. */
const PLAZO_ALARMA_MS = 3000;
/** Un intento llega unos segundos después de que la alarma falle. */
const INTENTO_TRAS_EL_FALLO_MS = 5000;
const ids = (letra: string) => ({ clave: huella(letra), recientes: [], anteriores: [] });
/** Versión del contrato de los intentos que exige el objeto en el primer nivel del mensaje. */
const CONTRATO = 3;

/** La alarma de prueba, que puede dejar de responder con un error como un almacenamiento averiado. */
function alarmasRompibles() {
  const base = alarmaDurableDePrueba();
  let rota = false;
  const fallar = async (): Promise<never> => {
    throw new Error('alarma no disponible');
  };
  return {
    getAlarm: () => (rota ? fallar() : base.getAlarm()),
    setAlarm: (fecha: number) => (rota ? fallar() : base.setAlarm(fecha)),
    deleteAlarm: () => (rota ? fallar() : base.deleteAlarm()),
    romper: (valor: boolean) => {
      rota = valor;
    },
  };
}

function montar(t: TestContext) {
  t.mock.timers.enable({ apis: ['Date'], now: AHORA });
  const db = new DatabaseSync(':memory:');
  const alarmas = alarmasRompibles();
  const estado: EstadoAccesoPublicoDurable = {
    storage: {
      ...alarmas,
      sql: { exec: (s: string, ...v: ValorSql[]) => ({ toArray: () => db.prepare(s).all(...v) }) },
      transactionSync: <T>(accion: () => T): T => {
        db.exec('BEGIN IMMEDIATE');
        try {
          const r = accion();
          db.exec('COMMIT');
          return r;
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      },
    },
  };
  let servidor = new AccesoPublicoDurable(estado, {});
  const cuenta = (tabla: string) => db.prepare(`SELECT count(*) AS n FROM ${tabla}`).get()?.n;
  const pedir = async (ruta: string, cuerpo: unknown) => {
    const respuesta = await servidor.fetch(
      new Request(`${URL_PRIVADA}${ruta}`, { method: 'POST', body: JSON.stringify(cuerpo) }),
    );
    return { estado: respuesta.status, cuerpo: (await respuesta.json()) as unknown };
  };
  return {
    db,
    alarmas,
    cuenta,
    pedir,
    reiniciar: () => {
      servidor = new AccesoPublicoDurable(estado, {});
    },
    /** El manejador tal como lo llama Cloudflare, sin mover el reloj ni consumir la alarma. */
    alarma: () => servidor.alarm(),
    panel: () => new AlmacenPublicoDurable({ idFromName: (n) => n, get: () => servidor }),
    /** Cloudflare consume la alarma al dispararla: mientras corre el manejador, getAlarm devuelve null. */
    disparar: async () => {
      const fecha = await alarmas.getAlarm();
      assert.notEqual(fecha, null, 'debe haber una alarma programada');
      t.mock.timers.setTime(Math.max(Date.now(), fecha as number));
      await alarmas.deleteAlarm();
      await servidor.alarm();
    },
    entrar: (n: string) =>
      pedir('/portal/registrar', { huella: huella(n), caduca: Math.floor(Date.now() / SEGUNDO) + VIDA_SESION_S }),
    intentar: (n: string) => pedir('/recorrido/intento', { version: CONTRATO, clave: ids(n) }),
  };
}

test('sin tráfico: huellas y contadores desaparecen de la tabla a su plazo, cada uno a su hora', async (t) => {
  const m = montar(t);
  try {
    assert.deepEqual(await m.entrar('b'), { estado: ESTADO_HTTP.correcto, cuerpo: { correcto: true } });
    assert.equal(await m.alarmas.getAlarm(), AHORA + VIDA_SESION_S * SEGUNDO);
    assert.deepEqual(await m.intentar('c'), { estado: ESTADO_HTTP.correcto, cuerpo: { permitido: true } });
    assert.equal(await m.alarmas.getAlarm(), AHORA + VENTANA_MS, 'el contador vence antes y adelanta la alarma');
    assert.equal(m.cuenta('portal_sesiones'), 1);
    assert.equal(m.cuenta('portal_limite_continuo'), 1);
    await m.disparar();
    assert.equal(Date.now(), AHORA + VENTANA_MS);
    assert.equal(m.cuenta('portal_limite_continuo'), 0, 'el contador se retira al vencer su ventana');
    assert.equal(m.cuenta('portal_sesiones'), 1, 'la huella aún vale y se conserva');
    assert.equal(await m.alarmas.getAlarm(), AHORA + VIDA_SESION_S * SEGUNDO, 'la alarma pasa a la huella');
    await m.disparar();
    assert.equal(m.cuenta('portal_sesiones'), 0, 'la huella se retira al caducar sin otra entrada');
    assert.equal(await m.alarmas.getAlarm(), null, 'sin filas con plazo no queda alarma');
  } finally {
    m.db.close();
  }
});

test('filas antiguas sin alarma al arrancar: el arranque la adelanta y la alarma vacía las tablas', async (t) => {
  const m = montar(t);
  try {
    assert.equal((await m.intentar('b')).estado, ESTADO_HTTP.correcto);
    await m.alarmas.deleteAlarm();
    const pasado = AHORA - 1;
    m.db.exec(`INSERT INTO portal_sesiones VALUES ('${huella('h')}', ${Math.floor(pasado / SEGUNDO)})`);
    m.db.exec(`INSERT INTO portal_limite_continuo VALUES ('${huella('i')}', '[]', ${pasado})`);
    m.db.exec(`INSERT INTO administracion_recorrido_intentos VALUES ('${huella('j')}', ${pasado}, 3)`);
    m.reiniciar();
    assert.deepEqual(await m.pedir('/portal/disponible', {}), {
      estado: ESTADO_HTTP.correcto,
      cuerpo: { disponible: true },
    });
    const fecha = await m.alarmas.getAlarm();
    assert(fecha !== null && fecha <= AHORA, 'el arranque adelanta la alarma a la fila vencida');
    await m.disparar();
    assert.equal(m.cuenta('portal_sesiones'), 0);
    assert.equal(m.cuenta('administracion_recorrido_intentos'), 0);
    assert.equal(m.cuenta('portal_limite_continuo'), 1, 'el contador vigente se conserva');
    assert.equal(await m.alarmas.getAlarm(), AHORA + VENTANA_MS);
  } finally {
    m.db.close();
  }
});

test('reinicio con una alarma ya programada: el arranque no la retrasa ni la retira', async (t) => {
  const m = montar(t);
  try {
    assert.equal((await m.entrar('b')).estado, ESTADO_HTTP.correcto);
    const antes = AHORA + SEGUNDO;
    await m.alarmas.setAlarm(antes);
    m.reiniciar();
    assert.equal((await m.pedir('/portal/disponible', {})).estado, ESTADO_HTTP.correcto);
    assert.equal(await m.alarmas.getAlarm(), antes, 'una alarma anterior a todas las filas se respeta');
    await m.alarmas.setAlarm(AHORA + (VIDA_SESION_S + VIDA_SESION_S) * SEGUNDO);
    m.reiniciar();
    assert.equal((await m.pedir('/portal/disponible', {})).estado, ESTADO_HTTP.correcto);
    assert.equal(await m.alarmas.getAlarm(), AHORA + VIDA_SESION_S * SEGUNDO, 'una posterior se adelanta a la huella');
    t.mock.timers.setTime(AHORA + SEGUNDO);
    assert.equal((await m.entrar('c')).estado, ESTADO_HTTP.correcto);
    assert.equal(await m.alarmas.getAlarm(), AHORA + VIDA_SESION_S * SEGUNDO, 'una entrada posterior no la retrasa');
  } finally {
    m.db.close();
  }
});

test('una lectura de una huella caducada no la acepta y la retira sin esperar a la alarma', async (t) => {
  const m = montar(t);
  try {
    assert.equal((await m.entrar('b')).estado, ESTADO_HTTP.correcto);
    assert.deepEqual(await m.pedir('/portal/activa', { huella: huella('b') }), {
      estado: ESTADO_HTTP.correcto,
      cuerpo: { activa: true },
    });
    t.mock.timers.setTime(AHORA + VIDA_SESION_S * SEGUNDO);
    assert.deepEqual(await m.pedir('/portal/activa', { huella: huella('b') }), {
      estado: ESTADO_HTTP.correcto,
      cuerpo: { activa: false },
    });
    assert.equal(m.cuenta('portal_sesiones'), 0);
  } finally {
    m.db.close();
  }
});

test('una tarea que falla varias veces se reintenta sin perder las demás ni el registro de los canales', async (t) => {
  const m = montar(t);
  try {
    const panel = m.panel();
    await panel.prepararPanel(politica);
    await panel.prepararAccesos();
    await panel.registrarAcceso(uso);
    assert.equal(await m.alarmas.getAlarm(), VENCE_REGISTRO, 'el registro conserva su vencimiento exacto');
    assert.equal((await m.entrar('b')).estado, ESTADO_HTTP.correcto);
    assert.equal((await m.intentar('c')).estado, ESTADO_HTTP.correcto);
    assert.equal(await m.alarmas.getAlarm(), AHORA + VENTANA_MS, 'registrar algo que vence antes adelanta la alarma');
    m.db.exec("CREATE TRIGGER fallo_sesiones BEFORE DELETE ON portal_sesiones BEGIN SELECT RAISE(ABORT, 'fallo'); END");
    await m.disparar();
    assert.equal(m.cuenta('portal_limite_continuo'), 0);
    assert.equal(await m.alarmas.getAlarm(), AHORA + VIDA_SESION_S * SEGUNDO);
    await m.disparar();
    assert.equal(m.cuenta('portal_sesiones'), 1, 'la retirada falla');
    const primerFallo = Date.now();
    assert.equal(await m.alarmas.getAlarm(), primerFallo + REINTENTO_MS, 'reintento acotado: una hora después');
    await m.disparar();
    assert.equal(m.cuenta('portal_sesiones'), 1, 'vuelve a fallar');
    assert.equal(await m.alarmas.getAlarm(), primerFallo + REINTENTO_MS + REINTENTO_MS);
    assert.equal((await m.intentar('d')).estado, ESTADO_HTTP.correcto);
    assert.equal(await m.alarmas.getAlarm(), Date.now() + VENTANA_MS, 'otra tarea que vence antes sigue adelantándola');
    m.db.exec('DROP TRIGGER fallo_sesiones');
    await m.disparar();
    assert.equal(m.cuenta('portal_limite_continuo'), 0);
    assert.equal(m.cuenta('portal_sesiones'), 0, 'la tarea fallida se recupera en la alarma siguiente');
    assert.equal(m.cuenta('conectividad_uso'), 1, 'el registro de los canales aún no ha vencido');
    assert.equal(await m.alarmas.getAlarm(), VENCE_REGISTRO, 'el registro conserva su momento');
    await m.disparar();
    assert.equal(Date.now(), VENCE_REGISTRO);
    assert.equal(m.cuenta('conectividad_uso'), 0, 'el mantenimiento existente depura a su hora');
    assert.equal(await m.alarmas.getAlarm(), null);
  } finally {
    m.db.close();
  }
});

test('tras un fallo, una operación fuera de la alarma no retrasa la alarma de un contador nuevo', async (t) => {
  const m = montar(t);
  try {
    const panel = m.panel();
    await panel.prepararPanel(politica);
    await panel.prepararAccesos();
    await panel.registrarAcceso(uso);
    assert.equal((await m.intentar('c')).estado, ESTADO_HTTP.correcto);
    const fallo = AHORA + VENTANA_MS;
    m.db.exec(
      "CREATE TRIGGER fallo_limite BEFORE DELETE ON portal_limite_continuo BEGIN SELECT RAISE(ABORT, 'fallo'); END",
    );
    await m.disparar();
    assert.equal(Date.now(), fallo);
    assert.equal(m.cuenta('portal_limite_continuo'), 1, 'la retirada de contadores falla en T');
    assert.equal(await m.alarmas.getAlarm(), fallo + REINTENTO_MS, 'su reintento, a T+1h');
    m.db.exec('DROP TRIGGER fallo_limite');
    t.mock.timers.setTime(fallo + MINUTO);
    assert.equal((await m.intentar('d')).estado, ESTADO_HTTP.correcto);
    const vence = fallo + MINUTO + VENTANA_MS;
    assert.equal(await m.alarmas.getAlarm(), vence, 'el contador nuevo adelanta la alarma a T+16m');
    t.mock.timers.setTime(fallo + MINUTO + MINUTO);
    await panel.registrarAcceso(uso);
    assert.equal(await m.alarmas.getAlarm(), vence, 'registrar un uso en T+2m no la retrasa al reintento');
    await m.disparar();
    assert.equal(Date.now(), vence);
    assert.equal(m.cuenta('portal_limite_continuo'), 0, 'el contador nuevo se borra a los 15 minutos');
    assert.equal(await m.alarmas.getAlarm(), VENCE_REGISTRO);
  } finally {
    m.db.close();
  }
});

test('una tarea que falla no corta las demás de la misma alarma y deja un registro neutro', async (t) => {
  const m = montar(t);
  const registros: string[] = [];
  t.mock.method(console, 'error', (...partes: unknown[]) => {
    registros.push(partes.map(String).join(' '));
  });
  try {
    assert.equal((await m.entrar('b')).estado, ESTADO_HTTP.correcto);
    assert.equal((await m.intentar('c')).estado, ESTADO_HTTP.correcto);
    m.db.exec(
      `CREATE TRIGGER fallo_sesiones BEFORE DELETE ON portal_sesiones BEGIN SELECT RAISE(ABORT, '${huella('b')}'); END`,
    );
    t.mock.timers.setTime(AHORA + VIDA_SESION_S * SEGUNDO);
    await m.disparar();
    assert.equal(m.cuenta('portal_sesiones'), 1, 'la retirada de huellas falla');
    assert.equal(m.cuenta('portal_limite_continuo'), 0, 'el contador vencido en la misma alarma se borra igual');
    assert.deepEqual(
      registros.map((linea) => {
        const { suceso, operacion, estado } = JSON.parse(linea) as Record<string, unknown>;
        return [suceso, operacion, estado];
      }),
      [['fallo operativo', 'retirada-sesiones', null]],
    );
    assert.doesNotMatch(registros.join('\n'), new RegExp(huella('b')), 'el registro no copia datos de las filas');
    assert.equal(await m.alarmas.getAlarm(), Date.now() + REINTENTO_MS);
  } finally {
    m.db.close();
  }
});

test('sin alarmas no se escribe ninguna fila con plazo: 503 y tabla vacía en cada ruta que escribe', async (t) => {
  const m = montar(t);
  try {
    m.alarmas.romper(true);
    const rutas: ReadonlyArray<readonly [string, unknown, string]> = [
      ['/portal/registrar', { huella: huella('b'), caduca: AHORA / SEGUNDO + VIDA_SESION_S }, 'portal_sesiones'],
      ['/recorrido/intento', { version: CONTRATO, clave: ids('c') }, 'portal_limite_continuo'],
      ['/privado/intento', { version: CONTRATO, clave: ids('d'), valido: false }, 'portal_limite_continuo'],
    ];
    for (const [ruta, cuerpo, tabla] of rutas) {
      assert.deepEqual(
        await m.pedir(ruta, cuerpo),
        { estado: ESTADO_HTTP.noDisponible, cuerpo: { error: 'almacen_no_disponible' } },
        ruta,
      );
      assert.equal(m.cuenta(tabla), 0, ruta);
    }
    m.alarmas.romper(false);
    for (const [ruta, cuerpo, tabla] of rutas) {
      assert.equal((await m.pedir(ruta, cuerpo)).estado, ESTADO_HTTP.correcto, ruta);
      assert.notEqual(m.cuenta(tabla), 0, ruta);
    }
  } finally {
    m.db.close();
  }
});

test('si la alarma no se puede programar y Cloudflare agota sus reintentos, la operación siguiente la recupera', async (t) => {
  const m = montar(t);
  const reintentosDeCloudflare = 6;
  try {
    assert.equal((await m.entrar('b')).estado, ESTADO_HTTP.correcto);
    const caduca = AHORA + VIDA_SESION_S * SEGUNDO;
    assert.equal(await m.alarmas.getAlarm(), caduca);
    t.mock.timers.setTime(caduca);
    await m.alarmas.deleteAlarm();
    m.alarmas.romper(true);
    for (let vez = 0; vez <= reintentosDeCloudflare; vez++) {
      await assert.rejects(m.alarma(), /Mantenimiento del objeto durable no disponible/);
    }
    m.alarmas.romper(false);
    assert.equal(await m.alarmas.getAlarm(), null, 'la alarma se ha perdido');
    assert.equal((await m.pedir('/portal/disponible', {})).estado, ESTADO_HTTP.correcto);
    assert.equal(await m.alarmas.getAlarm(), caduca, 'una lectura la vuelve a programar');
    await m.disparar();
    assert.equal(m.cuenta('portal_sesiones'), 0);
  } finally {
    m.db.close();
  }
});

test('la alarma deja la red de una hora antes de empezar las tareas', async () => {
  const alarmas = alarmaDurableDePrueba();
  let durante: number | null | undefined;
  const programador = new ProgramadorAlarmaDurable(
    alarmas,
    [
      {
        operacion: 'retirada-intentos',
        vencimiento: async () => null,
        ejecutar: async () => {
          durante = await alarmas.getAlarm();
        },
      },
    ],
    () => AHORA,
  );
  await programador.alarm();
  assert.equal(durante, AHORA + REINTENTO_MS, 'si el objeto se corta aquí, la alarma vuelve en una hora');
  assert.equal(await alarmas.getAlarm(), null);
});

const esperar = () => new Promise<void>((resolver) => setImmediate(resolver));
type MetodoAlarma = 'getAlarm' | 'setAlarm' | 'deleteAlarm';
/**
 * Alarma en memoria cuya llamada siguiente de un método se puede retener: no responde hasta que la prueba la termina, y
 * solo entonces lee o cambia la alarma, o la hace fallar sin cambiarla. `escritas` guarda cada cambio cuando ocurre.
 */
function alarmaRetenible() {
  const base = alarmaDurableDePrueba();
  const escritas: Array<number | null> = [];
  const retenidas: Array<{ metodo: MetodoAlarma; terminar: () => void; fallar: () => void }> = [];
  const porRetener = new Set<MetodoAlarma>();
  const llamada = <T>(metodo: MetodoAlarma, efecto: () => Promise<T>): Promise<T> => {
    if (!porRetener.delete(metodo)) {
      return efecto();
    }
    return new Promise<T>((resolver, rechazar) => {
      retenidas.push({
        metodo,
        terminar: () => {
          efecto().then(resolver);
        },
        fallar: () => rechazar(new Error('alarma no disponible')),
      });
    });
  };
  const alarmas = {
    getAlarm: () => llamada('getAlarm', () => base.getAlarm()),
    setAlarm: (fecha: number) =>
      llamada('setAlarm', () => {
        escritas.push(fecha);
        return base.setAlarm(fecha);
      }),
    deleteAlarm: () =>
      llamada('deleteAlarm', () => {
        escritas.push(null);
        return base.deleteAlarm();
      }),
  };
  return { base, alarmas, escritas, retenidas, retener: (metodo: MetodoAlarma) => porRetener.add(metodo) };
}
/** La tarea de los contadores sobre una lista de vencimientos que la prueba llena a mano. */
const tareaDeFilas = (filas: number[]): TareaAlarmaDurable => ({
  operacion: 'retirada-intentos',
  vencimiento: async () => (filas.length ? Math.min(...filas) : null),
  ejecutar: async () => undefined,
});

test('una llamada de alarma que no responde no bloquea la cola; si termina tarde, el objeto la corrige sin otra operación', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: AHORA });
  const a = alarmaRetenible();
  const filas: number[] = [];
  const programador = new ProgramadorAlarmaDurable(a.alarmas, [tareaDeFilas(filas)]);
  const tarde = AHORA + VENTANA_MS + VENTANA_MS;
  const pronto = AHORA + VENTANA_MS;
  const estados: string[] = [];
  a.retener('setAlarm');
  for (const [nombre, fecha] of [
    ['primera', tarde],
    ['segunda', pronto],
  ] as const) {
    programador
      .cubrir(fecha, () => filas.push(fecha))
      .then(
        () => estados.push(`${nombre}: escrita`),
        () => estados.push(`${nombre}: rechazada`),
      );
  }
  await esperar();
  assert.deepEqual(
    a.retenidas.map((r) => r.metodo),
    ['setAlarm'],
    'la primera operación espera a una alarma que no responde',
  );
  t.mock.timers.tick(PLAZO_ALARMA_MS);
  await esperar();
  assert.deepEqual(estados, ['primera: rechazada', 'segunda: escrita'], 'la cola sigue tras el plazo');
  assert.deepEqual(filas, [pronto], 'la operación vencida no escribe');
  assert.equal(await a.base.getAlarm(), pronto);
  a.retenidas[0]?.terminar();
  await esperar();
  assert.deepEqual(a.escritas, [pronto, tarde, pronto], 'la llamada colgada pisa la alarma y el objeto la adelanta');
  assert.equal(await a.base.getAlarm(), pronto, 'sin tráfico, el contador conserva su alarma');
});

test('sin tráfico: una retirada de la alarma que termina tarde no deja sin alarma un contador escrito después', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: AHORA });
  const a = alarmaRetenible();
  const filas: number[] = [];
  const programador = new ProgramadorAlarmaDurable(a.alarmas, [tareaDeFilas(filas)]);
  a.retener('deleteAlarm');
  const alarma = programador.alarm();
  await esperar();
  assert.deepEqual(
    a.retenidas.map((r) => r.metodo),
    ['deleteAlarm'],
    'sin filas, la alarma intenta retirarse y no responde',
  );
  t.mock.timers.tick(PLAZO_ALARMA_MS);
  await assert.rejects(alarma, /Mantenimiento del objeto durable no disponible/);
  t.mock.timers.tick(INTENTO_TRAS_EL_FALLO_MS);
  const pronto = Date.now() + VENTANA_MS;
  await programador.cubrir(pronto, () => filas.push(pronto));
  assert.equal(await a.base.getAlarm(), pronto, 'el contador nuevo adelanta la red de una hora');
  a.retenidas[0]?.terminar();
  await esperar();
  assert.deepEqual(
    a.escritas.slice(-2),
    [null, pronto],
    'la retirada tardía la quita y el objeto la vuelve a programar',
  );
  assert.equal(await a.base.getAlarm(), pronto, 'sin tráfico, el contador conserva su alarma');
});

test('sin tráfico: una llamada de alarma que falla tarde también deja la alarma de las filas', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: AHORA });
  const a = alarmaRetenible();
  const filas = [AHORA];
  const programador = new ProgramadorAlarmaDurable(a.alarmas, [tareaDeFilas(filas)]);
  a.retener('setAlarm');
  const alarma = programador.alarm();
  await esperar();
  t.mock.timers.tick(PLAZO_ALARMA_MS);
  await assert.rejects(alarma, /Mantenimiento del objeto durable no disponible/);
  assert.equal(await a.base.getAlarm(), null, 'Cloudflare consumió la alarma y la red de una hora no llegó a fijarse');
  a.retenidas[0]?.fallar();
  await esperar();
  assert.equal(await a.base.getAlarm(), AHORA, 'la fila vencida vuelve a tener alarma');
});

test('un aviso que llega mientras otra operación comprueba la alarma no se pierde', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: AHORA });
  const a = alarmaRetenible();
  const pronto = AHORA + VENTANA_MS;
  const programador = new ProgramadorAlarmaDurable(a.alarmas, [tareaDeFilas([pronto])]);
  await a.base.setAlarm(pronto);
  await programador.arranque();
  a.retener('setAlarm');
  const alarma = programador.alarm();
  await esperar();
  t.mock.timers.tick(PLAZO_ALARMA_MS);
  await assert.rejects(alarma, /Mantenimiento del objeto durable no disponible/);
  a.retener('getAlarm');
  const comprobacion = programador.arranque();
  await esperar();
  assert.deepEqual(
    a.retenidas.map((r) => r.metodo),
    ['setAlarm', 'getAlarm'],
  );
  // La comprobación lee la alarma correcta y, justo después, la red de una hora colgada la retrasa.
  a.retenidas[1]?.terminar();
  a.retenidas[0]?.terminar();
  await comprobacion;
  await esperar();
  assert.deepEqual(a.escritas, [AHORA + REINTENTO_MS, pronto], 'la red tardía se corrige aunque llegue a mitad');
  assert.equal(await a.base.getAlarm(), pronto);
});

test('el plazo es de la operación entera: dos llamadas lentas que juntas lo pasan la hacen fallar sin escribir', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: AHORA });
  const a = alarmaRetenible();
  const filas: number[] = [];
  const programador = new ProgramadorAlarmaDurable(a.alarmas, [tareaDeFilas(filas)]);
  const pronto = AHORA + VENTANA_MS;
  let estado = 'en curso';
  a.retener('getAlarm');
  programador
    .cubrir(pronto, () => filas.push(pronto))
    .then(
      () => {
        estado = 'escrita';
      },
      () => {
        estado = 'rechazada';
      },
    );
  await esperar();
  t.mock.timers.tick(PLAZO_ALARMA_MS - SEGUNDO);
  a.retener('setAlarm');
  a.retenidas[0]?.terminar();
  await esperar();
  assert.deepEqual(
    a.retenidas.map((r) => r.metodo),
    ['getAlarm', 'setAlarm'],
    'la lectura responde dentro del plazo y la programación se queda esperando',
  );
  assert.equal(estado, 'en curso');
  t.mock.timers.tick(SEGUNDO);
  await esperar();
  assert.equal(estado, 'rechazada', 'a los 3 s de empezar la operación, no a los 3 s de su última llamada');
  assert.deepEqual(filas, [], 'la operación vencida no escribe');
});

test('una tarea que no puede calcular su vencimiento deja un registro neutro al crear el reintento, no en cada operación', async (t) => {
  const registros: string[] = [];
  t.mock.method(console, 'error', (...partes: unknown[]) => {
    registros.push(partes.map(String).join(' '));
  });
  let reloj = AHORA;
  const alarmas = alarmaDurableDePrueba();
  const programador = new ProgramadorAlarmaDurable(
    alarmas,
    [
      {
        operacion: 'retirada-sesiones',
        vencimiento: async () => {
          throw new Error('fallo');
        },
        ejecutar: async () => undefined,
      },
    ],
    () => reloj,
  );
  await programador.arranque();
  await programador.reprogramando(async () => undefined, false);
  await programador.reprogramando(async () => undefined, true);
  assert.equal(registros.length, 1, 'un solo registro mientras el reintento sigue pendiente');
  assert.equal(await alarmas.getAlarm(), AHORA + REINTENTO_MS);
  reloj = AHORA + REINTENTO_MS;
  await programador.alarm();
  assert.equal(registros.length, 2, 'vencido el reintento, el fallo que sigue crea otro y lo registra');
  assert.deepEqual(
    registros.map((linea) => {
      const { operacion, estado } = JSON.parse(linea) as Record<string, unknown>;
      return [operacion, estado];
    }),
    [
      ['retirada-sesiones', null],
      ['retirada-sesiones', null],
    ],
  );
  assert.equal(await alarmas.getAlarm(), reloj + REINTENTO_MS);
});

test('una llamada de alarma que vence y no termina nunca deja un aviso: la operación siguiente vuelve a comprobar', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: AHORA });
  const a = alarmaRetenible();
  const filas: number[] = [];
  const programador = new ProgramadorAlarmaDurable(a.alarmas, [tareaDeFilas(filas)]);
  const pronto = AHORA + VENTANA_MS;
  await programador.arranque();
  a.retener('setAlarm');
  const operacion = programador.reprogramando(async () => filas.push(pronto), false);
  await esperar();
  t.mock.timers.tick(PLAZO_ALARMA_MS);
  await assert.rejects(operacion, /Alarma del objeto durable sin respuesta/);
  assert.deepEqual(filas, [pronto], 'la acción ya había escrito cuando venció el plazo al fijar');
  assert.equal(await a.base.getAlarm(), null);
  await programador.arranque();
  assert.equal(await a.base.getAlarm(), pronto, 'la fila escrita recibe su alarma aunque la llamada no termine');
});
