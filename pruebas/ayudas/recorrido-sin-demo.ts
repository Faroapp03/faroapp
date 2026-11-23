// Se ejecuta en un proceso aislado: sustituye el registro de extensiones instaladas por uno vacío antes de importar
// cualquier módulo del producto, como queda la instalación tras retirar la demo.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { escribirSinAlarma } from './alarma-durable.ts';
import { motorPanel, OPCIONES_PANEL, POLITICA_PANEL } from './persistencia-panel.ts';
import { principalDePrueba } from './principal-panel.ts';

const INSTALADAS = new URL('../../src/plataforma/extensiones-instaladas.ts', import.meta.url).href;
const VACIAS = new URL('./extensiones-vacias.ts', import.meta.url).href;
let sustituciones = 0;
registerHooks({
  resolve(especificador, contexto, siguiente) {
    const resuelto = siguiente(especificador, contexto);
    if (resuelto.url !== INSTALADAS) {
      return resuelto;
    }
    sustituciones += 1;
    return { ...resuelto, url: VACIAS };
  },
});
const { EXTENSIONES } = await import('../../src/plataforma/extensiones.ts');
const { varianteDeRuta } = await import('../../src/plataforma/cloudflare/entrada-recorrido.ts');
const { varianteInstalada } = await import('../../src/plataforma/variantes-recorrido.ts');
const { responderModoRecorrido } = await import('../../src/plataforma/cloudflare/modo-publico.ts');
const { responderAccesoRecorrido } = await import('../../src/plataforma/cloudflare/acceso-recorrido.ts');
const { responderUnificado } = await import('../../src/plataforma/cloudflare/worker-unificado.ts');
const { crearRouterAdministrativo } = await import('../../src/administracion/http.ts');
const { AlmacenPublicoSqlite } = await import('../../src/plataforma/acceso-publico/sqlite.ts');
const { AlmacenSesionRecorridoSqlite } = await import('../../src/plataforma/acceso-publico/sesion-recorrido-sqlite.ts');

assert.ok(sustituciones > 0, 'el registro instalado debe sustituirse por el vacío');
assert.deepEqual(EXTENSIONES, []);
// Sin la extensión, sus rutas dejan de ser una variante: son recursos corrientes, ausentes con su carpeta.
assert.equal(varianteDeRuta('/demo/recorrido.html'), null);
assert.equal(varianteDeRuta('/recorrido.html'), 'real');
assert.equal(varianteDeRuta('/demo/panel/index.html'), null);
assert.equal(varianteInstalada('real'), true);
assert.equal(varianteInstalada('demo'), false);
const RUTAS_RETIRADAS = [
  '/demo',
  '/demo/recorrido.html',
  '/demo/scripts',
  '/demo/scripts/paquete/chunk.js',
  '/demo/respuestas',
  '/demo/estilos',
];
let accesosAssets = 0;
for (const ruta of RUTAS_RETIRADAS) {
  const respuesta = await responderUnificado(new Request(`https://ejemplo.invalid${ruta}`), {
    ASSETS: {
      fetch: async () => {
        accesosAssets += 1;
        return new Response(null, { status: ESTADO_HTTP.noEncontrado });
      },
    },
  });
  assert.equal(respuesta.status, ESTADO_HTTP.noEncontrado, ruta);
}
assert.equal(accesosAssets, RUTAS_RETIRADAS.length);
const db = new DatabaseSync(':memory:');
try {
  const sql = motorPanel(db);
  new AlmacenPublicoSqlite(sql, OPCIONES_PANEL);
  const almacen = new AlmacenSesionRecorridoSqlite(sql, { ahora: OPCIONES_PANEL.ahora, cubrir: escribirSinAlarma });
  await almacen.prepararPanel(POLITICA_PANEL);
  db.exec("UPDATE administracion_recorrido SET modo='demo', revision=7 WHERE id=1");
  const espacio = {
    idFromName: () => 'ficticio',
    get: () => ({ fetch: async () => Response.json({ recorrido: await almacen.leerRecorrido() }) }),
  };
  const peticionPublica = new Request('https://ejemplo.invalid/modo-recorrido.json');
  assert.equal((await responderModoRecorrido(peticionPublica, espacio)).status, ESTADO_HTTP.noDisponible);
  const directa = await responderAccesoRecorrido(new Request('https://ejemplo.invalid/recorrido.html'), {
    variante: 'real',
    clave: 'clave-sintetica',
    firma: 'firma-sintetica-independiente-de-32-bytes',
    leerModo: () => almacen.leerRecorrido(),
    consumirIntento: async () => true,
    delegar: async () => new Response('inaccesible'),
  });
  assert.equal(directa.status, ESTADO_HTTP.noDisponible);
  const origen = 'https://panel.example';
  const router = crearRouterAdministrativo({
    origen,
    almacen,
    recorrido: almacen,
    guardiaAdministrativa: async () =>
      principalDePrueba('https://fixture.cloudflareaccess.com', 'administrador-ficticio'),
  });
  const pedir = (ruta: string, token: string, cuerpo: object) =>
    router(
      new Request(`${origen}/administracion/api/${ruta}`, {
        method: 'POST',
        body: JSON.stringify(cuerpo),
        headers: {
          origin: origen,
          'x-faro-panel': '1',
          'content-type': 'application/json',
          'sec-fetch-site': 'same-origin',
          'x-faro-sesion': token,
        },
      }),
    );
  const abierta = await pedir('sesion/abrir', '', { retomar: true });
  const { token } = (await abierta.json()) as { token: string };
  const lectura = await pedir('recorrido/leer', token, {});
  assert.equal(lectura.status, ESTADO_HTTP.correcto);
  const antes = (await lectura.json()) as { recorrido: { modo: string; revision: number } };
  assert.deepEqual(antes.recorrido, { version: 1, revision: 7, modo: 'demo' });
  assert.equal(
    (await pedir('recorrido/cambiar', token, { revisionEsperada: 7, modo: 'demo' })).status,
    ESTADO_HTTP.solicitudIncorrecta,
  );
  assert.deepEqual(await almacen.leerRecorrido(), { version: 1, revision: 7, modo: 'demo' });
  assert.equal(
    (await pedir('recorrido/cambiar', token, { revisionEsperada: 7, modo: 'real' })).status,
    ESTADO_HTTP.correcto,
  );
  const publico = await responderModoRecorrido(peticionPublica, espacio);
  assert.equal(publico.status, ESTADO_HTTP.correcto);
  assert.deepEqual(await publico.json(), { version: 1, revision: 8, modo: 'real' });
} finally {
  db.close();
}
