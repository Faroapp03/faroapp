/**
 * El Worker oficial decide qué recorrido sirve leyendo el modo en su autoridad durable, no en una copia propia. Se
 * monta la autoridad real sobre una SQLite en memoria y se reinstancia sobre la misma base para imitar un reinicio.
 * Acredita la fuente; el Worker construido y la autoridad desplegada se comprueban aparte. El selector alterna entre el
 * real y la primera extensión del registro; sin extensiones instaladas no hay selector y el caso no se ejecuta.
 */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { AccesoPublicoDurable } from '../../src/plataforma/acceso-publico/durable.ts';
import { AlmacenRecorridoDurable } from '../../src/plataforma/acceso-publico/recorrido-cliente-durable.ts';
import oficial from '../../src/plataforma/cloudflare/worker-oficial.ts';
import { EXTENSIONES } from '../../src/plataforma/extensiones.ts';
import type { VarianteRecorrido } from '../../src/plataforma/variantes-recorrido.ts';
import { alarmaDurableDePrueba } from '../ayudas/alarma-durable.ts';
import { abrirSesionDePrueba } from '../ayudas/sesion-de-prueba.ts';

const ORIGEN = 'https://ejemplo.invalid';
const CLAVE = 'clave-general-sintetica';
const IP = '192.0.2.10';
const LONGITUD_HUELLA = 64;
const ACCESO = { huellaSesion: 'a'.repeat(LONGITUD_HUELLA), huellaPrincipal: 'b'.repeat(LONGITUD_HUELLA) };
const [EXTENSION] = EXTENSIONES;

/** La autoridad durable real sobre `db`: cada llamada crea una instancia nueva que solo conserva lo guardado. */
function autoridadSobre(db: DatabaseSync): AccesoPublicoDurable {
  return new AccesoPublicoDurable(
    {
      storage: {
        ...alarmaDurableDePrueba(),
        sql: { exec: (sql, ...valores) => ({ toArray: () => db.prepare(sql).all(...valores) }) },
        transactionSync: <T>(accion: () => T): T => {
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
      },
    },
    {},
  );
}

/** Sin sesión, una petición que no es navegación recibe un 403 vacío que no se guarda. */
function comprobarRechazoSinSesion(respuesta: Response): void {
  assert.equal(respuesta.status, ESTADO_HTTP.prohibido);
  assert.equal(respuesta.headers.get('cache-control'), 'no-store');
  assert.equal(respuesta.body, null);
}

type Pedir = (ruta: string) => Promise<Response>;

/** Un entorno inventado cuyo espacio de nombres reenvía a la autoridad que devuelva `vigente` en cada petición. */
function entornoSintetico(vigente: () => AccesoPublicoDurable) {
  // Nunca responde con datos fijados en la prueba: todo sale de la autoridad durable de ese momento.
  const espacio = { idFromName: () => 'id', get: () => ({ fetch: (p: Request) => vigente().fetch(p) }) };
  return {
    REGISTRO_SOCIOS: espacio,
    ASSETS: { fetch: async () => new Response('contenido sintético') },
    FARO_CLAVE_GENERAL: CLAVE,
    FARO_SESION_PORTAL: 'firma-sintetica-independiente-de-mas-de-32-bytes',
    FARO_LIMITE_PORTAL: 'limite-sintetico-independiente-de-mas-de-32-bytes',
    FARO_RECORRIDO_CLAVE: 'clave-inactiva-sintetica',
    FARO_RECORRIDO_FIRMA: 'firma-recorrido-sintetica-mas-de-32-bytes',
    FARO_RECORRIDO_LIMITE: 'limite-recorrido-sintetico-mas-de-32-bytes',
  };
}

/** Entra en el portal con la clave general y devuelve la cookie de esa sesión. */
async function sesionDelPortal(entorno: ReturnType<typeof entornoSintetico>): Promise<string> {
  const entrada = await oficial.fetch(
    new Request(`${ORIGEN}/acceso-web/entrar`, {
      method: 'POST',
      headers: {
        origin: ORIGEN,
        'sec-fetch-site': 'same-origin',
        'content-type': 'application/x-www-form-urlencoded',
        'cf-connecting-ip': IP,
      },
      body: new URLSearchParams({ usuario: 'Faro', clave: CLAVE }),
    }),
    entorno,
  );
  assert.equal(entrada.status, ESTADO_HTTP.correcto);
  const cookie = entrada.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie);
  return cookie;
}

/** Entra en el portal con la clave general y devuelve cómo pedir rutas con esa sesión. */
async function entrarEnElPortal(entorno: ReturnType<typeof entornoSintetico>): Promise<Pedir> {
  const cookie = await sesionDelPortal(entorno);
  return (ruta) =>
    oficial.fetch(new Request(`${ORIGEN}${ruta}`, { headers: { cookie, 'cf-connecting-ip': IP } }), entorno);
}

/**
 * El «Origin» que pone un navegador al envío nativo de un formulario del mismo origen según la política de referencia
 * de la página (Fetch, serializar el origen de una petición): con no-referrer sale «null».
 */
function origenDelEnvioNativo(politica: string | null): string {
  return politica === 'no-referrer' ? 'null' : ORIGEN;
}

/** El envío de la contraseña del recorrido inactivo al formulario de `/recorrido.html`, con ese origen y sitio. */
function envioDelFormulario(cookie: string, origen: string, sitio = 'same-origin'): Request {
  return new Request(`${ORIGEN}/recorrido.html`, {
    method: 'POST',
    headers: {
      cookie,
      origin: origen,
      'sec-fetch-site': sitio,
      'content-type': 'application/x-www-form-urlencoded',
      'cf-connecting-ip': IP,
    },
    body: new URLSearchParams({ clave: 'clave-inactiva-sintetica' }),
  });
}

/** El modo publicado y las variantes servidas: la activa, con la sesión del portal; la otra exige su propia sesión. */
async function comprobarModo(pedir: Pedir, modo: VarianteRecorrido, revision: number, otra: string): Promise<void> {
  const publicado = await pedir('/modo-recorrido.json');
  assert.equal(publicado.status, ESTADO_HTTP.correcto);
  assert.deepEqual(await publicado.json(), { version: 1, revision, modo });
  const [activa, inactiva] = modo === 'real' ? ['/recorrido.html', otra] : [otra, '/recorrido.html'];
  assert.equal((await pedir(activa)).status, ESTADO_HTTP.correcto);
  comprobarRechazoSinSesion(await pedir(inactiva));
}

test('el Worker oficial protege el selector y conserva el modo de su autoridad durable tras reiniciar', {
  skip: EXTENSION === undefined && 'Sin extensiones instaladas no hay selector.',
}, async () => {
  assert.ok(EXTENSION);
  const { id, entrada } = EXTENSION;
  const otra = `/${entrada}`;
  const db = new DatabaseSync(':memory:');
  try {
    let autoridad = autoridadSobre(db);
    const entorno = entornoSintetico(() => autoridad);
    const almacen = new AlmacenRecorridoDurable(entorno.REGISTRO_SOCIOS);
    await almacen.prepararPanel({ version: 2, api: 'deshabilitada', mcp: false, a2a: false });
    await abrirSesionDePrueba(almacen, ACCESO);
    assert.equal((await almacen.cambiarRecorridoDeSesion(ACCESO, 0, id)).estado, 'cambiado');
    comprobarRechazoSinSesion(await oficial.fetch(new Request(`${ORIGEN}/modo-recorrido.json`), entorno));
    const pedir = await entrarEnElPortal(entorno);
    await comprobarModo(pedir, id, 1, otra);

    autoridad = autoridadSobre(db);
    await comprobarModo(pedir, id, 1, otra);
    assert.equal((await almacen.cambiarRecorridoDeSesion(ACCESO, 1, 'real')).estado, 'cambiado');
    await comprobarModo(pedir, 'real', 2, otra);

    // Sin la fila del modo no hay recorrido que servir: el Worker no supone uno ni crea la fila al leer.
    db.exec('DELETE FROM administracion_recorrido');
    autoridad = autoridadSobre(db);
    assert.equal((await pedir('/modo-recorrido.json')).status, ESTADO_HTTP.noDisponible);
    assert.equal(db.prepare('SELECT count(*) AS filas FROM administracion_recorrido').get()?.filas, 0);
  } finally {
    db.close();
  }
});

test('en el Worker oficial, el formulario sin JavaScript del recorrido inactivo entra con un envío nativo', {
  skip: EXTENSION === undefined && 'Sin extensiones instaladas no hay recorrido inactivo.',
}, async () => {
  assert.ok(EXTENSION);
  const db = new DatabaseSync(':memory:');
  try {
    const autoridad = autoridadSobre(db);
    const entorno = entornoSintetico(() => autoridad);
    const almacen = new AlmacenRecorridoDurable(entorno.REGISTRO_SOCIOS);
    await almacen.prepararPanel({ version: 2, api: 'deshabilitada', mcp: false, a2a: false });
    await abrirSesionDePrueba(almacen, ACCESO);
    assert.equal((await almacen.cambiarRecorridoDeSesion(ACCESO, 0, EXTENSION.id)).estado, 'cambiado');
    const cookie = await sesionDelPortal(entorno);
    const pagina = await oficial.fetch(
      new Request(`${ORIGEN}/recorrido.html`, { headers: { cookie, accept: 'text/html', 'cf-connecting-ip': IP } }),
      entorno,
    );
    assert.equal(pagina.status, ESTADO_HTTP.correcto);
    assert.match(await pagina.text(), /<form id="acceso-recorrido" method="post" action="\/recorrido\.html">/);
    const politica = pagina.headers.get('referrer-policy');
    assert.equal(politica, 'same-origin');
    const envio = await oficial.fetch(envioDelFormulario(cookie, origenDelEnvioNativo(politica)), entorno);
    assert.equal(envio.status, ESTADO_HTTP.verOtra);
    assert.equal(envio.headers.get('location'), '/recorrido.html');
    // La comprobación de origen sigue estricta: un envío con «Origin: null» o de otro sitio no entra.
    for (const [origen, sitio] of [
      ['null', 'same-origin'],
      ['https://otro.invalid', 'cross-site'],
    ] as const) {
      const ajeno = await oficial.fetch(envioDelFormulario(cookie, origen, sitio), entorno);
      assert.equal(ajeno.status, ESTADO_HTTP.prohibido, origen);
    }
  } finally {
    db.close();
  }
});
