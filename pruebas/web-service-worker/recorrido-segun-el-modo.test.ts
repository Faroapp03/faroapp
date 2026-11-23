// La página del recorrido solo hace falta en la copia de una instalación pública: sin red, solo una pública abre el
// recorrido desde la copia (responderEntradaDelRecorrido). En una privada, o en la que ha pasado a privada (la marca
// del modo, modo.js), la red contesta con el acceso en su lugar, y el estado del paquete no dice que falte; en una
// pública sin la página y sin red, sí.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { textoPoliticaCache } from '../../herramientas/web/politica-cache.ts';
import { politicaSeccionesInicial, VERSION_SECCIONES_PUBLICAS } from '../../src/administracion/secciones-web.js';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { BASES, pedir, prepararPaquete, servicio } from './ayudas.ts';

const RECORRIDO = '<!doctype html><h1>Tu recorrido, de esta versión</h1>';
const FORMULARIO = '<!doctype html><h1>Acceso al recorrido</h1><form method="post"></form>';
const sha256 = (texto: string) => createHash('sha256').update(texto).digest('hex');
const CIFRAS_DEL_PAQUETE = 16;
const DATOS = '{"datos":1}';
const MANIFIESTO = JSON.stringify({ 'datos.json': { sha256: sha256(DATOS) } });
const PAQUETE = sha256(MANIFIESTO).slice(0, CIFRAS_DEL_PAQUETE);
const COMPLETO = { type: 'ESTADO_DEL_PAQUETE', version: PAQUETE, completo: true };

/**
 * Una instalación con el paquete completo y la sección del recorrido abierta, cuya red da el formulario de acceso en
 * lugar de la página del recorrido; `red.portal` es la cabecera de inicio.html y `red.cerrada`, un portal que lo
 * rechaza todo con 401, con su cabecera x-faro-portal: privado.
 */
function preparar(base: string, portal: 'publico' | 'privado') {
  const sw = servicio(base, {
    politica: textoPoliticaCache(),
    archivos: ['inicio.html', 'sin-conexion.html', 'recorrido.html'],
    paginasSecciones: [['recorrido.html', sha256(RECORRIDO)]],
    cuerpoDe: (ruta) => (ruta === 'recorrido.html' ? RECORRIDO : 'PÁGINA FIJA'),
    paquete: PAQUETE,
  });
  const red = { portal, cerrada: false };
  sw.conectar();
  sw.red.respuesta = (url) => {
    if (red.cerrada) {
      return new Response('ACCESO', { status: ESTADO_HTTP.noAutenticado, headers: { 'x-faro-portal': 'privado' } });
    }
    const respuestas: Record<string, () => Response> = {
      [sw.urlDe('secciones-v3.json')]: () =>
        Response.json({
          version: VERSION_SECCIONES_PUBLICAS,
          autoridad: '11111111-1111-4111-8111-111111111111',
          revision: 0,
          secciones: { ...politicaSeccionesInicial(), recorrido: true },
        }),
      [sw.urlDe(`paquete/${PAQUETE}/manifiesto.json`)]: () => new Response(MANIFIESTO),
      [sw.urlDe(`paquete/${PAQUETE}/datos.json`)]: () => new Response(DATOS),
      [sw.urlDe('inicio.html')]: () =>
        new Response('PÁGINA FIJA', { headers: { 'content-type': 'text/html', 'x-faro-portal': red.portal } }),
      [sw.urlDe('recorrido.html')]: () => new Response(FORMULARIO, { headers: { 'content-type': 'text/html' } }),
    };
    return respuestas[url]?.() ?? new Response('PÁGINA FIJA', { headers: { 'content-type': 'text/html' } });
  };
  const copia = () => sw.guardadas.get(sw.nombreCopia);
  const marca = () => sw.guardadas.get(`faro-modo:${base}`)?.get(sw.urlDe('modo-de-la-instalacion'))?.clone().text();
  return { sw, red, copia, marca };
}

/** El estado del paquete que recibe la página, fuera del contexto del service worker. */
const estadoDe = async (sw: ReturnType<typeof servicio>) => JSON.parse(JSON.stringify(await prepararPaquete(sw)));

/** La instalación y la primera petición del paquete, con red, que lo descarga; su estado, el que recibe la página. */
async function instalada(base: string, portal: 'publico' | 'privado') {
  const preparada = preparar(base, portal);
  await preparada.sw.instalar();
  return { ...preparada, primero: await estadoDe(preparada.sw) };
}

for (const base of BASES) {
  test(`privada desde la instalación: con el acceso en la red, no falta el recorrido: ${base}`, async () => {
    const { sw, copia, primero } = await instalada(base, 'privado');
    assert.deepEqual(primero, COMPLETO);
    assert.equal(copia()?.has(sw.urlDe('recorrido.html')), false, 'el formulario no entra en la copia');
  });

  test(`pública que pasa a privada: con la marca «privada», no falta el recorrido: ${base}`, async () => {
    const { sw, red, copia, marca, primero } = await instalada(base, 'publico');
    assert.equal(await marca(), 'publica');
    assert.deepEqual(primero, { ...COMPLETO, faltaElRecorrido: true }, 'pública: el formulario no es la página');
    red.cerrada = true;
    const navegacion = await pedir(sw, 'inicio.html');
    assert.equal(navegacion.estado, ESTADO_HTTP.noAutenticado, 'la navegación va al portal');
    assert.equal(await marca(), 'privada');
    const inicio = copia()?.get(sw.urlDe('inicio.html'));
    assert.equal(inicio?.headers.get('x-faro-portal'), 'publico', 'la copia aún dice «publico»: decide la marca');
    assert.deepEqual(await estadoDe(sw), COMPLETO);
  });

  test(`pública sin la página del recorrido y sin red: el estado dice que falta: ${base}`, async () => {
    const { sw, copia, marca } = await instalada(base, 'publico');
    assert.equal(await marca(), 'publica');
    assert.equal(copia()?.has(sw.urlDe('recorrido.html')), false);
    sw.red.offline = true;
    assert.deepEqual(await estadoDe(sw), { ...COMPLETO, faltaElRecorrido: true });
  });
}
