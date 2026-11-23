import assert from 'node:assert/strict';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { type TestContext, test } from 'node:test';
import { politicaSeccionesInicial } from '../../src/administracion/secciones-web.js';
import { IDENTIDAD_WEB } from '../../src/comun/identidad-web.ts';
import type { leerSeccionesConAutoridad } from '../../src/plataforma/acceso-publico/secciones-autoridad-sqlite.ts';
import type { AdministracionMontada } from '../../src/plataforma/administracion.ts';
import { prepararPersistenciaAdministrativaNode } from '../../src/plataforma/node/administracion-almacen.ts';
import { crearServidor } from '../../src/plataforma/node/servidor.ts';

const OK = 200;
const METODO = 405;
const NO_DISPONIBLE = 503;
const AUSENTE = 404;
const VERSION = 4;
/** La dirección antigua sirve el documento interno, con el contrato de secciones vigente. */
const VERSION_LEGADA = 3;
type Documento = ReturnType<typeof leerSeccionesConAutoridad>;
async function documento(respuesta: Response): Promise<Documento> {
  return JSON.parse(await respuesta.text()) as Documento;
}

function carpeta(t: TestContext) {
  const raiz = mkdtempSync(join(realpathSync(tmpdir()), 'secciones-node-v3-'));
  const web = join(raiz, 'web');
  mkdirSync(web);
  writeFileSync(join(web, 'biblioteca.html'), '<h1>Biblioteca sintética</h1>');
  t.after(() => rmSync(raiz, { recursive: true, force: true }));
  return { web, archivo: join(raiz, 'privado', 'clientes.sqlite') };
}
async function abrir(web: string, archivo: string, administracion?: AdministracionMontada) {
  const servidor = crearServidor({
    web,
    archivoAutoridadSecciones: archivo,
    puerto: 0,
    anfitrion: '127.0.0.1',
    api: async () => new Response(null),
    ...(administracion ? { administracion } : {}),
  });
  servidor.listen(0, '127.0.0.1');
  await once(servidor, 'listening');
  const direccion = servidor.address();
  assert.ok(direccion && typeof direccion === 'object');
  return {
    pedir: (ruta = '/secciones-v3.json', method = 'GET') =>
      fetch(`http://127.0.0.1:${direccion.port}${ruta}`, { method, headers: IDENTIDAD_WEB }),
    cerrar: () =>
      new Promise<void>((ok, fallo) => {
        servidor.closeAllConnections();
        servidor.close((error) => (error ? fallo(error) : ok()));
      }),
  };
}

test('Node sin panel conserva autoridad al reiniciar y no prepara controles administrativos', async (t) => {
  const { web, archivo } = carpeta(t);
  let servidor = await abrir(web, archivo);
  try {
    const respuesta = await servidor.pedir();
    assert.equal(respuesta.status, OK);
    assert.equal(respuesta.headers.get('cache-control'), 'no-store');
    const primero = await documento(respuesta);
    assert.equal(primero.version, VERSION);
    assert.equal(primero.revision, 0);
    assert.deepEqual(primero.secciones, politicaSeccionesInicial());
    await servidor.cerrar();
    servidor = await abrir(web, archivo);
    assert.deepEqual(await (await servidor.pedir()).json(), primero);
    const db = new DatabaseSync(archivo);
    try {
      assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='administracion_controles'").get(), undefined);
    } finally {
      db.close();
    }
    const head = await servidor.pedir('/secciones-v3.json', 'HEAD');
    assert.equal(head.status, OK);
    assert.equal(await head.text(), '');
    const post = await servidor.pedir('/secciones-v3.json', 'POST');
    assert.equal(post.status, METODO);
    assert.equal(post.headers.get('allow'), 'GET, HEAD');
    const legado = await servidor.pedir('/secciones.json');
    assert.equal(legado.status, OK);
    assert.equal((await documento(legado)).version, VERSION_LEGADA);
  } finally {
    await servidor.cerrar();
  }
});

async function comprobarSinPanel(web: string, archivo: string, siguiente: Documento) {
  const sinPanel = await abrir(web, archivo);
  try {
    assert.deepEqual(await documento(await sinPanel.pedir()), siguiente);
    assert.equal((await sinPanel.pedir('/biblioteca.html')).status, AUSENTE);
    assert.equal((await documento(await sinPanel.pedir('/secciones.json'))).secciones.biblioteca, false);
  } finally {
    await sinPanel.cerrar();
  }
}

test('Node con panel publica identidad y política del mismo SQLite, sin activar secciones', async (t) => {
  const { web, archivo } = carpeta(t);
  const preparado = prepararPersistenciaAdministrativaNode(
    { archivo, maxClientes: 2 },
    {
      configuracion: { origen: 'https://panel.example', permitirHttpLocal: false },
      guardiaAdministrativa: async () => null,
      inicial: { version: 2, api: 'deshabilitada', mcp: false, a2a: false },
    },
  );
  const servidor = await abrir(web, archivo, preparado.administracion);
  try {
    const respuesta = await servidor.pedir();
    assert.equal(respuesta.status, OK);
    const primero = await documento(respuesta);
    assert.deepEqual(primero, await preparado.administracion.leerSeccionesConAutoridad?.(new AbortController().signal));
    const db = new DatabaseSync(archivo);
    try {
      const original = db.prepare('SELECT documento FROM administracion_controles WHERE id=1').get();
      assert.ok(original && typeof original.documento === 'string');
      const controles = JSON.parse(original.documento);
      controles.revision = 1;
      controles.secciones.biblioteca = false;
      db.prepare('UPDATE administracion_controles SET documento=? WHERE id=1').run(JSON.stringify(controles));
      const siguiente = await documento(await servidor.pedir());
      assert.equal(siguiente.autoridad, primero.autoridad);
      assert.equal(siguiente.revision, 1);
      assert.equal(siguiente.secciones.biblioteca, false);
      await comprobarSinPanel(web, archivo, siguiente);
      assert.equal(
        db.prepare('SELECT documento FROM administracion_controles WHERE id=1').get()?.documento,
        JSON.stringify(controles),
      );
      db.prepare("UPDATE secciones_autoridad SET autoridad='invalida' WHERE id=1").run();
      const corrupta = await servidor.pedir();
      assert.equal(corrupta.status, NO_DISPONIBLE);
      assert.equal(await corrupta.text(), '');
      assert.equal(db.prepare('SELECT autoridad FROM secciones_autoridad WHERE id=1').get()?.autoridad, 'invalida');
    } finally {
      db.close();
    }
  } finally {
    await servidor.cerrar();
    preparado.cerrar();
  }
});

test('Node no publica su almacén y dos instalaciones no comparten identidad', async (t) => {
  const primera = carpeta(t);
  const segunda = carpeta(t);
  const servidores = [await abrir(primera.web, primera.archivo), await abrir(segunda.web, segunda.archivo)];
  try {
    const [uno, dos] = await Promise.all(servidores.map(async (servidor) => documento(await servidor.pedir())));
    assert.ok(uno && dos);
    assert.notEqual(uno.autoridad, dos.autoridad);
  } finally {
    await Promise.all(servidores.map((servidor) => servidor.cerrar()));
  }
  const dentro = join(primera.web, 'autoridad.sqlite');
  const malConfigurada = await abrir(primera.web, dentro);
  try {
    assert.equal((await malConfigurada.pedir()).status, NO_DISPONIBLE);
    assert.equal(existsSync(dentro), false);
  } finally {
    await malConfigurada.cerrar();
  }
});
