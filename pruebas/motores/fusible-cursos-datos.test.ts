// El fusible del motor de cursos en sus datos y en la hoja de ruta: si falla un archivo que solo es de cursos
// (formacion.json, consorci.json, comarcas.json o temarios.json, ausente, corrupto o con la huella distinta), el
// cargador del navegador y el de Node cargan el núcleo, el recorrido responde igual y /api/cursos da
// 503 por «averiado», el breve laboral de dos hojas sale idéntico y el JSON completo declara la formación
// no disponible. El breve no depende de Cursos: sale idéntico con el motor sano, ausente, averiado o bloqueado.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as motorReal from '../../motores/cursos/src/index.ts';
import type { ResponderApi } from '../../src/api/api.ts';
import { CABECERA_CONTRATO, CONTRATO_API } from '../../src/api/metadatos-http.ts';
import type { Datos } from '../../src/dominio/tipos-paquete.ts';
import { esDeCursos, MANIFIESTO, PARTES } from '../../src/plataforma/archivos-del-paquete.ts';
import {
  crearPuertaDelMotor,
  type MotorDeCursos,
  motorDeCursos,
  type PuertaDelMotor,
  puertaConSusDatos,
} from '../../src/plataforma/motor-de-cursos.ts';
import { crearApiLocal } from '../../src/plataforma/navegador/api-local.ts';
import { cargarPaquete } from '../../src/plataforma/navegador/paquete.ts';
import { cargarDatos } from '../../src/plataforma/node/datos.ts';
import { FECHA_DEL_INFORME } from '../ayudas/fecha-del-informe.ts';

const CARPETA = fileURLToPath(new URL('../../datos/', import.meta.url));
/** Los archivos de cursos que se rompen, con su parte de los datos. */
const ARCHIVOS_DE_CURSOS = {
  // La formación oficial: la búsqueda de ocupaciones no la lee (su correspondencia EURES va en correspondencia-eures.json).
  'formacion.json': 'formacion',
  'consorci.json': 'consorci',
  'comarcas.json': 'comarcas',
  'temarios.json': 'temarios',
} as const;
type ArchivoDeCursos = keyof typeof ARCHIVOS_DE_CURSOS;
const CONSORCI: ArchivoDeCursos = 'consorci.json';
const ORIGEN = 'https://fusible.test';
const BASE_DEL_PAQUETE = new URL('https://paquete.test/paquete/0123456789abcdef/');
const CORRECTO = 200;
const NO_DISPONIBLE = 503;
const HOJAS_DEL_BREVE = 2;
/** El límite de la carga colgada del motor, para que la prueba no espere los 10 s de la app. */
const LIMITE_CORTO_MS = 50;
const ENTRADA = {
  isco08: '7512',
  fecha: FECHA_DEL_INFORME,
  sinIa: true,
  tareas: [
    {
      id: 'uno',
      texto: 'Tarea oficial 7512-1',
      tiempo: 'algo',
      referencia: { tareaOit: '7512-1', relacion: 'propia' },
    },
  ],
};
const PASOS_DEL_RECORRIDO: readonly [string, unknown?][] = [
  ['/api/clasificar', { texto: 'recepcionista' }],
  ['/api/ocupaciones?q=recepcionista'],
  ['/api/ocupaciones/4226.1.1'],
  ['/api/grupos'],
];

const fetchOriginal = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = fetchOriginal;
});

function huella(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

const MANIFIESTO_OFICIAL = JSON.parse(readFileSync(join(CARPETA, MANIFIESTO), 'utf8')) as Record<
  string,
  { sha256: string }
>;
const BYTES_CONSORCI = readFileSync(join(CARPETA, CONSORCI));

/** Cómo se rompe un archivo de cursos: cuál, qué bytes tiene (null: no está) y qué manifiesto lo acompaña. */
interface Averia {
  readonly archivo: ArchivoDeCursos;
  readonly bytes: Uint8Array | null;
  readonly manifiesto: Record<string, unknown>;
}

const AVERIAS: Readonly<Record<'ausente' | 'corrupto' | 'huella distinta', (archivo: ArchivoDeCursos) => Averia>> = {
  ausente: (archivo) => ({ archivo, bytes: null, manifiesto: MANIFIESTO_OFICIAL }),
  // Con su huella al día, para que el fallo sea el del JSON y no el de la huella.
  corrupto: (archivo) => {
    const bytes = new TextEncoder().encode('{');
    return { archivo, bytes, manifiesto: { ...MANIFIESTO_OFICIAL, [archivo]: { sha256: huella(bytes) } } };
  },
  'huella distinta': (archivo) => ({
    archivo,
    bytes: Buffer.concat([readFileSync(join(CARPETA, archivo)), Buffer.from(' ')]),
    manifiesto: MANIFIESTO_OFICIAL,
  }),
};

/** El paquete oficial en una carpeta temporal, con el archivo y el manifiesto de la avería (los demás, enlazados). */
function conPaqueteAveriado<T>(averia: Averia, usar: (carpeta: string) => T): T {
  const carpeta = mkdtempSync(join(tmpdir(), 'fusible-cursos-datos-'));
  try {
    for (const nombre of readdirSync(CARPETA)) {
      if (nombre !== averia.archivo && nombre !== MANIFIESTO) {
        symlinkSync(join(CARPETA, nombre), join(carpeta, nombre));
      }
    }
    writeFileSync(join(carpeta, MANIFIESTO), JSON.stringify(averia.manifiesto));
    if (averia.bytes) {
      writeFileSync(join(carpeta, averia.archivo), averia.bytes);
    }
    return usar(carpeta);
  } finally {
    rmSync(carpeta, { recursive: true });
  }
}

/** Sirve el paquete oficial al cargador del navegador, con el archivo y el manifiesto de la avería, sin red. */
function servirAveriado(averia: Averia | null): void {
  const manifiesto = new TextEncoder().encode(JSON.stringify(averia ? averia.manifiesto : MANIFIESTO_OFICIAL));
  globalThis.fetch = async (recurso) => {
    const url = new URL(recurso instanceof Request ? recurso.url : String(recurso));
    const archivo = url.pathname.slice(BASE_DEL_PAQUETE.pathname.length);
    if (archivo === MANIFIESTO) {
      return new Response(manifiesto);
    }
    if (averia && archivo === averia.archivo) {
      return averia.bytes ? new Response(averia.bytes) : new Response(null, { status: 404 });
    }
    return new Response(readFileSync(join(CARPETA, archivo)));
  };
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

async function leida(respuesta: Response): Promise<{ estado: number; cuerpo: unknown }> {
  return { estado: respuesta.status, cuerpo: await respuesta.json() };
}

/** La API del motor del dispositivo, la que atiende el recorrido y el informe, con la puerta de cursos dada o la de la app. */
function crearLaApi(datos: Datos, opciones: { motorDeCursos?: PuertaDelMotor } = {}): Promise<ResponderApi> {
  return crearApiLocal({ datos, motorDeCursos: opciones.motorDeCursos ?? motorDeCursos });
}

/** El informe breve que responde la API, con sus hojas. */
async function breveDe(api: ResponderApi, idioma: 'es' | 'ca') {
  const respuesta = await pedir(api, '/api/informe?formato=breve', { ...ENTRADA, idioma });
  const cuerpo = (await respuesta.json()) as { informe: Record<string, unknown>; breve: unknown; html: string };
  const hojas = cuerpo.html.split('<section class="hoja ');
  return { estado: respuesta.status, ...cuerpo, antes: hojas[0], hojas: hojas.slice(1) };
}

/**
 * El breve que debe salir sin un archivo de cursos: el mismo que con todo. Sin formacion.json, además, el catálogo de
 * aprendizaje del informe no sabe la fecha de la copia de los cursos del SOC, que es un dato de ese archivo
 * (`fecha_cursos`): esa fecha, y solo ella, pasa a null. Las hojas y el resumen del breve no la enseñan.
 */
function breveEsperado(conTodo: Awaited<ReturnType<typeof breveDe>>, archivo: ArchivoDeCursos) {
  if (archivo !== 'formacion.json') {
    return conTodo;
  }
  const aprendizaje = conTodo.informe.aprendizaje as Record<string, unknown>;
  assert.equal(typeof aprendizaje.fechaCursos, 'string', 'con todo, el catálogo lleva la fecha de los cursos');
  return { ...conTodo, informe: { ...conTodo.informe, aprendizaje: { ...aprendizaje, fechaCursos: null } } };
}

/** Lo que tiene que dar la API con unos datos sin un archivo de cursos: el recorrido igual, cursos averiado y su diagnóstico en el JSON completo. */
async function comprobarSinDatosDeCursos(
  datos: Datos,
  referencia: Datos,
  archivo: ArchivoDeCursos,
  que: string,
): Promise<void> {
  assert.deepEqual(
    Object.keys(datos),
    Object.keys(referencia).filter((parte) => parte !== ARCHIVOS_DE_CURSOS[archivo]),
    `${que}: el núcleo y las demás partes cargan`,
  );
  const estado = await puertaConSusDatos(crearPuertaDelMotor(), datos).cargar();
  assert.equal(estado.disponible === false && estado.motivo, 'averiado', que);
  assert.ok(estado.disponible === false && estado.detalle.includes(archivo), que);

  const conTodo = await crearLaApi(referencia);
  const sinCursos = await crearLaApi(datos);
  for (const [ruta, cuerpo] of PASOS_DEL_RECORRIDO) {
    const esperada = await leida(await pedir(conTodo, ruta, cuerpo));
    assert.equal(esperada.estado, CORRECTO, `${que}: ${ruta}`);
    assert.deepEqual(await leida(await pedir(sinCursos, ruta, cuerpo)), esperada, `${que}: ${ruta}`);
  }
  for (const [ruta, cuerpo] of [['/api/cursos', undefined]] as const) {
    const sinMotor = await leida(await pedir(sinCursos, ruta, cuerpo));
    assert.equal(sinMotor.estado, NO_DISPONIBLE, `${que}: ${ruta}`);
    assert.equal((sinMotor.cuerpo as Record<string, unknown>).motivo, 'averiado', `${que}: ${ruta}`);
  }

  for (const idioma of ['es', 'ca'] as const) {
    const esperado = await breveDe(conTodo, idioma);
    const obtenido = await breveDe(sinCursos, idioma);
    assert.equal(obtenido.estado, CORRECTO, `${que} ${idioma}`);
    assert.equal(obtenido.hojas.length, HOJAS_DEL_BREVE, `${que} ${idioma}`);
    assert.deepEqual(obtenido, breveEsperado(esperado, archivo), `${que} ${idioma}: el breve, idéntico`);
    assert.equal(obtenido.html, esperado.html, `${que} ${idioma}: las hojas del breve, idénticas`);
    const completo = await pedir(sinCursos, '/api/informe?formato=html', { ...ENTRADA, idioma });
    const cuerpo = (await completo.json()) as { informe: Record<string, unknown>; html: string };
    assert.equal(completo.status, CORRECTO, `${que} ${idioma}: el completo`);
    assert.equal(cuerpo.html.split('<section class="hoja ').length - 1, HOJAS_DEL_BREVE);
    assert.ok(!cuerpo.html.includes('id="descargar"'));
    assert.equal(cuerpo.informe.formacionNoDisponible, true, `${que} ${idioma}`);
  }
}

for (const archivo of Object.keys(ARCHIVOS_DE_CURSOS) as ArchivoDeCursos[]) {
  test(`Node: con ${archivo} ausente, corrupto o con la huella distinta, el núcleo carga, el breve sale igual y el JSON completo declara la formación no disponible`, async (t) => {
    t.mock.method(console, 'warn', () => {});
    const referencia = cargarDatos(CARPETA);
    for (const [que, averia] of Object.entries(AVERIAS)) {
      const datos = conPaqueteAveriado(averia(archivo), cargarDatos);
      await comprobarSinDatosDeCursos(datos, referencia, archivo, `Node, ${archivo} ${que}`);
    }
  });

  test(`navegador: con ${archivo} ausente, corrupto o con la huella distinta, el núcleo carga, el breve sale igual y el JSON completo declara la formación no disponible`, async (t) => {
    t.mock.method(console, 'warn', () => {});
    servirAveriado(null);
    const { datos: referencia } = await cargarPaquete(BASE_DEL_PAQUETE);
    for (const [que, averia] of Object.entries(AVERIAS)) {
      servirAveriado(averia(archivo));
      const { datos } = await cargarPaquete(BASE_DEL_PAQUETE);
      globalThis.fetch = fetchOriginal;
      await comprobarSinDatosDeCursos(datos, referencia, archivo, `navegador, ${archivo} ${que}`);
    }
  });
}

test('un archivo del núcleo que falla sigue tumbando la carga, en Node y en el navegador', async () => {
  const roto = { ...MANIFIESTO_OFICIAL, 'esco.json': { sha256: huella(new TextEncoder().encode('otro esco')) } };
  assert.throws(
    () => conPaqueteAveriado({ archivo: CONSORCI, bytes: BYTES_CONSORCI, manifiesto: roto }, cargarDatos),
    /esco\.json no coincide con su huella/u,
  );
  servirAveriado({ archivo: CONSORCI, bytes: BYTES_CONSORCI, manifiesto: roto });
  await assert.rejects(cargarPaquete(BASE_DEL_PAQUETE), /esco\.json no coincide con su huella/u);
});

test('las partes de cursos son las que solo lee el motor de cursos', () => {
  assert.deepEqual(PARTES.filter(esDeCursos), [
    'formacion',
    'consorci',
    'enlaces',
    'citilab',
    'formacionAbierta',
    'fundae',
    'comarcas',
    'temarios',
    'vectoresFormacion',
    'actic',
  ]);
});

test('el breve no depende de Cursos: dos hojas, idéntico con el motor sano, ausente, averiado o bloqueado', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const datos = cargarDatos(CARPETA);
  const conTodo = await crearLaApi(datos);
  const lanza = () => {
    throw new Error('fallo de prueba del motor');
  };
  const puertas = {
    ausente: crearPuertaDelMotor<MotorDeCursos>({
      importar: () => Promise.reject(Object.assign(new Error('Cannot find module'), { code: 'ERR_MODULE_NOT_FOUND' })),
    }),
    averiado: crearPuertaDelMotor<MotorDeCursos>({
      importar: async () => ({ ...motorReal, formacionDelInforme: lanza }),
    }),
    bloqueado: crearPuertaDelMotor<MotorDeCursos>({
      importar: () => new Promise<never>(() => {}),
      limiteCargaMs: LIMITE_CORTO_MS,
    }),
  };
  for (const idioma of ['es', 'ca'] as const) {
    const esperado = await breveDe(conTodo, idioma);
    assert.equal(esperado.estado, CORRECTO);
    assert.equal(esperado.hojas.length, HOJAS_DEL_BREVE, 'dos hojas');
    const hoja = idioma === 'es' ? 'Hoja' : 'Full';
    assert.ok(esperado.html.includes(`${hoja} 1 de 2`));
    assert.ok(esperado.html.includes(`${hoja} 2 de 2`));
    assert.ok(
      !esperado.html.includes(idioma === 'es' ? 'Tu formación' : 'La teva formació'),
      'sin la hoja de formación',
    );
    for (const [que, puerta] of Object.entries(puertas)) {
      const sinMotor = await crearLaApi(datos, { motorDeCursos: puerta });
      assert.deepEqual(await breveDe(sinMotor, idioma), esperado, `${que} ${idioma}: idéntico`);
      // El JSON completo sí depende de Cursos y conserva la marca de indisponibilidad.
      const completo = await pedir(sinMotor, '/api/informe?formato=html', { ...ENTRADA, idioma });
      const cuerpo = (await completo.json()) as {
        informe: { formacion: unknown; formacionNoDisponible?: boolean };
        html: string;
      };
      assert.equal(cuerpo.informe.formacionNoDisponible, true, que);
      assert.equal(cuerpo.informe.formacion, null, que);
      assert.equal(cuerpo.html.split('<section class="hoja ').length - 1, HOJAS_DEL_BREVE, que);
    }
  }
});
