/** Lecturas locales sintéticas con SQLite y procesos reales; ninguna consulta o identidad remota. */
import assert from 'node:assert/strict';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { type TestContext, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ejecutarVigilanteConLecturaLocal } from '../../herramientas/mantenimiento/vigilante.ts';
import type { EstadoDatosPanelV5 } from '../../src/administracion/estado-datos.js';
import {
  comprobarVigilanteConLecturaLocalSqlite,
  leerHistorialVigilanteSqlite,
  prepararVigilanteSqlite,
} from '../../src/plataforma/acceso-publico/vigilante-sqlite.ts';
import { EXTENSIONES } from '../../src/plataforma/extensiones.ts';
import { MAX_SALIDA_ESTADO_DATOS_BYTES } from '../../src/plataforma/node/estado-datos.ts';
import { instantaneaSalud, operacionSalud } from '../ayudas/salud-datos.ts';
import {
  baseVigilante,
  CONFIG_VIGILANTE,
  CORTE_VIGILANTE,
  DIA_VIGILANTE,
  HORA_VIGILANTE,
} from '../ayudas/vigilante.ts';

/** La declaración de servidor de cada extensión del registro, que la copia necesita para importar el registro. */
const SERVIDORES_DE_EXTENSIONES = EXTENSIONES.map(({ entrada }) => `web/${dirname(entrada)}/servidor`);

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
const CIFRAS_SHA = 64;
const DIAS_HASTA_VENCIDA = 40;
const MODO_ARCHIVO = 0o600;
const MODO_DIRECTORIO = 0o700;
const MAX_ESPERA_ARRANQUE_MS = 1500;
const NUEVA_CONSULTA = '2026-10-24T10:00:00Z';
const NUEVA_OBSERVACION = '2026-10-24T12:00:00Z';

function dosFuentes(): EstadoDatosPanelV5 {
  const datos = instantaneaSalud();
  const fuente = datos.fuentes[0],
    modulo = datos.modulos[0],
    conjunto = datos.comprobaciones.conjuntos[0];
  assert.ok(fuente && modulo && conjunto);
  return instantaneaSalud({
    fuentes: [...datos.fuentes, { ...fuente, id: 'citilab' }],
    modulos: [...datos.modulos, { ...modulo, id: 'citilab' }],
    comprobaciones: {
      ...datos.comprobaciones,
      conjuntos: [...datos.comprobaciones.conjuntos, { ...conjunto, id: 'citilab', fuente: 'citilab' }],
    },
    seguimientoRemoto: [
      ...(datos.seguimientoRemoto ?? []),
      { fuente: 'citilab', ultimoIntento: operacionSalud(), incidenciasPendientes: [] },
    ],
    catalogoFuentes: [
      ...datos.catalogoFuentes,
      { id: 'citilab', nombre: 'Segunda fuente independiente', tema: 'cursos', modalidad: 'operativa' },
    ],
  });
}
function falloFuente(): EstadoDatosPanelV5 {
  const datos = dosFuentes();
  const fecha = '2026-10-23T13:00:00Z';
  const fallo = operacionSalud({
    ciclo: '00000000-0000-4000-8000-000000000002',
    inicioEn: fecha,
    finEn: fecha,
    ultimoIntentoRemotoEn: fecha,
    resultado: 'fallo',
    huellaEvidencia: null,
  });
  return {
    ...datos,
    observadoEn: fecha,
    fuentes: datos.fuentes.map((f) => (f.id === 'empresas' ? { ...f, ultimaOperacion: fallo } : f)),
    comprobaciones: { ...datos.comprobaciones, registradoEn: fecha },
    seguimientoRemoto: (datos.seguimientoRemoto ?? []).map((s) =>
      s.fuente === 'empresas'
        ? { ...s, ultimoIntento: fallo, incidenciasPendientes: [{ conjunto: 'empresas', operacion: fallo }] }
        : s,
    ),
  };
}
function recuperacionFuente(): EstadoDatosPanelV5 {
  const datos = dosFuentes();
  const operacion = operacionSalud({
    ciclo: '00000000-0000-4000-8000-000000000003',
    inicioEn: NUEVA_CONSULTA,
    finEn: NUEVA_CONSULTA,
    ultimoIntentoRemotoEn: NUEVA_CONSULTA,
  });
  return {
    ...datos,
    observadoEn: NUEVA_OBSERVACION,
    fuentes: datos.fuentes.map((f) => (f.id === 'empresas' ? { ...f, ultimaOperacion: operacion } : f)),
    comprobaciones: {
      ...datos.comprobaciones,
      registradoEn: NUEVA_CONSULTA,
      conjuntos: datos.comprobaciones.conjuntos.map((c) =>
        c.fuente === 'empresas'
          ? {
              ...c,
              ultimaComprobacion: {
                fecha: NUEVA_CONSULTA,
                ciclo: operacion.ciclo,
                huellaEvidencia: 'a'.repeat(CIFRAS_SHA),
              },
            }
          : c,
      ),
    },
    seguimientoRemoto: (datos.seguimientoRemoto ?? []).map((s) =>
      s.fuente === 'empresas' ? { ...s, ultimoIntento: operacion, incidenciasPendientes: [] } : s,
    ),
  };
}
/** Detecta también escrituras indirectas fuera de las tablas propias del vigilante. */
function autoridades(db: DatabaseSync): string {
  const tablas = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'administracion_vigilante%' ORDER BY name",
    )
    .all();
  return JSON.stringify(
    tablas.map(({ name }) => {
      assert.ok(typeof name === 'string' && /^[a-z_]+$/.test(name));
      return [name, db.prepare(`SELECT * FROM ${name}`).all()];
    }),
  );
}
function autoridadesArchivo(base: string): string {
  const db = new DatabaseSync(base, { readOnly: true });
  try {
    return autoridades(db);
  } finally {
    db.close();
  }
}

test('observación local válida llega al vigilante sin un recibo de trabajo', async (t) => {
  const f = await baseVigilante(t);
  prepararVigilanteSqlite(f.sql, CONFIG_VIGILANTE, CORTE_VIGILANTE);
  const antes = autoridades(f.db);
  const resultado = comprobarVigilanteConLecturaLocalSqlite(
    f.sql,
    { configuracion: CONFIG_VIGILANTE, datos: instantaneaSalud() },
    CORTE_VIGILANTE,
  );
  assert.equal(resultado.evaluacion.mantenimiento?.operativas[0]?.id, 'empresas');
  assert.equal(resultado.origenDatos, 'lectura-local');
  assert.equal(resultado.evaluacion.trabajoObservado?.ultimoTrabajo, null);
  assert.equal(autoridades(f.db), antes);
});

test('cuatro escenas usan el mismo historial y no escriben trabajos, reservas, sesiones ni recibos', async (t) => {
  const f = await baseVigilante(t);
  prepararVigilanteSqlite(f.sql, CONFIG_VIGILANTE, CORTE_VIGILANTE);
  const antes = autoridades(f.db);
  const sql = {
    ...f.sql,
    ejecutar: (sentencia: string, ...valores: (string | number | null)[]) => {
      assert.match(sentencia, /^(?:INSERT INTO|UPDATE) administracion_vigilante/);
      f.sql.ejecutar(sentencia, ...valores);
    },
  };
  const evaluar = (datos: EstadoDatosPanelV5, ahora: number) =>
    comprobarVigilanteConLecturaLocalSqlite(sql, { configuracion: CONFIG_VIGILANTE, datos }, ahora);
  const valida = evaluar(dosFuentes(), CORTE_VIGILANTE);
  assert.ok(valida.evaluacion.mantenimiento?.operativas.every((f) => f.estado === 'comprobada'));
  const fallo = evaluar(falloFuente(), CORTE_VIGILANTE + HORA_VIGILANTE);
  assert.equal(fallo.evaluacion.mantenimiento?.operativas.find((f) => f.id === 'empresas')?.estado, 'incidencia');
  assert.equal(fallo.evaluacion.mantenimiento?.operativas.find((f) => f.id === 'citilab')?.estado, 'comprobada');
  const recuperada = evaluar(recuperacionFuente(), Date.parse(NUEVA_OBSERVACION));
  assert.equal(recuperada.evaluacion.mantenimiento?.operativas.find((f) => f.id === 'empresas')?.estado, 'comprobada');
  const historia = leerHistorialVigilanteSqlite(f.sql, Date.parse(NUEVA_OBSERVACION));
  assert.equal(evaluar(recuperacionFuente(), Date.parse(NUEVA_OBSERVACION)).nuevas.length, 0);
  assert.deepEqual(leerHistorialVigilanteSqlite(f.sql, Date.parse(NUEVA_OBSERVACION)), historia);
  const vencida = evaluar(recuperacionFuente(), CORTE_VIGILANTE + DIAS_HASTA_VENCIDA * DIA_VIGILANTE);
  assert.ok(vencida.incidencias.some((d) => d.clave === 'conjunto:empresas' && d.motivo === 'comprobacion_vencida'));
  assert.equal(vencida.evaluacion.fechaDatos.find((f) => f.fuente === 'empresas')?.fecha, '2026-01-01');
  assert.equal(
    vencida.evaluacion.mantenimiento?.operativas.find((f) => f.id === 'empresas')?.comprobaciones[0]?.fecha,
    NUEVA_CONSULTA,
  );
  assert.equal(autoridades(f.db), antes);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM administracion_trabajo').get()?.n, 1);
});

test('DTO inválido, ausente y futuro rechazan sin alterar decisiones ni autoridades', async (t) => {
  const f = await baseVigilante(t);
  prepararVigilanteSqlite(f.sql, CONFIG_VIGILANTE, CORTE_VIGILANTE);
  const antes = autoridades(f.db),
    historia = leerHistorialVigilanteSqlite(f.sql, CORTE_VIGILANTE);
  for (const datos of [{}, undefined, instantaneaSalud({ observadoEn: NUEVA_OBSERVACION })]) {
    assert.throws(() =>
      comprobarVigilanteConLecturaLocalSqlite(f.sql, { configuracion: CONFIG_VIGILANTE, datos }, CORTE_VIGILANTE),
    );
  }
  assert.deepEqual(leerHistorialVigilanteSqlite(f.sql, CORTE_VIGILANTE), historia);
  assert.equal(autoridades(f.db), antes);
});

test('corte durante decisiones locales revierte toda la transacción sin tocar trabajo', async (t) => {
  const f = await baseVigilante(t);
  prepararVigilanteSqlite(f.sql, CONFIG_VIGILANTE, CORTE_VIGILANTE);
  const antes = autoridades(f.db),
    historia = leerHistorialVigilanteSqlite(f.sql, CORTE_VIGILANTE);
  const cortada = {
    ...f.sql,
    ejecutar: (s: string, ...v: (string | number | null)[]) => {
      f.sql.ejecutar(s, ...v);
      if (s.startsWith('INSERT INTO administracion_vigilante_decisiones')) {
        throw new Error('corte-local-sintetico');
      }
    },
  };
  assert.throws(
    () =>
      comprobarVigilanteConLecturaLocalSqlite(
        cortada,
        { configuracion: CONFIG_VIGILANTE, datos: instantaneaSalud() },
        CORTE_VIGILANTE,
      ),
    /corte-local-sintetico/,
  );
  assert.deepEqual(leerHistorialVigilanteSqlite(f.sql, CORTE_VIGILANTE), historia);
  assert.equal(autoridades(f.db), antes);
});

/** Copia de código portable y ejecutable sintético: el lector Node y el hijo son reales. */
async function instalacion(t: TestContext, programa?: string) {
  const f = await baseVigilante(t);
  prepararVigilanteSqlite(f.sql, CONFIG_VIGILANTE, CORTE_VIGILANTE);
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'Vigilante Año 2026 '));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const ruta of [
    'src',
    'compartido',
    'datos/nombres.json',
    'config/identidad-web.json',
    'web/terceros/noble/hashes',
    'herramientas/mantenimiento/vigilante.ts',
    ...SERVIDORES_DE_EXTENSIONES,
  ]) {
    mkdirSync(dirname(join(dir, ruta)), { recursive: true });
    cpSync(join(RAIZ, ruta), join(dir, ruta), { recursive: true });
  }
  writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
  const base = join(dir, 'privado', 'administracion.sqlite'),
    config = join(dir, 'privado', 'vigilante.json');
  mkdirSync(dirname(base), { recursive: true, mode: MODO_DIRECTORIO });
  f.db.prepare('VACUUM INTO ?').run(base);
  chmodSync(base, MODO_ARCHIVO);
  writeFileSync(config, JSON.stringify(CONFIG_VIGILANTE), { mode: MODO_ARCHIVO });
  writeFileSync(join(dir, 'instantanea.json'), JSON.stringify(dosFuentes()));
  mkdirSync(join(dir, '.venv', 'bin'), { recursive: true });
  writeFileSync(
    join(dir, '.venv/bin/python'),
    `#!${process.execPath}\nimport {readFileSync,writeFileSync} from 'node:fs';\nwriteFileSync('pid',String(process.pid));\nwriteFileSync('metadatos',JSON.stringify({cwd:process.cwd(),args:process.argv.slice(2),env:Object.keys(process.env)}));\n${programa ?? "console.log(readFileSync('instantanea.json','utf8'));"}`,
    { mode: MODO_DIRECTORIO },
  );
  const cli: typeof import('../../herramientas/mantenimiento/vigilante.ts') = await import(
    pathToFileURL(join(dir, 'herramientas/mantenimiento/vigilante.ts')).href
  );
  return { cli, dir, base, config, args: ['verificar-local', base, config] };
}
function recolectado(dir: string) {
  const pid = Number(readFileSync(join(dir, 'pid'), 'utf8'));
  assert.ok(pid > 0);
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
}

test('modo local usa lector real en instalación Unicode; default recibo no adopta la lectura local', async (t) => {
  const f = await instalacion(t);
  const antes = autoridadesArchivo(f.base),
    instantanea = readFileSync(join(f.dir, 'instantanea.json'));
  const resultado = await f.cli.ejecutarVigilanteConLecturaLocal(f.args, {}, () => CORTE_VIGILANTE);
  assert.equal(resultado.resultado.origenDatos, 'lectura-local');
  assert.equal(
    'evaluacion' in resultado.resultado && resultado.resultado.evaluacion.mantenimiento?.operativas.length,
    2,
  );
  assert.equal(autoridadesArchivo(f.base), antes);
  assert.deepEqual(readFileSync(join(f.dir, 'instantanea.json')), instantanea);
  const meta = JSON.parse(readFileSync(join(f.dir, 'metadatos'), 'utf8'));
  assert.equal(meta.cwd, f.dir);
  assert.deepEqual(meta.args, ['-m', 'plataforma_datos.orquestacion.estado_panel']);
  assert.equal(
    meta.env.some((n: string) => /FARO|PYTHONPATH|PYTHONHOME/.test(n)),
    false,
  );
  assert.equal(statSync(f.base).mode & 0o777, MODO_ARCHIVO);
  assert.equal(statSync(dirname(f.base)).mode & 0o777, MODO_DIRECTORIO);
  recolectado(f.dir);
  const recibo = f.cli.ejecutarVigilanteLocal(['verificar', f.base, f.config], {}, () => CORTE_VIGILANTE + 1);
  assert.equal('origenDatos' in recibo.resultado && recibo.resultado.origenDatos, 'recibo');
  assert.equal('evaluacion' in recibo.resultado && recibo.resultado.evaluacion.mantenimiento, null);
});

/** Las cuatro escenas recorren el lector/proceso y la SQLite privados, no solo el evaluador puro. */
async function evaluarInstalacion(
  f: Awaited<ReturnType<typeof instalacion>>,
  datos: EstadoDatosPanelV5,
  ahora: number,
) {
  writeFileSync(join(f.dir, 'instantanea.json'), JSON.stringify(datos));
  const salida = await f.cli.ejecutarVigilanteConLecturaLocal(f.args, {}, () => ahora);
  assert.ok('evaluacion' in salida.resultado);
  recolectado(f.dir);
  return salida.resultado;
}
test('las cuatro escenas atraviesan el proceso real del lector y una sola base privada', async (t) => {
  const f = await instalacion(t);
  const antes = autoridadesArchivo(f.base);
  const valida = await evaluarInstalacion(f, dosFuentes(), CORTE_VIGILANTE);
  assert.ok(valida.evaluacion.mantenimiento?.operativas.every((f) => f.estado === 'comprobada'));
  const fallida = await evaluarInstalacion(f, falloFuente(), CORTE_VIGILANTE + HORA_VIGILANTE);
  assert.equal(fallida.evaluacion.mantenimiento?.operativas.find((f) => f.id === 'empresas')?.estado, 'incidencia');
  assert.equal(fallida.evaluacion.mantenimiento?.operativas.find((f) => f.id === 'citilab')?.estado, 'comprobada');
  const recuperada = await evaluarInstalacion(f, recuperacionFuente(), Date.parse(NUEVA_OBSERVACION));
  assert.equal(recuperada.evaluacion.mantenimiento?.operativas.find((f) => f.id === 'empresas')?.estado, 'comprobada');
  const recuperacion = readFileSync(f.base);
  assert.equal((await evaluarInstalacion(f, recuperacionFuente(), Date.parse(NUEVA_OBSERVACION))).nuevas.length, 0);
  assert.deepEqual(readFileSync(f.base), recuperacion);
  const vencida = await evaluarInstalacion(
    f,
    recuperacionFuente(),
    CORTE_VIGILANTE + DIAS_HASTA_VENCIDA * DIA_VIGILANTE,
  );
  assert.ok(vencida.incidencias.some((d) => d.clave === 'conjunto:empresas' && d.motivo === 'comprobacion_vencida'));
  assert.equal(vencida.evaluacion.fechaDatos.find((f) => f.fuente === 'empresas')?.fecha, '2026-01-01');
  assert.equal(
    vencida.evaluacion.mantenimiento?.operativas.find((f) => f.id === 'citilab')?.comprobaciones[0]?.fecha,
    '2026-10-22T10:00:00Z',
  );
  assert.equal(autoridadesArchivo(f.base), antes);
});

test('reloj posterior a la lectura no fabrica futuro ni renueva la consulta individual', async (t) => {
  const f = await instalacion(t);
  let ahora = CORTE_VIGILANTE,
    lecturas = 0;
  const resultado = await ejecutarVigilanteConLecturaLocal(f.args, {}, () => ahora, {
    leerEstadoDatos: async () => {
      lecturas += 1;
      ahora += HORA_VIGILANTE;
      return instantaneaSalud({ observadoEn: new Date(ahora).toISOString().replace('.000Z', 'Z') });
    },
  });
  assert.equal(lecturas, 1);
  assert.equal('evaluacion' in resultado.resultado && resultado.resultado.evaluacion.evaluadoEn, ahora);
  assert.equal(
    'evaluacion' in resultado.resultado &&
      resultado.resultado.evaluacion.mantenimiento?.operativas[0]?.comprobaciones[0]?.fecha,
    '2026-10-22T10:00:00Z',
  );
});

test('preaborto no registra intento; fallo real registra solo incidencia local; deshabilitado no lee', async (t) => {
  const f = await instalacion(t);
  await evaluarInstalacion(f, falloFuente(), CORTE_VIGILANTE + HORA_VIGILANTE);
  const antes = readFileSync(f.base),
    autoridadesAntes = autoridadesArchivo(f.base);
  const senal = new AbortController();
  senal.abort();
  let lecturas = 0;
  const leer = async () => {
    lecturas += 1;
    throw new Error('fallo-sintetico');
  };
  await assert.rejects(
    ejecutarVigilanteConLecturaLocal(f.args, {}, () => CORTE_VIGILANTE, { senal: senal.signal, leerEstadoDatos: leer }),
  );
  assert.equal(lecturas, 0);
  await assert.rejects(
    ejecutarVigilanteConLecturaLocal(f.args, {}, () => CORTE_VIGILANTE + HORA_VIGILANTE + 1, { leerEstadoDatos: leer }),
    (error: unknown) =>
      error instanceof Error && error.cause instanceof Error && error.cause.message === 'fallo-sintetico',
  );
  assert.notDeepEqual(readFileSync(f.base), antes);
  assert.equal(autoridadesArchivo(f.base), autoridadesAntes);
  const registrado = readFileSync(f.base);
  writeFileSync(f.config, JSON.stringify({ ...CONFIG_VIGILANTE, habilitado: false }));
  const salida = await ejecutarVigilanteConLecturaLocal(f.args, {}, () => CORTE_VIGILANTE, { leerEstadoDatos: leer });
  assert.equal(salida.codigo, 0);
  assert.equal(lecturas, 1);
  assert.deepEqual(readFileSync(f.base), registrado);
});

test('límite real y aborto iniciado registran fallo local sin tocar autoridades y recolectan hijo', async (t) => {
  t.mock.method(console, 'error', () => {});
  for (const exceso of [true, false]) {
    const f = await instalacion(
      t,
      exceso
        ? `process.stdout.write('x'.repeat(${MAX_SALIDA_ESTADO_DATOS_BYTES + 1}));setInterval(()=>{},1000);`
        : 'setInterval(()=>{},1000);',
    );
    const antes = autoridadesArchivo(f.base),
      control = new AbortController();
    const resultado = f.cli.ejecutarVigilanteConLecturaLocal(f.args, {}, () => CORTE_VIGILANTE, {
      senal: control.signal,
    });
    const rechazo = assert.rejects(resultado);
    const limite = Date.now() + MAX_ESPERA_ARRANQUE_MS;
    while (!existsSync(join(f.dir, 'pid'))) {
      assert.ok(Date.now() < limite);
      await new Promise((r) => setTimeout(r, 10));
    }
    if (!exceso) {
      control.abort();
    }
    await rechazo;
    assert.equal(autoridadesArchivo(f.base), antes);
    const registro = f.cli.ejecutarVigilanteLocal(['historial', f.base, f.config], {}, () => CORTE_VIGILANTE).resultado;
    assert.ok('decisiones' in registro);
    assert.ok(registro.decisiones.some((d) => d.clave === 'lectura-local' && d.estado === 'incidencia'));
    recolectado(f.dir);
  }
});

test('configuración no admite rutas, órdenes ni una instantánea como campos adicionales', async (t) => {
  const f = await instalacion(t);
  for (const extra of [{ raiz: '/ajena' }, { orden: 'no-ejecutar' }, { datos: instantaneaSalud() }]) {
    writeFileSync(f.config, JSON.stringify({ ...CONFIG_VIGILANTE, ...extra }));
    await assert.rejects(f.cli.ejecutarVigilanteConLecturaLocal(f.args, {}, () => CORTE_VIGILANTE));
    assert.equal(existsSync(join(f.dir, 'pid')), false);
  }
});
