/** La Encuesta es una sección pública más: su interruptor, sus rutas y la lectura de los contratos anteriores. */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  leerDocumentoSecciones,
  politicaSeccionesInicial,
  SECCIONES_WEB,
  seccionDeLaRuta,
} from '../../src/administracion/secciones-web.js';
import * as copiaWeb from '../../web/scripts/secciones-contrato.js';

test('la Encuesta es una sección con su página y está visible en una instalación nueva', () => {
  assert.deepEqual(
    SECCIONES_WEB.find(({ id }) => id === 'encuesta'),
    { id: 'encuesta', nombre: 'Encuesta', rutas: ['/encuesta.html'] },
  );
  assert.equal(politicaSeccionesInicial().encuesta, true);
  for (const alias of ['/encuesta.html', '/encuesta', '/ENCUESTA.HTML', '/x/../encuesta.html', '/%65ncuesta.html']) {
    assert.equal(seccionDeLaRuta(alias), 'encuesta', alias);
  }
  // La invitación llega a inicio.html: esa página no es de la Encuesta y ocultarla no la cierra.
  assert.equal(seccionDeLaRuta('/inicio.html'), undefined);
});

test('el contrato v2 se lee con la Encuesta visible, sin modificar la entrada', () => {
  const { encuesta: _encuesta, ...anteriores } = { ...politicaSeccionesInicial(), biblioteca: false };
  const entrada = { version: 2, revision: 3, secciones: anteriores };
  const antes = JSON.stringify(entrada);
  const leida = leerDocumentoSecciones(entrada);
  assert.deepEqual(leida, { version: 3, revision: 3, secciones: { ...anteriores, encuesta: true } });
  assert.equal(JSON.stringify(entrada), antes);
});

test('el contrato v3 guarda el interruptor: oculta, se lee oculta; y exige la clave', () => {
  const oculta = { ...politicaSeccionesInicial(), encuesta: false };
  assert.equal(leerDocumentoSecciones({ version: 3, revision: 1, secciones: oculta }).secciones.encuesta, false);
  const { encuesta: _encuesta, ...sinEncuesta } = oculta;
  assert.throws(() => leerDocumentoSecciones({ version: 3, revision: 1, secciones: sinEncuesta }));
  assert.throws(() => leerDocumentoSecciones({ version: 2, revision: 1, secciones: oculta }));
  assert.throws(() => leerDocumentoSecciones({ version: 3, revision: 1, secciones: { ...oculta, encuesta: 'no' } }));
});

test('la copia de la página y del service worker lleva la misma sección y la misma lectura', () => {
  assert.deepEqual(copiaWeb.SECCIONES_WEB, SECCIONES_WEB);
  const oculta = { ...politicaSeccionesInicial(), encuesta: false };
  assert.deepEqual(
    copiaWeb.leerDocumentoSecciones({ version: 3, revision: 2, secciones: oculta }),
    leerDocumentoSecciones({ version: 3, revision: 2, secciones: oculta }),
  );
  assert.equal(copiaWeb.seccionDeLaRuta('/encuesta'), 'encuesta');
});
