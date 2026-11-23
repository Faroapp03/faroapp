import './ayudas.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AVISO_DATOS, AVISO_DATOS_CA } from '../../src/seguridad/avisos.ts';
import { MAX_TAREA } from '../../src/seguridad/limites.ts';
import { limpiarDatosPersonales } from '../../src/seguridad/privacidad.ts';
import {
  conAvisoDeDatos,
  limpiarCuerpo,
  minimizarParaEnviar,
  RutaSinFiltro,
} from '../../web/scripts/recorrido/minimizar.js';
import { cargas } from './ayudas.ts';

const limpiador = {
  limpiar: limpiarDatosPersonales,
  avisoEs: AVISO_DATOS,
  avisoCa: AVISO_DATOS_CA,
  maxTarea: MAX_TAREA,
};
const RELATO = 'Me llamo Rocío Benítez, mi móvil es 654 321 098 y soy cajera en un supermercado.';

test('cada ruta limpia solo sus campos de texto y conserva el resto exacto sin mutar entrada', () => {
  const estimacion = { valor: 0.4, firma: 'f' };
  const casos = [
    {
      ruta: '/informe',
      cuerpo: { ocupacionPersona: 'cajera', tareas: [{ texto: RELATO }], idioma: 'ca' },
      esperado: { ocupacionPersona: 'cajera', tareas: [{ texto: limpiarDatosPersonales(RELATO).texto }], idioma: 'ca' },
    },
    {
      ruta: '/informe?formato=html',
      cuerpo: { ocupacionPersona: 'cajera, móvil 654 321 098', tareas: [{ texto: 'Cobro', estimacion }] },
      esperado: { ocupacionPersona: 'cajera, móvil [teléfono eliminado]', tareas: [{ texto: 'Cobro', estimacion }] },
    },
  ];
  for (const { ruta, cuerpo, esperado } of casos) {
    const original = structuredClone(cuerpo);
    assert.deepEqual(limpiarCuerpo(limpiador, ruta, cuerpo).cuerpo, esperado, ruta);
    assert.deepEqual(cuerpo, original, ruta);
  }
});

test('no cambia texto sin detecciones, y una ruta fuera de la lista no se da por limpia', () => {
  assert.deepEqual(
    limpiarCuerpo(limpiador, '/informe', { ocupacionPersona: 'reponedor', tareas: [{ texto: 'Repongo' }] }),
    {
      cuerpo: { ocupacionPersona: 'reponedor', tareas: [{ texto: 'Repongo' }] },
      eliminados: 0,
    },
  );
  assert.throws(() => limpiarCuerpo(limpiador, '/grupos', { texto: RELATO }), RutaSinFiltro);
  assert.throws(() => limpiarCuerpo(limpiador, '/hoja-de-ruta', { texto: RELATO }), RutaSinFiltro);
});

test('avisa una vez en ES/CA y conserva avisos/cuenta de la respuesta', () => {
  for (const [idioma, texto] of [
    ['es', AVISO_DATOS],
    ['ca', AVISO_DATOS_CA],
  ]) {
    assert.deepEqual(conAvisoDeDatos(limpiador, { tareas: [], avisos: [], datosEliminados: 0 }, 2, idioma), {
      tareas: [],
      avisos: [{ tipo: 'datos-personales', texto }],
      datosEliminados: 2,
    });
  }
  const existente = { avisos: [{ tipo: 'datos-personales', texto: AVISO_DATOS }] };
  assert.equal(conAvisoDeDatos(limpiador, existente, 1, 'es'), existente);
  assert.equal(conAvisoDeDatos(limpiador, existente, 0, 'es'), existente);
});

test('el límite del adaptador no parte un par sustituto tras expandir una marca', () => {
  const entrada = '654 321 098 ';
  const marca = limpiarDatosPersonales(entrada).texto;
  const tarea = `${entrada + 'x'.repeat(MAX_TAREA - marca.length - 1)}😀`;
  assert.ok(tarea.length <= MAX_TAREA);
  const limpio = limpiarDatosPersonales(tarea);
  assert.equal(limpio.eliminados, 1);
  assert.equal(limpio.texto.indexOf('😀'), MAX_TAREA - 1);
  const tareas = limpiarCuerpo(limpiador, '/informe', { tareas: [{ texto: tarea }] }).cuerpo.tareas;
  assert.ok(Array.isArray(tareas));
  const salida = String(tareas[0].texto);
  assert.equal(salida.isWellFormed(), true);
  assert.equal(salida, limpio.texto.slice(0, MAX_TAREA - 1));
});

test('la carga usa las tres rutas canónicas del motor admitido, sin compilación necesaria en la prueba', async () => {
  const salida = await minimizarParaEnviar('/informe', { ocupacionPersona: 'cajera', tareas: [{ texto: RELATO }] });
  assert.ok(salida, 'La limpieza del motor/src debe cargar');
  assert.deepEqual(salida.cuerpo, {
    ocupacionPersona: 'cajera',
    tareas: [{ texto: limpiarDatosPersonales(RELATO).texto }],
  });
  assert.deepEqual([...cargas].sort(), ['avisos.js', 'limites.js', 'privacidad.js']);
});
