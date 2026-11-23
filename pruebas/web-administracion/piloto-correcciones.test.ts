import './idiomas.ts';
import assert from 'node:assert/strict';
import { type TestContext, test } from 'node:test';
import { PREGUNTAS, resumenDe, type TipoDeCodigo } from '../../src/encuesta/cuestionario.ts';
import { descargar, PLAZO_DESCARGA_MS } from '../../web/administracion/archivos-piloto.js';
import { crearClientePanel, type EstadoClientePanel } from '../../web/administracion/cliente.js';
import { leerResultadosEncuesta, nombreDeEntidadValido } from '../../web/administracion/cliente-encuesta.js';
import { MAX_RESPUESTA_PANEL_BYTES } from '../../web/administracion/limites-respuesta.js';
import { Campo } from './panel-dom-comun.ts';
import { enRonda, rondaAnterior } from './ronda-encuesta.ts';

const LONGITUD_TOKEN = 43;
const INICIO = 1_000_000;
const INACTIVIDAD = 900_000;
const ABSOLUTA = 28_800_000;
const sesion = {
  estado: 'activa',
  iniciadaEn: INICIO,
  ultimaActividadEn: INICIO,
  caducaPorInactividadEn: INICIO + INACTIVIDAD,
  caducaAbsolutaEn: INICIO + ABSOLUTA,
};
const controles = { version: 2, revision: 1, api: 'deshabilitada', mcp: false, a2a: false };
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const BASE = CROCKFORD.length;
const MAXIMO_LOTE = 200;
const MAXIMO_LOTES = 50;
const MAXIMO_RONDAS = 20;
const MAXIMO_NOMBRE = 60;
const GRUPOS_FIJOS = 6;
/** Un código distinto por índice, con el formato del servidor. */
const codigo = (i: number) =>
  `PART${'-0000'.repeat(GRUPOS_FIJOS)}-00${CROCKFORD[Math.floor(i / BASE)]}${CROCKFORD[i % BASE]}`;
const CIFRAS_UUID = 8;
const uuid = (i: number) => `${String(i).padStart(CIFRAS_UUID, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
// El peor caso de nombre: 60 caracteres de cuatro bytes en UTF-8.
const NOMBRE_LARGO = '𝔄'.repeat(MAXIMO_NOMBRE);
const lote = (i: number, emitidos: number) => ({
  id: uuid(i),
  numero: i,
  tipo: 'participante',
  nombre: NOMBRE_LARGO,
  emitidos,
  consumidos: 0,
  sinUsar: emitidos,
});
const vacio = { emitidos: 0, consumidos: 0, sinUsar: 0 };

/** El cliente real del panel, con su comprobación de tamaño, sobre un transporte que responde con el contrato. */
function clienteReal(responder: (ruta: string, cuerpo: unknown) => unknown) {
  const tamanos: Record<string, number> = {};
  const pedir: typeof fetch = async (url, opciones) => {
    const ruta = String(url);
    if (ruta.endsWith('sesion/abrir')) {
      return Response.json({ token: 'A'.repeat(LONGITUD_TOKEN), sesion });
    }
    if (ruta.endsWith('controles/leer')) {
      return Response.json({ estado: 'activa', sesion, controles });
    }
    const cuerpo = JSON.stringify(responder(ruta, JSON.parse(String(opciones?.body ?? '{}'))));
    tamanos[ruta.split('/administracion/api/')[1] ?? ruta] = new TextEncoder().encode(cuerpo).length;
    return new Response(cuerpo, { headers: { 'content-type': 'application/json' } });
  };
  const estados: EstadoClientePanel[] = [];
  const panel = crearClientePanel({ pedir, alCambiar: (estado) => estados.push(estado) });
  return { panel, tamanos, estados };
}

test('crear un lote de 200 y leer 50 lotes y 20 rondas con nombres largos cabe en el tope de la encuesta del cliente real', async () => {
  const anteriores = Array.from({ length: MAXIMO_RONDAS - 1 }, (_, i) => rondaAnterior(i + 1, true));
  const resultados = enRonda(
    {
      cuestionario: 'faro-piloto-2',
      abierta: true,
      lotes: Array.from({ length: MAXIMO_LOTES }, (_, i) => lote(i + 1, MAXIMO_LOTE)),
      totales: {
        participante: { emitidos: MAXIMO_LOTES * MAXIMO_LOTE, consumidos: 0, sinUsar: MAXIMO_LOTES * MAXIMO_LOTE },
        profesional: vacio,
      },
      recuentos: null,
    },
    anteriores,
  );
  const { panel, tamanos } = clienteReal((ruta) => {
    if (ruta.endsWith('encuesta/crear-lote')) {
      const codigos = Array.from({ length: MAXIMO_LOTE }, (_, i) => ({
        codigo: codigo(i),
        enlaceRelativo: `/inicio.html#invitacion=${codigo(i)}`,
      }));
      return { estado: 'activa', sesion, lote: lote(1, MAXIMO_LOTE), codigos };
    }
    return { estado: 'activa', sesion, encuesta: resultados };
  });
  await panel.abrir();
  const creado = await panel.crearLoteEncuesta({ tipo: 'participante', cantidad: MAXIMO_LOTE, nombre: NOMBRE_LARGO });
  assert.ok(creado && 'codigos' in creado, 'el lote creado llega con sus enlaces');
  assert.equal(creado.codigos.length, MAXIMO_LOTE);
  const leido = await panel.consultarEncuesta();
  assert.ok(leido && 'encuesta' in leido);
  assert.equal(leido.encuesta.lotes.length, MAXIMO_LOTES);
  // Las dos respuestas superan el tope general: sin el tope propio, el cliente las rechazaría.
  assert.ok((tamanos['encuesta/crear-lote'] ?? 0) > MAX_RESPUESTA_PANEL_BYTES, String(tamanos['encuesta/crear-lote']));
  assert.ok((tamanos['encuesta/resultados'] ?? 0) > MAX_RESPUESTA_PANEL_BYTES, String(tamanos['encuesta/resultados']));
  panel.destruir();
});

test('el nombre de la entidad sigue la misma regla que el servidor', () => {
  for (const valido of ['Fundació Àgora', 'Asociación «La Mina» 2', NOMBRE_LARGO, 'x']) {
    assert.equal(nombreDeEntidadValido(valido), true, valido);
  }
  const invalidos = [
    '',
    ' Entidad',
    'Entidad ',
    '   ',
    'Una\tentidad',
    'Una\nentidad',
    'Una​entidad',
    'ㅤ',
    'Aᅟ',
    'Aﾠ',
    'A⠀',
    'A\uD800',
    '\uDC00',
    'A\u1160',
    '\u0301\u0302',
    '𝔄'.repeat(MAXIMO_NOMBRE + 1),
    'A',
    'A͸',
    'A'.repeat(MAXIMO_NOMBRE + 1),
  ];
  for (const invalido of invalidos) {
    assert.equal(nombreDeEntidadValido(invalido), false, JSON.stringify(invalido));
  }
});

function entornoDeDescarga(t: TestContext) {
  const retiradas: string[] = [];
  const plazos: { accion: () => void; ms: number }[] = [];
  const documento = Object.assign(new EventTarget(), {
    hidden: false,
    body: new Campo('body'),
    createElement: (tag: string) => Object.assign(new Campo(tag), { click: () => {}, remove: () => {} }),
  });
  const ventana = Object.assign(new EventTarget(), {
    setTimeout: (accion: () => void, ms: number) => plazos.push({ accion, ms }),
    clearTimeout: () => {},
  });
  t.mock.method(URL, 'createObjectURL', () => 'blob:prueba');
  t.mock.method(URL, 'revokeObjectURL', (url: string) => retiradas.push(url));
  const global = globalThis as unknown as Record<string, unknown>;
  const anteriores = { document: global.document, window: global.window };
  global.document = documento;
  global.window = ventana;
  t.after(() => Object.assign(global, anteriores));
  return { retiradas, plazos, documento, ventana };
}

test('la dirección temporal de una descarga se retira una sola vez: al salir de la página o al vencer el plazo', (t) => {
  const { retiradas, plazos, documento, ventana } = entornoDeDescarga(t);
  descargar('contenido', 'archivo.txt', 'text/plain');
  assert.deepEqual(retiradas, [], 'no se retira en el mismo instante del clic');
  assert.equal(plazos[0]?.ms, PLAZO_DESCARGA_MS);
  // Ocultar la página (por ejemplo, la hoja de descarga de Safari en iPhone) no la retira.
  documento.hidden = true;
  documento.dispatchEvent(new Event('visibilitychange'));
  assert.deepEqual(retiradas, []);
  ventana.dispatchEvent(new Event('pagehide'));
  plazos[0]?.accion();
  assert.deepEqual(retiradas, ['blob:prueba'], 'una sola vez');
  // Sin salir de la página, el plazo de respaldo la retira; y quien llama puede retirarla antes.
  const retirar = descargar('otro', 'otro.txt', 'text/plain');
  plazos[1]?.accion();
  retirar();
  assert.deepEqual(retiradas, ['blob:prueba', 'blob:prueba']);
});

const turno = () => new Promise((resolver) => setImmediate(resolver));
async function conEnlaces(t: TestContext) {
  const { prepararPanel, respuestasEncuesta } = await import('./panel-dom.ts');
  const p = await prepararPanel(t);
  p.publicar({
    estado: 'activa',
    ocupado: false,
    conflicto: false,
    aviso: null,
    datos: null,
    trabajos: null,
    activacion: null,
    sesion: sesion as never,
    controles: { version: 2, revision: 1, api: 'habilitada', mcp: false, a2a: false },
  });
  const abierta = enRonda({
    cuestionario: 'faro-piloto-2',
    abierta: true,
    lotes: [],
    totales: { participante: vacio, profesional: vacio },
    recuentos: null,
  });
  respuestasEncuesta.consultar = { encuesta: leerResultadosEncuesta(abierta) };
  p.campo('consultar-encuesta').dispatchEvent(new Event('click'));
  await turno();
  const codigos = [0, 1, 2].map((i) => ({ codigo: codigo(i), enlaceRelativo: `/inicio.html#invitacion=${codigo(i)}` }));
  respuestasEncuesta.crearLote = { lote: { ...lote(1, codigos.length), nombre: 'Entidad' }, codigos };
  p.campo('encuesta-nombre').value = 'Entidad';
  p.campo('encuesta-cantidad').value = '3';
  p.campo('encuesta-formulario').dispatchEvent(new Event('submit', { cancelable: true }));
  await turno();
  assert.equal(p.campo('encuesta-enlaces').hidden, false);
  return { p, respuestasEncuesta, abierta };
}

test('los enlaces se olvidan al pulsar otro apartado de la barra y al ocultarse la página', async (t) => {
  const { p } = await conEnlaces(t);
  const enlace = new Campo('a');
  enlace.setAttribute('href', '#panel-fuentes');
  enlace.closest = () => enlace;
  const pulsacion = new Event('click');
  Object.defineProperty(pulsacion, 'target', { value: enlace });
  p.documento.dispatchEvent(pulsacion);
  assert.equal(p.campo('encuesta-enlaces').hidden, true);
  assert.equal(p.campo('encuesta-lista').value, '');
  const otra = await conEnlaces(t);
  otra.p.ventana.dispatchEvent(new Event('pagehide'));
  assert.equal(otra.p.campo('encuesta-lista').value, '');
  assert.equal(otra.p.campo('encuesta-correo').value, '');
});

/** Los recuentos a cero de cada tipo, con la escala y la meta que calcula el código del servidor. */
const vaciosDe = (tipo: TipoDeCodigo) => ({
  respuestas: 0,
  preguntas: Object.fromEntries(
    Object.entries(PREGUNTAS[tipo]).map(([pregunta, admitidos]) => {
      const valores = Object.fromEntries(admitidos.map((v) => [v, 0]));
      return [pregunta, { denominador: 0, valores, ...resumenDe(tipo, pregunta, valores) }];
    }),
  ),
});
const recuentosVacios = { participante: vaciosDe('participante'), profesional: vaciosDe('profesional') };
/** Los resultados sin su ronda, para volver a envolverlos con otra apertura. */
function sinRonda<T extends { version: number; ronda: unknown; rondas: unknown }>(resultados: T) {
  const { version: _version, ronda: _ronda, rondas: _rondas, ...resto } = resultados;
  return resto;
}

test('los enlaces se olvidan al cerrar la encuesta', async (t) => {
  const { p, respuestasEncuesta, abierta } = await conEnlaces(t);
  respuestasEncuesta.cerrar = {
    encuesta: leerResultadosEncuesta(enRonda({ ...sinRonda(abierta), abierta: false, recuentos: recuentosVacios })),
  };
  p.alConfirmar(() => true);
  p.campo('encuesta-cerrar').dispatchEvent(new Event('click'));
  await turno();
  assert.ok(p.llamadas.includes('cerrar-encuesta'));
  assert.equal(p.campo('encuesta-enlaces').hidden, true);
  assert.equal(p.campo('encuesta-lista').value, '');
});

test('un campo con error lleva aria-invalid mientras dura el error', async (t) => {
  const { p } = await conEnlaces(t);
  p.campo('encuesta-nombre').value = 'Una​entidad';
  p.campo('encuesta-cantidad').value = '3';
  p.campo('encuesta-formulario').dispatchEvent(new Event('submit', { cancelable: true }));
  await turno();
  assert.equal(p.campo('encuesta-nombre').getAttribute('aria-invalid'), 'true');
  assert.match(p.campo('encuesta-estado').textContent, /sin tabuladores ni caracteres invisibles/u);
  p.campo('encuesta-nombre').value = 'Entidad';
  p.campo('encuesta-cantidad').value = '2';
  p.campo('encuesta-formulario').dispatchEvent(new Event('submit', { cancelable: true }));
  await turno();
  assert.equal(p.campo('encuesta-nombre').getAttribute('aria-invalid'), null);
  assert.equal(p.campo('encuesta-cantidad').getAttribute('aria-invalid'), 'true');
  p.campo('encuesta-cantidad').value = '3';
  p.campo('encuesta-formulario').dispatchEvent(new Event('submit', { cancelable: true }));
  await turno();
  assert.equal(p.campo('encuesta-cantidad').getAttribute('aria-invalid'), null);
});

test('al olvidar los enlaces se retira la dirección del archivo de enlaces', async (t) => {
  const { p } = await conEnlaces(t);
  const retiradas: string[] = [];
  t.mock.method(URL, 'createObjectURL', () => 'blob:enlaces');
  t.mock.method(URL, 'revokeObjectURL', (url: string) => retiradas.push(url));
  Object.assign(p.documento, {
    body: new Campo('body'),
    createElement: (tag: string) => Object.assign(new Campo(tag), { click: () => {}, remove: () => {} }),
  });
  p.campo('encuesta-descargar').dispatchEvent(new Event('click'));
  assert.deepEqual(retiradas, [], 'mientras los enlaces se ven, su archivo sigue disponible');
  p.campo('encuesta-olvidar').dispatchEvent(new Event('click'));
  assert.deepEqual(retiradas, ['blob:enlaces']);
  assert.equal(p.campo('encuesta-lista').value, '');
});
