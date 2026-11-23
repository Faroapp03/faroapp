// Lo que necesita el primer análisis (src/plataforma/archivos-del-paquete.ts) frente a lo que de verdad leen el
// recorrido local y su arranque, con el paquete publicado y las mismas funciones que compone el motor del navegador:
// - las partes que tocan el índice de la búsqueda y las seis rutas del recorrido son exactamente PARTES_DEL_RECORRIDO;
// - el motor arranca leyendo solo el manifiesto, los archivos de ARCHIVOS_DEL_PRIMER_ANALISIS y nada más, y responde
//   lo mismo que con el paquete entero;
// - una petición que necesita el resto lo dice (necesitaElResto) y, con el resto cargado, responde lo mismo que hoy.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { comprobarPrimerAnalisis } from '../../herramientas/web/primer-analisis.ts';
import { comprobarAtributos, prepararBuscador } from '../../motores/ocupaciones/src/index.ts';
import { crearPeticionLocal } from '../../src/api/cuerpo-local.ts';
import { CABECERA_CONTRATO, CONTRATO_API } from '../../src/api/metadatos-http.ts';
import type { Datos } from '../../src/dominio/tipos-paquete.ts';
import {
  ARCHIVOS_DEL_PRIMER_ANALISIS,
  MANIFIESTO,
  PARTES,
  PARTES_DEL_PRIMER_ANALISIS,
  PARTES_DEL_RECORRIDO,
} from '../../src/plataforma/archivos-del-paquete.ts';
import { motorDeCursos } from '../../src/plataforma/motor-de-cursos.ts';
import { crearApiLocal } from '../../src/plataforma/navegador/api-local.ts';
import { crearMotorLocal } from '../../src/plataforma/navegador/motor.ts';
import { cargarPaquete } from '../../src/plataforma/navegador/paquete.ts';
import { responderLocal } from '../../src/plataforma/navegador/ruta-local.ts';
import { RUTAS } from '../../src/plataforma/node/rutas.ts';

const ORIGEN = 'https://motor.invalid';
const BASE = new URL(`${ORIGEN}/paquete/`);
const PLAZO_MS = 300_000;
const ATRIBUTOS = JSON.parse(
  readFileSync(new URL('../../motores/ocupaciones/src/recorrido/preguntas/atributos.json', import.meta.url), 'utf8'),
);
const CASOS = [
  { texto: 'Soy conductor de autobús urbano', idioma: 'es' },
  { texto: "Sóc conductor d'autobús urbà", idioma: 'ca' },
  ...(
    JSON.parse(readFileSync(new URL('../../motores/ocupaciones/banco/casos-100.json', import.meta.url), 'utf8')) as {
      casos: { texto: string; idioma: string }[];
    }
  ).casos.slice(0, 10),
];

/** Sirve el paquete publicado desde el disco y anota cada archivo pedido. */
function servirElPaquete(t: { mock: { method: typeof test.mock.method } }): string[] {
  const leidos: string[] = [];
  t.mock.method(globalThis, 'fetch', async (entrada: string | URL | Request) => {
    const url = new URL(entrada instanceof Request ? entrada.url : String(entrada));
    assert.equal(url.origin, ORIGEN);
    const archivo = url.pathname.split('/').at(-1) ?? '';
    leidos.push(archivo);
    return new Response(readFileSync(join(RUTAS.paquete, archivo)));
  });
  return leidos;
}

/** Los datos envueltos para anotar qué parte toca cada acceso (también las que no están). */
function conAccesos(datos: Datos, tocadas: Set<string>): Datos {
  return new Proxy(datos, {
    get(objeto, clave, receptor) {
      if (typeof clave === 'string') {
        tocadas.add(clave);
      }
      return Reflect.get(objeto, clave, receptor);
    },
    has(objeto, clave) {
      if (typeof clave === 'string') {
        tocadas.add(clave);
      }
      return Reflect.has(objeto, clave);
    },
  });
}

const local = (operacion: string, cuerpo: unknown) => ({
  url: `${ORIGEN}/local/recorrido-v2/${operacion}`,
  method: 'POST',
  headers: [['content-type', 'application/json']] as [string, string][],
  body: JSON.stringify(cuerpo),
});

/** Las peticiones del recorrido local de un caso: el paso y las otras cinco rutas, con lo que da el paso. */
async function recorrido(
  responder: (peticion: ReturnType<typeof local>) => Promise<Response>,
  caso: (typeof CASOS)[number],
  n: number,
): Promise<string[]> {
  const salidas: string[] = [];
  const pedir = async (operacion: string, cuerpo: unknown) => {
    const texto = await (await responder(local(operacion, cuerpo))).text();
    salidas.push(texto);
    return texto;
  };
  const paso = JSON.parse(await pedir('paso', { ...caso, respuestas: [] })) as {
    paso?: { mejor?: { grupo?: string }; propuesta?: { grupo?: string } };
  };
  await pedir('buscar', caso);
  const familias = JSON.parse(await pedir('familias', {})) as { familias?: { codigo: string }[] };
  const familia = familias.familias?.[n % 10]?.codigo;
  if (familia) {
    await pedir('familia', { codigo: familia });
  }
  const grupo = paso.paso?.mejor?.grupo ?? paso.paso?.propuesta?.grupo;
  if (grupo) {
    await pedir('resultado', { grupo, texto: caso.texto });
    await pedir('enlazar', { grupo, tarea: caso.texto });
  }
  return salidas;
}

/** Lo que el recorrido posterior pide a la API: el grupo de «Continuar», la búsqueda, la ficha y el informe. */
function peticionesDeLaApi(grupo: string, esco: string): Request[] {
  const cabeceras = { [CABECERA_CONTRATO]: String(CONTRATO_API) };
  const informe = { isco08: grupo, fecha: '2026-10-14', sinIa: true, idioma: 'es', tareas: [] };
  return [
    new Request(`${ORIGEN}/api/grupos/${grupo}`, { headers: cabeceras }),
    new Request(`${ORIGEN}/api/ocupaciones?q=conductor`, { headers: cabeceras }),
    new Request(`${ORIGEN}/api/ocupaciones/${esco}?idioma=ca`, { headers: cabeceras }),
    new Request(`${ORIGEN}/api/informe?formato=html`, {
      method: 'POST',
      headers: { ...cabeceras, 'content-type': 'application/json' },
      body: JSON.stringify(informe),
    }),
  ];
}

test('las rutas del recorrido local y su índice tocan exactamente PARTES_DEL_RECORRIDO', {
  timeout: PLAZO_MS,
}, async (t) => {
  servirElPaquete(t);
  const { datos } = await cargarPaquete(BASE);
  const tocadas = new Set<string>();
  const vigilados = conAccesos(datos, tocadas);
  prepararBuscador(vigilados);
  let atributos: ReturnType<typeof comprobarAtributos> | null = null;
  const losAtributos = () => {
    atributos ??= comprobarAtributos(ATRIBUTOS);
    return atributos;
  };
  for (const [n, caso] of CASOS.entries()) {
    await recorrido((peticion) => responderLocal(vigilados, losAtributos, peticion), caso, n);
  }
  // Cuenta también el acceso a una parte que no está: con el paquete a medias daría otra cosa.
  const partes = PARTES.filter((parte) => tocadas.has(parte)).sort();
  assert.deepEqual(partes, [...PARTES_DEL_RECORRIDO].sort());
  for (const parte of PARTES_DEL_RECORRIDO) {
    assert.ok(PARTES_DEL_PRIMER_ANALISIS.includes(parte), parte);
  }
});

/** Como hoy: el paquete entero antes de responder, con la misma API y las mismas rutas locales. */
async function recorridoComoHoy() {
  const { datos: enteros } = await cargarPaquete(BASE);
  const api = await crearApiLocal({ datos: enteros, motorDeCursos });
  let atributos: ReturnType<typeof comprobarAtributos> | null = null;
  const losAtributos = () => {
    atributos ??= comprobarAtributos(ATRIBUTOS);
    return atributos;
  };
  const comoHoy: string[] = [];
  for (const [n, caso] of CASOS.entries()) {
    comoHoy.push(...(await recorrido((peticion) => responderLocal(enteros, losAtributos, peticion), caso, n)));
  }
  return { enteros, api, comoHoy };
}

test('el motor arranca con el primer análisis y responde lo mismo que con el paquete entero; el resto, después', {
  timeout: PLAZO_MS,
}, async (t) => {
  const leidos = servirElPaquete(t);
  t.mock.method(crypto, 'randomUUID', () => '12345678-1234-4000-8000-123456789abc');
  t.mock.method(Date, 'now', () => Date.parse('2026-10-14T12:00:00Z'));
  const motor = await crearMotorLocal(BASE);
  const conElNucleo: string[] = [];
  for (const [n, caso] of CASOS.entries()) {
    conElNucleo.push(...(await recorrido(motor.responder, caso, n)));
  }
  assert.deepEqual(
    [...new Set(leidos)].sort(),
    [MANIFIESTO, ...ARCHIVOS_DEL_PRIMER_ANALISIS].sort(),
    'antes del resto solo se lee el primer análisis',
  );
  assert.equal(motor.necesitaElResto(`${ORIGEN}/api/grupos/7512`), true);
  assert.equal(motor.necesitaElResto(`${ORIGEN}/local/recorrido-v2/paso`), false);

  const { enteros, api, comoHoy } = await recorridoComoHoy();
  assert.equal(conElNucleo.length, comoHoy.length);
  assert.deepEqual(conElNucleo, comoHoy, 'el recorrido local da lo mismo con el primer análisis');

  await motor.completar();
  assert.equal(motor.necesitaElResto(`${ORIGEN}/api/grupos/7512`), false);
  const esco = Object.keys(enteros.esco.ocupaciones)[0] ?? '';
  for (const peticion of peticionesDeLaApi('7512', esco)) {
    const entrada = {
      url: peticion.url,
      method: peticion.method,
      headers: [...peticion.headers] as [string, string][],
      body: peticion.body ? await peticion.clone().text() : null,
    };
    const nueva = await motor.responder(entrada);
    const hoy = await api(crearPeticionLocal(entrada));
    assert.equal(nueva.status, hoy.status, peticion.url);
    assert.equal(await nueva.text(), await hoy.text(), peticion.url);
  }
  const despues: string[] = [];
  for (const [n, caso] of CASOS.entries()) {
    despues.push(...(await recorrido(motor.responder, caso, n)));
  }
  assert.deepEqual(despues, comoHoy, 'con el resto ya cargado, el recorrido sigue dando lo mismo');
});

test('npm run web:comprobar exige que la lista del service worker sea la de su fuente, en el mismo orden', () => {
  assert.deepEqual(comprobarPrimerAnalisis(), []);
  assert.deepEqual(comprobarPrimerAnalisis([...ARCHIVOS_DEL_PRIMER_ANALISIS]), []);
  for (const otra of [[], [...ARCHIVOS_DEL_PRIMER_ANALISIS].reverse(), ARCHIVOS_DEL_PRIMER_ANALISIS.slice(1)]) {
    const problemas = comprobarPrimerAnalisis(otra);
    assert.equal(problemas.length, 1, JSON.stringify(otra));
    assert.match(
      problemas[0] ?? '',
      /src\/service-worker\/primer-analisis\.js: ARCHIVOS_DEL_PRIMER_ANALISIS no es la de/,
    );
  }
});
