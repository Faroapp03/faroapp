/**
 * Guardias de la invitación del piloto sobre las fuentes de la web: el código no viaja al servidor antes de responder y
 * «Borrar todo» lo retira. La conducta en la página está en pruebas/web-recorrido-pasos/invitacion-encuesta.test.ts.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const leer = (ruta: string) => readFileSync(new URL(`../../${ruta}`, import.meta.url), 'utf8');

test('«Borrar todo» retira la invitación: su clave es de Faro y el borrado limpia el almacenamiento de la pestaña', () => {
  assert.match(leer('web/scripts/invitacion.js'), /export const CLAVE_INVITACION = 'faro-invitacion';/);
  const borrado = leer('web/scripts/borrar-datos.js');
  assert.match(borrado, /const PREFIJO = 'faro-';/);
  assert.match(borrado, /borrarClaves\(sessionStorage\)/);
});

/** Los guiones de la web, con su ruta relativa. */
function guionesDeLaWeb(carpeta = fileURLToPath(new URL('../../web/scripts/', import.meta.url))): string[] {
  return readdirSync(carpeta).flatMap((nombre) => {
    const ruta = join(carpeta, nombre);
    if (statSync(ruta).isDirectory()) {
      return guionesDeLaWeb(ruta);
    }
    return nombre.endsWith('.js') ? [ruta] : [];
  });
}

test('el código de la invitación no viaja al servidor antes de responder', () => {
  const fuente = leer('web/scripts/invitacion.js');
  // El módulo de la invitación no hace peticiones ni pone el código en ninguna consulta.
  assert.doesNotMatch(fuente, /fetch|sendBeacon|XMLHttpRequest|WebSocket|EventSource|new Image|\?codigo|search\s*\+/);
  assert.match(fuente, /return `encuesta\.html#codigo=\$\{codigo\}`;/);
  // Solo la invitación y la vista final leen la invitación guardada; ningún guion del recorrido la lleva a la API.
  const lectores = guionesDeLaWeb()
    .filter((ruta) => /faro-invitacion|invitacionGuardada|CLAVE_INVITACION/.test(readFileSync(ruta, 'utf8')))
    .map((ruta) => ruta.split('/web/scripts/')[1])
    .sort();
  assert.deepEqual(lectores, ['invitacion.js', 'recorrido/entrega-final.js']);
});
