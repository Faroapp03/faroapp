/** Diagnóstico de la publicación construida, separado de las retenciones de las fuentes. */
import { crear, porId } from '../scripts/dom.js';
import { texto } from '../scripts/textos.js';

/** @typedef {{estado:'aplicada'}|{estado:'no-aplicada',motivo:string}} Revision */
/** @typedef {{id:string,tipo:'recurso'|'edicion',proveedor:string,titulo:string,revision:Revision,revisionNivel:Revision,revisionContenido:Revision|null}} Unidad */
/** @typedef {{catalogoSha256:string,revision:string,revisionEditorialSha256:string,revisionMateriasSha256:string,total:number,aplicadas:number,unidades:readonly Unidad[]}} Diagnostico */
const POR_PAGINA = 20;
const MOTIVOS = [
  'programa-sin-revision',
  'titulo-distinto',
  'proveedor-distinto',
  'unidad-sin-revision',
  'firma-distinta',
  'evidencia-nivel-ausente',
  'nivel-por-confirmar',
  'contenido-distinto',
  'materia-sin-evidencia',
  'identidad-materia-distinta',
];

/** @param {HTMLElement} destino @param {Diagnostico} datos @param {number} pagina */
function pintarResumen(destino, datos, pagina) {
  const { total, aplicadas, unidades } = datos;
  destino.append(
    crear(
      'p',
      {},
      texto('panel.clasificacion.total', {
        total: String(total),
        aplicadas: String(aplicadas),
        pendientes: String(total - aplicadas),
      }),
    ),
  );
  for (const [clave, valor] of [
    ['catalogo', datos.catalogoSha256],
    ['revision', datos.revision],
    ['editorial', datos.revisionEditorialSha256],
    ['materias', datos.revisionMateriasSha256],
  ]) {
    destino.append(crear('p', {}, `${texto(`panel.clasificacion.${clave}`)}: ${valor}`));
  }
  const nivelesPendientes = unidades.filter((u) => u.revisionNivel.estado === 'no-aplicada').length;
  destino.append(
    crear('p', {}, texto('panel.clasificacion.niveles-pendientes', { cantidad: String(nivelesPendientes) })),
  );
  for (const motivo of MOTIVOS) {
    const cantidad = unidades.filter((u) => u.revision.estado === 'no-aplicada' && u.revision.motivo === motivo).length;
    destino.append(crear('p', {}, `${texto(`panel.clasificacion.motivo.${motivo}`)}: ${cantidad}`));
  }
  if (total) {
    destino.append(
      crear(
        'p',
        {},
        texto('panel.clasificacion.pagina', {
          actual: String(pagina + 1),
          total: String(Math.ceil(total / POR_PAGINA)),
        }),
      ),
    );
  }
}

/** @param {HTMLElement} destino @param {Diagnostico} datos @param {number} pagina */
function pintarLista(destino, datos, pagina) {
  for (const unidad of datos.unidades.slice(pagina * POR_PAGINA, (pagina + 1) * POR_PAGINA)) {
    const clave = unidad.revision.estado === 'aplicada' ? 'aplicada' : unidad.revision.motivo;
    const nivel = unidad.revisionNivel.estado === 'aplicada' ? 'aplicada' : unidad.revisionNivel.motivo;
    const contenido = unidad.revisionContenido?.estado === 'no-aplicada' ? unidad.revisionContenido.motivo : null;
    destino.append(
      crear(
        'li',
        {},
        `${unidad.titulo} · ${unidad.proveedor} · ${unidad.tipo}: ${unidad.id} · ${texto(`panel.clasificacion.motivo.${clave}`)} · ${texto('panel.clasificacion.nivel')}: ${texto(`panel.clasificacion.motivo.${nivel}`)}${contenido ? ` · ${texto(`panel.clasificacion.motivo.${contenido}`)}` : ''}`,
      ),
    );
  }
}

class VistaClasificacion {
  #boton = porId('consultar-clasificacion', HTMLButtonElement);
  #estado = porId('clasificacion-estado');
  #resumen = porId('clasificacion-resumen');
  #lista = porId('clasificacion-lista');
  #anterior = porId('clasificacion-anterior', HTMLButtonElement);
  #siguiente = porId('clasificacion-siguiente', HTMLButtonElement);
  /** @type {number|null} */ #sesion = null;
  /** @type {Diagnostico|null} */ #datos;
  #consultada = false;
  #pagina = 0;
  /** @param {Diagnostico|null} datos */
  constructor(datos) {
    this.#datos = datos;
    this.#boton.addEventListener('click', () => this.#consultar());
    this.#anterior.addEventListener('click', () => this.#mover(-1));
    this.#siguiente.addEventListener('click', () => this.#mover(1));
  }
  #pintar() {
    this.#estado.textContent = '';
    this.#resumen.replaceChildren();
    this.#lista.replaceChildren();
    this.#boton.disabled = this.#sesion === null;
    this.#anterior.disabled = true;
    this.#siguiente.disabled = true;
    if (!this.#consultada || this.#sesion === null) {
      return;
    }
    if (!this.#datos) {
      this.#estado.textContent = texto('panel.clasificacion.no-disponible');
      return;
    }
    pintarResumen(this.#resumen, this.#datos, this.#pagina);
    pintarLista(this.#lista, this.#datos, this.#pagina);
    this.#anterior.disabled = this.#pagina === 0;
    this.#siguiente.disabled = (this.#pagina + 1) * POR_PAGINA >= this.#datos.total;
  }
  #consultar() {
    if (this.#sesion === null) {
      return;
    }
    this.#consultada = true;
    this.#pagina = 0;
    this.#pintar();
  }
  /** @param {number} direccion */
  #mover(direccion) {
    const pagina = this.#pagina + direccion;
    if (
      this.#consultada &&
      this.#sesion !== null &&
      this.#datos &&
      pagina >= 0 &&
      pagina * POR_PAGINA < this.#datos.total
    ) {
      this.#pagina = pagina;
      this.#pintar();
    }
  }
  /** @param {number} iniciadaEn */
  mostrar(iniciadaEn) {
    if (this.#sesion !== iniciadaEn) {
      this.retirar();
      this.#sesion = iniciadaEn;
      this.#pintar();
    }
  }
  retirar() {
    this.#sesion = null;
    this.#consultada = false;
    this.#pagina = 0;
    this.#pintar();
  }
  traducir() {
    this.#pintar();
  }
}
/** @param {Diagnostico|null} diagnostico */
export function crearVistaClasificacion(diagnostico) {
  return new VistaClasificacion(diagnostico);
}
