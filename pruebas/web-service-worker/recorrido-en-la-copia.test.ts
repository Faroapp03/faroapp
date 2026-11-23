// La página del recorrido real es complementaria al instalar (catalogo.js, COMPLEMENTARIOS): si su descarga falla, la
// instalación sigue. Pero la copia no se da por completa sin ella: con red, la entrada del recorrido que llega con los
// bytes de esta versión se guarda en segundo plano; la reparación la repone, y el estado del paquete cuenta que falta
// (faltaElRecorrido) mientras la sección esté abierta. Lo gobierna la huella, no el modo de la instalación.
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

/** Una instalación cuya red da `estado.pagina` como página del recorrido y abre o cierra su sección. */
function preparar(base: string, portal: 'publico' | 'privado') {
  const sw = servicio(base, {
    politica: textoPoliticaCache(),
    archivos: ['inicio.html', 'sin-conexion.html', 'recorrido.html'],
    paginasSecciones: [['recorrido.html', sha256(RECORRIDO)]],
    cuerpoDe: (ruta) => (ruta === 'recorrido.html' ? RECORRIDO : 'PÁGINA FIJA'),
    paquete: PAQUETE,
  });
  const estado: { pagina: string; recorrido: boolean; marca: 'acceso' | 'temporal' | null } = {
    pagina: FORMULARIO,
    recorrido: true,
    marca: null,
  };
  sw.conectar();
  /** Lo que da la red, aparte de la página del recorrido, por dirección. */
  const fijas: Record<string, () => Response> = {
    [sw.urlDe('secciones-v3.json')]: () =>
      Response.json({
        version: VERSION_SECCIONES_PUBLICAS,
        autoridad: '11111111-1111-4111-8111-111111111111',
        revision: estado.recorrido ? 0 : 1,
        secciones: { ...politicaSeccionesInicial(), recorrido: estado.recorrido },
      }),
    [sw.urlDe(`paquete/${PAQUETE}/manifiesto.json`)]: () => new Response(MANIFIESTO),
    [sw.urlDe(`paquete/${PAQUETE}/datos.json`)]: () => new Response(DATOS),
    [sw.urlDe('inicio.html')]: () =>
      new Response('PÁGINA FIJA', { headers: { 'content-type': 'text/html', 'x-faro-portal': portal } }),
  };
  sw.red.respuesta = (url) => {
    if (url === sw.urlDe('recorrido.html') || url === sw.urlDe('recorrido')) {
      const marca = estado.marca ? { 'x-faro-recorrido': estado.marca } : {};
      return new Response(estado.pagina, { headers: { 'content-type': 'text/html', ...marca } });
    }
    return fijas[url]?.() ?? new Response('PÁGINA FIJA', { headers: { 'content-type': 'text/html' } });
  };
  const enLaCopia = () => sw.guardadas.get(sw.nombreCopia)?.has(sw.urlDe('recorrido.html'));
  return { sw, estado, enLaCopia };
}

/** Pide la reparación como una página y espera su respuesta. */
async function reparar(sw: ReturnType<typeof servicio>) {
  let trabajo = Promise.resolve<unknown>(undefined);
  const recibidos: unknown[] = [];
  sw.oyentes.get('message')?.({
    data: { type: 'REPARAR_COPIA', id: 1 },
    source: { id: 'pestana', postMessage: (mensaje: unknown) => recibidos.push(JSON.parse(JSON.stringify(mensaje))) },
    waitUntil: (valor: Promise<unknown>) => {
      trabajo = valor;
    },
  });
  await trabajo;
  return recibidos.at(-1);
}

/** El estado del paquete que recibe la página, fuera del contexto del service worker. */
const estadoDe = async (sw: ReturnType<typeof servicio>) => JSON.parse(JSON.stringify(await prepararPaquete(sw)));

for (const base of BASES) {
  for (const portal of ['publico', 'privado'] as const) {
    test(`${portal}: sin la página al instalar, con red se guarda al navegar si es de esta versión: ${base}`, async () => {
      const { sw, estado, enLaCopia } = preparar(base, portal);
      await sw.instalar();
      assert.equal(enLaCopia(), false, 'la instalación sigue sin ella');
      const ajena = await pedir(sw, 'recorrido.html');
      assert.equal(ajena.cuerpo, FORMULARIO, 'la respuesta es la de la red, tal cual');
      assert.equal(enLaCopia(), false, 'lo que no cuadra con su huella no entra');
      estado.pagina = RECORRIDO;
      const propia = await pedir(sw, 'recorrido');
      assert.equal(propia.estado, ESTADO_HTTP.correcto);
      assert.equal(propia.cuerpo, RECORRIDO);
      assert.equal(enLaCopia(), true, 'la página de esta versión queda en la copia');
    });
  }

  test(`pública: guardada al navegar, sin red el recorrido sale de la copia: ${base}`, async () => {
    const { sw, estado } = preparar(base, 'publico');
    await sw.instalar();
    estado.pagina = RECORRIDO;
    await pedir(sw, 'recorrido.html');
    sw.red.offline = true;
    const respuesta = await pedir(sw, 'recorrido.html');
    assert.equal(respuesta.estado, ESTADO_HTTP.correcto);
    assert.equal(respuesta.cuerpo, RECORRIDO);
  });

  test(`la reparación repone la página del recorrido que falta: ${base}`, async () => {
    const { sw, estado, enLaCopia } = preparar(base, 'publico');
    await sw.instalar();
    estado.pagina = RECORRIDO;
    assert.deepEqual(await reparar(sw), { type: 'COPIA_REPARADA', id: 1, ok: true });
    assert.equal(enLaCopia(), true);
  });

  test(`la reparación no falla por la página del recorrido si no llega la de esta versión: ${base}`, async () => {
    const { sw, enLaCopia } = preparar(base, 'publico');
    await sw.instalar();
    assert.deepEqual(await reparar(sw), { type: 'COPIA_REPARADA', id: 1, ok: true });
    assert.equal(enLaCopia(), false);
  });

  test(`sin la página del recorrido, el estado del paquete dice que falta; al llegar, ya no: ${base}`, async () => {
    const { sw, estado, enLaCopia } = preparar(base, 'publico');
    await sw.instalar();
    assert.deepEqual(await estadoDe(sw), {
      type: 'ESTADO_DEL_PAQUETE',
      version: PAQUETE,
      completo: true,
      faltaElRecorrido: true,
    });
    estado.pagina = RECORRIDO;
    assert.deepEqual(await estadoDe(sw), { type: 'ESTADO_DEL_PAQUETE', version: PAQUETE, completo: true });
    assert.equal(enLaCopia(), true, 'la petición del paquete vuelve a intentar la página');
  });

  test(`con la sección del recorrido retirada, su página no hace falta en la copia: ${base}`, async () => {
    const { sw, estado } = preparar(base, 'publico');
    await sw.instalar();
    estado.recorrido = false;
    assert.deepEqual(await estadoDe(sw), { type: 'ESTADO_DEL_PAQUETE', version: PAQUETE, completo: true });
  });

  test(`con el recorrido real inactivo (el acceso marcado), la copia llega a lista y no guarda nada: ${base}`, async () => {
    const { sw, estado, enLaCopia } = preparar(base, 'publico');
    estado.marca = 'acceso';
    await sw.instalar();
    assert.equal((await pedir(sw, 'recorrido.html')).cuerpo, FORMULARIO, 'la red, tal cual');
    assert.deepEqual(await estadoDe(sw), { type: 'ESTADO_DEL_PAQUETE', version: PAQUETE, completo: true });
    assert.equal(enLaCopia(), false);
  });

  test(`la página real con la sesión temporal no entra en la copia por ninguna vía: ${base}`, async () => {
    const { sw, estado, enLaCopia } = preparar(base, 'publico');
    estado.pagina = RECORRIDO;
    estado.marca = 'temporal';
    await sw.instalar();
    assert.equal(enLaCopia(), false, 'al instalar');
    assert.equal((await pedir(sw, 'recorrido.html')).cuerpo, RECORRIDO, 'la red, tal cual');
    assert.equal(enLaCopia(), false, 'al navegar');
    assert.deepEqual(await reparar(sw), { type: 'COPIA_REPARADA', id: 1, ok: true });
    assert.equal(enLaCopia(), false, 'al reparar');
    assert.deepEqual(await estadoDe(sw), { type: 'ESTADO_DEL_PAQUETE', version: PAQUETE, completo: true });
    assert.equal(enLaCopia(), false, 'al pedir el paquete');
  });
}
