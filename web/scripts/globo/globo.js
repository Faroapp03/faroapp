// El globo de «Datos globales»: la Tierra con su imagen de satélite sobre un fondo de estrellas fijo, con una marca
// fija en cada territorio con datos (luces.js), que gira solo mientras la persona la arrastra o pulsa un mando, y a su
// lado el selector de país y la ficha del elegido. Lo abre la página «El mundo» (datos-globales-mundo.html) al llegar los
// datos (`abrirGlobo`). Sin WebGL, o si los recursos no llegan, el selector y la ficha siguen funcionando.
// Al elegir un país el globo no se acerca: se recoloca de golpe, sin transición, con el país en el centro. Elegido en
// el globo, el foco va al título de la ficha; Escape dentro de la ficha lo devuelve a lo que eligió el país.
// Nada se mueve solo: no hay giro automático, ni inercia, ni bucle de animación (pintor.js solo dibuja cuando se le
// pide), así que `prefers-reduced-motion` no tiene nada que quitar.

import { direccionDeLaBandera } from '../datos-globales/banderas.js';
import { leerDatosGlobales } from '../datos-globales/datos.js';
import { alCambiarIdioma, escribir, escribirAtributo } from '../idioma.js';
import { idiomaActual, traducible } from '../textos.js';
import { codigoEnElMapa, paisesConIa, paisesDeLaLista } from './datos.js';
import { centrarEn, coordenadasEn, proyectar, radioEnPixeles, ZOOM } from './esfera.js';
import { pintarFicha } from './ficha.js';
import { FronterasInvalidas, lineasDeFronteras, mapaDeTerritorios, territorioEn } from './fronteras.js';
import { escuchar } from './interaccion.js';
import { lucesDe, marcaBajo } from './luces.js';
import { anuncio, crearPartes, descripcion } from './panel.js';
import { crearPintor } from './pintor.js';
import { crearPintorPlano, proyeccionPlana, radioPlano, vistaPlana } from './plano.js';
import {
  ajustarLienzo,
  cargarBanderas,
  cargarFronteras,
  cargarTierra,
  coloresDe,
  RecursoSinCargar,
} from './recursos.js';
import { escucharSelector, pintarOpciones } from './selector.js';
import { SinWebgl } from './webgl.js';

/**
 * @import { DatosGlobales, Territorio } from '../datos-globales/datos.js'
 * @import { Vista } from './esfera.js'
 * @import { Fronteras } from './fronteras.js'
 * @import { Puntero } from './interaccion.js'
 * @import { Luz } from './luces.js'
 * @import { Partes } from './panel.js'
 * @import { Pintor } from './pintor.js'
 */

/** El mapa de territorios, del tamaño de la imagen de la Tierra para que cada píxel caiga en su sitio. */
const MAPA = Object.freeze({ ancho: 2048, alto: 1024 });
/** Hacia dónde mira el globo al abrir si el elegido no tiene contorno (un agregado, como la UE): Europa. */
const CENTRO_SIN_CONTORNO = Object.freeze({ longitud: 10, latitud: 45 });
/** El país elegido al abrir: España, el de Faro. */
const ELEGIDOS_AL_ABRIR = Object.freeze(['ESP']);

/**
 * Lo que el globo sabe de sí mismo mientras está abierto. Su dueño es `abrirGlobo`, y vive hasta `cerrar`.
 * @typedef {Object} Estado
 * @property {Vista} vista
 * @property {Territorio | null} elegido
 * @property {HTMLElement | null} abridor lo que eligió el país (el selector o el globo), al que Escape devuelve el foco
 * @property {{ fronteras: Fronteras, indices: Map<string, number> } | null} mapa
 * @property {AbortController | null} ficha vida de los gráficos de la ficha vigente
 * @property {Pintor | null} pintor
 * @property {HTMLCanvasElement | null} plano el lienzo, si el navegador no ofrece WebGL y se ve el mapa plano (plano.js)
 * @property {Luz[]} luces las de los países con datos, que se calculan al tener las fronteras
 * @property {boolean} pintadoPendiente
 * @property {boolean} cerrado
 */
/**
 * Un globo abierto: sus partes en la página, los datos, su estado y la señal que retira sus escuchas al cerrarlo.
 * @typedef {Object} Globo
 * @property {Partes} partes
 * @property {DatosGlobales} datos
 * @property {readonly Territorio[]} paises los que salen: con algún dato de la IA
 * @property {Estado} estado
 * @property {AbortSignal} senal
 */

/**
 * Los índices del mapa que se tiñen: el del elegido y los de los territorios que están dentro de él (al elegir España,
 * también Cataluña, que ocupa sus propios píxeles).
 * @param {Estado} estado @returns {number[]}
 */
function elegidosEnElMapa({ elegido, mapa }) {
  if (!elegido || !mapa) {
    return [];
  }
  const codigo = codigoEnElMapa(elegido);
  const dentro = mapa.fronteras.territorios.filter(({ dentroDe }) => dentroDe === codigo);
  return [codigo, ...dentro.map((territorio) => territorio.codigo)]
    .map((uno) => mapa.indices.get(uno) ?? 0)
    .filter((indice) => indice > 0);
}

/**
 * Pinta el globo en el fotograma siguiente, una sola vez aunque antes lleguen varios movimientos: no es un bucle, cada
 * fotograma lo pide un gesto de la persona.
 * @param {Estado} estado
 */
function pedirPintado(estado) {
  if (!estado.pintor || estado.pintadoPendiente || estado.cerrado) {
    return;
  }
  estado.pintadoPendiente = true;
  requestAnimationFrame(() => {
    estado.pintadoPendiente = false;
    if (!estado.cerrado) {
      estado.pintor?.pintar(estado.vista, elegidosEnElMapa(estado));
    }
  });
}

/** Sube al pintor las marcas, con la del elegido resaltada. @param {Estado} estado */
function ponerLuces({ pintor, luces, elegido }) {
  pintor?.ponerLuces(luces, elegido?.codigo ?? null);
}

/** Pone el territorio elegido en el centro, si tiene contorno. @param {Estado} estado */
function centrarEnElElegido(estado) {
  const codigo = estado.elegido ? codigoEnElMapa(estado.elegido) : null;
  const enElMapa = estado.mapa?.fronteras.territorios.find((territorio) => territorio.codigo === codigo);
  estado.vista = centrarEn(estado.vista, enElMapa?.centro);
}

/**
 * Vuelve a pintar las opciones del selector, la ficha, la descripción del globo y el globo. Devuelve el título de la
 * ficha (null si no hay nada elegido).
 * @param {Globo} globo @returns {HTMLElement | null}
 */
function repintar(globo) {
  const { partes, datos, paises, estado } = globo;
  pintarOpciones(partes.selector, paisesDeLaLista(paises, idiomaActual()), estado.elegido);
  estado.ficha?.abort();
  const ficha = new AbortController();
  estado.ficha = ficha;
  let titulo;
  try {
    titulo = estado.elegido
      ? pintarFicha({ ...partes.ficha, signal: ficha.signal }, datos, estado.elegido, partes.nivel)
      : null;
  } catch (error) {
    ficha.abort();
    throw error;
  }
  if (!titulo) {
    for (const sitio of Object.values(partes.ficha)) {
      sitio.replaceChildren();
    }
  }
  escribirAtributo(partes.lienzo, 'aria-label', descripcion(estado.elegido));
  ponerLuces(estado);
  pedirPintado(estado);
  return titulo;
}

/**
 * Elige un país: lo centra, lo tiñe, pinta su ficha y lo anuncia. Elegido en el globo, el foco va al título de la
 * ficha; elegido en el selector, se queda en el campo (patrón combobox de WAI-ARIA).
 * @param {Globo} globo @param {Territorio} territorio
 * @param {HTMLElement} abridor el campo del selector o el globo, adonde vuelve el foco con Escape desde la ficha
 */
function elegir(globo, territorio, abridor) {
  const { partes, estado } = globo;
  estado.elegido = territorio;
  estado.abridor = abridor;
  centrarEnElElegido(estado);
  const titulo = repintar(globo);
  escribir(partes.estado, anuncio(territorio));
  if (abridor === partes.lienzo) {
    titulo?.focus();
  }
}

/**
 * Escape con el foco dentro de la ficha: el foco vuelve a lo que eligió el país. Devuelve si lo ha devuelto.
 * @param {Globo} globo @returns {boolean}
 */
function volverAlAbridor({ partes, estado }) {
  const enLaFicha = Object.values(partes.ficha).some((sitio) => sitio.contains(document.activeElement));
  if (!estado.abridor || !enLaFicha) {
    return false;
  }
  estado.abridor.focus();
  return true;
}

/**
 * El territorio bajo el puntero: el de la marca que pulsa, si pulsa una (su cabeza queda encima del país vecino), o el
 * del mapa y, si tiene datos, el de los datos.
 * @param {Globo} globo @param {Puntero} puntero
 */
function territorioBajo({ partes, paises, estado }, { clientX, clientY }) {
  const caja = partes.lienzo.getBoundingClientRect();
  const { radio, proyeccion, coordenadasEn: puntoEn } = proyeccionDe(estado, caja);
  const [derecha, arriba] = [clientX - caja.left - caja.width / 2, caja.top + caja.height / 2 - clientY];
  const punto = { derecha, arriba, radio, proyeccion };
  const marca = marcaBajo(estado.luces, estado.vista, punto, estado.elegido?.codigo ?? null);
  const deLaMarca = marca ? (paises.find(({ codigo }) => codigo === marca.codigo) ?? null) : null;
  if (deLaMarca) {
    return { enElMapa: null, conDatos: deLaMarca };
  }
  const coordenadas = puntoEn(estado.vista, derecha / radio, arriba / radio);
  const enElMapa = coordenadas && estado.mapa ? territorioEn(estado.mapa.fronteras, coordenadas) : null;
  // Un territorio dentro de un país (Cataluña en España) se elige él mismo si tiene datos; si no, elige su país.
  const deCodigo = (/** @type {string | null | undefined} */ codigo) =>
    paises.find((uno) => codigoEnElMapa(uno) === codigo) ?? null;
  const conDatos = deCodigo(enElMapa?.codigo) ?? deCodigo(enElMapa?.dentroDe);
  return { enElMapa, conDatos };
}

/**
 * La proyección de lo que se ve, en un lienzo de `ancho` × `alto` píxeles de CSS: la del globo o, sin WebGL, la del
 * mapa plano; su radio en píxeles, cómo cae un punto y qué punto hay bajo unas medidas.
 * @param {Estado} estado @param {{ width: number, height: number }} caja
 */
function proyeccionDe(estado, { width: ancho, height: alto }) {
  if (!estado.plano) {
    return { radio: radioEnPixeles(ancho, alto, estado.vista.zoom), proyeccion: proyectar, coordenadasEn };
  }
  const plana = proyeccionPlana(ancho, alto);
  return {
    radio: radioPlano(ancho, alto, estado.vista.zoom),
    proyeccion: plana.proyectar,
    coordenadasEn: plana.coordenadasEn,
  };
}

/** La vista, acotada en el mapa plano para que cubra el alto del lienzo. @param {Estado} estado @param {Vista} vista */
function acotada({ plano }, vista) {
  return plano ? vistaPlana(vista, plano.clientWidth, plano.clientHeight) : vista;
}

/** Lo que la interacción (interaccion.js) puede hacer con el globo. @param {Globo} globo */
function controlesDe(globo) {
  const { partes, estado } = globo;
  return {
    vista: () => estado.vista,
    radio: (/** @type {number} */ ancho, /** @type {number} */ alto, /** @type {number} */ zoom) =>
      estado.plano ? radioPlano(ancho, alto, zoom) : radioEnPixeles(ancho, alto, zoom),
    mover: (/** @type {Vista} */ vista) => {
      estado.vista = acotada(estado, vista);
      pedirPintado(estado);
    },
    pulsar: (/** @type {Puntero} */ puntero) => {
      const { enElMapa, conDatos } = territorioBajo(globo, puntero);
      if (conDatos) {
        elegir(globo, conDatos, partes.lienzo);
      } else if (enElMapa) {
        escribir(partes.estado, traducible('globo.sin-datos'));
      }
    },
    sobreDatos: (/** @type {Puntero} */ puntero) => territorioBajo(globo, puntero).conDatos !== null,
    volver: () => volverAlAbridor(globo),
    centrar: () => {
      centrarEnElElegido(estado);
      estado.vista = acotada(estado, estado.vista);
      pedirPintado(estado);
    },
  };
}

/**
 * Oculta la escena y dice por qué en la página: la lista y el panel siguen.
 * @param {Partes} partes @param {string} clave
 */
function ocultarEscena(partes, clave) {
  partes.escena.hidden = true;
  partes.aviso.hidden = false;
  escribir(partes.aviso, traducible(clave));
}

/**
 * El pintor del globo o, si el navegador no ofrece WebGL, el del mapa plano (plano.js), que lo dice con una línea
 * discreta bajo la escena. Si tampoco hay lienzo 2D, lanza el SinWebgl del globo.
 * @param {Partes} partes @param {Estado} estado @param {import('./pintor.js').Geometria} geometria
 * @param {Fronteras} fronteras
 * @returns {Pintor}
 * @throws {SinWebgl} Si no se puede dibujar ni el globo ni el mapa plano.
 */
function crearPintorDe(partes, estado, geometria, fronteras) {
  const colores = coloresDe(partes.raiz);
  try {
    return crearPintor(partes.lienzo, geometria, colores);
  } catch (error) {
    if (!(error instanceof SinWebgl) || partes.lienzo.getContext('webgl')) {
      throw error;
    }
    let pintor;
    try {
      pintor = crearPintorPlano(partes.lienzo, geometria, colores, fronteras);
    } catch {
      throw error;
    }
    estado.plano = partes.lienzo;
    estado.vista = acotada(estado, estado.vista);
    partes.escena.dataset.vista = 'plana';
    partes.nota.hidden = false;
    console.info('Este navegador no ofrece WebGL: el globo se ve como un mapa plano.');
    return pintor;
  }
}

/** Si un fallo al preparar el dibujo es de los esperables: sin WebGL, sin red o un recurso que no es el suyo. */
function esFalloEsperable(/** @type {unknown} */ error) {
  return [SinWebgl, RecursoSinCargar, FronterasInvalidas].some((Clase) => error instanceof Clase);
}

/**
 * Prepara el dibujo: las fronteras, el mapa de territorios y el pintor. La imagen de la Tierra llega después y, hasta
 * entonces, la esfera se pinta con el color del mar. Un fallo esperable deja la escena oculta y lo dice en la página;
 * cualquier otro se propaga.
 * @param {Globo} globo
 */
async function prepararDibujo({ partes, paises, estado, senal }) {
  // Las banderas se piden a la vez que las fronteras y no se esperan: las marcas las llevan en cuanto llegan.
  const direcciones = direccionesDeLasBanderas(paises);
  const banderas = cargarBanderas(direcciones);
  try {
    const fronteras = await cargarFronteras();
    const { pixeles, indices } = mapaDeTerritorios(fronteras, MAPA.ancho, MAPA.alto);
    estado.mapa = { fronteras, indices };
    centrarEnElElegido(estado);
    ajustarLienzo(partes.lienzo);
    const geometria = { lineas: lineasDeFronteras(fronteras), mapa: pixeles, ...MAPA };
    estado.pintor = crearPintorDe(partes, estado, geometria, fronteras);
    estado.luces = lucesDe(paises, fronteras, codigoEnElMapa);
    ponerLuces(estado);
  } catch (error) {
    if (!esFalloEsperable(error)) {
      throw error;
    }
    console.warn('El globo no se puede dibujar; la lista y el panel siguen funcionando.', error);
    ocultarEscena(partes, error instanceof SinWebgl ? 'globo.sin-webgl' : 'globo.no-carga');
    return;
  }
  // Con poca memoria, el navegador puede quitarle la tarjeta gráfica: el globo no se rehace solo, y lo dice.
  const alPerderla = () => ocultarEscena(partes, 'globo.sin-webgl');
  partes.lienzo.addEventListener('webglcontextlost', alPerderla, { once: true, signal: senal });
  pedirPintado(estado);
  void banderas.then((imagenes) => {
    if (estado.cerrado) {
      return;
    }
    if (imagenes.size < direcciones.size) {
      console.warn(
        `${direcciones.size - imagenes.size} banderas no han llegado: sus marcas llevan una luz en su lugar.`,
      );
    }
    if (estado.pintor?.ponerBanderas(imagenes)) {
      pedirPintado(estado);
    }
  });
  // La imagen no se espera: el globo ya se puede usar con el mar liso, y se vuelve a pintar cuando llega.
  void cargarTierra().then(
    (imagen) => {
      if (estado.cerrado) {
        return;
      }
      estado.pintor?.ponerTierra(imagen);
      pedirPintado(estado);
    },
    (error) => console.warn('Sin la imagen de la Tierra: el globo sigue con el mar liso.', error),
  );
}

/** Dónde está la bandera de cada país que sale, por su código. @param {readonly Territorio[]} paises */
function direccionesDeLasBanderas(paises) {
  return new Map(
    paises.flatMap(({ codigo }) => {
      const direccion = direccionDeLaBandera(codigo, { delJuego: true });
      return direccion ? [/** @type {const} */ ([codigo, direccion])] : [];
    }),
  );
}

/** El país elegido al abrir, de los que salen, o null. @param {readonly Territorio[]} paises */
function elegidoAlAbrir(paises) {
  return (
    ELEGIDOS_AL_ABRIR.map((codigo) => paises.find((uno) => codigoEnElMapa(uno) === codigo)).find(
      (uno) => uno !== undefined,
    ) ?? null
  );
}

/**
 * Suelta todo lo del globo abierto: deja de pintar y de escuchar, suelta la tarjeta gráfica y lo quita de la página.
 * @param {{ estado: Estado }} globo
 * @param {{ controlador: AbortController, observador: ResizeObserver, contenedor: HTMLElement }} abierto
 */
function soltar({ estado }, { controlador, observador, contenedor }) {
  estado.cerrado = true;
  controlador.abort();
  estado.ficha?.abort();
  observador.disconnect();
  estado.pintor?.liberar();
  contenedor.replaceChildren();
}

/** El estado del globo al abrirlo, con el país elegido al abrir. @param {readonly Territorio[]} paises @returns {Estado} */
function estadoAlAbrir(paises) {
  return {
    vista: { centro: CENTRO_SIN_CONTORNO, zoom: ZOOM.minimo },
    elegido: elegidoAlAbrir(paises),
    abridor: null,
    mapa: null,
    ficha: null,
    pintor: null,
    plano: null,
    luces: [],
    pintadoPendiente: false,
    cerrado: false,
  };
}

// ---------- Lo público ----------

/**
 * Abre el globo dentro de `contenedor` con los datos globales (`datos`, tal como llegan: se comprueban aquí con el
 * lector del contrato, scripts/datos-globales/datos.js, y si no lo cumplen lanza DatosGlobalesNoValidos sin pintar
 * nada). `nivel` es el de los títulos del globo en la página. La promesa se cumple cuando el globo ya se puede usar.
 * Entrega la función `cerrar`, que lo quita de la página y suelta todo.
 * @param {HTMLElement} contenedor @param {unknown} datos @param {{ nivel?: 2 | 3 | 4 }} [opciones]
 * @returns {Promise<{ cerrar: () => void }>}
 * @throws {import('../datos-globales/datos.js').DatosGlobalesNoValidos} Si los datos no cumplen su contrato.
 * @throws {unknown} Un fallo no esperable al preparar el dibujo, ya con el globo cerrado.
 */
export async function abrirGlobo(contenedor, datos, { nivel = 3 } = {}) {
  const leidos = leerDatosGlobales(datos);
  const paises = paisesConIa(leidos);
  const partes = crearPartes(contenedor, nivel);
  const controlador = new AbortController();
  const estado = estadoAlAbrir(paises);
  const globo = { partes, datos: leidos, paises, estado, senal: controlador.signal };
  repintar(globo);
  escuchar(partes, controlesDe(globo), controlador.signal);
  escucharSelector(
    partes.selector,
    {
      alElegir: (territorio) => elegir(globo, territorio, partes.selector.campo),
      alNoHaber: () => escribir(partes.estado, traducible('globo.selector.ninguno')),
    },
    controlador.signal,
  );
  const observador = new ResizeObserver(() => {
    ajustarLienzo(partes.lienzo);
    pedirPintado(estado);
  });
  observador.observe(partes.lienzo);
  // Al cambiar de idioma se vuelve a pintar todo, para ordenar la lista en el idioma nuevo.
  alCambiarIdioma(
    () => {
      if (!estado.cerrado) {
        repintar(globo);
      }
    },
    { signal: controlador.signal },
  );
  const cerrar = () => soltar(globo, { controlador, observador, contenedor });
  // Un fallo no esperable al preparar el dibujo no deja escuchas, observador ni partes vivas: se cierra y se relanza.
  try {
    await prepararDibujo(globo);
  } catch (error) {
    cerrar();
    throw error;
  }
  if (estado.elegido) {
    escribir(partes.estado, anuncio(estado.elegido));
  }
  return { cerrar };
}
