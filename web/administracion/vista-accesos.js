// Una página global, dividida por canal. Los recuentos diarios no se presentan como filas individuales de consulta.

import { cifra } from '../scripts/cifras.js';
import { crear, porId } from '../scripts/dom.js';
import { texto } from '../scripts/textos.js';
import { diaUtc, fechaPanel } from './fechas-panel.js';
import { consultaVisible, resultadoVisible } from './presentacion-accesos.js';
import { textoHumano as humano } from './textos-accesos-humanos.js';

/** @typedef {import('./cliente.js').EstadoClientePanel} EstadoClientePanel */
/** @typedef {Extract<EstadoClientePanel,{estado:'activa'}>} EstadoActivo */
/** @typedef {import('../../src/administracion/accesos.ts').PaginaAccesos} PaginaAccesos */
/** @typedef {(pagina?:number)=>Promise<EstadoClientePanel>} Consultar */
/** Los instantes se leen en hora de Cataluña; los recuentos diarios conservan el día con el que el servidor los agrupa.
 * @param {string} iso @param {boolean} [diaria] */
function fecha(iso, diaria = false) {
  const instante = diaria ? `${iso}T00:00:00.000Z` : iso;
  return crear('time', {
    dateTime: instante,
    title: instante,
    textContent: diaria ? diaUtc(iso) : fechaPanel(iso),
  });
}
/** @param {'api'|'mcp'|'a2a'} canal */
function cabeceraCanal(canal) {
  return crear(
    'header',
    { className: 'panel-humano-canal-cabecera' },
    crear('h3', { textContent: texto(`panel.accesos.${canal}`) }),
    crear('p', { className: 'panel-humano-canal-ayuda', textContent: humano(`${canal}Ayuda`) }),
  );
}
/** @param {'api'|'mcp'|'a2a'} canal @param {readonly string[]} cabeceras @param {readonly (readonly (Node|string)[])[]} filas */
function tabla(canal, cabeceras, filas) {
  const titulo = `panel.accesos.${canal}`;
  const bloque = crear('section', { className: 'panel-humano-canal' });
  bloque.setAttribute('aria-label', texto(titulo));
  bloque.append(cabeceraCanal(canal));
  const region = crear('div', { className: 'tabla-datos', tabIndex: 0 });
  region.setAttribute('role', 'region');
  region.setAttribute('aria-label', texto(titulo));
  const tabla = crear('table');
  tabla.setAttribute('aria-label', texto(titulo));
  const encabezado = crear('tr');
  for (const clave of cabeceras) {
    const celda = crear('th', { textContent: texto(clave) });
    celda.setAttribute('scope', 'col');
    encabezado.append(celda);
  }
  const cuerpo = crear('tbody');
  for (const valores of filas) {
    const fila = crear('tr');
    for (const [indice, valor] of valores.entries()) {
      const celda = crear('td', {}, valor);
      celda.dataset.rotulo = texto(cabeceras[indice] ?? '');
      fila.append(celda);
    }
    cuerpo.append(fila);
  }
  tabla.append(crear('thead', {}, encabezado), cuerpo);
  region.append(tabla);
  if (!filas.length) {
    region.append(crear('p', { className: 'ayuda', textContent: texto('panel.accesos.sin-canal') }));
  }
  bloque.append(region);
  return bloque;
}
/** @param {PaginaAccesos} pagina */
function tablas(pagina) {
  const api = tabla(
    'api',
    ['panel.accesos.fecha', 'panel.accesos.institucion', 'panel.accesos.consulta', 'panel.accesos.resultado'],
    pagina.api.map((f) => [fecha(f.fecha), f.institucion, consultaVisible(f.consulta), resultadoVisible(f.estadoHttp)]),
  );
  const mcp = tabla(
    'mcp',
    ['panel.accesos.dia', 'panel.accesos.herramienta', 'panel.accesos.cliente', 'panel.accesos.consultas'],
    pagina.mcp.map((f) => [
      fecha(f.dia, true),
      consultaVisible(f.herramienta),
      f.categoriaCliente === 'declarado'
        ? (f.clienteDeclarado ?? '')
        : texto(`panel.accesos.cliente.${f.categoriaCliente}`),
      cifra(f.consultas),
    ]),
  );
  const a2a = tabla(
    'a2a',
    ['panel.accesos.dia', 'panel.accesos.habilidad', 'panel.accesos.consultas'],
    pagina.a2a.map((f) => [fecha(f.dia, true), consultaVisible(f.habilidad), cifra(f.consultas)]),
  );
  return [api, mcp, a2a];
}
class VistaAccesos {
  #raiz = porId('accesos');
  #estado = porId('accesos-estado');
  #lista = porId('accesos-lista');
  #consultar = porId('consultar-accesos', HTMLButtonElement);
  #anterior = porId('accesos-anterior', HTMLButtonElement);
  #siguiente = porId('accesos-siguiente', HTMLButtonElement);
  #resumen = porId('accesos-resumen');
  /** @type {PaginaAccesos|null} */ #pagina = null;
  /** @type {EstadoActivo|null} */ #ultimo = null;
  /** @type {Consultar} */ #pedir;
  /** @param {Consultar} pedir */
  constructor(pedir) {
    this.#pedir = pedir;
    this.#consultar.addEventListener('click', () => {
      if (!this.#consultar.disabled) {
        void pedir(1);
      }
    });
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
    const pagina = estado.accesos ?? null;
    let mensaje = pagina ? 'panel.accesos.lectura' : 'panel.accesos.consultar-primero';
    if (estado.avisoAccesos) {
      mensaje = 'panel.aviso.accesos_no_disponibles';
    }
    this.#estado.textContent = texto(mensaje);
    this.#anterior.disabled = estado.ocupado || !pagina || pagina.pagina <= 1;
    this.#siguiente.disabled = estado.ocupado || !pagina || pagina.pagina * pagina.porPagina >= pagina.total;
    if (this.#pagina !== pagina) {
      this.#pagina = pagina;
      this.#lista.replaceChildren(...(pagina ? tablas(pagina) : []));
    }
    this.#resumen.textContent = pagina
      ? texto('panel.accesos.resumen', {
          pagina: pagina.pagina,
          cantidad: pagina.api.length + pagina.mcp.length + pagina.a2a.length,
          total: pagina.total,
        })
      : texto('panel.accesos.consultar-primero');
  }
  retirar() {
    this.#ultimo = null;
    this.#pagina = null;
    this.#raiz.hidden = true;
    this.#consultar.disabled = true;
    this.#anterior.disabled = true;
    this.#siguiente.disabled = true;
    this.#lista.replaceChildren();
    this.#estado.textContent = '';
    this.#resumen.textContent = '';
  }
  traducir() {
    this.#pagina = null;
    if (this.#ultimo) {
      this.mostrar(this.#ultimo);
    }
  }
  /** @param {number} desplazamiento */
  #mover(desplazamiento) {
    const boton = desplazamiento < 0 ? this.#anterior : this.#siguiente;
    if (boton.disabled || !this.#pagina || !this.#ultimo || this.#ultimo.ocupado) {
      return;
    }
    void this.#pedir(this.#pagina.pagina + desplazamiento);
  }
}
/** @param {Consultar} pedir */
export function crearVistaAccesos(pedir) {
  return new VistaAccesos(pedir);
}
