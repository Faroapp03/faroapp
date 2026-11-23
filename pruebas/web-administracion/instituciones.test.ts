import assert from 'node:assert/strict';
import { test } from 'node:test';
import { crearClientePanel, type EstadoClientePanel } from '../../web/administracion/cliente.js';
import { direccionDeInvitacion, leerRegistroInstituciones } from '../../web/administracion/instituciones-contrato.js';
import { panelInstitucional } from '../ayudas/conectividad.ts';
import { activa } from './estado-panel.ts';

const LONGITUD_SECRETO = 43;
function ultimo(estados: EstadoClientePanel[]) {
  const estado = estados.at(-1);
  assert.ok(estado);
  return estado;
}
type Backend = Awaited<ReturnType<typeof panelInstitucional>>;
function conectar(backend: Backend, interceptar?: (ruta: string, respuesta: Response) => Promise<Response>) {
  let token = '';
  const rutas: string[] = [];
  const pedir: typeof fetch = async (ruta, opciones) => {
    const operacion = String(ruta).replace('/administracion/api/', '');
    rutas.push(operacion);
    assert.equal(opciones?.cache, 'no-store');
    assert.equal(opciones?.credentials, 'same-origin');
    assert.equal(opciones?.redirect, 'error');
    const headers = new Headers(opciones?.headers);
    assert.equal(headers.get('x-faro-panel'), '1');
    const recibida = headers.get('x-faro-sesion');
    if (recibida) {
      token = recibida;
    }
    const respuesta = await backend.panel.responder(
      backend.peticion(operacion, JSON.parse(String(opciones?.body)), recibida ?? undefined),
    );
    return interceptar ? interceptar(operacion, respuesta) : respuesta;
  };
  const estados: EstadoClientePanel[] = [];
  const cliente = crearClientePanel({ pedir, alCambiar: (e) => estados.push(e) });
  return { cliente, estados, rutas, token: () => token };
}
for (const modo of ['Node', 'binding'] as const) {
  test(`${modo}: el cliente invita, consulta sin recuperar enlace, renueva y retira con sesión real`, async () => {
    const backend = await panelInstitucional(modo);
    try {
      const c = conectar(backend);
      await c.cliente.abrir();
      assert.equal(activa(await c.cliente.consultarInstituciones()).registroInstituciones?.revision, 0);
      const creada = activa(
        await c.cliente.invitarInstitucion({ nombre: 'Institución de prueba', correo: 'equipo@example.test' }),
      );
      assert.equal(creada.registroInstituciones?.revision, 1);
      assert.ok(creada.invitacion);
      assert.equal(
        new URL(direccionDeInvitacion(creada.invitacion, 'https://example.test')).pathname,
        '/activar-acceso.html',
      );
      const id = creada.registroInstituciones?.instituciones[0]?.id;
      assert.ok(id);
      const enlace = creada.invitacion.enlaceRelativo;
      await c.cliente.comprobar();
      assert.equal(activa(ultimo(c.estados)).invitacion?.enlaceRelativo, enlace);
      c.cliente.descartarInvitacion();
      assert.equal(activa(ultimo(c.estados)).invitacion, null);
      assert.equal(activa(await c.cliente.consultarInstituciones()).invitacion, null);
      const renovada = activa(await c.cliente.renovarInvitacion(id));
      assert.ok(renovada.invitacion);
      assert.notEqual(renovada.invitacion.enlaceRelativo, enlace);
      const retirada = activa(await c.cliente.retirarInstitucion(id));
      assert.equal(retirada.registroInstituciones?.instituciones[0]?.estado, 'retirada');
      assert.equal(retirada.invitacion, null);
      await c.cliente.cerrar();
      assert.equal(c.estados.at(-1)?.estado, 'cerrada');
    } finally {
      backend.cerrar();
    }
  });
  test(`${modo}: CAS bloquea otro cambio hasta lectura explícita y no reenvía invitaciones`, async () => {
    const backend = await panelInstitucional(modo);
    try {
      const c = conectar(backend);
      await c.cliente.abrir();
      await c.cliente.consultarInstituciones();
      await backend.panel.responder(
        backend.peticion(
          'instituciones/invitar',
          { revisionEsperada: 0, nombre: 'Cambio concurrente', correo: null },
          c.token(),
        ),
      );
      const conflicto = activa(await c.cliente.invitarInstitucion({ nombre: 'Otra institución', correo: null }));
      assert.equal(conflicto.avisoInstituciones, 'revision_instituciones_conflictiva');
      assert.equal(conflicto.institucionesPendientes, true);
      assert.equal(conflicto.invitacion, null);
      const peticiones = c.rutas.length;
      await c.cliente.invitarInstitucion({ nombre: 'Otra institución', correo: null });
      assert.equal(c.rutas.length, peticiones);
      const lectura = activa(await c.cliente.consultarInstituciones());
      assert.equal(lectura.registroInstituciones?.instituciones.length, 1);
      await c.cliente.invitarInstitucion({ nombre: 'Otra institución', correo: null });
      assert.equal(backend.filas('SELECT * FROM instituciones').length, 2);
    } finally {
      backend.cerrar();
    }
  });
  test(`${modo}: respuesta perdida exige leer y renovar expresamente, no otra mutación automática`, async () => {
    const backend = await panelInstitucional(modo);
    try {
      const c = conectar(backend, async (ruta, respuesta) => {
        if (ruta === 'instituciones/invitar') {
          throw new TypeError('Respuesta perdida');
        }
        return respuesta;
      });
      await c.cliente.abrir();
      await c.cliente.consultarInstituciones();
      const desconocida = activa(await c.cliente.invitarInstitucion({ nombre: 'Institución de prueba', correo: null }));
      assert.equal(desconocida.avisoInstituciones, 'instituciones_inciertas');
      assert.equal(desconocida.invitacion, null);
      await c.cliente.invitarInstitucion({ nombre: 'Institución de prueba', correo: null });
      assert.equal(c.rutas.filter((r) => r === 'instituciones/invitar').length, 1);
      const lectura = activa(await c.cliente.consultarInstituciones());
      const id = lectura.registroInstituciones?.instituciones[0]?.id;
      assert.ok(id);
      assert.equal(lectura.invitacion, null);
      assert.ok(activa(await c.cliente.renovarInvitacion(id)).invitacion);
    } finally {
      backend.cerrar();
    }
  });
  test(`${modo}: expulsar la sesión retira lista y enlace y no reclama sesión desde instituciones`, async () => {
    const backend = await panelInstitucional(modo);
    try {
      const uno = conectar(backend);
      const dos = conectar(backend);
      await uno.cliente.abrir();
      await uno.cliente.consultarInstituciones();
      await uno.cliente.invitarInstitucion({ nombre: 'Institución de prueba', correo: null });
      // La misma persona en otra página solo desplaza la sesión al decidir retomarla.
      await dos.cliente.abrir(true);
      assert.equal((await uno.cliente.consultarInstituciones()).estado, 'sustituida');
      assert.ok(!Object.hasOwn(ultimo(uno.estados), 'invitacion'));
      const peticiones = uno.rutas.length;
      await uno.cliente.invitarInstitucion({ nombre: 'Otra', correo: null });
      await uno.cliente.consultarInstituciones();
      assert.equal(uno.rutas.length, peticiones);
    } finally {
      backend.cerrar();
    }
  });
}

const INSTITUCION_EJEMPLO = {
  id: 'inst-11111111-1111-4111-8111-111111111111',
  nombre: 'Institución de prueba',
  correo: null,
  estado: 'invitada',
  ultimaConexion: null,
  consultas: 0,
  invitacion: null,
  claves: [],
};

test('el lector rechaza huellas, duplicados y enlaces ajenos o con secretos en query', () => {
  const uuid = '11111111-1111-4111-8111-111111111111';
  const secreto = 'A'.repeat(LONGITUD_SECRETO);
  const enlace = {
    enlaceRelativo: `/activar-acceso.html#invitacion=${uuid}.${secreto}`,
    caducaEn: '2026-10-30T17:00:00.000Z',
  };
  assert.ok(
    direccionDeInvitacion(enlace, 'https://example.test').startsWith('https://example.test/activar-acceso.html#'),
  );
  for (const enlaceRelativo of [
    `https://otro.example.test${enlace.enlaceRelativo}`,
    `/activar-acceso.html?invitacion=${uuid}.${secreto}`,
    `//otro.example.test${enlace.enlaceRelativo}`,
  ]) {
    assert.throws(() => direccionDeInvitacion({ ...enlace, enlaceRelativo }, 'https://example.test'));
  }

  assert.throws(() =>
    leerRegistroInstituciones({
      version: 1,
      revision: 0,
      instituciones: [{ ...INSTITUCION_EJEMPLO, huella: 'privada' }],
    }),
  );
  assert.throws(() =>
    leerRegistroInstituciones({ version: 1, revision: 0, instituciones: [INSTITUCION_EJEMPLO, INSTITUCION_EJEMPLO] }),
  );
  for (const correo of ['equipo@a..b.test', 'equipo@-a.test', '']) {
    assert.throws(() =>
      leerRegistroInstituciones({ version: 1, revision: 0, instituciones: [{ ...INSTITUCION_EJEMPLO, correo }] }),
    );
  }
  let ejecutado = false;
  assert.throws(() =>
    leerRegistroInstituciones({
      version: 1,
      revision: 0,
      get instituciones() {
        ejecutado = true;
        return [];
      },
    }),
  );
  assert.equal(ejecutado, false);
});
