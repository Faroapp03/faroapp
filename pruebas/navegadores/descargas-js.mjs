// Ensayo: cuántos JavaScript descarga cada escenario en una primera visita con perfil limpio. Se cuentan en el servidor
// (fixture.ts) todas las peticiones GET de la página, de sus Workers y del service worker cuyo destino es un script, un
// Worker o un service worker, o cuya ruta acaba en .js o .mjs, hasta que se cumplen las dos condiciones: el hito del
// escenario y el service worker activado (en las páginas que lo registran). Se informan dos cifras: direcciones
// distintas y peticiones totales (una dirección que piden la página y la precarga cuenta dos veces en la segunda).
// Aparte, cuántas de esas peticiones son repeticiones de autenticación, con la regla del presupuesto
// (presupuesto-cifras.mjs): siguen contando en las dos cifras.
// En Chromium se contrasta con las peticiones que ve el propio contexto. Cada escenario falla si alguna cifra supera
// su presupuesto (presupuesto-descargas.mjs). Los dos criterios de JavaScript, el del servidor y el del contexto, son
// los del presupuesto de rendimiento (presupuesto-criterios.mjs).
// La construcción se sirve con su Worker en modo privado (Basic sintético). La portada y el acceso los genera el Worker
// oficial, con sus bytes y sus cabeceras (CSP incluida) y el mismo servidor que el presupuesto (presupuesto-servidor.mjs):
// con una construcción de destino oficial (y --worker-privado), su propio worker/worker.mjs, comprobado
// (servidorOficialDe); con una privada, que no lo lleva, el de las fuentes (worker-oficial.ts), y el JSON lo dice.
//
//   node pruebas/navegadores/descargas-js.mjs --artefacto minima=<dist> [--artefacto …] [--motor chromium …] \
//     [--salida <carpeta>]
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import * as workerDeLasFuentes from '../../src/plataforma/cloudflare/worker-oficial.ts';
import { autenticarEnChromium, contextoConCache, credencialesDelContexto } from './cache-fiel.mjs';
import { ASSETS_DE_LA_WEB, crearFixture } from './fixture.ts';
import {
  argumentos,
  arrancar,
  esperarServiceWorkerActivado,
  OPCIONES_DE_CONTEXTO,
  preferenciasDelRecorrido,
  primerMensaje,
  servible,
} from './paquete-comun.mjs';
import { repeticionesDeAutenticacion } from './presupuesto-cifras.mjs';
import { esJavaScriptDelContexto, esJavaScriptDelServidor } from './presupuesto-criterios.mjs';
import { comprobarPresupuesto, presupuestoDe } from './presupuesto-descargas.mjs';
import { crearServidorOficial, servidorOficialDe } from './presupuesto-servidor.mjs';

/** Tras el hito, lo que se espera a que una página sin service worker pudiera registrarlo. */
const ESPERA_SIN_SERVICE_WORKER_MS = 1500;

/** El idioma de la página ya aplicado: su diccionario se ha cargado. */
async function idiomaAplicado(pagina) {
  await pagina.waitForFunction(() => document.documentElement.lang === 'es' && document.readyState === 'complete');
}

const ESCENARIOS = [
  { nombre: 'portada', ruta: '/', oficial: true, serviceWorker: false, hito: (p) => p.locator('.acceso a').waitFor() },
  {
    nombre: 'acceso',
    ruta: '/acceso-web',
    oficial: true,
    serviceWorker: false,
    hito: (p) => p.locator('h1').waitFor(),
  },
  { nombre: 'inicio', ruta: '/inicio.html', serviceWorker: true, hito: idiomaAplicado },
  { nombre: 'recorrido real', ruta: '/recorrido.html', serviceWorker: true, hito: (p) => primerMensaje(p) },
  {
    nombre: 'informe',
    ruta: '/informe-ejemplo.html',
    serviceWorker: true,
    hito: (p) => p.locator('#contenido').first().waitFor({ state: 'visible' }),
  },
];

/** El presupuesto de cada escenario, comprobado antes de arrancar ningún navegador: si falta uno, la prueba falla aquí. */
const PRESUPUESTO = Object.fromEntries(ESCENARIOS.map(({ nombre }) => [nombre, presupuestoDe(nombre)]));

/** Las dos cifras de una lista de rutas pedidas. */
const cifras = (rutas) => ({ direcciones: new Set(rutas).size, peticiones: rutas.length });

/**
 * El contexto del escenario, con perfil limpio y la caché HTTP del navegador como contra el dominio real
 * (cache-fiel.mjs): lo que la página ya ha descargado y el service worker vuelve a pedir puede salir de ella. En
 * Chromium anota además las peticiones de JavaScript que ve el propio contexto.
 */
async function contextoContado(sesion, motor, origen) {
  const contexto = await contextoConCache(sesion, motor, {
    ...OPCIONES_DE_CONTEXTO,
    ...credencialesDelContexto(motor, origen),
  });
  await contexto.addInitScript(preferenciasDelRecorrido);
  const vistas = motor === 'chromium' ? [] : null;
  contexto.on('request', (peticion) => {
    const ruta = new URL(peticion.url()).pathname;
    const tipo = peticion.resourceType();
    if (vistas && peticion.method() === 'GET' && esJavaScriptDelContexto({ ruta, tipo })) {
      vistas.push({ ruta, tipo, desde: peticion.serviceWorker() ? 'service worker' : 'página o Worker' });
    }
  });
  return { contexto, vistas };
}

/** Las dos condiciones: el hito del escenario y, si la página lo registra, el service worker activado. */
async function hitoYServiceWorker(pagina, escenario) {
  await escenario.hito(pagina);
  if (escenario.serviceWorker) {
    return esperarServiceWorkerActivado(pagina);
  }
  await pagina.waitForTimeout(ESPERA_SIN_SERVICE_WORKER_MS);
  assert.equal(await pagina.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length), 0);
  return 'sin registro';
}

/** El servidor de la portada y el acceso: el Worker oficial de la construcción o, si es privada, el de las fuentes. */
function servidorOficial(construccion) {
  return construccion.oficial
    ? servidorOficialDe(construccion)
    : crearServidorOficial({ worker: workerDeLasFuentes, assets: ASSETS_DE_LA_WEB });
}

async function medir({ sesion, motor, construccion, escenario }) {
  const fixture = escenario.oficial
    ? await servidorOficial(construccion)
    : await crearFixture(construccion.artefacto, { modoRecorrido: escenario.modoRecorrido });
  const { contexto, vistas } = await contextoContado(sesion, motor, fixture.origen);
  try {
    const pagina = await contexto.newPage();
    await autenticarEnChromium(contexto, pagina, { motor, origen: fixture.origen });
    const respuesta = await pagina.goto(`${fixture.origen}${escenario.ruta}`);
    assert.equal(respuesta?.status(), ESTADO_HTTP.correcto, `${escenario.ruta} responde`);
    const serviceWorker = await hitoYServiceWorker(pagina, escenario);
    // Las dos condiciones se han cumplido: aquí termina el recuento.
    const deJavaScript = fixture.peticiones.filter((p) => p.metodo === 'GET' && esJavaScriptDelServidor(p));
    const servidor = deJavaScript.map((p) => ({ ruta: p.ruta, destino: p.destino ?? null }));
    const contraste = vistas ? [...vistas] : null;
    assert.deepEqual(fixture.errores, [], 'El servidor de pruebas no ha fallado');
    return {
      hito: true,
      serviceWorker,
      ...cifras(servidor.map((p) => p.ruta)),
      repeticionesDeAutenticacion: repeticionesDeAutenticacion(deJavaScript),
      urls: servidor,
      contraste: contraste
        ? { ...cifras(contraste.map((p) => p.ruta)), urls: contraste }
        : 'el contexto no ve las peticiones del service worker en este motor',
    };
  } finally {
    await contexto.close();
    await fixture.cerrar();
  }
}

const opciones = argumentos({ 'worker-privado': { type: 'string' } });
const registro = {};
const salida = opciones.salida;
if (salida) {
  mkdirSync(salida, { recursive: true });
}
after(() => {
  for (const [nombre, porMotor] of Object.entries(registro)) {
    const texto = `${JSON.stringify({ presupuesto: PRESUPUESTO, ...porMotor }, null, 1)}\n`;
    if (salida) {
      writeFileSync(join(salida, `descargas-${nombre}.json`), texto);
    }
  }
});

for (const { nombre, carpeta } of opciones.artefactos) {
  const construccion = await servible(carpeta, opciones['worker-privado']);
  const { oficial } = construccion;
  registro[nombre] = {
    artefacto: carpeta,
    servidor: construccion.servidor,
    portadaYAcceso: oficial
      ? {
          destino: 'oficial',
          worker: { ruta: oficial.ruta, sha256: oficial.sha256 },
          artefacto: oficial.sha256Artefacto,
        }
      : { destino: 'oficial', worker: 'el de las fuentes (worker-oficial.ts): la construcción es privada' },
  };
  for (const motor of opciones.motores) {
    test(`descargas JS de ${nombre} en ${motor}: dentro del presupuesto de cada escenario`, async (t) => {
      const sesion = await arrancar(motor);
      registro[nombre][motor] = {};
      try {
        for (const escenario of ESCENARIOS) {
          await t.test(escenario.nombre, async () => {
            let medida;
            try {
              medida = await medir({ sesion, motor, construccion, escenario });
            } catch (error) {
              registro[nombre][motor][escenario.nombre] = { hito: false, error: String(error).split('\n')[0] };
              throw error;
            }
            registro[nombre][motor][escenario.nombre] = medida;
            const { dentro, motivo } = comprobarPresupuesto(escenario.nombre, medida);
            assert.ok(dentro, `${nombre} · ${motor} · ${escenario.nombre}: ${motivo}`);
          });
        }
      } finally {
        await sesion.cerrar();
      }
    });
  }
}
