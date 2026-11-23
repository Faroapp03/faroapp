import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BASES, pedir, servicio } from './ayudas.ts';

const CIFRAS_SHA256 = 64;
const RUTAS_OPERATIVAS = [
  'api',
  'api?x=1',
  'api/',
  'api/salud?x=1',
  'api%2Fsalud',
  '%61pi/salud',
  'activar-acceso.html',
  'acceso-web',
  'acceso-web/entrar',
  'acceso-web/salir',
  'acceso%2Dweb',
  'a%63tivar-acceso.html?idioma=ca',
  'activar-acceso.html?acceso=renovar',
  'administracion',
  'administracion/',
  'administracion.html?x=1',
  'administracion/usuarios',
  'scripts/activar-acceso/inicio.js',
  'estilos/activar-acceso.css',
  'scripts/administracion.js',
  'mcp',
  'a2a',
  'oauth/token',
  'avisos-del-navegador',
  'configuracion.json',
  'openapi.json',
  'openapi.json?contrato=actual',
  'llms.txt',
  'llms.txt?consulta=actual',
  '.well-known/agent-card.json',
  '.well-known/api-catalog',
  '.well-known/oauth-authorization-server/api/socios/v1',
  '.well-known/oauth-protected-resource/mcp',
];

for (const base of BASES) {
  for (const ruta of RUTAS_OPERATIVAS) {
    test(`fuera de captura: ${base}${ruta}`, async () => {
      const sw = servicio(base);
      sw.guardadas.set(sw.nombreCopia, new Map([[sw.urlDe(ruta), new Response('DATO RESIDUAL')]]));
      const resultado = await pedir(sw, ruta);
      assert.equal(resultado.interceptada, false);
      assert.equal(resultado.aperturas, 0);
      assert.deepEqual(sw.peticiones, []);
    });
  }
  test(`catálogos contaminados no precargan rutas operativas: ${base}`, async () => {
    const sw = servicio(base, {
      archivos: ['inicio.html', 'sin-conexion.html', ...RUTAS_OPERATIVAS],
      bajoDemanda: ['activar-acceso.html'],
      comprobados: [['scripts/activar-acceso/inicio.js', '0'.repeat(CIFRAS_SHA256)]],
    });
    sw.conectar();
    await sw.instalar().catch(() => {});
    assert.deepEqual(sw.peticiones.sort(), [sw.urlDe('inicio.html'), sw.urlDe('sin-conexion.html')].sort());
    for (const mapa of sw.guardadas.values()) {
      assert.ok([...mapa.keys()].every((url) => url.endsWith('/inicio.html') || url.endsWith('/sin-conexion.html')));
    }
  });
}
