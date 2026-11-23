import { administracionDeAgentes } from '../ayudas/socios-api.ts';
// El fusible entre el motor de ocupaciones y el motor de cursos: si el motor de cursos falla, se queda colgado o no
// está, la API arranca y el recorrido responde igual. Cuatro garantías: ningún import estático de valor lleva de la API,
// del motor del navegador, del recorrido o del informe (dominio/informe.ts) a motores/cursos/ (la única arista es el
// import() de la puerta, src/plataforma/motor-de-cursos.ts), sin excepciones; la puerta da «ausente», «averiado» o
// «bloqueado» sin quedarse colgada; con el motor ausente, averiado o bloqueado, la API responde al recorrido lo mismo
// que con él, /api/cursos da 503 y, en el motor del dispositivo, el informe breve (dos hojas, sin formación) sale
// idéntico y el completo, entero con el aviso de formación no disponible en el JSON completo; y
// en MCP y A2A, la consulta de formación dice que no está disponible y las demás responden igual.

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as motorReal from '../../motores/cursos/src/index.ts';
import { crearApi, type ResponderApi } from '../../src/api/api.ts';
import { CABECERA_CONTRATO, CONTRATO_API } from '../../src/api/metadatos-http.ts';
import { RAIZ_DE_LOS_PROBLEMAS } from '../../src/comun/protocolo-web.ts';
import { TEXTOS_INFORME_ES } from '../../src/dominio/textos-informe.ts';
import { TEXTOS_INFORME_CA } from '../../src/dominio/textos-informe-ca.ts';
import {
  crearPuertaDelMotor,
  type MotorDeCursos,
  motorDeCursos,
  type PuertaDelMotor,
} from '../../src/plataforma/motor-de-cursos.ts';
import { crearApiLocal } from '../../src/plataforma/navegador/api-local.ts';
import { cargarDatos } from '../../src/plataforma/node/datos.ts';
import { FECHA_DEL_INFORME } from '../ayudas/fecha-del-informe.ts';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
const PUERTA = 'src/plataforma/motor-de-cursos.ts';
const ENTRADA_DEL_MOTOR = 'motores/cursos/src/index.ts';
const RAICES = [
  'src/api/api.ts',
  'src/plataforma/navegador/motor.ts',
  'motores/ocupaciones/src',
  'src/dominio/informe.ts',
];

/** Un import o export estático con `from`, o un import solo por sus efectos. */
const ESTATICO =
  /^[ \t]*(?:import|export)\s+(type\s+)?([^;'"]*?)\s*from\s*['"]([^'"]+)['"]|^[ \t]*import\s*['"]([^'"]+)['"]/gmu;
/** Un import() dinámico con una ruta literal que no es un tipo (`typeof import('…')`). */
const DINAMICO = /(?<!typeof\s*)\bimport\(\s*['"]([^'"]+)['"]\s*\)/gu;
/** Cualquier ruta importada, también de tipos. */
const CUALQUIERA = /\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(?\s*['"]([^'"]+)['"]/gu;

const relativa = (archivo: string): string => relative(RAIZ, archivo).split('\\').join('/');

/** Las rutas de los imports estáticos de valor de un texto: sin `import type` ni los que solo traen tipos. */
function importsDeValor(texto: string): string[] {
  const rutas: string[] = [];
  for (const [, deTipo, clausula = '', ruta, soloEfectos] of texto.matchAll(ESTATICO)) {
    if (soloEfectos) {
      rutas.push(soloEfectos);
      continue;
    }
    const llaves = /^\{([\s\S]*)\}$/u.exec(clausula.trim());
    const nombres = llaves?.[1]
      ?.split(',')
      .map((nombre) => nombre.trim())
      .filter(Boolean);
    const soloTipos = deTipo !== undefined || (nombres?.every((n) => n.startsWith('type ')) ?? false);
    if (!soloTipos && ruta) {
      rutas.push(ruta);
    }
  }
  return rutas;
}

/** La ruta absoluta de un import relativo a un archivo de código, o null si no es uno del repositorio. */
function resolver(desde: string, ruta: string): string | null {
  if (!ruta.startsWith('.')) {
    return null;
  }
  const destino = resolve(dirname(desde), ruta);
  return existsSync(destino) && /\.(?:ts|js)$/u.test(destino) ? destino : null;
}

/** Los archivos .ts y .js de una carpeta o el archivo dado, en absoluto. */
function archivosDe(ruta: string): string[] {
  const absoluta = join(RAIZ, ruta);
  if (/\.(?:ts|js)$/u.test(absoluta)) {
    return [absoluta];
  }
  return (readdirSync(absoluta, { recursive: true }) as string[])
    .filter((archivo) => /\.(?:ts|js)$/u.test(archivo))
    .map((archivo) => join(absoluta, archivo));
}

/** El grafo de imports estáticos de valor desde unas raíces: cada archivo alcanzado y quién lo trajo. */
function grafoDeValor(raices: readonly string[]) {
  const padre = new Map<string, string | null>();
  const cola = raices.flatMap(archivosDe);
  for (const archivo of cola) {
    padre.set(archivo, null);
  }
  while (cola.length > 0) {
    const archivo = cola.shift() as string;
    for (const ruta of importsDeValor(readFileSync(archivo, 'utf8'))) {
      const destino = resolver(archivo, ruta);
      if (destino && !padre.has(destino)) {
        padre.set(destino, archivo);
        cola.push(destino);
      }
    }
  }
  return padre;
}

/** La cadena de imports por la que se llega a un archivo, para el mensaje de la prueba. */
function cadena(padre: Map<string, string | null>, archivo: string): string {
  const pasos: string[] = [];
  for (let actual: string | null | undefined = archivo; actual; actual = padre.get(actual)) {
    pasos.unshift(relativa(actual));
  }
  return pasos.join(' → ');
}

/** Si desde un archivo se llega a motores/ por imports estáticos de valor. */
function llegaAlMotor(archivo: string): boolean {
  return [...grafoDeValor([relativa(archivo)]).keys()].some((alcanzado) =>
    relativa(alcanzado).startsWith('motores/cursos/'),
  );
}

test('ningún import estático de valor lleva de la API, el motor del navegador, el recorrido o el informe al motor de cursos', () => {
  const padre = grafoDeValor(RAICES);
  const alMotor = [...padre.keys()].filter((archivo) => relativa(archivo).startsWith('motores/cursos/'));
  assert.deepEqual(
    alMotor.map((archivo) => cadena(padre, archivo)),
    [],
  );
  assert.ok(padre.has(join(RAIZ, PUERTA)), 'la API llega a la puerta del motor');
  for (const estatico of ['src/dominio/informe.ts', 'src/presentacion/informe-breve.ts']) {
    assert.ok(padre.has(join(RAIZ, estatico)), `la API carga ${estatico} de forma estática`);
  }
});

test('el único import() que lleva al motor de cursos es el de la puerta', () => {
  const padre = grafoDeValor(RAICES);
  const conMotor: string[] = [];
  for (const archivo of padre.keys()) {
    for (const [, ruta = ''] of readFileSync(archivo, 'utf8').matchAll(DINAMICO)) {
      const destino = resolver(archivo, ruta);
      if (destino && llegaAlMotor(destino)) {
        conMotor.push(`${relativa(archivo)} → ${relativa(destino)}`);
      }
    }
  }
  assert.ok(conMotor.length > 0);
  assert.deepEqual(
    conMotor.filter((arista) => !arista.startsWith(`${PUERTA} → `)),
    [],
  );
  assert.ok(conMotor.includes(`${PUERTA} → ${ENTRADA_DEL_MOTOR}`), 'la puerta carga la entrada pública del motor');
});

test('compartido/ no importa nada de motores/ ni de src/, ni siquiera tipos', () => {
  const prohibidos: string[] = [];
  for (const archivo of archivosDe('compartido')) {
    for (const [, de, dinamico] of readFileSync(archivo, 'utf8').matchAll(CUALQUIERA)) {
      const destino = resolver(archivo, de ?? dinamico ?? '');
      if (destino && /^(?:motores|src)\//u.test(relativa(destino))) {
        prohibidos.push(`${relativa(archivo)} → ${relativa(destino)}`);
      }
    }
  }
  assert.deepEqual(prohibidos, []);
});

/** Un motor de mentira: tiene las funciones y las listas que pide la puerta, y todas las funciones lanzan. */
function motorQueLanza(): MotorDeCursos {
  const roto = () => {
    throw new Error('fallo de prueba del motor');
  };
  return {
    catalogoDeCursos: roto,
    formacionDeLaOcupacion: roto,
    formacionDelInforme: roto,
    FUENTES_DE_CURSOS: motorReal.FUENTES_DE_CURSOS,
    OPCIONES_DE_CURSOS: motorReal.OPCIONES_DE_CURSOS,
  } as unknown as MotorDeCursos;
}

/** El error de un módulo que no se encuentra, como lo da Node. */
function noEncontrado(): Promise<never> {
  return Promise.reject(
    Object.assign(new Error("Cannot find module 'motores/cursos/src/index.ts'"), { code: 'ERR_MODULE_NOT_FOUND' }),
  );
}

const LIMITE_CORTO_MS = 50;
const SIN_COLGARSE_MS = 2000;

test('puerta: ausente, averiado y bloqueado dan su resultado y ninguno se queda colgado', async () => {
  const empieza = Date.now();
  const ausente = crearPuertaDelMotor({ importar: noEncontrado });
  assert.deepEqual(await ausente.cargar(), {
    disponible: false,
    motivo: 'ausente',
    detalle: "Error: Cannot find module 'motores/cursos/src/index.ts'",
  });
  assert.equal((await ausente.ejecutar(() => 1)).disponible, false);

  const inexistente = '../../motores/no-existe/src/index.ts';
  const deVerdadAusente = crearPuertaDelMotor<MotorDeCursos>({ importar: () => import(inexistente) });
  const estado = await deVerdadAusente.cargar();
  assert.equal(estado.disponible === false && estado.motivo, 'ausente');

  const roto = crearPuertaDelMotor({ importar: async () => motorQueLanza() });
  assert.equal((await roto.cargar()).disponible, true);
  const resultado = await roto.ejecutar((motor) =>
    motor.catalogoDeCursos(DATOS, { hoy: '2026-10-07', oferta: motorReal.OFERTA_POR_DEFECTO }),
  );
  assert.deepEqual(resultado, { disponible: false, motivo: 'averiado', detalle: 'Error: fallo de prueba del motor' });

  const alCargar = crearPuertaDelMotor({ importar: () => Promise.reject(new SyntaxError('el motor no se evalúa')) });
  const alCargarse = await alCargar.cargar();
  assert.equal(alCargarse.disponible === false && alCargarse.motivo, 'averiado');

  const incompleto = crearPuertaDelMotor({ importar: async () => ({}) as MotorDeCursos });
  const sinFunciones = await incompleto.cargar();
  assert.equal(sinFunciones.disponible === false && sinFunciones.motivo, 'averiado');

  // Con las funciones pero sin las listas de los filtros, /api/cursos no podría leer sus filtros: también averiado.
  const { OPCIONES_DE_CURSOS: _opciones, ...sinListas } = motorReal;
  const aMedias = crearPuertaDelMotor({ importar: async () => sinListas as unknown as MotorDeCursos });
  const sinOpciones = await aMedias.cargar();
  assert.equal(sinOpciones.disponible === false && sinOpciones.motivo, 'averiado');
  assert.match(sinOpciones.disponible === false ? sinOpciones.detalle : '', /OPCIONES_DE_CURSOS/u);

  const colgado = crearPuertaDelMotor({ importar: () => new Promise<never>(() => {}), limiteCargaMs: LIMITE_CORTO_MS });
  const primera = await colgado.cargar();
  assert.equal(primera.disponible === false && primera.motivo, 'bloqueado');
  assert.equal((await colgado.ejecutar(() => 1)).disponible, false, 'la segunda espera también tiene su límite');

  const lenta = crearPuertaDelMotor({ importar: async () => motorQueLanza(), limiteOperacionMs: LIMITE_CORTO_MS });
  const operacion = await lenta.ejecutar(() => new Promise<never>(() => {}));
  assert.equal(operacion.disponible === false && operacion.motivo, 'bloqueado');

  assert.ok(Date.now() - empieza < SIN_COLGARSE_MS, 'ninguna puerta se queda colgada');
});

test('puerta: con el motor real, lo carga una vez y lo guarda', async () => {
  const puerta = crearPuertaDelMotor();
  const primera = await puerta.cargar();
  const segunda = await puerta.cargar();
  assert.ok(primera.disponible && segunda.disponible);
  assert.equal(primera.motor, segunda.motor);
  assert.equal(typeof primera.motor.catalogoDeCursos, 'function');
});

const ORIGEN = 'https://fusible.test';
const CORRECTO = 200;
const NO_DISPONIBLE = 503;
const DATOS = cargarDatos(fileURLToPath(new URL('../../datos/', import.meta.url)));

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

/** Las tres formas de no tener el motor: no está, se rompe al usarlo o no responde a tiempo. */
const SIN_MOTOR = {
  ausente: () => crearPuertaDelMotor({ importar: noEncontrado }),
  // Con los datos del motor de verdad (sus listas de opciones) y todas sus funciones rotas.
  averiado: () => crearPuertaDelMotor({ importar: async () => ({ ...motorReal, ...motorQueLanza() }) }),
  bloqueado: () =>
    crearPuertaDelMotor({ importar: () => new Promise<never>(() => {}), limiteCargaMs: LIMITE_CORTO_MS }),
} as const;

const HOY = '2026-10-07';
const BASE = {
  datos: DATOS,
  origenesPermitidos: [],
  administracion: administracionDeAgentes().opciones,
  agentes: { mcp: { hoy: () => HOY, limitador: () => true }, a2a: { hoy: () => HOY, limitador: () => true } },
} as const;
/**
 * Las dos API, con la puerta de cursos dada o la de la app: la del servidor y la del motor del dispositivo, la única que
 * atiende la clasificación y el informe.
 */
const APIS = {
  servidor: (puerta?: PuertaDelMotor) => crearApi(puerta ? { ...BASE, motorDeCursos: puerta } : BASE),
  dispositivo: (puerta?: PuertaDelMotor) => crearApiLocal({ datos: DATOS, motorDeCursos: puerta ?? motorDeCursos }),
} as const;
const LECTURAS_DEL_RECORRIDO: readonly [string][] = [
  ['/api/ocupaciones?q=recepcionista'],
  ['/api/ocupaciones/4226.1.1'],
  ['/api/grupos'],
];
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
/** Las dos hojas laborales del informe, independientes de la formación. */
const HOJAS_DEL_BREVE = 2;
/** El aviso de que la versión no trae datos de formación: no corresponde a un breve, que no la pide. */
const SIN_FORMACION = { es: TEXTOS_INFORME_ES.avisos.sinFormacion, ca: TEXTOS_INFORME_CA.avisos.sinFormacion };

/** Las hojas del informe breve, en su orden. */
function hojasDelBreve(html: string): string[] {
  return html.split('<section class="hoja ').slice(1);
}

/** Lo que responde /api/informe en el motor del dispositivo, con su HTML. */
async function informeDe(api: ResponderApi, formato: string, idioma: 'es' | 'ca') {
  const respuesta = await pedir(api, `/api/informe?formato=${formato}`, { ...ENTRADA, idioma });
  const cuerpo = (await respuesta.json()) as { informe: Record<string, unknown>; html: string };
  return { estado: respuesta.status, ...cuerpo };
}

test('API: con el motor de cursos ausente, averiado o bloqueado, el recorrido responde igual y /api/cursos da 503', async (t) => {
  t.mock.method(console, 'warn', () => {});
  for (const [donde, crear] of Object.entries(APIS)) {
    const conMotor = await crear();
    const pasos: readonly [string, unknown?][] =
      donde === 'dispositivo'
        ? [['/api/clasificar', { texto: 'recepcionista' }], ...LECTURAS_DEL_RECORRIDO]
        : LECTURAS_DEL_RECORRIDO;
    for (const [motivo, puerta] of Object.entries(SIN_MOTOR)) {
      const sinMotor = await crear(puerta());
      for (const [ruta, cuerpo] of pasos) {
        const esperada = await leida(await pedir(conMotor, ruta, cuerpo));
        assert.equal(esperada.estado, CORRECTO, `${donde}: ${ruta}`);
        assert.deepEqual(await leida(await pedir(sinMotor, ruta, cuerpo)), esperada, `${donde}, ${motivo}: ${ruta}`);
      }
      const cursos = await pedir(sinMotor, '/api/cursos');
      assert.equal(cursos.status, NO_DISPONIBLE, `${donde}, ${motivo}`);
      assert.ok(cursos.headers.get('retry-after'));
      const problema = (await cursos.json()) as Record<string, unknown>;
      assert.equal(problema.type, `${RAIZ_DE_LOS_PROBLEMAS}motor_de_cursos_no_disponible`);
      assert.equal(problema.motivo, motivo);
      assert.match(String(problema.detail), /^La sección «Cursos» no está disponible ahora mismo\./u);
    }
    assert.equal((await pedir(conMotor, '/api/cursos')).status, CORRECTO, donde);
  }
});

test('informe breve sin motor: 200, dos hojas e idéntico al de con motor: el breve no depende de Cursos', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const conMotor = await APIS.dispositivo();
  for (const idioma of ['es', 'ca'] as const) {
    const esperado = await informeDe(conMotor, 'breve', idioma);
    assert.equal(esperado.estado, CORRECTO);
    assert.equal(hojasDelBreve(esperado.html).length, HOJAS_DEL_BREVE, 'dos hojas');
    assert.equal(esperado.informe.formacionNoDisponible, true, 'el breve no pide la formación al motor');
    assert.ok(!(esperado.informe.avisos as string[]).includes(SIN_FORMACION[idioma]), 'sin aviso de formación');
    for (const [motivo, puerta] of Object.entries(SIN_MOTOR)) {
      const sinMotor = await APIS.dispositivo(puerta());
      assert.deepEqual(await informeDe(sinMotor, 'breve', idioma), esperado, `${motivo}: idéntico`);
    }
  }
});

test('informe HTML sin motor: dos hojas iguales y JSON completo con formación no disponible', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const conMotor = await APIS.dispositivo();
  // La marca estructurada refleja la formación disponible; el contenido laboral visible permanece idéntico.
  const sinMarca = (html: string) => html.replace(/ data-marca-ia="[^"]*"/u, '');
  for (const idioma of ['es', 'ca'] as const) {
    const esperado = await informeDe(conMotor, 'html', idioma);
    assert.equal(esperado.estado, CORRECTO);
    assert.equal(hojasDelBreve(esperado.html).length, HOJAS_DEL_BREVE);
    for (const [motivo, puerta] of Object.entries(SIN_MOTOR)) {
      const sinMotor = await APIS.dispositivo(puerta());
      const obtenido = await informeDe(sinMotor, 'html', idioma);
      assert.equal(obtenido.estado, CORRECTO, motivo);
      assert.equal(hojasDelBreve(obtenido.html).length, HOJAS_DEL_BREVE, motivo);
      assert.equal(sinMarca(obtenido.html), sinMarca(esperado.html), `${motivo}: contenido laboral idéntico`);
      assert.equal(obtenido.informe.formacionNoDisponible, true, motivo);
      assert.ok(obtenido.html.includes('data-marca-ia="'), `${motivo}: conserva procedencia`);
      assert.equal(obtenido.informe.formacion, null, `${motivo}: formación ausente explícita`);
      for (const campo of ['ocupacion', 'tareas', 'semana', 'hallazgos', 'contexto', 'caminos', 'usoDeclaradoIa']) {
        assert.deepEqual(obtenido.informe[campo], esperado.informe[campo], `${motivo}: ${campo}`);
      }
    }
  }
});

/** El resultado de una herramienta por MCP o A2A. */
async function herramienta(api: ResponderApi, canal: 'mcp' | 'a2a', nombre: string, argumentos: unknown) {
  if (canal === 'mcp') {
    const cuerpo = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: nombre, arguments: argumentos } };
    const respuesta = (await (await pedir(api, '/mcp', cuerpo)).json()) as { result: { structuredContent: unknown } };
    return respuesta.result.structuredContent as Record<string, unknown>;
  }
  const parts = [{ data: { skill: nombre, arguments: argumentos } }];
  const mensaje = { role: 'ROLE_USER', messageId: 'local', contextId: 'contexto-local', parts };
  const peticion = new Request(`${ORIGEN}/a2a`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'a2a-version': '1.0' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'SendMessage', params: { message: mensaje } }),
  });
  const respuesta = (await (await api(peticion)).json()) as { result: { message: { parts: { data: unknown }[] } } };
  return respuesta.result.message.parts[0]?.data as Record<string, unknown>;
}

test('MCP y A2A sin motor: la formación oficial dice que no está disponible y las demás consultas responden igual', async () => {
  const conMotor = await crearApi(BASE);
  const otras: readonly [string, unknown][] = [
    ['ficha_grupo', { isco: '4224' }],
    ['acreditacion_competencias', { isco: '4224' }],
    ['contexto_del_grupo', { isco: '4224' }],
  ];
  for (const canal of ['mcp', 'a2a'] as const) {
    const formacion = await herramienta(conMotor, canal, 'formacion_oficial', { isco: '4224' });
    assert.ok(formacion.especialidades, `${canal}: con el motor, hay formación`);
    for (const [motivo, puerta] of Object.entries(SIN_MOTOR)) {
      const sinMotor = await crearApi({ ...BASE, motorDeCursos: puerta() });
      const sin = await herramienta(sinMotor, canal, 'formacion_oficial', { isco: '4224' });
      assert.equal(sin.formacion, null, `${canal} ${motivo}`);
      assert.match(String(sin.aviso), new RegExp(`no está disponible.*\\(${motivo}\\)\\.$`, 'u'));
      for (const [nombre, argumentos] of otras) {
        assert.deepEqual(
          await herramienta(sinMotor, canal, nombre, argumentos),
          await herramienta(conMotor, canal, nombre, argumentos),
          `${canal} ${motivo}: ${nombre}`,
        );
      }
    }
  }
});
