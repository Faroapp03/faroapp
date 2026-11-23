import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  AtributosInvalidos,
  comprobarAtributos,
  FICHAS,
  FUENTES_EXTERNAS,
} from '../src/recorrido/preguntas/atributos.ts';
import {
  actualizar,
  CONFIGURACION,
  configuracionDe,
  distribucionInicial,
  ganancia,
  siguientePasoConPropuestas,
} from '../src/recorrido/preguntas/motor.ts';
import {
  enIdioma,
  NO_LO_SE,
  OPCIONES_POR_PREGUNTA,
  preguntaDeJerarquia,
  preguntaDeTareasPara,
  reconstruir,
} from '../src/recorrido/preguntas/preguntas.ts';
import { CAMPOS, NIVEL1, NIVEL2 } from '../src/recorrido/preguntas/textos.ts';
import type { Entrada, Paso, Respuesta } from '../src/recorrido/preguntas/tipos.ts';

const MIN_GRUPOS = 400;
const MITAD = 0.5;
const EPSILON = 1e-9;
const ERROR_ALTO = 0.2;
const ERROR_HABITUAL = 0.15;
const GANANCIA_MINIMA_CON_ERROR = 0.3;
const MASA_MINIMA_TRAS_ERROR = 0.05;
const MIN_OPCIONES = 3;
const MAX_OPCIONES = 5;
const MAX_LETRAS_OPCION = 90;
/** El tope de preguntas del motor. */
const TOPE = CONFIGURACION.maxPreguntas;
const MAX_PREGUNTAS_CASO = 3;
const MS_MAXIMOS_POR_PASO = 20;
const CASI_SEGURO = 0.99;

const RUTA = new URL('../src/recorrido/preguntas/atributos.json', import.meta.url);
const crudo: unknown = JSON.parse(readFileSync(RUTA, 'utf8'));
const A = comprobarAtributos(crudo);

/** «Soy técnico laboral en la Generalitat»: el buscador duda entre relaciones laborales, minas y administración. */
const DUDOSA: Entrada = {
  idioma: 'es',
  respuestas: [],
  candidatas: [
    { esco: '2423.4', isco08: '2423', puntos: 52, titulo: 'técnico de relaciones laborales' },
    { esco: '3117.4', isco08: '3117', puntos: 50.6, titulo: 'inspector de seguridad minera' },
    { esco: '2422.1', isco08: '2422', puntos: 49, titulo: 'administrativo de la Administración pública' },
  ],
};
const CLARA: Entrada = {
  idioma: 'es',
  respuestas: [],
  candidatas: [{ esco: '5223.1', isco08: '5223', puntos: 100, titulo: 'dependiente de comercio' }],
};

function pregunta(paso: Paso) {
  assert.equal(paso.tipo, 'pregunta');
  return paso.pregunta;
}

test('la tabla de atributos tiene fuente para cada atributo usado y rechaza uno sin ficha', () => {
  assert.ok(Object.keys(A.grupos).length >= MIN_GRUPOS);
  for (const ficha of FICHAS.filter((f) => f.usado)) {
    assert.ok(typeof A.fuentes[ficha.fuente] === 'string' || FUENTES_EXTERNAS.has(ficha.fuente), ficha.clave);
    assert.ok(ficha.regla.length > 0 && ficha.fiabilidad !== 'baja', ficha.clave);
  }
  const conIntruso = structuredClone(crudo) as { grupos: Record<string, Record<string, unknown>> };
  const primero = Object.keys(conIntruso.grupos)[0] ?? '';
  (conIntruso.grupos[primero] as Record<string, unknown>).entorno = 'oficina';
  assert.throws(() => comprobarAtributos(conIntruso), AtributosInvalidos);
});

test('la ganancia de información es máxima con una pregunta que parte la duda y nula si no distingue', () => {
  const p = new Map([
    ['2423', MITAD],
    ['3117', MITAD],
  ]);
  const separa = reconstruir(A, 'nivel1:2,3');
  const igual = reconstruir(A, 'nivel2:24,26');
  assert.ok(separa && igual);
  assert.ok(Math.abs(ganancia(p, separa, 0) - 1) < EPSILON);
  assert.ok(ganancia(p, separa, ERROR_ALTO) < 1 && ganancia(p, separa, ERROR_ALTO) > GANANCIA_MINIMA_CON_ERROR);
  const nula = reconstruir(A, 'nivel1:2,3');
  assert.ok(nula);
  assert.ok(ganancia(new Map([['2423', 1]]), nula, ERROR_HABITUAL) < EPSILON);
  assert.ok(Math.abs(ganancia(p, igual, ERROR_HABITUAL) - ganancia(p, separa, ERROR_HABITUAL)) < EPSILON);
});

test('una respuesta equivocada no elimina el grupo correcto (verosimilitud blanda)', () => {
  const p = new Map([
    ['2423', MITAD],
    ['3117', MITAD],
  ]);
  const e = reconstruir(A, 'nivel1:2,3');
  assert.ok(e);
  const tras = actualizar(p, e, 1, ERROR_HABITUAL);
  assert.ok((tras.get('2423') ?? 0) > MASA_MINIMA_TRAS_ERROR);
  assert.ok((tras.get('3117') ?? 0) > (tras.get('2423') ?? 0));
});

test('con el buscador ya seguro, propone sin preguntar (y nunca afirma sin confirmar)', () => {
  const paso = siguientePasoConPropuestas(A, CLARA);
  assert.equal(paso.tipo, 'propuesta');
  assert.equal(paso.tipo === 'propuesta' && paso.propuesta.grupo, '5223');
  assert.equal(paso.tipo === 'propuesta' && paso.propuesta.ocupacion?.esco, '5223.1');
  assert.equal(paso.tipo === 'propuesta' && paso.preguntasHechas, 0);
});

test('pregunta cuando duda, con opciones cerradas y «No lo sé» al final', () => {
  const p = pregunta(siguientePasoConPropuestas(A, DUDOSA));
  assert.ok(p.opciones.length >= MIN_OPCIONES && p.opciones.length <= MAX_OPCIONES, String(p.opciones.length));
  assert.equal(p.opciones.at(-1)?.id, NO_LO_SE);
  assert.equal(p.opciones.at(-1)?.texto, 'No lo sé');
  assert.equal(p.buscarYo, 'Prefiero buscarla yo');
  assert.ok(
    p.opciones.every((o) => o.texto.length > 0 && o.texto.length <= MAX_LETRAS_OPCION),
    JSON.stringify(p.opciones),
  );
});

test('«No lo sé» no cambia la distribución y el tope es el de la configuración', () => {
  const respuestas: Respuesta[] = [];
  let paso = siguientePasoConPropuestas(A, DUDOSA);
  const confianzaInicial = paso.tipo === 'pregunta' ? paso.provisional[0]?.confianza : -1;
  while (paso.tipo === 'pregunta') {
    assert.ok(paso.numero <= TOPE);
    assert.equal(paso.provisional[0]?.confianza, confianzaInicial);
    respuestas.push({ pregunta: paso.pregunta.id, opcion: NO_LO_SE });
    paso = siguientePasoConPropuestas(A, { ...DUDOSA, respuestas });
  }
  // Sin nada que distinga, acaba proponiendo lo más probable, sin pasar del tope.
  assert.equal(paso.tipo, 'propuesta');
  assert.ok(paso.preguntasHechas <= TOPE);
  assert.equal(paso.tipo === 'propuesta' && paso.propuesta.confianza, confianzaInicial);
  assert.equal(new Set(respuestas.map((r) => r.pregunta)).size, respuestas.length, 'no repite preguntas');
});

test('responder lo que corresponde a un grupo lo lleva a la cabeza en pocas preguntas', () => {
  const respuestas: Respuesta[] = [];
  let paso = siguientePasoConPropuestas(A, DUDOSA);
  while (paso.tipo === 'pregunta') {
    const q = paso.pregunta;
    const ids = q.opciones.map((o) => o.id);
    const esTarea = q.id.startsWith('tarea:');
    const deLaBuena = q.id.split(':')[1]?.startsWith('2422-');
    const siNo = deLaBuena ? 'si' : 'no';
    const tarea = esTarea ? siNo : undefined;
    const propia = ids.find((id) => id === '2422' || id === '24' || id === '2' || id === '242');
    const opcion = tarea ?? propia ?? (ids.includes('04') ? '04' : NO_LO_SE);
    respuestas.push({ pregunta: q.id, opcion });
    paso = siguientePasoConPropuestas(A, { ...DUDOSA, respuestas });
  }
  assert.equal(paso.tipo === 'propuesta' && paso.propuesta.grupo, '2422');
  assert.ok(paso.preguntasHechas <= MAX_PREGUNTAS_CASO, String(paso.preguntasHechas));
});

test('es determinista y rápido', () => {
  const inicio = performance.now();
  const veces = 20;
  for (let i = 0; i < veces; i++) {
    assert.deepEqual(siguientePasoConPropuestas(A, DUDOSA), siguientePasoConPropuestas(A, DUDOSA));
  }
  const msPorPaso = (performance.now() - inicio) / (2 * veces);
  assert.ok(msPorPaso < MS_MAXIMOS_POR_PASO, `${msPorPaso} ms por paso`);
});

test('la misma pregunta en castellano y en catalán, con textos completos', () => {
  const es = pregunta(siguientePasoConPropuestas(A, DUDOSA));
  const ca = pregunta(siguientePasoConPropuestas(A, { ...DUDOSA, idioma: 'ca' }));
  assert.equal(es.id, ca.id);
  assert.notEqual(es.texto, ca.texto);
  assert.equal(ca.opciones.at(-1)?.texto, 'No ho sé');
  assert.equal(ca.buscarYo, 'Prefereixo buscar-la jo');
  const subgrupos = Object.keys(A.etiquetas3).map((c) => c.slice(0, 2));
  for (const c of new Set(subgrupos)) {
    assert.ok(NIVEL2[c]?.es && NIVEL2[c]?.ca, c);
    assert.ok(NIVEL1[c.slice(0, 1)]?.es && NIVEL1[c.slice(0, 1)]?.ca, c);
  }
  for (const g of Object.values(A.grupos)) {
    for (const c of Object.keys(g.cm ?? {})) {
      assert.ok(CAMPOS[c]?.ca, c);
    }
  }
  for (const t of Object.values(A.tareas)) {
    assert.ok(t.es.length > 0 && t.ca.length > 0);
  }
});

test('con una palabra genérica, la primera pregunta es «¿Técnico de qué?»', () => {
  const entrada: Entrada = { ...DUDOSA, necesitaPrecision: 'tecnico' };
  const p = pregunta(siguientePasoConPropuestas(A, entrada));
  assert.match(p.texto, /^¿Técnico de qué\?/);
  const ca = pregunta(siguientePasoConPropuestas(A, { ...entrada, idioma: 'ca' }));
  assert.match(ca.texto, /^Tècnic de què\?/);
});

test('las tareas se preguntan de una en una, con sí o no, y la de contraste es típica del primer grupo', () => {
  const e = preguntaDeTareasPara(A, ['2423', '2422']);
  assert.ok(e);
  assert.equal(e.tipo, 'tarea');
  assert.deepEqual(e.valores, ['si', 'no']);
  assert.ok(A.grupos['2423']?.ta.includes(e.id.split(':')[1] ?? ''));
  assert.deepEqual(e.reparto('2423'), [1, 0]);
  assert.ok((e.reparto('9112')?.[1] ?? 0) > CASI_SEGURO);
  const q = enIdioma(A, e, 'es');
  assert.match(q.texto, /^¿Esto forma parte de tu trabajo\? «.+»$/);
  assert.deepEqual(
    q.opciones.map((o) => o.id),
    ['si', 'no', NO_LO_SE],
  );
});

test('las pistas del texto pesan sin preguntar', () => {
  const p0 = distribucionInicial(A, DUDOSA, CONFIGURACION);
  const con = siguientePasoConPropuestas(A, {
    ...DUDOSA,
    pistas: [{ sector: 'publico', palabra: 'generalitat', grupos: ['2422', '335'] }],
  });
  const sin = siguientePasoConPropuestas(A, DUDOSA);
  const confianza = (paso: Paso, g: string) =>
    paso.tipo === 'pregunta' ? (paso.provisional.find((h) => h.grupo === g)?.confianza ?? 0) : 1;
  assert.ok(confianza(con, '2422') > confianza(sin, '2422'));
  assert.ok((p0.get('2422') ?? 0) > 0);
});

const SQLITE = new URL('../../../var/actualizacion/validados/esco/biblioteca-esco.sqlite', import.meta.url);
test('atributos.json está al día con sus fuentes', {
  skip: !existsSync(SQLITE) && 'sin la copia local de ESCO',
}, async () => {
  const { execFileSync } = await import('node:child_process');
  const generador = new URL('../herramientas/generar-atributos.ts', import.meta.url);
  execFileSync(process.execPath, [fileURLToPath(generador), '--comprobar'], { stdio: 'pipe' });
});

const PESO_EXTRA = 10;
const MAX_OCUPACIONES = 5;
test('una puntuación extra por candidata (vectores) cuenta solo con su peso y la propuesta lleva su ocupación', () => {
  const conExtra: Entrada = {
    ...DUDOSA,
    candidatas: DUDOSA.candidatas.map((c) => (c.isco08 === '2422' ? { ...c, extra: 3 } : c)),
  };
  const confianza2422 = (paso: Paso) =>
    paso.tipo === 'pregunta' ? (paso.provisional.find((h) => h.grupo === '2422')?.confianza ?? 0) : -1;
  assert.deepEqual(siguientePasoConPropuestas(A, conExtra), siguientePasoConPropuestas(A, DUDOSA));
  const pesado = siguientePasoConPropuestas(A, { ...conExtra, configuracion: { pesoExtra: PESO_EXTRA } });
  assert.equal(pesado.tipo, 'propuesta');
  assert.equal(pesado.tipo === 'propuesta' && pesado.propuesta.grupo, '2422');
  assert.ok(confianza2422(siguientePasoConPropuestas(A, DUDOSA)) < 1);
  const sinPreguntas: Entrada = { ...CLARA, configuracion: { maxPreguntas: 0 } };
  const final = siguientePasoConPropuestas(A, sinPreguntas);
  assert.equal(final.tipo === 'propuesta' && final.propuesta.ocupacion?.esco, '5223.1');
  // Confirmada la propuesta, el resultado ordena sus ocupaciones.
  const respuestas: Respuesta[] = final.tipo === 'propuesta' ? [{ pregunta: final.id, opcion: 'si' }] : [];
  const confirmado = siguientePasoConPropuestas(A, { ...sinPreguntas, respuestas });
  assert.ok(confirmado.tipo === 'resultado' && confirmado.ocupaciones.length <= MAX_OCUPACIONES);
  assert.equal(confirmado.tipo === 'resultado' && confirmado.ocupaciones[0]?.esco, '5223.1');
});

test('con el grupo claro y varias ocupaciones, pregunta «¿Cuál de estos es tu puesto?» y la respuesta manda', () => {
  const entrada: Entrada = {
    ...CLARA,
    candidatas: [
      { esco: '5223.1', isco08: '5223', puntos: 100, titulo: 'dependiente de comercio' },
      { esco: '5223.2', isco08: '5223', puntos: 99, titulo: 'vendedor' },
    ],
    configuracion: { umbralOcupacion: 0.8 },
  };
  const q = pregunta(siguientePasoConPropuestas(A, entrada));
  assert.equal(q.tipo, 'ocupacion');
  assert.deepEqual(
    q.opciones.map((o) => o.texto),
    ['Dependiente de comercio', 'Vendedor', 'Otra cosa', 'No lo sé'],
  );
  const final = siguientePasoConPropuestas(A, { ...entrada, respuestas: [{ pregunta: q.id, opcion: '5223.2' }] });
  assert.equal(final.tipo === 'propuesta' && final.propuesta.ocupacion?.esco, '5223.2');
});

/** Pasos como mucho de los recorridos de estas pruebas: el tope de preguntas y propuestas, con margen. */
const MAX_PASOS = 40;
test('propuestas: nunca afirma sin confirmar; «Sí» confirma y una alternativa se confirma antes de valer', () => {
  const p = siguientePasoConPropuestas(A, CLARA);
  assert.equal(p.tipo, 'propuesta');
  if (p.tipo !== 'propuesta') {
    return;
  }
  assert.equal(p.texto, '¿Tu ocupación es «dependiente de comercio»?');
  assert.deepEqual(
    p.opciones.map((o) => o.id),
    ['si', 'parecida', 'no'],
  );
  assert.ok(p.alternativas.length <= 2);
  const si = siguientePasoConPropuestas(A, { ...CLARA, respuestas: [{ pregunta: p.id, opcion: 'si' }] });
  assert.equal(si.tipo === 'resultado' && si.motivo, 'confirmada');
  assert.equal(si.tipo === 'resultado' && si.mejor.ocupacion?.esco, '5223.1');
  const conAlternativa = siguientePasoConPropuestas(A, COCINERO);
  const alt = conAlternativa.tipo === 'propuesta' ? conAlternativa.alternativas[0] : undefined;
  assert.ok(alt && conAlternativa.tipo === 'propuesta');
  // Una alternativa elegida se confirma con «Sí / No» y, con el «Sí», vale.
  const eleccion = [{ pregunta: conAlternativa.id, opcion: alt.id }];
  const confirmar = siguientePasoConPropuestas(A, { ...COCINERO, respuestas: eleccion });
  assert.ok(confirmar.tipo === 'propuesta' && confirmar.propuesta.grupo === alt.hipotesis.grupo);
  assert.equal(confirmar.tipo === 'propuesta' && confirmar.alternativas.length, 0);
  const otra = siguientePasoConPropuestas(A, {
    ...COCINERO,
    respuestas: [...eleccion, { pregunta: confirmar.tipo === 'propuesta' ? confirmar.id : '', opcion: 'si' }],
  });
  assert.equal(otra.tipo === 'resultado' && otra.mejor.grupo, alt.hipotesis.grupo);
  const ca = siguientePasoConPropuestas(A, { ...CLARA, idioma: 'ca' });
  assert.equal(ca.tipo === 'propuesta' && ca.opciones[0]?.texto, 'Sí, és aquesta');
});

test('propuestas: tras el «No» a todas, «No encuentro la mía» sin volver a proponer lo rechazado', () => {
  const respuestas: Respuesta[] = [];
  let paso = siguientePasoConPropuestas(A, DUDOSA);
  const propuestos: string[] = [];
  for (let i = 0; paso.tipo !== 'resultado' && i < MAX_PASOS; i++) {
    if (paso.tipo === 'propuesta') {
      propuestos.push(paso.propuesta.grupo);
      respuestas.push({ pregunta: paso.id, opcion: 'no' });
    } else {
      respuestas.push({ pregunta: paso.pregunta.id, opcion: NO_LO_SE });
    }
    paso = siguientePasoConPropuestas(A, { ...DUDOSA, respuestas });
  }
  assert.equal(paso.tipo, 'resultado');
  assert.equal(paso.tipo === 'resultado' && paso.motivo, 'no_encontrada');
  const rechazos = paso.tipo === 'resultado' ? (paso.rechazos ?? 0) : 0;
  assert.ok(rechazos >= 2 && rechazos <= CONFIGURACION.maxPropuestas, String(rechazos));
  assert.equal(new Set(propuestos).size, rechazos, 'no vuelve a proponer lo rechazado');
  // La última lista va después del tope, en doce tandas como mucho.
  const tandas = 12;
  assert.ok(respuestas.filter((r) => r.pregunta.endsWith(':ultima')).length <= tandas);
  assert.ok(paso.tipo === 'resultado' && paso.preguntasHechas <= TOPE + tandas);
});

const PREVIA_2423 = 0.5;
const PREVIA_2422 = 0.3;
const PREVIA_FONDO = 0.2;
const TOLERANCIA = 1e-12;
test('previa explícita: el motor la usa tal cual, reparte el fondo e ignora las pistas', () => {
  const previa = {
    grupos: [
      { isco08: '2423', p: PREVIA_2423 },
      { isco08: '2422', p: PREVIA_2422 },
    ],
    fondo: PREVIA_FONDO,
  };
  const entrada: Entrada = { ...DUDOSA, previa, pistas: [{ sector: 'publico', grupos: ['2422'] }] };
  const p = distribucionInicial(A, entrada, CONFIGURACION);
  assert.ok(Math.abs((p.get('2423') ?? 0) - PREVIA_2423) < TOLERANCIA);
  assert.ok(Math.abs((p.get('2422') ?? 0) - PREVIA_2422) < TOLERANCIA);
  const fondo = [...p].filter(([g]) => g !== '2423' && g !== '2422').reduce((s, [, x]) => s + x, 0);
  assert.ok(Math.abs(fondo - PREVIA_FONDO) < TOLERANCIA);
  const paso = siguientePasoConPropuestas(A, entrada);
  const conf = paso.tipo === 'pregunta' ? paso.provisional.find((h) => h.grupo === '2423')?.confianza : -1;
  assert.equal(conf, PREVIA_2423);
});

test('puntos negativos no se recortan; los rechazos previos son blandos; la configuración de la entrada manda', () => {
  const negativos: Entrada = {
    ...DUDOSA,
    candidatas: [
      { isco08: '2423', puntos: -1 },
      { isco08: '2422', puntos: -20 },
    ],
  };
  const p = distribucionInicial(A, negativos, CONFIGURACION);
  assert.ok((p.get('2423') ?? 0) > (p.get('2422') ?? 0));
  const r = distribucionInicial(A, { ...DUDOSA, rechazados: ['2423'] }, CONFIGURACION);
  assert.ok((r.get('2423') ?? 0) > 0 && (r.get('2423') ?? 0) < (r.get('3117') ?? 0));
  assert.equal(
    configuracionDe({ ...DUDOSA, configuracion: { umbralProponer: PREVIA_2423 } }).umbralProponer,
    PREVIA_2423,
  );
});

const MUY_SEGURA = 0.98;
const SEGUNDA = 0.01;
test('un «No» a una propuesta muy segura le quita la cabeza: el rechazado no sigue mandando', () => {
  // Con el 3 % de lo que tenía, un rechazado al 98 % seguía primero con un 60 %: las preguntas volvían sobre él y el
  // motor se rendía.
  const previa = {
    grupos: [
      { isco08: '2423', p: MUY_SEGURA },
      { isco08: '2422', p: SEGUNDA },
    ],
    fondo: 1 - MUY_SEGURA - SEGUNDA,
  };
  const p = distribucionInicial(A, { ...DUDOSA, previa, rechazados: ['2423'] }, CONFIGURACION);
  assert.ok((p.get('2423') ?? 0) > 0, 'el rechazo sigue siendo blando');
  assert.ok((p.get('2423') ?? 0) < (p.get('2422') ?? 0), 'la segunda pasa delante');
});

const PRIMERA_SEGURA = 0.95;
const SEGUNDA_DEL_TEXTO = 0.01;
const MAYORIA = 0.5;
test('ejemplo: tras un «No» a una 1.ª al 95 %, la 2.ª del texto pasa por delante del fondo; sin «No», nada cambia', () => {
  // Con vectores la previa es muy aguda: sin templarla, en este ejemplo la 2.ª del texto quedaba tras el «No» con
  // un 20 %
  // frente al 80 % del fondo (los oficios más frecuentes), y las preguntas se iban a comercio o limpieza. Es lo
  // esperado
  // en este ejemplo, no una regla: el fondo es la posibilidad de que ninguna candidata sea la buena, y la prueba
  // siguiente comprueba que se puede salir de ellas.
  const previa = {
    grupos: [
      { isco08: '2423', p: PRIMERA_SEGURA },
      { isco08: '2422', p: SEGUNDA_DEL_TEXTO },
    ],
    fondo: 1 - PRIMERA_SEGURA - SEGUNDA_DEL_TEXTO,
  };
  const sinNo = distribucionInicial(A, { ...DUDOSA, previa }, CONFIGURACION);
  assert.ok(Math.abs((sinNo.get('2423') ?? 0) - PRIMERA_SEGURA) < TOLERANCIA, 'sin «No», la previa tal cual');
  const conNo = distribucionInicial(A, { ...DUDOSA, previa, rechazados: ['2423'] }, CONFIGURACION);
  assert.ok((conNo.get('2422') ?? 0) > MAYORIA, String(conNo.get('2422')));
});

/** Contesta como una persona del grupo `g`: «Sí» solo a su grupo; en cada pregunta, la opción más probable para él. */
function contestarComo(g: string, paso: Paso): Respuesta {
  if (paso.tipo === 'propuesta') {
    return { pregunta: paso.id, opcion: paso.propuesta.grupo === g ? 'si' : 'no' };
  }
  const p = pregunta(paso);
  if (p.tipo === 'ocupacion') {
    return { pregunta: p.id, opcion: String(p.opciones[0]?.id ?? NO_LO_SE) };
  }
  const reparto = reconstruir(A, p.id)?.reparto(g);
  const valores = reconstruir(A, p.id)?.valores ?? [];
  const i = reparto ? reparto.indexOf(Math.max(...reparto)) : -1;
  return { pregunta: p.id, opcion: valores[i] ?? NO_LO_SE };
}

test('si la ocupación correcta no estaba entre las candidatas del texto, tras el «No» sigue siendo alcanzable', () => {
  // El fondo es la posibilidad de que ninguna candidata del buscador sea la buena (hipótesis de fondo): el
  // temple tras el «No» no puede cerrar esa salida. La persona es dependienta (5223), fuera de las dos candidatas.
  const previa = {
    grupos: [
      { isco08: '2423', p: PRIMERA_SEGURA },
      { isco08: '2422', p: SEGUNDA_DEL_TEXTO },
    ],
    fondo: 1 - PRIMERA_SEGURA - SEGUNDA_DEL_TEXTO,
  };
  const entrada: Entrada = { ...DUDOSA, previa };
  const respuestas: Respuesta[] = [];
  let paso = siguientePasoConPropuestas(A, entrada);
  for (let i = 0; paso.tipo !== 'resultado' && i < MAX_PASOS; i++) {
    respuestas.push(contestarComo('5223', paso));
    paso = siguientePasoConPropuestas(A, { ...entrada, respuestas });
  }
  assert.equal(
    paso.tipo === 'resultado' && paso.mejor.grupo,
    '5223',
    respuestas.map((r) => `${r.pregunta}=${r.opcion}`).join(' · '),
  );
});

test('las preguntas de la clasificación ofrecen todas las ramas con probabilidad, no solo 3', () => {
  // Con 3, una previa equivocada dejaba fuera la rama de la persona: 3 de cada 4 respuestas eran «Otra cosa».
  const e = preguntaDeJerarquia('nivel1', distribucionInicial(A, DUDOSA, CONFIGURACION));
  assert.ok(e && e.valores.filter((v) => v !== 'otra').length > OPCIONES_POR_PREGUNTA, e?.id ?? 'sin pregunta');
});

// ---------- Casos de regresión del banco de desarrollo: entradas fijas del léxico ----------

const COCINERO: Entrada = {
  idioma: 'es',
  respuestas: [],
  texto: 'cocinero',
  candidatas: [
    { esco: '5120.1', isco08: '5120', puntos: 110, titulo: 'cocinero/cocinera' },
    {
      esco: '5120.2',
      isco08: '5120',
      puntos: 110,
      titulo: 'cocinero especializado en parrilla/cocinera especializada en parrilla',
    },
    { esco: '3434.1', isco08: '3434', puntos: 100, titulo: 'chef' },
    { esco: '9412.1', isco08: '9412', puntos: 70, titulo: 'ayudante de cocina' },
  ],
};
const POLICIA: Entrada = {
  idioma: 'es',
  respuestas: [],
  texto: 'policia',
  candidatas: [
    { esco: '5412.1', isco08: '5412', puntos: 110, titulo: 'agente de policía' },
    { esco: '3355.1', isco08: '3355', puntos: 110, titulo: 'inspector de policía/inspectora de policía' },
    {
      esco: '2330.9',
      isco08: '2330',
      puntos: 30,
      titulo: 'profesor de educación secundaria/profesora de educación secundaria',
    },
  ],
};
const MAESTRA: Entrada = {
  idioma: 'es',
  respuestas: [],
  texto: 'maestra',
  candidatas: [
    {
      esco: '2342.1',
      isco08: '2342',
      puntos: 66.4,
      titulo: 'maestro de educación infantil/maestra de educación infantil',
    },
    {
      esco: '2341.1',
      isco08: '2341',
      puntos: 66,
      titulo: 'maestro de educación primaria/maestra de educación primaria',
    },
    {
      esco: '2352.1',
      isco08: '2352',
      puntos: 60,
      titulo: 'maestro de educación especial/maestra de educación especial',
    },
  ],
};

test('«cocinero» (pr09): propone directamente, con alternativas de otros grupos', () => {
  const p = siguientePasoConPropuestas(A, COCINERO);
  assert.equal(p.tipo, 'propuesta');
  if (p.tipo !== 'propuesta') {
    return;
  }
  assert.equal(p.propuesta.grupo, '5120');
  assert.equal(p.texto, '¿Tu ocupación es «cocinero»?');
  assert.ok(p.alternativas.some((a) => a.hipotesis.grupo === '3434'));
});

test('«policia» (pr10): nunca opciones residuales de otro ámbito', () => {
  const p = siguientePasoConPropuestas(A, POLICIA);
  const textos: string[] = [];
  if (p.tipo === 'pregunta') {
    textos.push(...p.pregunta.opciones.map((o) => o.texto));
  } else if (p.tipo === 'propuesta') {
    textos.push(p.texto, ...p.alternativas.map((a) => a.texto));
  }
  assert.ok(textos.length > 0);
  assert.ok(
    textos.every((t) => !/profesor|clase|debate/i.test(t)),
    textos.join(' | '),
  );
});

test('«maestra» (pr04-05): títulos de puesto en femenino, sin «/», y elegir uno pide «Sí / No» con esa ocupación', () => {
  const p = siguientePasoConPropuestas(A, MAESTRA);
  assert.equal(p.tipo, 'pregunta');
  if (p.tipo !== 'pregunta') {
    return;
  }
  assert.equal(p.pregunta.tipo, 'grupo');
  const textos = p.pregunta.opciones.map((o) => o.texto);
  assert.ok(textos.includes('Maestra de educación primaria'), textos.join(' | '));
  assert.ok(textos.every((t) => !t.includes('/')));
  // Confirmar siempre: la elección se confirma con «Sí / No», sin alternativas.
  const eleccion = [{ pregunta: p.pregunta.id, opcion: '2341' }];
  const confirmar = siguientePasoConPropuestas(A, { ...MAESTRA, respuestas: eleccion });
  assert.ok(
    confirmar.tipo === 'propuesta' && confirmar.propuesta.grupo === '2341' && confirmar.alternativas.length === 0,
  );
  const fin = siguientePasoConPropuestas(A, {
    ...MAESTRA,
    respuestas: [...eleccion, { pregunta: confirmar.tipo === 'propuesta' ? confirmar.id : '', opcion: 'si' }],
  });
  assert.equal(fin.tipo === 'resultado' && fin.motivo, 'confirmada');
  assert.equal(fin.tipo === 'resultado' && fin.mejor.grupo, '2341');
});

test('«recursos humanos» (pr01-02): con un área, «¿Qué haces sobre todo en recursos humanos?»', () => {
  const entrada: Entrada = {
    idioma: 'es',
    respuestas: [],
    texto: 'recursos humanos',
    candidatas: [
      { esco: '2423.3', isco08: '2423', puntos: 87.3, titulo: 'responsable de recursos humanos' },
      { esco: '4416.1', isco08: '4416', puntos: 85.6, titulo: 'ayudante de recursos humanos' },
    ],
    area: {
      nombre: 'recursos humanos',
      ocupaciones: [
        { esco: '4313.1', isco08: '4313', titulo: 'administrativo de nóminas/administrativa de nóminas' },
        {
          esco: '2423.6',
          isco08: '2423',
          titulo: 'consultor de selección de personal/consultora de selección de personal',
        },
        { esco: '1212.2', isco08: '1212', titulo: 'director de recursos humanos/directora de recursos humanos' },
      ],
    },
  };
  const p = siguientePasoConPropuestas(A, entrada);
  assert.equal(p.tipo === 'pregunta' && p.pregunta.texto, '¿Qué haces sobre todo en recursos humanos?');
  const ids = p.tipo === 'pregunta' ? p.pregunta.opciones.map((o) => o.id) : [];
  assert.deepEqual(ids, ['4313', '2423', '1212', 'otra', NO_LO_SE]);
  const id = p.tipo === 'pregunta' ? p.pregunta.id : '';
  // La confirmación lleva la misma ocupación con que se nombró la opción, y el «Sí» la da por buena.
  const eleccion = [{ pregunta: id, opcion: '4313' }];
  const confirmar = siguientePasoConPropuestas(A, { ...entrada, respuestas: eleccion });
  assert.ok(confirmar.tipo === 'propuesta' && confirmar.propuesta.ocupacion?.esco === '4313.1');
  const nominas = siguientePasoConPropuestas(A, {
    ...entrada,
    respuestas: [...eleccion, { pregunta: confirmar.tipo === 'propuesta' ? confirmar.id : '', opcion: 'si' }],
  });
  assert.equal(nominas.tipo === 'resultado' && nominas.mejor.ocupacion?.esco, '4313.1');
});

test('una previa nueva a mitad de conversación conserva las respuestas y no repite preguntas', () => {
  const p1 = siguientePasoConPropuestas(A, DUDOSA);
  assert.equal(p1.tipo, 'pregunta');
  const id = p1.tipo === 'pregunta' ? p1.pregunta.id : '';
  const respuestas = [{ pregunta: id, opcion: NO_LO_SE }];
  const nueva: Entrada = {
    ...DUDOSA,
    candidatas: [...DUDOSA.candidatas, { esco: '4110.1', isco08: '4110', puntos: 60 }],
    respuestas,
  };
  const p2 = siguientePasoConPropuestas(A, nueva);
  assert.ok(p2.tipo !== 'pregunta' || p2.pregunta.id !== id);
  assert.ok(p2.tipo !== 'pregunta' || p2.numero === 2);
});
