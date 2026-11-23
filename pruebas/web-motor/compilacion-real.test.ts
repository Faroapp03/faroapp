import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { type TestContext, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { CARPETA_DEL_MOTOR } from '../../herramientas/web/carpeta-del-motor.ts';
import { empaquetarMotor } from '../../herramientas/web/empaquetado/construccion.ts';
import { FORMA_DEL_PAQUETE } from '../../herramientas/web/empaquetado.ts';
import { CABECERA_CONTRATO, CONTRATO_API } from '../../src/api/metadatos-http.ts';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { crearMotorLocal, type MotorLocal } from '../../src/plataforma/navegador/motor.ts';
import { RUTAS } from '../../src/plataforma/node/rutas.ts';
import { limpiarDatosPersonales } from '../../src/seguridad/privacidad.ts';
import { FECHA_DEL_INFORME } from '../ayudas/fecha-del-informe.ts';

const ENTRADA = `${CARPETA_DEL_MOTOR}/src/plataforma/navegador/motor.js`;
/** Una importación de un JSON con atributos: el Worker de WebKit no carga módulos JSON. */
const IMPORTACION_JSON = /\.json['"]\s*with\s*\{/;
const TEXTOS = [
  'Me llamo Laura y preparo informes. Mi teléfono es 612 345 678.',
  'Em dic Maria i treballo al carrer Major 25.',
  'Correo de trabajo: ana@example.org. Trabajo con hojas de cálculo.',
  'Me llamo José y registro entregas.',
  'Me llаmo Lau\ufe0fra y atiendo clientes.',
  'Reviso equipos, presupuesto y repuestos de la fábrica.',
];

function instantanea(archivos: ReadonlyMap<string, Uint8Array>): Record<string, string> {
  return Object.fromEntries(
    [...archivos].map(([archivo, bytes]) => [archivo, createHash('sha256').update(bytes).digest('hex')]),
  );
}

/** Escribe el motor empaquetado en `web` como lo publica la construcción. */
function escribirMotor(web: string, archivos: ReadonlyMap<string, Uint8Array>): void {
  for (const [archivo, bytes] of archivos) {
    mkdirSync(dirname(join(web, archivo)), { recursive: true });
    writeFileSync(join(web, archivo), bytes);
  }
}

test('el motor empaquetado responde como sus fuentes, sin módulos JSON, y reproduce sus bytes', async (t) => {
  const temporal = mkdtempSync(join(tmpdir(), 'motor real '));
  try {
    const web = join(temporal, 'primero', 'web');
    writeFileSync(join(temporal, 'package.json'), '{"type":"module"}');
    const { archivos } = await empaquetarMotor(web, FORMA_DEL_PAQUETE);
    const rutas = [...archivos.keys()];
    assert.ok(rutas.includes(ENTRADA));
    assert.ok(rutas.every((ruta) => ruta.startsWith(`${CARPETA_DEL_MOTOR}/`)));
    for (const nombre of ['privacidad', 'avisos', 'limites']) {
      assert.ok(rutas.includes(`${CARPETA_DEL_MOTOR}/src/seguridad/${nombre}.js`));
    }
    assert.equal(
      rutas.some((ruta) => ruta.endsWith('.json')),
      false,
    );
    const decodificador = new TextDecoder();
    assert.deepEqual(
      [...archivos].filter(([, bytes]) => IMPORTACION_JSON.test(decodificador.decode(bytes))).map(([ruta]) => ruta),
      [],
    );
    escribirMotor(web, archivos);
    await comprobarLimpieza(web);
    await comprobarRespuestas(web, t);
    const segundo = await empaquetarMotor(join(temporal, 'segundo', 'web'), FORMA_DEL_PAQUETE);
    assert.deepEqual(instantanea(segundo.archivos), instantanea(archivos));
    assert.equal(existsSync(join(RUTAS.web, CARPETA_DEL_MOTOR)), false);
  } finally {
    rmSync(temporal, { recursive: true, force: true });
  }
});

async function comprobarLimpieza(web: string): Promise<void> {
  const compilado = await import(pathToFileURL(join(web, CARPETA_DEL_MOTOR, 'src/seguridad/privacidad.js')).href);
  for (const texto of TEXTOS) {
    assert.deepEqual(compilado.limpiarDatosPersonales(texto), limpiarDatosPersonales(texto));
  }
  const entrada = await import(pathToFileURL(join(web, ENTRADA)).href);
  assert.equal(typeof entrada.crearMotorLocal, 'function');
  assert.equal(typeof entrada.cargarPaquete, 'function');
}

/** La carga del paquete pasa exclusivamente por disco; una URL ajena falla sin llegar a la red. */
function servirPaqueteDesdeDisco(t: TestContext, origen: string): void {
  t.mock.method(globalThis, 'fetch', async (entrada: string | URL | Request) => {
    const url = new URL(entrada instanceof Request ? entrada.url : String(entrada));
    assert.equal(url.origin, origen);
    const archivo = url.pathname.split('/').at(-1);
    assert.ok(archivo && /^[a-z0-9-]+\.json$/u.test(archivo));
    return new Response(readFileSync(join(RUTAS.paquete, archivo)));
  });
}

/** Cotejo exacto del contrato de lectura y de los informes visibles en ambos idiomas. */
async function comprobarRespuestas(web: string, t: TestContext): Promise<void> {
  const origen = 'https://motor.invalid';
  servirPaqueteDesdeDisco(t, origen);
  const uuid = t.mock.method(crypto, 'randomUUID', () => '12345678-1234-4000-8000-123456789abc');
  const reloj = t.mock.method(Date, 'now', () => Date.parse('2026-10-14T12:00:00Z'));
  try {
    const fuente = await crearMotorLocal(new URL(`${origen}/paquete/`));
    const { crearMotorLocal: crearCompilado } = await import(pathToFileURL(join(web, ENTRADA)).href);
    const compilado: MotorLocal = await crearCompilado(new URL(`${origen}/paquete/`));
    assert.equal(compilado.version, fuente.version);
    const esco = Object.keys(fuente.datos.esco.ocupaciones)[0];
    assert.ok(esco);
    for (const ruta of [
      '/api/salud',
      '/api/grupos',
      '/api/ocupaciones?q=docencia',
      `/api/ocupaciones/${esco}?idioma=ca`,
    ]) {
      await cotejar(
        fuente,
        compilado,
        new Request(`${origen}${ruta}`, { headers: { [CABECERA_CONTRATO]: String(CONTRATO_API) } }),
      );
    }
    for (const idioma of ['es', 'ca']) {
      const entrada = {
        isco08: '4226',
        fecha: FECHA_DEL_INFORME,
        sinIa: true,
        idioma,
        tareas: [{ id: 'uno', texto: 'Atender cada consulta', tiempo: 'mucho' }],
      };
      await cotejar(
        fuente,
        compilado,
        new Request(`${origen}/api/informe?formato=html`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', [CABECERA_CONTRATO]: String(CONTRATO_API) },
          body: JSON.stringify(entrada),
        }),
      );
    }
  } finally {
    reloj.mock.restore();
    uuid.mock.restore();
  }
}

async function cotejar(fuente: MotorLocal, compilado: MotorLocal, peticion: Request): Promise<void> {
  const entrada = {
    url: peticion.url,
    method: peticion.method,
    headers: [...peticion.headers],
    body: peticion.body ? await peticion.text() : null,
  };
  const original = await fuente.responder(entrada);
  const emitida = await compilado.responder(entrada);
  assert.equal(original.status, ESTADO_HTTP.correcto);
  assert.equal(emitida.status, original.status);
  assert.deepEqual(Object.fromEntries(emitida.headers), Object.fromEntries(original.headers));
  assert.equal(await emitida.text(), await original.text());
}
