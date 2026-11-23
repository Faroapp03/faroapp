import assert from 'node:assert/strict';
import test from 'node:test';
import { leerDocumentoSecciones, politicaSeccionesInicial } from '../../src/administracion/secciones-web.js';

const REVISION_LEGADA = 7;
const VERSION_SECCIONES = 3;

test('secciones v1 conservan permisos y Cursos cerrado sin modificar la entrada', () => {
  const { cursos: _curso, encuesta: _encuesta, ...legadas } = politicaSeccionesInicial();
  const entrada = { version: 1, revision: REVISION_LEGADA, secciones: legadas };
  const antes = JSON.stringify(entrada);
  const leida = leerDocumentoSecciones(entrada);
  assert.equal(leida.version, VERSION_SECCIONES);
  assert.equal(leida.revision, REVISION_LEGADA);
  assert.deepEqual(leida.secciones, { ...legadas, cursos: false, encuesta: true });
  assert.equal(JSON.stringify(entrada), antes);
});

test('documento v3 abre Cursos en instalación nueva y conserva el apagado explícito', () => {
  const nueva = politicaSeccionesInicial();
  assert.equal(Reflect.get(nueva, 'cursos'), true);
  assert.deepEqual(leerDocumentoSecciones({ version: 3, revision: 0, secciones: nueva }).secciones, nueva);
  const desactivada = { ...nueva, cursos: false };
  const antes = JSON.stringify(desactivada);
  assert.equal(leerDocumentoSecciones({ version: 3, revision: 1, secciones: desactivada }).secciones.cursos, false);
  assert.equal(JSON.stringify(desactivada), antes);
  assert.throws(() => leerDocumentoSecciones({ version: 1, revision: 0, secciones: nueva }));
  const { cursos: _curso, ...sinCursos } = nueva;
  assert.throws(() => leerDocumentoSecciones({ version: 3, revision: 0, secciones: sinCursos }));
  assert.throws(() => leerDocumentoSecciones({ version: 4, revision: 0, secciones: nueva }));
});
