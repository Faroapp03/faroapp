// Los textos del recorrido dicen lo que de verdad ocurre: todo se hace en el dispositivo, las tareas propias sin una
// referencia oficial quedan sin nota y el código para pasar el resultado no va cifrado. Igual en los dos idiomas.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { ERRORES_RECORRIDO as ERRORES_CA } from '../../web/idiomas/ca/errores-recorrido.js';
import { TEXTOS_RECORRIDO as CA } from '../../web/idiomas/ca/recorrido.js';
import { ERRORES_RECORRIDO as ERRORES_ES } from '../../web/idiomas/es/errores-recorrido.js';
import { TEXTOS_RECORRIDO as ES } from '../../web/idiomas/es/recorrido.js';

const IDIOMAS = [
  { idioma: 'es', textos: { ...ES, ...ERRORES_ES }, dispositivo: /este dispositivo/, conexion: /conexi[oó]n|conectar/ },
  {
    idioma: 'ca',
    textos: { ...CA, ...ERRORES_CA },
    dispositivo: /aquest dispositiu/,
    conexion: /connexi[oó]|connectar/,
  },
] as const;
const HTML = readFileSync(new URL('../../web/recorrido.html', import.meta.url), 'utf8');

/** El texto de `clave` en `textos`; falla si no está. */
function texto(textos: Readonly<Record<string, string>>, clave: string): string {
  const valor = textos[clave];
  assert.equal(typeof valor, 'string', clave);
  return String(valor);
}

test('tras un fallo del motor, el texto y el botón del informe dicen lo mismo: solo con las tareas oficiales', () => {
  for (const { idioma, textos, dispositivo } of IDIOMAS) {
    const fallo = texto(textos, 'recorrido.informe.fallo-al-prepararlo');
    const boton = texto(textos, 'recorrido.informe.solo-oficiales');
    assert.doesNotMatch(fallo, dispositivo, idioma);
    assert.doesNotMatch(boton, dispositivo, idioma);
    assert.match(fallo, /tareas oficiales|tasques oficials/, idioma);
    assert.match(boton, /tareas oficiales|tasques oficials/, idioma);
    assert.equal(textos['recorrido.informe.en-el-dispositivo'], undefined, idioma);
    assert.equal(textos['recorrido.informe.fallo-del-servidor'], undefined, idioma);
  }
});

test('ningún error ni motivo del recorrido atribuye a la conexión un fallo del motor del dispositivo', () => {
  for (const { idioma, textos, conexion } of IDIOMAS) {
    for (const clave of [
      'recorrido.motivo.conexion',
      'recorrido.motivo.sin-conexion',
      'recorrido.error.sin-conexion',
      'recorrido.error.servicio-no-disponible',
    ]) {
      assert.equal(textos[clave], undefined, `${idioma}: ${clave}`);
    }
    for (const clave of ['recorrido.error.motor-local', 'recorrido.error.sin-resultado', 'recorrido.motivo.otro']) {
      assert.doesNotMatch(texto(textos, clave), conexion, `${idioma}: ${clave}`);
    }
  }
});

test('ningún texto promete estimar la nota de una tarea propia: sin referencia oficial queda sin nota', () => {
  for (const { idioma, textos } of IDIOMAS) {
    for (const clave of ['recorrido.tareas.algo-mas-nota', 'recorrido.dialogo.aviso']) {
      const valor = texto(textos, clave);
      assert.doesNotMatch(valor, /estima|estimaci/, `${idioma}: ${clave}`);
      assert.match(valor, /sin nota|sense nota/, `${idioma}: ${clave}`);
    }
  }
  assert.doesNotMatch(HTML, /estima su nota|las estimaciones de Faro se identifican/);
});

test('una tarea escrita a mano solo tiene tarea oficial si la persona la elige: Faro no la busca por su cuenta', () => {
  for (const { idioma, textos } of IDIOMAS) {
    const nota = texto(textos, 'recorrido.tareas.algo-mas-nota');
    assert.doesNotMatch(nota, /Faro busca|Faro cerca/, idioma);
    assert.match(nota, /elígela en su lista|tria-la a la seva llista/, idioma);
  }
  assert.doesNotMatch(HTML, /Faro\s+busca\s+la\s+tarea\s+oficial/);
  assert.match(HTML, /elígela\s+en\s+su\s+lista/);
});

test('las tareas propias sin nota se explican sin hablar de un intento de estimar', () => {
  const claves = [
    'recorrido.motivo.sin-estimacion-acreditada',
    'recorrido.informe.sin-citar-una',
    'recorrido.informe.sin-citar-varias',
    'recorrido.informe.sin-estimar-una',
    'recorrido.informe.sin-estimar-varias',
    'recorrido.informe.hecho-sin-las-tuyas',
    'recorrido.informe.hecho-solo-oficiales',
  ];
  for (const { idioma, textos, dispositivo } of IDIOMAS) {
    for (const clave of claves) {
      const valor = texto(textos, clave);
      assert.doesNotMatch(valor, /estimar|estimaci|estimació|acreditad/, `${idioma}: ${clave}`);
      assert.doesNotMatch(valor, dispositivo, `${idioma}: ${clave}`);
    }
    for (const clave of ['recorrido.informe.sin-estimar-una', 'recorrido.informe.sin-estimar-varias']) {
      assert.match(texto(textos, clave), /escribiste|has escrit/, `${idioma}: ${clave}`);
      assert.match(texto(textos, clave), /tarea oficial|tasca oficial/, `${idioma}: ${clave}`);
    }
  }
});

test('el informe solo con las tareas oficiales no promete conservar las tareas propias', () => {
  for (const { idioma, textos } of IDIOMAS) {
    const fuera = texto(textos, 'recorrido.informe.hecho-sin-las-tuyas');
    assert.match(fuera, /fuera|fora/, idioma);
    assert.doesNotMatch(fuera, /conserva/, idioma);
    for (const clave of ['recorrido.informe.fallo-al-prepararlo', 'recorrido.informe.solo-oficiales']) {
      assert.doesNotMatch(texto(textos, clave), /conserva/, `${idioma}: ${clave}`);
    }
  }
  assert.equal(ES['recorrido.informe.hecho-en-el-dispositivo'], undefined);
  assert.equal(CA['recorrido.informe.hecho-en-el-dispositivo'], undefined);
});

test('el diálogo del QR dice que quien vea el código ve la ocupación y las tareas, y que no va cifrado', () => {
  for (const { idioma, textos } of IDIOMAS) {
    const aviso = texto(textos, 'recorrido.pasar.aviso');
    assert.match(aviso, /ocupación|ocupació/, idioma);
    assert.match(aviso, /tareas oficiales|tasques oficials/, idioma);
    assert.match(aviso, /no va cifrado|no va xifrat/, idioma);
    assert.match(aviso, /con tus palabras|amb les teves paraules/, idioma);
  }
});
