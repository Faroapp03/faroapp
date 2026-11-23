import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { textoPoliticaCache } from '../../herramientas/web/politica-cache.ts';
import { paginasDelServicio } from '../../herramientas/web/servicio/politica-del-servicio.ts';
import { politicaSeccionesInicial, VERSION_SECCIONES_PUBLICAS } from '../../src/administracion/secciones-web.js';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { EXTENSIONES } from '../../src/plataforma/extensiones.ts';
import { BASES, pedir, servicio } from './ayudas.ts';

const RECORRIDO = '<!doctype html><h1>Tu recorrido, de esta versión</h1>';
const FORMULARIO = '<!doctype html><h1>Acceso al recorrido</h1><form method="post"></form>';
const HUELLA = createHash('sha256').update(RECORRIDO).digest('hex');
const PROTEGIDAS = EXTENSIONES.map(({ entrada }) => entrada);

/** Una instalación con el recorrido real en su copia; `portal` es la marca de su inicio y `pagina`, lo que da la red. */
function preparar(base: string, portal: 'publico' | 'privado') {
  const sw = servicio(base, {
    politica: textoPoliticaCache(),
    archivos: ['inicio.html', 'sin-conexion.html', 'recorrido.html'],
    paginasSecciones: [['recorrido.html', HUELLA]],
    cuerpoDe: (ruta) => (ruta === 'recorrido.html' ? RECORRIDO : 'PÁGINA FIJA'),
  });
  const estado = { pagina: RECORRIDO, recorrido: true };
  sw.conectar();
  sw.red.respuesta = (url) => {
    if (url === sw.urlDe('secciones-v3.json')) {
      return Response.json({
        version: VERSION_SECCIONES_PUBLICAS,
        autoridad: '11111111-1111-4111-8111-111111111111',
        revision: estado.recorrido ? 0 : 1,
        secciones: { ...politicaSeccionesInicial(), recorrido: estado.recorrido },
      });
    }
    if (url === sw.urlDe('recorrido.html')) {
      return new Response(estado.pagina, { headers: { 'content-type': 'text/html' } });
    }
    return new Response('PÁGINA FIJA', {
      headers: { 'content-type': 'text/html', ...(url === sw.urlDe('inicio.html') ? { 'x-faro-portal': portal } : {}) },
    });
  };
  const pagina = (estadoDelServicio: string) =>
    paginasDelServicio()[estadoDelServicio]?.replaceAll('{{inicio}}', sw.urlDe('inicio.html'));
  return { sw, estado, pagina };
}

for (const base of BASES) {
  test(`pública con la copia completa: sin red, empezar y reabrir dan el recorrido de la copia: ${base}`, async () => {
    const { sw } = preparar(base, 'publico');
    await sw.instalar();
    assert.equal((await pedir(sw, 'recorrido.html')).cuerpo, RECORRIDO, 'con red, la de la red');
    sw.red.offline = true;
    for (const ruta of ['recorrido.html', 'recorrido', 'recorrido.html?idioma=ca', '%72ecorrido.html']) {
      const respuesta = await pedir(sw, ruta);
      assert.equal(respuesta.estado, ESTADO_HTTP.correcto, ruta);
      assert.equal(respuesta.cuerpo, RECORRIDO, ruta);
    }
  });

  test(`pública con la copia incompleta: la instalación sigue y, sin red, la página de sin conexión: ${base}`, async () => {
    const { sw, estado, pagina } = preparar(base, 'publico');
    estado.pagina = FORMULARIO;
    await sw.instalar();
    assert.equal(sw.guardadas.get(sw.nombreCopia)?.has(sw.urlDe('recorrido.html')), false);
    assert.equal(sw.guardadas.get(sw.nombreCopia)?.has(sw.urlDe('inicio.html')), true);
    sw.red.offline = true;
    const respuesta = await pedir(sw, 'recorrido.html');
    assert.equal(respuesta.estado, ESTADO_HTTP.correcto);
    assert.equal(respuesta.cuerpo, 'PÁGINA FIJA', 'la página de sin conexión de la copia');
    sw.guardadas.get(sw.nombreCopia)?.set(sw.urlDe('sin-conexion.html'), new Response('ALTERADA'));
    const sinPagina = await pedir(sw, 'recorrido.html');
    assert.equal(sinPagina.estado, ESTADO_HTTP.noDisponible);
    assert.equal(sinPagina.cuerpo, pagina('sin-conexion'), 'si no cuadra, la del service worker');
  });

  test(`pública: la variante protegida de una extensión nunca sale de la copia: ${base}`, async () => {
    const { sw, pagina } = preparar(base, 'publico');
    await sw.instalar();
    for (const entrada of PROTEGIDAS) {
      sw.guardadas.get(sw.nombreCopia)?.set(sw.urlDe(entrada), new Response('PROTEGIDA ANTERIOR'));
    }
    sw.red.offline = true;
    for (const entrada of PROTEGIDAS) {
      const respuesta = await pedir(sw, entrada);
      assert.equal(respuesta.estado, ESTADO_HTTP.correcto, entrada);
      assert.equal(respuesta.cuerpo, 'PÁGINA FIJA', entrada);
    }
    sw.guardadas.get(sw.nombreCopia)?.delete(sw.urlDe('sin-conexion.html'));
    for (const entrada of PROTEGIDAS) {
      const respuesta = await pedir(sw, entrada);
      assert.equal(respuesta.estado, ESTADO_HTTP.noDisponible, entrada);
      assert.equal(respuesta.cuerpo, pagina('sin-conexion'), entrada);
    }
  });

  test(`detrás de un portal (variante inactiva o protegida), sin red, el 503 del acceso y nunca la copia: ${base}`, async () => {
    const { sw, pagina } = preparar(base, 'privado');
    await sw.instalar();
    assert.equal(sw.guardadas.get(sw.nombreCopia)?.has(sw.urlDe('recorrido.html')), true);
    sw.red.offline = true;
    for (const ruta of ['recorrido.html', 'recorrido', ...PROTEGIDAS]) {
      const respuesta = await pedir(sw, ruta);
      assert.equal(respuesta.estado, ESTADO_HTTP.noDisponible, ruta);
      assert.equal(respuesta.cuerpo, pagina('acceso-sin-conexion'), ruta);
    }
  });

  test(`la variante cambiada en el servidor: con red manda su respuesta, no la copia: ${base}`, async () => {
    const { sw, estado } = preparar(base, 'publico');
    await sw.instalar();
    estado.pagina = FORMULARIO;
    const respuesta = await pedir(sw, 'recorrido.html');
    assert.equal(respuesta.cuerpo, FORMULARIO);
    assert.equal(sw.guardadas.get(sw.nombreCopia)?.has(sw.urlDe('recorrido.html')), true);
  });

  test(`la sección del recorrido cerrada por la entidad no se abre sin red desde la copia: ${base}`, async () => {
    const { sw, estado, pagina } = preparar(base, 'publico');
    await sw.instalar();
    estado.recorrido = false;
    await pedir(sw, 'informe-ejemplo.html');
    sw.red.offline = true;
    const respuesta = await pedir(sw, 'recorrido.html');
    assert.equal(respuesta.estado, ESTADO_HTTP.noEncontrado);
    assert.equal(respuesta.cuerpo, pagina('retirada'));
  });
}
