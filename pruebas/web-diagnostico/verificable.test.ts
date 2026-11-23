import assert from 'node:assert/strict';
import { test } from 'node:test';
import { huella } from '../../web/scripts/firmas/firmas.js';
import { verificadorNativo } from '../../web/scripts/firmas/nativa.js';
import {
  comprobarLoServido,
  DESCARGAS_A_LA_VEZ,
  type Entorno,
  FIRMA,
  MANIFIESTO,
} from '../../web/scripts/verificable/comprobacion.js';
import { servicioPublicado } from '../ayudas/web-construida.ts';
import { cadenaDePrueba, enBytes } from '../web-firmas/ayudas.js';

const RAIZ = new URL('https://faro.example/Mis%20documentos/A%C3%B1o%202026/');
const PAQUETE = '0123456789abcdef';
const PUBLICADOS: Record<string, Uint8Array> = {
  'motor/entrada.js': enBytes({ motor: 1 }),
  [`paquete/${PAQUETE}/datos.json`]: enBytes({ datos: [] }),
};
const MANIFIESTO_BYTES = enBytes({
  formato: 1,
  paquete: PAQUETE,
  archivos: Object.fromEntries(Object.entries(PUBLICADOS).map(([ruta, bytes]) => [ruta, huella(bytes)])),
});

function servidor(archivos: Record<string, Uint8Array>) {
  const pedidas: { ruta: string; opciones: RequestInit }[] = [];
  const pedir: Entorno['pedir'] = async (direccion, opciones) => {
    assert.ok(direccion.href.startsWith(RAIZ.href));
    const ruta = direccion.href.slice(RAIZ.href.length);
    pedidas.push({ ruta, opciones });
    const bytes = archivos[ruta];
    return bytes ? new Response(new Uint8Array(bytes)) : new Response('', { status: 404 });
  };
  return { pedir, pedidas };
}

async function comprobar(archivos: Record<string, Uint8Array>) {
  const red = servidor(archivos);
  const resultado = await comprobarLoServido({ raiz: RAIZ, raices: [], pedir: red.pedir });
  return { resultado, pedidas: red.pedidas };
}

test('sin raíz conserva las huellas, el orden y el paquete; usa la misma raíz y no pide firma', async () => {
  const { resultado, pedidas } = await comprobar({ ...PUBLICADOS, [MANIFIESTO]: MANIFIESTO_BYTES });
  assert.deepEqual(resultado, {
    veredicto: 'coinciden-sin-firma',
    firma: 'sin-activar',
    motivo: null,
    paquete: PAQUETE,
    archivos: Object.keys(PUBLICADOS).map((ruta) => ({ ruta, estado: 'coincide' })),
  });
  assert.ok(!pedidas.some(({ ruta }) => ruta === FIRMA));
  assert.ok(pedidas.every(({ opciones }) => opciones.cache === 'no-store' && opciones.signal instanceof AbortSignal));
});

test('archivos alterados van primero y la ausencia es incompleto', async () => {
  const { resultado } = await comprobar({
    ...PUBLICADOS,
    [MANIFIESTO]: MANIFIESTO_BYTES,
    'motor/entrada.js': enBytes({ alterado: true }),
  });
  assert.equal(resultado.veredicto, 'no-coinciden');
  assert.deepEqual(resultado.archivos[0], { ruta: 'motor/entrada.js', estado: 'no-coincide' });
  const incompleto = await comprobar({ [MANIFIESTO]: MANIFIESTO_BYTES });
  assert.equal(incompleto.resultado.veredicto, 'incompleto');
  assert.ok(incompleto.resultado.archivos.every(({ estado }) => estado === 'no-disponible'));
});

test('sin manifiesto, vacío o con rutas fuera de la raíz no compara archivos', async () => {
  const sin = await comprobar(PUBLICADOS);
  assert.equal(sin.resultado.veredicto, 'sin-manifiesto');
  assert.deepEqual(
    sin.pedidas.map(({ ruta }) => ruta),
    [MANIFIESTO],
  );
  for (const archivos of [{}, { '../fuera.js': huella(new Uint8Array()) }]) {
    const invalido = await comprobar({ [MANIFIESTO]: enBytes({ formato: 1, paquete: PAQUETE, archivos }) });
    assert.equal(invalido.resultado.veredicto, 'manifiesto-no-valido');
    assert.deepEqual(
      invalido.pedidas.map(({ ruta }) => ruta),
      [MANIFIESTO],
    );
  }
});

test('firma real híbrida efímera verifica; firma alterada, ausente o caducada detiene la comparación', async () => {
  const cadena = cadenaDePrueba();
  const archivos = {
    [MANIFIESTO]: cadena.bytes,
    [FIRMA]: enBytes(cadena.firma),
    'motor/entrada.js': cadena.recurso,
    'paquete/p1/datos.json': cadena.recurso,
  };
  const entorno = { raiz: RAIZ, ...cadena.opciones, verificador: verificadorNativo(null) };
  const buena = await comprobarLoServido({ ...entorno, pedir: servidor(archivos).pedir });
  assert.equal(buena.veredicto, 'verificado');
  assert.equal(buena.firma, 'comprobada');
  const alterada = {
    ...archivos,
    [MANIFIESTO]: enBytes({ formato: 1, paquete: 'p1', archivos: { 'motor/entrada.js': huella(enBytes('otro')) } }),
  };
  for (const [red, ahora] of [
    [servidor(alterada), cadena.opciones.ahora],
    [servidor({ [MANIFIESTO]: cadena.bytes }), cadena.opciones.ahora],
    [servidor(archivos), new Date('2027-01-01T00:00:00Z')],
  ] as const) {
    const fallo = await comprobarLoServido({ ...entorno, ahora, pedir: red.pedir });
    assert.equal(fallo.veredicto, 'firma-no-valida');
    assert.deepEqual(fallo.archivos, []);
    assert.ok(red.pedidas.every(({ ruta }) => ruta === MANIFIESTO || ruta === FIRMA));
  }
});

test('descargas limitadas y mismo límite que el service worker', async () => {
  const fuentes = servicioPublicado();
  // El service worker publicado es un derivado de esbuild: sus constantes de nivel superior salen como `var`.
  assert.equal(Number(/^var DESCARGAS_A_LA_VEZ = (\d+);$/mu.exec(fuentes)?.[1]), DESCARGAS_A_LA_VEZ);
  let activas = 0;
  let maximo = 0;
  const total = 11;
  const archivos = Object.fromEntries(Array.from({ length: total }, (_, i) => [`motor/a${i}.js`, huella(enBytes(i))]));
  const resultado = await comprobarLoServido({
    raiz: RAIZ,
    raices: [],
    pedir: async (direccion) => {
      if (direccion.href.endsWith(MANIFIESTO)) {
        return new Response(enBytes({ formato: 1, paquete: PAQUETE, archivos }));
      }
      activas += 1;
      maximo = Math.max(maximo, activas);
      await new Promise((resolver) => setImmediate(resolver));
      activas -= 1;
      return new Response('', { status: 404 });
    },
  });
  assert.equal(maximo, DESCARGAS_A_LA_VEZ);
  assert.equal(resultado.archivos.length, total);
});
