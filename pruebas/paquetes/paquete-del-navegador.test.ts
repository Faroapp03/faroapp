import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { afterEach, test } from 'node:test';
import { ERRATAS_ESCO } from '../../src/dominio/erratas-esco.ts';
import { ARCHIVO_DE_CADA_PARTE, MANIFIESTO } from '../../src/plataforma/archivos-del-paquete.ts';
import { cargarPaquete, leerExtraDelPaquete } from '../../src/plataforma/navegador/paquete.ts';

const PLAZO_MS = 60_000;
const CIFRAS_VERSION = 64;
const BYTE_INVALIDO = 0xff;
const BASE = new URL('https://paquete.test/paquete/0123456789abcdef/');
const fetchOriginal = globalThis.fetch;
const timeoutOriginal = AbortSignal.timeout;
const parseOriginal = JSON.parse;
const digestOriginal = crypto.subtle.digest;
afterEach(() => {
  globalThis.fetch = fetchOriginal;
  AbortSignal.timeout = timeoutOriginal;
  JSON.parse = parseOriginal;
  crypto.subtle.digest = digestOriginal;
});

/** Paquete mínimo autónomo: no depende de los datos oficiales ni de la ruta que aloje el producto. */
function archivosMinimos(): Map<string, Uint8Array<ArrayBuffer>> {
  const esco = { competencias: [], ocupaciones: {} };
  return new Map(
    Object.entries({
      'esco.json': esco,
      'oit.json': { ocupaciones: {}, tareas: {} },
      'clasificaciones.json': {},
      'exposicion-cambra.json': {},
      'textos.json': { tareas: {}, competencias_por_ocupacion: {} },
    }).map(([archivo, datos]) => [archivo, new TextEncoder().encode(JSON.stringify(datos))]),
  );
}

function huella(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Publicación simulada por sus bytes; la red real nunca interviene. */
function servir(
  archivos: Map<string, Uint8Array<ArrayBuffer>>,
  manifiesto?: Uint8Array<ArrayBuffer>,
): {
  pedidos: string[];
  bytesManifiesto: Uint8Array<ArrayBuffer>;
} {
  const pedidos: string[] = [];
  const bytesManifiesto =
    manifiesto ??
    new TextEncoder().encode(
      JSON.stringify(Object.fromEntries([...archivos].map(([archivo, bytes]) => [archivo, { sha256: huella(bytes) }]))),
    );
  globalThis.fetch = async (recurso) => {
    const url = new URL(recurso instanceof Request ? recurso.url : String(recurso));
    assert.equal(url.origin, BASE.origin);
    assert.ok(url.pathname.startsWith(BASE.pathname));
    const archivo = url.pathname.slice(BASE.pathname.length);
    pedidos.push(archivo);
    const bytes = archivo === MANIFIESTO ? bytesManifiesto : archivos.get(archivo);
    return bytes ? new Response(bytes) : new Response(null, { status: 404 });
  };
  return { pedidos, bytesManifiesto };
}

test('carga una vez cada parte obligatoria, conserva orden y versión SHA-256 de los bytes del manifiesto', async () => {
  const { pedidos, bytesManifiesto } = servir(archivosMinimos());
  const plazos: number[] = [];
  AbortSignal.timeout = (ms) => {
    plazos.push(ms);
    return new AbortController().signal;
  };
  const { datos, version } = await cargarPaquete(BASE);
  assert.deepEqual(Object.keys(datos), ['esco', 'oit', 'clasificaciones', 'cambra', 'textos']);
  assert.deepEqual(pedidos, [
    MANIFIESTO,
    'esco.json',
    'oit.json',
    'clasificaciones.json',
    'exposicion-cambra.json',
    'textos.json',
  ]);
  assert.equal(version, huella(bytesManifiesto));
  assert.equal(version.length, CIFRAS_VERSION);
  assert.deepEqual(
    plazos,
    pedidos.map(() => PLAZO_MS),
  );
  assert.deepEqual(datos.esco, { competencias: [], ocupaciones: {} });
});

test('solo pide una parte opcional si el manifiesto la nombra, con la misma preparación', async () => {
  const archivos = archivosMinimos();
  const archivo = ARCHIVO_DE_CADA_PARTE.actic;
  const datos = { titulo: 'Acreditación sintética' };
  archivos.set(archivo, new TextEncoder().encode(JSON.stringify(datos)));
  const { pedidos } = servir(archivos);
  const cargado = await cargarPaquete(BASE);
  assert.deepEqual(cargado.datos.actic, datos);
  assert.equal(pedidos.filter((nombre) => nombre === archivo).length, 1);
  assert.equal(pedidos.includes(ARCHIVO_DE_CADA_PARTE.vectores), false);
});

test('el extra solo se lee con su huella, y la ausencia no descarga datos', async () => {
  const archivos = archivosMinimos();
  const archivo = 'extra.json';
  const valor = { dato: 'sintético' };
  archivos.set(archivo, new TextEncoder().encode(JSON.stringify(valor)));
  const { pedidos } = servir(archivos);
  assert.deepEqual(await leerExtraDelPaquete(BASE, archivo), valor);
  archivos.set(archivo, new TextEncoder().encode('{"dato":"alterado"}'));
  await assert.rejects(leerExtraDelPaquete(BASE, archivo), /extra\.json no coincide con su huella/);
  assert.equal(await leerExtraDelPaquete(BASE, 'ausente.json'), null);
  assert.equal(pedidos.includes('ausente.json'), false);
});

test('rechaza una huella que no corresponde sin intentar preparar el JSON incorrecto', async () => {
  const archivos = archivosMinimos();
  servir(archivos);
  archivos.set('esco.json', new TextEncoder().encode('no es JSON'));
  await assert.rejects(cargarPaquete(BASE), /esco\.json no coincide con su huella en manifiesto\.json/);
});

test('rechaza manifiesto no objeto y una entrada sin huella, sin normalizarlos', async () => {
  servir(archivosMinimos(), new TextEncoder().encode('[]'));
  await assert.rejects(cargarPaquete(BASE), /manifiesto\.json no es un objeto/);
  servir(archivosMinimos(), new TextEncoder().encode('{}'));
  await assert.rejects(cargarPaquete(BASE), /esco\.json no coincide con su huella/);
});

test('un HTTP fallido conserva el nombre y estado del archivo', async () => {
  const archivos = archivosMinimos();
  servir(archivos);
  archivos.delete('textos.json');
  await assert.rejects(cargarPaquete(BASE), /No se ha podido cargar textos\.json del paquete \(404\)/);
});

test('el plazo abarca también el cuerpo y conserva TimeoutError como causa', async () => {
  const error = new DOMException('plazo agotado', 'TimeoutError');
  globalThis.fetch = async () => {
    const cuerpo = new ReadableStream({
      start(controlador) {
        controlador.error(error);
      },
    });
    return new Response(cuerpo);
  };
  await assert.rejects(cargarPaquete(BASE), (recibido: unknown) => {
    assert.ok(recibido instanceof Error);
    assert.match(recibido.message, /manifiesto\.json.*sin respuesta en el plazo/);
    assert.equal(recibido.cause, error);
    return true;
  });
});

test('propaga fallos de transporte ajenos al plazo sin sustituirlos', async () => {
  const error = new TypeError('red simulada no disponible');
  globalThis.fetch = async () => {
    throw error;
  };
  await assert.rejects(cargarPaquete(BASE), (recibido) => recibido === error);
});

test('propaga el error original de Web Crypto sin atribuirlo a los bytes JSON', async () => {
  servir(archivosMinimos());
  const error = new TypeError('digest no disponible');
  crypto.subtle.digest = async () => {
    throw error;
  };
  await assert.rejects(cargarPaquete(BASE), (recibido) => recibido === error);
});

test('un fallo ajeno a SyntaxError o TypeError del lector se propaga sin envolverlo', async () => {
  servir(archivosMinimos());
  const error = new Error('analizador simulado no disponible');
  JSON.parse = () => {
    throw error;
  };
  await assert.rejects(cargarPaquete(BASE), (recibido) => recibido === error);
});

test('manifiesto JSON defectuoso conserva SyntaxError y señala el archivo con su causa', async () => {
  servir(archivosMinimos(), new TextEncoder().encode('{'));
  await assert.rejects(cargarPaquete(BASE), (error: unknown) => {
    assert.ok(error instanceof SyntaxError);
    assert.match(error.message, /manifiesto\.json no es JSON UTF-8 válido/);
    assert.ok(error.cause instanceof SyntaxError);
    return true;
  });
});

test('manifiesto UTF-8 defectuoso conserva TypeError y señala el archivo con su causa', async () => {
  servir(archivosMinimos(), new Uint8Array([BYTE_INVALIDO]));
  await assert.rejects(cargarPaquete(BASE), (error: unknown) => {
    assert.ok(error instanceof TypeError);
    assert.match(error.message, /manifiesto\.json no es JSON UTF-8 válido/);
    assert.ok(error.cause instanceof TypeError);
    return true;
  });
});

test('parte con huella válida pero JSON defectuoso señala qué archivo falla', async () => {
  const archivos = archivosMinimos();
  archivos.set('textos.json', new TextEncoder().encode('{'));
  servir(archivos);
  await assert.rejects(cargarPaquete(BASE), (error: unknown) => {
    assert.ok(error instanceof SyntaxError);
    assert.match(error.message, /textos\.json no es JSON UTF-8 válido/);
    assert.ok(error.cause instanceof SyntaxError);
    return true;
  });
});

test('parte con huella válida pero UTF-8 defectuoso señala qué archivo falla', async () => {
  const archivos = archivosMinimos();
  archivos.set('textos.json', new Uint8Array([BYTE_INVALIDO]));
  servir(archivos);
  await assert.rejects(cargarPaquete(BASE), (error: unknown) => {
    assert.ok(error instanceof TypeError);
    assert.match(error.message, /textos\.json no es JSON UTF-8 válido/);
    assert.ok(error.cause instanceof TypeError);
    return true;
  });
});

test('el catalán usa la URI de ESCO verificado sin nuevas lecturas ni saltar huellas', async () => {
  const errata = ERRATAS_ESCO[0];
  assert.ok(errata);
  const archivos = archivosMinimos();
  archivos.set(
    'esco.json',
    new TextEncoder().encode(
      JSON.stringify({
        competencias: [],
        ocupaciones: { [errata.esco]: { uri: errata.uri, titulo: 'Original', isco08: '0000', competencias: [] } },
      }),
    ),
  );
  archivos.set(
    'catalan.json',
    new TextEncoder().encode(JSON.stringify({ ocupaciones: { [errata.esco]: 'Títol original' } })),
  );
  const { pedidos } = servir(archivos);
  const cargados = await cargarPaquete(BASE);
  assert.equal(cargados.datos.catalan?.ocupaciones[errata.esco], errata.tituloCa);
  assert.equal(pedidos.filter((nombre) => nombre === 'esco.json').length, 1);
  assert.equal(pedidos.filter((nombre) => nombre === 'catalan.json').length, 1);
  assert.equal(pedidos.filter((nombre) => nombre === MANIFIESTO).length, 1);
  archivos.set(
    'esco.json',
    new TextEncoder().encode(
      JSON.stringify({
        competencias: [],
        ocupaciones: { [errata.esco]: { uri: 'otra-uri', titulo: 'Original', isco08: '0000', competencias: [] } },
      }),
    ),
  );
  const distinta = servir(archivos);
  const sinCorreccion = await cargarPaquete(BASE);
  assert.equal(sinCorreccion.datos.catalan?.ocupaciones[errata.esco], 'Títol original');
  assert.equal(distinta.pedidos.filter((nombre) => nombre === 'esco.json').length, 1);
  assert.equal(distinta.pedidos.filter((nombre) => nombre === 'catalan.json').length, 1);
  servir(archivos);
  archivos.set('catalan.json', new TextEncoder().encode('{"ocupaciones":{}}'));
  await assert.rejects(cargarPaquete(BASE), /catalan\.json no coincide con su huella/);
});
