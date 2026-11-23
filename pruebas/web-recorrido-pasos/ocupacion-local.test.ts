// El paso de ocupación del chatbot con el motor del dispositivo (ocupacion-local.js): las preguntas del
// motor son mensajes de Faro con respuestas rápidas debajo y sus propuestas, tarjetas que se eligen dentro del mensaje,
// con «Continuar» y sus salidas; cada respuesta se le manda (la misma que darían los botones), lo que decide
// entra en la máquina de la ocupación y la cortesía no gasta el recorrido. El motor es un doble (motor-local-doble.ts)
// que responde lo preparado.
import './aislar.ts';
import assert from 'node:assert/strict';
import { beforeEach, type TestContext, test } from 'node:test';
import { cargarDiccionario } from '../../web/idiomas/cargar.js';
import { PaqueteSinRespuesta } from '../../web/scripts/paquete-sin-conexion.js';
import { ERROR_MOTOR_QUE_NO_COINCIDE, ErrorFaro } from '../../web/scripts/recorrido/api/errores.js';
import { estado, reiniciarEstado } from '../../web/scripts/recorrido/estado.js';
import { resolver, traducible } from '../../web/scripts/textos.js';
import { ficha } from '../web-recorrido-modelo/datos.ts';
import { configurarApi } from './api-doble.ts';
import { buscar, Nodo, pagina, prepararDom } from './dom.ts';
import { enviar, observadas, reiniciarInterfaz } from './interfaz-doble.ts';
import { enviados, MotorNoListo, prepararPasos } from './motor-local-doble.ts';

// Como el código real, el doble de ocupacion-local.js se importa después de aislar.ts: así sus importaciones ya pasan
// por los dobles (el motor del dispositivo es motor-local-doble.ts).
const { hayPeticionEnCurso, soltarEspera } = await import('../../web/scripts/recorrido/pagina.js');
const { empezarConversacion, volverEnOcupacion } = await import('../../web/scripts/recorrido/paso-ocupacion.js');
await cargarDiccionario('es');

const avanzar = () => new Promise<void>((resolve) => setImmediate(resolve));
const LECTURA = { sinComprension: false };
const OPCIONES = [
  { id: 'si', texto: 'Sí' },
  { id: 'no', texto: 'No' },
  { id: 'no_lo_se', texto: 'No lo sé' },
];
const pregunta = (id: string, texto: string, tipo = 'tarea') => ({
  lectura: LECTURA,
  paso: { tipo: 'pregunta', pregunta: { id, tipo, texto, opciones: OPCIONES }, numero: 1, maximo: 14 },
});
const SIRVES = pregunta('tarea:5131-1', '¿Sirves comidas y bebidas a la clientela?');
const COBRAS = pregunta('tarea:5131-2', '¿Cobras las cuentas?');
const PROPUESTA = {
  lectura: LECTURA,
  paso: {
    tipo: 'propuesta',
    id: 'propuesta:5131:5131.1',
    mejor: {
      grupo: '5131',
      tituloGrupo: { es: 'Camareros' },
      ocupacion: { esco: '5131.1', titulo: { es: 'camarero' } },
    },
    opciones: [
      { id: 'si', texto: 'Sí, es esta' },
      { id: 'no', texto: 'No' },
    ],
    alternativas: [
      {
        id: 'alt:5132:5132.1',
        hipotesis: {
          grupo: '5132',
          tituloGrupo: { es: 'Bármanes' },
          ocupacion: { esco: '5132.1', titulo: { es: 'barman' } },
        },
      },
    ],
    numero: 1,
    maximo: 4,
  },
};
const NINGUNA_BUSCAR = resolver(traducible('recorrido.ocupacion.ninguna-buscar'));
const VOLVER = resolver(traducible('recorrido.volver'));
const LO_CUENTO = resolver(traducible('recorrido.local.lo-cuento.boton'));

/** Los rótulos de las respuestas rápidas que se ven. */
const rotulos = () => observadas.sugerencias.map((sugerencia) => resolver(sugerencia.texto));
/** La respuesta rápida con ese rótulo. */
const sugerencia = (rotulo: string) => observadas.sugerencias.find((s) => resolver(s.texto) === rotulo);
/** Pulsa la respuesta rápida con ese rótulo, como en conversacion.js, y deja que el paso siga. */
const pulsar = async (rotulo: string) => {
  const accion = sugerencia(rotulo)?.accion;
  assert.ok(accion, `No hay una respuesta rápida «${rotulo}»: ${rotulos().join(' · ')}`);
  accion();
  await avanzar();
};
/** Los párrafos de texto que ha dicho Faro; los nodos (la ficha de la propuesta) se miran aparte. */
const dicho = () => observadas.mensajes.map((parte) => resolver(parte));
/** Un nodo de los mensajes de Faro, lo justo para buscar y pulsar las tarjetas y los botones de la propuesta. */
interface NodoVisto {
  className: string;
  classList: { contains(clase: string): boolean };
  children: ArrayLike<NodoVisto>;
  textContent: string | null;
  hidden: boolean;
  checked: boolean;
  disabled: boolean;
  type: string;
  value: string;
  getAttribute(nombre: string): string | null;
  dispatchEvent(evento: Event): boolean;
}
/** Los nodos de los mensajes de Faro con esa clase, en orden, buscando dentro de cada uno. */
const conClase = (clase: string): NodoVisto[] => {
  const hallados: NodoVisto[] = [];
  const recorrer = (nodo: NodoVisto) => {
    if (nodo.classList.contains(clase)) {
      hallados.push(nodo);
    }
    for (const hijo of Array.from(nodo.children)) {
      recorrer(hijo);
    }
  };
  for (const nodo of observadas.nodos as unknown as NodoVisto[]) {
    recorrer(nodo);
  }
  return hallados;
};
/** Las tarjetas de la propuesta (sus etiquetas) y sus casillas. */
const tarjetas = () => conClase('rc-eleccion-opcion');
const casillas = () => conClase('rc-eleccion-casilla');
/** La tarjeta con ese rótulo. */
const tarjeta = (rotulo: string) => tarjetas().find((nodo) => (nodo.textContent ?? '').includes(rotulo));
/** El botón de la propuesta con ese rótulo (Continuar, las salidas o las de «Ninguna es la mía»). */
const boton = (rotulo: string) =>
  [...conClase('rc-boton-principal'), ...conClase('rc-eleccion-enlace'), ...conClase('rc-eleccion-salida')].find(
    (nodo) => (nodo.textContent ?? '').trim() === rotulo,
  );
/** Pulsa el botón de la propuesta con ese rótulo y deja que el paso siga. */
const pulsarBoton = async (rotulo: string) => {
  const elBoton = boton(rotulo);
  assert.ok(elBoton, `La propuesta no tiene el botón «${rotulo}»`);
  elBoton.dispatchEvent(new Event('click'));
  await avanzar();
};
/** Elige la tarjeta con ese rótulo, como hace el navegador con las casillas de un mismo grupo. */
const elegir = (rotulo: string) => {
  const laTarjeta = tarjeta(rotulo);
  assert.ok(laTarjeta, `La propuesta no tiene la tarjeta «${rotulo}»`);
  for (const casilla of casillas()) {
    casilla.checked = tarjetas().indexOf(laTarjeta) === casillas().indexOf(casilla);
  }
};
const CONTINUAR = resolver(traducible('recorrido.continuar'));
const NINGUNA = resolver(traducible('recorrido.ocupacion.ninguna'));
const MAS_PREGUNTAS = resolver(traducible('recorrido.ocupacion.mas-preguntas'));
const CONTAR = resolver(traducible('recorrido.ocupacion.contar'));
const BUSCAR = resolver(traducible('recorrido.ocupacion.buscar'));
const PARECIDA = resolver(traducible('recorrido.ocupacion.parecida', { titulo: 'Camarero/a' }));
/** La propuesta con «Se parece, pero no», como la hace el motor cuando propone una ocupación de ESCO. */
const PROPUESTA_CON_PARECIDA = {
  ...PROPUESTA,
  paso: {
    ...PROPUESTA.paso,
    mejor: { ...PROPUESTA.paso.mejor, ocupacion: { esco: '5131.1', titulo: { es: 'camarero/camarera' } } },
    opciones: [
      { id: 'si', texto: 'Sí, es esta' },
      { id: 'parecida', texto: 'Se parece, pero no' },
      { id: 'no', texto: 'No' },
    ],
  },
};

beforeEach(() => {
  prepararDom();
  soltarEspera();
  reiniciarEstado();
  reiniciarInterfaz();
});

test('la pregunta del motor sale en el chat con sus opciones, cada respuesta se le manda y «Volver» la deshace', async () => {
  prepararPasos(SIRVES, COBRAS, SIRVES);
  empezarConversacion();
  await enviar('camarero');
  assert.equal(enviados[0]?.cuerpo.texto, 'camarero');
  assert.ok(dicho().includes('¿Sirves comidas y bebidas a la clientela?'));
  // En el orden de la escala, como en la pantalla v2, y «Lo cuento con mis palabras». Sin respuestas que deshacer no
  // hay «Volver», y una pregunta sobre tareas no ofrece buscar en la clasificación.
  assert.deepEqual(rotulos(), ['Sí', 'No lo sé', 'No', LO_CUENTO]);
  assert.equal(sugerencia('No lo sé')?.clase, 'rc-sugerencia-secundaria');
  // Las preguntas van en la conversación: la tarjeta del paso queda oculta y, como toca elegir, la barra de escribir.
  assert.equal(buscar('tarjeta-ocupacion').hidden, true);
  assert.equal(observadas.compositorVisible, false);
  await pulsar('Sí');
  assert.deepEqual(enviados[1]?.cuerpo.respuestas, [{ pregunta: 'tarea:5131-1', opcion: 'si' }]);
  assert.ok(dicho().includes('¿Cobras las cuentas?'));
  assert.deepEqual(rotulos(), ['Sí', 'No lo sé', 'No', LO_CUENTO, VOLVER]);
  volverEnOcupacion();
  await avanzar();
  assert.deepEqual(enviados[2]?.cuerpo.respuestas, []);
});

const SIN_DATOS = resolver(traducible('recorrido.error.sin-datos'));
const REINTENTAR = resolver(traducible('recorrido.reintentar'));
/** Los intentos del paso mientras el motor se prepara (ocupacion-local.js, MAX_INTENTOS) y su espera entre uno y otro. */
const INTENTOS = 60;
const MS_ENTRE_INTENTOS = 3000;

test('si el service worker deja de contestar, Faro dice que no ha podido preparar los datos y «Volver a intentarlo» sigue', async () => {
  prepararPasos(new MotorNoListo('sin respuesta', { cause: new PaqueteSinRespuesta('callado') }), SIRVES);
  empezarConversacion();
  await enviar('camarero');
  await avanzar();
  assert.equal(enviados.length, 1, 'no se reintenta solo: la persona decide');
  assert.ok(dicho().includes(SIN_DATOS), `Faro lo dice: ${dicho()}`);
  assert.equal(hayPeticionEnCurso(), false, 'el pensamiento se recoge: nada se queda esperando');
  assert.ok(rotulos().includes(REINTENTAR), `Faro ofrece volver a intentarlo: ${rotulos()}`);
  await pulsar(REINTENTAR);
  assert.equal(enviados.length, 2);
  assert.ok(dicho().includes('¿Sirves comidas y bebidas a la clientela?'));
});

test('si el motor no se prepara en sus 60 intentos, Faro lo dice y ofrece volver a intentarlo', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  // La barra de la preparación (preparacion.js) escribe su avance en el estilo del nodo, que el DOM de prueba no tiene.
  Object.defineProperty(Nodo.prototype, 'style', { configurable: true, get: () => ({ setProperty() {} }) });
  t.after(() => Reflect.deleteProperty(Nodo.prototype, 'style'));
  prepararPasos(...Array.from({ length: INTENTOS }, () => new MotorNoListo('cargando')));
  empezarConversacion();
  // El envío espera al paso entero, y el paso, a los temporizadores falsos que mueve la prueba.
  const enviado = enviar('camarero');
  for (let intento = 1; intento < INTENTOS; intento += 1) {
    await avanzar();
    t.mock.timers.tick(MS_ENTRE_INTENTOS);
  }
  await enviado;
  await avanzar();
  assert.equal(enviados.length, INTENTOS);
  assert.ok(dicho().includes(SIN_DATOS), `Faro lo dice: ${dicho()}`);
  assert.equal(hayPeticionEnCurso(), false);
  assert.ok(rotulos().includes(REINTENTAR));
});

const NO_COINCIDE = resolver(traducible(ERROR_MOTOR_QUE_NO_COINCIDE));
const BUSCAR_EN_LA_CLASIFICACION = resolver(traducible('recorrido.explorar.buscar'));
const REPARAR = resolver(traducible('recorrido.reparar'));
/** Lo que anota la navegación cuando la reparación recarga la página (recorrido/reparar.js). */
const RECARGA = 'recargar';

/** Anota las páginas a las que se navega en esta pestaña (location.assign y reload) mientras dura la prueba. */
function seguirLaNavegacion(t: TestContext): string[] {
  const destinos: string[] = [];
  Object.defineProperty(pagina, 'baseURI', { configurable: true, value: 'https://faro.example/recorrido.html' });
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: { assign: (destino: string) => destinos.push(destino), reload: () => destinos.push(RECARGA) },
  });
  t.after(() => {
    Reflect.deleteProperty(pagina, 'baseURI');
    Reflect.deleteProperty(globalThis, 'location');
  });
  return destinos;
}

/**
 * Tras el aviso de la copia guardada que no coincide solo queda «Reparar Faro», que repara la copia y recarga la página
 * (recorrido/reparar.js; aquí no hay service worker ni CacheStorage que borrar).
 */
async function soloQuedaReparar(destinos: string[]) {
  assert.deepEqual(rotulos(), [REPARAR], 'ni volver a intentarlo ni la clasificación oficial, que usa el motor');
  await pulsar(REPARAR);
  await avanzar();
  assert.deepEqual(destinos, [RECARGA]);
}

test('si el motor no es el de esta versión, Faro lo dice en el acto y no reintenta ni ofrece reintentar', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const destinos = seguirLaNavegacion(t);
  Object.defineProperty(Nodo.prototype, 'style', { configurable: true, get: () => ({ setProperty() {} }) });
  t.after(() => Reflect.deleteProperty(Nodo.prototype, 'style'));
  // Lo que lanza motor.js cuando el cliente del motor cuenta MotorQueNoCoincide: tras un intento de paso, el fallo.
  prepararPasos(
    new MotorNoListo('cargando'),
    new ErrorFaro(traducible(ERROR_MOTOR_QUE_NO_COINCIDE), 0, {}),
    SIRVES,
    SIRVES,
  );
  empezarConversacion();
  const enviado = enviar('camarero');
  await avanzar();
  t.mock.timers.tick(MS_ENTRE_INTENTOS);
  await enviado;
  await avanzar();
  assert.equal(enviados.length, 2, 'un reintento mientras se preparaba y ninguno tras el fallo que no es de paso');
  assert.ok(dicho().includes(NO_COINCIDE), `Faro lo dice: ${dicho()}`);
  assert.ok(!dicho().includes(SIN_DATOS));
  assert.equal(hayPeticionEnCurso(), false, 'nada se queda esperando');
  assert.ok(!rotulos().includes(REINTENTAR), `no ofrece volver a intentarlo: ${rotulos()}`);
  assert.ok(!rotulos().includes(BUSCAR_EN_LA_CLASIFICACION), `no ofrece la clasificación oficial: ${rotulos()}`);
  for (let espera = 0; espera < INTENTOS; espera += 1) {
    t.mock.timers.tick(MS_ENTRE_INTENTOS);
    await avanzar();
  }
  assert.equal(enviados.length, 2, 'tampoco reintenta más tarde');
  await soloQuedaReparar(destinos);
});

test('si el motor no es el de esta versión al abrir la clasificación oficial, no ofrece volver a intentarlo', async (t) => {
  const destinos = seguirLaNavegacion(t);
  let pedidos = 0;
  configurarApi({
    gruposHijos: async () => {
      pedidos += 1;
      throw new ErrorFaro(traducible(ERROR_MOTOR_QUE_NO_COINCIDE), 0, {});
    },
  });
  prepararPasos(PROPUESTA);
  empezarConversacion();
  await enviar('camarero');
  await pulsarBoton(BUSCAR);
  await avanzar();
  assert.equal(pedidos, 1);
  assert.ok(dicho().includes(NO_COINCIDE), `Faro lo dice: ${dicho()}`);
  assert.equal(hayPeticionEnCurso(), false, 'nada se queda esperando');
  await soloQuedaReparar(destinos);
  assert.equal(pedidos, 1, 'no se vuelve a pedir');
});

test('una pregunta con trabajos por opciones ofrece buscar en la clasificación oficial', async () => {
  prepararPasos(pregunta('grupo:51', '¿Cuál se parece más a lo que haces?', 'grupo'));
  empezarConversacion();
  await enviar('camarero');
  assert.deepEqual(rotulos(), ['Sí', 'No lo sé', 'No', LO_CUENTO, NINGUNA_BUSCAR]);
  assert.equal(sugerencia(NINGUNA_BUSCAR)?.clase, 'rc-sugerencia-secundaria');
});

test('la propuesta enseña la más parecida y las alternativas como tarjetas iguales, con la más parecida elegida', async () => {
  prepararPasos(PROPUESTA);
  empezarConversacion();
  await enviar('camarero');
  assert.ok(dicho().includes(resolver(traducible('recorrido.ocupacion.propuesta-varias'))));
  assert.equal(tarjetas().length, 2);
  // La más parecida, con su marca, su tipo de trabajo oficial y su código; la alternativa, con el mismo aspecto.
  const camarero = tarjeta('Camarero');
  assert.ok(camarero, 'La más parecida no sale como tarjeta');
  assert.match(camarero.textContent ?? '', /La más parecida/);
  assert.match(camarero.textContent ?? '', /Camareros \(CIUO-08 5131\)/);
  assert.match(camarero.textContent ?? '', /ESCO 5131\.1/);
  assert.ok(tarjeta('Barman'), 'La alternativa «Barman» no sale como tarjeta');
  // Casillas de un mismo grupo, con la más parecida elegida y el foco en ella.
  const [principal, alternativa] = casillas();
  assert.equal(principal?.type, 'radio');
  assert.equal(principal?.checked, true);
  assert.equal(alternativa?.checked, false);
  assert.equal(principal?.getAttribute('name'), alternativa?.getAttribute('name'));
  assert.ok(conClase('rc-eleccion')[0], 'Las tarjetas no van en un grupo con su leyenda');
  // Las respuestas rápidas no repiten las opciones: solo «Volver», si hubiera algo que deshacer.
  assert.deepEqual(rotulos(), []);
  // Sin «Se parece, pero no» en las opciones del motor, no se ofrece.
  assert.equal(boton(PARECIDA), undefined);
});

test('una propuesta hecha sin la búsqueda por significado o sin el clasificador lo dice en la conversación', async () => {
  const nota = resolver(traducible('recorrido.local.comparacion-reducida'));
  for (const [lectura, conNota] of [
    [{ sinComprension: false, conVectores: false, conClasificador: true }, true],
    [{ sinComprension: false, conVectores: true, conClasificador: false }, true],
    [{ sinComprension: false, conVectores: true, conClasificador: true }, false],
    [LECTURA, false],
  ] as const) {
    prepararDom();
    soltarEspera();
    reiniciarEstado();
    reiniciarInterfaz();
    prepararPasos({ ...PROPUESTA, lectura });
    empezarConversacion();
    await enviar('camarero');
    assert.equal(dicho().includes(nota), conNota, JSON.stringify(lectura));
  }
});

test('«Continuar» con la más parecida se le manda al motor como «Sí» y deja las tarjetas retiradas', async () => {
  prepararPasos(PROPUESTA, SIRVES);
  empezarConversacion();
  await enviar('camarero');
  await pulsarBoton(CONTINUAR);
  assert.deepEqual(enviados[1]?.cuerpo.respuestas, [{ pregunta: 'propuesta:5131:5131.1', opcion: 'si' }]);
  assert.ok(casillas().every((casilla) => casilla.disabled));
  assert.equal(casillas()[0]?.checked, true);
});

test('elegir una alternativa y pulsar «Continuar» se le manda al motor como respuesta a la propuesta', async () => {
  prepararPasos(PROPUESTA, SIRVES);
  empezarConversacion();
  await enviar('camarero');
  elegir('Barman');
  await pulsarBoton(CONTINUAR);
  assert.deepEqual(enviados[1]?.cuerpo.respuestas, [{ pregunta: 'propuesta:5131:5131.1', opcion: 'alt:5132:5132.1' }]);
});

test('«Se parece, pero no es exactamente esa» se le manda al motor como «parecida»', async () => {
  prepararPasos(PROPUESTA_CON_PARECIDA, SIRVES);
  empezarConversacion();
  await enviar('camarero');
  await pulsarBoton(PARECIDA);
  assert.deepEqual(enviados[1]?.cuerpo.respuestas, [{ pregunta: 'propuesta:5131:5131.1', opcion: 'parecida' }]);
});

test('«Ninguna es la mía» abre sus salidas; «Hazme más preguntas» se le manda al motor como «No»', async () => {
  prepararPasos(PROPUESTA, SIRVES);
  empezarConversacion();
  await enviar('camarero');
  const ninguna = boton(NINGUNA);
  assert.equal(ninguna?.getAttribute('aria-expanded'), 'false');
  assert.equal(conClase('rc-eleccion-ninguna')[0]?.hidden, true);
  await pulsarBoton(NINGUNA);
  assert.equal(ninguna?.getAttribute('aria-expanded'), 'true');
  assert.equal(conClase('rc-eleccion-ninguna')[0]?.hidden, false);
  await pulsarBoton(MAS_PREGUNTAS);
  assert.deepEqual(enviados[1]?.cuerpo.respuestas, [{ pregunta: 'propuesta:5131:5131.1', opcion: 'no' }]);
  assert.ok(dicho().includes(resolver(traducible('recorrido.ocupacion.ninguna-entendido'))));
  // Ninguna tarjeta queda marcada: la persona no ha elegido ninguna.
  assert.ok(casillas().every((casilla) => casilla.disabled && !casilla.checked));
});

test('«Ninguna es la mía» → «Te lo cuento con mis palabras» abre la barra y lo escrito se suma a lo dicho', async () => {
  prepararPasos(PROPUESTA, SIRVES);
  empezarConversacion();
  await enviar('camarero');
  assert.equal(observadas.compositorVisible, false);
  await pulsarBoton(CONTAR);
  assert.equal(observadas.compositorVisible, true);
  // Las tarjetas siguen valiendo mientras escribe.
  assert.ok(casillas().every((casilla) => !casilla.disabled));
  await enviar('también preparo cócteles');
  assert.equal(enviados[1]?.cuerpo.anadido, 'también preparo cócteles');
  assert.deepEqual(enviados[1]?.cuerpo.respuestas, []);
  assert.ok(casillas().every((casilla) => casilla.disabled));
});

test('«Ninguna es la mía» → «Prefiero buscarla en la clasificación oficial» abre la clasificación', async () => {
  let pedidos = 0;
  configurarApi({
    gruposHijos: async () => {
      pedidos += 1;
      return [];
    },
  });
  prepararPasos(PROPUESTA);
  empezarConversacion();
  await enviar('camarero');
  await pulsarBoton(BUSCAR);
  await avanzar();
  assert.equal(enviados.length, 1);
  assert.equal(pedidos, 1);
  assert.ok(casillas().every((casilla) => casilla.disabled && !casilla.checked));
});

test('en la propuesta que decide la pantalla, «Ninguna es la mía» no ofrece más preguntas', async () => {
  prepararPasos({ ...PROPUESTA, paso: { ...PROPUESTA.paso, local: true } });
  empezarConversacion();
  await enviar('camarero');
  assert.equal(boton(MAS_PREGUNTAS), undefined);
  assert.ok(boton(CONTAR));
  assert.ok(boton(BUSCAR));
});

test('cuando el motor decide, la ocupación queda elegida con su ocupación ESCO y como propuesta de la IA', async () => {
  configurarApi({ fichaDeGrupo: async () => ficha('5131') });
  prepararPasos({ lectura: LECTURA, paso: { tipo: 'decidida', grupo: '5131', esco: '5131.1', soloGrupo: false } });
  empezarConversacion();
  await enviar('camarero');
  await avanzar();
  assert.equal(estado.ocupacion?.isco08, '5131');
  assert.equal(estado.ocupacion?.esco, '5131.1');
  assert.equal(estado.ocupacion?.origen, 'ia');
});

test('un saludo solo recibe respuesta y la persona vuelve a escribir, sin gastar el recorrido', async () => {
  prepararPasos({ lectura: { sinComprension: false, cortesia: ['saludo'] }, paso: { tipo: 'no_encontrada' } });
  empezarConversacion();
  await enviar('hola');
  assert.ok(dicho().includes(resolver(traducible('recorrido.local.cortesia.saludo'))));
  prepararPasos(SIRVES);
  await enviar('camarero');
  assert.equal(enviados[0]?.cuerpo.texto, 'camarero');
  assert.deepEqual(rotulos(), ['Sí', 'No lo sé', 'No', LO_CUENTO]);
});

test('«Lo cuento con mis palabras» abre la barra sin quitar las respuestas, y lo escrito se suma a lo dicho', async () => {
  prepararPasos(SIRVES, COBRAS);
  empezarConversacion();
  await enviar('camarero');
  assert.equal(observadas.compositorVisible, false);
  await pulsar(LO_CUENTO);
  assert.equal(observadas.compositorVisible, true);
  assert.equal(sugerencia(LO_CUENTO)?.conservar, true);
  await enviar('también preparo cócteles');
  assert.equal(enviados[1]?.cuerpo.anadido, 'también preparo cócteles');
  assert.deepEqual(enviados[1]?.cuerpo.respuestas, []);
  assert.ok(dicho().includes(resolver(traducible('recorrido.local.lo-cuento.anadido'))));
  // La pregunta siguiente vuelve a ser para elegir: la barra se esconde otra vez.
  assert.ok(dicho().includes('¿Cobras las cuentas?'));
  assert.equal(observadas.compositorVisible, false);
});

const SIN_CAMBIOS = resolver(traducible('recorrido.local.guiado.sin-cambios'));

for (const caso of [
  { nombre: 'pregunta', paso: SIRVES, contar: () => pulsar(LO_CUENTO) },
  { nombre: 'propuesta', paso: PROPUESTA, contar: () => pulsarBoton(CONTAR) },
]) {
  test(`«Lo cuento» repetido tras una ${caso.nombre} abre la clasificación con su aviso`, async () => {
    let exploraciones = 0;
    configurarApi({
      gruposHijos: async () => {
        exploraciones += 1;
        return [];
      },
    });
    prepararPasos(caso.paso, caso.paso);
    empezarConversacion();
    await enviar('camarero');
    const mensajes = observadas.mensajes.length;
    const fichas = tarjetas().length;
    await caso.contar();
    await enviar('CAMARERO.');
    await avanzar();
    assert.equal(exploraciones, 1);
    assert.ok(dicho().slice(mensajes).includes(SIN_CAMBIOS));
    assert.equal(
      dicho().filter((texto) => texto === SIRVES.paso.pregunta.texto).length,
      caso.nombre === 'pregunta' ? 1 : 0,
    );
    assert.equal(tarjetas().length, fichas, 'no repinta la propuesta');
    assert.deepEqual(enviados[1]?.cuerpo, enviados[0]?.cuerpo, 'lo repetido no pesa dos veces');
  });
}

test('«Lo cuento» que no cambia el paso conserva las respuestas aunque añada palabras nuevas', async () => {
  let exploraciones = 0;
  configurarApi({
    gruposHijos: async () => {
      exploraciones += 1;
      return [];
    },
  });
  prepararPasos(SIRVES, COBRAS, COBRAS);
  empezarConversacion();
  await enviar('camarero');
  await pulsar('No');
  await pulsar(LO_CUENTO);
  await enviar('hola');
  await avanzar();
  assert.equal(exploraciones, 1);
  assert.ok(dicho().includes(SIN_CAMBIOS));
  assert.equal(enviados[2]?.cuerpo.texto, 'camarero. hola');
  assert.deepEqual(enviados[2]?.cuerpo.respuestas, [{ pregunta: SIRVES.paso.pregunta.id, opcion: 'no' }]);
});

test('una pregunta corregida con el mismo id y las mismas opciones sigue en la conversación', async () => {
  const corregida = pregunta(SIRVES.paso.pregunta.id, '¿Sirves también en la terraza?');
  prepararPasos(SIRVES, corregida);
  empezarConversacion();
  await enviar('camarero');
  await pulsar(LO_CUENTO);
  await enviar('también trabajo en la terraza');
  assert.ok(dicho().includes(corregida.paso.pregunta.texto));
  assert.ok(!dicho().includes(SIN_CAMBIOS));
  assert.deepEqual(rotulos(), ['Sí', 'No lo sé', 'No', LO_CUENTO]);
});

test('responder y deshacer no se consideran «Lo cuento» aunque el motor repita el paso', async () => {
  const pasos = [SIRVES, SIRVES, SIRVES];
  prepararPasos(...pasos);
  empezarConversacion();
  await enviar('camarero');
  await pulsar('Sí');
  assert.deepEqual(enviados[1]?.cuerpo.respuestas, [{ pregunta: SIRVES.paso.pregunta.id, opcion: 'si' }]);
  volverEnOcupacion();
  await avanzar();
  assert.deepEqual(enviados[2]?.cuerpo.respuestas, []);
  assert.equal(dicho().filter((texto) => texto === SIRVES.paso.pregunta.texto).length, pasos.length);
  assert.ok(!dicho().includes(SIN_CAMBIOS));
});

test('una aclaración y un relato nuevo pueden mostrar un paso ya visto sin saltar a la clasificación', async () => {
  prepararPasos(SIRVES, { lectura: { sinComprension: true }, paso: { tipo: 'no_encontrada' } }, SIRVES, SIRVES);
  empezarConversacion();
  await enviar('camarero');
  empezarConversacion();
  await enviar('no sé cómo se llama');
  await enviar('sirvo comidas');
  assert.equal(enviados[2]?.cuerpo.texto, 'no sé cómo se llama. sirvo comidas');
  assert.equal(dicho().at(-1), SIRVES.paso.pregunta.texto);
  assert.ok(!dicho().includes(SIN_CAMBIOS));
  empezarConversacion({ borrado: true });
  await enviar('camarero');
  assert.deepEqual(enviados[3]?.cuerpo.respuestas, []);
  assert.equal(enviados[3]?.cuerpo.texto, 'camarero');
  assert.equal(dicho().at(-1), SIRVES.paso.pregunta.texto);
  assert.ok(!dicho().includes(SIN_CAMBIOS));
});

test('una respuesta antigua de «Lo cuento» no abre la clasificación ni sustituye la huella del relato nuevo', async () => {
  let terminar!: (respuesta: typeof SIRVES) => void;
  const antigua = new Promise<typeof SIRVES>((resolve) => {
    terminar = resolve;
  });
  let exploraciones = 0;
  configurarApi({
    gruposHijos: async () => {
      exploraciones += 1;
      return [];
    },
  });
  prepararPasos(SIRVES, antigua, COBRAS, COBRAS);
  empezarConversacion();
  await enviar('camarero');
  await pulsar(LO_CUENTO);
  const pendiente = enviar('camarero');
  await avanzar();
  soltarEspera();
  empezarConversacion({ borrado: true });
  await enviar('cobro las cuentas');
  terminar(SIRVES);
  await pendiente;
  assert.equal(exploraciones, 0);
  assert.ok(!dicho().includes(SIN_CAMBIOS));
  assert.equal(dicho().filter((texto) => texto === SIRVES.paso.pregunta.texto).length, 1);
  await pulsar(LO_CUENTO);
  await enviar('cobro las cuentas');
  await avanzar();
  assert.equal(exploraciones, 1, 'la comparación usa la pregunta vigente del relato nuevo');
  assert.ok(dicho().includes(SIN_CAMBIOS));
});

test('si falla la ficha de la ocupación decidida, reintentar pide la misma ficha y completa la elección', async () => {
  let llamadas = 0;
  configurarApi({
    fichaDeGrupo: async () => {
      llamadas += 1;
      if (llamadas === 1) {
        throw new Error('fallo sintético');
      }
      return ficha('5131');
    },
  });
  prepararPasos({ lectura: LECTURA, paso: { tipo: 'decidida', grupo: '5131', esco: '5131.1', soloGrupo: false } });
  empezarConversacion();
  await enviar('camarero');
  await avanzar();
  await pulsar(REINTENTAR);
  await avanzar();
  assert.ok(llamadas >= 2, 'La ficha se volvió a solicitar');
  assert.equal(estado.ocupacion?.isco08, '5131');
  assert.equal(estado.ocupacion?.esco, '5131.1');
});

test('al reintentar un añadido fallido se conservan el relato y las respuestas del motor', async () => {
  configurarApi({ gruposHijos: async () => [] });
  prepararPasos(
    SIRVES,
    COBRAS,
    new MotorNoListo('sin respuesta', { cause: new PaqueteSinRespuesta('callado') }),
    COBRAS,
  );
  empezarConversacion();
  await enviar('camarero');
  await pulsar('No');
  await pulsar(LO_CUENTO);
  await enviar('también preparo cócteles');
  await avanzar();
  await pulsar(REINTENTAR);
  assert.deepEqual(enviados.at(-1)?.cuerpo, enviados.at(-2)?.cuerpo);
});

test('al reintentar una respuesta rápida se conserva la respuesta elegida', async () => {
  prepararPasos(SIRVES, new MotorNoListo('sin respuesta', { cause: new PaqueteSinRespuesta('callado') }), COBRAS);
  empezarConversacion();
  await enviar('camarero');
  await pulsar('No');
  await pulsar(REINTENTAR);
  assert.deepEqual(enviados.at(-1)?.cuerpo, enviados.at(-2)?.cuerpo);
  assert.ok(dicho().includes('¿Cobras las cuentas?'));
});

test('un reintento antiguo no interfiere con una conversación reiniciada', async () => {
  prepararPasos(new MotorNoListo('sin respuesta', { cause: new PaqueteSinRespuesta('callado') }), SIRVES);
  empezarConversacion();
  await enviar('camarero');
  const reintentar = sugerencia(REINTENTAR)?.accion;
  assert.ok(reintentar);
  empezarConversacion({ borrado: true });
  await enviar('recepcionista');
  const cantidad = enviados.length;
  reintentar();
  await avanzar();
  assert.equal(enviados.length, cantidad);
});
