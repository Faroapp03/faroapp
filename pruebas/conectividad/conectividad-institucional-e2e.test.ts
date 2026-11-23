/** HTTP real Node y entrada Worker real: instituciones y claves sintéticas, datos factuales del paquete local. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { leerPaginaAccesosRecibida } from '../../src/administracion/accesos.ts';
import {
  ID_INSTITUCION,
  leerRegistroInstituciones,
  type RegistroInstituciones,
} from '../../src/administracion/instituciones.ts';
import { CABECERA_CONTRATO, CONTRATO_API } from '../../src/api/metadatos-http.ts';
import {
  RUTA_ACTIVAR_INVITACION,
  RUTA_CONSULTAR_INVITACION,
  RUTA_CONSULTAS,
  RUTA_INTROSPECCION,
  RUTA_REVOCAR,
  RUTA_TOKEN,
} from '../../src/api/socios/metadatos.ts';
import { esObjeto } from '../../src/comun/json.ts';
import { type ServidorConectividadPrueba, servidorConectividadPrueba } from '../ayudas/conectividad-servidores.ts';

const OK = 200,
  NO_AUTORIZADA = 401,
  AUSENTE = 404,
  CONFLICTO = 409,
  AGOTADA = 410;
const TAM_SECRETO = 32;
const RUTA_REGISTRO_RETIRADA = '/api/socios/v1/registro';
interface Clave {
  readonly client_id: string;
  readonly client_secret: string;
}
async function objeto(respuesta: Response) {
  const cuerpo: unknown = await respuesta.json();
  assert(esObjeto(cuerpo));
  return cuerpo;
}
async function abrir(s: ServidorConectividadPrueba): Promise<string> {
  const r = await s.panel('sesion/abrir');
  assert.equal(r.status, OK);
  const cuerpo = await objeto(r);
  assert(typeof cuerpo.token === 'string');
  return cuerpo.token;
}
async function registro(s: ServidorConectividadPrueba, token: string): Promise<RegistroInstituciones> {
  const r = await s.panel('instituciones/leer', {}, token);
  assert.equal(r.status, OK);
  return leerRegistroInstituciones((await objeto(r)).registro);
}
async function invitar(
  s: ServidorConectividadPrueba,
  token: string,
  renovar?: { id: string; revisionEsperada: number },
): Promise<string> {
  const r = await s.panel(
    `instituciones/${renovar ? 'renovar' : 'invitar'}`,
    renovar ?? { revisionEsperada: 0, nombre: 'Institución sintética E2E', correo: null },
    token,
  );
  assert.equal(r.status, OK);
  const cuerpo = await objeto(r);
  assert(esObjeto(cuerpo.invitacion) && typeof cuerpo.invitacion.enlaceRelativo === 'string');
  const enlace = new URL(cuerpo.invitacion.enlaceRelativo, s.origen);
  assert.equal(enlace.pathname, '/activar-acceso.html');
  assert.equal(enlace.search, '');
  return enlace.hash.slice('#invitacion='.length);
}
function invitacion(s: ServidorConectividadPrueba, ruta: string, secreto: string): Promise<Response> {
  return s.pedir(ruta, {
    method: 'POST',
    headers: { origin: s.origen, 'content-type': 'application/json', [CABECERA_CONTRATO]: String(CONTRATO_API) },
    body: JSON.stringify({ invitacion: secreto }),
  });
}
async function claveRecibida(r: Response): Promise<Clave> {
  assert.equal(r.status, OK);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  const cuerpo = await objeto(r);
  assert(typeof cuerpo.client_id === 'string' && ID_INSTITUCION.test(cuerpo.client_id));
  assert(typeof cuerpo.client_secret === 'string');
  const bytes = Buffer.from(cuerpo.client_secret, 'base64url');
  assert.equal(bytes.byteLength, TAM_SECRETO);
  assert.equal(bytes.toString('base64url'), cuerpo.client_secret);
  assert.equal(cuerpo.token_endpoint, RUTA_TOKEN);
  assert.equal(cuerpo.token_type, 'Bearer');
  return { client_id: cuerpo.client_id, client_secret: cuerpo.client_secret };
}
async function activar(s: ServidorConectividadPrueba, secreto: string): Promise<Clave> {
  return claveRecibida(await invitacion(s, RUTA_ACTIVAR_INVITACION, secreto));
}
function sinSecretos(s: ServidorConectividadPrueba, secretos: readonly string[]): void {
  const persistido = JSON.stringify([
    ...s.filas('instituciones_invitaciones'),
    ...s.filas('instituciones_claves'),
    ...s.filas('administracion_sesion'),
    ...s.filas('conectividad_uso'),
  ]);
  for (const secreto of secretos) {
    assert(!persistido.includes(secreto));
  }
}
function oauth(
  s: ServidorConectividadPrueba,
  clave: Clave,
  ruta = RUTA_TOKEN,
  parametros: Record<string, string> = { grant_type: 'client_credentials' },
): Promise<Response> {
  return s.pedir(ruta, {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`${clave.client_id}:${clave.client_secret}`).toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(parametros),
  });
}
async function token(s: ServidorConectividadPrueba, clave: Clave): Promise<string> {
  const r = await oauth(s, clave);
  assert.equal(r.status, OK);
  const cuerpo = await objeto(r);
  assert(typeof cuerpo.access_token === 'string');
  return cuerpo.access_token;
}
async function ficha(s: ServidorConectividadPrueba, bearer: string) {
  const r = await s.pedir(`${RUTA_CONSULTAS}/ficha_grupo?isco=4224`, {
    headers: { authorization: `Bearer ${bearer}` },
  });
  assert.equal(r.status, OK);
  const cuerpo = await objeto(r);
  assert.equal(cuerpo.isco08, '4224');
  assert(typeof cuerpo.titulo === 'string' && cuerpo.titulo.length > 0);
  assert(Array.isArray(cuerpo.tareas) && cuerpo.tareas.length > 0);
  assert(Object.hasOwn(cuerpo, 'procedencia'));
  return cuerpo;
}
async function retirada(s: ServidorConectividadPrueba, bearer: string): Promise<void> {
  assert.equal(
    (await s.pedir(`${RUTA_CONSULTAS}/ficha_grupo?isco=4224`, { headers: { authorization: `Bearer ${bearer}` } }))
      .status,
    NO_AUTORIZADA,
  );
}
for (const modo of ['Node', 'Worker'] as const) {
  // biome-ignore lint/complexity/noExcessiveLinesPerFunction: ciclo completo de una institución con relevo y revocación, sin reiniciar su autoridad.
  test(`${modo}: invitación→clave→token→ficha factual→Accesos; relevo y retirada invalidan los tokens de la clave exacta`, async (t) => {
    const s = await servidorConectividadPrueba(t, modo, true);
    try {
      const sesion = await abrir(s),
        enlace = await invitar(s, sesion);
      for (let i = 0; i < 2; i++) {
        const previa = await invitacion(s, RUTA_CONSULTAR_INVITACION, enlace);
        assert.equal(previa.status, OK);
        assert(!Object.hasOwn(await objeto(previa), 'client_secret'));
      }
      const primera = await activar(s, enlace),
        bearerPrimero = await token(s, primera),
        original = await ficha(s, bearerPrimero);
      sinSecretos(s, [enlace.split('.')[1] ?? '', primera.client_secret, bearerPrimero, sesion]);
      const marcador = 'NO-GUARDAR-PARAMETROS-DE-CONSULTA';
      const invalida = await s.pedir(`${RUTA_CONSULTAS}/ficha_grupo?isco=4224&secreto=${marcador}`, {
        headers: { authorization: `Bearer ${bearerPrimero}` },
      });
      const HTTP_SOLICITUD_INCORRECTA = 400;
      assert.equal(invalida.status, HTTP_SOLICITUD_INCORRECTA);
      assert(!(await invalida.text()).includes(marcador));
      assert(!JSON.stringify(s.filas('conectividad_uso')).includes(marcador));
      assert.equal((await invitacion(s, RUTA_ACTIVAR_INVITACION, enlace)).status, AGOTADA);
      const inicial = await registro(s, sesion),
        clavePrimera = inicial.instituciones[0]?.claves[0]?.id;
      assert(clavePrimera);
      const nuevaInvitacion = await invitar(s, sesion, { id: primera.client_id, revisionEsperada: inicial.revision });
      const segunda = await activar(s, nuevaInvitacion),
        bearerSegundo = await token(s, segunda);
      assert.deepEqual(await ficha(s, bearerSegundo), original);
      assert.deepEqual(await ficha(s, bearerPrimero), original);
      const dos = await registro(s, sesion);
      assert.equal(dos.instituciones[0]?.claves.length, 2);
      sinSecretos(s, [primera.client_secret, segunda.client_secret, bearerPrimero, bearerSegundo, sesion]);
      const exceso = await s.panel(
        'instituciones/renovar',
        { id: primera.client_id, revisionEsperada: dos.revision },
        sesion,
      );
      assert.equal(exceso.status, CONFLICTO);
      assert.deepEqual(await exceso.json(), { error: 'dos_claves_activas' });
      const quitar = await s.panel(
        'instituciones/retirar-clave',
        { id: primera.client_id, claveId: clavePrimera, revisionEsperada: dos.revision },
        sesion,
      );
      assert.equal(quitar.status, OK);
      await retirada(s, bearerPrimero);
      assert.equal((await oauth(s, primera)).status, NO_AUTORIZADA);
      assert.deepEqual(await ficha(s, bearerSegundo), original);
      const introspeccion = await oauth(s, segunda, RUTA_INTROSPECCION, { token: bearerPrimero });
      assert.equal(introspeccion.status, OK);
      assert.deepEqual(await introspeccion.json(), { active: false });
      assert.equal((await oauth(s, segunda, RUTA_REVOCAR, { token: bearerSegundo })).status, OK);
      await retirada(s, bearerSegundo);
      const tercero = await token(s, segunda);
      await ficha(s, tercero);
      const ultimo = await registro(s, sesion);
      assert.equal(
        (await s.panel('instituciones/retirar', { id: primera.client_id, revisionEsperada: ultimo.revision }, sesion))
          .status,
        OK,
      );
      await retirada(s, tercero);
      assert.equal((await oauth(s, segunda)).status, NO_AUTORIZADA);
      const respuesta = await s.panel('accesos/leer', { pagina: 1 }, sesion);
      assert.equal(respuesta.status, OK);
      const accesos = leerPaginaAccesosRecibida((await objeto(respuesta)).accesos);
      assert(
        accesos.api.length > 0 &&
          accesos.api.every(
            (a) =>
              a.institucionId === primera.client_id &&
              a.consulta === 'ficha_grupo' &&
              (a.estadoHttp === OK || a.estadoHttp === HTTP_SOLICITUD_INCORRECTA),
          ),
      );
      assert(accesos.api.some((a) => a.estadoHttp === HTTP_SOLICITUD_INCORRECTA));
      sinSecretos(s, [primera.client_secret, segunda.client_secret, bearerPrimero, bearerSegundo, tercero, sesion]);
      assert.equal((await s.pedir(RUTA_REGISTRO_RETIRADA)).status, AUSENTE);
    } finally {
      await s.cerrar();
    }
  });
  test(`${modo}: dos activaciones concurrentes producen exactamente una clave y el enlace no se recupera`, async (t) => {
    const s = await servidorConectividadPrueba(t, modo, true);
    try {
      const sesion = await abrir(s),
        enlace = await invitar(s, sesion);
      const respuestas = await Promise.all([
        invitacion(s, RUTA_ACTIVAR_INVITACION, enlace),
        invitacion(s, RUTA_ACTIVAR_INVITACION, enlace),
      ]);
      assert.deepEqual(respuestas.map((r) => r.status).sort(), [OK, AGOTADA]);
      const fallo = respuestas.find((r) => r.status === AGOTADA);
      assert(fallo);
      assert.deepEqual(await fallo.json(), { error: 'invitacion_no_disponible' });
      const ganadora = respuestas.find((r) => r.status === OK);
      assert(ganadora);
      const clave = await claveRecibida(ganadora);
      await ficha(s, await token(s, clave));
      assert.equal((await registro(s, sesion)).instituciones[0]?.claves.length, 1);
      assert.equal(s.filas('instituciones_claves').length, 1);
      assert.equal((await invitacion(s, RUTA_CONSULTAR_INVITACION, enlace)).status, AGOTADA);
    } finally {
      await s.cerrar();
    }
  });
  test(`${modo}: apagado con autoridad válida da 404 también en OAuth; volver a activar no consume el enlace apagado`, async (t) => {
    const s = await servidorConectividadPrueba(t, modo, false);
    try {
      const sesion = await abrir(s),
        enlace = await invitar(s, sesion);
      for (const ruta of [
        RUTA_TOKEN,
        RUTA_REVOCAR,
        RUTA_INTROSPECCION,
        RUTA_ACTIVAR_INVITACION,
        RUTA_CONSULTAR_INVITACION,
        `${RUTA_CONSULTAS}/ficha_grupo?isco=4224`,
      ]) {
        assert.equal((await s.pedir(ruta)).status, AUSENTE);
      }
      assert.equal((await invitacion(s, RUTA_ACTIVAR_INVITACION, enlace)).status, AUSENTE);
      assert.equal(s.filas('instituciones_invitaciones')[0]?.consumida, 0);
      const cambio = await s.panel(
        'controles/cambiar',
        { revisionEsperada: 0, politica: { version: 2, api: 'habilitada', mcp: false, a2a: false } },
        sesion,
      );
      assert.equal(cambio.status, OK);
      const clave = await activar(s, enlace);
      await ficha(s, await token(s, clave));
    } finally {
      await s.cerrar();
    }
  });
}
