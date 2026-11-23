import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { conConstruccionCloudflare } from '../../herramientas/cloudflare/comprobar-construccion.ts';
import { EXTENSIONES } from '../../src/plataforma/extensiones.ts';
import { contextoConstruido } from '../ayudas/web-construida.ts';

const PLAZO = 5000;
// El Worker del motor (worker.ts) se importa de forma estática: se evalúa al arrancar el aislado. Con import() diferido,
// esbuild lo envuelve en un inicializador que se marca como hecho antes de evaluar; si el aislado se corta a mitad, las
// peticiones siguientes de ese aislado encuentran el módulo sin «default» y fallan con un TypeError.

// La contrapartida: el motor y la portada comparten la evaluación del módulo. Un error en el nivel superior de worker.ts
// deja sin manejador todo el Worker, portada incluida. Por eso estas pruebas arrancan el Worker construido y sirven «/»:
// un error así las hace fallar. Forman parte de npm run verificar (desplegar.ts no lo ejecuta por sí mismo).

const PLAZO_CONSTRUCCION = 120_000;
const PLAZO_ARRANQUE = 30_000;
const MARCA_DEL_MOTOR = 'var apiActiva=null;';

/** Importa en un proceso aparte el Worker construido, con los datos como bytes, y pide «/». */
function arrancarYPedirLaPortada(worker: string) {
  const codigo = `
    import { registerHooks } from 'node:module';
    import { fileURLToPath, pathToFileURL } from 'node:url';
    const esDato = (url) => /\\/datos\\/[^/]+\\.json$/.test(url);
    registerHooks({
      resolve(especificador, contexto, siguiente) {
        const resuelto = siguiente(especificador, contexto);
        return esDato(resuelto.url) ? { ...resuelto, importAttributes: {}, format: 'module' } : resuelto;
      },
      load(url, contexto, siguiente) {
        if (!esDato(url)) return siguiente(url, contexto);
        const ruta = JSON.stringify(fileURLToPath(url));
        const fuente = 'const b = (await import("node:fs")).readFileSync(' + ruta + ');'
          + 'export default b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);';
        return { format: 'module', source: fuente, shortCircuit: true };
      },
    });
    const { default: worker } = await import(pathToFileURL(${JSON.stringify(worker)}).href);
    const respuesta = await worker.fetch(new Request('https://faroapp.org/'), { ASSETS: { fetch: async () => new Response('') } });
    await respuesta.text();
    console.log(respuesta.status);
  `;
  return spawnSync(process.execPath, ['--input-type=module', '-e', codigo], {
    encoding: 'utf8',
    timeout: PLAZO_ARRANQUE,
  });
}

test('el Worker oficial construido evalúa el motor al arrancar y sirve la portada', {
  timeout: PLAZO_CONSTRUCCION,
}, async () => {
  await conConstruccionCloudflare(
    async (directorio) => {
      const archivo = join(directorio, 'worker.mjs');
      const codigo = readFileSync(archivo, 'utf8');
      assert.deepEqual(codigo.match(/__esm\(/g) ?? [], [], 'ningún módulo llega con inicialización diferida');
      assert.deepEqual(codigo.match(/\bimport\(/g) ?? [], [], 'ningún módulo se importa dentro de una petición');
      const sano = arrancarYPedirLaPortada(archivo);
      assert.equal(sano.status, 0, sano.stderr || sano.error?.message || 'El Worker construido no arrancó');
      assert.equal(sano.stdout.trim(), '200');

      assert.equal(codigo.split(MARCA_DEL_MOTOR).length, 2, 'el motor está una vez en el Worker construido');
      const roto = join(directorio, 'worker-con-motor-roto.mjs');
      writeFileSync(
        roto,
        codigo.replace(MARCA_DEL_MOTOR, `${MARCA_DEL_MOTOR}throw new Error('motor roto al arrancar');\n`),
      );
      const caido = arrancarYPedirLaPortada(roto);
      assert.notEqual(caido.status, 0, 'un error al evaluar el motor deja sin portada todo el Worker');
      assert.match(caido.stderr, /motor roto al arrancar/);
    },
    contextoConstruido(),
    'oficial',
  );
});

test('modo y desafío no llaman al motor; la primera petición real y el evento programado sí lo delegan', () => {
  // Con una extensión instalada, su modo deja inactivo el real y su desafío se comprueba; sin extensiones solo hay
  // recorrido real, activo, y no hay desafío que pedir.
  const [extension] = EXTENSIONES;
  const modoGuardado = JSON.stringify(extension?.id ?? 'real');
  const conDesafio = extension !== undefined;
  const codigo = `
    import { registerHooks } from 'node:module';
    globalThis.__llamadas = 0;
    const simulado = 'data:text/javascript,export default {fetch:async()=>{globalThis.__llamadas++;return new Response("motor real")},scheduled:async()=>{globalThis.__evento=true}}';
    registerHooks({resolve(specifier, context, next) {
      if (specifier === './worker.ts') return {url:simulado, shortCircuit:true};
      return next(specifier, context);
    }});
    const {responderUnificado} = await import('./src/plataforma/cloudflare/worker-unificado.ts');
    const {default: oficial} = await import('./src/plataforma/cloudflare/worker-oficial.ts');
    const guardado = {recorrido:{version:1,revision:0,modo:${modoGuardado}}};
    const espacio = {idFromName:()=> 'id', get:()=>({fetch:async()=>Response.json(guardado)})};
    const env = {ASSETS:{fetch:async()=>new Response('')},REGISTRO_SOCIOS:espacio};
    const modo = await responderUnificado(new Request('https://ejemplo.invalid/modo-recorrido.json'), env);
    if (modo.status!==200 || globalThis.__llamadas!==0) throw new Error('modo llamó al motor');
    if (${conDesafio}) {
      const reto = await responderUnificado(new Request('https://ejemplo.invalid/recorrido.html'), env);
      if (reto.status!==503 || globalThis.__llamadas!==0) throw new Error('reto llamó al motor');
    }
    const recurso = await responderUnificado(new Request('https://ejemplo.invalid/inicio.html'), env);
    if (await recurso.text()!=='motor real' || globalThis.__llamadas!==1) throw new Error('primera petición no delegada');
    await oficial.scheduled({cron:'',scheduledTime:0},env);
    if (!globalThis.__evento) throw new Error('evento no delegado');
  `;
  const resultado = spawnSync(process.execPath, ['--input-type=module', '-e', codigo], {
    encoding: 'utf8',
    timeout: PLAZO,
  });
  assert.equal(
    resultado.status,
    0,
    resultado.stderr || resultado.error?.message || 'El proceso no terminó correctamente',
  );
});

test('la clase Durable sigue siendo la misma exportación pública de la autoridad', async () => {
  const { AccesoPublicoDurable: original } = await import('../../src/plataforma/acceso-publico/durable.ts');
  const { AccesoPublicoDurable: oficial } = await import('../../src/plataforma/cloudflare/worker-oficial.ts');
  assert.equal(oficial, original);
});
