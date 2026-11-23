/** Siembra, segundo factor y sincronización con Access: valores válidos, ilegibles y fuera de sus techos. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_ADMINISTRADORES_INICIALES } from '../../src/administracion/administradores.ts';
import { configuracionAdministrativaDelEntorno } from '../../src/administracion/configuracion.ts';
import {
  administradoresInicialesDelEntorno,
  configuracionAdministradoresDelEntorno,
  segundoFactorExigidoDelEntorno,
  sincronizacionDelEntorno,
} from '../../src/administracion/configuracion-administradores.ts';

/** Más que diez correos completos: el texto se rechaza por su largo antes de leerlo. */
const LARGO_DESMEDIDO = 3000;
/** El secreto de firma mínimo del panel. */
const LARGO_SECRETO = 32;
const CUENTA = '0123456789abcdef0123456789abcdef';
const GRUPO = '01234567-89ab-cdef-0123-456789abcdef';
const TOKEN = 'token_sintetico-de-prueba-con-longitud-sobrada';
const SINCRONIZACION = {
  FARO_ADMIN_ACCESS_CUENTA: CUENTA,
  FARO_ADMIN_ACCESS_GRUPO: GRUPO,
  FARO_ADMIN_ACCESS_TOKEN: TOKEN,
};

test('siembra: ausente o vacía no siembra; correos válidos en minúsculas y sin espacios alrededor', () => {
  assert.deepEqual(administradoresInicialesDelEntorno({}), []);
  assert.deepEqual(administradoresInicialesDelEntorno({ FARO_ADMINISTRADORES_INICIALES: '  ' }), []);
  assert.deepEqual(
    administradoresInicialesDelEntorno({
      FARO_ADMINISTRADORES_INICIALES: ' Ana@Citilab.Invalid , berta@citilab.invalid',
    }),
    ['ana@citilab.invalid', 'berta@citilab.invalid'],
  );
});

test('siembra: un correo ilegible, repetido o más de los que caben detiene el panel en vez de corregirse', () => {
  const demasiados = Array.from({ length: MAX_ADMINISTRADORES_INICIALES + 1 }, (_, n) => `p${n}@citilab.invalid`);
  for (const valor of [
    'ana@citilab.invalid,sin-arroba',
    'ana@citilab.invalid,,berta@citilab.invalid',
    'ana@citilab.invalid,ANA@citilab.invalid',
    'con espacio@citilab.invalid',
    demasiados.join(','),
    `${'a'.repeat(LARGO_DESMEDIDO)}@citilab.invalid`,
  ]) {
    assert.throws(() => administradoresInicialesDelEntorno({ FARO_ADMINISTRADORES_INICIALES: valor }), /hasta 10/);
  }
});

test('segundo factor: por defecto no; si o no; cualquier otro valor detiene el panel', () => {
  assert.equal(segundoFactorExigidoDelEntorno({}), false);
  assert.equal(segundoFactorExigidoDelEntorno({ FARO_ADMIN_EXIGIR_MFA: 'no' }), false);
  assert.equal(segundoFactorExigidoDelEntorno({ FARO_ADMIN_EXIGIR_MFA: 'si' }), true);
  for (const valor of ['sí', 'SI', 'true', '1', '']) {
    assert.throws(() => segundoFactorExigidoDelEntorno({ FARO_ADMIN_EXIGIR_MFA: valor }), /admite si o no/);
  }
});

test('sincronización: configurada con las tres; sin alguna dice cuáles faltan; mal escrita detiene el panel', () => {
  assert.deepEqual(sincronizacionDelEntorno(SINCRONIZACION), {
    estado: 'configurada',
    destino: { cuenta: CUENTA, grupo: GRUPO, token: TOKEN },
  });
  assert.deepEqual(sincronizacionDelEntorno({ FARO_ADMIN_ACCESS_CUENTA: CUENTA }), {
    estado: 'sin-configurar',
    falta: ['FARO_ADMIN_ACCESS_GRUPO', 'FARO_ADMIN_ACCESS_TOKEN'],
  });
  for (const [nombre, valor] of [
    ['FARO_ADMIN_ACCESS_CUENTA', 'CUENTA-EN-MAYUSCULAS'],
    ['FARO_ADMIN_ACCESS_GRUPO', 'no-es-un-uuid'],
    ['FARO_ADMIN_ACCESS_TOKEN', 'corto'],
  ] as const) {
    assert.throws(() => sincronizacionDelEntorno({ ...SINCRONIZACION, [nombre]: valor }), new RegExp(nombre));
  }
});

test('la configuración del panel lleva la de la lista, sin el token a la vista', () => {
  const variables = {
    FARO_ADMINISTRACION: 'si',
    FARO_SECRETO_FIRMA: 'x'.repeat(LARGO_SECRETO),
    FARO_ADMIN_ORIGEN: 'https://faro.prueba',
    FARO_ADMINISTRADORES_INICIALES: 'ana@citilab.invalid',
    ...SINCRONIZACION,
  };
  const configuracion = configuracionAdministrativaDelEntorno(variables);
  assert.deepEqual(configuracion?.administradores?.siembra, ['ana@citilab.invalid']);
  assert.deepEqual(configuracion?.administradores?.sincronizacion, { estado: 'configurada' });
  assert.equal(JSON.stringify(configuracion).includes(TOKEN), false);
  const sinNube = configuracionAdministradoresDelEntorno({});
  assert.equal(sinNube.grupo, undefined);
  assert.equal(sinNube.sincronizacion.estado, 'sin-configurar');
});
