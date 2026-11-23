// El orden de la copia del paquete: primero lo que necesita el primer análisis (ARCHIVOS_DEL_PRIMER_ANALISIS), que se
// sirve al motor en cuanto está guardado, y después el resto, que termina la copia completa como siempre. Los dos
// estados se cuentan por separado.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { servicioPublicado } from '../ayudas/web-construida.ts';
import { pedir, servicio } from './ayudas.ts';

const BASE = 'https://ejemplo.invalid/';
const CIFRAS_VERSION = 16;
const BIEN = 200;
const NO_ESTA = 404;
const FUENTE = servicioPublicado();
const huella = (texto: string) => createHash('sha256').update(texto).digest('hex');
const DEL_PRIMER_ANALISIS = ['esco.json', 'vectores-movil.json'];
const DEL_RESTO = ['formacion.json', 'salarios.json'];

type Mensaje = {
  type: string;
  primerAnalisis?: { guardados: number; archivos: number; bytes: number; bytesTotales: number };
  guardados?: number;
};

function paquete() {
  const datos = [...DEL_RESTO, ...DEL_PRIMER_ANALISIS].map((archivo) => [archivo, `{"de":"${archivo}"}`] as const);
  const manifiesto = JSON.stringify(Object.fromEntries(datos.map(([a, texto]) => [a, { sha256: huella(texto) }])));
  return { datos, manifiesto, version: huella(manifiesto).slice(0, CIFRAS_VERSION) };
}

/** El service worker real con este paquete; el resto no llega hasta soltarlo, y se anota el orden de las descargas. */
function arrancar() {
  const { datos, manifiesto, version } = paquete();
  const prefijo =
    'self.registration.recibidos = [];\n' +
    'self.clients.matchAll = async () => [{ postMessage: (m) => self.registration.recibidos.push(m) }];\n';
  const sw = servicio(BASE, { paquete: version, fuente: prefijo + FUENTE });
  sw.conectar();
  const pedidos: string[] = [];
  const restoPedido = Promise.withResolvers<void>();
  let soltar = () => {};
  const resto = new Promise<void>((resolver) => {
    soltar = resolver;
  });
  sw.red.respuesta = async (url) => {
    const archivo = url.split('/').at(-1) ?? '';
    pedidos.push(archivo);
    if (archivo === 'manifiesto.json') {
      return new Response(manifiesto);
    }
    if (DEL_RESTO.includes(archivo)) {
      restoPedido.resolve();
      await resto;
    }
    const encontrado = datos.find(([a]) => a === archivo);
    return new Response(encontrado?.[1] ?? '', { status: encontrado ? BIEN : NO_ESTA });
  };
  const avisos = (): Mensaje[] => JSON.parse(JSON.stringify((sw.registro as { recibidos?: unknown }).recibidos));
  return { sw, version, pedidos, soltar, avisos, restoPedido: restoPedido.promise };
}

/** Pide la copia como la página y recoge lo que el service worker le contesta a ella. */
function pedirLaCopia(sw: ReturnType<typeof servicio>) {
  const contestados: Mensaje[] = [];
  const primerAnalisis = Promise.withResolvers<void>();
  let trabajo: Promise<unknown> = Promise.resolve();
  sw.oyentes.get('message')?.({
    data: { type: 'PREPARAR_PAQUETE' },
    source: {
      id: 'pagina',
      postMessage: (m: Mensaje) => {
        contestados.push(JSON.parse(JSON.stringify(m)));
        if (m.type === 'PRIMER_ANALISIS_DEL_PAQUETE') {
          primerAnalisis.resolve();
        }
      },
    },
    waitUntil: (valor: Promise<unknown>) => {
      trabajo = valor;
    },
  });
  return { contestados, primerAnalisis: primerAnalisis.promise, terminado: () => trabajo };
}

test('baja primero el primer análisis, lo sirve con la copia a medias y termina la copia completa', async () => {
  const { sw, version, pedidos, soltar, avisos, restoPedido } = arrancar();
  const pagina = pedirLaCopia(sw);
  await pagina.primerAnalisis;
  assert.deepEqual(
    pagina.contestados.map((m) => m.type),
    ['PRIMER_ANALISIS_DEL_PAQUETE'],
    'la página sabe que está el primer análisis, y la copia aún no está completa',
  );
  const primeros = pedidos.filter((archivo) => archivo !== 'manifiesto.json');
  assert.deepEqual(primeros.slice(0, DEL_PRIMER_ANALISIS.length).sort(), [...DEL_PRIMER_ANALISIS].sort());
  // Con la copia a medias, lo del primer análisis y el manifiesto se sirven; el resto espera al intento.
  let delResto: Awaited<ReturnType<typeof pedir>> | null = null;
  const esperando = pedir(sw, `paquete/${version}/${DEL_RESTO[0]}`, { method: 'GET', mode: 'cors' }).then((r) => {
    delResto = r;
  });
  for (const archivo of ['manifiesto.json', ...DEL_PRIMER_ANALISIS]) {
    const respuesta = await pedir(sw, `paquete/${version}/${archivo}`, { method: 'GET', mode: 'cors' });
    assert.equal(respuesta.estado, BIEN, archivo);
  }
  await restoPedido;
  assert.equal(delResto, null, 'un archivo del resto espera a la copia completa');
  const ultimo = avisos()
    .filter((m) => m.type === 'PROGRESO_DEL_PAQUETE')
    .at(-1);
  assert.equal(ultimo?.primerAnalisis?.archivos, DEL_PRIMER_ANALISIS.length);
  assert.equal(ultimo?.primerAnalisis?.guardados, DEL_PRIMER_ANALISIS.length, 'lo del primer análisis, entero');
  assert.ok((ultimo?.guardados ?? 0) < DEL_PRIMER_ANALISIS.length + DEL_RESTO.length, 'la copia completa, aún no');
  soltar();
  await pagina.terminado();
  await esperando;
  assert.equal((delResto as { estado?: number } | null)?.estado, BIEN);
  assert.deepEqual(pagina.contestados.at(-1), { type: 'ESTADO_DEL_PAQUETE', version, completo: true });
  assert.deepEqual([...new Set(pedidos)].sort(), ['manifiesto.json', ...DEL_PRIMER_ANALISIS, ...DEL_RESTO].sort());
  assert.equal(pedidos.length, new Set(pedidos).size, 'nada se baja dos veces');
});
