// Enganche del armazón del Panel de Control con su vista principal: la sesión única (bienvenida, barra y registro),
// la lista de administradores y el Inicio, que resume lo que el cliente ya ha leído. Las órdenes «Actualizar» y
// «Exportar informe» del Inicio, «Exportar CSV» de Administradores y «Actualizar» del registro viven aquí.
import { descargar } from './archivos-piloto.js';
import { EXITO } from './estados-http-panel.js';
import { crearLecturaAdministradores } from './lectura-administradores.js';
import { crearSesionPanel } from './sesion-panel.js';
import { avisosDeLista, csvDeLista, montarAdministradores, resumenDeLista } from './vista-administradores.js';
import { crearVistaInicio } from './vista-inicio.js';

/** @typedef {ReturnType<typeof import('./cliente.js').crearClientePanel>} ClientePanel */
/**
 * @typedef {object} PiezasArmazon
 * @property {() => ClientePanel} cliente
 * @property {(retomar: boolean) => Promise<void>} abrir Abre la sesión y hace sus lecturas, una tras otra.
 * @property {() => void} repintar Vuelve a pintar el panel con el último estado conocido.
 * @property {() => boolean} libre Si la sesión está abierta, conectada y sin otra operación en curso.
 * @property {(id: string) => HTMLElement} elemento
 */

/** Lo que el Inicio necesita de la lista: cuántos hay activos y pendientes, y los avisos que piden atención.
 * @param {import('./vista-administradores.js').ListaAdministradores} lista */
function resumenDeAdministradores(lista) {
  const contar = (/** @type {string} */ estado) =>
    lista.administradores.filter((fila) => fila.estado === estado).length;
  const atencion = avisosDeLista(lista)
    .filter((aviso) => aviso.getAttribute('data-requiere-atencion') === 'si')
    .map((aviso) => aviso.textContent ?? '');
  return Object.freeze({ activos: contar('activo'), pendientes: contar('pendiente'), atencion });
}

/**
 * Lee la lista de administradores: la vista se monta con el correo de la bienvenida (su fila se marca «tú») y cada
 * lista que llega, también tras un cambio, pasa al Inicio y a la barra de órdenes del apartado.
 * @param {Pick<PiezasArmazon,'cliente'|'repintar'> & {contenedor:HTMLElement, correoPropio:string|null,
 * inicio:ReturnType<typeof crearVistaInicio>, alRecibir:(lista:import('./vista-administradores.js').ListaAdministradores)=>void}} piezas
 */
function leerListaAdministradores({ cliente, repintar, contenedor, correoPropio, inicio, alRecibir }) {
  const vista = montarAdministradores(contenedor, {
    correoPropio,
    pedir: async (ruta, cuerpo) => {
      const respuesta = await cliente().pedirAdministradores(ruta, cuerpo);
      if (respuesta.estado === EXITO) {
        const lista = /** @type {import('./vista-administradores.js').ListaAdministradores} */ (respuesta.cuerpo);
        inicio.recibirAdministradores(resumenDeAdministradores(lista));
        alRecibir(lista);
        repintar();
      }
      return respuesta;
    },
  });
  return vista.actualizar();
}

/** La barra de órdenes de Administradores: el resumen a la derecha y «Exportar CSV» con la última lista leída.
 * @param {PiezasArmazon['elemento']} elemento */
function crearOrdenesAdministradores(elemento) {
  const resumen = elemento('administradores-resumen');
  const exportar = elemento('administradores-exportar');
  /** @type {import('./vista-administradores.js').ListaAdministradores | null} */
  let ultima = null;
  exportar.addEventListener('click', () => {
    if (ultima !== null) {
      const nombre = `faro-administradores-${new Date().toISOString().slice(0, 10)}.csv`;
      descargar(csvDeLista(ultima), nombre, 'text/csv;charset=utf-8');
    }
  });
  /** @param {import('./vista-administradores.js').ListaAdministradores} lista */
  return function recibir(lista) {
    ultima = lista;
    resumen.textContent = resumenDeLista(lista);
    /** @type {HTMLButtonElement} */ (exportar).disabled = false;
  };
}
/** Si la dirección lleva al apartado de Administradores, por su id o por su nombre corto. @param {string} hash */
const esApartadoAdministradores = (hash) => hash.replace(/^#(apartado-)?/u, '') === 'administradores';

/** Entrar en el apartado por su enlace lee la lista si hace falta; el panel avisa de cada cambio de estado y del
 * cambio de idioma. @param {ReturnType<typeof crearLecturaAdministradores>} lectura */
function enlazarLectura(lectura) {
  window.addEventListener('hashchange', () => {
    if (esApartadoAdministradores(location.hash)) {
      lectura.alEntrarEnApartado();
    }
  });
  return {
    alCambiarEstado: lectura.alCambiarEstado,
    // Al cambiar de idioma, la lista se vuelve a leer para pintarla con los textos nuevos.
    traducir: () => void lectura.pedir(),
  };
}
/** @param {PiezasArmazon} piezas */
export function crearArmazon({ cliente, abrir, repintar, libre, elemento }) {
  const inicio = crearVistaInicio();
  const contenedor = elemento('vista-administradores');
  const alRecibir = crearOrdenesAdministradores(elemento);
  const leer = () =>
    leerListaAdministradores({
      cliente,
      repintar,
      contenedor,
      correoPropio: sesion.bienvenida?.correo ?? null,
      inicio,
      alRecibir,
    });
  const lectura = crearLecturaAdministradores(leer, libre);
  const sesion = crearSesionPanel({
    cliente,
    abrir: (retomar) => void abrir(retomar).then(lectura.pedir),
    destinos: {
      bienvenida: elemento('bienvenida-panel'),
      barra: elemento('sesion-barra'),
      armazon: elemento('armazon-panel'),
      registro: elemento('registro-panel-lista'),
    },
    alRegistro: (filas) => {
      inicio.recibirRegistro(filas);
      repintar();
    },
    alEntrar: () => document.dispatchEvent(new Event('panel:entrar')),
  });
  /** Vuelve a leer lo que resume el Inicio, una lectura cada vez y solo mientras el panel siga libre. */
  async function actualizarInicio() {
    const actual = cliente();
    for (const leer of [actual.consultarDatos, actual.consultarTrabajo, actual.consultarActivacion]) {
      if (libre()) {
        await leer();
      }
    }
    await lectura.pedir();
    await sesion.consultarRegistro();
  }
  elemento('inicio-actualizar').addEventListener('click', () => void actualizarInicio());
  elemento('actualizar-registro').addEventListener('click', () => void sesion.consultarRegistro());
  elemento('inicio-exportar').addEventListener('click', () => {
    const informe = inicio.informe();
    if (informe !== null) {
      const nombre = `faro-estado-del-servicio-${new Date().toISOString().slice(0, 10)}.csv`;
      descargar(informe, nombre, 'text/csv;charset=utf-8');
    }
  });
  return { inicio, sesion, administradores: enlazarLectura(lectura) };
}
