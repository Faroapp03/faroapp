/** Recorre registro privado→router Access; el E2E de consultas de los tres transportes se comprueba aparte. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  leerPaginaAccesosRecibida,
  leerResultadoAccesosSesion,
  sanearClienteDeclarado,
} from '../../src/administracion/accesos.ts';
import { leerRegistroInstituciones, leerSecretoInvitacion } from '../../src/administracion/instituciones.ts';
import { huellaDelSecreto, secretoNuevo } from '../../src/api/socios/registro.ts';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { esObjeto } from '../../src/comun/json.ts';
import { ORIGEN_CONECTIVIDAD, panelInstitucional } from '../ayudas/conectividad.ts';

const FILAS_ESPERADAS = 3;
type Panel = Awaited<ReturnType<typeof panelInstitucional>>;
async function objeto(respuesta: Response) {
  const valor: unknown = await respuesta.json();
  assert(esObjeto(valor));
  return valor;
}
async function abrir(p: Panel): Promise<string> {
  const respuesta = await p.panel.responder(p.peticion('sesion/abrir', { retomar: true }));
  assert.equal(respuesta.status, ESTADO_HTTP.correcto);
  const cuerpo = await objeto(respuesta);
  assert(typeof cuerpo.token === 'string');
  return cuerpo.token;
}
async function sembrar(p: Panel, token: string) {
  const creada = await p.panel.responder(
    p.peticion(
      'instituciones/invitar',
      { revisionEsperada: 0, nombre: 'Institución de ensayo', correo: 'administracion@example.invalid' },
      token,
    ),
  );
  assert.equal(creada.status, ESTADO_HTTP.correcto);
  const cuerpo = await objeto(creada),
    registro = leerRegistroInstituciones(cuerpo.registro),
    id = registro.instituciones[0]?.id;
  assert(id && esObjeto(cuerpo.invitacion) && typeof cuerpo.invitacion.enlaceRelativo === 'string');
  const enlace = new URL(cuerpo.invitacion.enlaceRelativo, ORIGEN_CONECTIVIDAD);
  const invitacion = leerSecretoInvitacion({ invitacion: enlace.hash.slice('#invitacion='.length) });
  const secreto = secretoNuevo(),
    huella = huellaDelSecreto(secreto);
  assert.equal(
    (
      await p.instituciones.activarInvitacion(
        { id: invitacion.id, huella: huellaDelSecreto(invitacion.secreto) },
        { id: crypto.randomUUID(), huella },
      )
    ).estado,
    'activada',
  );
  await p.accesos.registrarAcceso({
    canal: 'api',
    institucionId: id,
    credencial: huella,
    consulta: 'ficha_grupo',
    estadoHttp: ESTADO_HTTP.correcto,
  });
  for (let i = 0; i < 2; i++) {
    await p.accesos.registrarAcceso({
      canal: 'mcp',
      consulta: 'ficha_grupo',
      ...sanearClienteDeclarado('cliente-sdk'),
    });
  }
  await p.accesos.registrarAcceso({ canal: 'a2a', habilidad: 'ficha_grupo' });
  return { secreto, huella, secretoInvitacion: invitacion.secreto };
}
for (const modo of ['Node', 'binding'] as const) {
  test(`${modo}: Accesos publica solo al panel las filas paginadas y los recuentos, sin correo ni credenciales`, async () => {
    const p = await panelInstitucional(modo);
    try {
      const token = await abrir(p),
        secretos = await sembrar(p, token);
      const respuesta = await p.panel.responder(p.peticion('accesos/leer', { pagina: 1 }, token));
      assert.equal(respuesta.status, ESTADO_HTTP.correcto);
      assert.equal(respuesta.headers.get('cache-control'), 'no-store');
      assert.equal(respuesta.headers.get('access-control-allow-origin'), null);
      const cuerpo = await objeto(respuesta),
        pagina = leerPaginaAccesosRecibida(cuerpo.accesos);
      assert.equal(pagina.total, FILAS_ESPERADAS);
      assert.equal(pagina.api.length, 1);
      assert.equal(pagina.mcp.length, 1);
      assert.equal(pagina.a2a.length, 1);
      assert.equal(pagina.mcp[0]?.consultas, 2);
      assert.equal(pagina.mcp[0]?.categoriaCliente, 'declarado');
      for (const secreto of [
        secretos.secreto,
        secretos.huella,
        secretos.secretoInvitacion,
        'administracion@example.invalid',
        'arguments',
        'authorization',
      ]) {
        assert(!JSON.stringify(cuerpo).includes(secreto));
      }
    } finally {
      p.cerrar();
    }
  });
  test(`${modo}: Accesos exige Access/sesión/CSRF y página cerrada; sustituir sesión no reinicia el registro`, async () => {
    const p = await panelInstitucional(modo);
    try {
      const token = await abrir(p);
      await sembrar(p, token);
      const sinAccess = p.peticion('accesos/leer', { pagina: 1 }, token);
      sinAccess.headers.delete('cf-access-jwt-assertion');
      assert.equal((await p.panel.responder(sinAccess)).status, ESTADO_HTTP.prohibido);
      assert.equal((await p.panel.responder(p.peticion('accesos/leer', { pagina: 1 }))).status, ESTADO_HTTP.prohibido);
      const csrf = p.peticion('accesos/leer', { pagina: 1 }, token);
      csrf.headers.delete('x-faro-panel');
      assert.equal((await p.panel.responder(csrf)).status, ESTADO_HTTP.prohibido);
      for (const cuerpo of [{}, { pagina: 0 }, { pagina: 1, extra: true }]) {
        assert.equal(
          (await p.panel.responder(p.peticion('accesos/leer', cuerpo, token))).status,
          ESTADO_HTTP.solicitudIncorrecta,
        );
      }
      const nueva = await abrir(p);
      assert.equal(
        (await p.panel.responder(p.peticion('accesos/leer', { pagina: 1 }, token))).status,
        ESTADO_HTTP.conflicto,
      );
      const conservada = await objeto(await p.panel.responder(p.peticion('accesos/leer', { pagina: 1 }, nueva)));
      assert.equal(leerPaginaAccesosRecibida(conservada.accesos).total, FILAS_ESPERADAS);
    } finally {
      p.cerrar();
    }
  });
  test(`${modo}: una página incompleta del almacén da 503, nunca un vacío confirmado`, async (t) => {
    const p = await panelInstitucional(modo);
    try {
      const token = await abrir(p);
      await sembrar(p, token);
      const original = leerResultadoAccesosSesion(
        await objeto(await p.panel.responder(p.peticion('accesos/leer', { pagina: 1 }, token))),
      );
      assert(original.estado === 'activa');
      t.mock.method(p.accesos, 'leerAccesosDeSesion', async () => ({
        ...original,
        accesos: { ...original.accesos, api: [], mcp: [], a2a: [] },
      }));
      const respuesta = await p.panel.responder(p.peticion('accesos/leer', { pagina: 1 }, token));
      assert.equal(respuesta.status, ESTADO_HTTP.noDisponible);
      assert.deepEqual(await respuesta.json(), { error: 'no_disponible' });
    } finally {
      p.cerrar();
    }
  });
}
