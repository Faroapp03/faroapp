import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PROBLEMAS } from '../../src/api/problemas.ts';
import { ERRORES_RECORRIDO as ERRORES_CA } from '../../web/idiomas/ca/errores-recorrido.js';
import { cargarDiccionario } from '../../web/idiomas/cargar.js';
import { ERRORES_RECORRIDO as ERRORES_ES } from '../../web/idiomas/es/errores-recorrido.js';
import { RAIZ_DE_LOS_PROBLEMAS } from '../../web/scripts/protocolo-web.js';
import {
  avisosDeModeracion,
  ERROR_DE_PLAZO,
  ERROR_DEL_MOTOR_LOCAL,
  ERROR_GENERICO,
  ERROR_RELOJ_ATRASADO,
  ERROR_SIN_LIMPIEZA,
  ERRORES_DEL_MOTOR,
  ErrorFaro,
  errorDeCancelacion,
  errorDeLaRespuesta,
  esCancelacion,
  MOTIVOS_DE_FALLO,
  motivoDelFallo,
  sePuedeReintentar,
} from '../../web/scripts/recorrido/api/errores.js';
import { fijarIdioma, resolver, traducible } from '../../web/scripts/textos.js';

await cargarDiccionario('es');
await cargarDiccionario('ca');

const SOLICITUD_INCORRECTA = 400,
  CONTENIDO_NO_ADMITIDO = 422,
  FALLO_INTERNO = 500,
  SALIDA_INVALIDA = 502,
  PROHIBIDO = 403,
  TIPO_NO_ADMITIDO = 415,
  SERVICIO_NO_DISPONIBLE = 503;
/** Respuestas que solo daría un servidor o una pasarela, nunca el motor del dispositivo. */
const SOLO_DE_UN_SERVIDOR = Object.freeze([PROHIBIDO, TIPO_NO_ADMITIDO, SERVICIO_NO_DISPONIBLE]);

test('problemas reconocidos coinciden con contrato real y conservan motivos/distinciones', () => {
  for (const problema of Object.values(ERRORES_DEL_MOTOR)) {
    assert.ok(Object.hasOwn(PROBLEMAS, problema));
  }
  const moderacion = errorDeLaRespuesta(CONTENIDO_NO_ADMITIDO, {
    type: `${RAIZ_DE_LOS_PROBLEMAS}contenido_no_admitido`,
  });
  assert.equal(motivoDelFallo(moderacion), 'contenido');
  assert.equal(avisosDeModeracion(moderacion).length, 0);
  const cancelada = errorDeCancelacion();
  assert.equal(esCancelacion(cancelada), true);
});

test('moderación conserva solo avisos válidos y mensaje bilingüe sin alterar el cuerpo', () => {
  const cuerpo = { avisos: [{ tipo: 'ayuda', texto: 'Aviso' }, { tipo: 1, texto: 'no' }, null] };
  const error = errorDeLaRespuesta(CONTENIDO_NO_ADMITIDO, cuerpo);
  assert.deepEqual(avisosDeModeracion(error), [{ tipo: 'ayuda', texto: 'Aviso' }]);
  assert.equal(error.datos, cuerpo);
  fijarIdioma('es');
  const es = errorDeLaRespuesta(CONTENIDO_NO_ADMITIDO, {}).message;
  fijarIdioma('ca');
  const ca = errorDeLaRespuesta(CONTENIDO_NO_ADMITIDO, {}).message;
  assert.notEqual(es, ca);
  fijarIdioma('es');
});

test('un rechazo no identificado conserva su motivo general sin inventar la causa', () => {
  const respuesta = errorDeLaRespuesta(FALLO_INTERNO, { type: `${RAIZ_DE_LOS_PROBLEMAS}problema_desconocido` });
  assert.equal(motivoDelFallo(respuesta), 'otro');
  assert.equal(sePuedeReintentar(respuesta), true);
  for (const idioma of ['es', 'ca']) {
    fijarIdioma(idioma);
    assert.equal(
      errorDeLaRespuesta(FALLO_INTERNO, { type: `${RAIZ_DE_LOS_PROBLEMAS}problema_desconocido` }).message,
      errorDeLaRespuesta(FALLO_INTERNO, {}).message,
    );
  }
  fijarIdioma('es');
  const salida = errorDeLaRespuesta(SALIDA_INVALIDA, { type: `${RAIZ_DE_LOS_PROBLEMAS}salida_invalida` });
  assert.equal(motivoDelFallo(salida), 'salida');
  assert.equal(sePuedeReintentar(salida), true);
});

test('el fallo del filtro local conserva la protección y permite buscar en la clasificación oficial', () => {
  for (const idioma of ['es', 'ca']) {
    fijarIdioma(idioma);
    const fallo = new ErrorFaro(traducible(ERROR_SIN_LIMPIEZA), 0);
    assert.equal(motivoDelFallo(fallo), 'sinLimpieza');
    assert.equal(sePuedeReintentar(fallo), false);
    assert.match(fallo.message, /(?:en este dispositivo|en aquest dispositiu)/);
    assert.match(fallo.message, /class?ificaci[oó]n? oficial/i);
    assert.doesNotMatch(fallo.message, /(?:seguir sin IA|continuar sense IA)/i);
  }
  fijarIdioma('es');
});

test('un 400 de reloj atrasado dice qué corregir en los dos idiomas; otro 400 conserva su explicación', () => {
  const atrasado = { type: `${RAIZ_DE_LOS_PROBLEMAS}reloj_atrasado` };
  const textos = {
    es: /fecha de este dispositivo parece atrasada.*Corrige la fecha y la hora/u,
    ca: /data d’aquest dispositiu sembla endarrerida.*Corregeix la data i l’hora/u,
  };
  for (const idioma of ['es', 'ca'] as const) {
    fijarIdioma(idioma);
    const fallo = errorDeLaRespuesta(SOLICITUD_INCORRECTA, atrasado);
    assert.equal(fallo.codigo, SOLICITUD_INCORRECTA);
    assert.match(fallo.message, textos[idioma]);
    assert.equal(fallo.message, resolver(traducible(ERROR_RELOJ_ATRASADO)));
    assert.equal(sePuedeReintentar(fallo), true);
    const formato = errorDeLaRespuesta(SOLICITUD_INCORRECTA, { type: `${RAIZ_DE_LOS_PROBLEMAS}solicitud_invalida` });
    assert.notEqual(formato.message, fallo.message);
    assert.equal(formato.message, errorDeLaRespuesta(SOLICITUD_INCORRECTA, {}).message);
  }
  fijarIdioma('es');
  const marcas = (texto: string | undefined) => [...(texto ?? '').matchAll(/\{\w+\}/g)].map(([marca]) => marca).sort();
  assert.ok(ERRORES_ES[ERROR_RELOJ_ATRASADO] && ERRORES_CA[ERROR_RELOJ_ATRASADO]);
  assert.deepEqual(marcas(ERRORES_ES[ERROR_RELOJ_ATRASADO]), marcas(ERRORES_CA[ERROR_RELOJ_ATRASADO]));
});

test('las respuestas que solo daría un servidor no tienen explicación propia: son el fallo general', () => {
  const general = errorDeLaRespuesta(FALLO_INTERNO, {});
  for (const codigo of SOLO_DE_UN_SERVIDOR) {
    const fallo = errorDeLaRespuesta(codigo, {});
    assert.equal(fallo.message, general.message, String(codigo));
    assert.equal(motivoDelFallo(fallo), 'otro', String(codigo));
  }
  assert.ok(!Object.hasOwn(MOTIVOS_DE_FALLO, 'conexion'));
});

test('un fallo sin respuesta que no pasa por la red no se atribuye a la conexión', () => {
  const general = new ErrorFaro(ERROR_GENERICO, 0);
  assert.equal(motivoDelFallo(general), 'otro');
  assert.equal(sePuedeReintentar(general), true);
});

test('el fallo del motor del dispositivo propone primero volver a intentarlo y deja la recarga para el final', () => {
  for (const idioma of ['es', 'ca']) {
    fijarIdioma(idioma);
    const fallo = new ErrorFaro(traducible(ERROR_DEL_MOTOR_LOCAL), 0);
    assert.equal(sePuedeReintentar(fallo), true);
    const reintentar = fallo.message.search(/Vuelve a intentarlo|Torna-ho a provar/);
    const recargar = fallo.message.search(/recarga la página|torna a carregar la pàgina/);
    assert.ok(reintentar >= 0 && recargar > reintentar, fallo.message);
  }
  fijarIdioma('es');
});

test('plazo y fallo sin respuesta conservan sus causas y el reintento', () => {
  for (const idioma of ['es', 'ca']) {
    fijarIdioma(idioma);
    const plazo = new ErrorFaro(traducible(ERROR_DE_PLAZO), 0);
    const sinRespuesta = new ErrorFaro(traducible('recorrido.error.generico'), 0);
    assert.equal(motivoDelFallo(plazo), 'tarda');
    assert.equal(motivoDelFallo(sinRespuesta), 'otro');
    assert.equal(sePuedeReintentar(plazo), true);
    assert.equal(sePuedeReintentar(sinRespuesta), true);
  }
  fijarIdioma('es');
});
