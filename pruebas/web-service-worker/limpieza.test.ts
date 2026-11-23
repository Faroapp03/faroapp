// Dos trabajadores comparten CacheStorage, pero conservan registro, código y caché de versión propios.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { BASES, pedir, prepararPaquete, servicio } from './ayudas.ts';

const VERSION_NUEVA = '0000000000000000';
const CIFRAS_VERSION = 16;
const huella = (texto: string) => createHash('sha256').update(texto).digest('hex');
const manifiestoDe = (datos: string) => JSON.stringify({ 'datos.json': { sha256: huella(datos) } });
const PAQUETE_ANTIGUO = huella(manifiestoDe('ANTERIOR')).slice(0, CIFRAS_VERSION);
const PAQUETE_NUEVO = huella(manifiestoDe('SIGUIENTE')).slice(0, CIFRAS_VERSION);
const MOTOR = 'motor comprobado de la versión siguiente';
const GUION = 'motor/motor.js';
const HUELLA = createHash('sha256').update(MOTOR).digest('hex');
const CORRECTO = 200;
/** Lo que entrega la red de la versión siguiente para cada página. */
const PAGINA = '<p>Página</p>';

/** Ambos nombres son hashes y nunca se ordenan como una fecha. */
function dosVersiones(base: string) {
  const anterior = servicio(base, { paquete: PAQUETE_ANTIGUO });
  const siguiente = servicio(
    base,
    { version: VERSION_NUEVA, paquete: PAQUETE_NUEVO, comprobados: [[GUION, HUELLA]], cuerpoDe: () => PAGINA },
    anterior.copias,
  );
  return { anterior, siguiente };
}

/** Una copia completa permite probar solo su limpieza, sin nuevas descargas ni manifiestos inventados. */
function paqueteCompleto(sw: ReturnType<typeof servicio>, version: string) {
  const datos = version === PAQUETE_ANTIGUO ? 'ANTERIOR' : 'SIGUIENTE';
  sw.guardadas.set(
    `faro-paquete-${version}`,
    new Map([
      [sw.urlDe(`paquete/${version}/manifiesto.json`), new Response(manifiestoDe(datos))],
      [sw.urlDe(`paquete/${version}/datos.json`), new Response(datos)],
    ]),
  );
}

for (const base of BASES) {
  test(`limpieza web conserva instalación y motor comprobado de otro trabajador: ${base}`, async () => {
    const { anterior, siguiente } = dosVersiones(base);
    const definitivaAbierta = Promise.withResolvers<void>();
    const continuar = Promise.withResolvers<void>();
    const abrir = anterior.copias.open.bind(anterior.copias);
    anterior.copias.open = async (nombre) => {
      const copia = await abrir(nombre);
      if (nombre === siguiente.nombreCopia) {
        definitivaAbierta.resolve();
        await continuar.promise;
      }
      return copia;
    };
    siguiente.conectar();
    siguiente.red.respuesta = (url) =>
      new Response(url.endsWith(GUION) ? MOTOR : PAGINA, {
        headers: { 'content-type': url.endsWith(GUION) ? 'text/javascript' : 'text/html' },
      });
    anterior.registro.installing = {};
    const instalacion = siguiente.instalar();
    try {
      await definitivaAbierta.promise;
      await anterior.activar();
    } finally {
      continuar.resolve();
      await instalacion;
    }
    const motor = await pedir(siguiente, GUION, { mode: 'cors', method: 'GET' });
    assert.equal(motor.estado, CORRECTO);
    assert.equal(motor.cuerpo, MOTOR);
    assert.ok(anterior.guardadas.has(siguiente.nombreCopia));
    assert.ok(!anterior.borradas.includes(siguiente.nombreCopia));
  });

  for (const estado of ['installing', 'waiting'] as const) {
    test(`limpieza web conserva versión ${estado} y reanuda el descarte después: ${base}`, async () => {
      const { anterior, siguiente } = dosVersiones(base);
      anterior.guardadas.set(anterior.nombreCopia, new Map());
      anterior.guardadas.set(siguiente.nombreCopia, new Map());
      anterior.guardadas.set(`faro:${base}:antigua`, new Map());
      anterior.registro[estado] = {};
      await anterior.activar();
      assert.ok(anterior.guardadas.has(siguiente.nombreCopia));
      assert.equal(anterior.activaciones, 1);
      anterior.registro[estado] = null;
      await anterior.activar();
      assert.deepEqual([...anterior.guardadas.keys()], [anterior.nombreCopia]);
    });

    test(`limpieza de paquetes protege ${estado}, incluso si aparece durante keys: ${base}`, async () => {
      const { anterior } = dosVersiones(base);
      paqueteCompleto(anterior, PAQUETE_ANTIGUO);
      paqueteCompleto(anterior, PAQUETE_NUEVO);
      const claves = anterior.copias.keys.bind(anterior.copias);
      anterior.copias.keys = async () => {
        const nombres = await claves();
        anterior.registro[estado] = {};
        return nombres;
      };
      const resultado = await prepararPaquete(anterior);
      assert.deepEqual(JSON.parse(JSON.stringify(resultado)), {
        type: 'ESTADO_DEL_PAQUETE',
        version: PAQUETE_ANTIGUO,
        completo: true,
      });
      assert.ok(anterior.guardadas.has(`faro-paquete-${PAQUETE_NUEVO}`));
      assert.deepEqual(anterior.peticiones, []);
      anterior.copias.keys = claves;
      anterior.registro[estado] = null;
      await prepararPaquete(anterior);
      assert.deepEqual([...anterior.guardadas.keys()], [`faro-paquete-${PAQUETE_ANTIGUO}`]);
    });

    test(`limpieza web vuelve a mirar ${estado} tras esperar keys: ${base}`, async () => {
      const { anterior, siguiente } = dosVersiones(base);
      anterior.guardadas.set(anterior.nombreCopia, new Map());
      anterior.guardadas.set(siguiente.nombreCopia, new Map());
      const claves = anterior.copias.keys.bind(anterior.copias);
      anterior.copias.keys = async () => {
        const nombres = await claves();
        anterior.registro[estado] = {};
        return nombres;
      };
      await anterior.activar();
      assert.ok(anterior.guardadas.has(siguiente.nombreCopia));
      assert.deepEqual(anterior.borradas, []);
    });
  }
}
