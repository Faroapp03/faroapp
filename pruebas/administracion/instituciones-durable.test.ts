/** Binding privado real contra SQLite local; no acredita un despliegue ni una cuenta Cloudflare. */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { leerResultadoRegistroSesion } from '../../src/administracion/instituciones.ts';
import { huellaDelSecreto, secretoNuevo } from '../../src/api/socios/registro.ts';
import {
  AccesoPublicoDurable,
  AlmacenPublicoNoDisponible,
  type EstadoAccesoPublicoDurable,
} from '../../src/plataforma/acceso-publico/durable.ts';
import { SesionUnicaDurable } from '../../src/plataforma/acceso-publico/sesion-unica-cliente-durable.ts';
import type { ValorSql } from '../../src/plataforma/acceso-publico/sqlite.ts';
import { alarmaDurableDePrueba } from '../ayudas/alarma-durable.ts';
import { abrirSesionDePrueba } from '../ayudas/sesion-de-prueba.ts';

const TAM_HUELLA = 64,
  HTTP_INVALIDO = 400,
  HTTP_NO_DISPONIBLE = 503;
const acceso = (letra = 'a') => ({ huellaSesion: letra.repeat(TAM_HUELLA), huellaPrincipal: 'f'.repeat(TAM_HUELLA) });
const entorno = {};
const politica = { version: 2, api: 'habilitada', mcp: false, a2a: false } as const;
function identidad() {
  const secreto = secretoNuevo();
  return { id: crypto.randomUUID(), huella: huellaDelSecreto(secreto), secreto };
}
function montaje() {
  const db = new DatabaseSync(':memory:');
  const estado: EstadoAccesoPublicoDurable = {
    storage: {
      ...alarmaDurableDePrueba(),
      sql: {
        exec: (sentencia: string, ...valores: ValorSql[]) => ({ toArray: () => db.prepare(sentencia).all(...valores) }),
      },
      transactionSync: <T>(accion: () => T): T => {
        db.exec('BEGIN IMMEDIATE');
        try {
          const r = accion();
          db.exec('COMMIT');
          return r;
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      },
    },
  };
  let servidor = new AccesoPublicoDurable(estado, entorno);
  const cuerpos: string[] = [];
  const espacio = {
    idFromName: () => 'registro-publico-v1',
    get: () => ({
      fetch: async (r: Request) => {
        cuerpos.push(await r.clone().text());
        return servidor.fetch(r);
      },
    }),
  };
  return {
    db,
    cuerpos,
    uno: new SesionUnicaDurable(espacio),
    dos: new SesionUnicaDurable(espacio),
    reiniciar: () => {
      servidor = new AccesoPublicoDurable(estado, entorno);
    },
    enviar: (ruta: string, cuerpo: unknown) =>
      servidor.fetch(
        new Request(`https://registro-socios.invalid${ruta}`, { method: 'POST', body: JSON.stringify(cuerpo) }),
      ),
  };
}

function comprobarAusenciaSecretos(
  f: ReturnType<typeof montaje>,
  identidades: readonly ReturnType<typeof identidad>[],
): void {
  const almacenado =
    JSON.stringify(f.db.prepare('SELECT * FROM instituciones_invitaciones').all()) +
    JSON.stringify(f.db.prepare('SELECT * FROM instituciones_claves').all());
  for (const i of identidades) {
    assert(!almacenado.includes(i.secreto));
    assert(!f.cuerpos.join('').includes(i.secreto));
  }
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: el caso conserva el ciclo de una misma institución entre dos stubs y un reinicio.
test('binding: invitación, consulta, activación única, relevo y retirada persisten entre stubs y reinicios', async () => {
  const f = montaje(),
    id = `inst-${crypto.randomUUID()}`,
    invitacion = identidad(),
    clave = identidad(),
    siguiente = identidad(),
    claveNueva = identidad();
  const hash = ({ id, huella }: ReturnType<typeof identidad>) => ({ id, huella });
  try {
    await f.uno.prepararPanel(politica);
    await f.uno.prepararInstituciones();
    await abrirSesionDePrueba(f.uno, acceso());
    const creado = await f.uno.invitarInstitucionDeSesion(
      acceso(),
      { revisionEsperada: 0, nombre: 'Institución de prueba', correo: null },
      { ...hash(invitacion), institucionId: id },
    );
    assert.equal(creado.estado, 'cambiado');
    const consulta = await f.dos.consultarInvitacion(hash(invitacion));
    assert(consulta !== null && consulta !== 'apagada');
    assert.equal(consulta.institucion.id, id);
    assert.equal((await f.uno.leerInstitucionesDeSesion(acceso())).estado, 'activa');
    const resultados = await Promise.all([
      f.uno.activarInvitacion(hash(invitacion), hash(clave)),
      f.dos.activarInvitacion(hash(invitacion), hash(claveNueva)),
    ]);
    assert.deepEqual(resultados.map((r) => r.estado).sort(), ['activada', 'no_disponible']);
    const ganadora = resultados[0]?.estado === 'activada' ? clave : claveNueva;
    assert.deepEqual((await f.dos.buscarInstitucion(id))?.huellas, [ganadora.huella]);
    await f.dos.renovarInvitacionDeSesion(acceso(), { revisionEsperada: 2, id }, hash(siguiente));
    const segunda = identidad();
    assert.equal((await f.uno.activarInvitacion(hash(siguiente), hash(segunda))).estado, 'activada');
    assert.equal(
      (await f.uno.renovarInvitacionDeSesion(acceso(), { revisionEsperada: 4, id }, hash(identidad()))).estado,
      'dos_claves_activas',
    );
    await f.uno.retirarClaveDeSesion(acceso(), { revisionEsperada: 4, id, claveId: ganadora.id });
    f.reiniciar();
    assert.deepEqual((await f.dos.buscarInstitucion(id))?.huellas, [segunda.huella]);
    await f.dos.retirarInstitucionDeSesion(acceso(), { revisionEsperada: 5, id });
    assert.equal(await f.uno.buscarInstitucion(id), null);
    const registro = await f.dos.leerInstitucionesDeSesion(acceso());
    assert('registro' in registro);
    assert.equal(registro.registro.instituciones[0]?.estado, 'retirada');
    comprobarAusenciaSecretos(f, [invitacion, clave, siguiente, claveNueva, segunda]);
  } finally {
    f.db.close();
  }
});

test('binding: sesión sustituida y CAS no escriben; mensajes ajenos se rechazan sin cambiar la sesión', async () => {
  const f = montaje();
  try {
    await f.uno.prepararPanel(politica);
    await f.uno.prepararInstituciones();
    await abrirSesionDePrueba(f.uno, acceso());
    await abrirSesionDePrueba(f.dos, acceso('b'));
    const i = identidad(),
      nueva = { id: i.id, huella: i.huella, institucionId: `inst-${crypto.randomUUID()}` },
      solicitud = { revisionEsperada: 0, nombre: 'Entidad', correo: null };
    assert.deepEqual(await f.uno.invitarInstitucionDeSesion(acceso(), solicitud, nueva), { estado: 'sustituida' });
    const antes = f.db.prepare('SELECT * FROM administracion_sesion').all();
    for (const [ruta, cuerpo] of [
      ['/instituciones/invitar', { acceso: acceso('b'), solicitud, nueva: { ...nueva, secreto: 'ajeno' } }],
      ['/instituciones/consultar', { recibida: { id: i.id, huella: 'secreto' } }],
      ['/instituciones/retirar', { acceso: acceso('b'), solicitud: { id: nueva.institucionId, revisionEsperada: -1 } }],
      ['/instituciones/preparar', { extra: true }],
    ] as const) {
      assert.equal((await f.enviar(ruta, cuerpo)).status, HTTP_INVALIDO);
    }
    assert.deepEqual(f.db.prepare('SELECT * FROM administracion_sesion').all(), antes);
    assert.equal((await f.dos.invitarInstitucionDeSesion(acceso('b'), solicitud, nueva)).estado, 'cambiado');
    assert.equal(
      (
        await f.dos.invitarInstitucionDeSesion(acceso('b'), solicitud, {
          ...nueva,
          id: crypto.randomUUID(),
          institucionId: `inst-${crypto.randomUUID()}`,
        })
      ).estado,
      'conflicto',
    );
    f.db.exec('DROP TABLE instituciones_claves');
    await assert.rejects(f.uno.prepararInstituciones(), AlmacenPublicoNoDisponible);
    assert.equal((await f.enviar('/instituciones/leer', { acceso: acceso('b') })).status, HTTP_NO_DISPONIBLE);
  } finally {
    f.db.close();
  }
});

test('cliente institucional rechaza una respuesta remota con campos adicionales o secreto', async () => {
  const respuestas = [
    null,
    {},
    { estado: 'cerrada', secreto: 'ajeno' },
    { estado: 'activa', registro: {}, sesion: {} },
  ];
  for (const respuesta of respuestas) {
    const cliente = new SesionUnicaDurable({
      idFromName: (n) => n,
      get: () => ({ fetch: async () => Response.json(respuesta) }),
    });
    await assert.rejects(cliente.leerInstitucionesDeSesion(acceso()), AlmacenPublicoNoDisponible);
    assert.throws(() => leerResultadoRegistroSesion(respuesta));
  }
});
