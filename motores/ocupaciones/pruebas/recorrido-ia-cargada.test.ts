// Que el recorrido no vaya sin su IA sin que nadie lo sepa: el paquete de datos trae la tabla de vectores y el
// clasificador con su huella (si no, el motor del navegador no los pide), cada paso dice en su lectura si estaban
// cargados (`conVectores`, `conClasificador`) y el motor espera a que terminen de cargar, sin quedarse colgado.
// Con el paquete de datos real; la espera, con promesas y plazos inyectados, sin temporizadores largos.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ARCHIVOS_EXTRA_DEL_PAQUETE, MANIFIESTO } from '../../../src/plataforma/archivos-del-paquete.ts';
import { crearEsperaDeLosExtras, type Plazo } from '../../../src/plataforma/navegador/espera-de-los-extras.ts';
import { esPeticionDePaso, PREFIJO_LOCAL, responderLocal } from '../../../src/plataforma/navegador/ruta-local.ts';
import { cargarDatos } from '../../../src/plataforma/node/datos.ts';
import { clasificadorDesdeContenedor } from '../src/recorrido/fusion/clasificador-movil.ts';
import { cargarDesdeContenedor } from '../src/recorrido/fusion/vectores-movil.ts';
import { estadoDeLaIa, usarClasificador, usarVectores } from '../src/recorrido/pantalla/previa-fusion.ts';
import { comprobarAtributos } from '../src/recorrido/preguntas/atributos.ts';

const DATOS = new URL('../../../datos/', import.meta.url);
const leerJson = (archivo: string): unknown => JSON.parse(readFileSync(new URL(archivo, DATOS), 'utf8'));
const datos = cargarDatos(fileURLToPath(DATOS));
const A = comprobarAtributos(
  JSON.parse(readFileSync(new URL('../src/recorrido/preguntas/atributos.json', import.meta.url), 'utf8')),
);
const BIEN = 200;
const UN_MINUTO_MS = 60_000;

/** La lectura de un paso pedido a la ruta del dispositivo, como lo pide la pantalla. */
async function lecturaDeUnPaso(texto: string): Promise<Record<string, unknown>> {
  const r = await responderLocal(datos, () => A, {
    url: `http://localhost${PREFIJO_LOCAL}paso`,
    method: 'POST',
    headers: [['content-type', 'application/json']],
    body: JSON.stringify({ texto, idioma: 'es', respuestas: [] }),
  });
  assert.equal(r.status, BIEN);
  const cuerpo = (await r.json()) as { lectura: Record<string, unknown> };
  return cuerpo.lectura;
}

/** Un plazo que solo vence cuando la prueba lo dice; cuenta cuántos se crean y cuántos se cancelan. */
function plazoDePrueba() {
  const vencer: (() => void)[] = [];
  let cancelados = 0;
  const plazo: Plazo = () => {
    const vencido = new Promise<void>((resolver) => {
      vencer.push(resolver);
    });
    return { vencido, cancelar: () => (cancelados += 1) };
  };
  return { plazo, vencer, cancelados: () => cancelados };
}

/** Una carga que termina cuando la prueba lo dice. */
function cargaDePrueba() {
  let terminar: (fallo?: Error) => void = () => undefined;
  const carga = new Promise<void>((resolver, rechazar) => {
    terminar = (fallo) => (fallo ? rechazar(fallo) : resolver());
  });
  return { carga, terminar };
}

describe('el paquete de datos trae la IA del recorrido', () => {
  const manifiesto = leerJson(MANIFIESTO) as Record<string, { sha256?: unknown } | undefined>;
  for (const archivo of Object.values(ARCHIVOS_EXTRA_DEL_PAQUETE)) {
    it(`${MANIFIESTO} lista ${archivo} con su huella`, () => {
      const huella = manifiesto[archivo]?.sha256;
      assert.equal(typeof huella, 'string', `${archivo} no está en ${MANIFIESTO}: el navegador iría sin él`);
      const calculada = createHash('sha256')
        .update(readFileSync(new URL(archivo, DATOS)))
        .digest('hex');
      assert.equal(calculada, huella, `${archivo} no coincide con su huella: el navegador lo descartaría`);
    });
  }
});

describe('cada paso dice si tenía la IA cargada', () => {
  it('sin vectores ni clasificador, la lectura lleva los dos a falso', async () => {
    usarVectores(null);
    usarClasificador(null);
    const lectura = await lecturaDeUnPaso('trabajo de cajera en un súper');
    assert.equal(lectura.conVectores, false);
    assert.equal(lectura.conClasificador, false);
  });

  it('con los dos cargados del paquete, la lectura los lleva a verdadero', async () => {
    usarVectores(await cargarDesdeContenedor(leerJson(ARCHIVOS_EXTRA_DEL_PAQUETE.vectoresMovil)));
    usarClasificador(clasificadorDesdeContenedor(leerJson(ARCHIVOS_EXTRA_DEL_PAQUETE.clasificadorMovil)));
    assert.deepEqual(estadoDeLaIa(), { conVectores: true, conClasificador: true });
    const lectura = await lecturaDeUnPaso('trabajo de cajera en un súper');
    assert.equal(lectura.conVectores, true);
    assert.equal(lectura.conClasificador, true);
  });

  it('con solo uno, la lectura dice cuál falta', async () => {
    usarClasificador(null);
    const lectura = await lecturaDeUnPaso('cuido a personas mayores en una residencia');
    assert.equal(lectura.conVectores, true);
    assert.equal(lectura.conClasificador, false);
    usarVectores(null);
  });

  it('solo el paso espera a la IA: las demás peticiones del recorrido no la usan', () => {
    assert.equal(esPeticionDePaso(`http://localhost${PREFIJO_LOCAL}paso`), true);
    assert.equal(esPeticionDePaso(`http://localhost${PREFIJO_LOCAL}familias`), false);
    assert.equal(esPeticionDePaso(`http://localhost${PREFIJO_LOCAL}paso/otra`), false);
    assert.equal(esPeticionDePaso('no es una dirección'), false);
  });
});

describe('la espera del motor a la IA', () => {
  it('espera a que terminen las cargas y, ya terminadas, no crea más plazos', async () => {
    const vectores = cargaDePrueba();
    const clasificador = cargaDePrueba();
    const p = plazoDePrueba();
    const esperar = crearEsperaDeLosExtras([vectores.carga, clasificador.carga], UN_MINUTO_MS, p.plazo);
    const primera = esperar();
    vectores.terminar();
    clasificador.terminar();
    assert.equal(await primera, true);
    assert.equal(p.cancelados(), 1, 'el plazo de la primera espera se cancela');
    assert.equal(await esperar(), true);
    assert.equal(p.vencer.length, 1, 'con las cargas terminadas no se crea otro plazo');
  });

  it('un fallo de carga también termina la espera: el paso sigue y lo dice', async () => {
    const vectores = cargaDePrueba();
    const p = plazoDePrueba();
    const esperar = crearEsperaDeLosExtras([vectores.carga], UN_MINUTO_MS, p.plazo);
    const espera = esperar();
    vectores.terminar(new Error('sin red'));
    assert.equal(await espera, true);
  });

  it('si el plazo vence antes, responde que no han terminado y la siguiente vuelve a esperar', async () => {
    const vectores = cargaDePrueba();
    const p = plazoDePrueba();
    const esperar = crearEsperaDeLosExtras([vectores.carga], UN_MINUTO_MS, p.plazo);
    const espera = esperar();
    p.vencer[0]?.();
    assert.equal(await espera, false);
    const otra = esperar();
    assert.equal(p.vencer.length, 2, 'la siguiente espera tiene su propio plazo');
    vectores.terminar();
    assert.equal(await otra, true);
  });

  it('el plazo pedido es el que se le da', () => {
    const pedidos: number[] = [];
    const esperar = crearEsperaDeLosExtras([new Promise(() => undefined)], UN_MINUTO_MS, (ms) => {
      pedidos.push(ms);
      return { vencido: Promise.resolve(), cancelar: () => undefined };
    });
    return esperar().then((terminadas) => {
      assert.equal(terminadas, false);
      assert.deepEqual(pedidos, [UN_MINUTO_MS]);
    });
  });
});
