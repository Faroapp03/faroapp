import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cargarCatalogo } from '../../src/catalogo-cursos/carga.ts';
import { cargarCompanero } from '../../src/seleccion-formacion/carga.ts';
import { consultarConectividad } from '../../web/scripts/conectividad/estado.js';
import { crearActivacion } from '../../web/scripts/conectividad/invitacion.js';

const LONGITUD_SHA = 64;
const LONGITUD_SECRETO = 43;
const sha = 'a'.repeat(LONGITUD_SHA);
const base = new URL('https://ejemplo.invalid/');
const fin = new Error('petición observada');
function comprobar(peticion: Request): never {
  assert.equal(peticion.credentials, 'same-origin');
  assert.equal(peticion.mode, 'same-origin');
  assert.equal(peticion.redirect, 'error');
  throw fin;
}
test('el catálogo permite Basic únicamente en el mismo origen', async () => {
  await assert.rejects(
    cargarCatalogo(
      { sha256: sha, revision: sha, bytes: 1, ruta: `datos/catalogo-cursos/${sha}.json` },
      base,
      async (p) => comprobar(p),
    ),
    (e) => e === fin,
  );
});
test('el aprendizaje permite Basic únicamente en el mismo origen', async () => {
  const publicacion = { sha256: sha, bytes: 1, ruta: `datos/catalogo-aprendizaje/${sha}.json` };
  await assert.rejects(
    cargarCompanero(publicacion, {} as never, base, async (p) => comprobar(p)),
    (e) => e === fin,
  );
});
test('el estado permite Basic únicamente en el mismo origen', async () => {
  let llamada = false;
  await assert.rejects(
    consultarConectividad({
      pedir: (async (_url, opciones) => {
        llamada = true;
        assert.equal(opciones?.credentials, 'same-origin');
        assert.equal(opciones?.mode, 'same-origin');
        throw fin;
      }) as typeof fetch,
      enLinea: () => true,
    }),
    (e) => e === fin,
  );
  assert.ok(llamada);
});
test('la invitación permite Basic únicamente en el mismo origen', async () => {
  let llamada = false;
  const flujo = crearActivacion({
    invitacion: `00000000-0000-4000-8000-000000000000.${'A'.repeat(LONGITUD_SECRETO)}`,
    alCambiar: () => {},
    pedir: (async (_url, opciones) => {
      llamada = true;
      assert.equal(opciones?.credentials, 'same-origin');
      assert.equal(opciones?.mode, 'same-origin');
      throw fin;
    }) as typeof fetch,
  });
  await assert.rejects(flujo.consultar(), (e) => e === fin);
  assert.ok(llamada);
});
