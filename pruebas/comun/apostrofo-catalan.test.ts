// El apóstrofo de los textos catalanes propios de Faro es el tipográfico (’), como fija la decisión «Apóstrofo
// tipográfico en catalán». Los rectos (') solo quedan en nombres oficiales, citas y licencias que se escriben como lo
// hace su titular, y en los datos oficiales, que Faro no reescribe. La guardia mira el código fuente de los textos y la
// salida real: el informe catalán que devuelve /api/informe y el problema de /api/clasificar, en el motor del dispositivo.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { CABECERA_CONTRATO, CONTRATO_API } from '../../src/api/metadatos-http.ts';
import { clasificar } from '../../src/api/rutas/clasificar.ts';
import { motorDeCursos } from '../../src/plataforma/motor-de-cursos.ts';
import { crearApiLocal } from '../../src/plataforma/navegador/api-local.ts';
import { cargarDatos } from '../../src/plataforma/node/datos.ts';
import { moderarAntesDelModelo } from '../../src/seguridad/moderacion.ts';
import { contextoDelDispositivo } from '../ayudas/contexto-del-dispositivo.ts';
import { FECHA_DEL_INFORME } from '../ayudas/fecha-del-informe.ts';

const RAIZ = new URL('../../', import.meta.url);
const CARPETA_DATOS = new URL('datos/', RAIZ);
const DATOS = cargarDatos(fileURLToPath(CARPETA_DATOS));
const CORRECTO = 200;
const NO_DISPONIBLE = 503;
/** Caracteres de contexto a cada lado de un apóstrofo recto de la salida para buscarlo en los datos oficiales. */
const CONTEXTO = 12;
/** Un apóstrofo recto entre letras: el de «d'», «l'», «s'», «'ns»… */
const RECTO = /(?<=[\p{L}·])'(?=\p{L})/gu;

/** Los tres textos del aviso del 024 que son palabras de Canal Salut (src/seguridad/avisos.ts). */
const CANAL_SALUT = [
  "el telèfon d'atenció a la conducta suïcida",
  "els 365 dies de l'any",
  "En cas d'emergència vital imminent",
] as const;
/** Nombre de la licencia, tal como la publica la Generalitat. */
const LICENCIA_OBERTA = "Llicència oberta d'ús d'informació – Catalunya";

/** Los rectos que se conservan, por archivo, con su motivo. Cualquier otro recto en un texto propio es un error. */
const EXCEPCIONES: Record<string, readonly { fragmento: string; motivo: string }[]> = {
  'src/dominio/textos-acreditacion-ca.ts': [
    {
      fragmento: "Servei Local d'Ocupació",
      motivo: 'Nombre del servicio tal como lo escribe el Ajuntament de Cornellà en la página registrada',
    },
    {
      fragmento: "l'Agencia Estatal Boletín Oficial del Estado",
      motivo: 'Fórmula de atribución que piden las condiciones de reutilización del BOE',
    },
  ],
  'src/dominio/textos-informe-ca.ts': [
    { fragmento: "a partir de dades de l'Idescat", motivo: 'Fórmula de cita que pide el Idescat' },
  ],
  'src/seguridad/avisos.ts': CANAL_SALUT.map((fragmento) => ({ fragmento, motivo: 'Palabras de Canal Salut' })),
  'web/idiomas/ca/recorrido.js': CANAL_SALUT.map((fragmento) => ({ fragmento, motivo: 'Palabras de Canal Salut' })),
  'web/idiomas/ca/creditos.js': [
    { fragmento: LICENCIA_OBERTA, motivo: 'Nombre de la licencia' },
    { fragmento: "a partir de dades de l'Idescat", motivo: 'Fórmula de cita que pide el Idescat' },
  ],
  'web/idiomas/ca/creditos-datos-globales.js': [
    { fragmento: LICENCIA_OBERTA, motivo: 'Nombre de la licencia' },
    { fragmento: "Centre d'Estudis d'Opinió", motivo: 'Nombre del organismo tal como lo escribe en sus fuentes' },
    {
      fragmento: "Oficials, operaris i artesans d'arts mecàniques i d'altres oficis",
      motivo: 'Nombre oficial del gran grupo 7 de la CCO-2011 (Idescat), igual que en datos/catalan.json',
    },
    {
      fragmento: "Operadors d'instal·lacions i de màquines i muntadors",
      motivo: 'Nombre oficial del gran grupo 8 de la CCO-2011 (Idescat), igual que en datos/catalan.json',
    },
  ],
};

/** Los archivos con textos catalanes propios que vigila la guardia. */
const ARCHIVOS = [
  'src/dominio/textos-acreditacion-ca.ts',
  'src/dominio/textos-informe-ca.ts',
  'src/comun/formato.ts',
  'src/seguridad/avisos.ts',
  'src/api/rutas/clasificar.ts',
  ...readdirSync(new URL('web/idiomas/ca/', RAIZ))
    .filter((nombre) => nombre.endsWith('.js'))
    .map((nombre) => `web/idiomas/ca/${nombre}`),
];

/** Las posiciones [inicio, fin) de cada aparición de los fragmentos en un texto. */
function tramos(texto: string, fragmentos: readonly string[]): [number, number][] {
  const resultado: [number, number][] = [];
  for (const fragmento of fragmentos) {
    for (let inicio = texto.indexOf(fragmento); inicio >= 0; inicio = texto.indexOf(fragmento, inicio + 1)) {
      resultado.push([inicio, inicio + fragmento.length]);
    }
  }
  return resultado;
}

/** Los rectos de un texto que no caen dentro de ningún fragmento admitido. */
function rectosNoAdmitidos(texto: string, fragmentos: readonly string[]): number[] {
  const admitidos = tramos(texto, fragmentos);
  return [...texto.matchAll(RECTO)]
    .map(({ index }) => index)
    .filter((posicion) => !admitidos.some(([inicio, fin]) => posicion >= inicio && posicion < fin));
}

/** Una línea de comentario: el apóstrofo del código no llega a la persona. */
function esComentario(linea: string): boolean {
  return /^\s*(\/\/|\/\*|\*)/u.test(linea);
}

test('los textos catalanes propios solo llevan apóstrofo recto en las excepciones justificadas', () => {
  const fallos: string[] = [];
  for (const archivo of ARCHIVOS) {
    const fragmentos = (EXCEPCIONES[archivo] ?? []).map(({ fragmento }) => fragmento);
    readFileSync(new URL(archivo, RAIZ), 'utf8')
      .split('\n')
      .forEach((linea, indice) => {
        if (!esComentario(linea) && rectosNoAdmitidos(linea, fragmentos).length > 0) {
          fallos.push(`${archivo}:${indice + 1}: ${linea.trim()}`);
        }
      });
  }
  assert.deepEqual(fallos, []);
});

test('cada excepción sigue existiendo en su archivo', () => {
  for (const [archivo, excepciones] of Object.entries(EXCEPCIONES)) {
    const contenido = readFileSync(new URL(archivo, RAIZ), 'utf8');
    for (const { fragmento } of excepciones) {
      assert.ok(contenido.includes(fragmento), `${archivo}: ${fragmento}`);
    }
  }
});

/** Todas las cadenas de un valor JSON. */
function cadenas(valor: unknown): string[] {
  if (typeof valor === 'string') {
    return [valor];
  }
  if (valor && typeof valor === 'object') {
    return Object.values(valor).flatMap(cadenas);
  }
  return [];
}

/** El texto de los archivos de datos oficiales, donde se buscan los rectos que la salida copia de ellos. */
function textoDeLosDatos(): string {
  return readdirSync(CARPETA_DATOS, { recursive: true, encoding: 'utf8' })
    .filter((nombre) => nombre.endsWith('.json'))
    .map((nombre) => readFileSync(new URL(nombre, CARPETA_DATOS), 'utf8'))
    .join('\n');
}

/** Pide el informe catalán de un grupo con una tarea oficial al motor del dispositivo, sin red. */
async function informeCatalan(isco08: string): Promise<unknown> {
  const api = await crearApiLocal({ datos: DATOS, motorDeCursos });
  const tareas = [
    {
      id: 'una',
      texto: `Tarea oficial ${isco08}-1`,
      tiempo: 'mucho',
      referencia: { tareaOit: `${isco08}-1`, relacion: 'propia' },
    },
  ];
  const respuesta = await api(
    new Request('https://apostrofo.test/api/informe', {
      method: 'POST',
      headers: { 'content-type': 'application/json', [CABECERA_CONTRATO]: String(CONTRATO_API) },
      body: JSON.stringify({ isco08, fecha: FECHA_DEL_INFORME, sinIa: true, tareas, idioma: 'ca' }),
    }),
  );
  assert.equal(respuesta.status, CORRECTO);
  return ((await respuesta.json()) as { informe: unknown }).informe;
}

/** Los rectos de la salida que no son una excepción ni un texto copiado de los datos oficiales. */
function rectosPropios(informe: unknown, datos: string): string[] {
  const fragmentos = Object.values(EXCEPCIONES).flatMap((lista) => lista.map(({ fragmento }) => fragmento));
  return cadenas(informe).flatMap((texto) =>
    rectosNoAdmitidos(texto, fragmentos)
      .map((posicion) => texto.slice(Math.max(0, posicion - CONTEXTO), posicion + CONTEXTO + 1))
      .filter((trozo) => !datos.includes(trozo)),
  );
}

test('el informe catalán de /api/informe escribe con ’ los textos de Faro', async (t) => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('La prueba no admite red'));
  const datos = textoDeLosDatos();
  const grupo = await informeCatalan('4110');
  const sinRelacion = await informeCatalan('7411');
  const json = JSON.stringify(grupo);
  for (const literal of [
    'L’acreditació de competències existeix per al teu grup d’ocupacions.',
    "A Cornellà t’informa el Servei Local d'Ocupació, que és punt d’informació i orientació de l’acreditació",
    'Requisits per inscriure-s’hi al nivell 2',
    'Estimació de l’OIT · amb el seu rang',
    'Notes per tasca que l’OIT publica',
    "Font: elaboració pròpia a partir de dades de l'Idescat. Noms oficials en català dels grups d’ocupació",
    'D’aquí a 6 mesos',
    "basat en dades de l'Agencia Estatal Boletín Oficial del Estado",
  ]) {
    assert.ok(json.includes(literal), literal);
  }
  assert.match(json, /a les pàgines oficials el \d{1,2} (de |d’)\p{L}+ del \d{4}; confirma’ls/u);
  assert.match(JSON.stringify(sinRelacion), /En un punt d’informació i orientació t’expliquen el procediment/u);
  assert.deepEqual(rectosPropios(grupo, datos), []);
  assert.deepEqual(rectosPropios(sinRelacion, datos), []);
});

test('el problema catalán de la selección desactivada lleva ’', async () => {
  const contexto = await contextoDelDispositivo(DATOS, { caminoAMano: false });
  const solicitud = new Request('https://apostrofo.test/api/clasificar', {
    method: 'POST',
    headers: { 'content-type': 'application/json', [CABECERA_CONTRATO]: String(CONTRATO_API) },
    body: JSON.stringify({ texto: 'recepcionista', idioma: 'ca' }),
  });
  const respuesta = await clasificar(contexto, solicitud);
  assert.equal(respuesta.status, NO_DISPONIBLE);
  const cuerpo = (await respuesta.json()) as { detail: string };
  assert.equal(cuerpo.detail, 'La selecció d’ocupació no està disponible en aquesta instal·lació.');
});

test('la moderación en catalán para con el aviso de fuera de tema con ’', async () => {
  const moderador = { moderar: () => Promise.resolve({ categorias: ['harassment/threatening'] }) };
  const { aviso } = await moderarAntesDelModelo(moderador, 'texto', 'ca');
  assert.deepEqual(aviso, {
    tipo: 'fuera-de-tema',
    texto: 'Només et puc ajudar amb la descripció de la teva feina. Explica’m quines tasques fas.',
  });
});
