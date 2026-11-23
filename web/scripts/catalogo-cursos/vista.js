/** Una carga validada y una vista que aplica los límites publicados con el reloj, también sin conexión. */
import {
  CAMPOS_FILTRO,
  consultarListado,
  esperaHastaCierre,
  RelojAtrasado,
  TEMAS_CURSOS,
} from '../../recursos/catalogo-cursos/lector.js';
import { conectarDesplegables } from '../desplegable-con-recuento.js';
import { PaginaIncompleta } from '../dom.js';
import { alCambiarIdioma, escribir } from '../idioma.js';
import { idiomaActual, texto, traducible } from '../textos.js';
import { diaDeCurso } from './fechas-de-curso.js';
import { actualizarCuentas, leerFiltros, montarDesplegable, seleccionar } from './filtros.js';
import { leerParametros, urlConFiltros } from './parametros.js';
import { pintarOfertas } from './pintar.js';

/** @import { ListadoCursos } from '../../recursos/catalogo-cursos/lector.js' */
/** @import { Desplegable } from '../desplegable-con-recuento.js' */
const POR_PAGINA = 20;
/** @param {HTMLElement} raiz @param {string} selector */
function parte(raiz, selector) {
  const nodo = raiz.querySelector(selector);
  if (!(nodo instanceof HTMLElement)) {
    throw new PaginaIncompleta(`Falta una pieza de Cursos: ${selector}`);
  }
  return nodo;
}
/** @param {HTMLElement} raiz */
function piezas(raiz) {
  const busqueda = parte(raiz, '[data-consulta]');
  if (!(busqueda instanceof HTMLInputElement)) {
    throw new PaginaIncompleta('Falta la búsqueda de Cursos');
  }
  return {
    busqueda,
    formulario: parte(raiz, '[data-filtros]'),
    grupos: parte(raiz, '[data-grupos]'),
    orden: parte(raiz, '[data-orden]'),
    lista: parte(raiz, '[data-lista]'),
    cuenta: parte(raiz, '[data-cuenta]'),
    recuento: parte(raiz, '[data-recuento]'),
    actualizado: parte(raiz, '[data-actualizado]'),
    fecha: parte(raiz, '[data-fecha]'),
    vacio: parte(raiz, '[data-vacio]'),
    mas: parte(raiz, '[data-mas]'),
    verMas: parte(raiz, '[data-ver-mas]'),
    quitar: parte(raiz, '[data-quitar]'),
    quitarVacio: parte(raiz, '[data-quitar-vacio]'),
    limpiar: parte(raiz, '[data-limpiar]'),
  };
}
/** Fecha del archivo validado; no es un indicador de salud ni depende de cuántas ofertas conserva.
 * @param {ReturnType<typeof piezas>} ui @param {ListadoCursos} catalogo */
function actualizarFecha(ui, catalogo) {
  const actualizado = diaDeCurso(catalogo.corte_proyeccion_utc, idiomaActual());
  ui.actualizado.hidden = false;
  escribir(ui.fecha, traducible('catalogo.actualizado', { fecha: actualizado }));
}
/** @param {HTMLElement} raiz @param {ListadoCursos} catalogo */
export function iniciarVista(raiz, catalogo) {
  const ui = piezas(raiz);
  const inicial = leerParametros(new URL(location.href));
  const controles = CAMPOS_FILTRO.map((campo) => montarDesplegable(ui.grupos, campo));
  controles.push(montarDesplegable(ui.orden, 'orden'));
  seleccionar(controles, inicial);
  ui.busqueda.value = inicial.texto;
  const estado = {
    visibles: POR_PAGINA,
    pendiente: /** @type {ReturnType<typeof setTimeout> | undefined} */ (undefined),
  };
  const actualizar = crearActualizacion(ui, catalogo, controles, estado);
  function cambiar() {
    estado.visibles = POR_PAGINA;
    actualizar();
  }
  conectar(ui, controles, cambiar);
  ui.verMas.addEventListener('click', () => {
    const primeraNueva = estado.visibles;
    estado.visibles += POR_PAGINA;
    actualizar();
    const enlace = ui.lista.children[primeraNueva]?.querySelector('a');
    if (enlace instanceof HTMLElement) {
      enlace.focus();
    }
  });
  ui.formulario.hidden = false;
  ui.orden.hidden = false;
  conectarReloj(actualizar, () => clearTimeout(estado.pendiente));
  alCambiarIdioma(actualizar);
  actualizar();
}
/** @typedef {{ visibles: number, pendiente: ReturnType<typeof setTimeout> | undefined }} EstadoVista */
/** @param {ReturnType<typeof piezas>} ui @param {ListadoCursos} catalogo
 * @param {Desplegable[]} controles @param {EstadoVista} estado */
function crearActualizacion(ui, catalogo, controles, estado) {
  function actualizar() {
    clearTimeout(estado.pendiente);
    try {
      const filtros = leerFiltros(controles, ui.busqueda.value);
      const contexto = {
        idioma: idiomaActual(),
        nombresTemas: new Map(TEMAS_CURSOS.map((tema) => [tema, texto(`catalogo.tema.${tema}`)])),
      };
      const ahora = Date.now();
      const consulta = consultarListado(catalogo, filtros, ahora, contexto);
      pintarOfertas(ui.lista, consulta.ofertas.slice(0, estado.visibles), filtros.texto);
      actualizarCuentas(controles, consulta);
      actualizarFecha(ui, catalogo);
      const filtrando = Boolean(filtros.texto || CAMPOS_FILTRO.some((campo) => filtros[campo]));
      escribir(
        ui.recuento,
        traducible(filtrando ? 'catalogo.recuento' : claveTotal(consulta.total), {
          vistas: consulta.ofertas.length,
          total: consulta.total,
        }),
      );
      escribir(
        ui.cuenta,
        traducible(claveEstado(consulta.total, consulta.ofertas.length), { n: consulta.ofertas.length }),
      );
      ui.cuenta.className = consulta.total ? 'lecturas-cuenta' : '';
      ui.vacio.hidden = consulta.total === 0 || consulta.ofertas.length !== 0;
      ui.quitar.hidden = !filtrando;
      ui.limpiar.hidden = !filtros.texto;
      const restantes = Math.max(0, consulta.ofertas.length - estado.visibles);
      ui.mas.hidden = restantes === 0;
      escribir(ui.verMas, traducible('catalogo.mas', { n: Math.min(POR_PAGINA, restantes), restantes }));
      history.replaceState(null, '', urlConFiltros(new URL(location.href), filtros));
      const espera = esperaHastaCierre(catalogo.ofertas, ahora);
      estado.pendiente = espera === null ? undefined : setTimeout(actualizar, espera);
    } catch (error) {
      fallar(ui, error);
    }
  }
  return actualizar;
}
/** Con el reloj atrasado, la explicación del recorrido (la misma que en el informe y en la formación): qué corregir.
 * @param {unknown} error */
function explicarFallo(error) {
  return traducible(error instanceof RelojAtrasado ? 'recorrido.error.reloj-atrasado' : 'catalogo.error');
}
/** @param {ReturnType<typeof piezas>} ui @param {unknown} error */
function fallar(ui, error) {
  ui.lista.replaceChildren();
  ui.actualizado.hidden = true;
  ui.mas.hidden = true;
  ui.vacio.hidden = true;
  ui.cuenta.className = '';
  escribir(ui.recuento, traducible('catalogo.titulo'));
  escribir(ui.cuenta, explicarFallo(error));
  console.error('No se puede presentar Cursos con el reloj y la entrega actuales', error);
}
/** @param {ReturnType<typeof piezas>} ui @param {Desplegable[]} controles @param {()=>void} cambiar */
function conectar(ui, controles, cambiar) {
  const control = { desplegables: controles, conFlechas: false };
  const raiz = ui.formulario.closest('main');
  if (!(raiz instanceof HTMLElement)) {
    throw new PaginaIncompleta('Falta el contenedor de Cursos');
  }
  conectarDesplegables(control, raiz, cambiar);
  ui.formulario.addEventListener('submit', (evento) => evento.preventDefault());
  ui.busqueda.addEventListener('input', cambiar);
  ui.limpiar.addEventListener('click', () => {
    ui.busqueda.value = '';
    cambiar();
    ui.busqueda.focus();
  });
  const quitar = () => {
    seleccionar(controles, { texto: '', idioma: '', modalidad: '', nivel: '', tema: '', orden: 'proximos' });
    ui.busqueda.value = '';
    cambiar();
    ui.busqueda.focus();
  };
  ui.quitar.addEventListener('click', quitar);
  ui.quitarVacio.addEventListener('click', quitar);
}
/** @param {()=>void} actualizar @param {()=>void} detener */
function conectarReloj(actualizar, detener) {
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      actualizar();
    }
  });
  window.addEventListener('pageshow', (evento) => {
    if (evento.persisted !== false) {
      actualizar();
    }
  });
  window.addEventListener('pagehide', detener);
  window.addEventListener('popstate', () => location.reload());
}

/** @param {number} total */
function claveTotal(total) {
  return total === 1 ? 'catalogo.uno' : 'catalogo.total';
}
/** @param {number} total @param {number} vistas */
function claveEstado(total, vistas) {
  if (total === 0) {
    return 'catalogo.sin-ofertas';
  }
  return vistas === 1 ? 'catalogo.estado-uno' : 'catalogo.estado';
}
