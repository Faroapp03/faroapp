/** La petición local no puede aportar una opinión externa al motor protegido. */
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import type { Atributos } from '../../motores/ocupaciones/src/index.ts';
import { esObjeto } from '../../src/comun/json.ts';
import type { Datos } from '../../src/dominio/tipos-paquete.ts';

const EXITO = 200;
const RECHAZO = 400;
const TEXTO = 'Texto exclusivamente sintético';
const indice = new URL('../../motores/ocupaciones/src/index.ts', import.meta.url).href;
const datos = {} as Datos;

async function frontera(t: import('node:test').TestContext) {
  const hooks = registerHooks({
    load(url, contexto, siguiente) {
      if (url !== indice) {
        return siguiente(url, contexto);
      }
      return {
        format: 'module',
        shortCircuit: true,
        source: `
      export const MAX_RESPUESTAS_DEL_RECORRIDO=100;
      export const avisoDeModeracion=async(texto)=>texto.includes('bloquear')?{tipo:'nota',texto:'Parada sintética'}:null;
      export const estadoDeLaIa=()=>({});
      export const pasoDePantalla=(_datos,_atributos,solicitud)=>({solicitud,lectura:{}});
      export const buscarAMano=()=>[]; export const enlazar=()=>null;
      export const familias=()=>[]; export const gruposDeFamilia=()=>[]; export const resultado=()=>null;
    `,
      };
    },
  });
  t.after(() => hooks.deregister());
  return import('../../src/plataforma/navegador/ruta-local.ts');
}
function peticion(extra: object = {}) {
  return {
    url: 'https://faro.example/local/recorrido-v2/paso',
    method: 'POST',
    headers: [],
    body: JSON.stringify({ texto: TEXTO, idioma: 'es', respuestas: [], ...extra }),
  };
}

test('campo ausente y null conservan la petición local sin trasladar el campo al motor', async (t) => {
  const { responderLocal } = await frontera(t);
  const atributos = () => ({}) as Atributos;
  const ausente = await responderLocal(datos, atributos, peticion());
  const nulo = await responderLocal(datos, atributos, peticion({ segundaOpinion: null }));
  assert.equal(ausente.status, EXITO);
  assert.equal(nulo.status, EXITO);
  const primero = await ausente.text();
  assert.equal(primero, await nulo.text());
  const cuerpo = JSON.parse(primero);
  assert.equal(Object.hasOwn(cuerpo.solicitud, 'segundaOpinion'), false);
});

test('toda segunda opinión no nula se rechaza sin consultar atributos ni motor', async (t) => {
  const { responderLocal } = await frontera(t);
  for (const segundaOpinion of [[], [{ isco08: '1111' }], {}, false, 0, 'externa']) {
    const respuesta = await responderLocal(
      datos,
      () => assert.fail('No debe entrar al motor'),
      peticion({ segundaOpinion }),
    );
    assert.equal(respuesta.status, RECHAZO, JSON.stringify(segundaOpinion));
    const cuerpo = await respuesta.json();
    assert.ok(esObjeto(cuerpo));
    assert.equal(cuerpo.error, 'La petición local no admite una segunda opinión externa');
  }
});

test('una parada de moderación no oculta el rechazo de una segunda opinión no nula', async (t) => {
  const { responderLocal } = await frontera(t);
  const respuesta = await responderLocal(
    datos,
    () => assert.fail('No debe entrar al motor'),
    peticion({ texto: 'bloquear', segundaOpinion: [{ isco08: '1111' }] }),
  );
  assert.equal(respuesta.status, RECHAZO);
  const cuerpo = await respuesta.json();
  assert.ok(esObjeto(cuerpo));
  assert.equal(Object.hasOwn(cuerpo, 'parada'), false);
});
