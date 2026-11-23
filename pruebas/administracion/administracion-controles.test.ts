import assert from 'node:assert/strict';
import test from 'node:test';
import {
  esRevisionControles,
  leerDocumentoControles,
  leerPoliticaControles,
  type PoliticaControles,
} from '../../src/administracion/controles.ts';

const REVISION_FRACCIONARIA = 0.5;
const politica = (): PoliticaControles => ({
  version: 2,
  api: 'deshabilitada',
  mcp: false,
  a2a: false,
});

test('controles acepta modos exactos, copia propia y revisión segura hasta el máximo', () => {
  const entrada = { ...politica(), revision: Number.MAX_SAFE_INTEGER };
  const copia = leerDocumentoControles(entrada);
  assert.deepEqual(copia, entrada);
  assert.notEqual(copia, entrada);
  assert.deepEqual(leerPoliticaControles(politica()), politica());
  for (const api of ['deshabilitada', 'habilitada']) {
    assert.equal(leerPoliticaControles({ ...politica(), api }).api, api);
  }
  assert.equal(esRevisionControles(0), true);
  assert.equal(esRevisionControles(Number.MAX_SAFE_INTEGER), true);
});

test('controles rechaza formas, campos ajenos y valores sin normalización', () => {
  const base = { ...politica(), revision: 0 };
  const invalidos: unknown[] = [null, [], true, 'json', { ...base, secreto: 'privado' }, { ...base, url: 'https://x' }];
  for (const campo of Object.keys(base)) {
    const incompleto: Record<string, unknown> = { ...base };
    delete incompleto[campo];
    invalidos.push(incompleto);
  }
  for (const revision of [-1, REVISION_FRACCIONARIA, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '0', null]) {
    invalidos.push({ ...base, revision });
    assert.equal(esRevisionControles(revision), false);
  }
  for (const valor of [0, 1, 'false', null, undefined]) {
    invalidos.push({ ...base, mcp: valor }, { ...base, a2a: valor });
    invalidos.push({ ...base, permisosIa: { api: valor } });
  }
  invalidos.push(
    { ...base, version: 1 },
    { ...base, version: 3 },
    { ...base, api: 'abierta' },
    { ...base, api: 'habilitada-altas-cerradas' },
    { ...base, api: 'habilitada-altas-abiertas' },
  );
  invalidos.push({ ...base, permisosIa: { proveedor: 'x' } });
  for (const entrada of invalidos) {
    assert.throws(() => leerDocumentoControles(entrada));
  }
  assert.throws(() => leerPoliticaControles(base));
});

test('controles no ejecuta accesores ni coerciones y rechaza herencia, símbolos y no enumerables', () => {
  let llamadas = 0;
  const base = { ...politica(), revision: 0 };
  const accesor = { ...base };
  Object.defineProperty(accesor, 'mcp', { enumerable: true, get: () => ++llamadas });
  const oculto = { ...base };
  Object.defineProperty(oculto, 'api', { enumerable: false, value: 'deshabilitada' });
  const api = { toString: () => ++llamadas };
  const permiso = {};
  Object.defineProperty(permiso, 'api', { enumerable: true, get: () => ++llamadas });
  for (const entrada of [
    accesor,
    oculto,
    Object.create(base),
    { ...base, [Symbol('extra')]: true },
    { ...base, api },
    { ...base, permisosIa: permiso },
  ]) {
    assert.throws(() => leerDocumentoControles(entrada));
  }
  assert.equal(llamadas, 0);
  assert.deepEqual(leerDocumentoControles(Object.assign(Object.create(null), base)), base);
});
