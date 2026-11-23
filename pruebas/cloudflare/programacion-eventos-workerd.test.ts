/**
 * La migración del historial de eventos de la programación (versión 1 a 2) en el SQLite de un objeto durable de
 * verdad: Miniflare arranca workerd en este equipo, sin red, con el código real empaquetado. Acredita que workerd
 * admite lo que usa la migración (`ALTER TABLE … ADD COLUMN` y `DROP COLUMN`) y que la autoridad sigue reservando.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const requerir = createRequire(import.meta.url);
const HTTP_CORRECTO = 200;
const VERSION_EVENTOS = 2;
const modulo = (ruta: string) => JSON.stringify(fileURLToPath(new URL(`../../src/${ruta}`, import.meta.url)));

/** El objeto durable de ensayo: prepara una autoridad, la deja en la versión 1 y la vuelve a preparar. */
const ENTRADA = `
import { leerProgramacionSqlite } from ${modulo('plataforma/acceso-publico/programacion-sqlite.ts')};
import { AlmacenSesionPanelSqlite } from ${modulo('plataforma/acceso-publico/sesion-sqlite.ts')};
import { AlmacenPublicoSqlite } from ${modulo('plataforma/acceso-publico/sqlite.ts')};
import { sqlDelObjetoDurable } from ${modulo('plataforma/acceso-publico/durable.ts')};
const AHORA = Date.parse('2026-10-17T03:00:00Z');
const AYER = AHORA - 86400000;
const CONFIANZA = {
  audiencia: 'https://mantenimiento.example/mantenimiento/resultado',
  repositorioId: '101',
  propietarioId: '102',
  ref: 'refs/heads/main',
  workflowRef: 'equipo/fuente/.github/workflows/actualizar.yml@refs/heads/main',
  sha: 'a'.repeat(40),
  workflowSha: 'b'.repeat(40),
};
const VERSION_1 = [
  'DROP TABLE administracion_programacion_eventos',
  'ALTER TABLE publico_estado DROP COLUMN programacion_eventos_version',
  'ALTER TABLE publico_estado ADD COLUMN programacion_eventos_version INTEGER NOT NULL DEFAULT 0 CHECK(programacion_eventos_version IN (0,1))',
  'CREATE TABLE administracion_programacion_eventos (evento_en INTEGER PRIMARY KEY, registrado_en INTEGER NOT NULL, resultado TEXT NOT NULL, motivo TEXT NOT NULL) STRICT',
  "INSERT INTO administracion_programacion_eventos VALUES (" + AYER + "," + AYER + ",'omitida-tardia','evento-fuera-de-ventana')",
  'UPDATE administracion_programacion SET evento_en=' + AYER,
  'UPDATE publico_estado SET programacion_eventos_version=1 WHERE id=1',
];
export class Autoridad {
  constructor(estado) {
    this.estado = estado;
  }
  async fetch() {
    try {
      const sql = sqlDelObjetoDurable(this.estado.storage);
      const reloj = () => AHORA;
      new AlmacenPublicoSqlite(sql, { maxClientes: 1, ahora: reloj });
      const backend = new AlmacenSesionPanelSqlite(sql, { ahora: reloj });
      await backend.prepararPanel({ version: 2, api: 'deshabilitada', mcp: false, a2a: false });
      await backend.prepararTrabajos();
      await backend.prepararActivacion();
      sql.transaccion(() => {
        for (const sentencia of VERSION_1) {
          sql.ejecutar(sentencia);
        }
      });
      await backend.prepararTrabajos();
      const reserva = await backend.reservarTrabajoProgramado({ eventoEn: AHORA, cron: '0 3 * * *' }, CONFIANZA);
      return Response.json({
        version: sql.filas('SELECT programacion_eventos_version AS v FROM publico_estado')[0].v,
        columnas: sql.filas("SELECT name FROM pragma_table_info('administracion_programacion_eventos') ORDER BY name").map((c) => c.name),
        reserva: reserva.estado,
        eventos: leerProgramacionSqlite(sql, AHORA).eventos.map((e) => [e.eventoEn === AHORA ? 'hoy' : 'ayer', e.resultado, e.fase]),
      });
    } catch (error) {
      return Response.json({ error: String(error && error.message) }, { status: 500 });
    }
  }
}
export default {
  async fetch(peticion, entorno) {
    return entorno.AUTORIDAD.get(entorno.AUTORIDAD.idFromName('autoridad')).fetch(peticion);
  },
};
`;

async function empaquetar(): Promise<string> {
  const { build } = requerir('esbuild') as typeof import('esbuild');
  const salida = await build({
    stdin: { contents: ENTRADA, loader: 'js', resolveDir: fileURLToPath(new URL('../../', import.meta.url)) },
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: 'es2024',
    write: false,
    logLevel: 'silent',
  });
  return salida.outputFiles[0]?.text ?? '';
}

test('workerd migra el historial de eventos de la versión 1 a la 2 y la autoridad sigue reservando', async () => {
  const { Miniflare, convertV4MiniflareOptions } = requerir('miniflare');
  const miniflare = new Miniflare(
    convertV4MiniflareOptions({
      name: 'programacion',
      modules: true,
      compatibilityDate: '2026-10-01',
      script: await empaquetar(),
      durableObjects: { AUTORIDAD: { className: 'Autoridad', useSQLite: true } },
    }),
  );
  try {
    const respuesta = await miniflare.dispatchFetch('http://localhost/');
    const cuerpo = (await respuesta.json()) as Record<string, unknown>;
    assert.equal(respuesta.status, HTTP_CORRECTO, String(cuerpo.error ?? ''));
    assert.deepEqual(cuerpo, {
      version: VERSION_EVENTOS,
      columnas: ['evento_en', 'fase', 'motivo', 'motivo_fallo', 'registrado_en', 'resultado'],
      reserva: 'nueva',
      eventos: [
        ['hoy', 'nueva', null],
        ['ayer', 'omitida-tardia', null],
      ],
    });
  } finally {
    await miniflare.dispose();
  }
});
