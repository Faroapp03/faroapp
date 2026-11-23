import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { comprobarTodo, type Entorno } from '../../web/scripts/doctor/comprobaciones.js';
import { huella } from '../../web/scripts/firmas/firmas.js';
import { comprobarLoServido, MANIFIESTO } from '../../web/scripts/verificable/comprobacion.js';
import { servicioPublicado } from '../ayudas/web-construida.ts';

const RAIZ = new URL('https://faro.example/Mis%20documentos/A%C3%B1o%202026/');
const VERSION = '0123456789abcdef';
const FIRMA = 'fedcba9876543210';
const RECURSO = new TextEncoder().encode('motor actual');
const MANIFIESTO_BYTES = new TextEncoder().encode(
  JSON.stringify({
    formato: 1,
    paquete: VERSION,
    archivos: { 'motor/entrada.js': huella(RECURSO) },
  }),
);

function entornoDoctor(instalada: string): Entorno {
  return {
    fetch: async (direccion) =>
      new Response(
        direccion === '/api/salud'
          ? JSON.stringify({ estado: 'ok', version: '1.0.0', cerebro: null })
          : `var VERSION = "${VERSION}";`,
      ),
    caches: { keys: async () => [`faro:${RAIZ.href}:${instalada}`, 'faro:https://otra.example/:otro'] },
    location: { href: new URL('doctor.html', RAIZ).href },
    enLinea: true,
    idiomaNavegador: 'es',
    controlada: true,
    estimarEspacio: async () => null,
    funciones: { serviceWorker: true },
  };
}

function copiaDelServicio(version: string, firma: string) {
  const fuente = servicioPublicado();
  const declaraciones = ['PREFIJO', 'CIFRAS_DE_LA_FIRMA', 'ULTIMA_FIRMA', 'COPIA'].map((nombre) => {
    const declaracion = fuente.match(new RegExp(`^var ${nombre} = .*;$`, 'mu'))?.[0];
    assert.ok(declaracion, nombre);
    return declaracion;
  });
  return runInNewContext(`${declaraciones.join('\n')}\nCOPIA;`, {
    BASE: RAIZ,
    VERSION: version,
    FIRMAS_PUBLICAS: [['firmas/manifiesto.firma.json', firma]],
  }) as string;
}

test('Comprobación reconoce la VERSION de una copia firmada del service worker', async () => {
  const copia = copiaDelServicio(VERSION, FIRMA);
  const hecho = await comprobarTodo(entornoDoctor(copia.slice(`faro:${RAIZ.href}:`.length)), 'es');
  assert.deepEqual(
    hecho.resultados.find(({ id }) => id === 'copia'),
    {
      id: 'copia',
      semaforo: 'bien',
      caso: 'al-dia',
      valores: { instalada: VERSION },
    },
  );
});

test('Comprobación conserva la advertencia ante una web firmada de otra VERSION', async () => {
  const hecho = await comprobarTodo(entornoDoctor(`aaaaaaaaaaaaaaaa+${FIRMA}`), 'es');
  assert.equal(hecho.resultados.find(({ id }) => id === 'copia')?.caso, 'anterior');
});

for (const cortado of [MANIFIESTO, 'motor/entrada.js']) {
  test(`verificable acaba si su plazo aborta el cuerpo de ${cortado}`, async (contexto) => {
    const control = new AbortController();
    contexto.mock.method(AbortSignal, 'timeout', () => control.signal);
    const resultado = await comprobarLoServido({
      raiz: RAIZ,
      raices: [],
      pedir: async (direccion) => {
        const ruta = direccion.href.slice(RAIZ.href.length);
        if (ruta === cortado) {
          return new Response(
            new ReadableStream({
              start(cuerpo) {
                control.abort(new DOMException('Plazo propio vencido', 'TimeoutError'));
                cuerpo.error(new DOMException('El cuerpo se cortó al vencer el plazo', 'AbortError'));
              },
            }),
          );
        }
        return new Response(ruta === MANIFIESTO ? MANIFIESTO_BYTES : RECURSO);
      },
    });
    assert.equal(resultado.veredicto, cortado === MANIFIESTO ? 'sin-manifiesto' : 'incompleto');
    if (cortado !== MANIFIESTO) {
      assert.deepEqual(resultado.archivos, [{ ruta: cortado, estado: 'no-disponible' }]);
    }
  });
}

test('verificable propaga fallos inesperados de programación', async () => {
  const fallo = new Error('fallo interno sintético');
  await assert.rejects(
    comprobarLoServido({
      raiz: RAIZ,
      raices: [],
      pedir: async () => {
        throw fallo;
      },
    }),
    (error) => error === fallo,
  );
});

test('verificable propaga AbortError si su propia señal no se ha cortado', async () => {
  const fallo = new DOMException('corte ajeno al plazo', 'AbortError');
  await assert.rejects(
    comprobarLoServido({
      raiz: RAIZ,
      raices: [],
      pedir: async () => {
        throw fallo;
      },
    }),
    (error) => error === fallo,
  );
});

test('Comprobación no acepta sufijos arbitrarios como firma de la versión vigente', async () => {
  for (const sufijo of ['+otra-cosa', '+1234', '+fedcba9876543210+otro']) {
    const hecho = await comprobarTodo(entornoDoctor(`${VERSION}${sufijo}`), 'es');
    assert.equal(hecho.resultados.find(({ id }) => id === 'copia')?.caso, 'anterior');
  }
});
