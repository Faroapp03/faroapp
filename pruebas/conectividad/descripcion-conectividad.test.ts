import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { setImmediate as turno } from 'node:timers/promises';
import { documentoOpenApi, OPERACIONES_ESPECIALES } from '../../herramientas/api/openapi.ts';
import type { DocumentoControles } from '../../src/administracion/controles.ts';
import { HERRAMIENTAS } from '../../src/api/mcp/definiciones.ts';
import { PLAZO_PETICION_MS } from '../../src/api/plazo.ts';
import { RUTA_ACTIVAR_INVITACION, RUTA_CONSULTAR_INVITACION } from '../../src/api/socios/metadatos.ts';
import { camposDe } from '../../src/comun/json.ts';
import {
  esDescripcionDeConectividad,
  type RutaDescripcion,
  respuestaDeDescripcion,
} from '../../src/plataforma/descripcion-conectividad.ts';

const diagnosticos: unknown[] = [];
const diagnosticar = (error: unknown) => {
  diagnosticos.push(error);
};
const llms = readFileSync(new URL('../../web/llms.txt', import.meta.url), 'utf8');
const MAX_CUERPO = 524288,
  OK = 200,
  INCORRECTA = 400,
  METODO = 405,
  ERROR = 503;
const apagados: DocumentoControles = { version: 2, revision: 0, api: 'deshabilitada', mcp: false, a2a: false };
function peticion(ruta: RutaDescripcion, method = 'GET') {
  return new Request(`https://servicio.invalid${ruta}`, { method });
}
async function leer(ruta: RutaDescripcion) {
  return new Response(ruta === '/llms.txt' ? llms : JSON.stringify(documentoOpenApi()), {
    headers: { etag: 'origen', 'last-modified': 'origen', 'content-length': '999', 'content-encoding': 'gzip' },
  });
}
for (const api of ['deshabilitada', 'habilitada'] as const) {
  for (const mcp of [false, true]) {
    for (const a2a of [false, true]) {
      test(`anuncios exactos API=${api}/MCP=${mcp}/A2A=${a2a}`, async () => {
        const controles = { ...apagados, api, mcp, a2a };
        const doc = await respuestaDeDescripcion(peticion('/openapi.json'), controles, leer, {
          diagnosticar: diagnosticar,
        });
        assert.equal(doc.status, OK);
        assert.equal(doc.headers.get('cache-control'), 'no-store');
        for (const h of ['etag', 'last-modified', 'content-length', 'content-encoding']) {
          assert.equal(doc.headers.get(h), null);
        }
        const json: unknown = await doc.json();
        const objeto = camposDe(json),
          paths = camposDe(objeto.paths);
        assert.equal(Object.hasOwn(paths, '/api/salud'), true);
        assert.equal(Object.hasOwn(paths, '/api/informe'), false);
        assert.equal(Object.hasOwn(paths, '/api/clasificar'), false);
        assert.equal(Object.hasOwn(paths, '/api/conectividad/estado'), true);
        assert.equal(Object.hasOwn(paths, RUTA_ACTIVAR_INVITACION), api === 'habilitada');
        assert.equal(Object.hasOwn(paths, RUTA_CONSULTAR_INVITACION), api === 'habilitada');
        assert.equal(Object.hasOwn(paths, '/api/socios/v1/registro'), false);
        const componentes = camposDe(objeto.components);
        assert.equal(Object.hasOwn(componentes, 'securitySchemes'), api === 'habilitada');
        assert.equal(Object.hasOwn(camposDe(componentes.schemas), 'ErrorDeOAuth'), api === 'habilitada');
        const texto = await (
          await respuestaDeDescripcion(peticion('/llms.txt'), controles, leer, { diagnosticar: diagnosticar })
        ).text();
        assert.equal(texto.includes('](/mcp)'), mcp);
        assert.equal(texto.includes('](/a2a)'), a2a);
        assert.equal(texto.includes('/.well-known/agent-card.json'), a2a);
        assert.equal(texto.includes('API para instituciones'), api === 'habilitada');
        const herramientas = [...texto.matchAll(/`([a-z]+(?:_[a-z]+)+)`/gu)].map((m) => m[1]);
        assert.deepEqual(herramientas, api === 'habilitada' || mcp || a2a ? HERRAMIENTAS.map((h) => h.name) : []);
      });
    }
  }
}
test('autoridad desconocida no se convierte en apagado ni lee archivos', async () => {
  let lecturas = 0;
  const r = await respuestaDeDescripcion(
    peticion('/llms.txt'),
    null,
    async () => {
      lecturas++;
      return new Response(llms);
    },
    { diagnosticar: diagnosticar },
  );
  assert.equal(r.status, ERROR);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await r.json(), { error: 'controles_no_disponibles' });
  assert.equal(lecturas, 0);
});
test('el proyector no reutiliza el anuncio anterior al apagar y HEAD no devuelve cuerpo', async () => {
  const on = await respuestaDeDescripcion(peticion('/llms.txt'), { ...apagados, mcp: true }, leer, {
    diagnosticar: diagnosticar,
  });
  assert.match(await on.text(), /\]\(\/mcp\)/u);
  const off = await respuestaDeDescripcion(peticion('/llms.txt'), apagados, leer, { diagnosticar: diagnosticar });
  assert.equal(await off.text(), llms);
  const head = await respuestaDeDescripcion(peticion('/openapi.json', 'HEAD'), apagados, leer, {
    diagnosticar: diagnosticar,
  });
  assert.equal(head.status, OK);
  assert.equal(await head.text(), '');
  assert.equal(head.headers.get('cache-control'), 'no-store');
});
test('artefactos rotos o demasiado grandes devuelven fallo explícito y cancelan la lectura excedida', async () => {
  for (const contenido of ['{}', '[]', 'ilegible']) {
    const r = await respuestaDeDescripcion(peticion('/openapi.json'), apagados, async () => new Response(contenido), {
      diagnosticar: diagnosticar,
    });
    assert.equal(r.status, ERROR);
  }
  const invalida = await respuestaDeDescripcion(
    peticion('/llms.txt'),
    apagados,
    async () => new Response('<html>Error</html>'),
    { diagnosticar: diagnosticar },
  );
  assert.equal(invalida.status, ERROR);
  let cancelada = false;
  const r = await respuestaDeDescripcion(
    peticion('/llms.txt'),
    apagados,
    async () =>
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new Uint8Array(MAX_CUERPO + 1));
          },
          cancel() {
            cancelada = true;
          },
        }),
      ),
    { diagnosticar: diagnosticar },
  );
  assert.equal(r.status, ERROR);
  assert.equal(cancelada, true);
});
test('el lector solo recibe los dos archivos propios y no se ejecuta ante método o URL ajenos', async () => {
  let lecturas = 0;
  const lector = async () => {
    lecturas++;
    return new Response(llms);
  };
  for (const [url, method, esperado] of [
    ['/otro', 'GET', INCORRECTA],
    ['/llms.txt?archivo=otro', 'GET', INCORRECTA],
    ['/llms.txt', 'POST', METODO],
  ] as const) {
    const r = await respuestaDeDescripcion(
      new Request(`https://servicio.invalid${url}`, { method }),
      apagados,
      lector,
      { diagnosticar: diagnosticar },
    );
    assert.equal(r.status, esperado);
  }
  assert.equal(lecturas, 0);
  assert.equal(esDescripcionDeConectividad('/llms.txt'), true);
  assert.equal(esDescripcionDeConectividad('/openapi.json'), true);
  assert.equal(esDescripcionDeConectividad('/otro'), false);
});
test('OpenAPI tiene metadatos públicos, contacto vacío y el contrato actual de invitaciones', () => {
  const d = documentoOpenApi(),
    info = camposDe(d.info),
    paths = camposDe(d.paths);
  assert.doesNotMatch(JSON.stringify(info), /docs\/|herramientas\/|FARO_API|app\.faro@/u);
  assert.deepEqual(info.license, { name: 'Todos los derechos reservados.' });
  assert.equal(Object.hasOwn(info, 'contact'), false);
  assert.deepEqual(OPERACIONES_ESPECIALES, [{ metodo: 'GET', ruta: '/api/conectividad/estado' }]);
  for (const ruta of [RUTA_CONSULTAR_INVITACION, RUTA_ACTIVAR_INVITACION]) {
    const post = camposDe(camposDe(paths[ruta]).post);
    assert.deepEqual(post.security, []);
    assert.ok(Array.isArray(post.parameters));
    assert.ok(post.parameters.some((p) => camposDe(p).$ref === '#/components/parameters/Contrato'));
    assert.equal(Object.hasOwn(camposDe(paths[ruta]), 'get'), false);
  }
});

for (const fase of ['archivo', 'stream'] as const) {
  test(`el plazo termina una lectura estancada en ${fase}`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let cancelada = false,
      terminada = false;
    const diagnosticos: unknown[] = [];
    const lector = async () =>
      fase === 'archivo'
        ? new Promise<Response>(() => {})
        : new Response(
            new ReadableStream({
              cancel() {
                cancelada = true;
              },
            }),
          );
    const pendiente = respuestaDeDescripcion(peticion('/llms.txt'), apagados, lector, {
      diagnosticar: (e: unknown) => diagnosticos.push(e),
    });
    void pendiente.then(() => {
      terminada = true;
    });
    await turno();
    t.mock.timers.tick(PLAZO_PETICION_MS);
    await turno();
    assert.equal(terminada, true, 'El plazo debe resolver la petición aunque el lector no termine');
    assert.equal((await pendiente).status, ERROR);
    assert.equal(diagnosticos.length, 1);
    assert.equal(cancelada, fase === 'stream');
  });
}

test('el archivo entregado después del plazo se cancela y no vuelve a diagnosticar ni cambia la respuesta', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const entrega = Promise.withResolvers<Response>();
  const diagnosticos: unknown[] = [];
  let cancelada = false;
  const pendiente = respuestaDeDescripcion(peticion('/llms.txt'), apagados, async () => entrega.promise, {
    diagnosticar: (e) => diagnosticos.push(e),
  });
  await turno();
  t.mock.timers.tick(PLAZO_PETICION_MS);
  await turno();
  assert.equal((await pendiente).status, ERROR);
  entrega.resolve(
    new Response(
      new ReadableStream({
        cancel() {
          cancelada = true;
        },
      }),
    ),
  );
  await turno();
  assert.equal(cancelada, true);
  assert.equal(diagnosticos.length, 1);
});
test('cancelar la petición corta el stream y la siguiente lectura conserva su estado independiente', async () => {
  const cancelacion = new AbortController(),
    diagnosticos: unknown[] = [];
  let cancelada = false;
  const peticion = new Request('https://servicio.invalid/llms.txt', { signal: cancelacion.signal });
  const pendiente = respuestaDeDescripcion(
    peticion,
    apagados,
    async (_ruta, senal) => {
      assert.equal(senal.aborted, false);
      return new Response(
        new ReadableStream({
          cancel() {
            cancelada = true;
          },
        }),
      );
    },
    { diagnosticar: (e) => diagnosticos.push(e) },
  );
  await turno();
  cancelacion.abort();
  assert.equal((await pendiente).status, ERROR);
  assert.equal(cancelada, true);
  assert.equal(diagnosticos.length, 1);
  const siguiente = await respuestaDeDescripcion(new Request('https://servicio.invalid/llms.txt'), apagados, leer, {
    diagnosticar: (e) => diagnosticos.push(e),
  });
  assert.equal(siguiente.status, OK);
  assert.equal(await siguiente.text(), llms);
  assert.equal(diagnosticos.length, 1);
});
test('el diagnóstico recibe la clase de fallo pero la respuesta no copia su mensaje ni datos privados', async () => {
  const error = new TypeError('mensaje privado /ruta?secreto=valor'),
    diagnosticos: unknown[] = [];
  const respuesta = await respuestaDeDescripcion(
    peticion('/llms.txt'),
    apagados,
    async () => {
      throw error;
    },
    { diagnosticar: (e) => diagnosticos.push(e) },
  );
  assert.deepEqual(diagnosticos, [error]);
  assert.deepEqual(await respuesta.json(), { error: 'descripcion_no_disponible' });
});

test('el apagado explícito sin administración publica base sin anuncios y no inventa controles ni diagnostica fallo', async () => {
  const diagnosticos: unknown[] = [];
  const opciones = { diagnosticar: (e: unknown) => diagnosticos.push(e) };
  const guia = await respuestaDeDescripcion(peticion('/llms.txt'), 'apagado-sin-administracion', leer, opciones);
  assert.equal(guia.status, OK);
  assert.equal(await guia.text(), llms);
  const doc = await respuestaDeDescripcion(peticion('/openapi.json'), 'apagado-sin-administracion', leer, opciones);
  assert.equal(doc.status, OK);
  const json: unknown = await doc.json();
  const paths = camposDe(camposDe(json).paths);
  assert.equal(Object.hasOwn(paths, '/api/salud'), true);
  assert.equal(Object.hasOwn(paths, '/api/conectividad/estado'), true);
  assert.equal(Object.hasOwn(paths, RUTA_ACTIVAR_INVITACION), false);
  assert.deepEqual(diagnosticos, []);
});
