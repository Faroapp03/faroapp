import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BASES, pedir, servicio } from './ayudas.ts';

const CORRECTO = 200;
const NO_DISPONIBLE = 503;
for (const base of BASES) {
  test(`controles públicos actuales: ${base}`, async () => {
    // Lo guardado es lo de esta versión: se vuelve a comprobar con su huella al servirlo.
    const cuerpos: Record<string, string> = { 'inicio.html': 'INICIO', 'sin-conexion.html': 'SIN CONEXIÓN' };
    const sw = servicio(base, { cuerpoDe: (ruta) => cuerpos[ruta] ?? ruta });
    sw.guardadas.set(
      sw.nombreCopia,
      new Map([
        [sw.urlDe('inicio.html'), new Response('INICIO', { headers: { 'x-faro-portal': 'publico' } })],
        [sw.urlDe('sin-conexion.html'), new Response('SIN CONEXIÓN')],
        [sw.urlDe('activar-acceso.html'), new Response('ACCESO RESIDUAL')],
      ]),
    );
    assert.equal((await pedir(sw, 'inicio.html?idioma=ca')).cuerpo, 'INICIO');
    assert.equal((await pedir(sw, './')).cuerpo, 'INICIO');
    assert.equal((await pedir(sw, 'no-existe.html')).cuerpo, 'SIN CONEXIÓN');
    assert.equal((await pedir(sw, 'apiario.html')).cuerpo, 'SIN CONEXIÓN');
    assert.equal((await pedir(sw, '.well-known/security.txt')).cuerpo, 'SIN CONEXIÓN');
    assert.equal((await pedir(sw, 'inicio.html?acceso=renovar')).cuerpo, 'INICIO');
    assert.equal((await pedir(sw, 'scripts/no-existe.js', { mode: 'cors', method: 'GET' })).interceptada, false);
    assert.equal((await pedir(sw, 'inicio.html', { mode: 'navigate', method: 'POST' })).interceptada, false);
    assert.equal((await pedir(sw, 'https://otro.invalid/inicio.html')).interceptada, false);
    assert.equal((await pedir(sw, 'motor/copia-comprobada.json', { mode: 'cors', method: 'GET' })).estado, CORRECTO);
    assert.equal(
      (await pedir(sw, 'paquete/invalido/datos.json', { mode: 'cors', method: 'GET' })).estado,
      NO_DISPONIBLE,
    );
  });
  test(`instalación pública y activación por alcance: ${base}`, async () => {
    const sw = servicio(base);
    sw.conectar();
    await sw.instalar();
    assert.deepEqual(
      [...(sw.guardadas.get(sw.nombreCopia)?.keys() ?? [])].sort(),
      [sw.urlDe('inicio.html'), sw.urlDe('sin-conexion.html')].sort(),
    );
    sw.guardadas.set(`faro:${base}:anterior`, new Map());
    sw.guardadas.set('faro:https://otra.invalid/:anterior', new Map());
    sw.guardadas.set('faro-paquete-otra-version', new Map());
    await sw.activar();
    assert.equal(sw.activaciones, 1);
    assert.equal(sw.guardadas.has(`faro:${base}:anterior`), false);
    assert.equal(sw.guardadas.has('faro:https://otra.invalid/:anterior'), true);
    assert.equal(sw.guardadas.has('faro-paquete-otra-version'), true);
  });
}
