/** Circuito montado real Node y Worker: registro SQL → ruta Access → cliente, sin proveedor ni descargas. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { leerEstadoDatosPanel } from '../../src/administracion/estado-datos.js';
import { sha256Hex } from '../../src/comun/huella.ts';
import { crearClientePanel } from '../../web/administracion/cliente.js';
import { catalogoPrivado } from '../ayudas/catalogo-privado.ts';
import { AHORA_CONECTIVIDAD, ORIGEN_CONECTIVIDAD, panelInstitucional } from '../ayudas/conectividad.ts';
import { activa } from './estado-panel.ts';

const SHA_LONGITUD = 40,
  HUELLA_LONGITUD = 64,
  VERSION_LONGITUD = 16,
  SEGUNDO = 1000,
  VIDA_IDENTIDAD = 60,
  TOTAL = 53,
  HTTP_FALLO = 503,
  HTTP_OK = 200,
  RESTANTES = 3;
const ID = '11111111-1111-4111-8111-111111111111';
const confianza = {
  audiencia: ORIGEN_CONECTIVIDAD,
  repositorioId: '123',
  propietarioId: '456',
  ref: 'refs/heads/main',
  workflowRef: 'equipo/fuente/.github/workflows/actualizar.yml@refs/heads/main',
  sha: 'a'.repeat(SHA_LONGITUD),
  workflowSha: 'b'.repeat(SHA_LONGITUD),
};
const { audiencia: _audiencia, ...pins } = confianza;
const identidad = {
  ...pins,
  runId: '789',
  runAttempt: '1',
  jti: 'prueba',
  emitidoEn: Math.floor(AHORA_CONECTIVIDAD / SEGUNDO),
  caducaEn: Math.floor(AHORA_CONECTIVIDAD / SEGUNDO) + VIDA_IDENTIDAD,
};
function reciboYDatos(inicio: {
  readonly solicitudId: string;
  readonly accion: 'actualizar-datos';
  readonly revisionReserva: number;
}) {
  const fin = new Date(AHORA_CONECTIVIDAD).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const r = {
    ...inicio,
    resultado: 'validado',
    veredicto: 'verde',
    terminadoEn: fin,
    huellaPaquete: 'a'.repeat(VERSION_LONGITUD),
    error: null,
  } as const;
  const datos = leerEstadoDatosPanel({
    version: 1,
    observadoEn: fin,
    fuentes: [{ id: 'prueba', politica: 'fija', fecha: null, plazoDias: null }],
    modulos: ['prueba', 'paquete'].map((id) => ({
      id,
      ultimoIntento: fin,
      veredicto: 'verde',
      ultimaVersionBuena: null,
      fallos: 0,
      proximoReintento: null,
    })),
    formacionAbiertaCaduca: null,
  });
  return { r, datos };
}
async function sembrar(p: Awaited<ReturnType<typeof panelInstitucional>>, token: string) {
  const acceso = {
    huellaSesion: sha256Hex(token),
    huellaPrincipal: sha256Hex(
      JSON.stringify(['https://equipo-sintetico.cloudflareaccess.com', 'principal-sintetico']),
    ),
  };
  await p.trabajos.prepararTrabajos();
  assert.equal(
    (
      await p.trabajos.reservarTrabajoDeSesion(
        acceso,
        { solicitudId: ID, accion: 'actualizar-datos', revisionEsperada: 0 },
        confianza,
      )
    ).estado,
    'nueva',
  );
  const inicio = { solicitudId: ID, accion: 'actualizar-datos', revisionReserva: 1 } as const;
  await p.trabajos.confirmarInicio(inicio, identidad);
  const { r, datos } = reciboYDatos(inicio);
  assert.equal(
    (await p.trabajos.registrarRecibo(r, 'e'.repeat(HUELLA_LONGITUD), identidad, datos, catalogoPrivado(TOTAL))).estado,
    'aplicado',
  );
}
for (const modo of ['Node', 'binding'] as const) {
  test(`${modo}: catálogo privado real paginado, fallo conserva observación y pérdida de Access la retira`, async () => {
    const p = await panelInstitucional(modo);
    let token = '',
      denegado = false,
      roto = false;
    const pedir: typeof fetch = async (ruta, opciones) => {
      const op = String(ruta).replace('/administracion/api/', '');
      const t = new Headers(opciones?.headers).get('x-faro-sesion');
      if (t) {
        token = t;
      }
      const peticion = p.peticion(op, JSON.parse(String(opciones?.body)), t ?? undefined);
      if (denegado) {
        peticion.headers.delete('cf-access-jwt-assertion');
      }
      if (roto && op === 'datos/ofertas-ocultas') {
        return Response.json({ error: 'no_disponible' }, { status: HTTP_FALLO });
      }
      return p.panel.responder(peticion);
    };
    const cliente = crearClientePanel({ pedir, alCambiar: () => {} });
    try {
      await cliente.abrir();
      assert.ok(token);
      await sembrar(p, token);
      const primera = activa(await cliente.consultarOcultas()).ocultas;
      assert.ok(primera?.ofertasOcultas.catalogo);
      assert.equal(primera.ofertasOcultas.catalogo.total, TOTAL);
      assert.equal(primera.ofertasOcultas.catalogo.publicacionConfirmada, null);
      assert.equal(primera.intentosFuentes[0]?.id, 'prueba');
      assert.equal(
        activa(await cliente.consultarOcultas('todos', 1)).ocultas?.ofertasOcultas.catalogo?.unidades.length,
        RESTANTES,
      );
      const guardada = activa(await cliente.consultarOcultas()).ocultas;
      roto = true;
      const fallo = activa(await cliente.consultarOcultas());
      assert.deepEqual(fallo.ocultas, guardada);
      assert.equal(fallo.avisoOcultas, 'ocultas_no_disponibles');
      roto = false;
      denegado = true;
      assert.notEqual((await cliente.consultarOcultas()).estado, 'activa');
      assert.equal(p.filas('SELECT * FROM administracion_datos_trabajo').length, 1);
    } finally {
      cliente.destruir();
      p.cerrar();
    }
  });
  test(`${modo}: ausencia de catálogo es sin registro, sin inventar total cero`, async () => {
    const p = await panelInstitucional(modo);
    try {
      await p.trabajos.prepararTrabajos();
      const abrir = await p.panel.responder(p.peticion('sesion/abrir'));
      const body = (await abrir.json()) as { token: string };
      const respuesta = await p.panel.responder(
        p.peticion('datos/ofertas-ocultas', { tipo: 'todos', pagina: 0, revision: null }, body.token),
      );
      assert.equal(respuesta.status, HTTP_OK);
      const valor = (await respuesta.json()) as { ofertasOcultas: unknown };
      assert.deepEqual(valor.ofertasOcultas, { estado: 'sin-registro', catalogo: null });
    } finally {
      p.cerrar();
    }
  });
}
