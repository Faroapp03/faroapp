import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { AccesoSesionPanel } from '../../src/administracion/sesion.ts';
import { huellaDelSecreto, secretoNuevo } from '../../src/api/socios/registro.ts';
import { abrirSqlAdministrativoNode, crearAlmacenPublicoNode } from '../../src/plataforma/acceso-publico/node.ts';
import { abrirSesionDePrueba } from '../ayudas/sesion-de-prueba.ts';

const AHORA = Date.parse('2026-10-23T00:00:00Z');
const POLITICA = { version: 2, api: 'habilitada', mcp: false, a2a: false } as const;
const TAM_HUELLA = 64;
const acceso = (letra = 'a'): AccesoSesionPanel => ({
  huellaSesion: letra.repeat(TAM_HUELLA),
  huellaPrincipal: 'f'.repeat(TAM_HUELLA),
});
const identidad = () => ({ id: crypto.randomUUID(), huella: huellaDelSecreto(secretoNuevo()) });
function fixture() {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'instituciones-sesion-'));
  const archivo = join(dir, 'registro.sqlite');
  const abrir = () => crearAlmacenPublicoNode({ archivo, maxClientes: 100, ahora: () => AHORA });
  return { dir, archivo, abrir };
}
test('Node: sesión sustituida no crea ni retira; revisión e institución cambian en la misma transacción', async () => {
  const f = fixture(),
    a = f.abrir(),
    b = f.abrir();
  try {
    await a.sesion.prepararPanel(POLITICA);
    await a.instituciones.prepararInstituciones();
    await abrirSesionDePrueba(a.sesion, acceso());
    await abrirSesionDePrueba(b.sesion, acceso('b'));
    const id = `inst-${crypto.randomUUID()}`,
      invitacion = { ...identidad(), institucionId: id };
    const solicitud = { revisionEsperada: 0, nombre: 'Institución sintética', correo: null };
    assert.deepEqual(await a.instituciones.invitarInstitucionDeSesion(acceso(), solicitud, invitacion), {
      estado: 'sustituida',
    });
    const inicial = await b.instituciones.leerInstitucionesDeSesion(acceso('b'));
    assert('registro' in inicial);
    assert.equal(inicial.registro.instituciones.length, 0);
    const cambio = await b.instituciones.invitarInstitucionDeSesion(acceso('b'), solicitud, invitacion);
    assert.equal(cambio.estado, 'cambiado');
    assert.equal(
      (
        await a.instituciones.invitarInstitucionDeSesion(acceso('b'), solicitud, {
          ...identidad(),
          institucionId: `inst-${crypto.randomUUID()}`,
        })
      ).estado,
      'conflicto',
    );
    assert.deepEqual(await a.instituciones.retirarInstitucionDeSesion(acceso(), { revisionEsperada: 1, id }), {
      estado: 'sustituida',
    });
    assert.equal((await b.instituciones.leerInstitucionesDeSesion(acceso('b'))).estado, 'activa');
    const panel = await b.sesion.comprobarSesion(acceso('b'));
    assert.equal(panel.estado, 'activa');
    if (panel.estado === 'activa') {
      assert.equal(panel.ultimaActividadEn, AHORA);
    }
  } finally {
    a.close();
    b.close();
    rmSync(f.dir, { recursive: true });
  }
});

test('Node: dos conexiones solo emiten una clave y la retirada afecta inmediatamente a ambas y al reinicio', async () => {
  const f = fixture(),
    a = f.abrir(),
    b = f.abrir();
  const id = `inst-${crypto.randomUUID()}`,
    invitacion = identidad(),
    primera = identidad(),
    segunda = identidad();
  try {
    await a.sesion.prepararPanel(POLITICA);
    await a.instituciones.prepararInstituciones();
    await abrirSesionDePrueba(a.sesion, acceso());
    await a.instituciones.invitarInstitucionDeSesion(
      acceso(),
      { revisionEsperada: 0, nombre: 'Otra institución sintética', correo: 'administracion@example.invalid' },
      { ...invitacion, institucionId: id },
    );
    assert((await a.instituciones.consultarInvitacion(invitacion)) !== null);
    assert((await b.instituciones.consultarInvitacion(invitacion)) !== null);
    const resultados = await Promise.all([
      a.instituciones.activarInvitacion(invitacion, primera),
      b.instituciones.activarInvitacion(invitacion, segunda),
    ]);
    assert.deepEqual(resultados.map((r) => r.estado).sort(), ['activada', 'no_disponible']);
    assert.deepEqual((await b.instituciones.buscarInstitucion(id))?.huellas, [primera.huella]);
    await a.instituciones.retirarClaveDeSesion(acceso(), { revisionEsperada: 2, id, claveId: primera.id });
    assert.equal(await b.instituciones.buscarInstitucion(id), null);
  } finally {
    a.close();
    b.close();
  }
  const c = f.abrir();
  try {
    await c.instituciones.prepararInstituciones();
    assert.equal(await c.instituciones.buscarInstitucion(id), null);
    assert.equal((await c.instituciones.activarInvitacion(invitacion, segunda)).estado, 'no_disponible');
  } finally {
    c.close();
    rmSync(f.dir, { recursive: true });
  }
});

test('pérdida de todas las tablas institucionales no recrea un registro vacío ni modifica la sesión', async () => {
  const f = fixture(),
    a = f.abrir();
  try {
    await a.sesion.prepararPanel(POLITICA);
    await a.instituciones.prepararInstituciones();
    await abrirSesionDePrueba(a.sesion, acceso());
    const { sql, close } = abrirSqlAdministrativoNode(f.archivo);
    try {
      const antes = sql.filas('SELECT * FROM administracion_sesion');
      for (const tabla of [
        'instituciones_claves',
        'instituciones_invitaciones',
        'instituciones',
        'instituciones_estado',
      ]) {
        sql.ejecutar(`DROP TABLE ${tabla}`);
      }
      const esquema = sql.filas('SELECT name,sql FROM sqlite_master ORDER BY name');
      await assert.rejects(a.instituciones.prepararInstituciones());
      await assert.rejects(a.instituciones.leerInstitucionesDeSesion(acceso()));
      assert.deepEqual(sql.filas('SELECT name,sql FROM sqlite_master ORDER BY name'), esquema);
      assert.deepEqual(sql.filas('SELECT * FROM administracion_sesion'), antes);
    } finally {
      close();
    }
  } finally {
    a.close();
    rmSync(f.dir, { recursive: true });
  }
});
