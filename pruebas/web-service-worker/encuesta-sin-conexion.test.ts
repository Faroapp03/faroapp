import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { textoPoliticaCache } from '../../herramientas/web/politica-cache.ts';
import { politicaSeccionesInicial, VERSION_SECCIONES_PUBLICAS } from '../../src/administracion/secciones-web.js';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { BASES, pedir, servicio } from './ayudas.ts';

const HTML = '<!doctype html><h1>Encuesta de esta versión</h1>';
const HUELLA = createHash('sha256').update(HTML).digest('hex');
const AUTORIDAD = '11111111-1111-4111-8111-111111111111';
/** La política pública vigente: lleva las diez secciones del contrato vigente, la Encuesta incluida. */
const documento = (revision: number, encuesta: boolean) => ({
  version: VERSION_SECCIONES_PUBLICAS,
  autoridad: AUTORIDAD,
  revision,
  secciones: { ...politicaSeccionesInicial(), encuesta },
});

function preparar(base: string) {
  const sw = servicio(base, {
    politica: textoPoliticaCache(),
    archivos: ['inicio.html', 'sin-conexion.html', 'encuesta.html'],
    paginasSecciones: [['encuesta.html', HUELLA]],
    cuerpoDe: (ruta) => (ruta === 'encuesta.html' ? HTML : 'PÁGINA FIJA'),
  });
  let politica = documento(0, true);
  sw.conectar();
  sw.red.respuesta = (url) => {
    if (url === sw.urlDe('secciones-v3.json')) {
      return Response.json(politica);
    }
    return new Response(url === sw.urlDe('encuesta.html') ? HTML : 'PÁGINA FIJA', {
      headers: {
        'content-type': 'text/html',
        ...(url === sw.urlDe('inicio.html') ? { 'x-faro-portal': 'publico' } : {}),
      },
    });
  };
  return {
    sw,
    politica: (revision: number, encuesta: boolean) => {
      politica = documento(revision, encuesta);
    },
  };
}

for (const base of BASES) {
  test(`la Encuesta cerrada en el panel responde sin conexión como sección retirada: ${base}`, async () => {
    const { sw, politica } = preparar(base);
    await sw.instalar();
    assert.equal(await sw.guardadas.get(sw.nombreCopia)?.get(sw.urlDe('encuesta.html'))?.clone().text(), HTML);
    sw.red.offline = true;
    assert.equal((await pedir(sw, 'encuesta.html')).cuerpo, HTML, 'abierta, se abre desde la copia');
    sw.conectar();
    politica(1, false);
    assert.equal((await pedir(sw, 'encuesta.html')).estado, ESTADO_HTTP.noEncontrado);
    sw.red.offline = true;
    const sinRed = await pedir(sw, 'encuesta.html');
    assert.equal(sinRed.estado, ESTADO_HTTP.noEncontrado, 'el cierre aprendido sobrevive sin red');
    assert.doesNotMatch(String(sinRed.cuerpo), /Encuesta de esta versión/u, 'no muestra la copia guardada');
  });

  test(`con la Encuesta cerrada al instalar, la copia no la guarda y sin red sigue cerrada: ${base}`, async () => {
    const { sw, politica } = preparar(base);
    politica(0, false);
    await sw.instalar();
    assert.ok(!sw.peticiones.includes(sw.urlDe('encuesta.html')));
    assert.ok(!sw.guardadas.get(sw.nombreCopia)?.has(sw.urlDe('encuesta.html')));
    sw.red.offline = true;
    assert.equal((await pedir(sw, 'encuesta.html')).estado, ESTADO_HTTP.noEncontrado);
  });

  test(`una política v3 guardada antes de la Encuesta la lee visible sin conexión: ${base}`, async () => {
    const { sw } = preparar(base);
    await sw.instalar();
    // La copia de la política, como la dejó una versión anterior: v3 pública, con las nueve claves del contrato v2.
    const { encuesta: _encuesta, ...anteriores } = politicaSeccionesInicial();
    const anterior = { version: 3, autoridad: AUTORIDAD, revision: 0, secciones: anteriores };
    const url = sw.urlDe('secciones-v3.json');
    sw.guardadas.set(
      `faro-secciones-v3:${base}`,
      new Map([
        [`${url}?actual=1`, Response.json(anterior)],
        [`${url}?autoridad=${AUTORIDAD}`, Response.json(anterior)],
      ]),
    );
    sw.red.offline = true;
    const respuesta = await pedir(sw, 'encuesta.html');
    assert.equal(respuesta.estado, ESTADO_HTTP.correcto);
    assert.equal(respuesta.cuerpo, HTML);
  });
}
