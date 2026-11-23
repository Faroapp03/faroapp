/**
 * La encuesta en el servidor local de Node, de punta a punta por HTTP real: el panel crea el lote sobre el SQLite del
 * montaje, el punto público responde con las mismas garantías que en el Worker (rechazos idénticos, nada de quien envía
 * en la base, nada en la consola) y sin panel no hay almacén. Sockets de loopback y SQLite temporal; sin red.
 */
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { type TestContext, test } from 'node:test';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { IDENTIDAD_WEB } from '../../src/comun/identidad-web.ts';
import { codigoNuevo, huellaDelCodigo } from '../../src/encuesta/codigos.ts';
import { MIN_CODIGOS_POR_LOTE } from '../../src/encuesta/contrato.ts';
import type { AdministracionMontada } from '../../src/plataforma/administracion.ts';
import { prepararPersistenciaAdministrativaNode } from '../../src/plataforma/node/administracion-almacen.ts';
import { crearServidor } from '../../src/plataforma/node/servidor.ts';
import { POLITICA_PANEL } from '../ayudas/persistencia-panel.ts';
import { principalDePrueba } from '../ayudas/principal-panel.ts';
import { PARTICIPANTE_COMPLETO } from './montaje.ts';

const ORIGEN = 'https://panel.example';
const IP_DE_PRUEBA = '203.0.113.7';
const AGENTE_DE_PRUEBA = 'Navegador de prueba';
/** Cabeceras que el transporte de Node pone en cada respuesta y no dependen del código: la hora y la conexión. */
const DEL_TRANSPORTE = new Set(['date', 'connection', 'keep-alive']);

function carpeta(t: TestContext) {
  const raiz = mkdtempSync(join(realpathSync(tmpdir()), 'encuesta-node-'));
  const web = join(raiz, 'web');
  mkdirSync(web);
  t.after(() => rmSync(raiz, { recursive: true, force: true }));
  return { raiz, web, archivo: join(raiz, 'privado', 'estado.sqlite') };
}
async function servir(t: TestContext, raiz: string, web: string, administracion?: AdministracionMontada) {
  const servidor = crearServidor({
    web,
    archivoAutoridadSecciones: join(raiz, 'autoridad-secciones.sqlite'),
    puerto: 0,
    anfitrion: '127.0.0.1',
    api: async () => new Response(null, { status: ESTADO_HTTP.noEncontrado }),
    ...(administracion ? { administracion } : {}),
  });
  servidor.listen(0, '127.0.0.1');
  await once(servidor, 'listening');
  t.after(
    () =>
      new Promise<void>((ok, fallo) => {
        servidor.closeAllConnections();
        servidor.close((error) => (error ? fallo(error) : ok()));
      }),
  );
  const origen = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  return (ruta: string, inicio: RequestInit = {}) =>
    fetch(`${origen}${ruta}`, {
      ...inicio,
      headers: { ...IDENTIDAD_WEB, ...Object.fromEntries(new Headers(inicio.headers)) },
    });
}
async function montar(t: TestContext) {
  const { raiz, web, archivo } = carpeta(t);
  const preparado = prepararPersistenciaAdministrativaNode(
    { archivo, maxClientes: 2 },
    {
      configuracion: { origen: ORIGEN, permitirHttpLocal: false },
      guardiaAdministrativa: async (r) =>
        r.headers.get('cf-access-jwt-assertion') === 'identidad-ficticia'
          ? principalDePrueba('https://fixture.cloudflareaccess.com', 'administrador-ficticio')
          : null,
      inicial: POLITICA_PANEL,
    },
  );
  t.after(() => preparado.cerrar());
  const pedir = await servir(t, raiz, web, preparado.administracion);
  const panel = (ruta: string, token: string, cuerpo: unknown = {}) =>
    pedir(`/administracion/api/${ruta}`, {
      method: 'POST',
      body: JSON.stringify(cuerpo),
      headers: {
        origin: ORIGEN,
        'sec-fetch-site': 'same-origin',
        'x-faro-panel': '1',
        'content-type': 'application/json',
        'cf-access-jwt-assertion': 'identidad-ficticia',
        ...(token ? { 'x-faro-sesion': token } : {}),
      },
    });
  const { token } = (await (await panel('sesion/abrir', '')).json()) as { token: string };
  return { archivo, pedir, panel, token };
}
/** Un envío de la página, con las cabeceras que un proxy o el navegador podrían añadir y que el punto no debe leer. */
function enviar(pedir: Awaited<ReturnType<typeof servir>>, codigo: string) {
  return pedir('/encuesta/responder', {
    method: 'POST',
    body: JSON.stringify({ codigo, respuestas: PARTICIPANTE_COMPLETO }),
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': IP_DE_PRUEBA,
      'x-real-ip': IP_DE_PRUEBA,
      'user-agent': AGENTE_DE_PRUEBA,
    },
  });
}
async function exacta(respuesta: Response) {
  return {
    estado: respuesta.status,
    cabeceras: [...respuesta.headers.entries()].filter(([nombre]) => !DEL_TRANSPORTE.has(nombre)).sort(),
    cuerpo: await respuesta.text(),
  };
}
/** El archivo de la base tal como queda en el disco, como texto: lo borrado sin sobrescribir seguiría aquí. */
function bytesDelArchivo(archivo: string): string {
  return readFileSync(archivo).toString('latin1');
}
function volcado(archivo: string): string {
  const db = new DatabaseSync(archivo, { readOnly: true });
  try {
    const tablas = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    return tablas.map(({ name }) => JSON.stringify(db.prepare(`SELECT * FROM "${name}"`).all())).join('\n');
  } finally {
    db.close();
  }
}

test('Node atiende la encuesta entera: lote del panel, respuesta sumada y los mismos rechazos idénticos', async (t) => {
  const llamadas: string[] = [];
  for (const metodo of ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const) {
    t.mock.method(console, metodo, () => {
      llamadas.push(metodo);
    });
  }
  const { archivo, pedir, panel, token } = await montar(t);
  const creado = await panel('encuesta/crear-lote', token, { tipo: 'participante', cantidad: MIN_CODIGOS_POR_LOTE });
  assert.equal(creado.status, ESTADO_HTTP.correcto);
  const { codigos } = (await creado.json()) as { codigos: { codigo: string }[] };
  const [usado = '', sinUsar = ''] = codigos.map((c) => c.codigo);
  const primera = await enviar(pedir, usado);
  assert.equal(primera.status, ESTADO_HTTP.correcto);
  assert.deepEqual(await primera.json(), { estado: 'registrada' });
  const repetido = await exacta(await enviar(pedir, usado));
  const inexistente = await exacta(await enviar(pedir, codigoNuevo('participante')));
  assert.equal(inexistente.estado, ESTADO_HTTP.conflicto);
  assert.equal(inexistente.cuerpo, '{"error":"codigo_no_valido"}');
  assert.deepEqual(repetido, inexistente);
  // En la base no queda el código usado, ni su huella, ni nada de quien envió.
  const todo = volcado(archivo);
  for (const rastro of [usado, huellaDelCodigo(usado), IP_DE_PRUEBA, AGENTE_DE_PRUEBA]) {
    assert.ok(!todo.includes(rastro), rastro);
  }
  assert.ok(todo.includes(huellaDelCodigo(sinUsar)));
  // Con el borrado seguro, la huella borrada tampoco queda en las páginas libres: no está en ningún byte del archivo.
  assert.ok(!bytesDelArchivo(archivo).includes(huellaDelCodigo(usado)));
  assert.ok(bytesDelArchivo(archivo).includes(huellaDelCodigo(sinUsar)));
  const cerrada = await panel('encuesta/cerrar', token);
  assert.equal(cerrada.status, ESTADO_HTTP.correcto);
  const { encuesta } = (await cerrada.json()) as {
    encuesta: { totales: Record<string, unknown>; recuentos: { participante: { respuestas: number } } };
  };
  assert.deepEqual(encuesta.totales.participante, { emitidos: MIN_CODIGOS_POR_LOTE, consumidos: 1, sinUsar: 2 });
  assert.equal(encuesta.recuentos.participante.respuestas, 1);
  assert.deepEqual(await exacta(await enviar(pedir, sinUsar)), inexistente);
  for (const { codigo } of codigos) {
    assert.ok(!bytesDelArchivo(archivo).includes(huellaDelCodigo(codigo)), codigo);
  }
  assert.deepEqual(llamadas, []);
});

test('Node sin panel no tiene almacén de la encuesta: responde 503 y sigue admitiendo solo POST', async (t) => {
  const { raiz, web } = carpeta(t);
  const pedir = await servir(t, raiz, web);
  const sinAlmacen = await enviar(pedir, codigoNuevo('participante'));
  assert.equal(sinAlmacen.status, ESTADO_HTTP.noDisponible);
  assert.deepEqual(await sinAlmacen.json(), { error: 'no_disponible' });
  assert.equal(sinAlmacen.headers.get('referrer-policy'), 'no-referrer');
  const get = await pedir('/encuesta/responder');
  assert.equal(get.status, ESTADO_HTTP.metodoNoAdmitido);
  assert.equal(get.headers.get('allow'), 'POST');
});
