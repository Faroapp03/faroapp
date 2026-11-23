import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { rutaFueraDeLaCopia } from '../../src/plataforma/politica-cache-web.ts';

test('política: límites de segmento, codificación y rutas inválidas', () => {
  for (const ruta of [
    'api',
    'api/salud',
    'openapi.json',
    'secciones-v3.json',
    'llms.txt',
    'activar-acceso.html',
    'acceso-web',
    'acceso-web/entrar',
    'acceso-web/salir',
    'acceso%2Dweb',
    'scripts/conectividad/invitacion.js',
    '%61pi%2Fsalud',
    'scripts/activar-acceso/inicio.js',
    'administracion.html',
    'estilos/administracion.css',
    'mcp',
    'a2a',
    'oauth/token',
    '.well-known/agent-card.json',
    '.well-known/oauth-protected-resource/api/socios/v1/operaciones',
    '%',
    '%E0%A4%A',
    '/api',
    '../api',
    '%2e%2e/api',
  ]) {
    assert.equal(rutaFueraDeLaCopia(ruta), true, ruta);
  }
});

test('política: conserva páginas públicas y nombres que solo comparten un prefijo', () => {
  for (const ruta of [
    '',
    'inicio.html',
    'conectividad.html',
    'scripts/conectividad/estado.js',
    'openapi.jsonp',
    'llms.txt-ejemplo',
    'sin-conexion.html',
    'apiario.html',
    'administracion-futura.html',
    'oauth-documentacion.html',
    'configuracion.jsonp',
    '.well-known/security.txt',
    'scripts/acceso.js',
    'estilos/activar-acceso-extra.css',
    'motor/src/plataforma/navegador/motor.js',
  ]) {
    assert.equal(rutaFueraDeLaCopia(ruta), false, ruta);
  }
});

test('los nombres del paquete oficial vigente cumplen la frontera sin cambiar datos', () => {
  const manifiesto: unknown = JSON.parse(readFileSync(new URL('../../datos/manifiesto.json', import.meta.url), 'utf8'));
  assert.ok(typeof manifiesto === 'object' && manifiesto !== null);
  const nombres = Object.keys(manifiesto);
  assert.ok(nombres.length);
  assert.ok(nombres.every((nombre) => /^[a-z0-9-]+\.json$/.test(nombre)));
});

test('el callback de Cloudflare Access queda fuera de la copia', () => {
  assert.equal(rutaFueraDeLaCopia('cdn-cgi/access/authorized'), true);
});
