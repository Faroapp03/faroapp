import assert from 'node:assert/strict';
import { test } from 'node:test';
import { leerRegistroInstituciones, leerSecretoInvitacion } from '../../src/administracion/instituciones.ts';
import { huellaDelSecreto } from '../../src/api/socios/registro.ts';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { esObjeto } from '../../src/comun/json.ts';
import { ORIGEN_CONECTIVIDAD, panelInstitucional } from '../ayudas/conectividad.ts';

type Panel = Awaited<ReturnType<typeof panelInstitucional>>;
async function objeto(respuesta: Response) {
  const valor: unknown = await respuesta.json();
  assert(esObjeto(valor));
  return valor;
}
async function abrir(p: Panel): Promise<string> {
  const r = await p.panel.responder(p.peticion('sesion/abrir'));
  assert.equal(r.status, ESTADO_HTTP.correcto);
  const cuerpo = await objeto(r);
  assert.equal(typeof cuerpo.token, 'string');
  assert(typeof cuerpo.token === 'string');
  return cuerpo.token;
}
async function crear(p: Panel, token: string, revisionEsperada = 0, nombre = 'Institución sintética') {
  const respuesta = await p.panel.responder(
    p.peticion('instituciones/invitar', { revisionEsperada, nombre, correo: null }, token),
  );
  assert.equal(respuesta.status, ESTADO_HTTP.correcto);
  assert.equal(respuesta.headers.get('cache-control'), 'no-store');
  const cuerpo = await objeto(respuesta),
    registro = leerRegistroInstituciones(cuerpo.registro);
  assert.equal(cuerpo.estado, 'activa');
  assert(esObjeto(cuerpo.invitacion) && typeof cuerpo.invitacion.enlaceRelativo === 'string');
  const enlace = new URL(cuerpo.invitacion.enlaceRelativo, ORIGEN_CONECTIVIDAD);
  assert.equal(enlace.origin, ORIGEN_CONECTIVIDAD);
  assert.equal(enlace.pathname, '/activar-acceso.html');
  assert.equal(enlace.search, '');
  const secreto = leerSecretoInvitacion({ invitacion: enlace.hash.slice('#invitacion='.length) });
  return { cuerpo, registro, enlace, secreto, respuesta };
}
for (const modo of ['Node', 'binding'] as const) {
  test(`${modo}: rutas Access del panel generan enlace una vez, leen sin secretos y renuevan sin devolver enlace antiguo`, async () => {
    const p = await panelInstitucional(modo);
    try {
      const token = await abrir(p),
        primera = await crear(p, token);
      const fila = p.filas('SELECT * FROM instituciones_invitaciones')[0];
      assert.equal(fila?.huella, huellaDelSecreto(primera.secreto.secreto));
      assert(!JSON.stringify(p.filas('SELECT * FROM instituciones_invitaciones')).includes(primera.secreto.secreto));
      const leida = await p.panel.responder(p.peticion('instituciones/leer', {}, token));
      assert.equal(leida.status, ESTADO_HTTP.correcto);
      const cuerpo = await objeto(leida);
      assert(!Object.hasOwn(cuerpo, 'invitacion'));
      assert(!JSON.stringify(cuerpo).includes(primera.secreto.secreto));
      const id = primera.registro.instituciones[0]?.id;
      assert(id);
      const r = await p.panel.responder(p.peticion('instituciones/renovar', { revisionEsperada: 1, id }, token));
      assert.equal(r.status, ESTADO_HTTP.correcto);
      const renovada = await objeto(r);
      assert(esObjeto(renovada.invitacion));
      assert.notEqual(renovada.invitacion.enlaceRelativo, `${primera.enlace.pathname}${primera.enlace.hash}`);
      assert.equal(
        await p.instituciones.consultarInvitacion({
          id: primera.secreto.id,
          huella: huellaDelSecreto(primera.secreto.secreto),
        }),
        null,
      );
      const retirada = await p.panel.responder(p.peticion('instituciones/retirar', { revisionEsperada: 2, id }, token));
      assert.equal(retirada.status, ESTADO_HTTP.correcto);
      assert.equal(leerRegistroInstituciones((await objeto(retirada)).registro).instituciones[0]?.estado, 'retirada');
    } finally {
      p.cerrar();
    }
  });
  test(`${modo}: Access, sesión y CSRF siguen obligatorios en las cinco rutas; CAS no devuelve secreto nuevo`, async () => {
    const p = await panelInstitucional(modo);
    try {
      const token = await abrir(p);
      for (const ruta of ['leer', 'invitar', 'renovar', 'retirar', 'retirar-clave']) {
        const sinAccess = p.peticion(`instituciones/${ruta}`, {}, token);
        sinAccess.headers.delete('cf-access-jwt-assertion');
        assert.equal((await p.panel.responder(sinAccess)).status, ESTADO_HTTP.prohibido);
        assert.equal((await p.panel.responder(p.peticion(`instituciones/${ruta}`))).status, ESTADO_HTTP.prohibido);
        const csrf = p.peticion(`instituciones/${ruta}`, {}, token);
        csrf.headers.set('origin', 'https://otra.invalid');
        assert.equal((await p.panel.responder(csrf)).status, ESTADO_HTTP.prohibido);
      }
      await crear(p, token);
      const conflicto = await p.panel.responder(
        p.peticion('instituciones/invitar', { revisionEsperada: 0, nombre: 'Otra entidad', correo: null }, token),
      );
      assert.equal(conflicto.status, ESTADO_HTTP.conflicto);
      assert.deepEqual(await conflicto.json(), { error: 'revision_desactualizada' });
      assert.equal(p.filas('SELECT * FROM instituciones').length, 1);
      const incorrecta = await p.panel.responder(
        p.peticion(
          'instituciones/invitar',
          { revisionEsperada: 1, nombre: 'Entidad', correo: null, extra: true },
          token,
        ),
      );
      assert.equal(incorrecta.status, ESTADO_HTTP.solicitudIncorrecta);
      assert.deepEqual(await incorrecta.json(), { error: 'solicitud_invalida' });
    } finally {
      p.cerrar();
    }
  });
  test(`${modo}: respuestas institucionales dañadas son 503 sin valores privados; la lectura no recrea tablas`, async () => {
    const p = await panelInstitucional(modo);
    try {
      const token = await abrir(p);
      await crear(p, token);
      p.ejecutar('DROP TABLE instituciones_claves');
      const respuesta = await p.panel.responder(p.peticion('instituciones/leer', {}, token));
      assert.equal(respuesta.status, ESTADO_HTTP.noDisponible);
      assert.equal(respuesta.headers.get('cache-control'), 'no-store');
      assert.deepEqual(await respuesta.json(), { error: 'no_disponible' });
      assert.deepEqual(p.filas("SELECT name FROM sqlite_master WHERE name='instituciones_claves'"), []);
    } finally {
      p.cerrar();
    }
  });
}
