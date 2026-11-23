// La pantalla del recorrido vista desde el motor del dispositivo (src/recorrido/pantalla/): el paso (pregunta o
// resultado) con el léxico 1A y el motor de preguntas 1B, la búsqueda a mano, las 62 familias de la CNO-11, el
// resultado con las tareas ordenadas por parecido, el enlace de tareas propias y las peticiones locales del Worker.
// Con el paquete de datos real: lo que se comprueba es lo que verá la persona.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { esPeticionLocal, PREFIJO_LOCAL, responderLocal } from '../../../src/plataforma/navegador/ruta-local.ts';
import { cargarDatos } from '../../../src/plataforma/node/datos.ts';
import { estadoDeLaIa, oficioVacio } from '../src/recorrido/pantalla/previa-fusion.ts';
import {
  buscarAMano,
  buscar as buscarEn,
  enlazar,
  familias,
  gruposDeFamilia,
  gruposPorTareas,
  type PasoDePantalla,
  pasoDePantalla,
  previaLexica,
  resultado,
  tareasDelGrupo,
} from '../src/recorrido/pantalla/servicio.ts';
import { mismaForma, similitudLexica } from '../src/recorrido/pantalla/tareas.ts';
import { comprobarAtributos } from '../src/recorrido/preguntas/atributos.ts';
import { CONFIGURACION, MAX_RESPUESTAS_DEL_RECORRIDO } from '../src/recorrido/preguntas/motor.ts';
import type { Respuesta } from '../src/recorrido/preguntas/tipos.ts';

const datos = cargarDatos(fileURLToPath(new URL('../../../datos/', import.meta.url)));
const A = comprobarAtributos(
  JSON.parse(readFileSync(new URL('../src/recorrido/preguntas/atributos.json', import.meta.url), 'utf8')),
);
const FAMILIAS_CNO = 62;
const TOPE_PREGUNTAS = CONFIGURACION.maxPreguntas;
/**
 * Preguntas como mucho en un recorrido: el límite de respuestas del motor. Antes eran las preguntas más 2 tras cada
 * rechazo posible (22), pero las tandas de la última lista también son preguntas: con más tandas, quien responde «No lo
 * sé» a todo pasa de 22 sin pasar del límite.
 */
const MAX_PREGUNTAS_CON_RECHAZOS = MAX_RESPUESTAS_DEL_RECORRIDO;
const MAX_PASOS = 40;
const PRIMEROS = 3;
const BIEN = 200;
const MAL = 400;
const NO_EXISTE = 404;
const buscar = (texto: string) => buscarEn(datos, texto, 'es');
const OFICINA = 'trabajo en una oficina, archivo papeles, contesto el teléfono y paso facturas al ordenador';

type Final = Exclude<PasoDePantalla, { tipo: 'pregunta' }>;

/**
 * Recorre la pantalla respondiendo `elegir` a cada pregunta y `aLaPropuesta` a cada propuesta del motor, hasta una
 * propuesta de la pantalla (local), la decisión o «no encontrada». Devuelve ese paso y cuántas preguntas se han hecho.
 */
function recorrer(
  texto: string,
  idioma: 'es' | 'ca',
  elegir: (opciones: readonly { id: string }[]) => string,
  aLaPropuesta = 'si',
): { paso: Final; preguntas: number } {
  const respuestas: Respuesta[] = [];
  let preguntas = 0;
  for (let i = 0; i <= MAX_PASOS; i += 1) {
    const { paso } = pasoDePantalla(datos, A, { texto, idioma, respuestas });
    if (paso.tipo === 'pregunta') {
      preguntas += 1;
      respuestas.push({ pregunta: paso.pregunta.id, opcion: elegir(paso.pregunta.opciones) });
    } else if (paso.tipo === 'propuesta' && !paso.local) {
      respuestas.push({ pregunta: paso.id, opcion: aLaPropuesta });
    } else {
      return { paso, preguntas };
    }
  }
  assert.fail(`${texto}: no termina`);
}

/**
 * Recorre la pantalla como una persona terca: `terca` («No lo sé» u «Otra cosa») a cada pregunta que lo admita, «No lo
 * sé» a las demás y «No» a cada propuesta del motor. Devuelve cuántas respuestas ha dado y si ha llegado a un final.
 */
function recorridoTerco(texto: string, terca: string): { respuestas: number; termina: boolean } {
  const respuestas: Respuesta[] = [];
  for (let i = 0; i <= MAX_PASOS; i += 1) {
    const { paso } = pasoDePantalla(datos, A, { texto, idioma: 'es', respuestas: [...respuestas] });
    if (paso.tipo === 'pregunta') {
      const admite = paso.pregunta.opciones.some((o) => o.id === terca);
      respuestas.push({ pregunta: paso.pregunta.id, opcion: admite ? terca : 'no_lo_se' });
    } else if (paso.tipo === 'propuesta' && !paso.local) {
      respuestas.push({ pregunta: paso.id, opcion: 'no' });
    } else {
      return { respuestas: respuestas.length, termina: true };
    }
  }
  return { respuestas: respuestas.length, termina: false };
}

describe('el límite de respuestas', () => {
  it('nunca pasa del límite de la pantalla, ni con «No lo sé» u «Otra cosa» a todo', () => {
    // Una respuesta más y la petición daría error (ruta-local.ts) en vez de «No encuentro la mía»: con 7 tandas en la
    // última lista, «ordenadores» llegaba a 26 respuestas.
    for (const texto of ['ordenadores', 'fábrica', 'trabajo', 'tecnico']) {
      for (const terca of ['no_lo_se', 'otra']) {
        const { respuestas, termina } = recorridoTerco(texto, terca);
        assert.ok(termina, `${texto} (${terca}): no termina`);
        assert.ok(respuestas <= MAX_RESPUESTAS_DEL_RECORRIDO, `${texto} (${terca}): ${respuestas}`);
      }
    }
  });
});

describe('el paso de la pantalla', () => {
  it('cada pregunta es cerrada, con «No lo sé» al final y el contador «como mucho» del tope de preguntas', () => {
    const { paso } = pasoDePantalla(datos, A, { texto: 'tecnico', idioma: 'es', respuestas: [] });
    assert.equal(paso.tipo, 'pregunta');
    assert.equal(paso.tipo === 'pregunta' && paso.maximo, TOPE_PREGUNTAS);
    if (paso.tipo === 'pregunta') {
      assert.equal(paso.pregunta.opciones.at(-1)?.id, 'no_lo_se');
      assert.match(paso.pregunta.texto, /^¿Técnico de qué\?/);
    }
  });

  it('termina aunque la persona responda siempre «No lo sé» y rechace todas las propuestas', () => {
    for (const [texto, idioma] of [
      ['tecnico', 'es'],
      ['xyzzy', 'es'],
      ['Sóc mosso d’esquadra', 'ca'],
    ] as const) {
      const { paso, preguntas } = recorrer(texto, idioma, () => 'no_lo_se', 'no');
      assert.ok(preguntas <= MAX_PREGUNTAS_CON_RECHAZOS, `${texto}: ${preguntas}`);
      assert.ok(paso.tipo === 'no_encontrada' || (paso.tipo === 'propuesta' && paso.local), texto);
    }
  });

  it('Faro no afirma: propone con títulos en los dos idiomas y dos alternativas, y la persona confirma', () => {
    const { paso } = recorrer('camarero', 'es', (o) => o[0]?.id ?? 'no_lo_se', 'si');
    const propuesta =
      paso.tipo === 'propuesta'
        ? paso
        : pasoDePantalla(datos, A, { texto: 'camarero', idioma: 'es', respuestas: [] }).paso;
    if (propuesta.tipo === 'propuesta') {
      assert.equal(propuesta.mejor.grupo, '5131');
      assert.ok(propuesta.mejor.tituloGrupo.es && propuesta.mejor.tituloGrupo.ca);
      assert.notEqual(propuesta.mejor.tituloGrupo.es, propuesta.mejor.tituloGrupo.ca);
      assert.match(propuesta.mejor.ocupacion?.titulo.es ?? '', /camarer/);
      // De lo genérico a lo específico: 1 o 2 alternativas que compiten de verdad, ninguna rama de la propuesta.
      assert.ok(propuesta.alternativas.length >= 1 && propuesta.alternativas.length <= 2);
      assert.deepEqual(
        propuesta.opciones.map((o) => o.id).filter((id) => id === 'si' || id === 'no'),
        ['si', 'no'],
      );
    }
    assert.ok(paso.tipo === 'decidida' ? paso.grupo === '5131' : paso.tipo === 'propuesta', paso.tipo);
  });

  it('las preguntas salen en catalán con la página en catalán', () => {
    const { paso } = pasoDePantalla(datos, A, { texto: 'tècnic', idioma: 'ca', respuestas: [] });
    assert.equal(paso.tipo, 'pregunta');
    assert.equal(paso.tipo === 'pregunta' && paso.pregunta.opciones.at(-1)?.texto, 'No ho sé');
  });
});

describe('lo que cuenta durante las preguntas', () => {
  it('«Lo cuento con mis palabras»: «recursos humanos» + «hago las nóminas y los contratos» lleva a nóminas (4313)', () => {
    const anadido = 'hago las nóminas y los contratos';
    const texto = `recursos humanos. ${anadido}`;
    const respuestas: Respuesta[] = [];
    let paso = pasoDePantalla(datos, A, { texto, idioma: 'es', respuestas, anadido }).paso;
    for (let i = 0; paso.tipo === 'pregunta' && i < TOPE_PREGUNTAS; i += 1) {
      const nominas = paso.pregunta.opciones.find((o) => o.id === '4313' || /nómina/i.test(o.texto));
      respuestas.push({ pregunta: paso.pregunta.id, opcion: nominas?.id ?? 'no_lo_se' });
      paso = pasoDePantalla(datos, A, { texto, idioma: 'es', respuestas, anadido }).paso;
    }
    const propuesto = paso.tipo === 'propuesta' ? paso.mejor.grupo : '';
    assert.equal(paso.tipo === 'decidida' ? paso.grupo : propuesto, '4313');
  });
});

describe('lo que entiende del texto y los adaptadores', () => {
  it('lee el lugar y el sector del texto y no lo toma por el oficio', () => {
    const { lectura } = pasoDePantalla(datos, A, {
      texto: 'Soy técnico laboral en la Generalitat',
      idioma: 'es',
      respuestas: [],
    });
    assert.equal(lectura.lugar, 'en la generalitat');
    assert.deepEqual(lectura.sectores, ['publico']);
  });

  it('sin entender nada («xyzzy»), lo dice; con un puesto o un día contado, no', () => {
    const lee = (texto: string) => pasoDePantalla(datos, A, { texto, idioma: 'es', respuestas: [] }).lectura;
    assert.equal(lee('xyzzy').sinComprension, true);
    assert.equal(lee('camarero').sinComprension, false);
    assert.equal(lee(OFICINA).sinComprension, false);
  });

  it('trampa: «Sóc mosso d’esquadra» propone agente de policía (5412), nunca mozo de almacén', () => {
    const { paso } = pasoDePantalla(datos, A, { texto: 'Sóc mosso d’esquadra', idioma: 'ca', respuestas: [] });
    assert.match(paso.tipo === 'propuesta' ? paso.id : paso.tipo, /^propuesta:5412:/);
  });

  it('una descripción sin nombre de puesto parte de los grupos cuyas tareas se parecen (relato sin LLM)', () => {
    const grupos = gruposPorTareas(datos, OFICINA).map((g) => g.grupo);
    assert.ok(
      grupos.slice(0, PRIMEROS).some((g) => g.startsWith('4')),
      grupos.join(','),
    );
    const { lectura, paso } = pasoDePantalla(datos, A, { texto: OFICINA, idioma: 'es', respuestas: [] });
    assert.equal(lectura.sinCandidatas, true);
    // La primera pregunta ya apunta a trabajos de oficina (gran grupo 4): una tarea o la opción de oficina.
    assert.ok(paso.tipo === 'pregunta' && paso.pregunta.opciones[0]?.id.startsWith('4'));
  });

  it('la previa es un adaptador: otra previa cambia el punto de partida sin tocar la pantalla', () => {
    const forzada = () => ({ candidatas: [{ isco08: '9112', puntos: 110 }] });
    const { paso } = pasoDePantalla(datos, A, { texto: 'xyzzy', idioma: 'es', respuestas: [] }, forzada);
    assert.equal(paso.tipo === 'propuesta' && paso.mejor.grupo, '9112');
    const lexica = previaLexica(
      datos,
      { candidatas: [], grupos: [], pistasDeSector: [], idiomasBuscados: ['es'] },
      { texto: '', idioma: 'es' },
    );
    assert.deepEqual(lexica.candidatas, []);
  });
});

// La fusión calibrada y la previa por defecto de la pantalla.
describe('el enganche de la fusión (previa-fusion.ts)', () => {
  it('«oficio vacío»: quitado el lugar, el texto no nombra ningún puesto', () => {
    const conLugar = (texto: string) => oficioVacio(datos, texto, buscar(texto));
    assert.equal(conLugar('xyzzy en una residencia'), true);
    assert.equal(conLugar('camarero en un hotel'), false);
    assert.equal(conLugar('camarero'), false);
  });
});

describe('buscar a mano y las 62 familias', () => {
  it('«Prefiero buscarla yo» da ocupaciones con su grupo y dos tareas de muestra', () => {
    const lista = buscarAMano(datos, 'cajera', 'es');
    assert.equal(lista[0]?.grupo, '5230');
    assert.ok(lista[0]?.titulo.ca);
    assert.equal(lista[0]?.tareas.length, 2);
  });

  it('las familias son los 62 subgrupos principales de la CNO-11 y cubren los grupos con tareas', () => {
    const lista = familias(datos);
    assert.equal(lista.length, FAMILIAS_CNO);
    assert.equal(lista.at(-1)?.codigo, '00');
    const cubiertos = new Set(lista.flatMap((f) => f.grupos));
    const conTareas = Object.keys(datos.clasificaciones.isco08_es).filter((g) => tareasDelGrupo(datos, g).length > 0);
    const sinFamilia = conTareas.filter((g) => !cubiertos.has(g));
    assert.equal(sinFamilia.length, 0, sinFamilia.join(','));
  });

  it('una familia da sus grupos con título en los dos idiomas y tareas de muestra', () => {
    const grupos = gruposDeFamilia(datos, '92');
    assert.ok(grupos.some((g) => g.isco08.startsWith('91')));
    for (const g of grupos) {
      assert.ok(g.titulo.es && g.titulo.ca && g.tareas.length > 0, g.isco08);
    }
    assert.deepEqual(gruposDeFamilia(datos, '99'), []);
  });
});

describe('el resultado y las tareas', () => {
  it('las tareas que se parecen a lo contado van primero y marcadas; el resto, en su orden oficial', () => {
    const r = resultado(datos, { grupo: '4110', texto: OFICINA });
    assert.ok(r);
    const premarcadas = r.tareas.filter((t) => t.premarcada).map((t) => t.corto.es);
    assert.ok(premarcadas.includes('Registrar y archivar información'), premarcadas.join(' | '));
    const primera = r.tareas.findIndex((t) => !t.premarcada);
    assert.ok(r.tareas.slice(primera).every((t) => !t.premarcada));
  });

  it('marca las tareas que la persona eligió al responder «¿Cuál de estas cosas haces más?»', () => {
    const r = resultado(datos, { grupo: '2423', texto: 'xyzzy', elegidas: ['2423-1'] });
    assert.equal(r?.tareas[0]?.id, '2423-1');
    assert.equal(r?.tareas[0]?.premarcada, true);
  });

  it('con la ocupación de otro grupo o un grupo que no existe, no inventa nada', () => {
    assert.equal(resultado(datos, { grupo: '0000', texto: 'x' }), null);
    const r = resultado(datos, { grupo: '4110', esco: '5230.1', texto: 'x' });
    assert.equal(r?.ocupacion, undefined);
    assert.ok((r?.ocupacionesDelGrupo.length ?? 0) > 0);
  });

  it('enlaza una tarea propia con la oficial más parecida solo si pasa el umbral', () => {
    assert.equal(
      enlazar(datos, { grupo: '4110', tarea: 'archivo los expedientes' })?.tarea.id.startsWith('4110'),
      true,
    );
    assert.equal(enlazar(datos, { grupo: '4110', tarea: 'juego al fútbol los domingos' }), null);
  });

  it('la similitud léxica entiende verbos conjugados y formas comunes', () => {
    assert.ok(mismaForma('archiv', 'archivador'));
    assert.ok(!mismaForma('cont', 'contrat'));
    const [archivar = 0, otra = 0] = similitudLexica('archivo papeles', [
      { id: 'a', textos: ['Registrar y archivar información'] },
      { id: 'b', textos: ['Conducir camiones'] },
    ]);
    assert.ok(archivar > otra && otra === 0);
  });
});

describe('las peticiones locales del Worker', () => {
  const pedir = (operacion: string, cuerpo: unknown, method = 'POST') =>
    responderLocal(datos, () => A, {
      url: `http://127.0.0.1${PREFIJO_LOCAL}${operacion}`,
      method,
      headers: [['content-type', 'application/json']],
      body: method === 'POST' ? JSON.stringify(cuerpo) : null,
    });

  it('solo atiende su prefijo, fuera de /api/', () => {
    assert.ok(esPeticionLocal(`http://127.0.0.1${PREFIJO_LOCAL}paso`));
    assert.ok(!esPeticionLocal('http://127.0.0.1/api/clasificar'));
    assert.ok(!esPeticionLocal('no es una url'));
  });

  it('responde el paso, las familias y el resultado; 400 si el cuerpo no vale y 404 si no existe', async () => {
    const paso = await pedir('paso', { texto: 'camarero', idioma: 'es', respuestas: [] });
    assert.equal(paso.status, BIEN);
    assert.match(((await paso.json()) as { paso: { tipo: string } }).paso.tipo, /^(propuesta|pregunta)$/);
    assert.equal((await pedir('familias', {})).status, BIEN);
    assert.equal((await pedir('resultado', { grupo: '5131', texto: '' })).status, BIEN);
    assert.equal((await pedir('resultado', { grupo: '0000', texto: '' })).status, NO_EXISTE);
    assert.equal((await pedir('paso', { texto: 'x', idioma: 'fr', respuestas: [] })).status, MAL);
    assert.equal((await pedir('paso', { texto: 'x', idioma: 'es', respuestas: 'no' })).status, MAL);
    const demasiadas = Array.from({ length: MAX_RESPUESTAS_DEL_RECORRIDO + 1 }, () => ({ pregunta: 'a', opcion: 'b' }));
    assert.equal((await pedir('paso', { texto: 'x', idioma: 'es', respuestas: demasiadas })).status, MAL);
    assert.equal((await pedir('resultado', { grupo: '5131', texto: '', elegidas: ['<b>'] })).status, MAL);
    assert.equal((await pedir('otra', {})).status, NO_EXISTE);
    assert.equal((await pedir('paso', null, 'GET')).status, NO_EXISTE);
  });

  it('el paso lleva también lo contado con «Lo cuento con mis palabras», igual que el motor', async () => {
    // Un texto en que lo añadido cambia el paso: si la petición local no lo pasara, saldría el paso sin él.
    const anadido = 'archivo papeles y paso facturas';
    const entrada = { texto: `trabajo en una oficina. ${anadido}`, idioma: 'es' as const, respuestas: [] };
    const conAnadido = JSON.parse(JSON.stringify(pasoDePantalla(datos, A, { ...entrada, anadido })));
    assert.notDeepEqual(conAnadido, JSON.parse(JSON.stringify(pasoDePantalla(datos, A, entrada))));
    // La ruta añade a la lectura qué IA estaba cargada (estadoDeLaIa); lo demás es el paso del motor tal cual.
    assert.deepEqual(await (await pedir('paso', { ...entrada, anadido })).json(), {
      ...conAnadido,
      lectura: { ...conAnadido.lectura, ...estadoDeLaIa() },
    });
    assert.equal((await pedir('paso', { ...entrada, anadido: 7 })).status, MAL);
  });
});
