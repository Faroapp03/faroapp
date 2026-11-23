import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { type TestContext, test } from 'node:test';
import ca from '../../web/idiomas/ca.js';
import es from '../../web/idiomas/es.js';
import { leerDatosGlobales } from '../../web/scripts/datos-globales/datos.js';
import { fijarIdioma, registrarDiccionario } from '../../web/scripts/textos.js';
import { navegador } from '../web-controles/ayudas.js';
import { dom, Pieza } from './dom.ts';

const PUBLICADO = readFileSync(new URL('../../web/datos/datos-globales.json', import.meta.url), 'utf8');
const DATOS = leerDatosGlobales(JSON.parse(PUBLICADO));
registrarDiccionario('es', es);
registrarDiccionario('ca', ca);

async function preparar(t: TestContext) {
  const entorno = dom(t);
  fijarIdioma('es');
  const ficha = await import('../../web/scripts/datos-globales/ficha.js');
  const seccion = await import('../../web/scripts/datos-globales/seccion.js');
  const pagina = await import('../../web/scripts/datos-globales/pagina.js');
  return { ...entorno, ficha, seccion, pagina };
}

function pieza(nodo: HTMLElement): Pieza {
  assert.ok(nodo instanceof Pieza);
  return nodo;
}

test('la ficha técnica conserva apartados, tipo y adornos, y dice que es solo el método', async (t) => {
  const { ficha, seccion } = await preparar(t);
  const medida = pieza(ficha.marcaDeNaturaleza('medido'));
  assert.equal(medida.textContent, '● Medido');
  assert.equal(medida.children[0]?.getAttribute('aria-hidden'), 'true');
  assert.equal(ficha.marcaDeNaturaleza('estimado').textContent, '● Estimado');
  assert.equal(ficha.marcaDeOpinion().textContent, '○ Encuesta de opinión');
  const tecnica = pieza(
    ficha.fichaTecnica([
      ['anio', '2025'],
      ['tipo', ficha.marcaDeNaturaleza('medido')],
    ]),
  );
  assert.equal(tecnica.querySelector('summary')?.textContent, 'Ficha técnica: qué mide y de dónde sale');
  assert.deepEqual(
    tecnica.querySelectorAll('dd').map((n) => n.textContent),
    ['2025', '● Medido'],
  );
  assert.equal(seccion.marcaDeIndicador(DATOS, 'no-existe').textContent, es['datos-globales.sin-cifra']);
});

async function carga(t: TestContext, respuesta: Response, ensenar: () => void = () => {}) {
  const p = await preparar(t);
  const estado = p.conId('datos-globales-estado');
  const muestra = p.conId('datos-globales-muestra');
  const consultas: RequestInit[] = [];
  navegador(t, {
    fetch: async (url: URL, opciones: RequestInit) => {
      assert.equal(url.href, 'https://ejemplo.invalid/web/datos/datos-globales.json');
      consultas.push(opciones);
      return respuesta;
    },
    console: { ...console, warn: () => {} },
  });
  const promesa = p.pagina.cargarLaPagina(ensenar);
  return { estado, muestra, consultas, promesa };
}

test('carga válida oculta el aviso y entrega los datos sin petición externa', async (t) => {
  let recibidos = 0;
  const p = await carga(t, new Response(PUBLICADO), () => {
    recibidos++;
  });
  await p.promesa;
  assert.equal(recibidos, 1);
  assert.equal(p.estado.textContent, '');
  assert.equal(p.muestra.hidden, true);
  assert.equal(p.consultas[0]?.mode, 'same-origin');
  assert.ok(p.consultas[0]?.signal instanceof AbortSignal);
});

for (const [nombre, respuesta, clave] of [
  ['404', () => new Response('', { status: 404 }), 'no-disponibles'],
  ['JSON', () => new Response('<html>'), 'no-disponibles'],
  ['contrato', () => Response.json({ version: 'otra' }), 'no-validos'],
] as const) {
  test(`carga ${nombre} informa sin enseñar cifras`, async (t) => {
    let llamadas = 0;
    const p = await carga(t, respuesta(), () => {
      llamadas++;
    });
    await p.promesa;
    assert.equal(llamadas, 0);
    assert.equal(p.estado.textContent, es[`datos-globales.estado.${clave}`]);
  });
}

test('fallo del consumidor se propaga después de informar, sin disfrazarlo como error de datos', async (t) => {
  const fallo = new Error('Consumidor sintético');
  const p = await carga(t, new Response(PUBLICADO), () => {
    throw fallo;
  });
  await assert.rejects(p.promesa, (error) => error === fallo);
  assert.equal(p.estado.textContent, es['datos-globales.estado.no-disponibles']);
});
