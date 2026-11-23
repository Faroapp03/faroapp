// El recorrido real de una instalación pública que pasa a protegido (la entidad lo cambia de modo): en cuanto la red
// contesta a su entrada con el acceso temporal (x-faro-recorrido, al navegar o en la consulta de cada visita, que hace
// responderPaquete), la página sale de la copia y, sin red, se ve que hace falta conexión, nunca la copia. Cuando
// vuelve a estar activo, la página vuelve a la copia y sin red se abre. Un fallo de red o un 5xx no cambian nada.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { textoPoliticaCache } from '../../herramientas/web/politica-cache.ts';
import { politicaSeccionesInicial, VERSION_SECCIONES_PUBLICAS } from '../../src/administracion/secciones-web.js';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { BASES, pedir, prepararPaquete, servicio } from './ayudas.ts';

const RECORRIDO = '<!doctype html><h1>Tu recorrido, de esta versión</h1>';
const FORMULARIO = '<!doctype html><h1>Acceso al recorrido</h1><form method="post"></form>';
const OTRA_VARIANTE = '<!doctype html><h1>La variante con la sesión temporal</h1>';
const sha256 = (texto: string) => createHash('sha256').update(texto).digest('hex');
const CIFRAS_DEL_PAQUETE = 16;
const DATOS = '{"datos":1}';
const MANIFIESTO = JSON.stringify({ 'datos.json': { sha256: sha256(DATOS) } });
const PAQUETE = sha256(MANIFIESTO).slice(0, CIFRAS_DEL_PAQUETE);

/** Lo que contesta la red a la entrada del recorrido real. */
type Entrada = 'activo' | 'acceso' | 'temporal' | 'caida';
const HTML = { 'content-type': 'text/html' };
const ENTRADAS: Record<Entrada, () => Response> = {
  activo: () => new Response(RECORRIDO, { headers: HTML }),
  acceso: () => new Response(FORMULARIO, { headers: { ...HTML, 'x-faro-recorrido': 'acceso' } }),
  temporal: () => new Response(OTRA_VARIANTE, { headers: { ...HTML, 'x-faro-recorrido': 'temporal' } }),
  caida: () => new Response('CAIDO', { status: ESTADO_HTTP.noDisponible }),
};

/** Una instalación pública con su paquete y el recorrido real activo en la copia, con red. */
async function instalada(base: string) {
  const sw = servicio(base, {
    politica: textoPoliticaCache(),
    archivos: ['inicio.html', 'sin-conexion.html', 'recorrido.html'],
    paginasSecciones: [['recorrido.html', sha256(RECORRIDO)]],
    cuerpoDe: (ruta) => (ruta === 'recorrido.html' ? RECORRIDO : 'PÁGINA FIJA'),
    paquete: PAQUETE,
  });
  const red = { entrada: 'activo' as Entrada, consultas: [] as RequestInit[] };
  sw.conectar();
  sw.red.respuesta = (url, opciones) => {
    if (url === sw.urlDe('recorrido.html')) {
      red.consultas.push(opciones ?? {});
      return ENTRADAS[red.entrada]();
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
        new Response('PÁGINA FIJA', { headers: { ...HTML, 'x-faro-portal': 'publico' } }),
    };
    return respuestas[url]?.() ?? new Response('PÁGINA FIJA', { headers: HTML });
  };
  await sw.instalar();
  await prepararPaquete(sw);
  const enLaCopia = () => sw.guardadas.get(sw.nombreCopia)?.has(sw.urlDe('recorrido.html'));
  const estado = () => sw.guardadas.get(`faro-modo:${base}`)?.get(sw.urlDe('estado-del-recorrido'))?.clone().text();
  const accesoSinConexion = () =>
    String(sw.evaluar("PAGINAS_DEL_SERVICIO['acceso-sin-conexion']")).replaceAll('{{inicio}}', sw.urlDe('inicio.html'));
  /** La entrada del recorrido sin red, y la red de vuelta. */
  const sinRed = async () => {
    sw.red.offline = true;
    const respuesta = await pedir(sw, 'recorrido.html');
    sw.conectar();
    return respuesta;
  };
  assert.equal(enLaCopia(), true, 'el recorrido activo entra en la copia al instalar');
  assert.equal((await sinRed()).cuerpo, RECORRIDO, 'sin red, el recorrido activo se abre desde la copia');
  return { sw, red, enLaCopia, estado, accesoSinConexion, sinRed };
}

for (const base of BASES) {
  test(`activo → protegido al navegar con red: sale de la copia y sin red no se abre: ${base}`, async () => {
    const { sw, red, enLaCopia, estado, accesoSinConexion, sinRed } = await instalada(base);
    red.entrada = 'acceso';
    assert.equal((await pedir(sw, 'recorrido.html')).cuerpo, FORMULARIO);
    assert.equal(enLaCopia(), false, 'la página del recorrido protegido sale de la copia');
    assert.equal(await estado(), 'protegido');
    const sin = await sinRed();
    assert.equal(sin.estado, ESTADO_HTTP.noDisponible);
    assert.equal(sin.cuerpo, accesoSinConexion(), 'sin red: hace falta conexión, nunca la copia');
  });

  test(`activo → protegido solo con la visita (responderPaquete): sin red no se abre: ${base}`, async () => {
    const { sw, red, enLaCopia, estado, accesoSinConexion, sinRed } = await instalada(base);
    red.entrada = 'acceso';
    red.consultas.length = 0;
    await prepararPaquete(sw);
    const [consulta] = red.consultas;
    assert.equal(consulta?.redirect, 'manual', 'la consulta de la visita no sigue redirecciones');
    assert.equal(consulta?.cache, 'no-store', 'ni usa la caché HTTP');
    assert.ok(consulta?.signal, 'y tiene plazo');
    assert.equal(enLaCopia(), false);
    assert.equal(await estado(), 'protegido');
    assert.equal((await sinRed()).cuerpo, accesoSinConexion());
  });

  test(`la sesión temporal también cuenta como protegido: ${base}`, async () => {
    const { sw, red, enLaCopia, estado, accesoSinConexion, sinRed } = await instalada(base);
    red.entrada = 'temporal';
    assert.equal((await pedir(sw, 'recorrido.html')).cuerpo, OTRA_VARIANTE);
    assert.equal(enLaCopia(), false);
    assert.equal(await estado(), 'protegido');
    assert.equal((await sinRed()).cuerpo, accesoSinConexion());
  });

  test(`protegido → activo: vuelve a la copia y sin red se abre, al navegar y con la visita: ${base}`, async () => {
    for (const vuelta of ['navegando', 'visita'] as const) {
      const { sw, red, enLaCopia, estado, sinRed } = await instalada(base);
      red.entrada = 'acceso';
      await prepararPaquete(sw);
      assert.equal(await estado(), 'protegido');
      red.entrada = 'activo';
      if (vuelta === 'navegando') {
        assert.equal((await pedir(sw, 'recorrido.html')).cuerpo, RECORRIDO);
      } else {
        await prepararPaquete(sw);
      }
      assert.equal(enLaCopia(), true, `${vuelta}: la página vuelve a la copia`);
      assert.equal(await estado(), 'activo', vuelta);
      assert.equal((await sinRed()).cuerpo, RECORRIDO, `${vuelta}: sin red se abre`);
    }
  });

  test(`un 5xx o la red caída no cambian lo anotado: ${base}`, async () => {
    const { sw, red, enLaCopia, estado, accesoSinConexion, sinRed } = await instalada(base);
    red.entrada = 'caida';
    await prepararPaquete(sw);
    await pedir(sw, 'recorrido.html');
    assert.equal(enLaCopia(), true, 'un 5xx no saca de la copia el recorrido activo');
    assert.equal((await sinRed()).cuerpo, RECORRIDO);
    red.entrada = 'acceso';
    await prepararPaquete(sw);
    assert.equal(await estado(), 'protegido');
    red.entrada = 'caida';
    await prepararPaquete(sw);
    await pedir(sw, 'recorrido.html');
    sw.red.offline = true;
    await prepararPaquete(sw);
    assert.equal(await estado(), 'protegido', 'ni un 5xx ni la falta de red lo vuelven activo');
    assert.equal((await sinRed()).cuerpo, accesoSinConexion());
  });
}
