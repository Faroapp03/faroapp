// Ensayo: la actualización del service worker de una construcción publicada a otra, en un navegador con perfil
// persistente. El mismo origen (fixture.ts) sirve primero la construcción anterior y después la nueva. Con la anterior
// activa se guardan una marca de sesión (sessionStorage), una de preferencias (localStorage) y un registro en
// IndexedDB; se cambia de construcción, la página pide `registration.update()` y, si la versión nueva queda en espera,
// le envía el mensaje de activación del service worker. Después deben seguir las tres marcas, la página debe estar
// controlada por la versión nueva y la copia de la versión anterior debe haber desaparecido de CacheStorage.
//
//   node pruebas/navegadores/actualizacion-sw.mjs --anterior <dist> --artefacto <dist> [--motor chromium …] \
//     [--salida <carpeta>]
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { versionDelServicio } from '../../web/scripts/version-del-servicio.js';
import { crearFixture } from './fixture.ts';
import {
  abrirPerfil,
  argumentos,
  construccionEnsayada,
  esperarServiceWorkerActivado,
  PLAZO_MS,
  servible,
} from './paquete-comun.mjs';

const MARCA = 'marca-sintetica-de-la-actualizacion';
const BASE_DE_DATOS = 'faro-ensayo-actualizacion';
/** El tipo del mensaje con el que una página activa la versión en espera (ACTIVAR_VERSION_NUEVA). */
const ACTIVAR = 'ACTIVATE_UPDATE';

/** La VERSION que declara el service worker de una construcción. */
function versionDe(carpeta) {
  const fuente = readFileSync(join(carpeta, 'web/service-worker.js'), 'utf8');
  const version = versionDelServicio(fuente);
  assert.ok(version, 'service-worker.js declara su VERSION');
  return version;
}

/**
 * Una construcción que se puede cambiar por otra sin cambiar de servidor ni de almacén durable. Con el cambio, el
 * fixture atiende con el Worker y con el objeto durable de la construcción nueva sobre el mismo almacén
 * (durableDeLaConstruccion), como queda tras un despliegue real: un objeto anterior rechaza, a propósito, el protocolo
 * de un Worker más nuevo, y la privada respondería 503 a todo. Este ensayo mira lo que el navegador conserva; las
 * versiones mezcladas las cubren su prueba (acceso-publico/acceso-privado-limite.test.ts) y el orden de despliegue de
 * docs/despliegue.md (Actualizar una instalación activa).
 */
function conmutable(inicial) {
  let actual = inicial;
  return {
    cambiar: (otra) => {
      actual = otra;
    },
    get worker() {
      return actual.worker;
    },
    get fichas() {
      return actual.fichas;
    },
    get resumen() {
      return actual.resumen;
    },
    get directorio() {
      return actual.directorio;
    },
    leer: (ruta) => actual.leer(ruta),
  };
}

/** Lo que hay guardado en el navegador para esta web (aunque la página se esté recargando: aunqueSeRecargue). */
function estadoGuardado(pagina) {
  return aunqueSeRecargue(
    pagina,
    async ({ marca, base }) => {
      const abrir = () =>
        new Promise((ok, fallo) => {
          const peticion = indexedDB.open(base, 1);
          peticion.onupgradeneeded = () => peticion.result.createObjectStore('marcas');
          peticion.onsuccess = () => ok(peticion.result);
          peticion.onerror = () => fallo(peticion.error);
        });
      const bd = await abrir();
      const enIdb = await new Promise((ok, fallo) => {
        const lectura = bd.transaction('marcas').objectStore('marcas').get('marca');
        lectura.onsuccess = () => ok(lectura.result ?? null);
        lectura.onerror = () => fallo(lectura.error);
      });
      bd.close();
      const registro = await navigator.serviceWorker.getRegistration();
      return {
        sesion: sessionStorage.getItem('faro-ensayo') === marca,
        preferencias: localStorage.getItem('faro-ensayo') === marca,
        indexedDb: enIdb === marca,
        clavesLocalStorage: Object.keys(localStorage).sort(),
        copias: (await caches.keys()).sort(),
        controlador: navigator.serviceWorker.controller?.scriptURL ?? null,
        activo: registro?.active?.state ?? null,
        enEspera: Boolean(registro?.waiting),
      };
    },
    { marca: MARCA, base: BASE_DE_DATOS },
  );
}

function guardarMarcas(pagina) {
  return pagina.evaluate(
    async ({ marca, base }) => {
      sessionStorage.setItem('faro-ensayo', marca);
      localStorage.setItem('faro-ensayo', marca);
      await new Promise((ok, fallo) => {
        const peticion = indexedDB.open(base, 1);
        peticion.onupgradeneeded = () => peticion.result.createObjectStore('marcas');
        peticion.onerror = () => fallo(peticion.error);
        peticion.onsuccess = () => {
          const escritura = peticion.result.transaction('marcas', 'readwrite');
          escritura.objectStore('marcas').put(marca, 'marca');
          escritura.oncomplete = () => {
            peticion.result.close();
            ok();
          };
          escritura.onerror = () => fallo(escritura.error);
        };
      });
    },
    { marca: MARCA, base: BASE_DE_DATOS },
  );
}

/**
 * Con la construcción anterior: primera visita hasta su service worker activo y las tres marcas guardadas. El perfil
 * no se cierra entre las dos construcciones: con la puerta Basic del fixture, un navegador recién abierto no tiene la
 * credencial que el service worker necesita para pedir la página en su nombre.
 */
async function visitaAnterior(motor, carpeta, origen) {
  const contexto = await abrirPerfil(motor, carpeta, origen);
  try {
    const pagina = contexto.pages()[0] ?? (await contexto.newPage());
    assert.equal((await pagina.goto(`${origen}/inicio.html`))?.status(), ESTADO_HTTP.correcto);
    await esperarServiceWorkerActivado(pagina);
    await pagina.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: PLAZO_MS });
    await guardarMarcas(pagina);
    return { contexto, pagina };
  } catch (error) {
    await contexto.close();
    throw error;
  }
}

/** Lo que dice Playwright cuando una evaluación coincide con una navegación de la página. */
const POR_UNA_NAVEGACION = /Execution context was destroyed|navigation/u;
/** Lo que dice Firefox cuando otra navegación de la página interrumpe la recarga que ha pedido el ensayo. */
const RECARGA_INTERRUMPIDA = /NS_BINDING_ABORTED/u;
/**
 * Cada cuánto se vuelve a mirar el estado mientras se cambia de versión: sin prisa, para no tener ocupado al service
 * worker activo con peticiones mientras la versión nueva espera a activarse (Chromium no la activa con eventos en
 * curso).
 */
const CADA_MS = 1000;

/**
 * `funcion` evaluada en la página; si coincide con una recarga, se repite cuando la página vuelve a estar cargada.
 * Una página sin nada que perder se recarga sola cuando la versión nueva toma el control (scripts/instalacion.js,
 * seguirAlControl): es lo esperado, no un fallo.
 */
async function aunqueSeRecargue(pagina, funcion, argumento) {
  for (let intento = 0; ; intento += 1) {
    try {
      return await pagina.evaluate(funcion, argumento);
    } catch (error) {
      if (!POR_UNA_NAVEGACION.test(String(error)) || intento * CADA_MS > PLAZO_MS) {
        throw error;
      }
      await pagina.waitForLoadState('load');
    }
  }
}

/**
 * La página pide la versión nueva y, si queda en espera, la activa con su mensaje (si no, la activa la propia página,
 * scripts/instalacion.js); se espera a que la nueva controle la página, sin otra versión instalándose ni en espera, a
 * que responda su sonda con la VERSION nueva y a que la copia vieja se haya borrado. La página puede recargarse por el
 * camino. Que la versión nueva está activada lo dice su sonda (motor/copia-comprobada.json, que solo responde un
 * service worker activado: los fetch esperan a que termine la activación) y no `active.state`: en WebKit, la página que
 * se recarga mientras la versión nueva se activa se queda con un objeto ServiceWorker en «activating» aunque la
 * activación haya terminado (lo ve «activated» cualquier página que se abra o se recargue después). Al acabar se
 * recarga la página, como la siguiente visita (siguienteVisita), y se lee el estado ya sin ese objeto (estadoGuardado:
 * `activo`). Devuelve si esa recarga se interrumpió por la de la propia página.
 */
async function cambiarDeVersion(pagina, copiaVieja, versionNueva) {
  await pagina.evaluate(async () => {
    await (await navigator.serviceWorker.getRegistration()).update();
  });
  const limite = Date.now() + PLAZO_MS;
  for (;;) {
    const visto = await aunqueSeRecargue(
      pagina,
      async ({ vieja, tipo }) => {
        const registro = await navigator.serviceWorker.getRegistration();
        registro?.waiting?.postMessage({ type: tipo });
        return {
          controlada: navigator.serviceWorker.controller !== null,
          activo: registro?.active?.state ?? null,
          instalando: registro?.installing?.state ?? null,
          enEspera: registro?.waiting?.state ?? null,
          copiaVieja: (await caches.keys()).includes(vieja),
          // La sonda solo cuando ya no hay versión instalándose ni en espera: antes, la atendería la anterior.
          sonda:
            registro?.installing || registro?.waiting
              ? null
              : await fetch('motor/copia-comprobada.json', { cache: 'no-store' })
                  .then((respuesta) => respuesta.json())
                  .then(({ version }) => version, String),
        };
      },
      { vieja: copiaVieja, tipo: ACTIVAR },
    );
    const { controlada, instalando, enEspera, copiaVieja: queda, sonda } = visto;
    if (controlada && sonda === versionNueva && !instalando && !enEspera && !queda) {
      break;
    }
    assert.ok(
      Date.now() < limite,
      `La versión nueva no ha tomado el control en ${PLAZO_MS} ms: ${JSON.stringify(visto)}`,
    );
    await pagina.waitForTimeout(CADA_MS);
  }
  return siguienteVisita(pagina);
}

/**
 * La siguiente visita: si la toma de control ha disparado la recarga, se espera a que acabe, y se recarga. La página aún
 * puede recargarse sola justo entonces (seguirAlControl), y Firefox aborta la recarga del ensayo: la suya ya es la
 * siguiente visita, y se espera a que haya otro documento, ya cargado. Devuelve si pasó.
 */
async function siguienteVisita(pagina) {
  await pagina.waitForLoadState('load');
  await aunqueSeRecargue(pagina, () => {
    globalThis.__faroAntesDeLaRecarga = true;
  });
  return pagina.reload().then(
    () => false,
    async (error) => {
      if (!RECARGA_INTERRUMPIDA.test(String(error))) {
        throw error;
      }
      await esperarOtroDocumento(pagina);
      return true;
    },
  );
}

/** Espera a que la página sea otro documento (sin la marca que se le puso antes de recargar) y haya cargado. */
async function esperarOtroDocumento(pagina) {
  const limite = Date.now() + PLAZO_MS;
  while (await aunqueSeRecargue(pagina, () => globalThis.__faroAntesDeLaRecarga === true)) {
    assert.ok(Date.now() < limite, 'La página no ha llegado a recargarse');
    await pagina.waitForTimeout(CADA_MS);
  }
  await pagina.waitForLoadState('load');
}

async function actualizar({ motor, anterior, nueva }) {
  const temporal = mkdtempSync(join(realpathSync(tmpdir()), `faro-actualizacion-${motor}-`));
  mkdirSync(join(temporal, 'app'));
  mkdirSync(join(temporal, 'cache'));
  const servida = conmutable(anterior.artefacto);
  const fixture = await crearFixture(servida);
  try {
    const { contexto, pagina } = await visitaAnterior(motor, temporal, fixture.origen);
    try {
      const antes = await estadoGuardado(pagina);
      const copiaVieja = antes.copias.find((c) => c.includes(`:${anterior.version}`));
      servida.cambiar(nueva.artefacto);
      const recargaInterrumpida = await cambiarDeVersion(pagina, copiaVieja, nueva.version);
      const despues = await estadoGuardado(pagina);
      const servido = await aunqueSeRecargue(pagina, async () => (await fetch('service-worker.js')).text());
      const versionServida = versionDelServicio(servido);
      return { antes, despues, copiaVieja, versionNueva: nueva.version, versionServida, recargaInterrumpida };
    } finally {
      await contexto.close();
    }
  } finally {
    await fixture.cerrar();
    rmSync(temporal, { recursive: true, force: true });
  }
}

const opciones = argumentos({ anterior: { type: 'string' }, 'worker-privado': { type: 'string' } });
assert.ok(opciones.anterior, 'Falta --anterior <dist>');
const registro = {};
after(() => {
  if (opciones.salida) {
    mkdirSync(opciones.salida, { recursive: true });
    writeFileSync(join(opciones.salida, 'actualizacion-sw.json'), `${JSON.stringify(registro, null, 1)}\n`);
  }
});

const carpetaAnterior = resolve(opciones.anterior);
registro.construcciones = { anterior: construccionEnsayada(carpetaAnterior) };
const anterior = {
  artefacto: (await servible(carpetaAnterior, opciones['worker-privado'])).artefacto,
  version: versionDe(carpetaAnterior),
};
for (const { nombre, carpeta } of opciones.artefactos) {
  registro.construcciones[nombre] = construccionEnsayada(carpeta);
  const nueva = {
    artefacto: (await servible(carpeta, opciones['worker-privado'])).artefacto,
    version: versionDe(carpeta),
  };
  for (const motor of opciones.motores) {
    const conserva = 'conserva sesión, preferencias e IndexedDB';
    const titulo = `actualización del service worker a ${nombre} en ${motor}: ${conserva}`;
    test(titulo, async () => {
      let r;
      try {
        r = await actualizar({ motor, anterior, nueva });
      } catch (error) {
        registro[`${nombre} · ${motor}`] = { fallo: String(error).split('\n')[0] };
        throw error;
      }
      registro[`${nombre} · ${motor}`] = r;
      // Cuántas pasadas entraron en la recarga interrumpida (cambiarDeVersion), para el registro.
      registro.recargasInterrumpidas = (registro.recargasInterrumpidas ?? 0) + (r.recargaInterrumpida ? 1 : 0);
      assert.ok(r.copiaVieja, 'La versión anterior tenía su copia');
      assert.deepEqual([r.antes.sesion, r.antes.preferencias, r.antes.indexedDb], [true, true, true]);
      assert.deepEqual([r.despues.sesion, r.despues.preferencias, r.despues.indexedDb], [true, true, true]);
      assert.deepEqual(
        r.antes.clavesLocalStorage.filter((clave) => !r.despues.clavesLocalStorage.includes(clave)),
        [],
        'Las preferencias siguen todas',
      );
      assert.equal(r.versionServida, nueva.version);
      assert.ok(!r.despues.copias.includes(r.copiaVieja), 'La copia de la versión anterior ha desaparecido');
      assert.ok(
        r.despues.copias.some((c) => c.includes(`:${nueva.version}`)),
        'Está la copia de la versión nueva',
      );
      assert.equal(r.despues.activo, 'activated');
    });
  }
}
