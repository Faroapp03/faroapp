/** OAuth y cuotas institucionales: contrato actual, capacidad explícita y ausencia de la ruta retirada. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { crearApi } from '../../src/api/api.ts';
import { RUTA_TOKEN } from '../../src/api/socios/metadatos.ts';
import { huellaDelSecreto } from '../../src/api/socios/registro.ts';
import { cargarDatos } from '../../src/plataforma/node/datos.ts';
import { SociosDePrueba } from '../ayudas/socios-api.ts';

const ORIGEN = 'https://publico.test';
const FIRMA = 'firma-sintetica-estable-de-mas-de-treinta-y-dos-caracteres';
const SECRETO = 'secreto-sintetico-de-institucion';
const ID = 'inst-11111111-1111-4111-8111-111111111111';
const datos = cargarDatos(fileURLToPath(new URL('../../datos/', import.meta.url)));
const OK = 200,
  INVALIDA = 400,
  AUSENTE = 404,
  CUOTA = 429,
  NO_DISPONIBLE = 503;
const TOKENS_HORA = 20;
function token(scope = 'faro.lectura') {
  return new Request(`${ORIGEN}${RUTA_TOKEN}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${btoa(`${ID}:${SECRETO}`)}`,
    },
    body: new URLSearchParams({ grant_type: 'client_credentials', scope }),
  });
}
async function preparar() {
  const capacidades = new SociosDePrueba();
  capacidades.socios.set(ID, { id: ID, huellas: [huellaDelSecreto(SECRETO)], consultasPorHora: 1 });
  const crear = () =>
    crearApi({
      datos,
      origenesPermitidos: [],
      seguridad: { secretoFirma: FIRMA },
      administracion: {
        leerControles: async () => ({ version: 2, revision: 0, api: 'habilitada', mcp: false, a2a: false }),
        socios: capacidades.opciones(),
        registrarAcceso: async (uso) => {
          capacidades.usos.push(uso);
        },
      },
    });
  return { capacidades, uno: await crear(), dos: await crear() };
}
test('OAuth entre dos servidores conserva ámbitos, cuotas UTC exactas y registro mínimo', async () => {
  const { uno, dos } = await preparar();
  const respuesta = await uno(token());
  assert.equal(respuesta.status, OK);
  const emitido = (await respuesta.json()) as { access_token: string; scope: string };
  assert.equal(emitido.scope, 'faro.lectura');
  for (const scope of ['faro.ia.mcp', 'faro.ia.a2a', 'faro.ia.api']) {
    assert.equal((await dos(token(scope))).status, INVALIDA);
  }
  const consultar = () =>
    dos(
      new Request(`${ORIGEN}/api/socios/v1/consultas/explorar_grupos?padre=4`, {
        headers: { authorization: `Bearer ${emitido.access_token}` },
      }),
    );
  assert.equal((await consultar()).status, OK);
  const cuota = await consultar();
  assert.equal(cuota.status, CUOTA);
  assert.equal(
    ((await cuota.json()) as { detail: string }).detail,
    'Este socio ha agotado sus consultas de la hora UTC actual.',
  );
  for (let n = 1; n < TOKENS_HORA; n++) {
    assert.equal((await uno(token())).status, OK);
  }
  const tokens = await dos(token());
  assert.equal(tokens.status, CUOTA);
  assert.equal(
    ((await tokens.json()) as { detail: string }).detail,
    'Esta institución ha pedido demasiados tokens en la hora UTC actual: reutiliza el que tiene.',
  );
});
test('fallo institucional no se sustituye por registro local ni revela su causa; alta antigua no existe', async () => {
  const { uno, capacidades } = await preparar();
  capacidades.fallo = true;
  const respuesta = await uno(token());
  assert.equal(respuesta.status, NO_DISPONIBLE);
  assert.doesNotMatch(await respuesta.text(), /Fallo sintético/);
  for (const method of ['GET', 'POST', 'DELETE']) {
    assert.equal((await uno(new Request(`${ORIGEN}/api/socios/v1/registro`, { method }))).status, AUSENTE);
  }
});
