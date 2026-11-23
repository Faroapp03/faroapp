import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import type { PoliticaControles } from '../../src/administracion/controles.ts';
import {
  type AccesoSesionPanel,
  DURACION_MAXIMA_SESION_PANEL_MS,
  INACTIVIDAD_SESION_PANEL_MS,
} from '../../src/administracion/sesion.ts';
import {
  crearIdLegible,
  esIdEntrada,
  esIdSesion,
  FILAS_LECTURA_REGISTRO_PANEL,
  type IdentidadPanel,
  leerIdentidadPanel,
  MAX_FILAS_CON_TOPE_REGISTRO_PANEL,
  RETENCION_REGISTRO_PANEL_MS,
} from '../../src/administracion/sesion-unica.ts';
import { AlmacenSesionPanelSqlite } from '../../src/plataforma/acceso-publico/sesion-sqlite.ts';
import { AlmacenPublicoSqlite, type SqlAccesoPublico } from '../../src/plataforma/acceso-publico/sqlite.ts';

const INICIO = 10_000;
const MINUTO = 60_000;
const LARGO_ID = 8;
const SOBRANTES = 5;
const MUESTRAS_ID = 200;
/** Con 40 bits por identificador, dos iguales entre 200 serían un fallo del generador, no mala suerte. */
const DISTINTOS_MINIMOS = 199;
const ULTIMO_SIMBOLO = 31;
const politica: PoliticaControles = { version: 2, api: 'deshabilitada', mcp: false, a2a: false };

function huella(...partes: unknown[]): string {
  return createHash('sha256').update(JSON.stringify(partes)).digest('hex');
}
/** Persona sintética: la huella de su sesión de Access depende del instante de emisión del JWT. */
function persona(nombre: string, emitido = 1): IdentidadPanel {
  return {
    huellaPrincipal: huella('principal', nombre),
    correo: `${nombre}@faro.invalid`,
    huellaEntrada: huella('entrada', nombre, emitido),
  };
}
function token(quien: IdentidadPanel, dispositivo: string): AccesoSesionPanel {
  return { huellaSesion: huella('token', dispositivo), huellaPrincipal: quien.huellaPrincipal };
}
function motor(db: DatabaseSync): SqlAccesoPublico {
  return {
    filas: (sql, ...valores) => db.prepare(sql).all(...valores),
    ejecutar: (sql, ...valores) => {
      db.prepare(sql).run(...valores);
    },
    transaccion: <T>(accion: () => T): T => {
      db.exec('BEGIN IMMEDIATE');
      try {
        const resultado = accion();
        db.exec('COMMIT');
        return resultado;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
}
interface Contexto {
  readonly db: DatabaseSync;
  readonly s: AlmacenSesionPanelSqlite;
  readonly reloj: { ahora: number };
}
/** Identificadores deterministas con el mismo formato que los aleatorios. */
function contador() {
  let n = 0;
  return (prefijo: 'E' | 'S') => {
    n += 1;
    return `${prefijo}-${String(n).padStart(LARGO_ID, '0')}`;
  };
}
function conPanel(accion: (contexto: Contexto) => Promise<void>) {
  return async () => {
    const db = new DatabaseSync(':memory:');
    const sql = motor(db);
    const reloj = { ahora: INICIO };
    const publico = new AlmacenPublicoSqlite(sql, { maxClientes: 1, ahora: () => reloj.ahora });
    const s = new AlmacenSesionPanelSqlite(sql, { ahora: () => reloj.ahora, crearId: contador() });
    try {
      await publico.activarControles(politica);
      await s.activarSesionPanel();
      await accion({ db, s, reloj });
    } finally {
      db.close();
    }
  };
}
const ana = persona('ana');
const berta = persona('berta');

test(
  'otra identidad no puede abrir mientras la sesión vive: queda bloqueada, se dice quién y se anota',
  conPanel(async ({ s, reloj }) => {
    const abierta = await s.abrirSesionUnica(token(ana, 'portatil'), ana, false);
    assert.equal(abierta.estado, 'abierta');
    assert.ok(abierta.estado === 'abierta' && esIdSesion(abierta.idSesion) && esIdEntrada(abierta.idEntrada));
    reloj.ahora += MINUTO;
    const ocupada = await s.abrirSesionUnica(token(berta, 'oficina'), berta, true);
    assert.deepEqual(ocupada, {
      estado: 'ocupada',
      ocupacion: {
        correo: 'ana@faro.invalid',
        desde: INICIO,
        cierrePorInactividadEn: INICIO + INACTIVIDAD_SESION_PANEL_MS,
        limiteEn: INICIO + DURACION_MAXIMA_SESION_PANEL_MS,
        idSesion: null,
        idEntrada: null,
        propia: false,
      },
    });
    assert.equal((await s.comprobarSesion(token(ana, 'portatil'))).estado, 'activa');
    const [rechazo] = await s.leerRegistroPanel();
    assert.deepEqual(rechazo, {
      instante: INICIO + MINUTO,
      tipo: 'apertura-rechazada',
      correo: 'berta@faro.invalid',
      idEntrada: 'E-00000003',
      idSesion: abierta.estado === 'abierta' ? abierta.idSesion : null,
      motivo: null,
      titular: 'ana@faro.invalid',
    });
  }),
);

test(
  'la misma persona en otro dispositivo solo la retoma si lo pide; el primero queda fuera',
  conPanel(async ({ s }) => {
    const anaMovil = persona('ana', 2);
    const primera = await s.abrirSesionUnica(token(ana, 'portatil'), ana, false);
    assert.equal(primera.estado, 'abierta');
    const aviso = await s.abrirSesionUnica(token(anaMovil, 'movil'), anaMovil, false);
    assert.equal(aviso.estado, 'ocupada');
    assert.equal(aviso.estado === 'ocupada' && aviso.ocupacion.propia, true);
    assert.deepEqual(aviso.estado === 'ocupada' && [aviso.ocupacion.idSesion, aviso.ocupacion.idEntrada], [
      'S-00000002',
      'E-00000001',
    ]);
    assert.equal((await s.comprobarSesion(token(ana, 'portatil'))).estado, 'activa');
    const retomada = await s.abrirSesionUnica(token(anaMovil, 'movil'), anaMovil, true);
    assert.equal(retomada.estado, 'abierta');
    assert.deepEqual(await s.comprobarSesion(token(ana, 'portatil')), { estado: 'sustituida' });
    assert.equal((await s.comprobarSesion(token(anaMovil, 'movil'))).estado, 'activa');
    const tipos = (await s.leerRegistroPanel()).map((fila) => [fila.tipo, fila.idEntrada, fila.idSesion]);
    assert.deepEqual(tipos, [
      ['sesion-abierta', 'E-00000003', 'S-00000004'],
      ['sesion-retomada', 'E-00000003', 'S-00000002'],
      ['entrada', 'E-00000003', null],
      ['sesion-abierta', 'E-00000001', 'S-00000002'],
      ['entrada', 'E-00000001', null],
    ]);
  }),
);

test(
  'al vencer por inactividad se libera, se anota una vez con su instante y su titular la ve caducada',
  conPanel(async ({ s, reloj }) => {
    await s.abrirSesionUnica(token(ana, 'portatil'), ana, false);
    reloj.ahora = INICIO + INACTIVIDAD_SESION_PANEL_MS;
    assert.equal((await s.abrirSesionUnica(token(berta, 'oficina'), berta, false)).estado, 'abierta');
    assert.deepEqual(await s.comprobarSesion(token(ana, 'portatil')), { estado: 'sustituida' });
    const caducadas = (await s.leerRegistroPanel()).filter((fila) => fila.tipo === 'sesion-caducada');
    assert.deepEqual(caducadas, [
      {
        instante: INICIO + INACTIVIDAD_SESION_PANEL_MS,
        tipo: 'sesion-caducada',
        correo: 'ana@faro.invalid',
        idEntrada: 'E-00000001',
        idSesion: 'S-00000002',
        motivo: 'inactividad',
        titular: null,
      },
    ]);
  }),
);

test(
  'la duración máxima libera aunque haya actividad y se distingue de la inactividad',
  conPanel(async ({ s, reloj }) => {
    await s.abrirSesionUnica(token(ana, 'portatil'), ana, false);
    while (reloj.ahora + 10 * MINUTO < INICIO + DURACION_MAXIMA_SESION_PANEL_MS) {
      reloj.ahora += 10 * MINUTO;
      assert.equal((await s.mantenerSesion(token(ana, 'portatil'))).estado, 'activa');
    }
    const bienvenida = await s.recibirEnPanel(berta);
    assert.equal(bienvenida.ocupacion?.limiteEn, INICIO + DURACION_MAXIMA_SESION_PANEL_MS);
    assert.equal(bienvenida.ocupacion?.cierrePorInactividadEn, reloj.ahora + INACTIVIDAD_SESION_PANEL_MS);
    reloj.ahora = INICIO + DURACION_MAXIMA_SESION_PANEL_MS;
    assert.deepEqual(await s.comprobarSesion(token(ana, 'portatil')), { estado: 'caducada' });
    assert.equal((await s.recibirEnPanel(berta)).ocupacion, null);
    const caducada = (await s.leerRegistroPanel()).find((fila) => fila.tipo === 'sesion-caducada');
    assert.equal(caducada?.motivo, 'duracion');
    assert.equal(caducada?.instante, INICIO + DURACION_MAXIMA_SESION_PANEL_MS);
  }),
);

test(
  'cerrar anota sesion-cerrada una vez, con su entrada y su sesión, y libera el panel',
  conPanel(async ({ s }) => {
    await s.abrirSesionUnica(token(ana, 'portatil'), ana, false);
    assert.deepEqual(await s.cerrarSesion(token(ana, 'portatil')), { estado: 'cerrada' });
    assert.deepEqual(await s.cerrarSesion(token(ana, 'portatil')), { estado: 'cerrada' });
    const cierres = (await s.leerRegistroPanel()).filter((fila) => fila.tipo === 'sesion-cerrada');
    assert.deepEqual(
      cierres.map((fila) => [fila.correo, fila.idEntrada, fila.idSesion]),
      [['ana@faro.invalid', 'E-00000001', 'S-00000002']],
    );
    assert.equal((await s.recibirEnPanel(berta)).ocupacion, null);
  }),
);

test(
  'entrada: una por sesión de Access, no por petición; sin apertura queda sin sesión; la sesión lleva su entrada',
  conPanel(async ({ s, reloj }) => {
    const primera = await s.recibirEnPanel(ana);
    reloj.ahora += MINUTO;
    assert.deepEqual(await s.recibirEnPanel(ana), primera);
    assert.deepEqual(primera, {
      correo: 'ana@faro.invalid',
      idEntrada: 'E-00000001',
      entradaEn: INICIO,
      ocupacion: null,
    });
    const otraAccess = await s.recibirEnPanel(persona('ana', 2));
    assert.equal(otraAccess.idEntrada, 'E-00000002');
    const abierta = await s.abrirSesionUnica(token(ana, 'portatil'), ana, false);
    assert.equal(abierta.estado === 'abierta' && abierta.idEntrada, 'E-00000001');
    const registro = await s.leerRegistroPanel();
    assert.deepEqual(
      registro.map((fila) => [fila.tipo, fila.idEntrada, fila.idSesion]),
      [
        ['sesion-abierta', 'E-00000001', 'S-00000003'],
        ['entrada', 'E-00000002', null],
        ['entrada', 'E-00000001', null],
      ],
    );
    for (const fila of registro) {
      assert.deepEqual(Object.keys(fila).sort(), [
        'correo',
        'idEntrada',
        'idSesion',
        'instante',
        'motivo',
        'tipo',
        'titular',
      ]);
    }
  }),
);

test(
  'retención: 90 días para todas las filas; el tope por número solo alcanza a entradas y rechazos, nunca a la sesión',
  conPanel(async ({ s, reloj, db }) => {
    await s.recibirEnPanel(ana);
    reloj.ahora = INICIO + RETENCION_REGISTRO_PANEL_MS + 1;
    assert.deepEqual(await s.leerRegistroPanel(), []);
    await s.abrirSesionUnica(token(ana, 'portatil'), ana, false);
    for (let n = 0; n < MAX_FILAS_CON_TOPE_REGISTRO_PANEL + SOBRANTES; n += 1) {
      const intento = persona('berta', n + 10);
      assert.equal((await s.abrirSesionUnica(token(intento, `intento-${n}`), intento, false)).estado, 'ocupada');
    }
    const cuenta =
      "SELECT count(*) AS n FROM administracion_registro_panel WHERE tipo IN ('entrada','apertura-rechazada')";
    assert.equal(db.prepare(cuenta).get()?.n, MAX_FILAS_CON_TOPE_REGISTRO_PANEL);
    const sesion = db.prepare("SELECT correo FROM administracion_registro_panel WHERE tipo='sesion-abierta'").all();
    assert.deepEqual(
      sesion.map((fila) => fila.correo),
      ['ana@faro.invalid'],
    );
    assert.equal((await s.leerRegistroPanel()).length, FILAS_LECTURA_REGISTRO_PANEL);
  }),
);

test(
  'repetir la apertura rechazada desde la misma entrada anota un solo rechazo por cada sesión que bloquea',
  conPanel(async ({ s, reloj }) => {
    await s.abrirSesionUnica(token(ana, 'portatil'), ana, false);
    for (let n = 0; n < SOBRANTES; n += 1) {
      reloj.ahora += MINUTO;
      assert.equal((await s.abrirSesionUnica(token(berta, `oficina-${n}`), berta, false)).estado, 'ocupada');
    }
    await s.cerrarSesion(token(ana, 'portatil'));
    await s.abrirSesionUnica(token(ana, 'portatil-2'), ana, false);
    assert.equal((await s.abrirSesionUnica(token(berta, 'oficina-otra'), berta, false)).estado, 'ocupada');
    const rechazos = (await s.leerRegistroPanel()).filter((fila) => fila.tipo === 'apertura-rechazada');
    assert.deepEqual(
      rechazos.map((fila) => [fila.instante, fila.idEntrada, fila.idSesion]),
      [
        [reloj.ahora, 'E-00000003', 'S-00000004'],
        [INICIO + MINUTO, 'E-00000003', 'S-00000002'],
      ],
    );
  }),
);

test(
  'migración: una instalación anterior se adopta al preparar el panel; su sesión abierta bloquea sin titular conocido',
  conPanel(async ({ s, db }) => {
    // Reproduce una instalación anterior a la sesión única, con una sesión ya abierta en su tabla de entonces.
    db.exec('DROP TABLE administracion_sesion_unica; DROP TABLE administracion_registro_panel');
    db.exec('ALTER TABLE publico_estado DROP COLUMN sesion_unica_version');
    const antigua = token(ana, 'antigua');
    db.prepare(
      'UPDATE administracion_sesion SET huella_sesion=?,huella_principal=?,iniciada=?,actividad=?,cerrada=0,reloj=? WHERE id=1',
    ).run(antigua.huellaSesion, antigua.huellaPrincipal, INICIO, INICIO, INICIO);
    const nuevas =
      "SELECT name FROM sqlite_master WHERE name IN ('administracion_sesion_unica','administracion_registro_panel')";
    assert.deepEqual(db.prepare(nuevas).all(), []);
    await s.prepararPanel(politica);
    assert.equal(db.prepare(nuevas).all().length, 2);
    assert.equal((await s.comprobarSesion(token(ana, 'antigua'))).estado, 'activa');
    const bienvenida = await s.recibirEnPanel(berta);
    assert.deepEqual(bienvenida.ocupacion, {
      correo: null,
      desde: INICIO,
      cierrePorInactividadEn: INICIO + INACTIVIDAD_SESION_PANEL_MS,
      limiteEn: INICIO + DURACION_MAXIMA_SESION_PANEL_MS,
      idSesion: null,
      idEntrada: null,
      propia: false,
    });
    assert.equal((await s.abrirSesionUnica(token(berta, 'oficina'), berta, false)).estado, 'ocupada');
    const version = db.prepare('SELECT sesion_unica_version AS v FROM publico_estado WHERE id=1').get();
    assert.equal(version?.v, 1);
    await s.prepararPanel(politica);
    assert.equal(db.prepare(nuevas).all().length, 2);
  }),
);

test('identificadores legibles: prefijo, 8 caracteres de Crockford, aleatorios y ajenos al token', () => {
  const vistos = new Set<string>();
  for (let n = 0; n < MUESTRAS_ID; n += 1) {
    const entrada = crearIdLegible('E');
    const sesion = crearIdLegible('S');
    assert.match(entrada, /^E-[0-9A-HJKMNP-TV-Z]{8}$/);
    assert.match(sesion, /^S-[0-9A-HJKMNP-TV-Z]{8}$/);
    vistos.add(sesion);
  }
  assert.ok(vistos.size >= DISTINTOS_MINIMOS);
  assert.equal(
    crearIdLegible('S', (bytes) => bytes.fill(ULTIMO_SIMBOLO)),
    'S-ZZZZZZZZ',
  );
  assert.equal(esIdSesion('E-ZZZZZZZZ'), false);
  assert.equal(esIdEntrada('E-OOOOOOOO'), false);
});

test('la identidad del panel es estricta: correo verificado, huellas hexadecimales y nada más', async () => {
  assert.deepEqual(leerIdentidadPanel(ana), ana);
  assert.throws(() => leerIdentidadPanel({ ...ana, correo: 'sin arroba' }));
  assert.throws(() => leerIdentidadPanel({ ...ana, huellaEntrada: 'x' }));
  assert.throws(() => leerIdentidadPanel({ ...ana, ip: '192.0.2.1' }));
  const db = new DatabaseSync(':memory:');
  const s = new AlmacenSesionPanelSqlite(motor(db), { ahora: () => INICIO });
  try {
    await assert.rejects(s.abrirSesionUnica(token(berta, 'x'), ana, false));
  } finally {
    db.close();
  }
});
