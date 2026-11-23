import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LIMITES_CONECTIVIDAD } from '../../src/administracion/instituciones.ts';
import { AccesoPublicoNoDisponible } from '../../src/api/socios/acceso-publico.ts';
import { autenticarSocio, huellaDelSecreto } from '../../src/api/socios/registro.ts';
import {
  buscarSocio,
  consumirConsulta,
  consumirCredencialGlobal,
  consumirToken,
  crearServidorDeSocios,
  destinoDe,
  tokenVigente,
} from '../../src/api/socios/servidor-socios.ts';
import { SociosDePrueba } from '../ayudas/socios-api.ts';

const FIRMA = 'firma sintética de más de treinta y dos caracteres';
const SECRETO = 'secreto sintético del cliente público';
const SOCIO = { id: 'pub-sintetico', huellas: [huellaDelSecreto(SECRETO)], consultasPorHora: 2 };
const PETICION = new Request('https://publico.test/api/socios/v1/consultas/explorar_grupos');
const TOKENS = 20;
const MINUTO = 60;

function servidor(almacen: SociosDePrueba) {
  return crearServidorDeSocios(almacen.opciones(), { secreto: FIRMA, anterior: undefined });
}

test('un alta posterior al arranque comparte consultas y tokens entre servidores', async () => {
  const almacen = new SociosDePrueba();
  const uno = await servidor(almacen);
  const dos = await servidor(almacen);
  assert.equal(await buscarSocio(uno, SOCIO.id), null);
  almacen.socios.set(SOCIO.id, SOCIO);
  assert.deepEqual(await buscarSocio(dos, SOCIO.id), SOCIO);
  assert.equal(await consumirConsulta(uno, SOCIO.id), true);
  assert.equal(await consumirConsulta(dos, SOCIO.id), true);
  assert.equal(await consumirConsulta(uno, SOCIO.id), false);
  for (let i = 0; i < TOKENS; i++) {
    assert.equal(await consumirToken(i % 2 ? uno : dos, SOCIO.id), true);
  }
  assert.equal(await consumirToken(dos, SOCIO.id), false);
});

test('revocar token o retirar cliente invalida tokens también en otro servidor', async () => {
  const almacen = new SociosDePrueba();
  almacen.socios.set(SOCIO.id, SOCIO);
  const uno = await servidor(almacen);
  const dos = await servidor(almacen);
  const autenticado = autenticarSocio(SOCIO, SECRETO);
  assert.ok(autenticado);
  const emitido = await uno.emisor.emitir(autenticado, destinoDe(PETICION));
  assert.deepEqual(await tokenVigente(dos, emitido.token, PETICION), emitido.reclamaciones);
  await uno.revocaciones.revocar(emitido.reclamaciones.jti, emitido.reclamaciones.exp);
  assert.equal(await tokenVigente(dos, emitido.token, PETICION), null);
  const siguiente = await uno.emisor.emitir(autenticado, destinoDe(PETICION));
  almacen.socios.delete(SOCIO.id);
  assert.equal(await tokenVigente(dos, siguiente.token, PETICION), null);
});

test('sin persistencia no se usan cuentas ni registro locales para un cliente público', async () => {
  const almacen = new SociosDePrueba();
  almacen.socios.set(SOCIO.id, SOCIO);
  const uno = await servidor(almacen);
  almacen.fallo = true;
  await assert.rejects(buscarSocio(uno, SOCIO.id), AccesoPublicoNoDisponible);
  await assert.rejects(consumirConsulta(uno, SOCIO.id), AccesoPublicoNoDisponible);
  await assert.rejects(consumirCredencialGlobal(uno), AccesoPublicoNoDisponible);
});

test('las credenciales se limitan por red antes de autenticar, aparte del tope global y sin persistir IP', async () => {
  const almacen = new SociosDePrueba();
  const uno = await servidor(almacen);
  const dos = await servidor(almacen);
  for (let i = 0; i < MINUTO; i++) {
    assert.equal(await uno.limites.credencialesPorRed('198.51.100.1'), true);
  }
  assert.equal(await uno.limites.credencialesPorRed('198.51.100.1'), false);
  assert.equal(await dos.limites.credencialesPorRed('198.51.100.1'), true);
  // El límite por red no gasta el tope global: lo gasta solo una credencial ya comprobada (consumirCredencialGlobal).
  assert.equal(almacen.cuentas.size, 0);
  almacen.cuentas.set('credenciales:global', LIMITES_CONECTIVIDAD.credencialesGlobalesHora);
  assert.equal(await consumirCredencialGlobal(dos), false);
  assert.equal(await dos.limites.credencialesPorRed('198.51.100.2'), true);
  assert.equal(JSON.stringify([...almacen.cuentas]).includes('198.51.100.1'), false);
});

test('la cuota global se consume junto a la individual sin cargar la otra cuando se rechaza', async () => {
  const almacen = new SociosDePrueba();
  almacen.socios.set(SOCIO.id, SOCIO);
  const segundo = { ...SOCIO, id: 'pub-segundo' };
  almacen.socios.set(segundo.id, segundo);
  const uno = await servidor(almacen);
  const usadas = LIMITES_CONECTIVIDAD.consultasGlobalesHora - SOCIO.consultasPorHora - 1;
  almacen.cuentas.set('consultas:global', usadas);
  assert.equal(await consumirConsulta(uno, SOCIO.id), true);
  assert.equal(await consumirConsulta(uno, SOCIO.id), true);
  assert.equal(await consumirConsulta(uno, SOCIO.id), false);
  assert.equal(almacen.cuentas.get('consultas:global'), usadas + SOCIO.consultasPorHora);
  assert.equal(await consumirConsulta(uno, segundo.id), true);
  assert.equal(await consumirConsulta(uno, segundo.id), false);
  assert.equal(almacen.cuentas.get(`consultas:cliente:${segundo.id}`), 1);
});
