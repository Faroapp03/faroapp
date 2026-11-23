// Una navegación a una sección pública pasa por el control del portal (navegarSegunPortal, portal.js). Sin red y sin
// la página en la copia, recibe la página de sin conexión de la copia, como cualquier otra navegación (desdeLaCopia);
// si esa página falta o no cuadra con su huella, la página de estado del propio service worker.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { textoPoliticaCache } from '../../herramientas/web/politica-cache.ts';
import { paginasDelServicio } from '../../herramientas/web/servicio/politica-del-servicio.ts';
import { politicaSeccionesInicial, VERSION_SECCIONES_PUBLICAS } from '../../src/administracion/secciones-web.js';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { BASES, pedir, servicio } from './ayudas.ts';

const BIBLIOTECA = '<!doctype html><h1>Biblioteca de esta versión</h1>';
const SIN_CONEXION = '<!doctype html><h1>Sin conexión, de la copia</h1>';
const sha256 = (texto: string) => createHash('sha256').update(texto).digest('hex');
const CUERPOS: Record<string, string> = { 'biblioteca.html': BIBLIOTECA, 'sin-conexion.html': SIN_CONEXION };

/** Una instalación pública con la biblioteca abierta, sin su página en la copia y ya sin red. */
async function preparar(base: string) {
  const sw = servicio(base, {
    politica: textoPoliticaCache(),
    archivos: ['inicio.html', 'sin-conexion.html', 'biblioteca.html'],
    paginasSecciones: [['biblioteca.html', sha256(BIBLIOTECA)]],
    cuerpoDe: (ruta) => CUERPOS[ruta] ?? 'PÁGINA FIJA',
  });
  sw.conectar();
  sw.red.respuesta = (url) => {
    if (url === sw.urlDe('secciones-v3.json')) {
      return Response.json({
        version: VERSION_SECCIONES_PUBLICAS,
        autoridad: '11111111-1111-4111-8111-111111111111',
        revision: 0,
        secciones: { ...politicaSeccionesInicial(), biblioteca: true },
      });
    }
    const ruta = url.slice(base.length);
    const portal = ruta === 'inicio.html' ? { 'x-faro-portal': 'publico' } : {};
    return new Response(CUERPOS[ruta] ?? 'PÁGINA FIJA', { headers: { 'content-type': 'text/html', ...portal } });
  };
  await sw.instalar();
  const copia = sw.guardadas.get(sw.nombreCopia);
  copia?.delete(sw.urlDe('biblioteca.html'));
  sw.red.offline = true;
  const deEstado = paginasDelServicio()['sin-conexion']?.replaceAll('{{inicio}}', sw.urlDe('inicio.html'));
  return { sw, copia, deEstado };
}

for (const base of BASES) {
  test(`sin red, una sección que no está en la copia da la página de sin conexión: ${base}`, async () => {
    const { sw } = await preparar(base);
    const respuesta = await pedir(sw, 'biblioteca.html');
    assert.equal(respuesta.estado, ESTADO_HTTP.correcto);
    assert.equal(respuesta.cuerpo, SIN_CONEXION);
  });

  test(`sin red y sin la página de sin conexión en la copia, la de estado: ${base}`, async () => {
    const { sw, copia, deEstado } = await preparar(base);
    copia?.delete(sw.urlDe('sin-conexion.html'));
    const respuesta = await pedir(sw, 'biblioteca.html');
    assert.equal(respuesta.estado, ESTADO_HTTP.noDisponible);
    assert.equal(respuesta.cuerpo, deEstado);
  });

  test(`sin red y con la página de sin conexión cambiada en la copia, la de estado: ${base}`, async () => {
    const { sw, copia, deEstado } = await preparar(base);
    copia?.set(sw.urlDe('sin-conexion.html'), new Response('ALTERADA', { headers: { 'content-type': 'text/html' } }));
    const respuesta = await pedir(sw, 'biblioteca.html');
    assert.equal(respuesta.estado, ESTADO_HTTP.noDisponible);
    assert.equal(respuesta.cuerpo, deEstado);
    assert.equal(copia?.has(sw.urlDe('sin-conexion.html')), false, 'lo que no cuadra se descarta');
  });
}
