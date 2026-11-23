/**
 * Rutas de la lista de administradores con el enrutador real, SQLite en memoria y un `fetch` falso de Cloudflare:
 * autorización dentro y fuera de la lista, alta y retirada con Access bien y con fallo, sin configurar y segundo factor.
 */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import type { ConfiguracionAdministradores } from '../../src/administracion/configuracion-administradores.ts';
import type { PoliticaControles } from '../../src/administracion/controles.ts';
import { crearGrupoAccess } from '../../src/administracion/grupo-access.ts';
import { crearRouterAdministrativo } from '../../src/administracion/http.ts';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { type PrincipalAdministrativo, SegundoFactorRequerido } from '../../src/plataforma/acceso-administrativo.ts';
import { AlmacenSesionPanelSqlite } from '../../src/plataforma/acceso-publico/sesion-sqlite.ts';
import { AlmacenPublicoSqlite } from '../../src/plataforma/acceso-publico/sqlite.ts';
import { motorPanel } from '../ayudas/persistencia-panel.ts';
import { principalDePrueba } from '../ayudas/principal-panel.ts';

const ORIGEN = 'https://faro.prueba';
const EMISOR = 'https://equipo-prueba.cloudflareaccess.com';
const CUENTA = '0123456789abcdef0123456789abcdef';
const GRUPO = '01234567-89ab-cdef-0123-456789abcdef';
const URL_GRUPO = `https://api.cloudflare.com/client/v4/accounts/${CUENTA}/access/groups/${GRUPO}`;
const URL_REVOCAR = `https://api.cloudflare.com/client/v4/accounts/${CUENTA}/access/organizations/revoke_user`;
const ANA = 'ana@faro.invalid';
const BERTA = 'berta@faro.invalid';
const politica: PoliticaControles = { version: 2, api: 'deshabilitada', mcp: false, a2a: false };
/** Regla que no es de correo: Faro la conserva siempre al reescribir el grupo. */
const DOMINIO = { email_domain: { domain: 'citilab.invalid' } };

interface Llamada {
  readonly metodo: string;
  readonly url: string;
  readonly cuerpo: unknown;
}
/** Cloudflare falso: guarda cada llamada y responde bien salvo a los métodos que se le pidan como fallo. */
function cloudflare() {
  const llamadas: Llamada[] = [];
  const fallan = new Set<string>();
  let incluidos: unknown[] = [DOMINIO];
  const pedir: typeof fetch = async (recurso, opciones) => {
    const metodo = opciones?.method ?? 'GET';
    const cuerpo = opciones?.body ? JSON.parse(String(opciones.body)) : null;
    llamadas.push({ metodo, url: String(recurso), cuerpo });
    if (fallan.has(metodo)) {
      return Response.json({ success: false, errors: [{ code: 10000 }] }, { status: ESTADO_HTTP.errorInterno });
    }
    if (metodo === 'PUT') {
      incluidos = cuerpo.include;
    }
    const result = { id: GRUPO, name: 'Faro · Administradores', include: incluidos, exclude: [], require: [] };
    return Response.json({ success: true, result });
  };
  return { pedir, llamadas, fallan, incluidos: () => incluidos };
}
function conSincronizacion(pedir: typeof fetch): ConfiguracionAdministradores {
  const destino = { cuenta: CUENTA, grupo: GRUPO, token: 'token-sintetico-de-prueba-con-longitud-sobrada' };
  return { siembra: [], sincronizacion: { estado: 'configurada' }, grupo: crearGrupoAccess(destino, pedir) };
}

async function panel(administradores?: ConfiguracionAdministradores, guardia?: () => Promise<PrincipalAdministrativo>) {
  const db = new DatabaseSync(':memory:');
  const sql = motorPanel(db);
  await new AlmacenPublicoSqlite(sql, { maxClientes: 2 }).activarControles(politica);
  const almacen = new AlmacenSesionPanelSqlite(sql);
  await almacen.activarSesionPanel();
  const personas = new Map<string, PrincipalAdministrativo>();
  const router = crearRouterAdministrativo({
    origen: ORIGEN,
    almacen,
    ...(administradores ? { administradores } : {}),
    guardiaAdministrativa:
      guardia ??
      (async (peticion) => {
        const nombre = peticion.headers.get('x-prueba-persona') ?? 'ana';
        const principal = personas.get(nombre) ?? principalDePrueba(EMISOR, nombre);
        personas.set(nombre, principal);
        return principal;
      }),
  });
  const pedir = async (quien: string, ruta: string, cuerpo: object = {}, token?: string) => {
    const respuesta = await router(
      new Request(`${ORIGEN}/administracion/api/${ruta}`, {
        method: 'POST',
        headers: {
          origin: ORIGEN,
          'x-faro-panel': '1',
          'sec-fetch-site': 'same-origin',
          'content-type': 'application/json',
          'x-prueba-persona': quien,
          ...(token ? { 'x-faro-sesion': token } : {}),
        },
        body: JSON.stringify(cuerpo),
      }),
    );
    return { estado: respuesta.status, datos: (await respuesta.json()) as Record<string, unknown> };
  };
  const abrir = async (quien: string) => {
    const { datos } = await pedir(quien, 'sesion/abrir');
    assert.equal(typeof datos.token, 'string');
    return datos.token as string;
  };
  return { pedir, abrir, cerrar: () => db.close() };
}
function lista(datos: Record<string, unknown>) {
  return (datos.administradores as { correo: string; estado: string }[]).map((fila) => [fila.correo, fila.estado]);
}

test('lista vacía: basta Access; sin sincronización se dice qué falta; después, fuera de la lista se deniega', async () => {
  const p = await panel();
  try {
    const leida = await p.pedir('ana', 'administradores/leer');
    assert.equal(leida.estado, ESTADO_HTTP.correcto);
    assert.deepEqual(leida.datos.administradores, []);
    assert.deepEqual(leida.datos.sincronizacion, {
      estado: 'sin-configurar',
      falta: ['FARO_ADMIN_ACCESS_CUENTA', 'FARO_ADMIN_ACCESS_GRUPO', 'FARO_ADMIN_ACCESS_TOKEN'],
    });
    const token = await p.abrir('ana');
    const ajena = await p.pedir('ana', 'administradores/anadir', { correo: BERTA }, token);
    assert.deepEqual([ajena.estado, ajena.datos.error], [ESTADO_HTTP.conflicto, 'alta_propia_primero']);
    const propia = await p.pedir('ana', 'administradores/anadir', { correo: 'Ana@Faro.Invalid' }, token);
    assert.equal(propia.estado, ESTADO_HTTP.correcto);
    assert.deepEqual(lista(propia.datos), [[ANA, 'activo']]);
    const fuera = await p.pedir('berta', 'sesion/bienvenida');
    assert.deepEqual([fuera.estado, fuera.datos.error], [ESTADO_HTTP.prohibido, 'no_es_administrador']);
    assert.equal((await p.pedir('berta', 'administradores/leer')).estado, ESTADO_HTTP.prohibido);
    assert.equal((await p.pedir('ana', 'sesion/bienvenida')).estado, ESTADO_HTTP.correcto);
  } finally {
    p.cerrar();
  }
});

test('cambiar exige la sesión única de quien pide; leer no', async () => {
  const p = await panel();
  try {
    const sinToken = await p.pedir('ana', 'administradores/anadir', { correo: ANA });
    assert.deepEqual([sinToken.estado, sinToken.datos.error], [ESTADO_HTTP.prohibido, 'sesion_inactiva']);
    const token = await p.abrir('ana');
    await p.pedir('ana', 'administradores/anadir', { correo: ANA }, token);
    await p.pedir('ana', 'administradores/anadir', { correo: BERTA }, token);
    // Berta está en la lista, pero la sesión única es de Ana: su token no vale para Berta.
    const deBerta = await p.pedir('berta', 'administradores/retirar', { correo: ANA }, token);
    assert.notEqual(deBerta.estado, ESTADO_HTTP.correcto);
    assert.deepEqual(lista((await p.pedir('berta', 'administradores/leer')).datos), [
      [ANA, 'activo'],
      [BERTA, 'activo'],
    ]);
    const malo = await p.pedir('ana', 'administradores/anadir', { correo: 'sin-arroba' }, token);
    assert.deepEqual([malo.estado, malo.datos.error], [ESTADO_HTTP.solicitudIncorrecta, 'correo_no_valido']);
    const ultimo = await p.pedir('ana', 'administradores/retirar', { correo: BERTA }, token);
    assert.equal(ultimo.estado, ESTADO_HTTP.correcto);
    const propia = await p.pedir('ana', 'administradores/retirar', { correo: ANA }, token);
    assert.deepEqual([propia.estado, propia.datos.error], [ESTADO_HTTP.conflicto, 'ultimo_activo']);
  } finally {
    p.cerrar();
  }
});

test('alta con Cloudflare: primero Access (conserva nombre y reglas que no son de correo), después Faro', async () => {
  const nube = cloudflare();
  const p = await panel(conSincronizacion(nube.pedir));
  try {
    const token = await p.abrir('ana');
    await p.pedir('ana', 'administradores/anadir', { correo: ANA }, token);
    const alta = await p.pedir('ana', 'administradores/anadir', { correo: BERTA }, token);
    assert.equal(alta.estado, ESTADO_HTTP.correcto);
    assert.deepEqual(alta.datos.sincronizacion, { estado: 'configurada' });
    assert.deepEqual(lista(alta.datos), [
      [ANA, 'activo'],
      [BERTA, 'pendiente'],
    ]);
    assert.deepEqual(
      nube.llamadas.map((llamada) => [llamada.metodo, llamada.url]),
      [
        ['GET', URL_GRUPO],
        ['PUT', URL_GRUPO],
        ['GET', URL_GRUPO],
        ['PUT', URL_GRUPO],
      ],
    );
    assert.deepEqual(nube.llamadas.at(-1)?.cuerpo, {
      name: 'Faro · Administradores',
      include: [DOMINIO, { email: { email: ANA } }, { email: { email: BERTA } }],
      exclude: [],
      require: [],
    });
    const registro = (await p.pedir('ana', 'sesion/registro')).datos.registro as { tipo: string }[];
    assert.deepEqual(
      registro.slice(0, 2).map((fila) => fila.tipo),
      ['administrador-anadido', 'cloudflare-actualizado'],
    );
  } finally {
    p.cerrar();
  }
});

test('alta con Cloudflare caído: no se añade, se dice qué pasó y queda anotado', async () => {
  const nube = cloudflare();
  const p = await panel(conSincronizacion(nube.pedir));
  try {
    const token = await p.abrir('ana');
    await p.pedir('ana', 'administradores/anadir', { correo: ANA }, token);
    nube.fallan.add('PUT');
    const alta = await p.pedir('ana', 'administradores/anadir', { correo: BERTA }, token);
    assert.deepEqual([alta.estado, alta.datos.error], [ESTADO_HTTP.pasarelaIncorrecta, 'cloudflare_no_disponible']);
    assert.deepEqual(lista((await p.pedir('ana', 'administradores/leer')).datos), [[ANA, 'activo']]);
    const [fallo] = (await p.pedir('ana', 'sesion/registro')).datos.registro as { tipo: string; titular: string }[];
    assert.deepEqual([fallo?.tipo, fallo?.titular], ['cloudflare-fallido', BERTA]);
  } finally {
    p.cerrar();
  }
});

test('retirada: Faro deja de autorizar ya; si Access falla queda pendiente y el reintento quita y revoca', async () => {
  const nube = cloudflare();
  const p = await panel(conSincronizacion(nube.pedir));
  try {
    const token = await p.abrir('ana');
    await p.pedir('ana', 'administradores/anadir', { correo: ANA }, token);
    await p.pedir('ana', 'administradores/anadir', { correo: BERTA }, token);
    nube.fallan.add('PUT');
    const retirada = await p.pedir('ana', 'administradores/retirar', { correo: BERTA }, token);
    assert.equal(retirada.estado, ESTADO_HTTP.correcto);
    assert.equal(retirada.datos.cloudflare, 'fallida');
    assert.deepEqual(lista(retirada.datos), [
      [ANA, 'activo'],
      [BERTA, 'retirada-pendiente'],
    ]);
    assert.equal((await p.pedir('berta', 'sesion/bienvenida')).datos.error, 'no_es_administrador');
    assert.equal(
      nube.llamadas.some((llamada) => llamada.url === URL_REVOCAR),
      false,
    );
    nube.fallan.clear();
    const reintento = await p.pedir('ana', 'administradores/reintentar', { correo: BERTA }, token);
    assert.equal(reintento.datos.cloudflare, 'correcta');
    assert.deepEqual(lista(reintento.datos), [[ANA, 'activo']]);
    assert.deepEqual(nube.incluidos(), [DOMINIO, { email: { email: ANA } }]);
    assert.deepEqual(nube.llamadas.at(-1), { metodo: 'POST', url: URL_REVOCAR, cuerpo: { email: BERTA } });
    const otra = await p.pedir('ana', 'administradores/reintentar', { correo: BERTA }, token);
    assert.deepEqual([otra.estado, otra.datos.error], [ESTADO_HTTP.noEncontrado, 'administrador_no_encontrado']);
  } finally {
    p.cerrar();
  }
});

test('la revocación fallida también deja la retirada pendiente', async () => {
  const nube = cloudflare();
  const p = await panel(conSincronizacion(nube.pedir));
  try {
    const token = await p.abrir('ana');
    await p.pedir('ana', 'administradores/anadir', { correo: ANA }, token);
    await p.pedir('ana', 'administradores/anadir', { correo: BERTA }, token);
    nube.fallan.add('POST');
    const retirada = await p.pedir('ana', 'administradores/retirar', { correo: BERTA }, token);
    assert.equal(retirada.datos.cloudflare, 'fallida');
    assert.deepEqual(lista(retirada.datos).at(-1), [BERTA, 'retirada-pendiente']);
  } finally {
    p.cerrar();
  }
});

test('segundo factor exigido y ausente: se deniega con su propio error', async () => {
  const p = await panel(undefined, async () => {
    throw new SegundoFactorRequerido();
  });
  try {
    const respuesta = await p.pedir('ana', 'administradores/leer');
    assert.deepEqual([respuesta.estado, respuesta.datos.error], [ESTADO_HTTP.prohibido, 'segundo_factor_requerido']);
  } finally {
    p.cerrar();
  }
});

test('si la lista no se puede leer, la petición se deniega', async () => {
  const db = new DatabaseSync(':memory:');
  const sql = motorPanel(db);
  await new AlmacenPublicoSqlite(sql, { maxClientes: 2 }).activarControles(politica);
  const almacen = new AlmacenSesionPanelSqlite(sql);
  await almacen.activarSesionPanel();
  almacen.autorizarAdministrador = async () => {
    throw new Error('almacén no disponible');
  };
  const router = crearRouterAdministrativo({
    origen: ORIGEN,
    almacen,
    guardiaAdministrativa: async () => principalDePrueba(EMISOR, 'ana'),
  });
  try {
    const respuesta = await router(
      new Request(`${ORIGEN}/administracion/api/sesion/bienvenida`, {
        method: 'POST',
        headers: {
          origin: ORIGEN,
          'x-faro-panel': '1',
          'sec-fetch-site': 'same-origin',
          'content-type': 'application/json',
        },
        body: '{}',
      }),
    );
    assert.equal(respuesta.status, ESTADO_HTTP.noDisponible);
  } finally {
    db.close();
  }
});
