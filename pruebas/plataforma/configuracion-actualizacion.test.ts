import assert from 'node:assert/strict';
import test from 'node:test';
import {
  configuracionActualizacionDelEntorno,
  configuracionActualizacionDiferida,
} from '../../src/administracion/configuracion-actualizacion.ts';

const ORIGEN = 'https://panel.example';
const TAM_SHA = 40;
const CONFIGURACION_EXCESIVA = 8193;
const TOKEN_EXCESIVO = 4097;
const CONFIGURACION = {
  version: 1,
  destino: { propietario: 'entidad', repositorio: 'herramienta', workflow: 'actualizar.yml', ref: 'main' },
  confianza: {
    audiencia: `${ORIGEN}/mantenimiento/resultado`,
    repositorioId: '101',
    propietarioId: '102',
    ref: 'refs/heads/main',
    workflowRef: 'entidad/herramienta/.github/workflows/actualizar.yml@refs/heads/main',
    workflowSha: 'a'.repeat(TAM_SHA),
    sha: 'b'.repeat(TAM_SHA),
  },
};
const TOKEN = 'secreto-sintetico-del-ejecutor';
const entorno = (configuracion: unknown = CONFIGURACION, token: string = TOKEN) => ({
  FARO_ACTUALIZACION_GITHUB: JSON.stringify(configuracion),
  FARO_ACTUALIZACION_GITHUB_TOKEN: token,
});

test('sin configuración no prepara actualización ni utiliza un secreto residual', () => {
  assert.equal(configuracionActualizacionDelEntorno({}, ORIGEN), undefined);
  assert.equal(configuracionActualizacionDelEntorno({ FARO_ACTUALIZACION_GITHUB_TOKEN: TOKEN }, ORIGEN), undefined);
});
test('destino y confianza quedan coherentes; el secreto solo se obtiene en servidor', async () => {
  const variables = entorno();
  const resultado = configuracionActualizacionDelEntorno(variables, ORIGEN);
  assert.ok(resultado);
  variables.FARO_ACTUALIZACION_GITHUB_TOKEN = 'otro';
  assert.equal(await resultado.obtenerToken(), TOKEN);
  assert.equal(JSON.stringify(resultado).includes(TOKEN), false);
  assert.deepEqual(resultado.destino, CONFIGURACION.destino);
  assert.deepEqual(resultado.confianza, CONFIGURACION.confianza);
  assert.equal(Object.isFrozen(resultado), true);
});
test('la capacidad diferida conserva su configuración y rechaza errores solo cuando se utiliza', async () => {
  assert.equal(configuracionActualizacionDiferida({}, ORIGEN), undefined);
  const variables = entorno();
  const obtener = configuracionActualizacionDiferida(variables, ORIGEN);
  assert.ok(obtener);
  variables.FARO_ACTUALIZACION_GITHUB = '{';
  variables.FARO_ACTUALIZACION_GITHUB_TOKEN = 'otro';
  assert.equal(await obtener().obtenerToken(), TOKEN);
  assert.deepEqual(obtener().destino, CONFIGURACION.destino);
  const invalida = configuracionActualizacionDiferida(variables, ORIGEN);
  assert.ok(invalida);
  assert.throws(invalida, /Configuración de actualización GitHub no válida/);
});
test('ningún destino puede mezclarse con la identidad o audiencia de otra configuración', () => {
  for (const cambio of [
    { audiencia: 'https://otra.example/mantenimiento/resultado' },
    { ref: 'refs/heads/otra' },
    { workflowRef: 'entidad/otro/.github/workflows/actualizar.yml@refs/heads/main' },
    { workflowRef: 'entidad/herramienta/.github/workflows/otro.yml@refs/heads/main' },
    { repositorioId: 'cualquier' },
    { propietarioId: '0' },
    { sha: 'main' },
  ]) {
    assert.throws(() =>
      configuracionActualizacionDelEntorno(
        entorno({
          ...CONFIGURACION,
          confianza: { ...CONFIGURACION.confianza, ...cambio },
        }),
        ORIGEN,
      ),
    );
  }
});
test('configuración incompleta, secreta en JSON o mal formada no habilita envíos', () => {
  const invalidas: unknown[] = [
    null,
    [],
    {},
    { ...CONFIGURACION, version: 2 },
    { ...CONFIGURACION, token: TOKEN },
    { ...CONFIGURACION, destino: { ...CONFIGURACION.destino, comando: 'libre' } },
    { ...CONFIGURACION, destino: { ...CONFIGURACION.destino, workflow: '../otro.yml' } },
    { ...CONFIGURACION, destino: { ...CONFIGURACION.destino, ref: 'x.lock' } },
  ];
  for (const valor of invalidas) {
    assert.throws(() => configuracionActualizacionDelEntorno(entorno(valor), ORIGEN));
  }
  for (const texto of ['', '{', ' '.repeat(CONFIGURACION_EXCESIVA)]) {
    assert.throws(() =>
      configuracionActualizacionDelEntorno(
        {
          ...entorno(),
          FARO_ACTUALIZACION_GITHUB: texto,
        },
        ORIGEN,
      ),
    );
  }
  for (const token of ['', ' ', 'cabecera\r\ninterna', 'é', 'x'.repeat(TOKEN_EXCESIVO)]) {
    assert.throws(() => configuracionActualizacionDelEntorno(entorno(CONFIGURACION, token), ORIGEN));
  }
  assert.throws(() =>
    configuracionActualizacionDelEntorno(
      {
        FARO_ACTUALIZACION_GITHUB: JSON.stringify(CONFIGURACION),
      },
      ORIGEN,
    ),
  );
});
test('loopback requiere autorización explícita; una etiqueta sigue vinculada a su workflow', () => {
  const local = 'http://127.0.0.1:8787';
  const configuracion = {
    ...CONFIGURACION,
    destino: { ...CONFIGURACION.destino, ref: 'v1' },
    confianza: {
      ...CONFIGURACION.confianza,
      audiencia: `${local}/mantenimiento/resultado`,
      ref: 'refs/tags/v1',
      workflowRef: 'entidad/herramienta/.github/workflows/actualizar.yml@refs/tags/v1',
    },
  };
  assert.throws(() => configuracionActualizacionDelEntorno(entorno(configuracion), local));
  assert.equal(configuracionActualizacionDelEntorno(entorno(configuracion), local, true)?.destino.ref, 'v1');
});
