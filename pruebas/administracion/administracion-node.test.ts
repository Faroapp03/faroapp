// Montaje Node real: sockets loopback, JWT RS256 sintético y SQLite temporal; ningún servicio externo.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { type TestContext, test } from 'node:test';
import { setTimeout as esperar } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { leerResultadoSolicitudActualizacion } from '../../src/administracion/actualizacion.ts';
import type { PoliticaControles } from '../../src/administracion/controles.ts';
import { LIMITES_CONECTIVIDAD } from '../../src/administracion/instituciones.ts';
import { leerResultadoLecturaTrabajo } from '../../src/administracion/trabajos.ts';
import { crearApi } from '../../src/api/api.ts';
import { CABECERA_CONTRATO, CONTRATO_API } from '../../src/api/metadatos-http.ts';
import type { VariablesDelEntorno } from '../../src/comun/entorno.ts';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { IDENTIDAD_WEB } from '../../src/comun/identidad-web.ts';
import { esObjeto } from '../../src/comun/json.ts';
import { crearAlmacenPublicoNode } from '../../src/plataforma/acceso-publico/node.ts';
import { montarAdministracionNode, type OpcionesAdministracionNode } from '../../src/plataforma/node/administracion.ts';
import { cargarDatos } from '../../src/plataforma/node/datos.ts';
import { crearServidor } from '../../src/plataforma/node/servidor.ts';
import { ID_INSTITUCION_SINTETICA, sembrarInstitucionAdmitida } from '../ayudas/institucion-admitida.ts';
import { abrirSesionDePrueba } from '../ayudas/sesion-de-prueba.ts';

const DATOS = cargarDatos(fileURLToPath(new URL('../../datos/', import.meta.url)));
const ORIGEN = 'https://panel.example';
const SECRETO = 'credencial-sintetica-larga-para-prueba-sin-cuenta';
const RSA_BITS = 2048;
const LONGITUD_HUELLA = 64;
const MAX_ESPERA_MS = 10_000;
const ALGORITMO = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
const BASE = {
  FARO_ADMINISTRACION: 'si',
  FARO_ADMIN_ORIGEN: ORIGEN,
  FARO_ADMIN_ACCESS_EQUIPO: 'prueba',
  FARO_ADMIN_ACCESS_AUD: 'panel',
  FARO_SECRETO_FIRMA: SECRETO,
  FARO_API_SOCIOS: 'no',
};
const POLITICA: PoliticaControles = {
  version: 2,
  api: 'deshabilitada',
  mcp: false,
  a2a: false,
};

async function identidad() {
  const par = await crypto.subtle.generateKey(
    { ...ALGORITMO, modulusLength: RSA_BITS, publicExponent: new Uint8Array([1, 0, 1]) },
    true,
    ['sign', 'verify'],
  );
  const publica = await crypto.subtle.exportKey('jwk', par.publicKey);
  const firmar = async (aud: string) => {
    const claims = {
      iss: 'https://prueba.cloudflareaccess.com',
      aud: [aud],
      type: 'app',
      sub: 'persona-sintetica',
      email: 'persona-sintetica@faro.invalid',
      iat: 1_900_000_000,
      exp: 2000000000,
    };
    const partes = `${Buffer.from('{"alg":"RS256","kid":"prueba"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}`;
    const firma = await crypto.subtle.sign(ALGORITMO, par.privateKey, new TextEncoder().encode(partes));
    return `${partes}.${Buffer.from(firma).toString('base64url')}`;
  };
  const pedir: typeof fetch = async (url, opciones) => {
    assert.ok(
      [
        'https://prueba.cloudflareaccess.com/cdn-cgi/access/certs',
        'https://token.actions.githubusercontent.com/.well-known/jwks',
      ].includes(String(url)),
    );
    assert.equal(new Headers(opciones?.headers).get('user-agent'), IDENTIDAD_WEB['User-Agent']);
    return Response.json({ keys: [{ ...publica, kid: 'prueba' }] });
  };
  return {
    jwt: await firmar('panel'),
    publico: await firmar('publico'),
    pedir,
    firmarOidc: (claims: Record<string, unknown>) => firmarClaims(par.privateKey, claims),
  };
}
async function firmarClaims(clave: CryptoKey, claims: Record<string, unknown>): Promise<string> {
  const texto = `${Buffer.from('{"alg":"RS256","kid":"prueba"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}`;
  const firma = await crypto.subtle.sign(ALGORITMO, clave, new TextEncoder().encode(texto));
  return `${texto}.${Buffer.from(firma).toString('base64url')}`;
}
const IDENTIDAD = identidad();
function opciones(archivo: string, cambios: VariablesDelEntorno = {}): OpcionesAdministracionNode {
  const variables = { ...BASE, ...cambios };
  return {
    archivo,
    datos: DATOS,
    origenesPermitidos: [],
    perfil: { variables },
  };
}
function objeto(entrada: unknown): Record<string, unknown> {
  assert.ok(esObjeto(entrada));
  return entrada;
}
function webDePrueba(dir: string): string {
  const web = join(dir, 'web');
  mkdirSync(join(web, 'administracion', 'api', 'sesion'), { recursive: true });
  mkdirSync(join(web, 'mantenimiento'), { recursive: true });
  for (const ruta of ['mcp', 'a2a', 'administracion/api/sesion/abrir', 'mantenimiento/resultado']) {
    writeFileSync(join(web, ruta), 'SEÑUELO-PRIVADO');
  }
  return web;
}
async function conPanel(
  accion: (panel: Panel) => Promise<void>,
  cambios: VariablesDelEntorno = {},
  ajustar?: (o: OpcionesAdministracionNode) => OpcionesAdministracionNode,
) {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'administracion-node-'));
  const archivo = join(dir, 'estado.sqlite');
  const web = webDePrueba(dir);
  const id = await IDENTIDAD;
  const entrada = { ...opciones(archivo, cambios), pedir: id.pedir };
  const montada = await montarAdministracionNode(ajustar ? ajustar(entrada) : entrada);
  const servidor = crearServidor({
    web,
    archivoAutoridadSecciones: join(dir, 'autoridad-secciones.sqlite'),
    api: montada.api,
    administracion: montada.administracion,
    puerto: 0,
    anfitrion: '127.0.0.1',
  });
  servidor.once('close', montada.cerrar);
  await new Promise<void>((resolver) => servidor.listen(0, '127.0.0.1', resolver));
  const origen = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  const pedir = (ruta: string, inicio: RequestInit = {}) =>
    fetch(`${origen}${ruta}`, {
      ...inicio,
      headers: {
        'user-agent': IDENTIDAD_WEB['User-Agent'],
        [CABECERA_CONTRATO]: String(CONTRATO_API),
        ...Object.fromEntries(new Headers(inicio.headers)),
      },
    });
  const panel = (ruta: string, token = '', cuerpo: object = {}, jwt = id.jwt) =>
    pedir(`/administracion/api/${ruta}`, {
      method: 'POST',
      body: JSON.stringify(cuerpo),
      headers: {
        origin: ORIGEN,
        'sec-fetch-site': 'same-origin',
        'x-faro-panel': '1',
        'content-type': 'application/json',
        'cf-access-jwt-assertion': jwt,
        ...(token ? { 'x-faro-sesion': token } : {}),
      },
    });
  try {
    await accion({ archivo, web, montada, pedir, panel, id, origen, servidor });
  } finally {
    servidor.closeAllConnections();
    await new Promise<void>((resolver, rechazar) => servidor.close((error) => (error ? rechazar(error) : resolver())));
    montada.cerrar();
    rmSync(dir, { recursive: true });
  }
}
type Panel = {
  servidor: ReturnType<typeof crearServidor>;
  archivo: string;
  web: string;
  montada: Awaited<ReturnType<typeof montarAdministracionNode>>;
  pedir: (ruta: string, inicio?: RequestInit) => Promise<Response>;
  panel: (ruta: string, token?: string, cuerpo?: object, jwt?: string) => Promise<Response>;
  id: Awaited<typeof IDENTIDAD>;
  origen: string;
};
function solicitud(url: string, inicio: RequestInit = {}): Request {
  const headers = new Headers(inicio.headers);
  headers.set(CABECERA_CONTRATO, String(CONTRATO_API));
  return new Request(url, { ...inicio, headers });
}
function estadoConHostAjeno(origen: string): Promise<number> {
  return new Promise((resolver, rechazar) => {
    const req = request(
      origen,
      {
        path: '/administracion/api/sesion/abrir',
        headers: { host: 'ajeno.example', 'user-agent': IDENTIDAD_WEB['User-Agent'] },
      },
      (res) => {
        res.resume();
        res.once('end', () => resolver(res.statusCode ?? 0));
      },
    );
    req.setTimeout(MAX_ESPERA_MS, () => req.destroy(new Error('Plazo de prueba')));
    req.once('error', rechazar);
    req.end();
  });
}
async function abrir(p: Panel): Promise<string> {
  const salida = await p.panel('sesion/abrir', '', { retomar: true });
  assert.equal(salida.status, ESTADO_HTTP.correcto);
  const token = objeto(await salida.json()).token;
  assert.equal(typeof token, 'string');
  return String(token);
}
async function cambiar(p: Panel, token: string, revisionEsperada: number, politica: PoliticaControles) {
  const salida = await p.panel('controles/cambiar', token, { revisionEsperada, politica });
  assert.equal(salida.status, ESTADO_HTTP.correcto, await salida.text());
}

const FECHA_CURSOS = '2026-10-07';
const LIMITE_CURSOS_MS = 1000;
const INTERVALO_MARCA_MS = 10;
/** Observa envíos y terminaciones reales; no sustituye el trabajador ni sus respuestas. */
function vigilarCursos(t: TestContext) {
  const enviados: { hilo: number; nombre: string }[] = [];
  const terminados: Promise<number>[] = [];
  const enviar = Worker.prototype.postMessage;
  const terminar = Worker.prototype.terminate;
  t.mock.method(
    Worker.prototype,
    'postMessage',
    function (this: Worker, ...argumentos: Parameters<Worker['postMessage']>) {
      const mensaje: unknown = argumentos[0];
      if (esObjeto(mensaje) && mensaje.tipo === 'operacion' && typeof mensaje.nombre === 'string') {
        enviados.push({ hilo: this.threadId, nombre: mensaje.nombre });
      }
      return enviar.apply(this, argumentos);
    },
  );
  t.mock.method(Worker.prototype, 'terminate', function (this: Worker) {
    const salida = terminar.call(this);
    terminados.push(salida);
    return salida;
  });
  return { enviados, terminados };
}
async function esperarMarcaDeCursos(marca: string): Promise<void> {
  const limite = Date.now() + MAX_ESPERA_MS;
  while (!existsSync(marca) && Date.now() < limite) {
    await esperar(INTERVALO_MARCA_MS);
  }
  assert(existsSync(marca), 'El trabajador debe haber entrado en el bucle síncrono');
}
function cursosBloqueables(o: OpcionesAdministracionNode): OpcionesAdministracionNode {
  const modulo = new URL('../ayudas/motor-de-cursos-administrado.ts', import.meta.url);
  modulo.searchParams.set('marca', pathToFileURL(join(dirname(o.archivo ?? ''), 'bucle-cursos')).href);
  return { ...o, cursos: { moduloDelTrabajador: modulo.href, limiteOperacionMs: LIMITE_CURSOS_MS } };
}
test('montaje administrado conserva el catálogo factual en un trabajador y lo termina al cerrar', async (t) => {
  const { enviados, terminados } = vigilarCursos(t);
  const api = await crearApi({ datos: DATOS, origenesPermitidos: [] });
  const ruta = `/api/cursos?fecha=${FECHA_CURSOS}&q=cocina`;
  const esperada = await api(solicitud(`http://127.0.0.1${ruta}`));
  assert.equal(esperada.status, ESTADO_HTTP.correcto);
  const cuerpo = await esperada.json();
  await conPanel(async (p) => {
    const respuesta = await p.pedir(ruta);
    assert.equal(respuesta.status, ESTADO_HTTP.correcto);
    assert.deepEqual(await respuesta.json(), cuerpo, 'La administración conserva el catálogo factual');
    assert(enviados.some((envio) => envio.nombre === 'catalogoDeCursos'));
    assert(enviados.every((envio) => envio.hilo > 0));
    assert.equal(new Set(enviados.map((envio) => envio.hilo)).size, 1, 'Todos usan una sola puerta');
  });
  assert.equal(terminados.length, 1, 'El cierre repetido termina el trabajador una sola vez');
  await Promise.all(terminados);
});
async function probarCursosBloqueados(p: Panel) {
  const ruta = `/api/cursos?fecha=${FECHA_CURSOS}&q=`;
  const normal = await p.pedir(`${ruta}recepcion`);
  assert.equal(normal.status, ESTADO_HTTP.correcto);
  const esperado = await normal.json();
  const ocupaciones = await (await p.pedir('/api/ocupaciones?q=recepcionista')).json();
  const marca = join(dirname(p.archivo), 'bucle-cursos');
  let terminado = false;
  const inicio = performance.now();
  const bloqueado = p.pedir(`${ruta}bucle`).then((respuesta) => {
    terminado = true;
    return respuesta;
  });
  await esperarMarcaDeCursos(marca);
  const recorrido = await p.pedir('/api/ocupaciones?q=recepcionista');
  assert.equal(recorrido.status, ESTADO_HTTP.correcto);
  assert.deepEqual(await recorrido.json(), ocupaciones);
  assert.equal(terminado, false, 'Ocupaciones responde mientras Cursos sigue bloqueado');
  const msOcupaciones = performance.now() - inicio;
  const respuesta = await bloqueado;
  assert.equal(respuesta.status, ESTADO_HTTP.noDisponible);
  assert.equal(objeto(await respuesta.json()).motivo, 'bloqueado');
  assert.deepEqual(
    await (await p.pedir(`${ruta}recepcion`)).json(),
    esperado,
    'Cursos se recupera con otro trabajador',
  );
  rmSync(marca);
  const alCerrar = p.pedir(`${ruta}bucle`);
  await esperarMarcaDeCursos(marca);
  p.montada.cerrar();
  p.montada.cerrar();
  assert.equal((await alCerrar).status, ESTADO_HTTP.noDisponible);
  return { msOcupaciones, msTotal: performance.now() - inicio };
}
test('montaje administrado: un bucle síncrono de Cursos no bloquea ocupaciones, vence y se recupera', async (t) => {
  const avisos = t.mock.method(console, 'warn', () => {});
  const { enviados, terminados } = vigilarCursos(t);
  await conPanel(
    async (p) => {
      console.log(JSON.stringify({ aislamientoAdministrado: await probarCursosBloqueados(p) }));
    },
    {},
    cursosBloqueables,
  );
  assert.equal(new Set(enviados.map((envio) => envio.hilo)).size, 2, 'El corte provoca solo un trabajador nuevo');
  assert.equal(terminados.length, 2, 'El corte y el cierre retiran sus respectivos trabajadores');
  await Promise.all(terminados);
  assert(avisos.mock.calls.some((llamada) => String(llamada.arguments[0]).includes('(bloqueado)')));
});

test('configuración y guardias inválidas rechazan antes de crear SQLite', async () => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'administracion-config-'));
  try {
    for (const cambios of [
      { FARO_ADMIN_ORIGEN: 'http://ajeno.example' },
      { FARO_ADMIN_ACCESS_EQUIPO: 'ajeno.invalid' },
      { FARO_SECRETO_FIRMA: '' },
      { FARO_API_PUBLICO_LIMITES: '{}' },
      { FARO_API_SOCIOS_REGISTRO: '{}' },
      { FARO_API_REGISTRO_PUBLICO: 'rota' },
      { FARO_API_SOCIOS: 'si', FARO_API_REGISTRO_PUBLICO: 'si', FARO_API_ALTAS: 'si' },
      { FARO_ACCESS_DECLARACION: 'pruebas-con-relatos-ficticios' },
    ]) {
      const archivo = join(dir, 'no-creado.sqlite');
      await assert.rejects(montarAdministracionNode(opciones(archivo, cambios)));
      assert.equal(existsSync(archivo), false);
    }
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('panel Node valida JWT por operación; nueva pestaña expulsa anterior; no fallback a señuelos', () =>
  conPanel(async (p) => {
    assert.equal((await p.panel('sesion/abrir', '', {}, '')).status, ESTADO_HTTP.prohibido);
    const primera = await abrir(p);
    const segunda = await abrir(p);
    assert.equal((await p.panel('sesion/estado', primera)).status, ESTADO_HTTP.conflicto);
    assert.equal((await p.panel('sesion/estado', segunda)).status, ESTADO_HTTP.correcto);
    for (const ruta of [
      '/mcp',
      '/mcp/',
      '/mc%70',
      '/a2a',
      '/x/%2e%2e%2fmcp',
      '/x/%2e%2e%2fadministracion/api/sesion/abrir',
      '/%61dministracion/api/sesion/abrir',
    ]) {
      const salida = await p.pedir(ruta);
      assert.notEqual(salida.status, ESTADO_HTTP.correcto);
      assert.equal((await salida.text()).includes('SEÑUELO'), false);
    }
  }));

test('origen administrativo fijo no confía en Hostforwarded; filtroHost y URLs públicas siguen locales', () =>
  conPanel(async (p) => {
    const falsificado = await p.pedir('/administracion/api/sesion/abrir', {
      method: 'POST',
      body: '{}',
      headers: {
        origin: 'https://ajeno.example',
        'x-faro-panel': '1',
        'content-type': 'application/json',
        'cf-access-jwt-assertion': p.id.jwt,
        'x-forwarded-host': 'ajeno.example',
        'x-forwarded-proto': 'https',
      },
    });
    assert.equal(falsificado.status, ESTADO_HTTP.prohibido);
    assert.equal(await estadoConHostAjeno(p.origen), ESTADO_HTTP.anfitrionNoAtendido);
    for (const sufijo of ['?token=ajeno', '?']) {
      assert.equal(
        (
          await p.pedir(`/administracion/api/sesion/abrir${sufijo}`, {
            method: 'POST',
            body: '{}',
            headers: {
              origin: ORIGEN,
              'sec-fetch-site': 'same-origin',
              'x-faro-panel': '1',
              'content-type': 'application/json',
              'cf-access-jwt-assertion': p.id.jwt,
            },
          })
        ).status,
        ESTADO_HTTP.solicitudIncorrecta,
      );
    }
    const catalogo = await p.pedir('/.well-known/api-catalog');
    assert.equal(catalogo.headers.get('cache-control'), 'no-store');
    const texto = await catalogo.text();
    assert.equal(texto.includes(p.origen), true);
    assert.equal(texto.includes(ORIGEN), false);
  }));

test('canales vivos y catálogo siguen política sin recrear servidor; fallo autoridad cierra controles', () =>
  conPanel(async (p) => {
    const token = await abrir(p);
    await cambiar(p, token, 0, { ...POLITICA, mcp: true, a2a: true });
    assert.equal((await p.pedir('/.well-known/agent-card.json')).status, ESTADO_HTTP.correcto);
    assert.equal((await p.pedir('/.well-known/api-catalog')).headers.get('cache-control'), 'no-store');
    await cambiar(p, token, 1, POLITICA);
    assert.equal((await p.pedir('/.well-known/agent-card.json')).status, ESTADO_HTTP.noEncontrado);
    const db = new DatabaseSync(p.archivo);
    try {
      db.prepare("UPDATE administracion_controles SET documento='{}'").run();
    } finally {
      db.close();
    }
    assert.equal((await p.pedir('/mcp')).status, ESTADO_HTTP.noDisponible);
    assert.equal((await p.pedir('/.well-known/api-catalog')).status, ESTADO_HTTP.noDisponible);
    assert.equal((await p.panel('controles/leer', token)).status, ESTADO_HTTP.noDisponible);
    assert.equal((await p.pedir('/api/grupos')).status, ESTADO_HTTP.correcto);
  }));

test('API institucional habilitada desde panel conserva emisorOAuth, token y cuota al alternar', () =>
  conPanel(async (p) => {
    const sesion = await abrir(p);
    const habilitada = { ...POLITICA, api: 'habilitada' as const };
    await cambiar(p, sesion, 0, habilitada);
    const db = new DatabaseSync(p.archivo);
    try {
      await sembrarInstitucionAdmitida(db, SECRETO, 2);
    } finally {
      db.close();
    }
    const respuesta = await p.pedir('/api/socios/v1/token', {
      method: 'POST',
      body: new URLSearchParams({ grant_type: 'client_credentials' }),
      headers: { authorization: `Basic ${btoa(`${ID_INSTITUCION_SINTETICA}:${SECRETO}`)}` },
    });
    assert.equal(respuesta.status, ESTADO_HTTP.correcto);
    const token = objeto(await respuesta.json()).access_token;
    const consultar = () =>
      p.pedir('/api/socios/v1/consultas/explorar_grupos?padre=4', { headers: { authorization: `Bearer ${token}` } });
    assert.equal((await consultar()).status, ESTADO_HTTP.correcto);
    await cambiar(p, sesion, 1, POLITICA);
    assert.equal((await consultar()).status, ESTADO_HTTP.noEncontrado);
    await cambiar(p, sesion, 2, habilitada);
    assert.equal((await consultar()).status, ESTADO_HTTP.correcto);
    assert.equal((await consultar()).status, ESTADO_HTTP.demasiadasPeticiones);
  }));

test('cerrojo público directo conserva 403 fuera de IA; no afecta autenticación administrativa separada', () =>
  conPanel(
    async (p) => {
      assert.equal((await p.pedir('/api/grupos')).status, ESTADO_HTTP.prohibido);
      assert.equal(
        (await p.pedir('/api/grupos', { headers: { 'cf-access-jwt-assertion': p.id.publico } })).status,
        ESTADO_HTTP.correcto,
      );
      assert.ok(await abrir(p));
    },
    {
      FARO_ACCESS_EQUIPO: 'prueba',
      FARO_ACCESS_AUD: 'publico',
      FARO_ACCESS_DECLARACION: 'pruebas-con-relatos-ficticios',
    },
  ));

async function sqlCorrupto() {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'administracion-arranque-corrupto-'));
  const archivo = join(dir, 'estado.sqlite');
  const almacen = crearAlmacenPublicoNode({ archivo, maxClientes: LIMITES_CONECTIVIDAD.instituciones });
  await almacen.sesion.prepararPanel(POLITICA);
  const acceso = { huellaSesion: 'a'.repeat(LONGITUD_HUELLA), huellaPrincipal: 'b'.repeat(LONGITUD_HUELLA) };
  await abrirSesionDePrueba(almacen.sesion, acceso);
  await almacen.sesion.cambiarControlesDeSesion(acceso, 0, POLITICA);
  almacen.close();
  const db = new DatabaseSync(archivo);
  const esquema = db.prepare("SELECT sql FROM sqlite_master WHERE name='administracion_controles'").get()?.sql;
  const documento = db.prepare('SELECT documento FROM administracion_controles').get()?.documento;
  const sesionAnterior = db.prepare('SELECT * FROM administracion_sesion').all();
  assert.equal(typeof esquema, 'string');
  assert.equal(typeof documento, 'string');
  db.exec('DROP TABLE administracion_controles');
  db.close();
  return { dir, archivo, esquema, documento, sesionAnterior };
}
async function recuperarYComprobarCierre(
  montada: Awaited<ReturnType<typeof montarAdministracionNode>>,
  fixture: Awaited<ReturnType<typeof sqlCorrupto>>,
) {
  const { archivo, esquema, documento, sesionAnterior } = fixture;
  // Solo la prueba restaura la tabla exacta guardada; el producto nunca repara ni sustituye el archivo.
  const reparada = new DatabaseSync(archivo);
  try {
    reparada.exec(String(esquema));
    reparada.prepare('INSERT INTO administracion_controles(id,documento) VALUES(1,?)').run(String(documento));
  } finally {
    reparada.close();
  }
  assert.equal((await montada.administracion.leerControles(new AbortController().signal)).revision, 1);
  const comprobacion = new DatabaseSync(archivo);
  try {
    assert.deepEqual(comprobacion.prepare('SELECT * FROM administracion_sesion').all(), sesionAnterior);
  } finally {
    comprobacion.close();
  }
  montada.cerrar();
  montada.cerrar();
  await assert.rejects(montada.administracion.leerControles(new AbortController().signal), /cerrado/);
  const trasCerrar = new DatabaseSync(archivo);
  try {
    assert.deepEqual(trasCerrar.prepare('SELECT * FROM administracion_sesion').all(), sesionAnterior);
    assert.equal(trasCerrar.prepare('SELECT documento FROM administracion_controles').get()?.documento, documento);
  } finally {
    trasCerrar.close();
  }
}

test('SQL corrupto en primer arranque conserva datos 200, servicios 503 y cerrojo público 403', async () => {
  const fixture = await sqlCorrupto();
  const { dir, archivo } = fixture;
  const id = await IDENTIDAD;
  let montada: Awaited<ReturnType<typeof montarAdministracionNode>> | undefined;
  let protegida: Awaited<ReturnType<typeof montarAdministracionNode>> | undefined;
  try {
    montada = await montarAdministracionNode({ ...opciones(archivo), pedir: id.pedir });
    assert.equal((await montada.api(solicitud('http://127.0.0.1/api/grupos'))).status, ESTADO_HTTP.correcto);
    assert.equal((await montada.api(solicitud('http://127.0.0.1/mcp'))).status, ESTADO_HTTP.noDisponible);
    assert.equal(
      (await montada.administracion.catalogo(new Request('http://127.0.0.1/.well-known/api-catalog'))).status,
      ESTADO_HTTP.noDisponible,
    );
    const head = await montada.administracion.catalogo(
      new Request('http://127.0.0.1/.well-known/api-catalog', { method: 'HEAD' }),
    );
    assert.equal(head.status, ESTADO_HTTP.noDisponible);
    assert.equal(head.body, null);
    protegida = await montarAdministracionNode({
      ...opciones(archivo, {
        FARO_ACCESS_EQUIPO: 'prueba',
        FARO_ACCESS_AUD: 'publico',
        FARO_ACCESS_DECLARACION: 'pruebas-con-relatos-ficticios',
      }),
      pedir: id.pedir,
    });
    assert.equal((await protegida.api(solicitud('http://127.0.0.1/api/grupos'))).status, ESTADO_HTTP.prohibido);
    assert.equal(
      (
        await protegida.api(
          solicitud('http://127.0.0.1/api/grupos', { headers: { 'cf-access-jwt-assertion': id.publico } }),
        )
      ).status,
      ESTADO_HTTP.correcto,
    );
    await recuperarYComprobarCierre(montada, fixture);
  } finally {
    montada?.cerrar();
    protegida?.cerrar();
    rmSync(dir, { recursive: true });
  }
});

test('admin con API socios y registro estático ausente prepara capacidad cerrada', () =>
  conPanel(
    async (p) => {
      assert.ok(await abrir(p));
      assert.equal((await p.pedir('/api/grupos')).status, ESTADO_HTTP.correcto);
    },
    { FARO_API_SOCIOS: 'si' },
  ));

test('namespace mantenimiento no sirve archivos ni API pública cuando administración está ausente', async () => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'mantenimiento-ausente-'));
  const servidor = crearServidor({
    web: webDePrueba(dir),
    archivoAutoridadSecciones: join(dir, 'autoridad-secciones.sqlite'),
    puerto: 0,
    anfitrion: '127.0.0.1',
    api: async () => assert.fail('Mantenimiento no llega a la API pública'),
  });
  try {
    await new Promise<void>((resolver) => servidor.listen(0, '127.0.0.1', resolver));
    const origen = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
    for (const ruta of RUTAS_MANTENIMIENTO) {
      const salida = await fetch(`${origen}${ruta}`, { headers: { 'user-agent': IDENTIDAD_WEB['User-Agent'] } });
      assert.equal(salida.status, ESTADO_HTTP.noEncontrado);
      assert.equal(salida.headers.get('cache-control'), 'no-store');
      assert.equal((await salida.text()).includes('SEÑUELO'), false);
    }
  } finally {
    servidor.closeAllConnections();
    await new Promise<void>((resolve) => servidor.close(() => resolve()));
    rmSync(dir, { recursive: true });
  }
});
const RUTAS_MANTENIMIENTO = [
  '/mantenimiento',
  '/mantenimiento/activacion',
  '/mantenimiento/resultado',
  '/mantenimiento/resultado/',
  '/MANTENIMIENTO/resultado',
  '/mantenimient%6f/resultado',
  '/mantenimiento//resultado',
  '/x/%2e%2e%2fmantenimiento/resultado',
];
test('panel sin ejecutor reserva mantenimiento con 404 no-store incluso ante Access humano válido', () =>
  conPanel(async (p) => {
    for (const ruta of RUTAS_MANTENIMIENTO) {
      const salida = await p.pedir(ruta, { headers: { 'cf-access-jwt-assertion': p.id.jwt } });
      assert.equal(salida.status, ESTADO_HTTP.noEncontrado);
      assert.equal(salida.headers.get('cache-control'), 'no-store');
      assert.equal((await salida.text()).includes('SEÑUELO'), false);
    }
  }));

const ID_ACTUALIZACION = '11111111-1111-4111-8111-111111111111';
const SEGUNDOS_TOKEN_OIDC = 300;
const MS_SEGUNDO = 1000;
const TAM_SHA_CODIGO = 40;
const TAM_HUELLA_PAQUETE = 16;
const CONFIANZA_ACTUALIZACION = {
  audiencia: `${ORIGEN}/mantenimiento/resultado`,
  repositorioId: '123',
  propietarioId: '456',
  ref: 'refs/heads/main',
  workflowRef: 'equipo/producto/.github/workflows/actualizar.yml@refs/heads/main',
  workflowSha: 'a'.repeat(TAM_SHA_CODIGO),
  sha: 'b'.repeat(TAM_SHA_CODIGO),
};
async function gitHubSimulado() {
  const id = await IDENTIDAD;
  const enviados: unknown[] = [];
  const pedir: typeof fetch = async (recurso, inicio) => {
    if (!(recurso instanceof Request) || !recurso.url.startsWith('https://api.github.com/')) {
      return id.pedir(recurso, inicio);
    }
    assert.equal(
      recurso.url,
      'https://api.github.com/repos/equipo/producto/actions/workflows/actualizar.yml/dispatches',
    );
    assert.equal(recurso.headers.get('user-agent'), IDENTIDAD_WEB['User-Agent']);
    assert.equal(recurso.headers.get('authorization'), 'Bearer token-github-sintetico');
    enviados.push(await recurso.json());
    return Response.json({
      workflow_run_id: 789,
      run_url: 'https://api.github.com/repos/equipo/producto/actions/runs/789',
      html_url: 'https://github.com/equipo/producto/actions/runs/789',
    });
  };
  const cambios = {
    FARO_ACTUALIZACION_GITHUB: JSON.stringify({
      version: 1,
      destino: { propietario: 'equipo', repositorio: 'producto', workflow: 'actualizar.yml', ref: 'main' },
      confianza: CONFIANZA_ACTUALIZACION,
    }),
    FARO_ACTUALIZACION_GITHUB_TOKEN: 'token-github-sintetico',
  };
  return { pedir, cambios, enviados };
}
function claimsActualizacion() {
  const confianza = CONFIANZA_ACTUALIZACION;
  const segundos = Math.floor(Date.now() / MS_SEGUNDO);
  return {
    iss: 'https://token.actions.githubusercontent.com',
    aud: confianza.audiencia,
    repository_id: confianza.repositorioId,
    repository_owner_id: confianza.propietarioId,
    ref: confianza.ref,
    workflow_ref: confianza.workflowRef,
    workflow_sha: confianza.workflowSha,
    sha: confianza.sha,
    run_id: '789',
    run_attempt: '1',
    jti: 'recibo-sintetico',
    iat: segundos,
    nbf: segundos,
    exp: segundos + SEGUNDOS_TOKEN_OIDC,
  };
}
function reciboActualizacion() {
  const instante = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const estado = {
    version: 1,
    observadoEn: instante,
    formacionAbiertaCaduca: null,
    fuentes: [{ id: 'fuente', politica: 'mensual', fecha: instante.slice(0, 10), plazoDias: 30 }],
    modulos: ['fuente', 'paquete'].map((id) => ({
      id,
      ultimoIntento: instante,
      veredicto: 'verde',
      ultimaVersionBuena: { fecha: instante, huella: 'c'.repeat(LONGITUD_HUELLA) },
      fallos: 0,
      proximoReintento: null,
    })),
  };
  return {
    version: 1,
    solicitudId: ID_ACTUALIZACION,
    revisionReserva: 1,
    accion: 'actualizar-datos',
    resultado: 'validado',
    veredicto: 'verde',
    terminadoEn: instante,
    estado,
    huellaPaquete: 'd'.repeat(TAM_HUELLA_PAQUETE),
    error: null,
  };
}
async function comprobarReciboNode(p: Panel, texto: string) {
  const enviar = (token: string, ruta = '/mantenimiento/resultado') =>
    p.pedir(ruta, {
      method: 'POST',
      body: texto,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    });
  assert.equal((await enviar('')).status, ESTADO_HTTP.noAutenticado);
  assert.equal((await enviar(p.id.jwt)).status, ESTADO_HTTP.noAutenticado);
  const tokenOidc = await p.id.firmarOidc(claimsActualizacion());
  assert.equal((await enviar(tokenOidc)).status, ESTADO_HTTP.conflicto);
  const inicio = await p.pedir('/mantenimiento/inicio', {
    method: 'POST',
    body: JSON.stringify({ solicitudId: ID_ACTUALIZACION, revisionReserva: 1, accion: 'actualizar-datos' }),
    headers: { authorization: `Bearer ${tokenOidc}`, 'content-type': 'application/json' },
  });
  assert.equal(inicio.status, ESTADO_HTTP.correcto);
  assert.deepEqual(await inicio.json(), { estado: 'aplicado' });
  const primera = await enviar(tokenOidc);
  assert.equal(primera.status, ESTADO_HTTP.correcto);
  assert.equal(primera.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await primera.json(), { estado: 'aplicado' });
  const repetida = await enviar(tokenOidc);
  assert.deepEqual(await repetida.json(), { estado: 'repetido' });
  for (const ruta of RUTAS_MANTENIMIENTO.filter((ruta) => ruta !== '/mantenimiento/resultado')) {
    const salida = await enviar(tokenOidc, ruta);
    assert.equal(salida.status, ESTADO_HTTP.noEncontrado);
    assert.equal(salida.headers.get('cache-control'), 'no-store');
    assert.equal((await salida.text()).includes('SEÑUELO'), false);
  }
  assert.equal((await enviar(tokenOidc, '/mantenimiento/resultado?token=ajeno')).status, ESTADO_HTTP.noEncontrado);
}
test('montaje Node ejecuta dispatch único y recibe resultado OIDC sin Access humano ni activar datos', async () => {
  const github = await gitHubSimulado();
  await conPanel(
    async (p) => {
      const token = await abrir(p);
      const solicitud = { solicitudId: ID_ACTUALIZACION, accion: 'actualizar-datos', revisionEsperada: 0 };
      const salida = await p.panel('datos/actualizar', token, solicitud);
      assert.equal(salida.status, ESTADO_HTTP.aceptada);
      const inicial = leerResultadoSolicitudActualizacion(await salida.json());
      assert.ok(inicial.estado === 'activa');
      assert.equal(inicial.trabajos.ultimoTrabajo?.estado, 'despachado');
      assert.equal(github.enviados.length, 1);
      assert.deepEqual(github.enviados[0], {
        ref: 'main',
        inputs: { solicitud_id: ID_ACTUALIZACION, accion: 'actualizar-datos', revision_reserva: '1' },
        return_run_details: true,
      });
      await comprobarReciboNode(p, JSON.stringify(reciboActualizacion()));
      const lectura = leerResultadoLecturaTrabajo(await (await p.panel('datos/trabajo', token)).json());
      assert.ok(lectura.estado === 'activa');
      assert.equal(lectura.trabajos.ultimoTrabajo?.estado, 'terminado');
      assert.equal(lectura.trabajos.ultimoTrabajo?.resultado?.resultado, 'validado');
      assert.equal((await p.panel('datos/actualizar', token, solicitud)).status, ESTADO_HTTP.correcto);
      assert.equal(github.enviados.length, 1);
      const controles = objeto(await (await p.panel('controles/leer', token)).json());
      assert.equal(controles.estado, 'activa');
      assert.equal(objeto(controles.controles).revision, 0);
      for (const campo of ['confianza', 'workflowSha', 'observadoEn']) {
        assert.equal(JSON.stringify(lectura).includes(campo), false);
      }
    },
    github.cambios,
    (o) => ({ ...o, pedir: github.pedir }),
  );
});

test('configuración de actualización rota aísla 503 y conserva salud, sesión y controles', () =>
  conPanel(
    async (p) => {
      assert.equal((await p.pedir('/api/grupos')).status, ESTADO_HTTP.correcto);
      const token = await abrir(p);
      assert.equal((await p.panel('controles/leer', token)).status, ESTADO_HTTP.correcto);
      const solicitud = { solicitudId: ID_ACTUALIZACION, accion: 'actualizar-datos', revisionEsperada: 0 };
      assert.equal((await p.panel('datos/actualizar', token, solicitud)).status, ESTADO_HTTP.noDisponible);
    },
    { FARO_ACTUALIZACION_GITHUB: '{', FARO_ACTUALIZACION_GITHUB_TOKEN: 'token-sintetico' },
  ));

test('rechazar un POST del receptor no contamina el cuerpo de la siguiente petición Node', async () => {
  const github = await gitHubSimulado();
  await conPanel(
    async (p) => {
      const token = await abrir(p);
      const rechazada = await p.pedir('/mantenimiento/resultado?invalida', {
        method: 'POST',
        body: '{"rechazado":true}',
        headers: { 'content-type': 'application/json' },
      });
      assert.equal(rechazada.status, ESTADO_HTTP.noEncontrado);
      await rechazada.text();
      const controles = await p.panel('controles/leer', token);
      assert.equal(controles.status, ESTADO_HTTP.correcto, await controles.text());
    },
    github.cambios,
    (o) => ({ ...o, pedir: github.pedir }),
  );
});

test('trabajos corruptos al reiniciar no bloquean controles ni se recrean silenciosamente', async () => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'trabajos-corruptos-'));
  const archivo = join(dir, 'registro.sqlite');
  const base = crearAlmacenPublicoNode({ archivo, maxClientes: LIMITES_CONECTIVIDAD.instituciones });
  await base.sesion.prepararPanel(POLITICA);
  await base.trabajos.prepararTrabajos();
  base.close();
  const db = new DatabaseSync(archivo);
  db.exec("UPDATE administracion_trabajo SET documento='{}'");
  db.close();
  const github = await gitHubSimulado();
  try {
    await conPanel(
      async (p) => {
        assert.equal((await p.pedir('/api/grupos')).status, ESTADO_HTTP.correcto);
        const token = await abrir(p);
        assert.equal((await p.panel('controles/leer', token)).status, ESTADO_HTTP.correcto);
        const solicitud = { solicitudId: ID_ACTUALIZACION, accion: 'actualizar-datos', revisionEsperada: 0 };
        assert.equal((await p.panel('datos/actualizar', token, solicitud)).status, ESTADO_HTTP.noDisponible);
        assert.equal(github.enviados.length, 0);
      },
      github.cambios,
      (o) => ({ ...o, archivo, pedir: github.pedir }),
    );
    const comprobacion = new DatabaseSync(archivo);
    try {
      assert.equal(comprobacion.prepare('SELECT documento FROM administracion_trabajo').get()?.documento, '{}');
    } finally {
      comprobacion.close();
    }
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('retirar un cuerpo de mantenimiento pendiente libera el puente y conserva el servidor', async () => {
  const github = await gitHubSimulado();
  await conPanel(
    async (p) => {
      const token = await abrir(p);
      await retirarCuerpoPendiente(p);
      assert.equal((await p.panel('controles/leer', token)).status, ESTADO_HTTP.correcto);
      assert.equal(github.enviados.length, 0);
    },
    github.cambios,
    (o) => ({ ...o, pedir: github.pedir }),
  );
});
function retirarCuerpoPendiente(p: Panel): Promise<void> {
  return new Promise((resolve, reject) => {
    const retirada = new Error('Retirada sintética del cuerpo');
    const req = request(p.origen, {
      method: 'POST',
      path: '/mantenimiento/resultado',
      headers: {
        'user-agent': IDENTIDAD_WEB['User-Agent'],
        authorization: `Bearer ${p.id.jwt}`,
        'content-type': 'application/json',
      },
    });
    req.once('error', (error) => {
      if (error !== retirada) {
        reject(error);
      }
    });
    req.once('close', resolve);
    req.setTimeout(MAX_ESPERA_MS, () => req.destroy(new Error('Plazo de prueba')));
    p.servidor.once('request', () => setImmediate(() => req.destroy(retirada)));
    req.write('{"version":1');
  });
}

test('Node monta activación optativa, exige OIDC y mantiene el acceso de datos', async () => {
  const github = await gitHubSimulado();
  await conPanel(
    async (p) => {
      const enviar = (token: string) =>
        p.pedir('/mantenimiento/activacion', {
          method: 'POST',
          body: JSON.stringify({ operacion: 'leer' }),
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        });
      assert.equal((await enviar(p.id.jwt)).status, ESTADO_HTTP.noAutenticado);
      const oidc = await p.id.firmarOidc(claimsActualizacion());
      const lectura = await enviar(oidc);
      assert.equal(lectura.status, ESTADO_HTTP.correcto);
      assert.deepEqual(await lectura.json(), {
        estado: 'leido',
        activacion: { version: 1, revision: 0, ultimaActivacion: null },
      });
      assert.equal((await p.pedir('/api/grupos')).status, ESTADO_HTTP.correcto);
    },
    { ...github.cambios, FARO_ACTIVACION_AUTOMATICA: 'si' },
    (o) => ({ ...o, pedir: github.pedir }),
  );
});

function peticionVigilanteNode(ruta: string, jwt: string, token: string): Request {
  return new Request(`${ORIGEN}/administracion/api/${ruta}`, {
    method: 'POST',
    body: '{}',
    headers: {
      origin: ORIGEN,
      'sec-fetch-site': 'same-origin',
      'x-faro-panel': '1',
      'content-type': 'application/json',
      'cf-access-jwt-assertion': jwt,
      ...(token ? { 'x-faro-sesion': token } : {}),
    },
  });
}
test('política de vigilante inválida no impide administración Node', async () => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'vigilante-config-'));
  const archivo = join(dir, 'estado.sqlite');
  const id = await IDENTIDAD;
  const github = await gitHubSimulado();
  let montada: Awaited<ReturnType<typeof montarAdministracionNode>> | undefined;
  try {
    montada = await montarAdministracionNode({
      ...opciones(archivo, { ...github.cambios, FARO_VIGILANTE: '{invalido' }),
      pedir: github.pedir,
    });
    const responder = montada.administracion.responder;
    const panel = (ruta: string, token = '') => responder(peticionVigilanteNode(ruta, id.jwt, token));
    const apertura = await panel('sesion/abrir');
    assert.equal(apertura.status, ESTADO_HTTP.correcto);
    const token = String(objeto(await apertura.json()).token);
    assert.equal((await panel('controles/leer', token)).status, ESTADO_HTTP.correcto);
    const resultado = await panel('datos/comprobar-estado', token);
    assert.equal(resultado.status, ESTADO_HTTP.noDisponible);
    assert.equal(objeto(await resultado.json()).error, 'vigilante_configuracion_invalida');
    assert.equal(montada.administracion.capacidadesPanel?.vigilante, true);
    assert.equal(montada.administracion.capacidadesPanel?.recorrido, false);
    const db = new DatabaseSync(archivo);
    try {
      assert.equal(
        db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='administracion_vigilante'").get()?.n,
        0,
      );
    } finally {
      db.close();
    }
    assert.equal((await panel('datos/trabajo', token)).status, ESTADO_HTTP.correcto);
  } finally {
    montada?.cerrar();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('programación inválida no bloquea el montaje Node sin vigilante configurado', async () => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'vigilante-programacion-'));
  try {
    const montada = await montarAdministracionNode(
      opciones(join(dir, 'estado.sqlite'), { FARO_ACTUALIZACION_PROGRAMADA: '{invalido' }),
    );
    montada.cerrar();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
