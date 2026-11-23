// Nada entra en la copia sin cuadrar con su huella de esta versión (service-worker.js, HUELLAS_DE_LA_COPIA y
// deEstaVersion), tampoco lo que no es comprobado: las páginas, los estilos y lo que se guarda al usarse. Un archivo que
// existe pero es de otra versión hace fallar la instalación y la reparación sin tocar la copia, y lo que trae la red
// después no se guarda; un archivo sin huella en el catálogo no entra. Las huellas del catálogo de prueba son las
// reales de lo que entrega su red (ayudas.ts, cuerpoDe).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { textoPoliticaCache } from '../../herramientas/web/politica-cache.ts';
import { CatalogoImposible } from '../../herramientas/web/servicio/servicio-publicado.ts';
import { politicaSeccionesInicial, VERSION_SECCIONES_PUBLICAS } from '../../src/administracion/secciones-web.js';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { BASES, huellaDe, pedir, servicio } from './ayudas.ts';

const MOTOR = 'motor/src/plataforma/navegador/motor.js';
const ESTILOS = 'estilos/base.css';
const FOTO = 'imagenes/fotografias/casa.webp';
const FOTO_REDUCIDA = 'imagenes/fotografias/casa-800.webp';
const ARCHIVOS = ['inicio.html', 'sin-conexion.html', ESTILOS, FOTO_REDUCIDA];
const AUTORIDAD = '11111111-1111-4111-8111-111111111111';
const RECURSO = { mode: 'cors', method: 'GET' };
const CORRECTO = 200;
const TIPOS: [string, string][] = [
  ['.html', 'text/html'],
  ['.css', 'text/css'],
  ['.webp', 'image/webp'],
];

/** El service worker real con una red que entrega `cuerpos` (o la ruta), y las huellas de esos cuerpos de ahora. */
function conLaRed(base: string, catalogo: { sinHuella?: string[] } = {}) {
  const cuerpos: Record<string, string> = { [MOTOR]: 'MOTOR', [ESTILOS]: 'ESTILOS', [FOTO]: 'FOTO' };
  const sw = servicio(base, {
    archivos: ARCHIVOS,
    bajoDemanda: [FOTO],
    comprobados: [[MOTOR, huellaDe('MOTOR')]],
    cuerpoDe: (ruta) => cuerpos[ruta] ?? ruta,
    ...catalogo,
  });
  sw.red.respuesta = (url) => {
    const ruta = new URL(url).pathname.slice(new URL(base).pathname.length);
    const tipo = TIPOS.find(([extension]) => ruta.endsWith(extension))?.[1] ?? 'text/javascript';
    return new Response(cuerpos[ruta] ?? ruta, { headers: { 'content-type': tipo } });
  };
  sw.conectar();
  return { sw, cuerpos };
}

/** Lo que tiene la copia de la web: cada dirección con su texto. */
async function contenido(sw: ReturnType<typeof servicio>) {
  const copia = sw.guardadas.get(sw.nombreCopia) ?? new Map<string, Response>();
  return Object.fromEntries(
    await Promise.all([...copia.entries()].map(async ([clave, r]) => [clave, await r.clone().text()] as const)),
  );
}

/** Pide la reparación como la página y devuelve lo que responde el service worker, sin sus avisos de progreso. */
async function reparar(sw: ReturnType<typeof servicio>) {
  let trabajo = Promise.resolve<unknown>(undefined);
  const recibidos: unknown[] = [];
  const anotar = (mensaje: { type?: unknown }) => {
    if (mensaje.type !== 'PROGRESO_DE_LA_REPARACION') {
      recibidos.push(JSON.parse(JSON.stringify(mensaje)));
    }
  };
  sw.oyentes.get('message')?.({
    data: { type: 'REPARAR_COPIA', id: 1 },
    source: { postMessage: anotar },
    waitUntil: (valor: Promise<unknown>) => {
      trabajo = valor;
    },
  });
  await trabajo;
  return recibidos;
}

/** Si quedó la constancia de una instalación o una reparación con un archivo que no es de esta versión. */
const conConstancia = (sw: ReturnType<typeof servicio>, base: string) =>
  Boolean(sw.guardadas.get(`faro-estado:${base}`)?.size);

for (const base of BASES) {
  test(`una página de lo imprescindible de otra versión hace fallar la instalación sin guardar nada: ${base}`, async () => {
    const { sw, cuerpos } = conLaRed(base);
    cuerpos[ESTILOS] = 'ESTILOS DE OTRA VERSIÓN';
    await assert.rejects(sw.instalar(), { name: 'HuellaQueNoCoincide' });
    assert.equal(sw.guardadas.has(sw.nombreCopia), false, 'ni una copia a medias');
    assert.ok(conConstancia(sw, base), 'con constancia del motivo');
  });

  test(`un estilo de otra versión hace fallar la reparación: no-coincide y la copia no cambia: ${base}`, async () => {
    const { sw, cuerpos } = conLaRed(base);
    await sw.instalar();
    sw.guardadas.get(sw.nombreCopia)?.set(sw.urlDe(MOTOR), new Response('MOTOR CAMBIADO'));
    const antes = await contenido(sw);
    cuerpos[ESTILOS] = 'ESTILOS DE OTRA VERSIÓN';
    assert.deepEqual(await reparar(sw), [{ type: 'COPIA_REPARADA', id: 1, ok: false, motivo: 'no-coincide' }]);
    assert.deepEqual(await contenido(sw), antes, 'ni el motor ni nada más se ha sustituido');
    assert.ok(conConstancia(sw, base));
    cuerpos[ESTILOS] = 'ESTILOS';
    assert.deepEqual(await reparar(sw), [{ type: 'COPIA_REPARADA', id: 1, ok: true }]);
    assert.equal((await contenido(sw))[sw.urlDe(MOTOR)], 'MOTOR');
  });

  test(`lo que trae la red al usarse solo se guarda si es de esta versión: ${base}`, async () => {
    const { sw, cuerpos } = conLaRed(base);
    await sw.instalar();
    cuerpos[FOTO] = 'FOTO DE OTRA VERSIÓN';
    const deOtra = await pedir(sw, FOTO, RECURSO);
    assert.equal(deOtra.estado, CORRECTO, 'la página la recibe igual');
    assert.equal((await contenido(sw))[sw.urlDe(FOTO)], undefined, 'pero no entra en la copia');
    cuerpos[FOTO] = 'FOTO';
    await pedir(sw, FOTO, RECURSO);
    assert.equal((await contenido(sw))[sw.urlDe(FOTO)], 'FOTO', 'la de esta versión, sí');
  });

  test(`lo que el alojamiento entregó comprimido entra en la copia sin las cabeceras del transporte: ${base}`, async () => {
    const { sw } = conLaRed(base);
    const servir = sw.red.respuesta;
    // Como lo entrega el navegador tras un Brotli: el cuerpo ya descodificado, con las cabeceras de lo que viajó.
    sw.red.respuesta = async (url, opciones) => {
      const respuesta = await (servir as NonNullable<typeof servir>)(url, opciones);
      const cabeceras = new Headers(respuesta.headers);
      cabeceras.set('content-encoding', 'br');
      cabeceras.set('content-length', '3');
      return new Response(await respuesta.arrayBuffer(), { headers: cabeceras });
    };
    await sw.instalar();
    const guardada = sw.guardadas.get(sw.nombreCopia)?.get(sw.urlDe(ESTILOS));
    assert.equal(await guardada?.clone().text(), 'ESTILOS');
    assert.equal(guardada?.headers.get('content-encoding'), null, 'la copia no dice que está comprimida');
    assert.equal(guardada?.headers.get('content-length'), null, 'ni da la longitud de lo comprimido');
    assert.equal(guardada?.headers.get('content-type'), 'text/css', 'las demás cabeceras siguen');
  });

  test(`un archivo sin huella no cabe en el catálogo: no hay service worker que lo instale: ${base}`, () => {
    assert.throws(() => conLaRed(base, { sinHuella: [ESTILOS] }), CatalogoImposible);
  });

  test(`la página de una sección que no está en el CATALOGO no tiene huella: no entra en la copia: ${base}`, async () => {
    // biblioteca.html es de una sección abierta, pero no es de esta versión: el CATALOGO no la nombra. Su alias llega
    // de la red como HTML y la copia lo rechaza en deEstaVersion («no tiene huella de esta versión»).
    const sw = servicio(base, { politica: textoPoliticaCache() });
    const alias = sw.urlDe('%62iblioteca.html');
    const politica = {
      version: VERSION_SECCIONES_PUBLICAS,
      autoridad: AUTORIDAD,
      revision: 0,
      secciones: politicaSeccionesInicial(),
    };
    sw.conectar();
    sw.red.respuesta = (url) => {
      if (url === sw.urlDe('secciones-v3.json')) {
        return Response.json(politica);
      }
      // Lo demás, con los bytes de esta versión (el cuerpo de la red de prueba) y el portal público; el alias, con su HTML.
      const cuerpo = url === alias ? '<!doctype html><h1>Biblioteca</h1>' : new URL(url).pathname;
      const portal = url === sw.urlDe('inicio.html') ? { 'x-faro-portal': 'publico' } : {};
      return new Response(cuerpo, { headers: { 'content-type': 'text/html', ...portal } });
    };
    await sw.instalar();
    const respuesta = await pedir(sw, alias);
    assert.equal(respuesta.estado, ESTADO_HTTP.noDisponible);
    assert.match(
      String(respuesta.cuerpo),
      /^(?!.*(?:sin conexión|sense connexió)).*Esta página no está disponible.*Aquesta pàgina no està disponible/su,
    );
    const causas = sw.avisos.flat().map((dato) => String((dato as { cause?: unknown })?.cause ?? dato));
    assert.ok(
      causas.some((causa) => /biblioteca\.html: no tiene huella de esta versión/u.test(causa)),
      `el motivo es la falta de huella: ${causas}`,
    );
    assert.equal(sw.guardadas.get(sw.nombreCopia)?.has(alias), false);
    assert.equal(sw.guardadas.get(sw.nombreCopia)?.has(sw.urlDe('biblioteca.html')), false);
  });
}
