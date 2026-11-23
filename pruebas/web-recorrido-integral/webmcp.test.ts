import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { crearApi } from '../../src/api/api.ts';
import { definiciones, llamarHerramienta } from '../../src/api/mcp/herramientas.ts';
import { VERSION_MODERNA } from '../../src/api/mcp/protocolo.ts';
import { RUTA_MCP } from '../../src/api/mcp/servidor-mcp.ts';
import { cargarDatos } from '../../src/plataforma/node/datos.ts';
import type { ContextoDeModelo, HerramientaWebMcp, Transporte } from '../../web/scripts/webmcp.js';
import { contextoDeLaPagina, ofrecerHerramientas } from '../../web/scripts/webmcp.js';
import { administracionDeAgentes } from '../ayudas/socios-api.ts';

const DATOS = cargarDatos(fileURLToPath(new URL('../../datos/', import.meta.url)));
const HOY = '2026-10-14';
const LEER = {
  name: 'leer',
  title: 'Lectura ficticia',
  description: 'Solo ensayo',
  inputSchema: { type: 'object' },
  annotations: { readOnlyHint: true, openWorldHint: false },
};
function contexto() {
  const registradas = new Map<string, HerramientaWebMcp>();
  const senales: AbortSignal[] = [];
  const modelo: ContextoDeModelo = {
    async registerTool(herramienta, { signal }) {
      signal?.throwIfAborted();
      if (registradas.has(herramienta.name)) {
        throw new DOMException('Repetida', 'InvalidStateError');
      }
      registradas.set(herramienta.name, herramienta);
      if (signal) {
        senales.push(signal);
        signal.addEventListener('abort', () => registradas.delete(herramienta.name), { once: true });
      }
    },
  };
  return { modelo, registradas, senales };
}
function lista(): Response {
  return Response.json({ result: { tools: [LEER] } });
}

test('MCP actual factual: metadatos/esquemas y consulta exactos, sin leer página ni usar red', async (t) => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('Prohibida la red'));
  const api = await crearApi({
    datos: DATOS,

    origenesPermitidos: [],
    administracion: administracionDeAgentes().opciones,
    agentes: { mcp: true },
  });
  const { modelo, registradas } = contexto();
  const transporte: Transporte = async (url, opciones) => {
    assert.equal(url, RUTA_MCP);
    assert.equal(new Headers(opciones.headers).get('mcp-protocol-version'), VERSION_MODERNA);
    const cuerpo = JSON.parse(String(opciones.body)) as { params: Record<string, unknown> };
    assert.deepEqual(cuerpo.params._meta, {
      'io.modelcontextprotocol/protocolVersion': VERSION_MODERNA,
      'io.modelcontextprotocol/clientCapabilities': {},
    });
    return api(new Request(new URL(url, 'https://ensayo.invalid'), opciones));
  };
  assert.deepEqual(
    await ofrecerHerramientas(modelo, { transporte }),
    definiciones().map((x) => x.name),
  );
  for (const d of definiciones()) {
    const h = registradas.get(d.name);
    assert.ok(h);
    assert.deepEqual([h.title, h.description, h.inputSchema], [d.title, d.description, d.inputSchema]);
    assert.deepEqual(h.annotations, { readOnlyHint: true, untrustedContentHint: false });
  }
  const h = registradas.get('ficha_grupo');
  assert.ok(h);
  const llamada = { name: h.name, arguments: { isco: '7512' } };
  const esperado = llamarHerramienta({ datos: DATOS, politica: 'ocupacion', hoy: HOY }, llamada);
  assert.equal(esperado.isError, false);
  const obtenido = await h.execute(llamada.arguments, {});
  assert.equal(JSON.stringify(obtenido), esperado.content[0]?.text);
});

test('solo lectura y nombre válido; cancelación después de registrar retira todas', async () => {
  const { modelo, registradas } = contexto();
  const vida = new AbortController();
  const transporte: Transporte = async () =>
    Response.json({
      result: {
        tools: [
          LEER,
          { ...LEER, name: 'escribir', annotations: { readOnlyHint: false } },
          { ...LEER, name: 'con espacios' },
          { ...LEER, name: 'sin_anotar', annotations: {} },
        ],
      },
    });
  assert.deepEqual(await ofrecerHerramientas(modelo, { transporte, senal: vida.signal }), ['leer']);
  assert.equal(registradas.size, 1);
  vida.abort();
  assert.equal(registradas.size, 0);
});

test('retirada antes de ofrecer impide toda petición y registro', async () => {
  const { modelo, registradas } = contexto();
  const vida = new AbortController();
  vida.abort(new DOMException('Retirada', 'AbortError'));
  let llamadas = 0;
  const transporte: Transporte = async () => {
    llamadas += 1;
    return lista();
  };
  await assert.rejects(ofrecerHerramientas(modelo, { transporte, senal: vida.signal }), vida.signal.reason);
  assert.equal(llamadas, 0);
  assert.equal(registradas.size, 0);
});

test('retirada mientras termina tools/list impide registros posteriores aunque el transporte ya respondió', async () => {
  const { modelo, registradas } = contexto();
  const vida = new AbortController();
  const transporte: Transporte = async () => {
    vida.abort(new DOMException('Retirada tras respuesta', 'AbortError'));
    return lista();
  };
  await assert.rejects(ofrecerHerramientas(modelo, { transporte, senal: vida.signal }), vida.signal.reason);
  assert.equal(registradas.size, 0);
});

test('registro rechazado retira los registros parciales y su escucha de vida', async () => {
  const { modelo, registradas, senales } = contexto();
  const registrar = modelo.registerTool;
  modelo.registerTool = async (herramienta, opciones) => {
    if (herramienta.name === 'segunda') {
      throw new Error('Rechazo sintético');
    }
    return registrar(herramienta, opciones);
  };
  const vida = new AbortController();
  const transporte: Transporte = async () => Response.json({ result: { tools: [LEER, { ...LEER, name: 'segunda' }] } });
  await assert.rejects(ofrecerHerramientas(modelo, { transporte, senal: vida.signal }), /Rechazo sintético/);
  assert.equal(registradas.size, 0);
  assert.ok(senales.every((s) => s.aborted));
});

test('sin contexto WebMCP no registra herramientas automáticamente', () => {
  assert.equal(contextoDeLaPagina(), null);
});

test('retirada con registerTool pendiente no devuelve éxito después de resolver su registro', async () => {
  const { modelo, registradas } = contexto();
  const registrar = modelo.registerTool;
  const iniciada = Promise.withResolvers<void>();
  const fin = Promise.withResolvers<void>();
  modelo.registerTool = async (herramienta, opciones) => {
    await registrar(herramienta, opciones);
    iniciada.resolve();
    await fin.promise;
  };
  const vida = new AbortController();
  const ofrecidas = ofrecerHerramientas(modelo, { transporte: async () => lista(), senal: vida.signal });
  const rechazadas = assert.rejects(ofrecidas, { name: 'AbortError' });
  await iniciada.promise;
  vida.abort();
  fin.resolve();
  await rechazadas;
  assert.equal(registradas.size, 0);
});

test('retirada entre resolución de la lista y continuación de ofrecer no registra nada', async (t) => {
  const { modelo, registradas } = contexto();
  const vida = new AbortController();
  const comprobar = vida.signal.throwIfAborted.bind(vida.signal);
  let controles = 0;
  t.mock.method(vida.signal, 'throwIfAborted', () => {
    comprobar();
    controles += 1;
    // Segunda guarda: pedirAlMcp ya leyó la lista; el aborto se encola antes de continuar ofrecerHerramientas.
    if (controles === 2) {
      queueMicrotask(() => vida.abort());
    }
  });
  await assert.rejects(ofrecerHerramientas(modelo, { transporte: async () => lista(), senal: vida.signal }), {
    name: 'AbortError',
  });
  assert.equal(registradas.size, 0);
});
