// Cada lectura que rechaza una entrada mal formada captura solo el error de esa forma (URIError, SyntaxError, el de
// atob o el del descodificador estricto) y la rechaza en cerrado; cualquier otro fallo sale tal cual y no se confunde
// con una entrada inválida.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { leerCuerpoJson } from '../../src/api/cuerpo.ts';
import { SolicitudInvalida } from '../../src/api/errores.ts';
import { ClavesDeFirmaInvalidas, clavesDeFirmaDe } from '../../src/api/mcp/firma-de-respuesta.ts';
import { ErrorMcp, valorDeCabecera } from '../../src/api/mcp/protocolo.ts';
import { leerJson } from '../../src/api/mcp/servidor-mcp.ts';
import { crearEmisorDeTokens } from '../../src/api/socios/token-de-acceso.ts';
import { esRutaAdministrativa } from '../../src/plataforma/administracion.ts';
import { huellasPorPeriodo } from '../../src/plataforma/cloudflare/limite-recorrido.ts';
import { crearVerificadorJwtRs256 } from '../../src/seguridad/jwt-rs256.ts';
import { MAX_CUERPO_BYTES } from '../../src/seguridad/limites.ts';

/** Un fallo que no es de la forma de la entrada: el que tiene que salir sin taparse. */
class FalloAjeno extends Error {}
const lanzarAjeno = () => {
  throw new FalloAjeno('fallo ajeno a la entrada');
};
const SECRETO = 'clave-sintetica-de-al-menos-32-bytes-para-pruebas';
const CARACTERES_HUELLA = 64;
/** Un anidamiento que cabe, en base64url, en los 2048 caracteres de un token. */
const PROFUNDIDAD_DEL_TOKEN = 700;

function conCuerpo(cuerpo: string): Request {
  return new Request('https://capturas.test/', { method: 'POST', body: cuerpo });
}

test('una ruta mal codificada se reserva sin decodificar; otro fallo al decodificarla no se oculta', (t) => {
  assert.equal(esRutaAdministrativa('/Administracion/%'), true);
  t.mock.method(globalThis, 'decodeURIComponent', lanzarAjeno);
  assert.throws(() => esRutaAdministrativa('/administracion'), FalloAjeno);
});

test('un cuerpo que no es JSON es una solicitud inválida; otro fallo al leerlo no se oculta', async (t) => {
  await assert.rejects(leerCuerpoJson(conCuerpo('{'), { type: 'object' }, 'no vale'), SolicitudInvalida);
  await assert.rejects(leerJson(conCuerpo('{')), ErrorMcp);
  t.mock.method(JSON, 'parse', lanzarAjeno);
  await assert.rejects(leerCuerpoJson(conCuerpo('{}'), { type: 'object' }, 'no vale'), FalloAjeno);
  await assert.rejects(leerJson(conCuerpo('{}')), FalloAjeno);
});

test('unas claves de firma que no son JSON no valen; otro fallo al leerlas no se oculta', (t) => {
  assert.throws(() => clavesDeFirmaDe('{'), ClavesDeFirmaInvalidas);
  t.mock.method(JSON, 'parse', lanzarAjeno);
  assert.throws(() => clavesDeFirmaDe('[]'), FalloAjeno);
});

test('una cabecera MCP que no es Base64 ni UTF-8 no vale; otro fallo al leerla no se oculta', (t) => {
  assert.equal(valorDeCabecera('=?base64?A?='), null);
  assert.equal(valorDeCabecera(`=?base64?${btoa('\xff')}?=`), null);
  t.mock.method(globalThis, 'atob', lanzarAjeno);
  assert.throws(() => valorDeCabecera('=?base64?QQ==?='), FalloAjeno);
});

test('una IPv6 mal escrita deja el límite fuera de servicio; otro fallo al leerla no se oculta', async (t) => {
  const peticion = new Request('https://capturas.test/', { headers: { 'cf-connecting-ip': '1::2::3' } });
  await assert.rejects(huellasPorPeriodo(peticion, SECRETO, 0), /Límite de recorrido no disponible/u);
  class UrlQueFalla {
    constructor() {
      lanzarAjeno();
    }
  }
  t.mock.property(globalThis, 'URL', UrlQueFalla as unknown as typeof URL);
  await assert.rejects(huellasPorPeriodo(peticion, SECRETO, 0), FalloAjeno);
});

test('un token cuya cabecera no es JSON ni UTF-8 no vale; otro fallo al leerla no se oculta', async (t) => {
  const emisor = await crearEmisorDeTokens(SECRETO, undefined);
  const destino = { emisor: 'https://capturas.test/api/socios/v1', audiencia: 'https://capturas.test/api/socios/v1/x' };
  const parte = (texto: string) => Buffer.from(texto, 'latin1').toString('base64url');
  assert.equal(await emisor.comprobar(`${parte('{')}.${parte('{}')}.${parte('x')}`, destino), null);
  assert.equal(await emisor.comprobar(`${parte('\xff')}.${parte('{}')}.${parte('x')}`, destino), null);
  t.mock.method(JSON, 'parse', lanzarAjeno);
  await assert.rejects(emisor.comprobar(`${parte('{}')}.${parte('{}')}.${parte('x')}`, destino), FalloAjeno);
});

test('un emisor de tokens que no es una URL no vale; otro fallo al leerlo no se oculta', async (t) => {
  const emisor = await crearEmisorDeTokens(SECRETO, undefined);
  const credencial = 'a'.repeat(CARACTERES_HUELLA);
  const autenticado = { socio: { id: 'inst-sintetica', huellas: [credencial], consultasPorHora: 1 }, credencial };
  const destino = { emisor: 'no es una URL', audiencia: 'tampoco' };
  await assert.rejects(emisor.emitir(autenticado, destino), /No se puede emitir/u);
  class UrlQueFalla {
    constructor() {
      lanzarAjeno();
    }
  }
  t.mock.property(globalThis, 'URL', UrlQueFalla as unknown as typeof URL);
  await assert.rejects(emisor.emitir(autenticado, destino), FalloAjeno);
});

test('un JWT cuya cabecera no es JSON no vale; otro fallo al leerla no se oculta', async (t) => {
  const verificar = crearVerificadorJwtRs256(
    { emisor: 'https://emisor.test', audiencia: 'faro', urlClaves: 'https://emisor.test/claves' },
    () => assert.fail('La prueba no pide claves'),
    () => 0,
  );
  const parte = (texto: string) => Buffer.from(texto).toString('base64url');
  assert.equal(await verificar(`${parte('{')}.${parte('{}')}.${parte('x')}`), null);
  t.mock.method(JSON, 'parse', lanzarAjeno);
  await assert.rejects(verificar(`${parte('{}')}.${parte('{}')}.${parte('x')}`), FalloAjeno);
});

test('el anidamiento máximo que cabe en un cuerpo o en un token termina en el rechazo controlado', async () => {
  // V8 lee JSON sin recursión: ni el cuerpo más profundo que admite la API lanza RangeError.
  const profundidad = MAX_CUERPO_BYTES / 2;
  const anidado = `${'['.repeat(profundidad)}${']'.repeat(profundidad)}`;
  assert.equal(new TextEncoder().encode(anidado).byteLength, MAX_CUERPO_BYTES);
  await assert.rejects(leerCuerpoJson(conCuerpo(anidado), { type: 'object' }, 'no vale'), SolicitudInvalida);
  const emisor = await crearEmisorDeTokens(SECRETO, undefined);
  const destino = { emisor: 'https://capturas.test/api/socios/v1', audiencia: 'https://capturas.test/api/socios/v1/x' };
  const parte = Buffer.from('['.repeat(PROFUNDIDAD_DEL_TOKEN) + ']'.repeat(PROFUNDIDAD_DEL_TOKEN)).toString(
    'base64url',
  );
  assert.equal(await emisor.comprobar(`${parte}.e30.eA`, destino), null);
});
