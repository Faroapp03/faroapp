import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate as turno } from 'node:timers/promises';
import { leerRegistroInstituciones, leerSecretoInvitacion } from '../../src/administracion/instituciones.ts';
import { huellaDelSecreto, secretoNuevo } from '../../src/api/socios/registro.ts';
import { esObjeto } from '../../src/comun/json.ts';
import { leerPaginaAccesos } from '../../web/administracion/accesos-contrato.js';
import { crearClientePanel, type EstadoClientePanel } from '../../web/administracion/cliente.js';
import { ORIGEN_CONECTIVIDAD, panelInstitucional } from '../ayudas/conectividad.ts';
import { activa } from './estado-panel.ts';

const FILAS_MCP = 50,
  TOTAL_FILAS = 53,
  POR_PAGINA = 50,
  HTTP_OK = 200;
type Backend = Awaited<ReturnType<typeof panelInstitucional>>;
function conectar(p: Backend) {
  let token = '';
  const rutas: string[] = [];
  const pedir: typeof fetch = async (ruta, opciones) => {
    const op = String(ruta).replace('/administracion/api/', '');
    rutas.push(op);
    const recibido = new Headers(opciones?.headers).get('x-faro-sesion');
    if (recibido) {
      token = recibido;
    }
    return p.panel.responder(p.peticion(op, JSON.parse(String(opciones?.body)), recibido ?? undefined));
  };
  const estados: EstadoClientePanel[] = [];
  const cliente = crearClientePanel({ pedir, alCambiar: (e) => estados.push(e) });
  return { cliente, pedir, estados, rutas, token: () => token };
}
async function sembrar(p: Backend, token: string) {
  const creada = await p.panel.responder(
    p.peticion(
      'instituciones/invitar',
      { revisionEsperada: 0, nombre: 'Institución de prueba', correo: 'equipo@example.test' },
      token,
    ),
  );
  const cuerpo: unknown = await creada.json();
  assert.ok(esObjeto(cuerpo));
  const id = leerRegistroInstituciones(cuerpo.registro).instituciones[0]?.id;
  assert.ok(id);
  assert.ok(esObjeto(cuerpo.invitacion) && typeof cuerpo.invitacion.enlaceRelativo === 'string');
  const enlace = new URL(cuerpo.invitacion.enlaceRelativo, ORIGEN_CONECTIVIDAD);
  const invitacion = leerSecretoInvitacion({ invitacion: enlace.hash.slice('#invitacion='.length) });
  const huella = huellaDelSecreto(secretoNuevo());
  assert.equal(
    (
      await p.instituciones.activarInvitacion(
        { id: invitacion.id, huella: huellaDelSecreto(invitacion.secreto) },
        { id: crypto.randomUUID(), huella },
      )
    ).estado,
    'activada',
  );
  for (let i = 0; i < 2; i++) {
    await p.accesos.registrarAcceso({
      canal: 'api',
      institucionId: id,
      credencial: huella,
      consulta: 'ficha_grupo',
      estadoHttp: HTTP_OK,
    });
  }
  for (let i = 0; i < FILAS_MCP; i++) {
    await p.accesos.registrarAcceso({
      canal: 'mcp',
      consulta: 'ficha_grupo',
      clienteDeclarado: `cliente-${i}`,
      categoriaCliente: 'declarado',
    });
  }
  await p.accesos.registrarAcceso({
    canal: 'mcp',
    consulta: 'ficha_grupo',
    clienteDeclarado: 'cliente-0',
    categoriaCliente: 'declarado',
  });
  await p.accesos.registrarAcceso({ canal: 'a2a', habilidad: 'ficha_grupo' });
}
for (const modo of ['Node', 'binding'] as const) {
  test(`${modo}: Accesos recorre páginas globales reales de 50 y distingue filas de consultas`, async () => {
    const p = await panelInstitucional(modo);
    try {
      const c = conectar(p);
      await c.cliente.abrir();
      await sembrar(p, c.token());
      const primera = activa(await c.cliente.consultarAccesos()).accesos;
      assert.ok(primera);
      assert.equal(primera.total, TOTAL_FILAS);
      assert.equal(primera.api.length + primera.mcp.length + primera.a2a.length, POR_PAGINA);
      const segunda = activa(await c.cliente.consultarAccesos(2)).accesos;
      assert.ok(segunda);
      assert.equal(segunda.api.length + segunda.mcp.length + segunda.a2a.length, TOTAL_FILAS - POR_PAGINA);
      assert.equal(segunda.api.length, 0);
      assert.equal(segunda.mcp.find((f) => f.clienteDeclarado === 'cliente-0')?.consultas, 2);
      assert.ok(!JSON.stringify(primera).includes('equipo@example.test'));
    } finally {
      p.cerrar();
    }
  });
  test(`${modo}: fallo no conserva la página como actual y la expulsión retira el registro`, async () => {
    const p = await panelInstitucional(modo);
    try {
      const c = conectar(p);
      await c.cliente.abrir();
      await sembrar(p, c.token());
      await c.cliente.consultarAccesos();
      let fallar = false;
      const rota = crearClientePanel({
        pedir: async (ruta, opciones) =>
          fallar && String(ruta).endsWith('accesos/leer')
            ? Response.json({ error: 'no_disponible' }, { status: 503 })
            : c.pedir(ruta, opciones),
        alCambiar: () => {},
      });
      // Otra página de la misma persona: toma la sesión solo al decidir retomarla.
      await rota.abrir(true);
      const anterior = activa(await rota.consultarAccesos());
      assert.equal(anterior.accesos?.total, TOTAL_FILAS);
      fallar = true;
      const fallo = activa(await rota.consultarAccesos());
      assert.equal(fallo.accesos, null);
      assert.equal(fallo.avisoAccesos, 'accesos_no_disponibles');
      assert.deepEqual(fallo.controles, anterior.controles);
      assert.equal((await c.cliente.consultarAccesos()).estado, 'sustituida');
      const total = c.rutas.length;
      await c.cliente.consultarAccesos();
      assert.equal(c.rutas.length, total);
    } finally {
      p.cerrar();
    }
  });
}

test('lector: categorías explícitas, cantidad global y ausencia de campos de consultas o credenciales', () => {
  const fila = {
    dia: '2026-10-23',
    herramienta: 'ficha_grupo',
    clienteDeclarado: null,
    categoriaCliente: 'no_declarado',
    consultas: 2,
  };
  const base = { version: 1, pagina: 1, total: 1, porPagina: POR_PAGINA, api: [], mcp: [fila], a2a: [] };
  assert.deepEqual(leerPaginaAccesos(base), base);
  for (const cambio of [
    { ...base, mcp: [] },
    { ...base, mcp: [{ ...fila, arguments: { texto: 'privado' } }] },
    { ...base, mcp: [{ ...fila, clienteDeclarado: 'Inventado' }] },
    { ...base, mcp: [{ ...fila, categoriaCliente: 'declarado' }] },
    { ...base, porPagina: 100 },
  ]) {
    assert.throws(() => leerPaginaAccesos(cambio));
  }
  let ejecutado = false;
  const categoria = {
    toString() {
      ejecutado = true;
      return 'no_declarado';
    },
  };
  assert.throws(() => leerPaginaAccesos({ ...base, mcp: [{ ...fila, categoriaCliente: categoria }] }));
  assert.equal(ejecutado, false);
});

test('retirar la página durante Accesos descarta su respuesta tardía', async () => {
  const p = await panelInstitucional('Node');
  try {
    const c = conectar(p);
    let resolver = (_r: Response) => {};
    let marcar = () => {};
    const preparada = new Promise<void>((r) => {
      marcar = r;
    });
    const pendiente = new Promise<Response>((r) => {
      resolver = r;
    });
    let respuesta: Response | undefined;
    const estados: EstadoClientePanel[] = [];
    const cliente = crearClientePanel({
      pedir: async (ruta, opciones) => {
        const r = await c.pedir(ruta, opciones);
        if (String(ruta).endsWith('accesos/leer')) {
          respuesta = r;
          marcar();
          return pendiente;
        }
        return r;
      },
      alCambiar: (e) => estados.push(e),
    });
    await cliente.abrir();
    const lectura = cliente.consultarAccesos();
    await preparada;
    cliente.destruir();
    const cantidad = estados.length;
    assert.ok(respuesta);
    resolver(respuesta);
    await lectura;
    await turno();
    await cliente.consultarAccesos();
    assert.equal(estados.length, cantidad);
  } finally {
    p.cerrar();
  }
});
