// JWT de Access sintéticos firmados en memoria; ninguna petición llega a Cloudflare.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IDENTIDAD_WEB } from '../../src/comun/identidad-web.ts';
import { MS_POR_MINUTO, MS_POR_SEGUNDO } from '../../src/comun/tiempo.ts';
import { cerrojoDelEntorno } from '../../src/plataforma/cloudflare/cerrojo-access.ts';

const AHORA = Date.parse('2026-10-14T10:00:00Z');
const RSA_BITS = 2048;
const ALGORITMO = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
const ENTORNO = {
  FARO_ACCESS_DECLARACION: 'pruebas-con-relatos-ficticios',
  FARO_ACCESS_EQUIPO: 'equipo-prueba',
  FARO_ACCESS_AUD: 'audiencia-sintetica',
};

/** Firma el contenido JSON literal para comprobar también números fuera del rango IEEE 754. */
async function equipo() {
  const par = await crypto.subtle.generateKey(
    { ...ALGORITMO, modulusLength: RSA_BITS, publicExponent: new Uint8Array([1, 0, 1]) },
    true,
    ['sign', 'verify'],
  );
  const publica = await crypto.subtle.exportKey('jwk', par.publicKey);
  let descargas = 0;
  const pedir: typeof fetch = async (_recurso, opciones) => {
    descargas += 1;
    assert.equal(new Headers(opciones?.headers).get('user-agent'), IDENTIDAD_WEB['User-Agent']);
    return Response.json({ keys: [{ ...publica, kid: 'sintetica' }] });
  };
  const firmar = async (contenido: string): Promise<Request> => {
    const cabecera = Buffer.from('{"alg":"RS256","kid":"sintetica"}').toString('base64url');
    const partes = `${cabecera}.${Buffer.from(contenido).toString('base64url')}`;
    const firma = await crypto.subtle.sign(ALGORITMO, par.privateKey, new TextEncoder().encode(partes));
    const token = `${partes}.${Buffer.from(firma).toString('base64url')}`;
    return new Request('https://faro.prueba/api/salud', { headers: { 'cf-access-jwt-assertion': token } });
  };
  return { pedir, firmar, descargas: () => descargas };
}

function contenido(exp: string, nbf = '0'): string {
  return `{"aud":["audiencia-sintetica"],"iss":"https://equipo-prueba.cloudflareaccess.com","exp":${exp},"nbf":${nbf}}`;
}

test('Access rechaza fechas no finitas incluso con firma válida y conserva JWT vigente y caché', async () => {
  const doble = await equipo();
  const cerrojo = cerrojoDelEntorno(ENTORNO, doble.pedir, () => AHORA);
  assert.ok(cerrojo);
  assert.equal(await cerrojo(await doble.firmar(contenido('1e400'))), false);
  assert.equal(await cerrojo(await doble.firmar(contenido('2000000000', '-1e400'))), false);
  assert.equal(await cerrojo(await doble.firmar(contenido('2000000000'))), true);
  assert.equal(await cerrojo(await doble.firmar(contenido('2000000000'))), true);
  assert.equal(doble.descargas(), 1);
});

test('Access exige equipo y audiencia solo con declaración de pruebas', () => {
  assert.equal(cerrojoDelEntorno({ FARO_ACCESS_DECLARACION: 'si' }), null);
  assert.throws(() => cerrojoDelEntorno({ ...ENTORNO, FARO_ACCESS_EQUIPO: '' }), /FARO_ACCESS_EQUIPO/);
});

test('Access no autoriza con claves vencidas tras una renovación fallida y recupera al renovar', async () => {
  const doble = await equipo();
  let ahora = AHORA;
  let falla = false;
  let intentos = 0;
  const pedir: typeof fetch = async (recurso, opciones) => {
    intentos += 1;
    if (falla) {
      throw new Error('Servicio de claves sintético no disponible');
    }
    return doble.pedir(recurso, opciones);
  };
  const cerrojo = cerrojoDelEntorno(ENTORNO, pedir, () => ahora);
  assert.ok(cerrojo);
  const vigente = await doble.firmar(contenido('2000000000'));
  const observadas: { etapa: string; admitida: boolean; intentos: number }[] = [];
  const observar = async (etapa: string, peticion: Request = vigente): Promise<void> => {
    observadas.push({ etapa, admitida: await cerrojo(peticion), intentos });
  };
  await observar('carga inicial');
  await observar('caché vigente');
  ahora += 60 * MS_POR_MINUTO;
  falla = true;
  await observar('renovación fallida');
  ahora += 1;
  await observar('claves vencidas durante el freno de descarga');
  ahora += MS_POR_MINUTO;
  falla = false;
  await observar('renovación correcta');
  await observar('JWT caducado', await doble.firmar(contenido(String(Math.floor(ahora / MS_POR_SEGUNDO) - 1))));
  await observar(
    'JWT aún no vigente',
    await doble.firmar(contenido('2000000000', String(Math.floor(ahora / MS_POR_SEGUNDO) + 1))),
  );
  assert.deepEqual(observadas, [
    { etapa: 'carga inicial', admitida: true, intentos: 1 },
    { etapa: 'caché vigente', admitida: true, intentos: 1 },
    { etapa: 'renovación fallida', admitida: false, intentos: 2 },
    { etapa: 'claves vencidas durante el freno de descarga', admitida: false, intentos: 2 },
    { etapa: 'renovación correcta', admitida: true, intentos: 3 },
    { etapa: 'JWT caducado', admitida: false, intentos: 3 },
    { etapa: 'JWT aún no vigente', admitida: false, intentos: 3 },
  ]);
});

test('la declaración retirada no abre la API al dejar de reconocerse', () => {
  assert.throws(
    () => cerrojoDelEntorno({ CEREBRO_DECLARACION_DE_LA_CLAVE: 'pruebas-con-relatos-ficticios' }),
    /perfil de servicio contiene opciones no admitidas/u,
  );
});
