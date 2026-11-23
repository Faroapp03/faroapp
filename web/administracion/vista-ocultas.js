/** Decisiones privadas del catálogo: conserva su corte, nunca interpreta HTML ni afirma despliegue. */
import { crear, porId } from '../scripts/dom.js';
import { texto } from '../scripts/textos.js';
import { fechaTecnica } from './fechas-panel.js';

/** @typedef {import('./cliente.js').EstadoClientePanel} EstadoClientePanel */
/** @typedef {Extract<EstadoClientePanel,{estado:'activa'}>} EstadoActivo */
/** @typedef {import('./catalogo-privado.js').UnidadCatalogoPrivado} Unidad */
/** @typedef {NonNullable<import('./catalogo-privado.js').PaginaCatalogoPrivado['catalogo']>} Pagina */
/** @typedef {(tipo:'todos'|'recurso'|'edicion',pagina:number)=>Promise<EstadoClientePanel>} Consultar */
/** Motivos del evaluador con explicación propia; el resto se muestra por su código. */
const CAUSAS = new Set(['limite_publicado_alcanzado', 'enlace_de_ficha_no_encontrado']);
const MOTIVOS = new Set([
  'sin_evaluacion',
  'evaluador_modificado_requiere_evaluacion',
  'edicion_modificada_requiere_evaluacion',
  'recurso_modificado_requiere_evaluacion',
  'decision_registrada_no_acredita_oferta',
  'confirmacion_vencida_en_corte',
  'limite_publicado_alcanzado_en_corte',
  'resultado_de_evaluacion_anterior',
  'acceso_o_calendario_indispensable_sin_soporte',
  'confirmacion_sin_fechas_o_url_indispensables',
  'confirmacion_posterior_o_fechas_incoherentes',
  'entradas_evaluadas_incompatibles_con_contrato',
  'catalogo_obligatorio_sin_comprobacion_acreditada',
  'politica_continua_no_registrada',
  'confirmacion_sin_fecha_acreditada',
]);
/** @param {HTMLElement} destino @param {string} clave @param {string|null} valor */
function dato(destino, clave, valor) {
  destino.append(crear('p', {}, `${texto(clave)}: ${valor ?? texto('panel.sin-registro')}`));
}
/** Avisos internos del panel: no cambian la oferta ni lo que ve la persona.
 * @param {HTMLElement} destino @param {Unidad} unidad @param {number} ahora */
function avisos(destino, unidad, ahora) {
  if (unidad.revisarEl !== null && ahora >= Date.parse(unidad.revisarEl)) {
    destino.append(crear('p', {}, texto('panel.ocultas.aviso.revision', { v0: fechaTecnica(unidad.revisarEl) })));
  }
  if (unidad.ultimoIntentoFallidoEl !== null) {
    destino.append(
      crear('p', {}, texto('panel.ocultas.aviso.fallo', { v0: fechaTecnica(unidad.ultimoIntentoFallidoEl) })),
    );
  }
}
/** Resumen de las unidades publicadas con aviso interno; siguen publicadas y no se listan como retenidas.
 * @param {Pagina['avisosPublicadas']} avisos @param {number} ahora @returns {HTMLElement[]} */
function resumenPublicadas(avisos, ahora) {
  const vencidas = avisos.revisiones.filter((f) => Date.parse(f) <= ahora);
  const resumen = [];
  if (vencidas.length) {
    resumen.push(
      crear(
        'p',
        {},
        texto('panel.ocultas.publicadas.revision', { v0: String(vencidas.length), v1: fechaTecnica(vencidas[0]) }),
      ),
    );
  }
  if (avisos.fallidas) {
    resumen.push(crear('p', {}, texto('panel.ocultas.publicadas.fallo', { v0: String(avisos.fallidas) })));
  }
  if (avisos.incidencias) {
    resumen.push(crear('p', {}, texto('panel.ocultas.publicadas.enlace', { v0: String(avisos.incidencias) })));
  }
  return resumen;
}
/** @param {Unidad} unidad @param {Pagina} pagina @param {EstadoActivo} estado @param {number} ahora */
function ficha(unidad, pagina, estado, ahora) {
  const articulo = crear('article', {}, crear('h3', {}, unidad.titulo));
  dato(articulo, 'panel.ocultas.unidad', `${texto(`panel.ocultas.${unidad.tipo}`)} · ${unidad.id}`);
  const motivo = unidad.motivoRetencion ?? 'sin_evaluacion';
  articulo.append(
    crear('p', {}, texto(MOTIVOS.has(motivo) ? `panel.ocultas.motivo.${motivo}` : 'panel.ocultas.motivo.otro')),
  );
  dato(articulo, 'panel.ocultas.codigo', motivo);
  dato(articulo, 'panel.ocultas.decision', unidad.decision ? texto(`panel.ocultas.decision.${unidad.decision}`) : null);
  dato(articulo, 'panel.ocultas.comprobado', fechaTecnica(unidad.comprobadoEl));
  dato(articulo, 'panel.ocultas.cierra', fechaTecnica(unidad.cierraEl));
  dato(articulo, 'panel.ocultas.revisar', fechaTecnica(unidad.revisarEl));
  dato(articulo, 'panel.ocultas.intento-fallido', fechaTecnica(unidad.ultimoIntentoFallidoEl));
  const enlace = unidad.incidenciaEnlace;
  dato(
    articulo,
    enlace ? `panel.ocultas.incidencia-enlace.${enlace.origen}` : 'panel.ocultas.incidencia-enlace',
    enlace &&
      [fechaTecnica(enlace.el), enlace.tipo, enlace.codigoHttp === null ? null : `HTTP ${enlace.codigoHttp}`]
        .filter(Boolean)
        .join(' · '),
  );
  avisos(articulo, unidad, ahora);
  dato(articulo, 'panel.ocultas.intento', fechaTecnica(unidad.ultimoIntentoEl));
  dato(articulo, 'panel.ocultas.fin', fechaTecnica(unidad.ultimoFinEl));
  const fuente = estado.ocultas?.intentosFuentes.find((f) => f.id === unidad.fuenteId);
  dato(articulo, 'panel.ocultas.fuente-intento', fechaTecnica(fuente?.ultimoIntento));
  const detalle = evidencias(unidad, pagina);
  articulo.append(detalle);
  return articulo;
}
/** @param {Unidad} unidad @param {Pagina} pagina */
function evidencias(unidad, pagina) {
  const detalle = crear('details', {}, crear('summary', {}, texto('panel.ocultas.evidencias')));
  dato(
    detalle,
    'panel.ocultas.causas',
    unidad.motivos.length
      ? unidad.motivos.map((m) => (CAUSAS.has(m) ? `${texto(`panel.ocultas.causa.${m}`)} (${m})` : m)).join(' · ')
      : null,
  );
  dato(detalle, 'panel.ocultas.evaluado', unidad.evaluadoEl);
  dato(detalle, 'panel.ocultas.firma', unidad.evaluadorSha256);
  for (const id of unidad.referencias) {
    const ref = pagina.referencias.find((r) => r.id === id)?.referencia;
    if (!ref) {
      continue;
    }
    const p = crear('p');
    if (ref.url) {
      const enlace = crear('a', { href: ref.url, textContent: ref.url });
      enlace.rel = 'noreferrer noopener';
      p.append(enlace);
    } else {
      p.append(ref.documento ?? '');
    }
    p.append(` · ${ref.alcance} · ${fechaTecnica(ref.fecha)} · SHA-256 ${ref.sha256}`);
    if (ref.parametrosOmitidos) {
      p.append(` · ${texto('panel.ocultas.parametros')}`);
    }
    detalle.append(p);
  }
  if (!unidad.referencias.length) {
    detalle.append(crear('p', {}, texto('panel.ocultas.sin-evidencias')));
  }
  return detalle;
}
class VistaOcultas {
  #raiz = porId('ofertas-ocultas');
  #estado = porId('ocultas-estado');
  #lista = porId('ocultas-lista');
  #resumen = porId('ocultas-resumen');
  #consultar = porId('consultar-ocultas', HTMLButtonElement);
  #anterior = porId('ocultas-anterior', HTMLButtonElement);
  #siguiente = porId('ocultas-siguiente', HTMLButtonElement);
  #tipo = porId('ocultas-tipo', HTMLSelectElement);
  /** @type {EstadoActivo|null} */ #ultimo = null;
  /** @type {Consultar} */ #pedir;
  /** @param {Consultar} pedir */
  constructor(pedir) {
    this.#pedir = pedir;
    this.#consultar.addEventListener('click', () => this.#mover(0));
    this.#tipo.addEventListener('change', () => this.#mover(0));
    this.#anterior.addEventListener('click', () => this.#mover(-1));
    this.#siguiente.addEventListener('click', () => this.#mover(1));
  }
  /** @param {EstadoClientePanel} estado */
  mostrar(estado) {
    if (estado.estado !== 'activa') {
      this.retirar();
      return;
    }
    this.#ultimo = estado;
    this.#raiz.hidden = false;
    this.#consultar.disabled = estado.ocupado;
    this.#tipo.disabled = estado.ocupado;
    const lectura = estado.ocultas;
    const pagina = lectura?.ofertasOcultas.catalogo ?? null;
    this.#estado.textContent = texto(pagina ? 'panel.ocultas.observada' : 'panel.ocultas.sin-registro');
    if (estado.avisoOcultas) {
      this.#estado.textContent = pagina
        ? texto('panel.aviso.ocultas_no_disponibles')
        : `${texto('panel.ocultas.sin-registro')} ${texto('panel.ocultas.error')}`;
    }
    this.#anterior.disabled = estado.ocupado || pagina === null || pagina.pagina === 0;
    this.#siguiente.disabled = estado.ocupado || pagina?.siguiente == null;
    this.#lista.replaceChildren();
    this.#resumen.textContent = '';
    if (!pagina) {
      return;
    }
    this.#tipo.value = pagina.tipo;
    this.#resumen.textContent = texto('panel.ocultas.resumen', {
      v0: String(pagina.total),
      v1: String(pagina.pagina + 1),
      v2: fechaTecnica(pagina.corteProyeccion),
      v3: fechaTecnica(lectura?.reciboTerminadoEn),
    });
    const ahora = Date.now();
    this.#lista.append(...resumenPublicadas(pagina.avisosPublicadas, ahora));
    for (const unidad of pagina.unidades) {
      this.#lista.append(ficha(unidad, pagina, estado, ahora));
    }
    if (!pagina.unidades.length) {
      this.#lista.append(crear('p', {}, texto('panel.ocultas.vacia')));
    }
  }
  retirar() {
    this.#ultimo = null;
    this.#raiz.hidden = true;
    this.#lista.replaceChildren();
    this.#resumen.textContent = '';
    this.#estado.textContent = '';
    this.#anterior.disabled = true;
    this.#siguiente.disabled = true;
    this.#consultar.disabled = true;
  }
  traducir() {
    if (this.#ultimo) {
      this.mostrar(this.#ultimo);
    }
  }
  /** @param {number} salto */
  #mover(salto) {
    const estado = this.#ultimo;
    if (!estado || estado.ocupado || this.#consultar.disabled) {
      return;
    }
    const tipo = this.#tipo.value;
    if (tipo !== 'todos' && tipo !== 'recurso' && tipo !== 'edicion') {
      return;
    }
    const pagina = salto === 0 ? 0 : (estado.ocultas?.ofertasOcultas.catalogo?.pagina ?? 0) + salto;
    if (pagina < 0 || (salto > 0 && this.#siguiente.disabled) || (salto < 0 && this.#anterior.disabled)) {
      return;
    }
    void this.#pedir(tipo, pagina);
  }
}
/** @param {Consultar} pedir */
export function crearVistaOcultas(pedir) {
  return new VistaOcultas(pedir);
}
