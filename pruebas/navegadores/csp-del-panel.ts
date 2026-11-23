/** Prueba local aislada de la CSP real del panel: reconoce el SELECT nativo y rechaza los estilos explícitos. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { type Browser, webkit } from 'playwright-core';
import { IDENTIDAD_WEB } from '../../src/comun/identidad-web.ts';
import { POLITICA_WEB_ADMINISTRATIVA } from '../../src/plataforma/administracion-web.ts';
import { comprobarObservacion, estabilizar, observar, prepararContexto } from './observacion.ts';
import { lanzarConPlazo } from './recursos-del-caso.mjs';

const EXITO = 200;
const PLAZO_MS = 10_000;
const INTERVALO_CSP_MS = 10;
interface Caso {
  nombre: string;
  html: string;
  reconocido: boolean;
  guion?: string;
  rutaGuion?: string;
}
const GUION_SELECT = [
  'const select = document.createElement("select");',
  'const opcion = document.createElement("option");',
  'opcion.textContent = "Uno";',
  'select.append(opcion);',
  'document.body.append(select);',
].join('\n');
const RUTA_GUION = '/administracion/vista-datos.js';
const CASOS: readonly [Caso, ...Caso[]] = [
  { nombre: 'select nativo', html: '<select><option>Uno</option></select>', reconocido: true },
  {
    nombre: 'select nativo multilínea',
    html: '<!doctype html>\n<html>\n<body>\n<select><option>Uno</option></select>\n</body>\n</html>',
    reconocido: true,
  },
  {
    nombre: 'select nativo dinámico',
    html: `<script type="module" src="${RUTA_GUION}"></script>`,
    guion: GUION_SELECT,
    reconocido: true,
  },
  {
    nombre: 'select dinámico en otra fuente',
    html: '<script type="module" src="/administracion/otra-vista.js"></script>',
    guion: GUION_SELECT,
    rutaGuion: '/administracion/otra-vista.js',
    reconocido: false,
  },
  {
    nombre: 'estilo explícito en select dinámico',
    html: `<script type="module" src="${RUTA_GUION}"></script>`,
    guion: GUION_SELECT.replace(
      'select.append(opcion);',
      'select.setAttribute("style", "text-overflow:inherit"); select.append(opcion);',
    ),
    reconocido: false,
  },
  {
    nombre: 'estilo explícito en otro elemento dinámico',
    html: `<script type="module" src="${RUTA_GUION}"></script>`,
    guion:
      'const p = document.createElement("p"); p.setAttribute("style", "text-overflow:inherit"); document.body.append(p);',
    reconocido: false,
  },
  { nombre: 'estilo rojo explícito', html: '<p style="color:red">Uno</p>', reconocido: false },
  { nombre: 'muestra igual en otro elemento', html: '<p style="text-overflow:inherit">Uno</p>', reconocido: false },
  {
    nombre: 'estilo explícito en select',
    html: '<select style="text-overflow:inherit"><option>Uno</option></select>',
    reconocido: false,
  },
];

async function probarCaso(browser: Browser, origen: string, caso: (typeof CASOS)[number]) {
  const fixture = {
    origen,
    errores: [] as string[],
    peticiones: [] as { ruta: string; metodo: string; ua: string | undefined }[],
  };
  const contexto = await browser.newContext({
    userAgent: IDENTIDAD_WEB['User-Agent'],
    extraHTTPHeaders: IDENTIDAD_WEB,
    serviceWorkers: 'block',
  });
  const registro = observar(contexto, fixture, { motor: 'webkit', contexto: 'panel' });
  contexto.on('request', (peticion) => {
    fixture.peticiones.push({ ruta: peticion.url(), metodo: peticion.method(), ua: peticion.headers()['user-agent'] });
  });
  try {
    await prepararContexto(contexto, fixture, registro);
    const pagina = await contexto.newPage();
    await pagina.goto(`${origen}/administracion`);
    await pagina.waitForFunction(() => document.readyState === 'complete', undefined, { timeout: PLAZO_MS });
    await esperarCsp(registro);
    await estabilizar(pagina);
    assert(registro.csp.length > 0, 'El motor debe producir la violación real');
    if (caso.reconocido) {
      comprobarObservacion(registro, fixture);
      assert.equal(registro.cspReconocidos.length, registro.csp.length);
      if (caso.guion) {
        assert(registro.cspReconocidos.every((evento) => evento.fuente === `${origen}${RUTA_GUION}`));
        assert(registro.cspReconocidos.every((evento) => evento.linea > 0 && evento.columna > 0));
      } else {
        const lineaSelect = caso.html.slice(0, caso.html.indexOf('<select')).split('\n').length;
        assert(registro.cspReconocidos.every((evento) => evento.linea === lineaSelect));
      }
    } else {
      assert.throws(() => comprobarObservacion(registro, fixture), /La CSP bloqueó un recurso/);
      assert.equal(registro.cspReconocidos.length, 0);
    }
    if (caso.html.includes('style="color:red"')) {
      assert.notEqual(
        await pagina.locator('p, select').evaluate((elemento) => getComputedStyle(elemento).color),
        'rgb(255, 0, 0)',
      );
    }
    return { nombre: caso.nombre, rechazoEsperado: !caso.reconocido, registro };
  } finally {
    await contexto.close();
  }
}

async function esperarCsp(registro: { csp: unknown[] }): Promise<void> {
  const limite = Date.now() + PLAZO_MS;
  while (registro.csp.length === 0 && Date.now() < limite) {
    await new Promise((resolver) => setTimeout(resolver, INTERVALO_CSP_MS));
  }
}

export async function probarCspDelPanel(browser: Browser) {
  let actual = CASOS[0];
  const servidor = createServer((peticion, respuesta) => {
    assert.equal(peticion.headers['user-agent'], IDENTIDAD_WEB['User-Agent']);
    if (actual.guion && peticion.url === (actual.rutaGuion ?? RUTA_GUION)) {
      respuesta.writeHead(EXITO, { 'content-type': 'text/javascript' });
      respuesta.end(actual.guion);
      return;
    }
    respuesta.writeHead(EXITO, { 'content-type': 'text/html', 'content-security-policy': POLITICA_WEB_ADMINISTRATIVA });
    respuesta.end(actual.html);
  });
  try {
    await new Promise<void>((resolver) => servidor.listen(0, '127.0.0.1', resolver));
    const direccion = servidor.address();
    assert(direccion && typeof direccion !== 'string');
    const origen = `http://127.0.0.1:${direccion.port}`;
    const resultados = [];
    for (const caso of CASOS) {
      actual = caso;
      resultados.push(await probarCaso(browser, origen, caso));
    }
    return resultados;
  } finally {
    servidor.closeAllConnections();
    await new Promise<void>((resolver, rechazar) => servidor.close((error) => (error ? rechazar(error) : resolver())));
  }
}

if (import.meta.main) {
  const permitidas = ['HOME', 'PATH', 'TMPDIR', 'LANG', 'LC_ALL', 'PLAYWRIGHT_BROWSERS_PATH'];
  const env = Object.fromEntries(
    permitidas.flatMap((nombre) => (process.env[nombre] ? [[nombre, process.env[nombre]]] : [])),
  );
  const browser = await lanzarConPlazo(webkit, { headless: true, env }, 'csp-del-panel.ts');
  try {
    console.log(JSON.stringify(await probarCspDelPanel(browser), null, 2));
  } finally {
    await browser.close();
  }
}
