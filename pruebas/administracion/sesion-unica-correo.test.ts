import assert from 'node:assert/strict';
import test from 'node:test';
import {
  esCorreoVerificado,
  FILAS_LECTURA_REGISTRO_PANEL,
  type FilaRegistroPanel,
  leerRegistroPanel,
  MAX_RESPUESTA_REGISTRO_PANEL,
  TIPOS_REGISTRO_PANEL,
} from '../../src/administracion/sesion-unica.ts';

const CORREO_MAX_BYTES = 254;
const bytes = (texto: string) => new TextEncoder().encode(texto).byteLength;
/** El correo más largo admitido: 254 bytes con la arroba y un dominio de una letra. */
const CORREO_MAS_LARGO = `${'a'.repeat(CORREO_MAX_BYTES - '@b'.length)}@b`;

test('el correo admite las formas reales que entrega Access, también dominios internacionales en punycode', () => {
  for (const correo of ['ana@faro.invalid', 'ana.garcia+panel@faro.invalid', "o'neil@faro.invalid"]) {
    assert.equal(esCorreoVerificado(correo), true, correo);
  }
  assert.equal(esCorreoVerificado('ana@xn--espaa-rta.es'), true);
  assert.equal(esCorreoVerificado(CORREO_MAS_LARGO), true);
});

test('el correo rechaza comillas, barra invertida, formatos que falsean cómo se ve, espacios y no ASCII', () => {
  const rechazados = [
    '"ana"@faro.invalid',
    'ana\\@faro.invalid',
    'ana‮plan@faro.invalid',
    'ana​@faro.invalid',
    'ana⁦@faro.invalid',
    'ana garcia@faro.invalid',
    'ana @faro.invalid',
    'ana\t@faro.invalid',
    'añá@faro.invalid',
    'ana@españa.es',
    'ana@faro..invalid',
    'ana@-faro.invalid',
    'ana@@faro.invalid',
    '@faro.invalid',
    'ana@',
  ];
  for (const correo of rechazados) {
    assert.equal(esCorreoVerificado(correo), false, JSON.stringify(correo));
  }
});

test('la longitud del correo se mide en bytes, no en caracteres', () => {
  assert.equal(esCorreoVerificado(`a${CORREO_MAS_LARGO}`), false);
  const conAcentos = `${'é'.repeat(CORREO_MAX_BYTES / 2)}@b`;
  assert.ok(conAcentos.length <= CORREO_MAX_BYTES && bytes(conAcentos) > CORREO_MAX_BYTES);
  assert.equal(esCorreoVerificado(conAcentos), false);
});

test('la cota de la respuesta del registro es el JSON, en bytes UTF-8, de cien filas de la mayor longitud posible', () => {
  const fila: FilaRegistroPanel = {
    instante: Number.MAX_SAFE_INTEGER,
    // El tipo de nombre más largo de la lista, sea cual sea.
    tipo: [...TIPOS_REGISTRO_PANEL].sort((a, b) => b.length - a.length)[0] ?? 'entrada',
    correo: CORREO_MAS_LARGO,
    idEntrada: 'E-00000000',
    idSesion: 'S-00000000',
    motivo: 'inactividad',
    titular: CORREO_MAS_LARGO,
  };
  const filas = Array.from({ length: FILAS_LECTURA_REGISTRO_PANEL }, () => fila);
  assert.deepEqual(leerRegistroPanel(filas), filas);
  assert.equal(bytes(JSON.stringify(filas)), MAX_RESPUESTA_REGISTRO_PANEL);
});
