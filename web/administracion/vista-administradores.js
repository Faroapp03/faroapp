// Vista «Administradores» del Panel de Control: la lista, el alta por correo, la retirada y su reintento en Cloudflare.
// Solo estructura semántica con clases propias y estables, y textos por claves; ningún texto se interpreta como HTML.
// La vista no conoce el token de la sesión única: recibe una función `pedir` que ya lo añade.
import { texto } from '../scripts/textos.js';
import { lineaCsv } from './archivos-piloto.js';
import { fechaPanel } from './fechas-panel.js';

/** @typedef {import('../../src/administracion/administradores.ts').Administrador} Administrador */
/**
 * @typedef {object} ListaAdministradores
 * @property {Administrador[]} administradores
 * @property {number} maximo
 * @property {{estado:'configurada'}|{estado:'sin-configurar',falta:string[]}} sincronizacion
 * @property {'correcta'|'fallida'} [cloudflare]
 */
/** @typedef {(ruta: string, cuerpo: object) => Promise<{estado: number, cuerpo: unknown}>} PedirPanel */
/**
 * @typedef {object} OpcionesAdministradores
 * @property {PedirPanel} pedir Envía al panel con su token de sesión única, como el resto de cambios.
 * @property {string | null} [correoPropio] Correo de quien mira el panel, para marcar su fila como «tú».
 */

const RUTA = 'administradores';
/** Errores con texto propio; cualquier otro se cuenta como «no disponible». */
const ERRORES_CONOCIDOS = new Set([
  'correo_no_valido',
  'administrador_duplicado',
  'lista_llena',
  'alta_propia_primero',
  'administrador_no_encontrado',
  'ultimo_activo',
  'cloudflare_no_disponible',
  'cloudflare_sin_configurar',
  'sesion_inactiva',
  'sesion_sustituida',
  'no_es_administrador',
  'segundo_factor_requerido',
]);
const ESTADO_CORRECTO = 200;

/** @param {string} etiqueta @param {string} clase @param {string} [contenido] */
function pieza(etiqueta, clase, contenido) {
  const elemento = document.createElement(etiqueta);
  elemento.className = clase;
  if (contenido !== undefined) {
    elemento.textContent = contenido;
  }
  return elemento;
}
/** @param {string} clave @param {Record<string, string|number>} [valores] */
function t(clave, valores) {
  return texto(`panel.administradores.${clave}`, valores);
}
/** Clave del texto de un error del panel. @param {unknown} cuerpo */
export function claveDeError(cuerpo) {
  const codigo =
    cuerpo !== null && typeof cuerpo === 'object' && 'error' in cuerpo && typeof cuerpo.error === 'string'
      ? cuerpo.error
      : '';
  return ERRORES_CONOCIDOS.has(codigo) ? `error.${codigo}` : 'error.no_disponible';
}
/** Estado con icono y palabra: el icono lo dibuja el diseño a partir de su clase; la palabra se lee siempre. @param {Administrador['estado']} estado */
function estadoVisible(estado) {
  const marca = pieza('span', `administradores-estado administradores-estado-${estado}`);
  const icono = pieza('span', `administradores-icono administradores-icono-${estado}`);
  icono.setAttribute('aria-hidden', 'true');
  marca.append(icono, pieza('span', 'administradores-estado-texto', t(`estado.${estado}`)));
  return marca;
}
/** @param {Administrador} fila */
function anadido(fila) {
  const quien = fila.anadidoPor === null ? t('anadido.instalacion') : t('anadido.por', { correo: fila.anadidoPor });
  return `${fechaPanel(fila.anadidoEn)} · ${quien}`;
}
/** @param {Administrador} fila */
function ultimaEntrada(fila) {
  if (fila.ultimaEntrada === null) {
    return t('entrada.nunca');
  }
  const factor = fila.segundoFactor ? t('entrada.con-segundo-factor') : t('entrada.sin-segundo-factor');
  return `${fechaPanel(fila.ultimaEntrada)} · ${factor}`;
}
/** @param {string} clase @param {string} accion @param {string} clave @param {string} correo */
function boton(clase, accion, clave, correo) {
  const elemento = pieza('button', clase, t(clave));
  elemento.setAttribute('type', 'button');
  elemento.setAttribute('data-accion', accion);
  elemento.setAttribute('data-correo', correo);
  elemento.setAttribute('aria-label', t(`${clave}-a`, { correo }));
  return elemento;
}
/** @param {HTMLElement} fila @param {string} clase @param {string | Node} contenido */
function celda(fila, clase, contenido) {
  const elemento = pieza('td', `administradores-celda administradores-celda-${clase}`);
  elemento.append(contenido);
  fila.append(elemento);
}
/** @param {Administrador} fila @param {string | null} propio */
function filaDe(fila, propio) {
  const linea = pieza('tr', `administradores-fila administradores-fila-${fila.estado}`);
  linea.setAttribute('data-correo', fila.correo);
  const usuario = pieza('span', 'administradores-correo', fila.correo);
  if (fila.correo === propio) {
    usuario.append(pieza('span', 'administradores-propio', ` · ${t('tu')}`));
  }
  celda(linea, 'usuario', usuario);
  celda(linea, 'estado', estadoVisible(fila.estado));
  celda(linea, 'anadido', anadido(fila));
  celda(linea, 'entrada', ultimaEntrada(fila));
  const accion =
    fila.estado === 'retirada-pendiente'
      ? boton('administradores-reintentar', 'reintentar', 'reintentar', fila.correo)
      : boton('administradores-retirar', 'retirar', 'retirar', fila.correo);
  celda(linea, 'accion', accion);
  return linea;
}
/** @param {Administrador[]} filas @param {string | null} propio */
function tabla(filas, propio) {
  const elemento = pieza('table', 'administradores-tabla');
  const cabecera = pieza('tr', 'administradores-cabecera');
  for (const clave of ['usuario', 'estado', 'anadido', 'entrada', 'accion']) {
    const columna = pieza('th', `administradores-columna administradores-columna-${clave}`, t(`columna.${clave}`));
    columna.setAttribute('scope', 'col');
    cabecera.append(columna);
  }
  const encabezado = pieza('thead', 'administradores-encabezado');
  encabezado.append(cabecera);
  const cuerpo = pieza('tbody', 'administradores-filas');
  for (const fila of filas) {
    cuerpo.append(filaDe(fila, propio));
  }
  elemento.append(encabezado, cuerpo);
  return elemento;
}
/** Avisos de la lista: vacía, sin sincronización y retiradas que esperan a Cloudflare. Los que llevan
 * `data-requiere-atencion="si"` también se listan en «Requiere atención» del Inicio. @param {ListaAdministradores} lista */
export function avisosDeLista(lista) {
  const resultado = [];
  if (lista.administradores.length === 0) {
    resultado.push(pieza('p', 'administradores-aviso administradores-aviso-vacia', t('aviso.vacia')));
  }
  if (lista.sincronizacion.estado === 'sin-configurar') {
    resultado.push(pieza('p', 'administradores-aviso administradores-aviso-sin-configurar', t('aviso.sin-configurar')));
  }
  for (const fila of lista.administradores.filter((candidata) => candidata.estado === 'retirada-pendiente')) {
    const aviso = pieza(
      'p',
      'administradores-aviso administradores-atencion',
      t('aviso.retirada-pendiente', { correo: fila.correo }),
    );
    aviso.setAttribute('data-requiere-atencion', 'si');
    resultado.push(aviso);
  }
  return resultado;
}
/** Formulario «Añadir administrador»: un campo de correo y un botón; la validación decide el servidor. */
function formulario() {
  const seccion = pieza('section', 'administradores-alta');
  seccion.append(pieza('h3', 'administradores-alta-titulo', t('alta.titulo')));
  const etiqueta = pieza('label', 'administradores-alta-etiqueta', t('alta.correo'));
  const campo = pieza('input', 'administradores-alta-correo');
  campo.setAttribute('type', 'email');
  campo.setAttribute('autocomplete', 'off');
  campo.setAttribute('placeholder', t('alta.ejemplo'));
  etiqueta.append(campo);
  const enviar = pieza('button', 'administradores-alta-enviar', t('alta.enviar'));
  enviar.setAttribute('type', 'button');
  enviar.setAttribute('data-accion', 'anadir');
  seccion.append(etiqueta, pieza('p', 'administradores-alta-ayuda', t('alta.ayuda')), enviar);
  return { seccion, campo, enviar };
}
/** Total y pendientes para la derecha de la barra de órdenes: «3 administradores · 1 invitación pendiente».
 * @param {ListaAdministradores} lista */
export function resumenDeLista(lista) {
  const total = lista.administradores.length;
  const pendientes = lista.administradores.filter((fila) => fila.estado === 'pendiente').length;
  const contar = (/** @type {string} */ clave, /** @type {number} */ cantidad) =>
    t(`${clave}.${cantidad === 1 ? 'uno' : 'varios'}`, { cantidad });
  return `${contar('resumen.total', total)} · ${contar('resumen.pendientes', pendientes)}`;
}
/** «Exportar CSV»: una fila por administrador con su estado, quién lo añadió y cuándo, y su última entrada. El BOM
 * inicial permite abrir los acentos en una hoja de cálculo. @param {ListaAdministradores} lista */
export function csvDeLista(lista) {
  const columnas = ['usuario', 'estado', 'anadido-por', 'fecha', 'entrada', 'segundo-factor'].map((clave) =>
    t(`csv.${clave}`),
  );
  const factor = (/** @type {boolean|null} */ valor) => (valor === null ? '' : t(valor ? 'csv.si' : 'csv.no'));
  const filas = lista.administradores.map((fila) => [
    fila.correo,
    t(`estado.${fila.estado}`),
    fila.anadidoPor ?? t('anadido.instalacion'),
    fechaPanel(fila.anadidoEn),
    fila.ultimaEntrada === null ? '' : fechaPanel(fila.ultimaEntrada),
    factor(fila.segundoFactor),
  ]);
  return `\uFEFF${[columnas, ...filas].map(lineaCsv).join('\r\n')}\r\n`;
}
/** Resultado de un cambio contado en una frase: lo que pasó y, si falla, qué hacer. @param {string} accion @param {{estado:number, cuerpo:unknown}} respuesta */
function mensajeDe(accion, respuesta) {
  if (respuesta.estado !== ESTADO_CORRECTO) {
    return { clave: claveDeError(respuesta.cuerpo), bien: false };
  }
  const lista = /** @type {ListaAdministradores} */ (respuesta.cuerpo);
  if (lista.cloudflare === 'fallida') {
    return { clave: 'hecho.retirada-pendiente', bien: false };
  }
  return { clave: `hecho.${accion}`, bien: true };
}

/** Título y explicación de la lista; su resumen va en la barra de órdenes del apartado. */
function cabecera() {
  const cabeza = pieza('header', 'administradores-cabeza');
  cabeza.append(
    pieza('h2', 'administradores-titulo', t('titulo')),
    pieza('p', 'administradores-explicacion', t('explicacion')),
  );
  return cabeza;
}
/**
 * Cada botón de fila lleva su acción y su correo; el oyente los lee del propio botón.
 * @param {HTMLElement} listado @param {(accion: 'retirar'|'reintentar', correo: string) => Promise<void>} cambiar
 */
function escucharFilas(listado, cambiar) {
  for (const accion of /** @type {const} */ (['retirar', 'reintentar'])) {
    for (const boton of listado.querySelectorAll(`.administradores-${accion}`)) {
      boton.addEventListener('click', () => void cambiar(accion, boton.getAttribute('data-correo') ?? ''));
    }
  }
}
/**
 * Monta la vista en su contenedor (`#vista-administradores`) y la mantiene al día tras cada cambio.
 * @param {HTMLElement} contenedor @param {OpcionesAdministradores} opciones
 */
export function montarAdministradores(contenedor, opciones) {
  const propio = opciones.correoPropio ?? null;
  const estado = pieza('p', 'administradores-mensaje');
  estado.setAttribute('role', 'status');
  /** @param {ListaAdministradores} lista */
  function pintar(lista) {
    const { seccion, campo, enviar } = formulario();
    enviar.addEventListener(
      'click',
      () => void cambiar('anadir', String(/** @type {HTMLInputElement} */ (campo).value ?? '').trim()),
    );
    const listado = tabla(lista.administradores, propio);
    escucharFilas(listado, cambiar);
    const pie = pieza('p', 'administradores-pie', t('pie'));
    contenedor.replaceChildren(cabecera(), ...avisosDeLista(lista), estado, listado, pie, seccion);
  }
  /** @param {string} clave @param {boolean} bien */
  function avisar(clave, bien) {
    estado.textContent = t(clave);
    estado.setAttribute('data-resultado', bien ? 'bien' : 'atencion');
  }
  /** Lee la lista y la pinta. Si no llega, la tarjeta dice qué ha pasado y ofrece volver a leerla.
   * @returns {Promise<boolean>} si la lista se ha leído */
  async function actualizar() {
    const respuesta = await opciones.pedir(`${RUTA}/leer`, {});
    if (respuesta.estado !== ESTADO_CORRECTO) {
      const clave = claveDeError(respuesta.cuerpo);
      const releer = pieza('button', 'administradores-releer', t('releer'));
      releer.setAttribute('type', 'button');
      releer.addEventListener('click', () => void actualizar());
      // El botón va en el pie de la tarjeta, como la nota de la lista leída.
      const pie = pieza('p', 'administradores-pie');
      pie.append(releer);
      contenedor.replaceChildren(estado, pie);
      avisar(clave === 'error.no_disponible' ? 'error.lectura' : clave, false);
      return false;
    }
    pintar(/** @type {ListaAdministradores} */ (respuesta.cuerpo));
    return true;
  }
  /** @param {'anadir'|'retirar'|'reintentar'} accion @param {string} correo */
  async function cambiar(accion, correo) {
    const respuesta = await opciones.pedir(`${RUTA}/${accion}`, { correo });
    if (respuesta.estado === ESTADO_CORRECTO) {
      pintar(/** @type {ListaAdministradores} */ (respuesta.cuerpo));
    }
    const { clave, bien } = mensajeDe(accion, respuesta);
    avisar(clave, bien);
  }
  return { actualizar, cambiar };
}

/**
 * Página para quien supera Access pero no puede usar el panel: no figura en la lista o le falta el segundo factor.
 * @param {HTMLElement} contenedor @param {unknown} cuerpo Cuerpo del 403 del panel.
 */
export function pintarSinPermiso(contenedor, cuerpo) {
  const clave = claveDeError(cuerpo);
  const seccion = pieza('section', 'administradores-sin-permiso');
  seccion.append(
    pieza('h1', 'administradores-sin-permiso-titulo', t('sin-permiso.titulo')),
    pieza('p', 'administradores-sin-permiso-texto', t(clave)),
  );
  contenedor.replaceChildren(seccion);
}
