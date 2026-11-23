// Contratos de firma adaptados de firma-respuesta-mcp y unicode-firmas, sin servidor ni claves persistentes.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { before, test } from 'node:test';
import {
  ALGORITMOS_DE_LA_RESPUESTA,
  type ClaveDeFirma,
  ClavesDeFirmaInvalidas,
  clavesDeFirmaDe,
  crearFirmadorMcp,
  type FirmadorMcp,
  firmarResultado,
  META_FIRMA,
  mensajeDeLaRespuesta,
  sobreDeLaRespuesta,
  TIPO_RESPUESTA_MCP,
} from '../../src/api/mcp/firma-de-respuesta.ts';
import { TextoJcsInvalido } from '../../src/comun/jcs.ts';
import { esObjeto } from '../../src/comun/json.ts';

/** La plataforma moderna exporta raw-public; el tipo de WebCrypto todavía no lo declara. */
interface ExportadorModerno {
  exportKey(formato: string, clave: CryptoKey): Promise<ArrayBuffer>;
}

const claves: ClaveDeFirma[] = [];
const publicas = new Map<string, CryptoKey>();
let firmador: FirmadorMcp;

// Un único par efímero por algoritmo para toda la suite. Nunca se guarda ni se imprime material de claves.
before(async () => {
  const exportador = crypto.subtle as unknown as ExportadorModerno;
  for (const algoritmo of ['ed25519', 'ml-dsa-65'] as const) {
    const { nombre, formatoDeClave } = ALGORITMOS_DE_LA_RESPUESTA[algoritmo];
    const par: unknown = await crypto.subtle.generateKey({ name: nombre }, true, ['sign', 'verify']);
    assert.ok(esObjeto(par) && par.publicKey instanceof CryptoKey && par.privateKey instanceof CryptoKey);
    publicas.set(algoritmo, par.publicKey);
    claves.push({
      algoritmo,
      publica: Buffer.from(await exportador.exportKey(formatoDeClave, par.publicKey)).toString('base64'),
      privada: Buffer.from(await exportador.exportKey('pkcs8', par.privateKey)).toString('base64'),
    });
  }
  firmador = await crearFirmadorMcp(claves);
});

/** Un resultado recibido con metadatos de firma; construir el sobre no valida sus firmas. */
function recibido(datos: unknown): Record<string, unknown> {
  return { datos, _meta: { [META_FIRMA]: { formato: 1, tipo: TIPO_RESPUESTA_MCP, firmas: [] } } };
}

test('el tipo, combinación y PAE cuentan bytes UTF8 y conservan el contenido', () => {
  assert.equal(TIPO_RESPUESTA_MCP, 'application/vnd.faro.respuesta-mcp+json');
  assert.deepEqual(ALGORITMOS_DE_LA_RESPUESTA, {
    ed25519: { nombre: 'Ed25519', formatoDeClave: 'raw', bytesDeLaClave: 32 },
    'ml-dsa-65': { nombre: 'ML-DSA-65', formatoDeClave: 'raw-public', bytesDeLaClave: 1952 },
  });
  const contenido = new TextEncoder().encode('café 😀');
  const prefijo = `DSSEv1 ${Buffer.byteLength(TIPO_RESPUESTA_MCP)} ${TIPO_RESPUESTA_MCP} ${contenido.length} `;
  assert.deepEqual(mensajeDeLaRespuesta(contenido), new Uint8Array(Buffer.concat([Buffer.from(prefijo), contenido])));
});

test('configuración vacía no firma y la combinación válida conserva sus claves', () => {
  for (const configuracion of [undefined, '', ' \t ']) {
    assert.equal(clavesDeFirmaDe(configuracion), null);
  }
  assert.deepEqual(clavesDeFirmaDe(JSON.stringify(claves)), claves);
});

test('configuración mal formada, incompleta o duplicada se rechaza sin repetir privadas', () => {
  const primera = claves[0];
  assert.ok(primera);
  for (const configuracion of [
    '{',
    '{}',
    '[null]',
    '[{"algoritmo":"ed25519"}]',
    JSON.stringify([primera]),
    JSON.stringify([primera, primera]),
  ]) {
    assert.throws(
      () => clavesDeFirmaDe(configuracion),
      (error: unknown) => error instanceof ClavesDeFirmaInvalidas && !error.message.includes(primera.privada),
    );
  }
});

test('crearFirmadorMcp exige exactamente una clave por algoritmo', async () => {
  const primera = claves[0];
  assert.ok(primera);
  for (const incompletas of [[], [primera], [primera, primera]]) {
    await assert.rejects(crearFirmadorMcp(incompletas), ClavesDeFirmaInvalidas);
  }
});

test('base64, tamaño público y privada de otro algoritmo no dejan crear el firmador', async () => {
  const ed = claves[0];
  const ml = claves[1];
  assert.ok(ed && ml);
  for (const defectuosa of [
    { ...ed, publica: '!' },
    { ...ed, publica: 'AA==' },
    { ...ed, privada: '!' },
    { ...ed, privada: ml.privada },
  ]) {
    await assert.rejects(crearFirmadorMcp([defectuosa, ml]), ClavesDeFirmaInvalidas);
  }
});

test('ids y dos firmas nativas corresponden a las públicas y rechazan contenido cambiado', async () => {
  assert.deepEqual(
    firmador.ids,
    claves.map(({ publica }) => createHash('sha256').update(Buffer.from(publica, 'base64')).digest('hex')),
  );
  const resultado = await firmarResultado({ z: ['😀', null], a: 'café e\u0301' }, firmador);
  const sobre = sobreDeLaRespuesta(resultado);
  assert.ok(sobre && Array.isArray(sobre.firmas));
  assert.deepEqual(
    sobre.firmas.map((firma) => firma.algoritmo),
    ['ed25519', 'ml-dsa-65'],
  );
  const contenido = Uint8Array.from(Buffer.from(sobre.contenido, 'base64'));
  assert.equal(new TextDecoder().decode(contenido), '{"a":"café é","z":["😀",null]}');
  for (const firma of sobre.firmas) {
    assert.ok(esObjeto(firma) && typeof firma.algoritmo === 'string' && typeof firma.firma === 'string');
    const publica = publicas.get(firma.algoritmo);
    assert.ok(publica);
    const nombre = firma.algoritmo === 'ed25519' ? 'Ed25519' : 'ML-DSA-65';
    const bytes = Uint8Array.from(Buffer.from(firma.firma, 'base64'));
    assert.equal(await crypto.subtle.verify({ name: nombre }, publica, bytes, mensajeDeLaRespuesta(contenido)), true);
    assert.equal(
      await crypto.subtle.verify(
        { name: nombre },
        publica,
        bytes,
        mensajeDeLaRespuesta(new TextEncoder().encode('{}')),
      ),
      false,
    );
  }
});

test('firmar sustituye la firma anterior, conserva otros metadatos y no muta el resultado', async () => {
  const entrada = { datos: { b: 2, a: 1 }, _meta: { servidor: 'prueba', [META_FIRMA]: 'anterior' } };
  const original = JSON.stringify(entrada);
  const resultado = await firmarResultado(entrada, firmador);
  assert.equal(JSON.stringify(entrada), original);
  assert.ok(esObjeto(resultado._meta));
  assert.equal(resultado._meta.servidor, 'prueba');
  const sobre = sobreDeLaRespuesta(resultado);
  assert.ok(sobre);
  assert.equal(
    Buffer.from(sobre.contenido, 'base64').toString('utf8'),
    '{"_meta":{"servidor":"prueba"},"datos":{"a":1,"b":2}}',
  );
});

test('un _meta vacío o con solo la firma anterior se omite del contenido firmado', async () => {
  for (const _meta of [{}, { [META_FIRMA]: 'anterior' }]) {
    const sobre = sobreDeLaRespuesta(await firmarResultado({ dato: 1, _meta }, firmador));
    assert.ok(sobre);
    assert.equal(Buffer.from(sobre.contenido, 'base64').toString('utf8'), '{"dato":1}');
  }
});

test('sin firma reconocible no hay sobre verificable', () => {
  for (const resultado of [
    null,
    'x',
    [],
    {},
    { _meta: [] },
    { _meta: { [META_FIRMA]: { formato: 2, tipo: TIPO_RESPUESTA_MCP } } },
    { _meta: { [META_FIRMA]: { formato: 1, tipo: 'otro' } } },
  ]) {
    assert.equal(sobreDeLaRespuesta(resultado), null);
  }
});

test('el sobre reconstruye contenido pero conserva las firmas para que el verificador las compruebe', () => {
  const entrada = recibido({ a: 1 });
  const sobre = sobreDeLaRespuesta(entrada);
  assert.ok(sobre);
  assert.deepEqual(sobre.firmas, []);
  assert.equal(Buffer.from(sobre.contenido, 'base64').toString('utf8'), '{"datos":{"a":1}}');
});

test('Unicode malformado no se sustituye: firmar rechaza y el lector devuelve null', async () => {
  for (const datos of [{ texto: 'a\ud800b' }, { '\udfff': true }]) {
    await assert.rejects(firmarResultado({ datos }, firmador), TextoJcsInvalido);
    assert.equal(sobreDeLaRespuesta(recibido(datos)), null);
  }
});

test('el límite de profundidad admite 32 niveles y rechaza el siguiente', () => {
  let resultado: Record<string, unknown> = {};
  const MAX_PROFUNDIDAD = 32;
  for (let nivel = 0; nivel < MAX_PROFUNDIDAD; nivel++) {
    resultado = { dentro: resultado };
  }
  const _meta = recibido(null)._meta;
  assert.notEqual(sobreDeLaRespuesta({ ...resultado, _meta }), null);
  assert.equal(sobreDeLaRespuesta({ dentro: resultado, _meta }), null);
});

test('otros TypeError y fallos de getter se propagan: solo se captura Unicode', () => {
  assert.throws(() => sobreDeLaRespuesta(recibido({ nota: Number.NaN })), TypeError);
  const fallo = new Error('getter de prueba');
  const datos = {
    get dato() {
      throw fallo;
    },
  };
  assert.throws(
    () => sobreDeLaRespuesta(recibido(datos)),
    (error: unknown) => error === fallo,
  );
});
