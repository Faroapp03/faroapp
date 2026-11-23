import './aislar.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cargarDiccionario } from '../../web/idiomas/cargar.js';
import { avanzar, estadoInicial, FASES } from '../../web/scripts/recorrido/flujo-ocupacion.js';
import { mensajeDeFase } from '../../web/scripts/recorrido/mensajes-ocupacion.js';
import { fijarIdioma, resolver } from '../../web/scripts/textos.js';
import { grupoClasificado } from '../web-recorrido-modelo/datos.ts';
import { prepararDom } from './dom.ts';

await cargarDiccionario('es');
await cargarDiccionario('ca');
const fabrica = await import('../../web/scripts/recorrido/ocupacion-local.js');

test('real: pregunta abierta, exploración oficial y confirmación', () => {
  prepararDom();
  fijarIdioma('es');
  const enviado = avanzar(estadoInicial(), { tipo: 'responder', texto: 'chofer' });
  const pregunta = fabrica.clasificacionAclarar('es');
  assert.equal(pregunta.pregunta?.opciones, null);
  const abierta = avanzar(enviado, { tipo: 'clasificado', clasificacion: pregunta });
  assert.equal(abierta.fase, FASES.RESPONDIENDO);
  const respuesta = avanzar(abierta, { tipo: 'responder', texto: 'transporte' });
  assert.equal(respuesta.texto, 'chofer\ntransporte');
  const explorar = avanzar(enviado, { tipo: 'clasificado', clasificacion: fabrica.clasificacionSinGrupo('es') });
  assert.equal(explorar.fase, FASES.EXPLORANDO);
  assert.equal(explorar.padre, '');
  const rama = avanzar(explorar, { tipo: 'abrirGrupo', codigo: '83', titulo: 'Conductores' });
  const grupo = avanzar(rama, { tipo: 'abrirGrupo', codigo: '8331', titulo: 'Autobuses' });
  assert.equal(avanzar(grupo, { tipo: 'soloGrupo' }).eleccion?.isco08, '8331');
  const clasificacion = fabrica.clasificacionConfirmada(grupoClasificado('8331'), 'es');
  const confirmada = avanzar(enviado, { tipo: 'clasificado', clasificacion });
  assert.equal(confirmada.fase, FASES.CONFIRMANDO);
  assert.equal(confirmada.grupo?.isco08, '8331');
});

test('la pregunta de aclaración sigue el idioma de la página aunque se hiciera en otro', () => {
  prepararDom();
  fijarIdioma('es');
  const enviado = avanzar(estadoInicial(), { tipo: 'responder', texto: 'chofer' });
  const abierta = avanzar(enviado, { tipo: 'clasificado', clasificacion: fabrica.clasificacionAclarar('es') });
  assert.equal(resolver(mensajeDeFase(abierta).at(-1)), '¿Me cuentas qué haces en un día normal?');
  fijarIdioma('ca');
  assert.notEqual(resolver(mensajeDeFase(abierta).at(-1)), '¿Me cuentas qué haces en un día normal?');
  assert.match(String(resolver(mensajeDeFase(abierta).at(-1))), /dia normal/);
  fijarIdioma('es');
});
