// El binding privado conserva consultas factuales, aislamiento de datos, plazos y errores entre dos isolates.
// La construcción separa el código de los Workers y comprueba sus datos publicados.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { OFERTA_POR_DEFECTO } from '../../compartido/contratos/oferta-de-formacion.ts';
import {
  CARPETA_CURSOS,
  comprobarPlantillaCloudflare,
  comprobarPlantillaDeCursos,
  conConstruccionCloudflare,
  protocoloConHuella,
} from '../../herramientas/cloudflare/comprobar-construccion.ts';
import { crearApi, type ResponderApi } from '../../src/api/api.ts';
import { CABECERA_CONTRATO, CONTRATO_API } from '../../src/api/metadatos-http.ts';
import { DIRECCION_DE_CURSOS, HUELLA_DEL_PAQUETE } from '../../src/plataforma/cloudflare/protocolo-cursos.ts';
import { crearPuertaDeCursosCloudflare, type EnlaceDeCursos } from '../../src/plataforma/cloudflare/puerta-cursos.ts';
import workerDeCursos from '../../src/plataforma/cloudflare/worker-cursos.ts';
import { motorDeCursos } from '../../src/plataforma/motor-de-cursos.ts';
import { cargarDatos } from '../../src/plataforma/node/datos.ts';
import { RUTAS } from '../../src/plataforma/node/rutas.ts';
import { versionDelPaquete } from '../../src/plataforma/paquete-publicado.ts';
import { contextoConstruido } from '../ayudas/web-construida.ts';

const LIMITE_MS = 60;
/** Holgura de la medida: el reloj de la prueba no es exacto. */
const HOLGURA_MS = 200;
const NO_ENCONTRADO = 404;
const SOLICITUD_INCORRECTA = 400;
const CONFLICTO = 409;
const CORRECTO = 200;
const ERROR_DEL_SERVIDOR = 500;
const LARGO_SHA256 = 64;
/** El tope de Cloudflare para un Worker y sus módulos, sin comprimir: 64 MiB. */
const MAX_WORKER_BYTES = 67_108_864;
/** Los tiempos máximos de cada prueba: las pequeñas, las que construyen y las que cargan el motor y el paquete. */
const PLAZO_CORTO_MS = 10_000;
const PLAZO_LARGO_MS = 180_000;
/** La huella del paquete del principal en las pruebas de la puerta, y la de otra publicación. */
const HUELLA = '0123456789abcdef';
const OTRA_HUELLA = 'fedcba9876543210';
const ARGUMENTOS_DEL_CATALOGO = [
  { hoy: '2026-10-07', oferta: OFERTA_POR_DEFECTO, filtros: { texto: '' }, pagina: 1 },
] as never;

function plantilla(archivo: string) {
  return JSON.parse(readFileSync(new URL(`../../config/cloudflare/${archivo}`, import.meta.url), 'utf8'));
}

/** Un binding doble: responde con lo que diga `atender`, y anota lo que se le pide. */
function enlaceDoble(atender: (cuerpo: Record<string, unknown>) => Promise<Response> | Response) {
  const pedidos: Record<string, unknown>[] = [];
  const enlace: EnlaceDeCursos = {
    async fetch(peticion) {
      assert.equal(peticion.url, DIRECCION_DE_CURSOS);
      assert.equal(peticion.method, 'POST');
      const cuerpo = (await peticion.json()) as Record<string, unknown>;
      pedidos.push(cuerpo);
      return atender(cuerpo);
    },
  };
  return { enlace, pedidos };
}

const json = (valor: unknown, status = 200) => Response.json(valor, { status });
/** Una respuesta del Worker de Cursos que lleva el paquete `huella` (por defecto, el del principal de la prueba). */
const deCursos = (valor: Record<string, unknown>, status = 200, huella = HUELLA) =>
  json({ ...valor, huellaPaquete: huella }, status);

test('plantillas: el principal declara el binding CURSOS al Worker de Cursos, que no tiene URLs ni almacenes', {
  timeout: PLAZO_CORTO_MS,
}, () => {
  const principal = plantilla('wrangler.example.jsonc');
  const cursos = plantilla('wrangler.cursos.example.jsonc');
  comprobarPlantillaCloudflare(principal);
  comprobarPlantillaDeCursos(cursos, principal);
  for (const servicios of [
    undefined,
    [],
    [{ binding: 'CURSOS', service: 'otro' }],
    [{ binding: 'X', service: 'faro-cursos' }],
  ]) {
    const valor = plantilla('wrangler.example.jsonc');
    if (servicios === undefined) {
      delete valor.services;
    } else {
      valor.services = servicios;
    }
    assert.throws(() => comprobarPlantillaCloudflare(valor), /enlace de servicio CURSOS/u);
  }
  for (const cambio of [
    { workers_dev: true },
    { preview_urls: true },
    { routes: ['faro.example/*'] },
    { assets: { directory: '../../web' } },
    { compatibility_date: '2020-01-01' },
    { compatibility_flags: [] },
    { name: 'faro' },
    { main: '../../src/plataforma/cloudflare/worker.ts' },
  ]) {
    assert.throws(() => comprobarPlantillaDeCursos({ ...cursos, ...cambio }, principal), JSON.stringify(cambio));
  }
});

test('construcción: dos Workers; el principal sin el motor de cursos y el de Cursos con él y sus datos', {
  timeout: PLAZO_LARGO_MS,
}, async () => {
  await conConstruccionCloudflare(async (directorio, resultado) => {
    // Cada Worker conserva sus datos vivos: formación en el de Cursos y ocupaciones en el principal.
    assert.ok(resultado.cursos.datos.some((dato) => dato.ruta === 'datos/formacion.json'));
    assert.ok(resultado.datos.some((dato) => dato.ruta === 'datos/esco.json'));
    assert.ok(resultado.cursos.totalWorkerBytes <= MAX_WORKER_BYTES && resultado.totalWorkerBytes <= MAX_WORKER_BYTES);
    console.log(
      `Workers: principal ${resultado.totalWorkerBytes} bytes (código ${resultado.codigoBytes}); ` +
        `Cursos ${resultado.cursos.totalWorkerBytes} bytes (código ${resultado.cursos.codigoBytes}); tope ${MAX_WORKER_BYTES}`,
    );
    const principal = readFileSync(join(directorio, 'worker.mjs'), 'utf8');
    const cursos = readFileSync(join(directorio, CARPETA_CURSOS, 'worker.mjs'), 'utf8');
    assert.ok(resultado.cursos.codigoBytes > 0 && resultado.cursos.datos.length > 0);
    assert.equal(resultado.cursos.codigoBytes, Buffer.byteLength(cursos));
    for (const dato of resultado.cursos.datos) {
      assert.ok(readFileSync(join(directorio, CARPETA_CURSOS, dato.ruta)).byteLength === dato.bytes, dato.ruta);
    }
    // Las funciones del motor solo están en el Worker de Cursos; el principal tiene en su lugar un módulo ausente.
    // (formacionDelInforme no: src/dominio/informe.ts tiene una función interna con el mismo nombre.)
    for (const funcion of ['catalogoDeCursos', 'formacionDeLaOcupacion']) {
      const definicion = new RegExp(`function ${funcion}\\d*\\(`, 'u');
      assert.match(cursos, definicion);
      assert.doesNotMatch(principal, definicion);
    }
    assert.match(principal, /el motor de cursos va en el Worker de Cursos/u);
    assert.ok(!cursos.includes('class AccesoPublicoDurable'));
    // Los dos Workers llevan la huella del paquete que se construyó, nunca la plantilla neutra del protocolo.
    const manifiesto = readFileSync(join(RUTAS.paquete, 'manifiesto.json'));
    const huella = versionDelPaquete(createHash('sha256').update(manifiesto).digest('hex'));
    for (const [nombre, worker] of [
      ['principal', principal],
      ['Cursos', cursos],
    ] as const) {
      assert.ok(worker.includes(JSON.stringify(huella)), `El Worker ${nombre} no lleva la huella ${huella}`);
      assert.doesNotMatch(worker, /HUELLA_DEL_PAQUETE\d*\s*=\s*(?:""|'')/u, `El Worker ${nombre} lleva la plantilla`);
    }
  }, contextoConstruido());
});

test('puerta del binding: con el Worker de Cursos sano, cada operación sin los datos y sin pedir las listas', {
  timeout: PLAZO_CORTO_MS,
}, async () => {
  const { enlace, pedidos } = enlaceDoble(() => deCursos({ ok: true, valor: { pagina: 1, cursos: [] } }));
  const puerta = crearPuertaDeCursosCloudflare(enlace, { limiteOperacionMs: LIMITE_MS, huellaPaquete: HUELLA });
  assert.equal(puerta.enSuTrabajador, true);
  assert.ok(!('cargar' in puerta) && !('ejecutar' in puerta));
  const resultado = await puerta.operar('catalogoDeCursos', ARGUMENTOS_DEL_CATALOGO, { datos: { enorme: true } });
  assert.deepEqual(resultado, { disponible: true, valor: { pagina: 1, cursos: [] } });
  assert.deepEqual(pedidos, [
    { tipo: 'operacion', nombre: 'catalogoDeCursos', argumentos: ARGUMENTOS_DEL_CATALOGO, huellaPaquete: HUELLA },
  ]);
});

test('puerta del binding: un Worker de Cursos con otro paquete, o que no dice cuál lleva, no mezcla sus datos', {
  timeout: PLAZO_CORTO_MS,
}, async () => {
  const operar = async (respuesta: () => Response) => {
    const { enlace } = enlaceDoble(respuesta);
    const puerta = crearPuertaDeCursosCloudflare(enlace, { limiteOperacionMs: LIMITE_MS, huellaPaquete: HUELLA });
    return puerta.operar('catalogoDeCursos', ARGUMENTOS_DEL_CATALOGO);
  };
  // Durante una publicación, o si falla la segunda mitad, Cursos puede llevar el paquete de otra versión.
  const deOtraVersion = await operar(() =>
    deCursos({ ok: true, valor: { pagina: 1, cursos: [1] } }, CORRECTO, OTRA_HUELLA),
  );
  assert.equal(deOtraVersion.disponible, false);
  assert.equal(deOtraVersion.disponible || deOtraVersion.motivo, 'averiado');
  assert.match(deOtraVersion.disponible ? '' : deOtraVersion.detalle, /lleva el paquete fedcba9876543210/u);
  // Un Worker de Cursos que no dice qué paquete lleva tampoco se usa.
  const sinHuella = await operar(() => json({ ok: true, valor: { pagina: 1, cursos: [1] } }));
  assert.equal(sinHuella.disponible || sinHuella.motivo, 'averiado');
  const rechazada = await operar(() =>
    deCursos({ ok: false, motivo: 'averiado', detalle: 'otro paquete' }, CONFLICTO, OTRA_HUELLA),
  );
  assert.equal(rechazada.disponible || rechazada.motivo, 'averiado');
});

test('puerta del binding: ausente sin binding; averiado si falla o responde 5xx; bloqueado si no responde a tiempo', {
  timeout: PLAZO_CORTO_MS,
}, async () => {
  const motivo = async (enlace: EnlaceDeCursos | undefined) => {
    const puerta = crearPuertaDeCursosCloudflare(enlace, { limiteOperacionMs: LIMITE_MS, huellaPaquete: HUELLA });
    const operado = await puerta.operar('catalogoDeCursos', ARGUMENTOS_DEL_CATALOGO);
    return operado.disponible || operado.motivo;
  };
  assert.equal(await motivo(undefined), 'ausente');
  const lanza = enlaceDoble(() => {
    throw new Error('Worker exceeded CPU time limit');
  });
  assert.equal(await motivo(lanza.enlace), 'averiado');
  const roto = enlaceDoble(() => new Response('Error 1102', { status: 503 }));
  assert.equal(await motivo(roto.enlace), 'averiado');
  const conForma = enlaceDoble(() => deCursos({ ok: true, valor: 1 }, ERROR_DEL_SERVIDOR));
  assert.equal(await motivo(conForma.enlace), 'averiado');
  const mal = enlaceDoble(() => deCursos({ valor: 3 }));
  assert.equal(await motivo(mal.enlace), 'averiado');
  const sinMotor = enlaceDoble(() => deCursos({ ok: false, motivo: 'ausente', detalle: 'sin motor' }));
  assert.equal(await motivo(sinMotor.enlace), 'ausente');
  // Un Worker de Cursos colgado que atiende la señal de corte, otro que no la atiende nunca (como un binding que pierde
  // la señal) y otro que manda la cabecera y se queda sin terminar el cuerpo: el principal deja de esperar en su tiempo
  // máximo y sigue.
  const atiende: EnlaceDeCursos = {
    fetch: (peticion) =>
      new Promise((_, falla) => peticion.signal.addEventListener('abort', () => falla(peticion.signal.reason))),
  };
  const sordo: EnlaceDeCursos = { fetch: () => new Promise(() => {}) };
  const aMedias: EnlaceDeCursos = {
    fetch: async () =>
      new Response(new ReadableStream({ start: (c) => c.enqueue(new TextEncoder().encode('{"ok":')) })),
  };
  for (const colgado of [atiende, sordo, aMedias]) {
    const inicio = performance.now();
    assert.equal(await motivo(colgado), 'bloqueado');
    assert.ok(performance.now() - inicio < LIMITE_MS + HOLGURA_MS, 'no espera más que su tiempo máximo');
  }
});

test('puerta del binding: rechaza referencias de otro trabajador o paquete sin consultar el binding', {
  timeout: PLAZO_CORTO_MS,
}, async () => {
  const { enlace, pedidos } = enlaceDoble(() => json({ ok: true, valor: null }));
  const puerta = crearPuertaDeCursosCloudflare(enlace);
  const ajeno = await puerta.operar('catalogoDeCursos', [{ guardadoDeCursos: 'g1' }] as never);
  assert.equal(ajeno.disponible || ajeno.motivo, 'averiado');
  const origen = {
    origenDeCursos: { paquete: 'file:///datos/', archivo: 'formacion.json', sha256: '0'.repeat(LARGO_SHA256) },
  };
  const deOtroPaquete = await puerta.operar('catalogoDeCursos', [origen] as never);
  assert.equal(deOtroPaquete.disponible || deOtroPaquete.motivo, 'averiado');
  assert.deepEqual(pedidos, []);
});

/** Pide algo al Worker de Cursos real, como lo haría el binding. */
function pedirAlWorker(worker: typeof workerDeCursos, cuerpo: unknown, metodo = 'POST') {
  return worker.fetch(
    new Request(DIRECCION_DE_CURSOS, {
      method: metodo,
      ...(metodo === 'POST' ? { body: JSON.stringify(cuerpo) } : {}),
    }),
  );
}

test('Worker de Cursos: atiende las operaciones del motor real y rechaza lo que no es una petición del principal', {
  timeout: PLAZO_LARGO_MS,
}, async () => {
  const catalogo = (await (
    await pedirAlWorker(workerDeCursos, {
      tipo: 'operacion',
      nombre: 'catalogoDeCursos',
      argumentos: ARGUMENTOS_DEL_CATALOGO,
      huellaPaquete: HUELLA_DEL_PAQUETE,
    })
  ).json()) as { ok: boolean; valor: { fichas: unknown[]; enLaBolsa: number }; huellaPaquete: string };
  assert.equal(catalogo.ok, true);
  assert.equal(catalogo.huellaPaquete, HUELLA_DEL_PAQUETE);
  assert.ok(Array.isArray(catalogo.valor.fichas) && catalogo.valor.enLaBolsa > 0);
  assert.equal((await pedirAlWorker(workerDeCursos, null, 'GET')).status, NO_ENCONTRADO);
  const deCatalogo = { tipo: 'operacion', nombre: 'catalogoDeCursos', argumentos: ARGUMENTOS_DEL_CATALOGO };
  for (const cuerpo of [
    { tipo: 'listas', huellaPaquete: HUELLA_DEL_PAQUETE },
    { tipo: 'operacion', nombre: 'eval', argumentos: [], huellaPaquete: HUELLA_DEL_PAQUETE },
    // Un principal que no dice qué paquete espera no recibe datos de este.
    deCatalogo,
  ]) {
    const mal = await pedirAlWorker(workerDeCursos, cuerpo);
    assert.equal(mal.status, SOLICITUD_INCORRECTA);
    assert.deepEqual(((await mal.json()) as { motivo: string }).motivo, 'averiado');
  }
});

test('Worker de Cursos: a un principal que espera otro paquete le responde sin calcular, con el paquete que lleva', {
  timeout: PLAZO_CORTO_MS,
}, async () => {
  const respuesta = await pedirAlWorker(workerDeCursos, {
    tipo: 'operacion',
    nombre: 'catalogoDeCursos',
    argumentos: ARGUMENTOS_DEL_CATALOGO,
    huellaPaquete: OTRA_HUELLA,
  });
  assert.equal(respuesta.status, CONFLICTO);
  const cuerpo = (await respuesta.json()) as Record<string, unknown>;
  assert.deepEqual(Object.keys(cuerpo).sort(), ['detalle', 'huellaPaquete', 'motivo', 'ok']);
  assert.equal(cuerpo.ok, false);
  assert.equal(cuerpo.motivo, 'averiado');
  assert.equal(cuerpo.huellaPaquete, HUELLA_DEL_PAQUETE);
  assert.match(String(cuerpo.detalle), /espera el paquete fedcba9876543210/u);
});

test('construcción: cada Worker lleva la huella de su paquete en lugar de la plantilla neutra del protocolo', {
  timeout: PLAZO_CORTO_MS,
}, () => {
  const fuente = readFileSync(new URL('../../src/plataforma/cloudflare/protocolo-cursos.ts', import.meta.url), 'utf8');
  assert.equal(HUELLA_DEL_PAQUETE, '', 'en las fuentes, la huella es la plantilla neutra');
  const construido = protocoloConHuella(fuente, HUELLA);
  assert.ok(construido.includes(`export const HUELLA_DEL_PAQUETE = "${HUELLA}";`));
  assert.ok(!construido.includes("export const HUELLA_DEL_PAQUETE = '';"));
  assert.equal(construido.length - fuente.length, `"${HUELLA}"`.length - "''".length);
  assert.throws(() => protocoloConHuella(fuente, 'no-es-una-huella'), /16 cifras hexadecimales/u);
  assert.throws(() => protocoloConHuella(construido, HUELLA), /una sola vez la plantilla neutra/u);
  assert.throws(() => protocoloConHuella(`${fuente}\n${fuente}`, HUELLA), /una sola vez la plantilla neutra/u);
});

const CARPETA = fileURLToPath(new URL('../../datos/', import.meta.url));
/** La API con el binding al Worker de Cursos, que alterna dos copias suyas: como dos isolates. */
async function apiConDosIsolates(datos: ReturnType<typeof cargarDatos>) {
  // Cada copia atiende la consulta factual con su propio módulo y paquete.
  const otroIsolate = '../../src/plataforma/cloudflare/worker-cursos.ts?isolate=2';
  const copias = [workerDeCursos, ((await import(otroIsolate)) as { default: typeof workerDeCursos }).default];
  assert.notEqual(copias[0], copias[1]);
  const usadas = new Set<number>();
  let vez = 0;
  const enlace: EnlaceDeCursos = {
    fetch: (peticion) => {
      vez += 1;
      usadas.add(vez % copias.length);
      return (copias[vez % copias.length] ?? workerDeCursos).fetch(peticion);
    },
  };
  const base = { datos, origenesPermitidos: [] } as const;
  const api = await crearApi({
    ...base,
    motorDeCursos: crearPuertaDeCursosCloudflare(enlace),
  });
  const local = await crearApi({ ...base, motorDeCursos });
  return { api, local, peticiones: () => ({ vez, copias: usadas.size }) };
}

test('/api/cursos por el binding: cada petición en otro isolate conserva el resultado factual local', {
  timeout: PLAZO_LARGO_MS,
}, async () => {
  const { api, local, peticiones } = await apiConDosIsolates(cargarDatos(CARPETA));
  for (const consulta of ['', '&q=cocina', '&fuente=soc', '&modalidad=a-distancia']) {
    const ruta = `https://catalogo.test/api/cursos?fecha=2026-10-21${consulta}`;
    const pedir = (atender: ResponderApi) =>
      atender(
        new Request(ruta, {
          headers: { [CABECERA_CONTRATO]: String(CONTRATO_API) },
        }),
      );
    const esperado = await pedir(local);
    const obtenido = await pedir(api);
    assert.equal(esperado.status, CORRECTO, ruta);
    assert.equal(obtenido.status, esperado.status, ruta);
    assert.equal(await obtenido.text(), await esperado.text(), ruta);
  }
  assert.deepEqual(peticiones(), { vez: 4, copias: 2 });
});
