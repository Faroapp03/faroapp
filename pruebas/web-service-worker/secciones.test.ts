import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { textoPoliticaCache } from '../../herramientas/web/politica-cache.ts';
import { politicaSeccionesInicial, VERSION_SECCIONES_PUBLICAS } from '../../src/administracion/secciones-web.js';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { BASES, pedir, servicio } from './ayudas.ts';

const HTML = '<!doctype html><h1>Biblioteca de esta versión</h1>';
const REVISION_RETIRADA_POSTERIOR = 3;
const REVISION_TARDIA = 4;
const HUELLA = createHash('sha256').update(HTML).digest('hex');
const documento = (revision = 0, biblioteca = true) => ({
  version: VERSION_SECCIONES_PUBLICAS,
  autoridad: '11111111-1111-4111-8111-111111111111',
  revision,
  secciones: { ...politicaSeccionesInicial(), biblioteca },
});
function preparar(base: string) {
  const sw = servicio(base, {
    politica: textoPoliticaCache(),
    archivos: ['inicio.html', 'sin-conexion.html', 'biblioteca.html'],
    paginasSecciones: [['biblioteca.html', HUELLA]],
    cuerpoDe: (ruta) => (ruta === 'biblioteca.html' ? HTML : 'PÁGINA FIJA'),
  });
  let politica = documento();
  let html = HTML;
  let errorPolitica: Response | undefined;
  let errorPagina: Response | undefined;
  sw.conectar();
  sw.red.respuesta = (url) => {
    if (url === sw.urlDe('secciones-v3.json')) {
      return errorPolitica?.clone() ?? Response.json(politica);
    }
    if (url === sw.urlDe('biblioteca.html')) {
      return errorPagina?.clone() ?? new Response(html, { headers: { 'content-type': 'text/html' } });
    }
    return new Response('PÁGINA FIJA', {
      headers: {
        'content-type': 'text/html',
        ...(url === sw.urlDe('inicio.html') ? { 'x-faro-portal': 'publico' } : {}),
      },
    });
  };
  return {
    sw,
    politica: (revision: number, activa: boolean) => {
      politica = documento(revision, activa);
    },
    html: (texto: string) => {
      html = texto;
    },
    falloPolitica: (respuesta: Response | undefined) => {
      errorPolitica = respuesta;
    },
    falloPagina: (respuesta: Response | undefined) => {
      errorPagina = respuesta;
    },
  };
}

for (const base of BASES) {
  test(`una política legada de otra instalación no bloquea v3 revisión cero: ${base}`, async () => {
    const { sw } = preparar(base);
    const { autoridad: _autoridad, ...resto } = documento(1, false);
    const legado = new Map([
      [sw.urlDe('secciones.json?revision=1&estado=111111011'), Response.json({ ...resto, version: 2 })],
    ]);
    sw.guardadas.set(`faro-secciones:${base}`, legado);
    await sw.instalar();
    assert.equal((await pedir(sw, 'biblioteca.html')).estado, ESTADO_HTTP.correcto);
    assert.equal(legado.size, 1);
  });

  test(`secciones: instalación omite solo HTML retirado y reactivación admite su misma versión: ${base}`, async () => {
    const { sw, politica } = preparar(base);
    politica(1, false);
    await sw.instalar();
    assert.ok(!sw.peticiones.includes(sw.urlDe('biblioteca.html')));
    assert.ok(!sw.guardadas.get(sw.nombreCopia)?.has(sw.urlDe('biblioteca.html')));
    assert.equal((await pedir(sw, 'biblioteca.html')).estado, ESTADO_HTTP.noEncontrado);
    politica(2, true);
    assert.equal((await pedir(sw, 'biblioteca.html?idioma=ca')).cuerpo, HTML);
    assert.equal(await sw.guardadas.get(sw.nombreCopia)?.get(sw.urlDe('biblioteca.html'))?.clone().text(), HTML);
    politica(REVISION_RETIRADA_POSTERIOR, false);
    assert.equal(
      (await pedir(sw, 'biblioteca.html')).estado,
      ESTADO_HTTP.noEncontrado,
      'no elude la guardia aunque esté guardada',
    );
    sw.red.offline = true;
    assert.equal(
      (await pedir(sw, 'biblioteca.html')).estado,
      ESTADO_HTTP.noEncontrado,
      'la retirada aprendida sobrevive sin red',
    );
    await sw.activar();
    assert.ok([...sw.guardadas.keys()].some((nombre) => nombre.startsWith('faro-secciones-v3:')));
  });

  test(`secciones: reactivación no mezcla HTML nuevo con recursos de una versión antigua: ${base}`, async () => {
    const { sw, politica, html } = preparar(base);
    politica(0, false);
    await sw.instalar();
    politica(1, true);
    html('<h1>Otra publicación</h1>');
    const recibida = await pedir(sw, 'biblioteca.html');
    assert.equal(recibida.estado, ESTADO_HTTP.noDisponible);
    assert.match(
      recibida.cuerpo ?? '',
      /^(?!.*(?:sin conexión|sense connexió)).*Esta página no está disponible.*Aquesta pàgina no està disponible/su,
    );
    assert.ok(!sw.guardadas.get(sw.nombreCopia)?.has(sw.urlDe('biblioteca.html')));
    html(HTML);
    assert.equal((await pedir(sw, 'biblioteca.html')).cuerpo, HTML);
  });

  test(`secciones: sin política no hay permiso implícito ni instalación parcial: ${base}`, async () => {
    const { sw } = preparar(base);
    sw.red.offline = true;
    assert.equal((await pedir(sw, 'biblioteca.html')).estado, ESTADO_HTTP.noDisponible);
    await assert.rejects(sw.instalar(), /disponibilidad/);
    sw.guardadas.set(
      sw.nombreCopia,
      new Map([[sw.urlDe('inicio.html'), new Response('PÁGINA FIJA', { headers: { 'x-faro-portal': 'publico' } })]]),
    );
    assert.equal((await pedir(sw, 'inicio.html')).cuerpo, 'PÁGINA FIJA');
  });

  test(`secciones: error HTTP o contrato defectuoso no se tapan con una autorización anterior: ${base}`, async () => {
    const { sw, falloPolitica } = preparar(base);
    await sw.instalar();
    for (const respuesta of [
      new Response('', { status: ESTADO_HTTP.noDisponible }),
      new Response('', { status: ESTADO_HTTP.prohibido }),
      new Response('', { status: ESTADO_HTTP.noEncontrado }),
      new Response('<html>Access</html>', { headers: { 'content-type': 'text/html' } }),
      new Response('{', { headers: { 'content-type': 'application/json' } }),
      Response.json({ version: 1 }),
    ]) {
      falloPolitica(respuesta);
      assert.equal((await pedir(sw, 'biblioteca.html')).estado, ESTADO_HTTP.noDisponible);
    }
    sw.red.offline = true;
    assert.equal((await pedir(sw, 'biblioteca.html')).cuerpo, HTML, 'los errores no borran la última política válida');
  });

  test(`secciones: instalación no tolera errores del HTML de una sección permitida: ${base}`, async () => {
    const { sw, falloPagina } = preparar(base);
    sw.guardadas.set(sw.nombreCopia, new Map([[sw.urlDe('inicio.html'), new Response('ANTERIOR')]]));
    falloPagina(new Response('', { status: ESTADO_HTTP.prohibido }));
    await assert.rejects(sw.instalar(), /403/);
    assert.equal(await sw.guardadas.get(sw.nombreCopia)?.get(sw.urlDe('inicio.html'))?.clone().text(), 'ANTERIOR');
    assert.ok(![...sw.guardadas.keys()].some((nombre) => nombre.endsWith(':provisional')));
  });

  test(`secciones: revisión anterior o igual incoherente nunca reabre una retirada: ${base}`, async () => {
    const { sw, politica } = preparar(base);
    politica(2, false);
    await sw.instalar();
    politica(1, true);
    assert.equal((await pedir(sw, 'biblioteca.html')).estado, ESTADO_HTTP.noEncontrado);
    politica(2, true);
    assert.equal((await pedir(sw, 'biblioteca.html')).estado, ESTADO_HTTP.noDisponible);
    sw.red.offline = true;
    assert.equal((await pedir(sw, 'biblioteca.html')).estado, ESTADO_HTTP.noEncontrado);
  });

  test(`secciones: alias activos conservan el veredicto del servidor y solo guardan HTML comprobado: ${base}`, async () => {
    const { sw, politica } = preparar(base);
    const anterior = sw.red.respuesta;
    const admitidos = [sw.urlDe('%62iblioteca.html'), `${base}/biblioteca.html`, sw.urlDe('x/%2f../biblioteca.html')];
    sw.red.respuesta = (url) => {
      if (admitidos.includes(url)) {
        return new Response(HTML, { headers: { 'content-type': 'text/html' } });
      }
      if (url === sw.urlDe('biblioteca') || url === sw.urlDe('BIBLIOTECA.HTML')) {
        return new Response('RUTA NO ADMITIDA', { status: ESTADO_HTTP.noEncontrado });
      }
      assert.ok(anterior);
      return anterior(url);
    };
    await sw.instalar();
    for (const ruta of admitidos) {
      assert.equal((await pedir(sw, ruta)).cuerpo, HTML);
      assert.ok(sw.peticiones.includes(ruta), 'se consulta la URL original, sin inventar una ruta canónica');
    }
    for (const ruta of ['biblioteca', 'BIBLIOTECA.HTML']) {
      assert.equal((await pedir(sw, ruta)).cuerpo, 'RUTA NO ADMITIDA');
    }
    politica(1, false);
    for (const ruta of [...admitidos, 'biblioteca', 'BIBLIOTECA.HTML']) {
      assert.equal((await pedir(sw, ruta)).estado, ESTADO_HTTP.noEncontrado);
    }
  });
}

for (const base of BASES) {
  test(`secciones: un alias que no entrega una página HTML da el 503 explicado: ${base}`, async () => {
    const { sw } = preparar(base);
    const anterior = sw.red.respuesta;
    const alias = sw.urlDe('%62iblioteca.html');
    sw.red.respuesta = (url) => {
      if (url === alias) {
        return new Response(HTML, { headers: { 'content-type': 'text/plain' } });
      }
      assert.ok(anterior);
      return anterior(url);
    };
    await sw.instalar();
    const respuesta = await pedir(sw, alias);
    assert.equal(respuesta.estado, ESTADO_HTTP.noDisponible);
    assert.match(
      String(respuesta.cuerpo),
      /^(?!.*(?:sin conexión|sense connexió)).*Esta página no está disponible.*Aquesta pàgina no està disponible/su,
    );
    assert.equal(sw.guardadas.get(sw.nombreCopia)?.has(alias), false);
  });

  test(`secciones: un TypeError del programa al descargar la página se relanza: ${base}`, async () => {
    const { sw } = preparar(base);
    const anterior = sw.red.respuesta;
    await sw.instalar();
    sw.guardadas.get(sw.nombreCopia)?.delete(sw.urlDe('biblioteca.html'));
    sw.red.respuesta = (url) => {
      assert.ok(anterior);
      return url === sw.urlDe('biblioteca.html') ? ({} as Response) : anterior(url);
    };
    await assert.rejects(pedir(sw, 'biblioteca.html'), (error: Error) => error.name === 'TypeError');
  });
}

for (const base of BASES) {
  // Inalcanzable desde fetch: la sección sale de la misma regla (paginaDeLaRuta), así que toda dirección con sección
  // nombra una página. Si las dos reglas se separasen, el alias sin página sigue dando la página «no disponible».
  test(`secciones: un alias que no nombra ninguna página da el 503 explicado: ${base}`, async () => {
    const { sw } = preparar(base);
    await sw.instalar();
    const clave = sw.urlDe('no-es-una-seccion');
    const responder = sw.evaluar('responderSeccion') as (clave: string, seccion: string) => Promise<Response>;
    const respuesta = await responder(clave, 'biblioteca');
    assert.equal(respuesta.status, ESTADO_HTTP.noDisponible);
    assert.match(
      await respuesta.text(),
      /^(?!.*(?:sin conexión|sense connexió)).*Esta página no está disponible.*Aquesta pàgina no està disponible/su,
    );
    assert.equal(sw.guardadas.get(sw.nombreCopia)?.has(clave), false);
  });
}

/** Las tres páginas de «Datos globales», cada una con sus bytes de esta versión. */
const DATOS_GLOBALES: Record<string, string> = {
  'datos-globales.html': '<!doctype html><h1>Datos globales</h1>',
  'datos-globales-ue.html': '<!doctype html><h1>Unión Europea</h1>',
  'datos-globales-mundo.html': '<!doctype html><h1>Mundo</h1>',
};
const huellaDe = (texto: string) => createHash('sha256').update(texto).digest('hex');
const RECURSO = { mode: 'cors', method: 'GET' };

for (const base of BASES) {
  test(`secciones: un alias de una página con los bytes de otra de su sección no entra en la copia: ${base}`, async () => {
    const sw = servicio(base, {
      politica: textoPoliticaCache(),
      archivos: ['inicio.html', 'sin-conexion.html', ...Object.keys(DATOS_GLOBALES)],
      paginasSecciones: Object.entries(DATOS_GLOBALES).map(([ruta, html]) => [ruta, huellaDe(html)]),
      cuerpoDe: (ruta) => DATOS_GLOBALES[ruta] ?? 'PÁGINA FIJA',
    });
    // El alias sin «.html» de datos-globales.html, servido con los bytes de datos-globales-ue.html, y el de la UE con
    // los suyos.
    const servidas: Record<string, string> = {
      [sw.urlDe('datos-globales')]: DATOS_GLOBALES['datos-globales-ue.html'] ?? '',
      [sw.urlDe('datos-globales-ue')]: DATOS_GLOBALES['datos-globales-ue.html'] ?? '',
    };
    sw.conectar();
    sw.red.respuesta = (url) => {
      if (url === sw.urlDe('secciones-v3.json')) {
        return Response.json(documento());
      }
      const ruta = new URL(url).pathname.slice(new URL(base).pathname.length);
      const cuerpo = servidas[url] ?? DATOS_GLOBALES[ruta] ?? 'PÁGINA FIJA';
      return new Response(cuerpo, { headers: { 'content-type': 'text/html' } });
    };
    await sw.instalar();
    // Pedidos como recurso, los atiende la sección (responderSeccion), que guarda lo que es de esta versión.
    const ajeno = await pedir(sw, 'datos-globales', RECURSO);
    assert.equal(ajeno.estado, ESTADO_HTTP.noDisponible, 'no se da por buena la página de otra');
    const propio = await pedir(sw, 'datos-globales-ue', RECURSO);
    assert.equal(propio.cuerpo, DATOS_GLOBALES['datos-globales-ue.html'], 'el alias con los bytes de su página, sí');
    const copia = sw.guardadas.get(sw.nombreCopia);
    assert.equal(copia?.has(sw.urlDe('datos-globales')), false, 'la página de otra no entra en la copia del alias');
    assert.equal(copia?.has(sw.urlDe('datos-globales-ue')), true);
  });
}

test('secciones: una copia recargada adopta la mayor revisión aunque una escritura antigua termine tarde', async () => {
  const { sw } = preparar(BASES[0] ?? 'https://ejemplo.invalid/');
  const nombre = `faro-secciones-v3:${sw.base}`;
  const mayor = documento(REVISION_TARDIA, false);
  const antigua = documento(1, true);
  const url = sw.urlDe('secciones-v3.json');
  sw.guardadas.set(
    nombre,
    new Map([
      [`${url}?autoridad=${mayor.autoridad}`, Response.json(mayor)],
      [`${url}?actual=1`, Response.json(antigua)],
    ]),
  );
  sw.red.offline = true;
  sw.guardadas.set(
    sw.nombreCopia,
    new Map([
      [sw.urlDe('inicio.html'), new Response('PUBLICO', { headers: { 'x-faro-portal': 'publico' } })],
      [sw.urlDe('biblioteca.html'), new Response(HTML)],
    ]),
  );
  assert.equal((await pedir(sw, 'biblioteca.html')).estado, ESTADO_HTTP.noEncontrado);
});
