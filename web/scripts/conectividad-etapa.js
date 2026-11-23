import './sitio.js';
import './etapas.js';
import { crearConsultaConectividad } from './conectividad/estado.js';
import { porId } from './dom.js';
import { alCambiarIdioma } from './idioma.js';
import { texto } from './textos.js';

/** @typedef {import('./conectividad/estado.js').EstadoConsulta} EstadoConsulta */
const etapa = porId('conectividad');
const direccion = porId('mcp-direccion', HTMLInputElement);
const estado = porId('mcp-estado');
const estadoCopia = porId('mcp-copia-estado');
const copiar = porId('mcp-copiar', HTMLButtonElement);
const repetir = porId('mcp-repetir', HTMLButtonElement);
/** @type {EstadoConsulta} */
let ultimo = { estado: 'consultando' };
let mostrada = false;

/** @param {EstadoConsulta} consulta */
function pintar(consulta) {
  ultimo = consulta;
  repetir.disabled = consulta.estado === 'consultando';
  const activo = consulta.estado === 'confirmado' && consulta.lectura.servicios.mcp;
  copiar.disabled = false;
  direccion.value = new URL('mcp', new URL('./', location.href)).href;
  let clave = `conectividad.estado.${consulta.estado}`;
  if (consulta.estado === 'confirmado') {
    clave = `conectividad.mcp.${activo ? 'activo' : 'inactivo'}`;
  } else if (consulta.estado === 'consultando') {
    clave = 'conectividad.mcp.consultando';
  }
  estado.textContent = texto(clave);
}
let consulta = crearConsultaConectividad({ alCambiar: pintar });
function atenderVisibilidad() {
  const visible = etapa.classList.contains('etapa--actual');
  if (visible === mostrada) {
    return;
  }
  mostrada = visible;
  consulta.retirar();
  consulta = crearConsultaConectividad({ alCambiar: pintar });
  if (visible) {
    void consulta.comprobar();
  } else {
    pintar({ estado: 'consultando' });
  }
}
function copiaManual() {
  direccion.focus();
  direccion.select();
  estadoCopia.textContent = texto('conectividad.copia-manual');
}
copiar.addEventListener('click', async () => {
  if (!navigator.clipboard?.writeText) {
    copiaManual();
    return;
  }
  try {
    await navigator.clipboard.writeText(direccion.value);
    estadoCopia.textContent = texto('conectividad.copiado');
  } catch (error) {
    copiaManual();
    if (!(error instanceof DOMException)) {
      throw error;
    }
  }
});
repetir.addEventListener('click', () => {
  void consulta.comprobar();
});
alCambiarIdioma(() => pintar(ultimo));
const observador = new MutationObserver(atenderVisibilidad);
observador.observe(etapa, { attributes: true, attributeFilter: ['class'] });
window.addEventListener('pagehide', () => {
  consulta.retirar();
  pintar({ estado: 'consultando' });
});
window.addEventListener('pageshow', (evento) => {
  if (evento.persisted) {
    mostrada = false;
    consulta = crearConsultaConectividad({ alCambiar: pintar });
    atenderVisibilidad();
  }
});
atenderVisibilidad();
