// JWT y JWK sintéticos en memoria: ninguna prueba llama a Cloudflare ni necesita secretos.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { VariablesDelEntorno } from '../../src/comun/entorno.ts';
import { IDENTIDAD_WEB } from '../../src/comun/identidad-web.ts';
import { MS_POR_MINUTO, MS_POR_SEGUNDO } from '../../src/comun/tiempo.ts';
import { guardiaAdministrativaDelEntorno, SegundoFactorRequerido } from '../../src/plataforma/acceso-administrativo.ts';
import { cerrojoDelEntorno } from '../../src/plataforma/cloudflare/cerrojo-access.ts';

const AHORA = Date.parse('2026-10-14T10:00:00Z');
const RSA_BITS = 2048;
const SEGUNDOS_DE_MARGEN = 10;
const INTENTOS_TRAS_RECUPERAR = 3;
const ALGORITMO = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
const EMISOR = 'https://equipo-prueba.cloudflareaccess.com';
const ENTORNO = {
  FARO_ADMIN_ACCESS_EQUIPO: 'equipo-prueba',
  FARO_ADMIN_ACCESS_AUD: 'administracion-sintetica',
  FARO_ACCESS_AUD: 'consulta-sintetica',
};
const CLAIMS = {
  aud: [ENTORNO.FARO_ADMIN_ACCESS_AUD],
  iss: EMISOR,
  exp: AHORA / MS_POR_SEGUNDO + SEGUNDOS_DE_MARGEN,
  sub: 'persona-sintetica',
  type: 'app',
  email: 'Persona-Sintetica@Faro.Invalid',
  iat: Math.floor(AHORA / MS_POR_SEGUNDO) - SEGUNDOS_DE_MARGEN,
};
/** Lo que entrega la guardia: identidad estable, correo verificado en minúsculas, instante de emisión y segundo factor. */
const PRINCIPAL = {
  emisor: EMISOR,
  sujeto: CLAIMS.sub,
  correo: 'persona-sintetica@faro.invalid',
  emitidoEn: CLAIMS.iat,
  segundoFactor: false,
};

async function equipo() {
  const par = await crypto.subtle.generateKey(
    { ...ALGORITMO, modulusLength: RSA_BITS, publicExponent: new Uint8Array([1, 0, 1]) },
    true,
    ['sign', 'verify'],
  );
  const publica = await crypto.subtle.exportKey('jwk', par.publicKey);
  const firmar = async (claims: Record<string, unknown> = CLAIMS, alg = 'RS256', kid = 'sintetica') => {
    const cabecera = Buffer.from(JSON.stringify({ alg, kid })).toString('base64url');
    const partes = `${cabecera}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}`;
    const firma = await crypto.subtle.sign(ALGORITMO, par.privateKey, new TextEncoder().encode(partes));
    return new Request('https://faro.prueba/administracion', {
      headers: { 'cf-access-jwt-assertion': `${partes}.${Buffer.from(firma).toString('base64url')}` },
    });
  };
  let descargas = 0;
  const pedir: typeof fetch = async (recurso, opciones) => {
    assert.equal(String(recurso), `${EMISOR}/cdn-cgi/access/certs`);
    assert.equal(new Headers(opciones?.headers).get('user-agent'), IDENTIDAD_WEB['User-Agent']);
    descargas += 1;
    return Response.json({ keys: [{ ...publica, kid: 'sintetica' }] });
  };
  return { firmar, pedir, descargas: () => descargas };
}

const sintetico = equipo();

test('Admin exige configuración propia independiente de la declaración pública', async () => {
  const doble = await sintetico;
  const perfiles: VariablesDelEntorno[] = [
    {},
    { FARO_ACCESS_DECLARACION: 'si' },
    { FARO_ACCESS_DECLARACION: 'pruebas-con-relatos-ficticios' },
  ];
  for (const perfil of perfiles) {
    assert.throws(() => guardiaAdministrativaDelEntorno(perfil), /FARO_ADMIN_ACCESS/);
    const guardia = guardiaAdministrativaDelEntorno({ ...perfil, ...ENTORNO }, doble.pedir, () => AHORA);
    assert.equal(typeof guardia, 'function');
    assert.deepEqual(await guardia(await doble.firmar()), PRINCIPAL);
    assert.equal(await guardia(new Request('http://localhost/administracion')), null);
  }
});

test('Admin rechaza configuración incompleta o ambigua sin reflejar valores en errores', () => {
  const defectuosas = [
    { FARO_ADMIN_ACCESS_EQUIPO: '' },
    { FARO_ADMIN_ACCESS_EQUIPO: 'https://equipo-prueba.cloudflareaccess.com/ajena' },
    { FARO_ADMIN_ACCESS_EQUIPO: 'equipo-prueba.cloudflareaccess.com.ajena' },
    { FARO_ADMIN_ACCESS_EQUIPO: '-equipo' },
    { FARO_ADMIN_ACCESS_EQUIPO: ' equipo-prueba' },
    { FARO_ADMIN_ACCESS_EQUIPO: 'equipo-prueba\n' },
    { FARO_ADMIN_ACCESS_AUD: '' },
    { FARO_ADMIN_ACCESS_AUD: ' audiencia' },
    { FARO_ADMIN_ACCESS_AUD: 'audiencia\n' },
    { FARO_ACCESS_AUD: ` ${ENTORNO.FARO_ADMIN_ACCESS_AUD} ` },
  ];
  for (const defectuosa of defectuosas) {
    assert.throws(() => guardiaAdministrativaDelEntorno({ ...ENTORNO, ...defectuosa }), /FARO_ADMIN_ACCESS/);
  }
  assert.throws(
    () => guardiaAdministrativaDelEntorno({ ...ENTORNO, FARO_ADMIN_ACCESS_EQUIPO: 'NO-REFLEJAR-SECRETO' }),
    (error: unknown) => error instanceof Error && !error.message.includes('NO-REFLEJAR-SECRETO'),
  );
});

test('Admin produce el principal solo desde claims verificadas: correo del JWT, nunca de cabeceras', async () => {
  const doble = await sintetico;
  const guardia = guardiaAdministrativaDelEntorno(ENTORNO, doble.pedir, () => AHORA);
  const peticion = await doble.firmar({ ...CLAIMS, email: 'Del-JWT@Prueba.Invalid' });
  peticion.headers.set('cf-access-authenticated-user-email', 'falso@prueba.invalid');
  const principal = await guardia(peticion);
  assert.deepEqual(principal, { ...PRINCIPAL, correo: 'del-jwt@prueba.invalid' });
  assert.equal(Object.isFrozen(principal), true);
  for (const email of [undefined, null, '', 'sin arroba', 'dos@@arrobas', 'con espacio@prueba.invalid', 1]) {
    assert.deepEqual(await guardia(await doble.firmar({ ...CLAIMS, email })), { ...PRINCIPAL, correo: null });
  }
  for (const iat of [undefined, '1', -1, Number.MIN_VALUE]) {
    assert.deepEqual(await guardia(await doble.firmar({ ...CLAIMS, iat })), { ...PRINCIPAL, emitidoEn: null });
  }
  const sinIdentidad = [undefined, null, '', ' ', ' persona', 'persona\n', 1, {}];
  for (const sub of sinIdentidad) {
    assert.equal(await guardia(await doble.firmar({ ...CLAIMS, sub, email: 'no-basta@prueba.invalid' })), null);
  }
});

test('Admin deniega audiencias, emisor y tiempos incorrectos aun con firma válida', async () => {
  const doble = await sintetico;
  const guardia = guardiaAdministrativaDelEntorno(ENTORNO, doble.pedir, () => AHORA);
  const invalidas: Record<string, unknown>[] = [
    { aud: [ENTORNO.FARO_ACCESS_AUD] },
    { aud: ['otra-aplicacion'] },
    { aud: [ENTORNO.FARO_ADMIN_ACCESS_AUD, 1] },
    { iss: 'https://otro-equipo.cloudflareaccess.com' },
    { exp: AHORA / MS_POR_SEGUNDO },
    { exp: '2000000000' },
    { exp: Number.MAX_VALUE },
    { nbf: AHORA / MS_POR_SEGUNDO + 1 },
    { nbf: '0' },
    { nbf: -Number.MAX_VALUE },
    { type: undefined },
    { type: 'org' },
    { common_name: 'servicio-sintetico' },
    { common_name: '' },
    { common_name: null },
  ];
  for (const invalida of invalidas) {
    assert.equal(await guardia(await doble.firmar({ ...CLAIMS, ...invalida })), null);
  }
  assert.deepEqual(await guardia(await doble.firmar({ ...CLAIMS, nbf: AHORA / MS_POR_SEGUNDO })), PRINCIPAL);
});

test('Admin deniega firma ajena, JWT manipulado, algoritmo distinto y credenciales de consulta', async () => {
  const doble = await sintetico;
  const ajeno = await equipo();
  const guardia = guardiaAdministrativaDelEntorno(ENTORNO, doble.pedir, () => AHORA);
  assert.equal(await guardia(await ajeno.firmar()), null);
  assert.equal(await guardia(await doble.firmar(CLAIMS, 'HS256')), null);
  const manipulado = await doble.firmar();
  const token = manipulado.headers.get('cf-access-jwt-assertion') ?? '';
  manipulado.headers.set('cf-access-jwt-assertion', token.replace(/\.[^.]+\./, '.e30.'));
  assert.equal(await guardia(manipulado), null);
  for (const headers of [
    { authorization: 'Bearer token-oauth-solo-lectura' },
    { 'x-api-key': 'token-estatico' },
    { 'cf-access-authenticated-user-email': 'administrador@prueba.invalid' },
    { 'cf-access-jwt-assertion': 'token-estatico' },
  ]) {
    assert.equal(await guardia(new Request('http://localhost/administracion', { headers })), null);
  }
});

test('Admin conserva TTL, freno tras fallo, recuperación y vuelo único por aplicación', async () => {
  const doble = await equipo();
  let ahora = AHORA;
  let falla = false;
  let intentos = 0;
  const pedir: typeof fetch = async (recurso, opciones) => {
    intentos += 1;
    if (falla) {
      throw new Error('NO-REFLEJAR-SECRETO');
    }
    return doble.pedir(recurso, opciones);
  };
  const guardia = guardiaAdministrativaDelEntorno(ENTORNO, pedir, () => ahora);
  const peticion = await doble.firmar({ ...CLAIMS, exp: 2000000000 });
  const principal = PRINCIPAL;
  assert.deepEqual(await Promise.all([guardia(peticion), guardia(peticion), guardia(peticion)]), [
    principal,
    principal,
    principal,
  ]);
  assert.equal(intentos, 1);
  ahora += 60 * MS_POR_MINUTO;
  falla = true;
  assert.equal(await guardia(peticion), null);
  assert.equal(intentos, 2);
  ahora += 1;
  assert.equal(await guardia(peticion), null);
  assert.equal(intentos, 2);
  ahora += MS_POR_MINUTO;
  falla = false;
  assert.deepEqual(await guardia(peticion), principal);
  assert.equal(intentos, INTENTOS_TRAS_RECUPERAR);
});

test('Caché admin no comparte audiencia ni emisor con otra guardia o el cerrojo público', async () => {
  const doble = await equipo();
  const admin = guardiaAdministrativaDelEntorno(ENTORNO, doble.pedir, () => AHORA);
  const otra = guardiaAdministrativaDelEntorno(
    { ...ENTORNO, FARO_ADMIN_ACCESS_AUD: 'otra-administracion' },
    doble.pedir,
    () => AHORA,
  );
  const publico = cerrojoDelEntorno(
    {
      ...ENTORNO,
      FARO_ACCESS_DECLARACION: 'pruebas-con-relatos-ficticios',
      FARO_ACCESS_EQUIPO: 'equipo-prueba',
    },
    doble.pedir,
    () => AHORA,
  );
  assert.ok(publico);
  assert.ok(await admin(await doble.firmar()));
  assert.equal(await otra(await doble.firmar()), null);
  assert.equal(await publico(await doble.firmar()), false);
  const consulta = await doble.firmar({ ...CLAIMS, aud: [ENTORNO.FARO_ACCESS_AUD] });
  assert.equal(await publico(consulta), true);
  assert.equal(await admin(consulta), null);
  assert.equal(doble.descargas(), 2);
});

test('Admin comprueba vigencia otra vez tras esperar las claves', async () => {
  const doble = await equipo();
  let ahora = AHORA;
  const pedir: typeof fetch = async (recurso, opciones) => {
    ahora += SEGUNDOS_DE_MARGEN * MS_POR_SEGUNDO;
    return doble.pedir(recurso, opciones);
  };
  const guardia = guardiaAdministrativaDelEntorno(ENTORNO, pedir, () => ahora);
  assert.equal(await guardia(await doble.firmar()), null);
  assert.equal(doble.descargas(), 1);
});

test('Admin liga la caché al emisor y configuración iniciales', async () => {
  const doble = await equipo();
  const env = { ...ENTORNO };
  const primera = guardiaAdministrativaDelEntorno(env, doble.pedir, () => AHORA);
  env.FARO_ADMIN_ACCESS_AUD = 'audiencia-modificada';
  env.FARO_ADMIN_ACCESS_EQUIPO = 'otro-equipo';
  assert.ok(await primera(await doble.firmar()));
  let descargasOtroEmisor = 0;
  const pedir: typeof fetch = async (recurso, opciones) => {
    descargasOtroEmisor += 1;
    assert.equal(String(recurso), 'https://otro-equipo.cloudflareaccess.com/cdn-cgi/access/certs');
    return doble.pedir(`${EMISOR}/cdn-cgi/access/certs`, opciones);
  };
  const segunda = guardiaAdministrativaDelEntorno(env, pedir, () => AHORA);
  assert.equal(await segunda(await doble.firmar()), null);
  assert.equal(descargasOtroEmisor, 0);
  const otro = await doble.firmar({
    ...CLAIMS,
    aud: [env.FARO_ADMIN_ACCESS_AUD],
    iss: 'https://otro-equipo.cloudflareaccess.com',
  });
  assert.ok(await segunda(otro));
  assert.equal(descargasOtroEmisor, 1);
  assert.equal(await primera(otro), null);
});

test('Admin conserva claves vigentes y frena kid desconocido hasta la siguiente descarga', async () => {
  const doble = await equipo();
  let ahora = AHORA;
  const guardia = guardiaAdministrativaDelEntorno(ENTORNO, doble.pedir, () => ahora);
  const valido = await doble.firmar({ ...CLAIMS, exp: 2000000000 });
  assert.ok(await guardia(valido));
  const desconocido = await doble.firmar({ ...CLAIMS, exp: 2000000000 }, 'RS256', 'otra-clave');
  assert.equal(await guardia(desconocido), null);
  assert.equal(doble.descargas(), 1);
  assert.ok(await guardia(valido));
  ahora += MS_POR_MINUTO;
  assert.equal(await guardia(desconocido), null);
  assert.equal(doble.descargas(), 2);
  assert.ok(await guardia(valido));
  assert.equal(doble.descargas(), 2);
});

test('Admin deniega fallo de claves sin copiar errores externos ni tokens al registro', async (contexto) => {
  const doble = await sintetico;
  const avisos = contexto.mock.method(console, 'warn', () => {});
  const pedir: typeof fetch = async () => {
    throw new Error('NO-REFLEJAR-SECRETO');
  };
  const guardia = guardiaAdministrativaDelEntorno(ENTORNO, pedir, () => AHORA);
  assert.equal(await guardia(await doble.firmar()), null);
  assert.deepEqual(
    avisos.mock.calls.map((llamada) => llamada.arguments),
    [['No se ha podido completar la verificación de Cloudflare Access: la petición no pasa']],
  );
});

test('Admin con FARO_ADMIN_EXIGIR_MFA=si exige en amr un segundo factor; apagada, solo lo anota', async () => {
  const doble = await sintetico;
  const exigente = guardiaAdministrativaDelEntorno(
    { ...ENTORNO, FARO_ADMIN_EXIGIR_MFA: 'si' },
    doble.pedir,
    () => AHORA,
  );
  const apagada = guardiaAdministrativaDelEntorno(ENTORNO, doble.pedir, () => AHORA);
  for (const amr of [['pwd', 'otp'], ['hwk'], ['swk'], ['mfa'], ['fpt']]) {
    assert.deepEqual(await exigente(await doble.firmar({ ...CLAIMS, amr })), { ...PRINCIPAL, segundoFactor: true });
    assert.deepEqual(await apagada(await doble.firmar({ ...CLAIMS, amr })), { ...PRINCIPAL, segundoFactor: true });
  }
  for (const amr of [undefined, [], ['pwd'], 'otp', [1], [{ metodo: 'otp' }]]) {
    await assert.rejects(exigente(await doble.firmar({ ...CLAIMS, amr })), SegundoFactorRequerido);
    assert.deepEqual(await apagada(await doble.firmar({ ...CLAIMS, amr })), PRINCIPAL);
  }
  assert.throws(
    () => guardiaAdministrativaDelEntorno({ ...ENTORNO, FARO_ADMIN_EXIGIR_MFA: 'sí' }, doble.pedir),
    /FARO_ADMIN_EXIGIR_MFA admite si o no/,
  );
});
