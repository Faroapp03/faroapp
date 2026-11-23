// La construcción candidata conserva su selección, CSP y bytes sin escribir las fuentes ni recompilar el motor.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { comprobarArtefactoCloudflare, exportarArtefactoCloudflare } from '../../herramientas/cloudflare/artefacto.ts';
import {
  comprobarConstruccionCloudflare,
  conConstruccionCloudflare,
  type WebConstruida,
} from '../../herramientas/cloudflare/comprobar-construccion.ts';
import { manifiestoDelDispositivo } from '../../herramientas/web/manifiesto-del-dispositivo.ts';
import { IDENTIDAD_WEB } from '../../src/comun/identidad-web.ts';
import { paqueteParaPublicar } from '../../src/plataforma/node/paquete-publicado.ts';
import { RUTAS } from '../../src/plataforma/node/rutas.ts';
import { asegurarDesafioSi401 } from '../ayudas/desafio.ts';

const REVISION = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const MAPA = '{"integrity":{}}';
const HUELLA_MAPA = `'sha256-${createHash('sha256').update(MAPA).digest('base64')}'`;
const FUENTE_HUELLA = join(RUTAS.raiz, 'src/plataforma/mapa-de-modulos.ts');
const MOTOR = Buffer.from('export const motorCandidato = "referencia independiente";\n');
const CORRECTO = 200;
const NO_ENCONTRADO = 404;
const NO_AUTORIZADO = 401;
/** Un byte por encima del límite de 256 KiB para tablas incorporadas al Worker. */
const POLITICA_DEMASIADO_GRANDE = 262_145;

function escribir(web: string, ruta: string, contenido: string | Uint8Array): void {
  mkdirSync(dirname(join(web, ruta)), { recursive: true });
  writeFileSync(join(web, ruta), contenido);
}
function candidata() {
  const padre = mkdtempSync(join(realpathSync(tmpdir()), 'cloudflare-candidata-'));
  const web = join(padre, 'web candidata');
  escribir(web, '.assetsignore', '.assetsignore\n*.md\nentrada-privada.txt\n');
  escribir(web, 'solo-candidata.txt', 'Bytes exclusivos de la candidata');
  escribir(web, 'entrada-privada.txt', 'Dato sintético excluido');
  escribir(web, 'README.md', 'Documentación sin publicar');
  escribir(web, 'administracion/index.html', '<!doctype html><title>Panel</title>');
  escribir(web, 'index.html', `<script type="importmap">${MAPA}</script>`);
  escribir(web, 'motor/entrada.js', MOTOR);
  const { version, archivos } = paqueteParaPublicar(RUTAS.paquete);
  for (const archivo of archivos) {
    const destino = join(web, 'paquete', version, archivo);
    mkdirSync(dirname(destino), { recursive: true });
    copyFileSync(join(RUTAS.paquete, archivo), destino);
  }
  escribir(web, 'firmas/manifiesto.json', manifiestoDelDispositivo(web, version));
  const contexto: WebConstruida = {
    web,
    paquete: RUTAS.paquete,
    motor: new Map([['motor/entrada.js', MOTOR]]),
    huellaMapaModulos: HUELLA_MAPA,
  };
  return { padre, web, version, contexto, limpiar: () => rmSync(padre, { recursive: true, force: true }) };
}

function registrarModulosDatos(directorio: string) {
  const datos = pathToFileURL(`${join(directorio, 'datos')}/`).href;
  return registerHooks({
    load(url, contexto, siguiente) {
      if (url.startsWith(datos) && url.endsWith('.json')) {
        const texto = readFileSync(new URL(url), 'utf8');
        return {
          format: 'module',
          source: `export default new TextEncoder().encode(${JSON.stringify(texto)}).buffer;`,
          shortCircuit: true,
        };
      }
      return siguiente(url, contexto);
    },
  });
}

async function comprobarServicios(pedir: (ruta: string) => Promise<Response>): Promise<void> {
  for (const ruta of ['/mcp', '/a2a', '/.well-known/agent-card.json', '/api/socios/v1/token']) {
    assert.equal((await pedir(ruta)).status, NO_ENCONTRADO, ruta);
  }
  const estado = await pedir('/api/conectividad/estado');
  assert.equal(estado.status, CORRECTO);
  const cuerpo = (await estado.json()) as { servicios: unknown };
  assert.deepEqual(cuerpo.servicios, { api: false, mcp: false, a2a: false });
}

function entornoCandidato(contador: { assets: number; durable: number }, clave: string) {
  return {
    ASSETS: {
      fetch: async () => {
        contador.assets++;
        return new Response('Candidata');
      },
    },
    REGISTRO_SOCIOS: {
      idFromName: () => 'id',
      get: () => ({
        fetch: async (peticion: Request) => {
          assert.equal(new URL(peticion.url).pathname, '/privado/intento');
          contador.durable++;
          return Response.json({ permitido: true });
        },
      }),
    },
    FARO_PRUEBAS_CLAVE: clave,
    FARO_PRUEBAS_LIMITE: 'limite-privado-sintetico-distinto-de-32-bytes',
    FARO_ADMINISTRACION: 'si',
    FARO_MCP: 'si',
    FARO_A2A: 'si',
    FARO_API_SOCIOS: 'si',
  };
}

async function comprobarWorker(directorio: string): Promise<void> {
  const hooks = registrarModulosDatos(directorio);
  try {
    const modulo = await import(pathToFileURL(join(directorio, 'worker.mjs')).href);
    assert.deepEqual(Object.keys(modulo).sort(), ['AccesoPublicoDurable', 'default']);
    assert.equal(typeof modulo.AccesoPublicoDurable, 'function');
    assert.equal(modulo.default.scheduled, undefined);
    const contador = { assets: 0, durable: 0 };
    const clave = 'clave-sintetica-para-este-ensayo';
    const autorizacion = `Basic ${Buffer.from(`Faro:${clave}`).toString('base64')}`;
    const env = entornoCandidato(contador, clave);
    const anonima = await modulo.default.fetch(new Request('https://faro.invalid/solo-candidata.txt'), env);
    assert.equal(asegurarDesafioSi401(anonima, 'Basic').status, NO_AUTORIZADO);
    assert.equal(contador.assets, 0, 'el acceso anónimo no llega a los recursos');
    const pedir = (ruta: string) =>
      modulo.default.fetch(
        new Request(`https://faro.invalid${ruta}`, {
          headers: { authorization: autorizacion, 'cf-connecting-ip': '127.0.0.1', 'x-faro-contrato': '8' },
        }),
        env,
      );
    const publica = await pedir('/solo-candidata.txt');
    assert.equal(publica.status, CORRECTO);
    assert.equal(await publica.text(), 'Candidata');
    assert.ok(publica.headers.get('content-security-policy')?.includes(HUELLA_MAPA));
    const privada = await pedir('/administracion/index.html');
    assert.equal(privada.status, NO_ENCONTRADO);
    assert.equal(contador.assets, 1, 'el panel no llega al binding estático sin administración habilitada');
    await comprobarServicios(pedir);
    assert.ok(contador.durable > 0);
  } finally {
    hooks.deregister();
  }
}

test('contexto explícito rechaza otro paquete y huellas mal formadas antes de leer la candidata', async () => {
  const inexistente = join(tmpdir(), 'no-leer-candidata');
  const contexto: WebConstruida = {
    web: inexistente,
    paquete: RUTAS.paquete,
    motor: new Map(),
    huellaMapaModulos: HUELLA_MAPA,
  };
  for (const huellaMapaModulos of ['', 'sha256-sin-comillas', "'sha384-incorrecta'", `${HUELLA_MAPA}\n`]) {
    await assert.rejects(comprobarConstruccionCloudflare({ ...contexto, huellaMapaModulos }), /huella CSP/);
  }
  await assert.rejects(comprobarConstruccionCloudflare({ ...contexto, paquete: RUTAS.web }), /paquete canónico/);
});

test('Worker candidato usa raíz y CSP finales, conserva exports y reserva administración', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => assert.fail('La prueba no admite red'));
  const f = candidata();
  const fuente = readFileSync(FUENTE_HUELLA);
  let temporal = '';
  try {
    await conConstruccionCloudflare(async (directorio, resultado, rutas) => {
      temporal = directorio;
      assert.ok(rutas.includes('solo-candidata.txt'));
      assert.ok(rutas.includes('administracion/index.html'));
      assert.ok(!rutas.includes('inicio.html'), 'no debe leer la web fuente');
      assert.ok(!rutas.includes('entrada-privada.txt') && !rutas.includes('README.md'));
      const tamanos = rutas.map((ruta) => readFileSync(join(f.web, ruta)).byteLength);
      assert.deepEqual(resultado.assets, {
        archivos: rutas.length,
        bytes: tamanos.reduce((suma, valor) => suma + valor, 0),
        mayorBytes: Math.max(...tamanos),
      });
      assert.deepEqual(readdirSync(directorio).sort(), ['cursos', 'datos', 'worker.mjs']);
      assert.deepEqual(readdirSync(join(directorio, 'cursos')).sort(), ['datos', 'worker.mjs']);
      const codigo = readFileSync(join(directorio, 'worker.mjs'), 'utf8');
      assert.ok(!codigo.includes('sourceMappingURL=') && !codigo.includes('// src/'));
      assert.ok(codigo.includes('HUELLA_DEL_MAPA_DE_MODULOS'), 'los identificadores conservan sus nombres');
      assert.ok(codigo.includes(IDENTIDAD_WEB['User-Agent']), 'el Worker integra la política pública central');
      assert.ok(!resultado.datos.some((dato) => dato.ruta.endsWith('identidad-web.json')));
      await comprobarWorker(directorio);
    }, f.contexto);
    assert.deepEqual(readFileSync(FUENTE_HUELLA), fuente);
    assert.ok(!existsSync(temporal));
  } finally {
    f.limpiar();
  }
});

test('contexto candidato no relaja el rechazo de raíces enlazadas', async () => {
  const f = candidata();
  try {
    const web = join(f.padre, 'enlace');
    symlinkSync(f.web, web);
    await assert.rejects(comprobarConstruccionCloudflare({ ...f.contexto, web }), /directorio regular/);
  } finally {
    f.limpiar();
  }
});

test('exportación usa motor recibido, copia candidata y sella sus manifiestos sin tocar fuente', async () => {
  const f = candidata();
  const fuente = readFileSync(FUENTE_HUELLA);
  try {
    const destino = join(f.padre, 'entrega');
    const resumen = await exportarArtefactoCloudflare(destino, REVISION, f.version, f.contexto);
    assert.deepEqual(comprobarArtefactoCloudflare(destino, resumen.sha256Artefacto), resumen);
    assert.equal(readFileSync(join(destino, 'web/solo-candidata.txt'), 'utf8'), 'Bytes exclusivos de la candidata');
    assert.deepEqual(readFileSync(join(destino, 'web/motor/entrada.js')), MOTOR);
    assert.deepEqual(
      readFileSync(join(destino, 'web/firmas/manifiesto.json')),
      readFileSync(join(f.web, 'firmas/manifiesto.json')),
    );
    assert.ok(!existsSync(join(destino, 'web/entrada-privada.txt')));
    assert.ok(!existsSync(join(destino, 'web/inicio.html')));
    const descriptor = JSON.parse(readFileSync(join(destino, 'artefacto.json'), 'utf8'));
    assert.equal(
      descriptor.sha256ManifiestoDispositivo,
      createHash('sha256')
        .update(readFileSync(join(f.web, 'firmas/manifiesto.json')))
        .digest('hex'),
    );
    assert.deepEqual(readFileSync(FUENTE_HUELLA), fuente);
  } finally {
    f.limpiar();
  }
});

test('exportación candidata conserva rechazo de motor distinto, paquete alternativo y destino dentro del producto', async () => {
  const f = candidata();
  try {
    const destino = join(f.padre, 'no-creado');
    await assert.rejects(
      exportarArtefactoCloudflare(destino, REVISION, f.version, {
        ...f.contexto,
        motor: new Map([['motor/entrada.js', Buffer.from('otro compilado')]]),
      }),
      /Artefacto desactualizado/,
    );
    await assert.rejects(
      exportarArtefactoCloudflare(destino, REVISION, f.version, {
        ...f.contexto,
        paquete: join(f.web, 'paquete', f.version),
      }),
    );
    await assert.rejects(
      exportarArtefactoCloudflare(join(RUTAS.raiz, 'entrega-no-admitida-104'), REVISION, f.version, f.contexto),
    );
    assert.ok(!existsSync(destino));
  } finally {
    f.limpiar();
  }
});

/** Las fuentes mínimas que la construcción lee de una raíz sintética. */
function escribirFuentesMinimas(escribirRaiz: (ruta: string, contenido: string) => void): void {
  escribirRaiz('motores/cursos/src/index.ts', 'export const motor = true;');
  escribirRaiz('src/plataforma/mapa-de-modulos.ts', 'export const HUELLA_DEL_MAPA_DE_MODULOS = "";');
  escribirRaiz('src/plataforma/cloudflare/protocolo-cursos.ts', 'export const HUELLA_DEL_PAQUETE = "";');
}

/** Grafo sintético con el constructor real; no modifica config ni entradas del producto. */
test('solo la política pública exacta puede entrar desde config y conserva límites y rechazo de enlaces', async () => {
  const f = candidata();
  const descriptorRaiz = Object.getOwnPropertyDescriptor(RUTAS, 'raiz');
  const descriptorWeb = Object.getOwnPropertyDescriptor(RUTAS, 'web');
  assert.ok(descriptorRaiz && descriptorWeb);
  const raiz = join(f.padre, 'Código Año ñ');
  const politica = 'config/identidad-web.json';
  const escribirRaiz = (ruta: string, contenido: string | Uint8Array): void => escribir(raiz, ruta, contenido);
  try {
    for (const nombre of ['wrangler.example.jsonc', 'wrangler.cursos.example.jsonc']) {
      escribirRaiz(`config/cloudflare/${nombre}`, readFileSync(join(RUTAS.raiz, 'config/cloudflare', nombre)));
    }
    for (const carpeta of ['src', 'motores/ocupaciones/src', 'motores/ocupaciones/modelos']) {
      mkdirSync(join(raiz, carpeta), { recursive: true });
    }
    escribirFuentesMinimas(escribirRaiz);
    Object.defineProperty(RUTAS, 'raiz', { ...descriptorRaiz, value: `${raiz}/` });
    Object.defineProperty(RUTAS, 'web', { ...descriptorWeb, value: `${join(raiz, 'web')}/` });
    const contenido = JSON.stringify({ datoSintetico: true });
    async function rechazar(ruta: string, mensaje: RegExp): Promise<void> {
      escribirRaiz(
        'src/plataforma/cloudflare/worker-privado.ts',
        `import dato from '../../../${ruta}' with { type: 'json' }; export default { dato }; ` +
          'export class AccesoPublicoDurable {}',
      );
      await assert.rejects(
        conConstruccionCloudflare(async () => assert.fail('JSON ajeno no debe producir una construcción'), f.contexto),
        mensaje,
      );
    }
    for (const ruta of ['config/otra.json', 'config/identidad-web-copia.json', 'config/otra/identidad-web.json']) {
      escribirRaiz(ruta, contenido);
      await rechazar(ruta, /JSON ajeno al paquete/);
    }
    escribirRaiz(politica, JSON.stringify({ relleno: 'x'.repeat(POLITICA_DEMASIADO_GRANDE) }));
    await rechazar(politica, /Tabla del código demasiado grande/);
    rmSync(join(raiz, politica));
    const externa = join(f.padre, 'politica-externa.json');
    writeFileSync(externa, contenido);
    symlinkSync(externa, join(raiz, politica));
    await rechazar(politica, /JSON ajeno al paquete/);
  } finally {
    Object.defineProperty(RUTAS, 'raiz', descriptorRaiz);
    Object.defineProperty(RUTAS, 'web', descriptorWeb);
    f.limpiar();
  }
});
