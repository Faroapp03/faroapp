// El trabajador corta cálculos síncronos y bucles sin bloquear el recorrido, se recupera de errores y muerte,
// conserva las respuestas factuales y mantiene el motor fuera del hilo de la app.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { OFERTA_POR_DEFECTO } from '../../motores/cursos/src/index.ts';
import { crearApi, type ResponderApi } from '../../src/api/api.ts';
import { CABECERA_CONTRATO, CONTRATO_API } from '../../src/api/metadatos-http.ts';
import {
  crearPuertaEnTrabajador,
  type LanzarTrabajador,
  motorDeCursos,
  type PuertaDelMotor,
} from '../../src/plataforma/motor-de-cursos.ts';
import { crearApiLocal } from '../../src/plataforma/navegador/api-local.ts';
import { cargarDatos } from '../../src/plataforma/node/datos.ts';
import { crearPuertaDeCursosNode, lanzadorNode } from '../../src/plataforma/node/puerta-de-cursos.ts';
import type { MensajeAlTrabajador } from '../../src/plataforma/operaciones-de-cursos.ts';
import { FECHA_DEL_INFORME } from '../ayudas/fecha-del-informe.ts';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
const CARPETA = join(RAIZ, 'datos');
const DATOS = cargarDatos(CARPETA);
const MOTOR_DE_PRUEBA = new URL('../ayudas/motor-de-cursos-de-prueba.ts', import.meta.url).href;
const ORIGEN = 'http://faro.test';
const HOY = '2026-10-07';
const BASE = { datos: DATOS, origenesPermitidos: [] } as const;

/** Los tiempos medidos y su margen: el corte llega hacia los 10 ms, y nunca cerca de los 150. */
const CALCULO_MS = 150;
const LIMITE_MS = 10;
const MARGEN_DEL_CORTE_MS = 60;
/** Un bucle infinito se corta con este límite. */
const LIMITE_DEL_BUCLE_MS = 100;
const CORRECTO = 200;
/** La tarea oficial del informe. */
const TAREAS = [
  { id: 'uno', texto: 'Tarea oficial 7512-1', tiempo: 'algo', referencia: { tareaOit: '7512-1', relacion: 'propia' } },
] as const;
const ENTRADA_DEL_INFORME = { isco08: '7512', fecha: FECHA_DEL_INFORME, sinIa: true, tareas: TAREAS };

/** Lo que tarda una promesa, en milisegundos, y su valor. */
async function medido<Valor>(promesa: Promise<Valor>, desde: number): Promise<{ valor: Valor; ms: number }> {
  const valor = await promesa;
  return { valor, ms: performance.now() - desde };
}

/** Un lanzador de Node que cuenta los trabajadores que arranca y apunta lo que les manda la puerta. */
function contado(): {
  lanzar: LanzarTrabajador;
  lanzados: () => number;
  mandados: MensajeAlTrabajador[][];
} {
  const lanzar = lanzadorNode(MOTOR_DE_PRUEBA);
  const mandados: MensajeAlTrabajador[][] = [];
  return {
    lanzar: (avisos) => {
      const suyos: MensajeAlTrabajador[] = [];
      mandados.push(suyos);
      const trabajador = lanzar(avisos);
      return {
        enviar: (mensaje) => {
          suyos.push(mensaje);
          trabajador.enviar(mensaje);
        },
        terminar: () => trabajador.terminar(),
      };
    },
    lanzados: () => mandados.length,
    mandados,
  };
}

/** Una consulta del catálogo con el texto que elige el caso del motor de prueba. */
function catalogo(puerta: PuertaDelMotor, texto: string, limiteMs?: number) {
  const consulta = { hoy: HOY, oferta: OFERTA_POR_DEFECTO, filtros: { texto }, pagina: 1 };
  return puerta.operar('catalogoDeCursos', [consulta], {
    datos: DATOS,
    ...(limiteMs === undefined ? {} : { limiteMs }),
  });
}

function pedir(api: ResponderApi, ruta: string, cuerpo?: unknown): Promise<Response> {
  const cabeceras = { [CABECERA_CONTRATO]: String(CONTRATO_API), 'content-type': 'application/json' };
  return api(
    new Request(`${ORIGEN}${ruta}`, {
      method: cuerpo === undefined ? 'GET' : 'POST',
      headers: cabeceras,
      ...(cuerpo === undefined ? {} : { body: JSON.stringify(cuerpo) }),
    }),
  );
}

test('trabajador: un cálculo de 150 ms con límite de 10 ms se corta hacia los 10 ms y el recorrido no lo espera', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const { lanzar, lanzados } = contado();
  const puerta = crearPuertaEnTrabajador(lanzar);
  const api = await crearApi({ ...BASE, motorDeCursos: puerta });
  // El trabajador arranca y recibe los datos con la primera operación, con su límite normal.
  assert.equal((await catalogo(puerta, 'recepcion')).disponible, true);
  const solo = performance.now();
  assert.equal((await pedir(api, '/api/ocupaciones?q=recepcionista')).status, CORRECTO);
  const recorridoSolo = performance.now() - solo;

  const empieza = performance.now();
  const cursos = medido(catalogo(puerta, `calcula-${CALCULO_MS}`, LIMITE_MS), empieza);
  const recorrido = medido(pedir(api, '/api/ocupaciones?q=recepcionista'), empieza);
  const [delMotor, delRecorrido] = await Promise.all([cursos, recorrido]);
  console.log(
    `Caso 2: el recorrido solo tarda ${recorridoSolo.toFixed(1)} ms; con Cursos calculando ${CALCULO_MS} ms ` +
      `(límite ${LIMITE_MS} ms), Cursos responde «${delMotor.valor.disponible ? 'disponible' : delMotor.valor.motivo}» ` +
      `a los ${delMotor.ms.toFixed(1)} ms y el recorrido, a los ${delRecorrido.ms.toFixed(1)} ms.`,
  );
  assert.equal(delMotor.valor.disponible === false && delMotor.valor.motivo, 'bloqueado');
  assert.ok(delMotor.ms >= LIMITE_MS - 1, `el corte llega a su límite (${delMotor.ms} ms)`);
  assert.ok(delMotor.ms < LIMITE_MS + MARGEN_DEL_CORTE_MS, `el corte llega hacia los 10 ms (${delMotor.ms} ms)`);
  assert.equal(delRecorrido.valor.status, CORRECTO);
  assert.ok(delRecorrido.ms < CALCULO_MS, `el recorrido no espera los 150 ms de Cursos (${delRecorrido.ms} ms)`);
  // El trabajador cortado se ha terminado: la siguiente operación arranca uno nuevo y responde.
  assert.equal((await catalogo(puerta, 'recepcion')).disponible, true);
  assert.equal(lanzados(), 2);
});

test('trabajador: un bucle infinito da «bloqueado», termina el trabajador y la siguiente operación usa uno nuevo', async () => {
  const { lanzar, lanzados } = contado();
  const puerta = crearPuertaEnTrabajador(lanzar);
  assert.equal((await catalogo(puerta, 'recepcion')).disponible, true);
  const empieza = performance.now();
  const bucle = await catalogo(puerta, 'bucle', LIMITE_DEL_BUCLE_MS);
  const ms = performance.now() - empieza;
  console.log(`Bucle infinito: «${bucle.disponible ? 'disponible' : bucle.motivo}» a los ${ms.toFixed(1)} ms.`);
  assert.equal(bucle.disponible === false && bucle.motivo, 'bloqueado');
  assert.ok(ms < LIMITE_DEL_BUCLE_MS + MARGEN_DEL_CORTE_MS, `el bucle se corta a su límite (${ms} ms)`);
  const despues = await catalogo(puerta, 'recepcion');
  assert.equal(despues.disponible, true, 'la siguiente operación funciona');
  assert.equal(lanzados(), 2, 'con un trabajador nuevo');
});

test('trabajador: un error dentro del trabajador o que muera da «averiado», y se recupera', async () => {
  const { lanzar, lanzados } = contado();
  const puerta = crearPuertaEnTrabajador(lanzar);
  const lanza = await catalogo(puerta, 'lanza');
  assert.deepEqual(lanza, {
    disponible: false,
    motivo: 'averiado',
    detalle: 'Error: fallo de prueba dentro del trabajador',
  });
  const muere = await catalogo(puerta, 'muere');
  assert.equal(muere.disponible === false && muere.motivo, 'averiado');
  assert.match(muere.disponible === false ? muere.detalle : '', /se ha caído: ha terminado con el código 3/u);
  assert.equal((await catalogo(puerta, 'recepcion')).disponible, true);
  assert.equal(lanzados(), 2, 'el error no tira el trabajador; la muerte, sí');

  const sinMotor = crearPuertaDeCursosNode({ moduloDelTrabajador: new URL('../no-existe.ts', import.meta.url).href });
  const ausente = await catalogo(sinMotor, 'recepcion');
  assert.equal(ausente.disponible === false && ausente.motivo, 'ausente');
});

test('trabajador: con el motor real, el informe breve del dispositivo y /api/cursos salen igual que en el mismo hilo', async () => {
  const puerta = crearPuertaDeCursosNode();
  const enElHilo = await crearApiLocal({ datos: DATOS, motorDeCursos });
  const enSuHilo = await crearApiLocal({ datos: DATOS, motorDeCursos: puerta });
  for (const [ruta, cuerpo] of [
    ['/api/informe?formato=breve', ENTRADA_DEL_INFORME],
    ['/api/informe?formato=html', ENTRADA_DEL_INFORME],
    [`/api/cursos?fecha=${HOY}&q=cocina`, undefined],
  ] as const) {
    const esperado = await pedir(enElHilo, ruta, cuerpo);
    const obtenido = await pedir(enSuHilo, ruta, cuerpo);
    assert.equal(obtenido.status, esperado.status, ruta);
    assert.equal(esperado.status, CORRECTO, ruta);
    assert.deepEqual(await obtenido.json(), await esperado.json(), ruta);
  }
});

test('la app pide al motor de cursos solo operaciones con nombre: nada de ejecutar() en src/api', () => {
  const carpeta = join(RAIZ, 'src', 'api');
  const conEjecutar = readdirSync(carpeta, { recursive: true, withFileTypes: true })
    .filter((entrada) => entrada.isFile() && entrada.name.endsWith('.ts'))
    .map((entrada) => join(entrada.parentPath, entrada.name))
    .filter((archivo) => /\.ejecutar\(\s*(?:async\s*)?\(?\s*motor\b/u.test(readFileSync(archivo, 'utf8')));
  assert.deepEqual(conEjecutar, []);
});
