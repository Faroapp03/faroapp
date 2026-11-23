// Enganche del apartado «Encuesta» con el panel: arriba, «Visible en la web» y el estado de la ronda
// (vista-encuesta-visibilidad.js); debajo, rondas, lotes y resultados (vista-encuesta.js). Lo que lee la segunda llega
// al estado de la ronda de la primera, y el interruptor cambia la política de secciones como el apartado «Secciones».
import { crearVistaEncuesta } from './vista-encuesta.js';
import { crearVistaEncuestaVisibilidad } from './vista-encuesta-visibilidad.js';

/** @typedef {import('./cliente.js').EstadoClientePanel} EstadoClientePanel */
/** @typedef {import('../scripts/secciones-contrato.js').PoliticaSecciones} PoliticaSecciones */
/** @typedef {ReturnType<typeof import('./cliente.js').crearClientePanel>} ClientePanel */
/**
 * @typedef {object} PiezasEncuesta
 * @property {() => ClientePanel} cliente El cliente vigente: cambia al volver a la página desde la caché del navegador.
 * @property {HTMLElement} contenedor Donde se monta la visibilidad (`#vista-encuesta-visibilidad`).
 * @property {(anterior: PoliticaSecciones, politica: PoliticaSecciones) => void} cambiarSecciones Envía la política
 * elegida con su «Deshacer», que vuelve a la confirmada que se veía.
 */

/** Lo que se enseña a la visibilidad cuando el panel retira sus controles: ni sesión ni conexión. */
const SIN_SESION = Object.freeze({ estado: /** @type {const} */ ('cerrada'), aviso: null });

/** @param {PiezasEncuesta} piezas */
export function crearApartadoEncuesta({ cliente, contenedor, cambiarSecciones }) {
  /** La política confirmada que ve la persona: la que «Deshacer» devolvería. @type {PoliticaSecciones|null} */
  let confirmada = null;
  const visibilidad = crearVistaEncuestaVisibilidad({
    contenedor,
    cambiarSecciones: (politica) => confirmada && cambiarSecciones(confirmada, politica),
  });
  const encuesta = crearVistaEncuesta({
    consultar: (ronda) => cliente().consultarEncuesta(ronda),
    abrirRonda: (nombre) => cliente().abrirRondaEncuesta(nombre),
    cerrar: () => cliente().cerrarEncuesta(),
    crearLote: (pedido) => cliente().crearLoteEncuesta(pedido),
    alLeer: (resultados) => visibilidad.mostrarRonda(resultados),
  });
  return {
    /** @param {EstadoClientePanel} estado @param {boolean} sinConexion */
    mostrar(estado, sinConexion) {
      confirmada = estado.estado === 'activa' ? (estado.secciones?.secciones ?? null) : null;
      encuesta.mostrar(estado, sinConexion);
      visibilidad.mostrar(estado, sinConexion);
    },
    retirar() {
      confirmada = null;
      encuesta.retirar();
      visibilidad.mostrar(SIN_SESION, true);
    },
    traducir() {
      encuesta.traducir();
      visibilidad.traducir();
    },
  };
}
