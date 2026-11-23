// Contratos de errores y Problem Details, sin montar la API ni llamar a un proveedor.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ContratoIncompatible,
  contenidoNoAdmitido,
  DemasiadasPeticiones,
  type MotivoDelProblema,
  OrigenNoPermitido,
  PeticionCancelada,
  PlazoAgotado,
  PROBLEMAS,
  problema,
  RAIZ_DE_LOS_PROBLEMAS,
  registrarErrorInterno,
  respuestaDeError,
  respuestaDeProblema,
  SolicitudInvalida,
  TipoNoAdmitido,
} from '../../src/api/errores.ts';
import { type CodigoErrorDeProcesamiento, ErrorDeProcesamiento } from '../../src/comun/error-de-procesamiento.ts';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { RelojAtrasado } from '../../src/comun/reloj-atrasado.ts';
import { EntradaInvalida } from '../../src/dominio/errores.ts';
import { CONTENIDO_NO_ADMITIDO } from '../../src/seguridad/moderacion.ts';

const REINTENTO_RED = '600';
const REINTENTO_SERVICIO = '3600';
const PRIVADO = 'PERSONA_FICTICIA_RETIRADA';
const ERRORES_FIJOS: readonly (readonly [new () => Error, number, MotivoDelProblema])[] = [
  [DemasiadasPeticiones, ESTADO_HTTP.demasiadasPeticiones, 'demasiadas_peticiones'],
  [OrigenNoPermitido, ESTADO_HTTP.prohibido, 'origen_no_permitido'],
  [TipoNoAdmitido, ESTADO_HTTP.tipoNoAdmitido, 'tipo_no_admitido'],
  [PeticionCancelada, ESTADO_HTTP.solicitudIncorrecta, 'cancelada'],
  [PlazoAgotado, ESTADO_HTTP.tiempoAgotado, 'tiempo'],
  [ContratoIncompatible, ESTADO_HTTP.conflicto, 'contrato'],
  [RelojAtrasado, ESTADO_HTTP.solicitudIncorrecta, 'reloj_atrasado'],
];
const ESTADOS_DE_PROCESAMIENTO: Readonly<Record<CodigoErrorDeProcesamiento, number>> = {
  no_configurado: ESTADO_HTTP.noDisponible,
  salida_invalida: ESTADO_HTTP.pasarelaIncorrecta,
};

for (const [Clase, estado, motivo] of ERRORES_FIJOS) {
  test(`el error ${Clase.name} conserva su estado y problema fijo`, () => {
    const error = new Clase();
    error.message = PRIVADO;
    const respuesta = respuestaDeError(error);
    assert.equal(respuesta.estado, estado);
    assert.equal(respuesta.cuerpo.status, estado);
    assert.equal(respuesta.cuerpo.type, `${RAIZ_DE_LOS_PROBLEMAS}${motivo}`);
    assert.equal(respuesta.cuerpo.title, PROBLEMAS[motivo]);
    assert.ok(respuesta.cuerpo.detail);
    assert.doesNotMatch(JSON.stringify(respuesta), new RegExp(PRIVADO));
    assert.equal(respuesta.cabeceras['retry-after'], motivo === 'demasiadas_peticiones' ? REINTENTO_RED : undefined);
  });
}

test('cada fallo de procesamiento conserva su código y oculta el mensaje interno', () => {
  for (const [codigo, estado] of Object.entries(ESTADOS_DE_PROCESAMIENTO)) {
    const error = new ErrorDeProcesamiento(codigo as CodigoErrorDeProcesamiento, `fallo\n${PRIVADO}`);
    const respuesta = respuestaDeError(error);
    assert.equal(respuesta.estado, estado);
    assert.equal(respuesta.cuerpo.type, `${RAIZ_DE_LOS_PROBLEMAS}${codigo}`);
    assert.equal(respuesta.cuerpo.error, codigo);
    assert.doesNotMatch(JSON.stringify(respuesta), new RegExp(PRIVADO));
    assert.equal(respuesta.cabeceras['retry-after'], codigo === 'no_configurado' ? REINTENTO_SERVICIO : undefined);
  }
});

test('solo los errores de entrada conservan el mensaje escrito para la persona', () => {
  for (const error of [new SolicitudInvalida('falta el relato'), new EntradaInvalida('falta la tarea')]) {
    const { cuerpo, estado } = respuestaDeError(error);
    assert.equal(estado, ESTADO_HTTP.solicitudIncorrecta);
    assert.equal(cuerpo.detail, error.message);
    assert.equal(cuerpo.error, error.message);
  }
});

test('un error desconocido responde 500 con texto fijo', () => {
  for (const error of [new Error(PRIVADO), new TypeError(PRIVADO), PRIVADO, null, { mensaje: PRIVADO }]) {
    const respuesta = respuestaDeError(error);
    assert.equal(respuesta.estado, ESTADO_HTTP.errorInterno);
    assert.equal(respuesta.cuerpo.type, `${RAIZ_DE_LOS_PROBLEMAS}error_interno`);
    assert.equal(respuesta.cuerpo.error, 'error interno');
    assert.doesNotMatch(JSON.stringify(respuesta), new RegExp(PRIVADO));
  }
});

test('las extensiones no pisan miembros fijos y error conserva su valor de compatibilidad', () => {
  const cuerpo = problema(ESTADO_HTTP.noEncontrado, 'ruta_desconocida', 'ruta desconocida', {
    type: 'otro',
    title: 'otro',
    status: 0,
    detail: 'otro',
    error: 'compatibilidad',
    avisos: [],
  });
  assert.deepEqual(cuerpo, {
    type: `${RAIZ_DE_LOS_PROBLEMAS}ruta_desconocida`,
    title: PROBLEMAS.ruta_desconocida,
    status: ESTADO_HTTP.noEncontrado,
    detail: 'ruta desconocida',
    error: 'compatibilidad',
    avisos: [],
  });
  const moderado = contenidoNoAdmitido({ error: 'otro', avisos: ['aviso'] });
  assert.equal(moderado.error, CONTENIDO_NO_ADMITIDO);
  assert.equal(moderado.status, ESTADO_HTTP.contenidoNoProcesable);
  assert.deepEqual(moderado.avisos, ['aviso']);
});

test('Retry-After conserva los intervalos del servicio y del límite de consultas', () => {
  assert.equal(
    respuestaDeProblema(problema(ESTADO_HTTP.noDisponible, 'no_configurado', 'Servicio no disponible')).cabeceras[
      'retry-after'
    ],
    REINTENTO_SERVICIO,
  );
  assert.equal(respuestaDeError(new DemasiadasPeticiones()).cabeceras['retry-after'], REINTENTO_RED);
});

test('el registro excluye consulta, mensaje y nombres de error alterados', (contexto) => {
  const traza = contexto.mock.method(console, 'error', () => undefined);
  const error = new TypeError(`fallo\n${PRIVADO}`);
  error.name = PRIVADO;
  const id = registrarErrorInterno(new Request(`http://api.local/api/entender?relato=${PRIVADO}`), error);
  const linea = traza.mock.calls[0]?.arguments[0];
  assert.equal(typeof linea, 'string');
  assert.equal(traza.mock.calls.length, 1);
  assert.doesNotMatch(linea, new RegExp(PRIVADO));
  assert.deepEqual(JSON.parse(linea), {
    suceso: 'error interno',
    metodo: 'GET',
    estado: ESTADO_HTTP.errorInterno,
    tipo: 'TypeError',
    peticion: id,
  });
});

test('cf-ray se conserva solo si tiene la forma admitida y el tipo registrado es estable', (contexto) => {
  contexto.mock.method(console, 'error', () => undefined);
  const ray = '0123456789abcdef-MAD';
  const valido = new Request('http://api.local/api/salud', { headers: { 'cf-ray': ray } });
  assert.equal(registrarErrorInterno(valido, new Error(PRIVADO)), ray);
  const falso = new Request('http://api.local/api/salud', { headers: { 'cf-ray': PRIVADO } });
  assert.match(registrarErrorInterno(falso, PRIVADO), /^[0-9a-f-]{36}$/);
});

test('el diagnóstico de un 500 no conserva ruta libre, cabeceras ni cuerpo', (contexto) => {
  const traza = contexto.mock.method(console, 'error', () => undefined);
  const peticion = new Request(`http://api.local/api/${PRIVADO}/987654321?dato=${PRIVADO}`, {
    method: 'POST',
    headers: { authorization: PRIVADO, 'cf-access-jwt-assertion': PRIVADO },
    body: PRIVADO,
  });
  registrarErrorInterno(peticion, new Error(PRIVADO));
  const linea = traza.mock.calls[0]?.arguments[0];
  assert.equal(typeof linea, 'string');
  assert.doesNotMatch(linea, new RegExp(PRIVADO));
  assert.equal(Object.hasOwn(JSON.parse(linea), 'ruta'), false);
});

test('el método del diagnóstico pertenece al conjunto HTTP o es otro', (contexto) => {
  const traza = contexto.mock.method(console, 'error', () => undefined);
  for (const metodo of ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'TRACE', 'CONNECT', PRIVADO]) {
    registrarErrorInterno(
      { headers: new Headers(), url: 'http://api.local/api/salud', method: metodo },
      new Error(PRIVADO),
    );
  }
  const metodos = traza.mock.calls.map(({ arguments: args }) => JSON.parse(args[0]).metodo);
  assert.deepEqual(metodos, ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'TRACE', 'CONNECT', 'otro']);
});
